#!/usr/bin/env node
// Fills the throwaway copy with a register of realistic size: 300 controls (each tested once) and 500 risks, each
// linked to 1–3 controls. Query speed depends on data volume; the 15-risk demo register would flatter the results.
// Runs from a container on the copy's network (load-tests/run.mjs does this).
import { readFileSync } from 'node:fs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://gateway:8080';
const tokens = JSON.parse(readFileSync(process.argv[2] ?? '/load/out/tokens.json', 'utf8'));
const CONTROLS = 300;
const RISKS = 500;
const categories = ['OPERATIONAL', 'CYBER', 'FRAUD', 'COMPLIANCE', 'FINANCIAL', 'THIRD_PARTY'];
const types = ['PREVENTIVE', 'DETECTIVE', 'CORRECTIVE'];
const results = ['EFFECTIVE', 'EFFECTIVE', 'PARTIALLY_EFFECTIVE', 'INEFFECTIVE'];
const pick = (list, i) => list[i % list.length];

async function call(method, path, token, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(GATEWAY + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429 && attempt < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }
}

// Spread the work over many users, so each stays under the Gateway's 20 requests a second per user.
async function inParallel(count, worker, width = 20) {
  const out = new Array(count);
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < count) {
      const i = next++;
      out[i] = await worker(i);
    }
  }));
  return out;
}

const existing = await call('GET', '/api/risks?size=1', tokens.viewers[0]);
if (existing.totalElements >= RISKS) {
  console.log(`register already has ${existing.totalElements} risks; not seeding`);
  process.exit(0);
}
const started = Date.now();
const controls = await inParallel(CONTROLS, (i) => call('POST', '/api/controls', pick(tokens.controlOwners, i), {
  name: `Load control ${i + 1}`, description: 'Synthetic control for load testing.', type: pick(types, i), frequency: 'QUARTERLY',
}));
await inParallel(CONTROLS, (i) => call('POST', `/api/controls/${controls[i].id}/assessments`, pick(tokens.testers, i), {
  result: pick(results, i), evidence: 'Synthetic test for load testing.',
}));
await inParallel(RISKS, async (i) => {
  const owner = pick(tokens.owners, i);
  const risk = await call('POST', '/api/risks', owner, {
    title: `Load risk ${i + 1}`, description: 'Synthetic risk for load testing.', category: pick(categories, i),
    likelihood: 1 + (i % 5), impact: 1 + ((i * 3) % 5),
  });
  for (let k = 0; k <= i % 3; k++) await call('POST', `/api/risks/${risk.id}/controls/${controls[(i * 7 + k * 31) % CONTROLS].id}`, owner);
});
console.log(`seeded ${CONTROLS} controls and ${RISKS} risks in ${((Date.now() - started) / 1000).toFixed(0)} s`);
