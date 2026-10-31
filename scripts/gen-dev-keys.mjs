#!/usr/bin/env node
// Generates the dev key pairs in deploy/keys/ (git-ignored), each only if it is missing:
//   jwt-private.pem / jwt-public.pem                      RS256: the gateway signs sign-in tokens, everyone verifies
//   events-risk-private.pem / events-risk-public.pem       Ed25519: the Risk Service signs its Kafka events
//   events-control-private.pem / events-control-public.pem Ed25519: the Control Service signs its Kafka events
//   assessment-chain.key                                   256-bit secret (base64): keys the assessment hash chain
// Private keys are PKCS#8, public keys X.509 SPKI. Usage: node scripts/gen-dev-keys.mjs [--force]

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const keysDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'keys');
const force = process.argv.includes('--force');
const encoding = { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } };

const pairs = [
  { name: 'jwt', make: () => generateKeyPairSync('rsa', { modulusLength: 2048, ...encoding }) },
  { name: 'events-risk', make: () => generateKeyPairSync('ed25519', encoding) },
  { name: 'events-control', make: () => generateKeyPairSync('ed25519', encoding) },
];

mkdirSync(keysDir, { recursive: true });
for (const { name, make } of pairs) {
  const privatePath = join(keysDir, `${name}-private.pem`);
  const publicPath = join(keysDir, `${name}-public.pem`);
  if (!force && existsSync(privatePath) && existsSync(publicPath)) {
    console.log(`Keys already exist: ${name} (re-run with --force to replace all keys)`);
    continue;
  }
  const { privateKey, publicKey } = make();
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey);
  console.log(`Wrote ${privatePath}\nWrote ${publicPath}`);
}

const chainKey = join(keysDir, 'assessment-chain.key');
if (!force && existsSync(chainKey)) {
  console.log('Keys already exist: assessment-chain');
} else {
  writeFileSync(chainKey, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  console.log(`Wrote ${chainKey}`);
}
