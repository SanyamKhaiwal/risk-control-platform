#!/usr/bin/env node
// Mints sign-in tokens for the simulated users, signed with the dev key exactly as the Gateway signs them, so every
// simulated person is a distinct user with their own rate limit (k6 can't sign RS256 itself). The Gateway and the
// services still verify every token. Sign-in itself is load-tested separately (users.js, scenario "signins").
//   node load-tests/make-tokens.mjs [users=3000]  → load-tests/out/tokens.json
import { randomUUID, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const key = readFileSync(join(root, 'deploy', 'keys', 'jwt-private.pem'), 'utf8');
const users = Number(process.argv[2] ?? 3000);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);

function token(sub, roles) {
  const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: 'rcp-gateway', sub, roles, iat: now, exp: now + 6 * 3600, jti: randomUUID() })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

// Who uses a risk register: mostly people looking at it; some testing controls; a few owning risks and controls.
const mix = { viewers: 0.8, testers: 0.15, owners: 0.05 };
const out = {
  viewers: Array.from({ length: Math.round(users * mix.viewers) }, (_, i) => token(`load-viewer-${i}`, ['VIEWER'])),
  testers: Array.from({ length: Math.round(users * mix.testers) }, (_, i) => token(`load-tester-${i}`, ['CONTROL_TESTER'])),
  owners: Array.from({ length: Math.max(1, Math.round(users * mix.owners)) }, (_, i) => token(`load-owner-${i}`, ['RISK_OWNER'])),
  controlOwners: Array.from({ length: 10 }, (_, i) => token(`load-control-owner-${i}`, ['CONTROL_OWNER'])),
};
mkdirSync(join(root, 'load-tests', 'out'), { recursive: true });
writeFileSync(join(root, 'load-tests', 'out', 'tokens.json'), JSON.stringify(out));
console.log(`tokens: ${out.viewers.length} viewers, ${out.testers.length} testers, ${out.owners.length} risk owners, ${out.controlOwners.length} control owners (valid 6 h)`);
