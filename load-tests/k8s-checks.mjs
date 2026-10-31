#!/usr/bin/env node
// Checks the platform on Kubernetes (scripts/k8s.mjs) does what deploy/k8s claims, through the HTTPS edge as a
// browser would: every pod ready; the edge's HTTPS and limits; the network policies (a stray pod can reach nothing but
// the edge); no failed requests while the Gateways are restarted or one is deleted under load; the autoscaler adding
// Gateways under load; and live updates costing the services the same with 4 Gateways. Results: load-tests/out/k8s.json
//   node load-tests/make-tokens.mjs 3000 && node load-tests/k8s-checks.mjs [--skip hpa,hub,...]
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Agent, request } from 'node:https';
import { request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = new URL(process.env.EDGE_URL ?? 'https://localhost:8443');
const NS = 'rcp';
const OVERVIEW = '/api/dashboard/overview?limit=10';
const tokens = JSON.parse(readFileSync(join(root, 'load-tests', 'out', 'tokens.json'), 'utf8'));
const skip = (process.argv[process.argv.indexOf('--skip') + 1] ?? '').split(',');
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The edge's certificate is self-signed (scripts/k8s.mjs); this is a local test of the cluster, not of the certificate.
const agent = new Agent({ keepAlive: true, maxSockets: 256, rejectUnauthorized: false });

function record(section, name, ok, detail) {
  results.push({ section, name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function call(path, { method = 'GET', token, body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = request({
      agent, host: EDGE.hostname, port: EDGE.port, path, method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}), ...headers },
      timeout: 15_000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ status: 0, error: error.code ?? error.message }));
    req.end(body);
  });
}

const kubectl = (...args) => spawnSync('kubectl', ['-n', NS, ...args], { encoding: 'utf8' });

