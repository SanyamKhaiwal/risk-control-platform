#!/usr/bin/env node
// Manual penetration tests, scripted so they can be re-run after every fix. Run against the Docker stack:
//   node security/attack-tests.mjs
// Each check states what an attacker tries and what a secure system must answer. Exit code 1 if any check fails.
// Sections A–D attack through the network; E attacks what sits behind the Gateway from the same machine (Kafka,
// Redis, MongoDB, via docker exec); F opens the dashboard in a real browser (set PLAYWRIGHT_CORE to playwright-core).
// Leaves a few closed risks and a control named "[security test]" behind (they can be closed, not deleted).
//
// Tokens for extra legitimate users (a second risk owner) are signed with the dev key in deploy/keys, standing in
// for that person signing in. Forged tokens never use it.

import { spawnSync } from 'node:child_process';
import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const RISK = process.env.RISK_SERVICE_URL ?? 'http://localhost:8081';
const CONTROL = process.env.CONTROL_SERVICE_URL ?? 'http://localhost:8082';
const DASHBOARD = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
const privateKey = readFileSync(join(root, 'deploy', 'keys', 'jwt-private.pem'), 'utf8');
const publicKey = readFileSync(join(root, 'deploy', 'keys', 'jwt-public.pem'), 'utf8');

const results = [];
let section = '';
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function check(name, ok, detail) {
  results.push({ section, name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function call(base, path, { method = 'GET', token, body, headers = {}, raw } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  }).catch((error) => ({ status: 0, headers: new Headers(), text: async () => String(error) }));
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, headers: response.headers, text, json };
}

function rs256(claims, key = privateKey, header = { alg: 'RS256', typ: 'JWT' }) {
  const input = `${b64(header)}.${b64(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

const now = () => Math.floor(Date.now() / 1000);
const claimsFor = (sub, roles, extra = {}) => ({ iss: 'rcp-gateway', sub, roles, iat: now(), exp: now() + 600, jti: randomUUID(), ...extra });

async function login(username, password = 'demo123') {
  const r = await call(GATEWAY, '/api/auth/login', { method: 'POST', body: { username, password } });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${r.text}`);
  return r.json.accessToken;
}

