#!/usr/bin/env node
// Checks the monitoring end to end against the running stack (node scripts/start.mjs), and makes a little real
// activity first so there is something to see: sign-ins, a refused request, and a control test that rescores a risk.
// Usage: node scripts/check-monitoring.mjs     Exit code 1 if any check fails.
// Creates a closed risk and a control named "[monitoring check]" (they can be closed, not deleted).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATEWAY = 'http://localhost:8080';
const PROMETHEUS = 'http://localhost:9090';
const GRAFANA = 'http://localhost:3000';
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Logs can be large after a restart; the default 1 MB buffer would cut them off.
const docker = (args) => spawnSync('docker', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });

function check(name, ok, detail) {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(GATEWAY + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null };
}
const login = async (username) => (await api('/api/auth/login', { method: 'POST', body: { username, password: 'demo123' } })).json.accessToken;
const promQuery = async (query) => (await (await fetch(`${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(query)}`)).json()).data?.result ?? [];

console.log('\nMaking some activity');
const [alice, bob, carol] = [await login('alice'), await login('bob'), await login('carol')];
await api('/api/auth/login', { method: 'POST', body: { username: 'alice', password: 'wrong-password' } });
await api('/api/risks', { method: 'POST', token: carol, body: { title: 'x', category: 'CYBER', likelihood: 1, impact: 1 } }); // 403
const control = (await api('/api/controls', { method: 'POST', token: bob, body: { name: '[monitoring check] control', type: 'PREVENTIVE', frequency: 'MONTHLY' } })).json;
const risk = (await api('/api/risks', { method: 'POST', token: alice, body: { title: '[monitoring check] risk', category: 'CYBER', likelihood: 4, impact: 5 } })).json;
await api(`/api/risks/${risk.id}/controls/${control.id}`, { method: 'POST', token: alice });
const assessed = await api(`/api/controls/${control.id}/assessments`, { method: 'POST', token: carol, body: { result: 'EFFECTIVE', evidence: '[monitoring check]' } });
for (let i = 0; i < 40 && (await api(`/api/risks/${risk.id}`, { token: alice })).json.residualScore === 20; i++) await sleep(250);
for (let i = 0; i < 20; i++) await api('/api/dashboard/heatmap', { token: alice });
const current = (await api(`/api/risks/${risk.id}`, { token: alice })).json;
await api(`/api/risks/${risk.id}/status`, { method: 'PATCH', token: alice, body: { status: 'CLOSED', version: current.version } });
console.log(`  risk ${risk.id}: 20 → ${current.residualScore} after the test; waiting 15 s for Prometheus and Tempo`);
await sleep(15000);

console.log('\nPrometheus');
const targets = (await (await fetch(`${PROMETHEUS}/api/v1/targets`)).json()).data.activeTargets;
const up = targets.filter((t) => t.health === 'up').map((t) => t.labels.job).sort();
check('Prometheus scrapes all three services', ['control-service', 'gateway', 'risk-service'].every((j) => up.includes(j)), up.join(', '));
const rules = (await (await fetch(`${PROMETHEUS}/api/v1/rules`)).json()).data.groups.flatMap((g) => g.rules);
check('Alert rules are loaded and healthy', rules.length >= 8 && rules.every((r) => r.health === 'ok'), `${rules.length} rules`);

console.log('\nEvery dashboard query returns data');
let queries = 0;
const empty = [];
for (const file of ['overview', 'events', 'security']) {
  const dashboard = JSON.parse(readFileSync(join(root, 'deploy', 'monitoring', 'grafana', 'dashboards', `${file}.json`), 'utf8'));
  for (const panel of dashboard.panels.filter((p) => p.targets)) {
    for (const t of panel.targets) {
      queries++;
      // Some panels are empty by design until something goes wrong.
      const quietByDesign = /ALERTS|rejected_signature|status=~"5\.\."|lag_max|throttled|429/.test(t.expr);
      const result = await promQuery(t.expr.replaceAll('$__range', '15m').replaceAll('$__rate_interval', '1m'));
      if (!result.length && !quietByDesign) empty.push(`${file} · ${panel.title}`);
    }
  }
}
check('Every chart that should have data has data', empty.length === 0, empty.length ? `empty: ${empty.join('; ')}` : `${queries} queries`);

const rescore = await promQuery('histogram_quantile(0.95, sum by (le) (rate(rcp_assessment_to_rescore_seconds_bucket[5m])))');
check('"Test → new score" time is measured', rescore.length > 0 && Number(rescore[0].value[1]) > 0, rescore.length ? `p95 ${(Number(rescore[0].value[1]) * 1000).toFixed(0)} ms` : 'no data');