/** Viewers reading the Overview as fast as they can until stopped: every status counted. */
function load(concurrency) {
  const counts = {};
  let stopped = false;
  // Each worker rotates through its own 40 users, keeping every user well under the per-user rate limit.
  const workers = Array.from({ length: concurrency }, (_, i) => (async () => {
    for (let n = 0; !stopped; n++) {
      const { status, error } = await call(OVERVIEW, { token: tokens.viewers[(i + concurrency * (n % 40)) % tokens.viewers.length] });
      const key = error ?? String(status);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  })());
  return { counts, stop: async () => { stopped = true; await Promise.all(workers); return counts; } };
}

const summary = (counts) => {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const failed = total - (counts['200'] ?? 0);
  return { total, failed, counts };
};

async function pods() {
  console.log('\nA. Pods');
  const list = JSON.parse(kubectl('get', 'pods', '-o', 'json').stdout).items;
  const notReady = list.filter((pod) => !pod.status.containerStatuses?.every((c) => c.ready));
  record('pods', 'every pod ready', notReady.length === 0, `${list.length - notReady.length}/${list.length} ready (${[...new Set(list.map((p) => p.metadata.labels.app))].join(', ')})`);
  const restarts = list.reduce((sum, pod) => sum + pod.status.containerStatuses.reduce((s, c) => s + c.restartCount, 0), 0);
  record('pods', 'no restarts since start', restarts === 0, `${restarts} restart(s)`);
}

async function edge() {
  console.log('\nB. Edge (HTTPS)');
  const page = await call('/');
  record('edge', 'dashboard served over HTTPS', page.status === 200 && page.text.includes('<div id="root">'), `${page.status}`);
  record('edge', 'HSTS and CSP headers', Boolean(page.headers?.['strict-transport-security'] && page.headers?.['content-security-policy']));
  const anonymous = await call('/api/risks');
  record('edge', 'API needs a token', anonymous.status === 401, `${anonymous.status}`);
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'demo123' }) });
  const token = login.status === 200 ? JSON.parse(login.text).accessToken : null;
  record('edge', 'sign in through the edge', Boolean(token), `${login.status}`);
  const risks = await call('/api/risks?size=1', { token });
  record('edge', 'read the register', risks.status === 200, `${risks.status}, ${risks.status === 200 ? JSON.parse(risks.text).totalElements : '?'} risks`);
  const big = await call('/api/risks', { method: 'POST', token, body: JSON.stringify({ title: 'x'.repeat(300_000) }) });
  record('edge', 'over-size body refused (256 KB)', big.status === 413, `${big.status}`);
  const plain = await new Promise((resolve) => {
    const req = httpRequest({ host: EDGE.hostname, port: EDGE.port, path: '/', timeout: 5000 }, (r) => { r.resume(); resolve(r.statusCode); });
    req.on('error', (e) => resolve(e.code));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
  record('edge', 'plain HTTP redirected to HTTPS, never served', plain === 301, `${plain}`);
}

async function networkPolicies() {
  console.log('\nC. Network policies (from a pod that isn\'t part of the platform, then from the edge)');
  kubectl('delete', 'pod', 'np-probe', '--ignore-not-found', '--wait');
  kubectl('run', 'np-probe', '--image=busybox:1.37.0', '--image-pull-policy=IfNotPresent', '--restart=Never', '--labels=app=np-probe', '--', 'sleep', '600');
  kubectl('wait', '--for=condition=Ready', 'pod/np-probe', '--timeout=120s');
  const reach = (pod, host, port) => kubectl('exec', pod, '--', 'nc', '-z', '-w', '3', host, String(port)).status === 0;
  const targets = [['postgres', 5432], ['mongo', 27017], ['kafka', 29092], ['redis', 6379], ['risk-service', 8081], ['control-service', 8082], ['gateway', 8080]];
  for (const [host, port] of targets) {
    const reached = reach('np-probe', host, port);
    record('network', `stray pod → ${host}:${port} blocked`, !reached, reached ? 'REACHED' : 'blocked');
  }
  const edgeReached = reach('np-probe', 'edge', 8443);
  record('network', 'stray pod → edge:8443 allowed (the probe itself works)', edgeReached, edgeReached ? 'reached' : 'blocked');
  const edgePod = kubectl('get', 'pod', '-l', 'app=edge', '-o', 'jsonpath={.items[0].metadata.name}').stdout;
  const toGateway = reach(edgePod, 'gateway', 8080);
  record('network', 'edge → gateway:8080 allowed', toGateway, toGateway ? 'reached' : 'blocked');
  for (const [host, port] of [['postgres', 5432], ['kafka', 29092], ['risk-service', 8081]]) {
    const reached = reach(edgePod, host, port);
    record('network', `edge → ${host}:${port} blocked`, !reached, reached ? 'REACHED' : 'blocked');
  }
  kubectl('delete', 'pod', 'np-probe', '--wait=false');
}

async function underLoad(name, action) {
  const run = load(40);
  await sleep(5000);
  const started = Date.now();
  await action();
  await sleep(5000);
  const result = summary(await run.stop());
  record('resilience', name, result.failed === 0, `${result.total} requests, ${result.failed} failed ${JSON.stringify(result.counts)}, action took ${((Date.now() - started) / 1000 - 5).toFixed(0)} s`);
  return result;
}

const waitFor = (cmd) => new Promise((resolve) => spawn('kubectl', ['-n', NS, ...cmd], { stdio: 'ignore' }).on('exit', resolve));

async function resilience() {
  console.log('\nD. Gateways replaced under load (40 viewers reading the Overview without pause)');
  const restart = await underLoad('rolling restart of every Gateway: no failed request', async () => {
    kubectl('rollout', 'restart', 'deployment/gateway');
    await waitFor(['rollout', 'status', 'deployment/gateway', '--timeout=5m']);
  });
  const pod = kubectl('get', 'pod', '-l', 'app=gateway', '-o', 'jsonpath={.items[0].metadata.name}').stdout;
  const deletion = await underLoad(`one Gateway deleted (${pod}): no failed request`, async () => {
    await waitFor(['delete', 'pod', pod]);
    await waitFor(['rollout', 'status', 'deployment/gateway', '--timeout=5m']);
  });
  return { restart, deletion };
}

const replicas = () => Number(kubectl('get', 'deployment', 'gateway', '-o', 'jsonpath={.status.readyReplicas}').stdout || 0);

async function autoscaling() {
  console.log('\nE. Autoscaling (heavy load until the HPA adds Gateways, up to 4 minutes)');
  // Start from the minimum: Gateways starting up (after the restarts above) use enough CPU to scale out on their own.
  const settle = Date.now();
  while (replicas() > 2 || Number(kubectl('get', 'deployment', 'gateway', '-o', 'jsonpath={.spec.replicas}').stdout) > 2) {
    if (Date.now() - settle > 300_000) break;
    await sleep(10_000);
  }
  const before = replicas();
  const run = load(150);
  const started = Date.now();
  const timeline = [];
  let peak = before;
  while (Date.now() - started < 240_000) {
    await sleep(10_000);
    const cpu = kubectl('get', 'hpa', 'gateway', '-o', 'jsonpath={.status.currentMetrics[0].resource.current.averageUtilization}').stdout;
    const now = replicas();
    peak = Math.max(peak, now);
    timeline.push({ s: Math.round((Date.now() - started) / 1000), cpu: `${cpu}%`, ready: now });
    console.log(`    ${timeline.at(-1).s}s  cpu ${cpu}% of request  ready gateways ${now}`);
    if (now >= 4) break;
  }
  const result = summary(await run.stop());
  const first = timeline.find((t) => t.ready > before);
  record('autoscaling', 'HPA adds Gateways under load', peak > before, `${before} → ${peak} ready Gateways${first ? `, first added within ${first.s} s` : ''}; ${result.total} requests, ${result.failed} failed`);
  return { before, peak, timeline, load: result };
}

/** Requests the Risk Service has served (all API paths, not health checks), read through a port-forward. */
async function riskRequests(port) {
  const text = await new Promise((resolve) => {
    httpRequest({ host: '127.0.0.1', port, path: '/actuator/prometheus' }, (r) => { let t = ''; r.on('data', (c) => (t += c)); r.on('end', () => resolve(t)); })
      .on('error', () => resolve('')).end();
  });
  return text.split('\n').filter((l) => l.startsWith('http_server_requests_seconds_count') && !l.includes('/actuator'))
    .reduce((sum, l) => sum + Number(l.split(' ').at(-1)), 0);
}

async function hub() {
  console.log('\nF. Live updates with 4 Gateways (shared hub): what the services see');
  kubectl('patch', 'hpa', 'gateway', '-p', '{"spec":{"minReplicas":4}}');
  await waitFor(['rollout', 'status', 'deployment/gateway', '--timeout=5m']);
  while (replicas() < 4) await sleep(2000);
  const forward = spawn('kubectl', ['-n', NS, 'port-forward', 'deployment/risk-service', '19091:9091'], { stdio: 'ignore' });
  await sleep(3000);

  const viewers = 400;
  const streams = [];
  for (let i = 0; i < viewers; i++) {
    const state = { open: false, updates: 0, last: 0 };
    streams.push(state);
    const body = JSON.stringify({ paths: [OVERVIEW, '/api/controls?retestRequired=true&size=1'] });
    const req = request({ agent: new Agent({ rejectUnauthorized: false }), host: EDGE.hostname, port: EDGE.port, path: '/api/live', method: 'POST',
      headers: { Authorization: `Bearer ${tokens.viewers[i]}`, 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Content-Length': Buffer.byteLength(body) },
    }, (response) => {
      state.open = response.statusCode === 200;
      response.on('data', (chunk) => { if (chunk.includes('event:update')) { state.updates++; state.last = Date.now(); } });
      response.on('end', () => (state.open = false));
    });
    req.on('error', () => (state.open = false));
    req.end(body);
    if (i % 50 === 49) await sleep(200);
  }
  await sleep(5000);
  const before = await riskRequests(19091);
  const holdSeconds = 60;
  const latencies = [];
  const owner = tokens.owners[0];
  for (let t = 0; t < holdSeconds / 5; t++) {
    const sent = Date.now();
    await call('/api/risks', { method: 'POST', token: owner, body: JSON.stringify({ title: `k8s hub check ${sent}`, category: 'OPERATIONAL', likelihood: 1 + (t % 5), impact: 2, description: 'k8s-checks.mjs' }) });
    await sleep(5000);
    const reached = streams.filter((s) => s.last >= sent);
    latencies.push(...reached.map((s) => s.last - sent));
  }
  const after = await riskRequests(19091);
  const open = streams.filter((s) => s.open).length;
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? null;
  const rate = (after - before) / holdSeconds;
  const delivered = latencies.length / (viewers * (holdSeconds / 5));
  record('hub', `${viewers} live viewers across 4 Gateways: Risk Service load stays flat`, rate < 5, `${rate.toFixed(2)} req/s at the Risk Service (incl. the writer's 0.2/s); ${open}/${viewers} streams open; ${(delivered * 100).toFixed(1)}% of changes delivered, p95 ${p95} ms`);
  forward.kill();
  agent.destroy();
  kubectl('patch', 'hpa', 'gateway', '-p', '{"spec":{"minReplicas":2}}');
  return { viewers, gateways: 4, riskServiceReqPerSec: rate, open, delivered, p95 };
}

const report = { at: new Date().toISOString() };
if (!skip.includes('pods')) await pods();
if (!skip.includes('edge')) await edge();
if (!skip.includes('network')) await networkPolicies();
if (!skip.includes('resilience')) report.resilience = await resilience();
if (!skip.includes('hpa')) report.autoscaling = await autoscaling();
if (!skip.includes('hub')) report.hub = await hub();
report.results = results;
writeFileSync(join(root, 'load-tests', 'out', 'k8s.json'), JSON.stringify(report, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