const is = (status, ...expected) => expected.includes(status);
const docker = (args, input) => spawnSync('docker', args, { cwd: root, encoding: 'utf8', input, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const restarts = async (service) => Number(docker(['inspect', `risk-control-platform-${service}-1`, '--format', '{{.RestartCount}}']).stdout.trim());

/** POSTs a body with Transfer-Encoding: chunked (no Content-Length) and returns the status code. */
function chunked(url, token, body) {
  return new Promise((resolve) => {
    const request = httpRequest(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', (error) => resolve(`error ${error.code}`));
    request.write(body.slice(0, 5));
    request.end(body.slice(5));
  });
}
const noLeak = (r) => !/Exception|\bat [a-z]+\.[a-z]+\.|org\.springframework|java\.|stack/i.test(r.text);

// ---------------------------------------------------------------------------------------------------------------
const TOKENS = Object.fromEntries(await Promise.all(['alice', 'bob', 'carol', 'dave', 'erin'].map(async (u) => [u, await login(u)])));

section = 'A. Authentication';
console.log(`\n${section}`);
{
  const alice = TOKENS.alice;
  const protectedPath = '/api/risks?size=1';

  let r = await call(GATEWAY, protectedPath);
  check('No token is refused', r.status === 401, `${r.status}`);

  r = await call(GATEWAY, protectedPath, { token: 'not-a-token' });
  check('Garbage token is refused', r.status === 401, `${r.status}`);

  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claimsFor('alice', ['RISK_OWNER']))}.`;
  r = await call(GATEWAY, protectedPath, { token: none });
  check('Unsigned token (alg "none") is refused', r.status === 401, `${r.status}`);

  // Algorithm confusion: sign with HMAC using the public key as the secret.
  const hsInput = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claimsFor('alice', ['RISK_OWNER']))}`;
  const hs = `${hsInput}.${createHmac('sha256', publicKey).update(hsInput).digest('base64url')}`;
  r = await call(GATEWAY, protectedPath, { token: hs });
  check('HS256 token signed with the public key is refused', r.status === 401, `${r.status}`);

  const attackerPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const attacker = attackerPair.privateKey;
  r = await call(GATEWAY, protectedPath, { token: rs256(claimsFor('alice', ['RISK_OWNER']), attacker) });
  check("Token signed with an attacker's key is refused", r.status === 401, `${r.status}`);

  // Header tricks: point the verifier at the attacker's own key, or at a file whose content is known.
  const attackerJwk = attackerPair.publicKey.export({ format: 'jwk' });
  const tricks = {
    'embedded key (jwk)': rs256(claimsFor('alice', ['RISK_OWNER']), attacker, { alg: 'RS256', typ: 'JWT', jwk: attackerJwk }),
    'key URL (jku)': rs256(claimsFor('alice', ['RISK_OWNER']), attacker, { alg: 'RS256', typ: 'JWT', jku: 'https://evil.example/jwks.json' }),
    'certificate URL (x5u)': rs256(claimsFor('alice', ['RISK_OWNER']), attacker, { alg: 'RS256', typ: 'JWT', x5u: 'https://evil.example/cert.pem' }),
  };
  const kidInput = `${b64({ alg: 'HS256', typ: 'JWT', kid: '../../../../../../dev/null' })}.${b64(claimsFor('alice', ['RISK_OWNER']))}`;
  tricks['key id path traversal (kid → /dev/null, empty HMAC key)'] = `${kidInput}.${createHmac('sha256', '').update(kidInput).digest('base64url')}`;
  const trickResults = [];
  for (const [name, token] of Object.entries(tricks)) {
    for (const base of [GATEWAY, RISK]) trickResults.push([name, (await call(base, protectedPath, { token })).status]);
  }
  check('Token header tricks (jwk, jku, x5u, kid traversal) are refused at the Gateway and the services',
    trickResults.every(([, status]) => status === 401), [...new Set(trickResults.map(([n, s]) => `${n}: ${s}`))].join('; '));

  // Take a real token and give yourself more roles.
  const [h, , s] = alice.split('.');
  const realClaims = JSON.parse(Buffer.from(alice.split('.')[1], 'base64url'));
  const tampered = `${h}.${b64({ ...realClaims, roles: ['RISK_OWNER', 'CONTROL_OWNER', 'CONTROL_TESTER'] })}.${s}`;
  r = await call(GATEWAY, protectedPath, { token: tampered });
  check('Real token with edited roles is refused', r.status === 401, `${r.status}`);

  r = await call(GATEWAY, protectedPath, { token: rs256(claimsFor('alice', ['RISK_OWNER'], { iat: now() - 7200, exp: now() - 3600 })) });
  check('Expired token is refused', r.status === 401, `${r.status}`);

  r = await call(GATEWAY, protectedPath, { token: rs256(claimsFor('alice', ['RISK_OWNER'], { iss: 'someone-else' })) });
  check('Token from another issuer is refused', r.status === 401, `${r.status}`);

  for (const [name, base] of [['Risk Service', RISK], ['Control Service', CONTROL]]) {
    const path = base === RISK ? '/api/risks?size=1' : '/api/controls?size=1';
    r = await call(base, path, { token: rs256(claimsFor('alice', ['RISK_OWNER']), attacker) });
    const r2 = await call(base, path, { token: none });
    check(`${name} called directly (skipping the Gateway) still refuses forged tokens`, r.status === 401 && r2.status === 401, `${r.status}, ${r2.status}`);
  }

  r = await call(GATEWAY, protectedPath, { token: alice });
  check('A genuine token works (control check)', r.status === 200, `${r.status}`);

  const wrong = await call(GATEWAY, '/api/auth/login', { method: 'POST', body: { username: 'alice', password: 'wrong' } });
  const unknown = await call(GATEWAY, '/api/auth/login', { method: 'POST', body: { username: `nobody-${randomUUID().slice(0, 8)}`, password: 'wrong' } });
  check(
    'Wrong password and unknown user get the same answer (no username discovery)',
    wrong.status === 401 && unknown.status === 401 && wrong.json?.detail === unknown.json?.detail,
    `${wrong.status} "${wrong.json?.detail}" / ${unknown.status} "${unknown.json?.detail}"`,
  );

  // Timing: compare wrong passwords for a real user with attempts for users that don't exist. If the server skipped
  // the bcrypt check for unknown users they would be several times faster. Medians, to ignore one-off pauses.
  const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const attempt = async (username) => {
    const start = performance.now();
    await call(GATEWAY, '/api/auth/login', { method: 'POST', body: { username, password: 'wrong-password' } });
    return performance.now() - start;
  };
  const known = [];
  const ghost = [];
  for (let i = 0; i < 4; i++) {
    known.push(await attempt('bob'));
    ghost.push(await attempt(`ghost-${randomUUID().slice(0, 8)}`));
  }
  const ratio = median(ghost) / median(known);
  check(
    'Unknown users take as long as real ones (no username discovery by timing)',
    ratio > 0.6 && ratio < 1.6,
    `real user ${median(known).toFixed(0)} ms, unknown user ${median(ghost).toFixed(0)} ms (ratio ${ratio.toFixed(2)})`,
  );

  const victim = `victim-${randomUUID().slice(0, 6)}`;
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await call(GATEWAY, '/api/auth/login', { method: 'POST', body: { username: victim, password: `guess${i}` } })).status);
  check('Password guessing on one account is slowed down (11th try in a minute → 429)', statuses.slice(0, 10).every((x) => x === 401) && statuses[10] === 429, statuses.join(','));

}

