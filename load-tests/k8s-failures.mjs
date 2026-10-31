#!/usr/bin/env node
// What users see when parts of the platform on Kubernetes fail (docs/kubernetes.md, "Failures"). Viewers keep reading
// the Overview (Risk Service, Postgres, Redis) and the controls list (Control Service, MongoDB) through the edge,
// one request every 100 ms each, while one part at a time is crashed or restarted. For each: how many requests failed
// and for how long, and how long until the part was back. Then a Kafka outage: an assessment recorded while Kafka is
// down must still change the risk's score once Kafka is back (the outbox holds the event). Results: out/k8s-failures.json
//   node load-tests/make-tokens.mjs 6000 && node load-tests/k8s-failures.mjs [--only gateway-kill,kafka,...]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Agent, request } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NS = 'rcp';
const NODE = 'rcp-control-plane';
const tokens = JSON.parse(readFileSync(join(root, 'load-tests', 'out', 'tokens.json'), 'utf8'));
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const agent = new Agent({ keepAlive: true, maxSockets: 64, rejectUnauthorized: false });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const kubectl = (...args) => spawnSync('kubectl', ['-n', NS, ...args], { encoding: 'utf8' });
const node = (script) => spawnSync('docker', ['exec', NODE, 'sh', '-c', script], { encoding: 'utf8' });

