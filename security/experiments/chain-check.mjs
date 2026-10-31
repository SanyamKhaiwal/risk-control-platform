#!/usr/bin/env node
// Prints /verify for every control in the isolated copy (as the viewer Dave).
const G = process.env.GATEWAY_URL ?? 'http://gateway:8080';
const t = (await (await fetch(`${G}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'dave', password: 'demo123' }) })).json()).accessToken;
const get = async (p) => (await fetch(G + p, { headers: { Authorization: `Bearer ${t}` } })).json();
const counts = {};
for (const c of (await get('/api/controls?size=100')).content) {
  const v = await get(`/api/controls/${c.id}/assessments/verify`);
  const key = v.valid ? 'valid' : `broken (${v.reason})`;
  counts[key] = (counts[key] ?? 0) + 1;
}
console.log(JSON.stringify(counts));