// ---------------------------------------------------------------------------------------------------------------
section = 'B. Authorisation';
console.log(`\n${section}`);
let testRiskId;
const extraRisks = [];
{
  const { alice, bob, carol, dave, erin } = TOKENS;
  const mallory = rs256(claimsFor('mallory', ['RISK_OWNER'])); // a second, legitimate risk owner
  const riskBody = { title: 'x', category: 'CYBER', likelihood: 3, impact: 3 };

  let r = await call(GATEWAY, '/api/risks', { method: 'POST', token: dave, body: riskBody });
  check('Viewer cannot create a risk', r.status === 403, `${r.status}`);
  r = await call(GATEWAY, '/api/risks', { method: 'POST', token: carol, body: riskBody });
  check('Tester cannot create a risk', r.status === 403, `${r.status}`);
  r = await call(GATEWAY, '/api/controls', { method: 'POST', token: alice, body: { name: 'x', type: 'PREVENTIVE', frequency: 'MONTHLY' } });
  check('Risk owner cannot create a control', r.status === 403, `${r.status}`);

  const controls = (await call(GATEWAY, '/api/controls?size=100', { token: dave })).json.content;
  const erinControl = controls.find((c) => c.owner === 'erin');
  const bobControl = controls.find((c) => c.owner === 'bob');
  r = await call(GATEWAY, `/api/controls/${bobControl.id}/assessments`, { method: 'POST', token: bob, body: { result: 'EFFECTIVE' } });
  check('Control owner without the tester role cannot record a test', r.status === 403, `${r.status}`);
  r = await call(GATEWAY, `/api/controls/${erinControl.id}/assessments`, { method: 'POST', token: erin, body: { result: 'EFFECTIVE', evidence: 'self-assessed' } });
  check('Segregation of duties: Erin cannot test her own control', r.status === 403, `${r.status} ${r.json?.detail ?? ''}`);
  r = await call(GATEWAY, `/api/controls/${erinControl.id}`, {
    method: 'PUT',
    token: bob,
    body: { name: 'hijacked', description: '', frequency: erinControl.frequency, version: erinControl.version },
  });
  check("Bob cannot edit Erin's control", r.status === 403, `${r.status}`);

  // Mass assignment: send fields the server should decide itself.
  r = await call(GATEWAY, '/api/risks', {
    method: 'POST',
    token: alice,
    body: {
      title: '[security test] <img src=x onerror=alert(1)><script>alert(1)</script>',
      description: "'; DROP TABLE risk; --",
      category: 'CYBER',
      likelihood: 5,
      impact: 5,
      owner: 'dave',
      inherentScore: 1,
      residualScore: 1,
      rating: 'LOW',
      status: 'CLOSED',
      id: '00000000-0000-0000-0000-000000000001',
    },
  });
  testRiskId = r.json?.id;
  check(
    'Extra fields are ignored: owner, score, rating, status and id come from the server',
    r.status === 201 && r.json.owner === 'alice' && r.json.residualScore === 25 && r.json.rating === 'CRITICAL' && r.json.status === 'OPEN' && !r.json.id.startsWith('00000000'),
    `owner ${r.json?.owner}, score ${r.json?.residualScore} ${r.json?.rating}, status ${r.json?.status}`,
  );
  check('Script tags are stored as given, as plain text (section F checks that the browser never runs them)', r.json?.title?.includes('<script>'), 'stored unchanged');

  r = await call(GATEWAY, `/api/risks/${testRiskId}`, { method: 'PUT', token: mallory, body: { ...riskBody, title: 'taken over', version: 0 } });
  check("Another risk owner cannot edit Alice's risk", r.status === 403, `${r.status}`);
  r = await call(GATEWAY, `/api/risks/${testRiskId}/status`, { method: 'PATCH', token: mallory, body: { status: 'CLOSED', version: 0 } });
  check("Another risk owner cannot close Alice's risk", r.status === 403, `${r.status}`);
  r = await call(GATEWAY, `/api/risks/${testRiskId}/controls/${bobControl.id}`, { method: 'POST', token: mallory });
  check("Another risk owner cannot link controls to Alice's risk", r.status === 403, `${r.status}`);
  r = await call(GATEWAY, `/api/risks/${testRiskId}`, { token: dave });
  check('Viewer can read (read access is intended for every role)', r.status === 200, `${r.status}`);
}