function call(path, { method = 'GET', token, body } = {}) {
  return new Promise((resolve) => {
    const req = request({
      agent, host: 'localhost', port: 8443, path, method, timeout: 10_000,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, (response) => {
      let text = '';
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () => resolve({ status: response.statusCode, json: () => JSON.parse(text) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ status: 0, error: error.message }));
    req.end(body);
  });
}

/** 20 viewers on each screen, each reading every 100 ms; every result kept with its time. */
function readers() {
  const log = [];
  let stopped = false;
  const screens = { overview: '/api/dashboard/overview?limit=10', controls: '/api/controls?size=5' };
  const workers = Object.entries(screens).flatMap(([screen, path]) => Array.from({ length: 20 }, (_, i) => (async () => {
    for (let n = 0; !stopped; n++) {
      const at = Date.now();
      const { status } = await call(path, { token: tokens.viewers[(i * 40 + (n % 40) + (screen === 'controls' ? 2000 : 0)) % tokens.viewers.length] });
      log.push({ screen, at, ok: status === 200, status });
      await sleep(Math.max(0, 100 - (Date.now() - at)));
    }
  })()));
  return { stop: async () => { stopped = true; await Promise.all(workers); return log; } };
}

function outage(log, screen) {
  const rows = log.filter((r) => r.screen === screen);
  const failed = rows.filter((r) => !r.ok);
  if (!failed.length) return { requests: rows.length, failed: 0, seconds: 0 };
  const statuses = [...new Set(failed.map((r) => r.status))].join('/');
  return { requests: rows.length, failed: failed.length, seconds: +((failed.at(-1).at - failed[0].at) / 1000).toFixed(1), statuses };
}

const waitReady = async (selector, started) => {
  // Until the part is ready again: its pod Ready and the number of ready pods back to what it was.
  for (;;) {
    const pods = JSON.parse(kubectl('get', 'pods', '-l', selector, '-o', 'json').stdout).items;
    const ready = pods.filter((p) => !p.metadata.deletionTimestamp && p.status.containerStatuses?.every((c) => c.ready));
    if (ready.length && ready.length === pods.filter((p) => !p.metadata.deletionTimestamp).length && Date.now() - started > 3000) {
      return +((Date.now() - started) / 1000).toFixed(1);
    }
    await sleep(500);
  }
};

/** SIGKILL to the container's main process from the node: a crash, with no chance to finish anything. */
function crash(app) {
  const pod = kubectl('get', 'pod', '-l', `app=${app}`, '-o', 'jsonpath={.items[0].metadata.name}').stdout;
  const id = node(`crictl ps --label io.kubernetes.pod.name=${pod} -q | head -1`).stdout.trim();
  const pid = node(`crictl inspect --output go-template --template '{{.info.pid}}' ${id}`).stdout.trim();
  node(`kill -9 ${pid}`);
  return pod;
}

const SCENARIOS = [
  ['gateway-kill', 'One Gateway crashes (SIGKILL), 2 running', 'app=gateway', () => crash('gateway')],
  ['risk-service-restart', 'Risk Service restarted (a deploy; 1 replica)', 'app=risk-service', () => kubectl('rollout', 'restart', 'deployment/risk-service')],
  ['control-service-restart', 'Control Service restarted (a deploy; 1 replica)', 'app=control-service', () => kubectl('rollout', 'restart', 'deployment/control-service')],
  ['risk-service-kill', 'Risk Service crashes (SIGKILL)', 'app=risk-service', () => crash('risk-service')],
  ['postgres', 'PostgreSQL pod deleted', 'app=postgres', () => kubectl('delete', 'pod', 'postgres-0', '--wait=false')],
  ['mongo', 'MongoDB pod deleted', 'app=mongo', () => kubectl('delete', 'pod', 'mongo-0', '--wait=false')],
  ['redis', 'Redis pod deleted', 'app=redis', () => kubectl('delete', 'pod', '-l', 'app=redis', '--wait=false')],
];

const results = [];
for (const [key, name, selector, action] of SCENARIOS) {
  if (only && !only.includes(key)) continue;
  console.log(`\n▸ ${name}`);
  const run = readers();
  await sleep(5000);
  const started = Date.now();
  const target = action();
  await sleep(2000);
  const backIn = await waitReady(selector, started);
  await sleep(10_000); // and a while after, to catch late failures
  const log = await run.stop();
  const result = { key, name, target: typeof target === 'string' ? target : undefined, backInSeconds: backIn, overview: outage(log, 'overview'), controls: outage(log, 'controls') };
  results.push(result);
  for (const screen of ['overview', 'controls']) {
    const o = result[screen];
    console.log(`  ${screen.padEnd(8)} ${o.requests} requests, ${o.failed} failed${o.failed ? ` over ${o.seconds} s (${o.statuses})` : ''}`);
  }
  console.log(`  back in ${backIn} s`);
  await sleep(15_000); // let everything settle before the next one
}

if (!only || only.includes('kafka')) {
  console.log('\n▸ Kafka pod deleted while a control is assessed: is the score still updated?');
  const owner = tokens.owners[1];
  const controlOwner = tokens.controlOwners[1];
  const tester = tokens.testers[1];
  const risk = (await call('/api/risks', { method: 'POST', token: owner, body: JSON.stringify({ title: `Kafka outage check ${Date.now()}`, category: 'OPERATIONAL', likelihood: 4, impact: 4, description: 'k8s-failures.mjs' }) })).json();
  const control = (await call('/api/controls', { method: 'POST', token: controlOwner, body: JSON.stringify({ name: `Kafka outage control ${Date.now()}`, type: 'PREVENTIVE', frequency: 'MONTHLY', description: 'k8s-failures.mjs' }) })).json();
  await call(`/api/risks/${risk.id}/controls/${control.id}`, { method: 'POST', token: owner });
  await sleep(5000); // the link reaches the Control Service through Kafka
  const before = (await call(`/api/risks/${risk.id}`, { token: owner })).json().residualScore;
  kubectl('delete', 'pod', 'kafka-0', '--wait=false');
  await sleep(3000);
  const assessed = await call(`/api/controls/${control.id}/assessments`, { method: 'POST', token: tester, body: JSON.stringify({ result: 'EFFECTIVE', evidence: 'Recorded while Kafka was down.', comments: '' }) });
  const started = Date.now();
  const kafkaBack = await waitReady('app=kafka', started - 3000);
  let after = before;
  let updatedIn = null;
  while (Date.now() - started < 180_000) {
    after = (await call(`/api/risks/${risk.id}`, { token: owner })).json().residualScore;
    if (after !== before) { updatedIn = +((Date.now() - started) / 1000).toFixed(1); break; }
    await sleep(1000);
  }
  const result = { key: 'kafka', name: 'Kafka pod deleted; assessment recorded during the outage', assessmentStatus: assessed.status, kafkaBackInSeconds: kafkaBack, residualBefore: before, residualAfter: after, updatedInSeconds: updatedIn };
  results.push(result);
  console.log(`  assessment while Kafka down: ${assessed.status}; Kafka back in ${kafkaBack} s; residual ${before} → ${after}${updatedIn ? ` after ${updatedIn} s` : ' (NOT updated within 3 min)'}`);
}

writeFileSync(join(root, 'load-tests', 'out', only ? `k8s-failures-${only.join('-')}.json` : 'k8s-failures.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
agent.destroy();
process.exit(0);
