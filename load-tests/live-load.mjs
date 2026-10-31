#!/usr/bin/env node
// Load test for live updates (the Gateway's /api/live stream, docs/performance.md): opens one stream per simulated
// viewer, each watching the Overview and the re-test count as the dashboard does, then every 5 seconds a writer adds
// a risk, which always changes the Overview. Measures how long each change takes to reach the viewers and how many
// streams stay open. Runs from a container on the copy's network (load-tests/run.mjs --live <viewers,...>).
//   node live-load.mjs <viewers> <hold seconds>
import { readFileSync, writeFileSync } from 'node:fs';
import { Agent, request } from 'node:http';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://gateway:8080';
const viewers = Number(process.argv[2] ?? 500);
const holdSeconds = Number(process.argv[3] ?? 60);
const tokens = JSON.parse(readFileSync('/load/out/tokens.json', 'utf8'));
const OVERVIEW = '/api/dashboard/overview?limit=10';
const PATHS = [OVERVIEW, '/api/controls?retestRequired=true&size=1'];

// One connection per stream, as browsers have; no limit on how many.
const agent = new Agent({ keepAlive: true, maxSockets: Infinity });
const gateway = new URL(GATEWAY);

const streams = [];
let opened = 0;
let failed = 0;
let closedEarly = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function open(i) {
  const state = { lastOverviewAt: 0, updates: 0, open: false };
  streams.push(state);
  const body = JSON.stringify({ paths: PATHS });
  const req = request({
    agent, host: gateway.hostname, port: gateway.port, path: '/api/live', method: 'POST',
    headers: { Authorization: `Bearer ${tokens.viewers[i % tokens.viewers.length]}`, 'Content-Type': 'application/json',
      Accept: 'text/event-stream', 'Content-Length': Buffer.byteLength(body) },
  }, (response) => {
    if (response.statusCode !== 200) {
      failed++;
      response.resume();
      return;
    }
    state.open = true;
    opened++;
    response.setEncoding('utf8');
    let buffer = '';
    response.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (frame.includes('event:update') && frame.includes(`"path":"${OVERVIEW}"`)) {
          state.lastOverviewAt = performance.now();
          state.updates++;
        }
      }
    });
    response.on('end', () => {
      state.open = false;
      closedEarly++;
    });
  });
  req.on('error', () => {
    if (state.open) closedEarly++;
    else failed++;
    state.open = false;
  });
  req.end(body);
}

const started = performance.now();
for (let i = 0; i < viewers; i++) {
  open(i);
  if (i % 50 === 49) await sleep(100); // ramp up: about 500 new streams a second
}
await sleep(3000);
const openAfterRamp = streams.filter((s) => s.open).length;
console.log(`opened ${opened} of ${viewers} streams in ${((performance.now() - started) / 1000).toFixed(1)} s (${failed} refused)`);

// Changes: one new risk every 5 s; how long until each open viewer has the new Overview?
const delays = [];
let missed = 0;
const rounds = Math.max(1, Math.floor(holdSeconds / 5));
for (let r = 0; r < rounds; r++) {
  const before = streams.map((s) => s.lastOverviewAt);
  const t0 = performance.now();
  const created = await fetch(`${GATEWAY}/api/risks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.owners[r % tokens.owners.length]}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `Live load test risk ${r}`, category: 'OPERATIONAL', likelihood: 1 + (r % 5), impact: 1 + ((r * 2) % 5) }),
  });
  if (created.status !== 201) console.log(`  write ${r} failed: ${created.status}`);
  await sleep(5000);
  streams.forEach((s, i) => {
    if (!s.open) return;
    if (s.lastOverviewAt > before[i] && s.lastOverviewAt >= t0) delays.push(s.lastOverviewAt - t0);
    else missed++;
  });
}

const sorted = delays.sort((a, b) => a - b);
const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
const result = {
  viewers,
  opened,
  refused: failed,
  openAfterRamp,
  stillOpen: streams.filter((s) => s.open).length,
  closedEarly,
  changes: rounds,
  delivered: sorted.length,
  missed,
  deliveryP50ms: pct(50),
  deliveryP95ms: pct(95),
  deliveryP99ms: pct(99),
  deliveryMaxms: sorted.at(-1) ?? null,
};
writeFileSync(`/load/out/live-${viewers}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exit(0);