// ---------------------------------------------------------------------------------------------------------------
section = 'C. Input handling';
console.log(`\n${section}`);
{
  const { alice, bob } = TOKENS;

  let r = await call(GATEWAY, `/api/risks?owner=${encodeURIComponent("alice' OR '1'='1")}`, { token: alice });
  check(
    'SQL injection in a filter is refused or returns nothing extra',
    (r.status === 400 && noLeak(r)) || (r.status === 200 && r.json.totalElements === 0),
    r.status === 400 ? '400, not a valid username' : `${r.status}, ${r.json?.totalElements} results`,
  );

  r = await call(GATEWAY, `/api/controls?owner=${encodeURIComponent('{"$ne":null}')}`, { token: alice });
  check('NoSQL operator as a filter value matches nothing', r.status === 200 && r.json.totalElements === 0, `${r.status}, ${r.json?.totalElements} results`);
  r = await call(GATEWAY, '/api/controls?owner[$ne]=nobody', { token: alice });
  check('NoSQL operator in a parameter name is ignored or refused', (r.status === 200 && r.json.totalElements === (await call(GATEWAY, '/api/controls', { token: alice })).json.totalElements) || (r.status === 400 && noLeak(r)), `${r.status}`);

  r = await call(GATEWAY, '/api/controls', { method: 'POST', token: bob, body: { name: { $gt: '' }, type: 'PREVENTIVE', frequency: 'MONTHLY' } });
  check('NoSQL operator as a field value is rejected', r.status === 400 && noLeak(r), `${r.status}`);

  r = await call(GATEWAY, '/api/risks', { method: 'POST', token: alice, body: { title: 'x', category: 'NOPE', likelihood: 9, impact: -1 } });
  check('Out-of-range and unknown values are rejected (400, no stack trace)', r.status === 400 && noLeak(r), `${r.status}`);

  r = await call(GATEWAY, '/api/risks', { method: 'POST', token: alice, raw: '{"title": "x", ' });
  check('Malformed JSON is rejected (400, no stack trace)', r.status === 400 && noLeak(r), `${r.status}`);

  // Found by OWASP ZAP: PostgreSQL can't store NUL characters, which surfaced as 500s.
  r = await call(GATEWAY, '/api/risks?owner=%00', { token: alice });
  const nulBody = await call(GATEWAY, '/api/risks', { method: 'POST', token: alice, raw: '{"title":"a\\u0000b","category":"CYBER","likelihood":1,"impact":1}' });
  check('A NUL character in a filter or a saved field is rejected (400, not 500)', r.status === 400 && nulBody.status === 400 && noLeak(nulBody), `${r.status}, ${nulBody.status}`);

  r = await call(GATEWAY, '/api/risks/not-a-uuid', { token: alice });
  check('Invalid id in the address is rejected (400, no stack trace)', r.status === 400 && noLeak(r), `${r.status}`);

  r = await call(GATEWAY, '/api/risks?size=100000', { token: alice });
  check('Asking for a huge page is refused', r.status === 400 && noLeak(r), `${r.status}`);

  const baseline = (await call(GATEWAY, '/api/risks?size=1', { token: alice })).json.totalElements;
  r = await call(GATEWAY, '/api/risks?size=1&sort=title;drop%20table%20risk', { token: alice });
  const after = (await call(GATEWAY, '/api/risks?size=1', { token: alice })).json.totalElements;
  check(
    'A crafted sort parameter does no harm (ignored or refused; the table is still there)',
    ((r.status === 200 && r.json.totalElements === baseline) || (r.status === 400 && noLeak(r))) && after === baseline,
    `${r.status}; ${baseline} risks before, ${after} after`,
  );

  // Denial of service: three 150 MB bodies at once crashed the Risk Service (out of memory) before the size limit.
  const restartsBefore = await restarts('risk-service');
  const big = `{"title":"x","category":"CYBER","likelihood":1,"impact":1,"description":"${'A'.repeat(150 * 1024 * 1024)}"}`;
  const floods = await Promise.all([1, 2, 3].map(() => call(GATEWAY, '/api/risks', { method: 'POST', token: alice, raw: big })));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const restartsAfter = await restarts('risk-service');
  check(
    'Three 150 MB bodies at once are refused and nothing crashes',
    floods.every((f) => f.status === 413) && restartsAfter === restartsBefore,
    `${floods.map((f) => f.status).join(', ')}; Risk Service restarts ${restartsBefore} → ${restartsAfter}`,
  );
  r = await call(RISK, '/api/risks', { method: 'POST', token: alice, raw: big });
  check('The same body sent straight to the Risk Service is refused too', r.status === 413, `${r.status}`);

  // A body without a length (chunked) can't be checked up front.
  r = await chunked(`${GATEWAY}/api/risks`, alice, JSON.stringify({ title: 'x', category: 'CYBER', likelihood: 1, impact: 1 }));
  check('A body without a declared length is refused', r === 411, `${r}`);

  r = await call(GATEWAY, '/api/risks/..%2f..%2factuator%2fenv', { token: alice });
  const r2 = await call(GATEWAY, '/api/risks/../../actuator/env', { token: alice });
  check('Path tricks cannot reach internal endpoints', !is(r.status, 200) && !is(r2.status, 200) && !r.text.includes('propertySources'), `${r.status}, ${r2.status}`);
}

