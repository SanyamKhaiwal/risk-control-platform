#!/usr/bin/env node
// The legitimate path still works with signed events: Carol records "Doesn't work" on MFA, and the linked risk rises.
// Runs from a container on the isolated copy's network (see kafka-forgery.mjs).
const G = process.env.GATEWAY_URL ?? 'http://gateway:8080';
const login = async (u) => (await (await fetch(`${G}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'demo123' }) })).json()).accessToken;
const carol = await login('carol');
const api = async (path, init = {}) => (await fetch(G + path, { ...init, headers: { Authorization: `Bearer ${carol}`, 'Content-Type': 'application/json' } })).json();

const mfa = (await api('/api/controls?size=100')).content.find((c) => c.name === 'MFA on admin accounts');
const risk = (await api('/api/risks?size=100')).content.find((r) => r.title === 'Account takeover of privileged users');
console.log(`before: ${risk.residualScore} ${risk.rating}`);
const result = await api(`/api/controls/${mfa.id}/assessments`, { method: 'POST', body: JSON.stringify({ result: 'INEFFECTIVE', evidence: '[security test] signed-event check' }) });
console.log(`recorded: ${result.result ?? JSON.stringify(result)}`);
const start = Date.now();
for (;;) {
  const now = await api(`/api/risks/${risk.id}`);
  if (now.residualScore !== risk.residualScore || Date.now() - start > 10000) {
    console.log(`after ${Date.now() - start} ms: ${now.residualScore} ${now.rating}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