console.log('\nLogs');
const lines = ['gateway', 'risk-service', 'control-service'].flatMap((service) => {
  const out = docker(['logs', '--since', '5m', `risk-control-platform-${service}-1`]);
  return (out.stdout + out.stderr).split('\n').filter((l) => l.startsWith('{')).map((l) => [service, l]);
});
const parsed = lines.map(([service, l]) => {
  try {
    return { ...JSON.parse(l), container: service };
  } catch {
    return null;
  }
}).filter(Boolean);
check('Service logs are JSON', parsed.length > 0 && parsed.length === lines.length, `${parsed.length} JSON lines in the last 5 minutes`);
// Start from the log line that names this run's assessment, as you would when investigating: it gives the trace id.
const recordedLine = parsed.find((l) => l.message?.includes(`Recorded assessment ${assessed.json.id}`));
const traceId = recordedLine?.traceId ?? null;
const ofTrace = parsed.filter((l) => traceId && l.traceId === traceId);
const loggedBy = [...new Set(ofTrace.map((l) => l.container))].sort();
check(
  "The control test's log lines, in both services, carry its trace id",
  Boolean(traceId) && ofTrace.some((l) => /Rescored risk/.test(l.message)),
  traceId ? `trace ${traceId}: ${ofTrace.length} lines in ${loggedBy.join(', ')}` : 'no "Recorded assessment" line for this run',
);

console.log('\nTracing');
const tempo = (path) => docker(['exec', 'risk-control-platform-tempo-1', 'wget', '-qO-', `http://localhost:3200${path}`]).stdout;
let spans = [];
if (traceId) {
  try {
    const trace = JSON.parse(tempo(`/api/traces/${traceId}`));
    for (const batch of trace.batches ?? trace.resourceSpans ?? []) {
      const service = batch.resource.attributes.find((a) => a.key === 'service.name')?.value.stringValue;
      for (const scope of batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? []) for (const span of scope.spans) spans.push(`${service}: ${span.name}`);
    }
  } catch {
    spans = [];
  }
}
const services = [...new Set(spans.map((s) => s.split(':')[0]))].sort();
check('That trace runs across the Gateway, both services and Kafka',
  ['control-service', 'gateway', 'risk-service'].every((s) => services.includes(s)) && spans.some((s) => /control\.assessed/.test(s)),
  traceId ? `${spans.length} spans in ${services.join(', ')}` : 'no trace id');

console.log('\nSecurity alert');
// One unsigned "control works" event for a control that doesn't exist: rejected, changes nothing, but must alert.
const forged = JSON.stringify({ eventId: crypto.randomUUID(), schemaVersion: 1, controlId: crypto.randomUUID(), controlType: 'PREVENTIVE',
  assessmentId: crypto.randomUUID(), result: 'EFFECTIVE', effectiveness: 1.0, assessedAt: new Date().toISOString() });
spawnSync('docker', ['exec', '-i', 'risk-control-platform-kafka-1', '/opt/kafka/bin/kafka-console-producer.sh', '--bootstrap-server', 'localhost:9092',
  '--topic', 'control.assessed'], { input: `${forged}\n`, encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
let firing = false;
for (let i = 0; i < 12 && !firing; i++) {
  await sleep(5000);
  const alerts = (await (await fetch(`${PROMETHEUS}/api/v1/alerts`)).json()).data.alerts;
  firing = alerts.some((a) => a.labels.alertname === 'ForgedEventRejected' && a.state === 'firing');
}
const counted = await promQuery('sum(increase(rcp_events_consumed_total{outcome="rejected_signature"}[5m]))');
check('A forged Kafka event is counted and fires the ForgedEventRejected alert', firing && Number(counted[0]?.value[1] ?? 0) > 0,
  `alert ${firing ? 'firing' : 'not firing'}, ${Number(counted[0]?.value[1] ?? 0).toFixed(0)} counted in 5 min`);

console.log('\nExposure');
const publicMetrics = await Promise.all([8080, 8081, 8082].map(async (port) => (await fetch(`http://localhost:${port}/actuator/prometheus`)).status));
check('Metrics are not served on the public ports', publicMetrics.every((s) => s !== 200), `8080/8081/8082 → ${publicMetrics.join(', ')}`);
const anonymous = await fetch(`${GRAFANA}/api/dashboards/uid/rcp-overview`);
const anonymousSave = await fetch(`${GRAFANA}/api/dashboards/db`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dashboard: { title: 'x' } }) });
check('Grafana: anyone can view, nobody can change without the admin password', anonymous.status === 200 && [401, 403].includes(anonymousSave.status),
  `view ${anonymous.status}, save ${anonymousSave.status}`);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Dashboards: ${GRAFANA}`);
process.exit(failed ? 1 : 0);