// ---------------------------------------------------------------------------------------------------------------
section = 'D. Configuration';
console.log(`\n${section}`);
{
  const alice = TOKENS.alice;
  for (const [name, base] of [['Gateway', GATEWAY], ['Risk Service', RISK], ['Control Service', CONTROL]]) {
    const leaks = [];
    for (const p of ['/actuator/env', '/actuator/heapdump', '/actuator/beans', '/actuator/configprops', '/actuator/loggers', '/actuator/prometheus']) {
      const r = await call(base, p, { token: alice });
      if (r.status === 200) leaks.push(p);
    }
    check(`${name}: sensitive actuator endpoints are not exposed`, leaks.length === 0, leaks.join(', ') || 'env, heapdump, beans, configprops, loggers, prometheus → not 200');
  }

  let r = await call(GATEWAY, '/api/risks', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  check('CORS: another website cannot call the API from a browser', !r.headers.get('access-control-allow-origin'), `${r.status}, allow-origin: ${r.headers.get('access-control-allow-origin') ?? 'none'}`);
  r = await call(GATEWAY, '/api/risks', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' } });
  check('CORS: the dashboard itself is allowed', r.headers.get('access-control-allow-origin') === 'http://localhost:5173', `${r.headers.get('access-control-allow-origin')}`);

  r = await call(DASHBOARD, '/');
  const wanted = ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy'];
  const missing = wanted.filter((h) => !r.headers.get(h));
  check('Dashboard sends security headers (CSP, nosniff, frame, referrer)', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : r.headers.get('content-security-policy'));
  check('Dashboard does not reveal its web server version', !/\d/.test(r.headers.get('server') ?? ''), `server: ${r.headers.get('server') ?? 'none'}`);

  r = await call(GATEWAY, '/api/risks?size=1', { token: alice });
  const apiHeaders = ['x-content-type-options', 'cache-control'].filter((h) => !r.headers.get(h));
  check('API responses send nosniff and no-cache headers', apiHeaders.length === 0, apiHeaders.length ? `missing ${apiHeaders.join(', ')}` : 'present');

  r = await call(GATEWAY, '/api/nothing-here', { token: alice });
  check('Unknown API address gives 404 without internals', r.status === 404 && noLeak(r), `${r.status}`);

  // A stopped service should read as "unavailable, retry", not as a gateway bug.
  docker(['compose', 'stop', 'control-service']);
  r = await call(GATEWAY, '/api/controls?size=1', { token: alice });
  docker(['compose', 'up', '-d', '--wait', 'control-service']);
  check('A stopped service gives 503 Service unavailable, not 500', r.status === 503 && noLeak(r), `${r.status} ${r.json?.title ?? ''}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Attacks from a process on the same machine, against what sits behind the Gateway. Everything here uses records
// the script creates itself, so even if a defence failed, no real risk or control would change.
section = 'E. Integrity behind the Gateway';
console.log(`\n${section}`);
{
  const { alice, bob, carol } = TOKENS;
  const control = (await call(GATEWAY, '/api/controls', {
    method: 'POST', token: bob, body: { name: '[security test] forged-event target', type: 'PREVENTIVE', frequency: 'MONTHLY' },
  })).json;
  const risk = (await call(GATEWAY, '/api/risks', {
    method: 'POST', token: alice, body: { title: '[security test] forged-event target', category: 'CYBER', likelihood: 4, impact: 5 },
  })).json;
  extraRisks.push(risk.id);
  await call(GATEWAY, `/api/risks/${risk.id}/controls/${control.id}`, { method: 'POST', token: alice });
  const scoreNow = async () => (await call(GATEWAY, `/api/risks/${risk.id}`, { token: alice })).json.residualScore;
  const before = await scoreNow();

  // Found in the review: a message written straight to Kafka moved a risk from Critical to Low.
  const forged = (signature) => {
    const event = { eventId: randomUUID(), schemaVersion: 1, controlId: control.id, controlType: 'PREVENTIVE', assessmentId: randomUUID(),
      result: 'EFFECTIVE', effectiveness: 1.0, assessedAt: new Date().toISOString() };
    // The console producer needs at least one header per line; an unrelated one stands in for "no signature".
    const headers = signature ? `rcp-signature:${signature}` : 'x-sent-by:attacker';
    return `${headers}\t${control.id}\t${JSON.stringify(event)}`;
  };
  const produced = docker(['exec', '-i', 'risk-control-platform-kafka-1', '/opt/kafka/bin/kafka-console-producer.sh',
    '--bootstrap-server', 'localhost:9092', '--topic', 'control.assessed',
    '--reader-property', 'parse.headers=true', '--reader-property', 'parse.key=true'], `${forged(null)}\n${forged(randomBytes(64).toString('base64'))}\n`);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const afterForgery = await scoreNow();
  check(
    'A "control works" message written straight to Kafka (unsigned, or with a made-up signature) changes no score',
    produced.status === 0 && before === 20 && afterForgery === 20,
    produced.status === 0 ? `score ${before} → ${afterForgery}` : `could not publish: ${produced.stderr.slice(0, 120)}`,
  );

  const redis = docker(['exec', '-e', 'REDISCLI_AUTH=', 'risk-control-platform-redis-1', 'redis-cli', 'SET', `risk::${risk.id}`, 'poisoned']);
  check('Redis refuses commands without the password (no cache poisoning)', /NOAUTH|WRONGPASS/.test(redis.stdout + redis.stderr),
    (redis.stdout + redis.stderr).trim().split('\n').pop());
  const mongo = docker(['exec', 'risk-control-platform-mongo-1', 'mongosh', '--quiet', '--eval', 'db.getSiblingDB("controldb").controls.countDocuments()']);
  check('MongoDB refuses queries without a user', /requires authentication/.test(mongo.stdout + mongo.stderr),
    (mongo.stdout + mongo.stderr).trim().split('\n').pop().slice(0, 80));

  // Found in the review: with an unkeyed hash, someone who can write to MongoDB edited a result, recomputed the hashes
  // and /verify still said valid. Assume the worst: the attacker even has the database admin password.
  const assessed = (await call(GATEWAY, `/api/controls/${control.id}/assessments`, {
    method: 'POST', token: carol, body: { result: 'EFFECTIVE', evidence: '[security test]' },
  })).json;
  const adminPassword = readFileSync(join(root, '.env'), 'utf8').match(/^MONGO_ADMIN_PASSWORD=(.*)$/m)?.[1]?.trim();
  const tamper = `
    const crypto = require('crypto');
    const field = (v) => (v === null || v === undefined ? '-:;' : Buffer.byteLength(String(v), 'utf8') + ':' + v + ';');
    const c = db.getSiblingDB('controldb');
    const a = c.assessments.findOne({ _id: '${assessed.id}' });
    const canonical = field(a.controlId) + field(String(a.sequence)) + field('INEFFECTIVE') + field('0.0') + field(a.tester)
      + field(a.evidence) + field(a.comments) + field(a.assessedAt.toISOString()) + field(a.prevHash);
    const forged = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    c.assessments.updateOne({ _id: a._id }, { $set: { result: 'INEFFECTIVE', effectiveness: 0.0, hash: forged } });
    print(c.controls.updateOne({ _id: a.controlId }, { $set: { lastAssessmentHash: forged } }).modifiedCount);`;
  const edited = docker(['exec', 'risk-control-platform-mongo-1', 'mongosh', '--quiet', '-u', 'admin', '-p', adminPassword ?? '',
    '--authenticationDatabase', 'admin', '--eval', tamper]);
  const verify = (await call(GATEWAY, `/api/controls/${control.id}/assessments/verify`, { token: carol })).json;
  check(
    'An assessment edited in MongoDB with recomputed hashes is still detected (the chain is keyed)',
    edited.stdout.trim().endsWith('1') && verify.valid === false,
    `edit applied: ${edited.stdout.trim().endsWith('1')}; /verify valid=${verify.valid}, ${verify.reason ?? ''}`,
  );

  // Found by the independent reviewer: delete the newest (failing) result and move the head back to the older
  // (passing) one. No key is needed for that: the older hash is stored right there.
  const rollbackControl = (await call(GATEWAY, '/api/controls', {
    method: 'POST', token: bob, body: { name: '[security test] rollback target', type: 'PREVENTIVE', frequency: 'MONTHLY' },
  })).json;
  await call(GATEWAY, `/api/controls/${rollbackControl.id}/assessments`, { method: 'POST', token: carol, body: { result: 'EFFECTIVE' } });
  const failing = (await call(GATEWAY, `/api/controls/${rollbackControl.id}/assessments`, {
    method: 'POST', token: carol, body: { result: 'INEFFECTIVE' },
  })).json;
  const rollback = `
    const c = db.getSiblingDB('controldb');
    const older = c.assessments.findOne({ controlId: '${rollbackControl.id}', sequence: 1 });
    c.assessments.deleteOne({ _id: '${failing.id}' });
    print(c.controls.updateOne({ _id: '${rollbackControl.id}' }, { $set: { assessmentCount: 1, lastAssessmentHash: older.hash,
      latestResult: older.result, latestEffectiveness: older.effectiveness, lastAssessedAt: older.assessedAt } }).modifiedCount);`;
  const rolled = docker(['exec', 'risk-control-platform-mongo-1', 'mongosh', '--quiet', '-u', 'admin', '-p', adminPassword ?? '',
    '--authenticationDatabase', 'admin', '--eval', rollback]);
  const afterRollback = (await call(GATEWAY, `/api/controls/${rollbackControl.id}/assessments/verify`, { token: carol })).json;
  check(
    'Deleting the newest result and rolling the chain head back to an older one is detected (keyed head seal)',
    rolled.stdout.trim().endsWith('1') && afterRollback.valid === false,
    `rollback applied: ${rolled.stdout.trim().endsWith('1')}; /verify valid=${afterRollback.valid}, ${afterRollback.reason ?? ''}`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Stored cross-site scripting, in a real browser: open the pages that show a hostile risk title and see whether
// anything runs. Needs playwright-core (PLAYWRIGHT_CORE=<path to its folder>) and Microsoft Edge or Chrome.
section = 'F. Browser';
console.log(`\n${section}`);
{
  let playwright = null;
  try {
    playwright = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href : 'playwright-core');
  } catch {
    // reported below
  }
  if (!playwright) {
    check('Stored XSS: hostile titles never run in the browser', false, 'SKIPPED: playwright-core not found (set PLAYWRIGHT_CORE)');
  } else {
    const { alice } = TOKENS;
    const marker = `xss${randomUUID().slice(0, 8)}`;
    const hostile = `[security test] <img src=x onerror="window.${marker}=1"><script>window.${marker}=1</script><svg onload="window.${marker}=1">`;
    const risk = (await call(GATEWAY, '/api/risks', { method: 'POST', token: alice, body: { title: hostile, description: hostile, category: 'CYBER', likelihood: 5, impact: 5 } })).json;
    extraRisks.push(risk.id);
    const browser = await playwright.chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss();
    });
    await page.goto(`${DASHBOARD}/login`);
    await page.locator('#username').fill('alice');
    await page.locator('#password').fill('demo123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(`${DASHBOARD}/`);
    const ran = [];
    let shown = 0;
    for (const path of ['/', '/register', `/risks/${risk.id}`]) {
      await page.goto(DASHBOARD + path);
      await page.waitForTimeout(2500);
      if (await page.evaluate((m) => Boolean(window[m]), marker)) ran.push(path);
      if ((await page.content()).includes('&lt;script&gt;')) shown++;
    }
    await browser.close();
    check('Stored XSS: hostile titles are shown as text and never run (overview, register, risk page)',
      ran.length === 0 && dialogs.length === 0 && shown > 0,
      `ran on: ${ran.join(', ') || 'none'}; dialogs: ${dialogs.length}; shown as text on ${shown} of 3 pages`);
  }
}

// Leave the test risks closed so they stay out of the live views.
for (const id of extraRisks) {
  const current = (await call(GATEWAY, `/api/risks/${id}`, { token: TOKENS.alice })).json;
  await call(GATEWAY, `/api/risks/${id}/status`, { method: 'PATCH', token: TOKENS.alice, body: { status: 'CLOSED', version: current.version } });
}
if (testRiskId) {
  const alice = TOKENS.alice;
  const current = (await call(GATEWAY, `/api/risks/${testRiskId}`, { token: alice })).json;
  await call(GATEWAY, `/api/risks/${testRiskId}/status`, { method: 'PATCH', token: alice, body: { status: 'CLOSED', version: current.version } });
}

// Last, because it uses up this address's login allowance for the next minute.
section = 'A. Authentication';
console.log(`
${section} (continued)`);
{
  // Password spraying: one address, many usernames. Each attempt costs a bcrypt check on the Gateway.
  const spray = [];
  for (let i = 0; i < 70; i++) spray.push((await call(GATEWAY, '/api/auth/login', { method: 'POST', body: { username: `spray-${randomUUID().slice(0, 8)}`, password: 'Winter2026!' } })).status);
  const limited = spray.filter((x) => x === 429).length;
  check('Password spraying from one address is slowed down (many usernames)', limited > 0, `${limited} of 70 refused with 429`);

}

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(`  FAIL  [${f.section}] ${f.name}`);
process.exit(failed.length ? 1 : 0);
