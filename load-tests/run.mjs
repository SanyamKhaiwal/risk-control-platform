#!/usr/bin/env node
// Runs the load test end to end and prints a results table (also saved to load-tests/out/results-*.json):
//   1. stops the normal stack (it would share the CPUs; its data is kept), starts a throwaway copy with monitoring
//      on http://localhost:3001 (Grafana) and :9091 (Prometheus), and fills it with a realistic register
//   2. runs k6 at each level of concurrent users, sampling every container's CPU and memory and reading the key
//      numbers from Prometheus
//   3. starts the normal stack again (pass --keep to leave the copy running for a look in Grafana)
//
//   node load-tests/run.mjs [--levels 100,250,500,1000] [--hold 2m] [--signins 10,20,40] [--keep] [--fresh]
//                           [--compose-extra load-tests/variants/<file>.yaml,...] [--cooldown 60] [--k6-cpus 1]
//                           [--live 1000,2000] [--pattern before]   (live-update streams; the old 5-request Overview)
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const levels = arg('levels', '100,250,500,1000').split(',').filter(Boolean).map(Number);
const liveLevels = arg('live', '').split(',').filter(Boolean).map(Number); // viewers on live-update streams
const signinRates = arg('signins', '10,20,40').split(',').filter(Boolean).map(Number);
const hold = arg('hold', '2m');
const cooldownMs = Number(arg('cooldown', '10')) * 1000; // between levels, so a laptop's CPU turbo recovers
const k6Cpus = arg('k6-cpus', '2');
const PROJECT = 'rcp-load';
const NETWORK = `${PROJECT}_default`;
const K6 = 'grafana/k6:1.2.3';
const NODE = 'node:22.23.4-alpine3.24';
const PROMETHEUS = 'http://localhost:9091';
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const compose = ['compose', '-p', PROJECT, '-f', 'compose.yaml', '-f', 'security/compose.isolated.yaml', '-f', 'load-tests/compose.loadtest.yaml'];
// --compose-extra <file>: one more override, e.g. to compare JVM settings (load-tests/variants/).
// Several may be given, comma-separated, applied in order.
for (const file of (arg('compose-extra') ?? '').split(',').filter(Boolean)) compose.push('-f', file);
const out = join(root, 'load-tests', 'out');
mkdirSync(out, { recursive: true });

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return r;
};
const step = (text) => console.log(`\n▸ ${text}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const prom = async (query) => {
  const r = await fetch(`${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(query)}`).then((x) => x.json()).catch(() => null);
  return r?.data?.result ?? [];
};
const promValue = async (query) => {
  const v = Number((await prom(query))[0]?.value[1]);
  return Number.isFinite(v) ? v : null;
};

/** Samples `docker stats` every few seconds until stopped; returns average and peak CPU and peak memory per container. */
function sampleStats() {
  const samples = {};
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      await new Promise((resolve) => {
        const p = spawn('docker', ['stats', '--no-stream', '--format', '{{json .}}'], { env });
        let text = '';
        p.stdout.on('data', (d) => (text += d));
        p.on('close', () => {
          for (const line of text.split('\n').filter(Boolean)) {
            const s = JSON.parse(line);
            if (!s.Name.startsWith(`${PROJECT}-`)) continue;
            const name = s.Name.replace(`${PROJECT}-`, '').replace(/-1$/, '');
            const mem = s.MemUsage.split('/')[0].trim();
            const mib = parseFloat(mem) * (mem.includes('GiB') ? 1024 : mem.includes('KiB') ? 1 / 1024 : 1);
            (samples[name] ??= []).push({ cpu: parseFloat(s.CPUPerc), mib });
          }
          resolve();
        });
      });
      await sleep(3000);
    }
  })();
  return async () => {
    stopped = true;
    await loop;
    return Object.fromEntries(Object.entries(samples).map(([name, xs]) => [name, {
      cpuAvg: xs.reduce((a, x) => a + x.cpu, 0) / xs.length,
      cpuPeak: Math.max(...xs.map((x) => x.cpu)),
      memPeakMiB: Math.max(...xs.map((x) => x.mib)),
    }]));
  };
}

function k6(script, vars, summaryName) {
  const args = ['run', '--rm', '--network', NETWORK, '--cpus', k6Cpus, '-v', `${join(root, 'load-tests')}:/load`];
  for (const [k, v] of Object.entries(vars)) args.push('-e', `${k}=${v}`);
  args.push(K6, 'run', '--quiet', '--summary-export', `/load/out/${summaryName}.json`, `/load/${script}`);
  return new Promise((resolve) => {
    const p = spawn('docker', args, { cwd: root, env });
    let text = '';
    p.stdout.on('data', (d) => (text += d));
    p.stderr.on('data', (d) => (text += d));
    p.on('close', (code) => resolve({ code, text }));
  });
}

const results = { startedAt: new Date().toISOString(), hold, levels: [], signins: [] };
try {
  step('Stopping the normal stack while the test runs (its data is kept)');
  run('docker', ['compose', 'stop'], { allowFail: true });

  if (process.argv.includes('--fresh')) run('docker', [...compose, 'down', '-v'], { allowFail: true });
  step('Starting the throwaway copy (Grafana http://localhost:3001)');
  run('docker', [...compose, 'up', '-d', '--wait']);

  step('Sign-in tokens and a realistic register (500 risks, 300 controls)');
  const maxUsers = Math.max(0, ...levels, ...liveLevels.map((n) => Math.ceil(n / 0.8)));
  console.log(`  ${run(process.execPath, [join(root, 'load-tests', 'make-tokens.mjs'), String(Math.max(maxUsers, 200))]).stdout.trim()}`);
  console.log(`  ${run('docker', ['run', '--rm', '--network', NETWORK, '-v', `${join(root, 'load-tests')}:/load`, NODE, 'node', '/load/seed-volume.mjs']).stdout.trim()}`);

  for (const users of levels) {
    step(`${users} concurrent users for ${hold} (after a 30 s ramp-up)`);
    await sleep(cooldownMs); // let the previous level drain and the CPU cool down
    const stop = sampleStats();
    const t0 = Date.now();
    const { text } = await k6('users.js', { USERS: users, HOLD: hold, PATTERN: arg('pattern', 'now') }, `users-${users}`);
    const window = `${Math.round((Date.now() - t0) / 1000)}s`;
    const stats = await stop();
    const summary = JSON.parse((await import('node:fs')).readFileSync(join(out, `users-${users}.json`), 'utf8'));
    const d = summary.metrics.http_req_duration;
    const level = {
      users,
      requestsPerSecond: summary.metrics.http_reqs.rate,
      p50ms: d['p(50)'], p95ms: d['p(95)'], p99ms: d['p(99)'], maxms: d.max,
      errorRate: summary.metrics.http_req_failed.value,
      screenRefreshP95ms: summary.metrics.screen_refresh?.['p(95)'],
      testToScoreP95ms: (await promValue(`histogram_quantile(0.95, sum by (le) (rate(rcp_assessment_to_rescore_seconds_bucket[${window}])))`)) * 1000,
      outboxPendingMax: await promValue(`max(max_over_time(rcp_outbox_pending[${window}]))`),
      kafkaLagMax: await promValue(`max(max_over_time(kafka_consumer_fetch_manager_records_lag_max[${window}]))`),
      gatewayStatuses: Object.fromEntries((await prom(`sum by (status) (increase(http_server_requests_seconds_count{job="gateway",uri!~"/actuator.*"}[${window}]))`))
        .map((r) => [r.metric.status, Math.round(Number(r.value[1]))])),
      containers: stats,
      // CPU time one request costs each container, in ms of one core: what carries over to other hardware.
      cpuMsPerRequest: Object.fromEntries(Object.entries(stats).map(([n, s]) => [n, (s.cpuAvg / 100) * 1000 / summary.metrics.http_reqs.rate])),
      passed: d['p(95)'] < 500 && summary.metrics.http_req_failed.value < 0.01,
    };
    results.levels.push(level);
    const busiest = Object.entries(stats).sort((a, b) => b[1].cpuAvg - a[1].cpuAvg).slice(0, 3).map(([n, s]) => `${n} ${s.cpuAvg.toFixed(0)}%`).join(', ');
    console.log(`  ${level.requestsPerSecond.toFixed(0)} req/s · p50 ${level.p50ms.toFixed(0)} ms · p95 ${level.p95ms.toFixed(0)} ms · p99 ${level.p99ms.toFixed(0)} ms · errors ${(level.errorRate * 100).toFixed(2)}% · ${level.passed ? 'PASS' : 'FAIL'}`);
    console.log(`  busiest containers (avg CPU, 100% = one core): ${busiest}`);
    const cost = ['gateway', 'risk-service', 'control-service', 'mongo', 'postgres', 'redis', 'kafka']
      .filter((n) => level.cpuMsPerRequest[n] !== undefined).map((n) => `${n} ${level.cpuMsPerRequest[n].toFixed(2)}`).join(', ');
    console.log(`  CPU per request (ms of one core): ${cost}`);
    if (!level.passed && text.includes('level=error')) console.log(text.split('\n').filter((l) => l.includes('level=error')).slice(0, 3).join('\n'));
  }

  for (const viewers of liveLevels) {
    step(`Live updates: ${viewers} viewers on streams, a change every 5 s, for ${hold}`);
    await sleep(cooldownMs);
    const stop = sampleStats();
    const t0 = Date.now();
    const holdSeconds = parseInt(hold, 10) * (hold.endsWith('m') ? 60 : 1);
    const r = run('docker', ['run', '--rm', '--network', NETWORK, '--cpus', k6Cpus, '-v', `${join(root, 'load-tests')}:/load`, NODE,
      'node', '--max-old-space-size=1024', '/load/live-load.mjs', String(viewers), String(holdSeconds)], { allowFail: true });
    const window = `${Math.round((Date.now() - t0) / 1000)}s`;
    const stats = await stop();
    const lines = r.stdout.trim().split(/\r?\n/);
    console.log(lines.map((l) => `  ${l}`).join('\n'));
    const serviceRps = await promValue(`sum(rate(http_server_requests_seconds_count{job=~"risk-service|control-service",uri!~"/actuator.*"}[${window}]))`);
    const connections = await promValue(`max(max_over_time(rcp_live_connections[${window}]))`);
    const busiest = Object.entries(stats).sort((a, b) => b[1].cpuAvg - a[1].cpuAvg).slice(0, 3).map(([n, s]) => `${n} ${s.cpuAvg.toFixed(0)}%`).join(', ');
    console.log(`  services answered ${serviceRps?.toFixed(1)} req/s in total; Gateway held up to ${connections} streams; gateway memory peak ${stats.gateway?.memPeakMiB.toFixed(0)} MiB`);
    console.log(`  busiest containers (avg CPU): ${busiest}`);
    results.live = [...(results.live ?? []), { viewers, serviceRps, connections, containers: stats, output: lines.at(-1) }];
  }

  for (const rate of signinRates) {
    step(`Sign-ins: ${rate} a second for 1 minute`);
    await sleep(5000);
    const stop = sampleStats();
    await k6('signins.js', { RATE: rate, HOLD: '1m' }, `signins-${rate}`);
    const stats = await stop();
    const summary = JSON.parse((await import('node:fs')).readFileSync(join(out, `signins-${rate}.json`), 'utf8'));
    const d = summary.metrics.http_req_duration;
    const entry = { rate, achieved: summary.metrics.http_reqs.rate, p50ms: d['p(50)'], p95ms: d['p(95)'], gatewayCpuAvg: stats.gateway?.cpuAvg };
    results.signins.push(entry);
    console.log(`  achieved ${entry.achieved.toFixed(1)}/s · p50 ${entry.p50ms.toFixed(0)} ms · p95 ${entry.p95ms.toFixed(0)} ms · gateway CPU ${entry.gatewayCpuAvg?.toFixed(0)}%`);
  }
} finally {
  const file = join(out, `results-${results.startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`\nResults: ${file}`);
  if (!process.argv.includes('--keep')) {
    step('Stopping the copy and starting the normal stack again');
    run('docker', [...compose, 'stop'], { allowFail: true });
    run('docker', ['compose', 'up', '-d', '--wait'], { allowFail: true });
  } else {
    console.log('  The copy is still running (Grafana http://localhost:3001). Afterwards: node load-tests/run.mjs --levels "" --signins ""');
  }
}
