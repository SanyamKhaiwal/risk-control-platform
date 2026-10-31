#!/usr/bin/env node
// One step from clone to a running platform: starts Docker if needed, prepares .env and the dev keys on first run,
// builds and starts all containers, loads the demo data into an empty register, and opens the dashboard.
// Usage: node scripts/start.mjs [--no-open] [--no-seed]     --prepare: only make .env and the keys (CI, scripts/k8s.mjs)

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DASHBOARD = 'http://localhost:5173';
const GRAFANA = 'http://localhost:3000';
const args = process.argv.slice(2);

const run = (command, commandArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${commandArgs.join(' ')} exited with ${code}`))));
  });

const step = (text) => console.log(`\n▸ ${text}`);
const dockerReady = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

async function ensureDocker() {
  if (dockerReady()) return;
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe'),
          join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DockerDesktop', 'Docker Desktop.exe'),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Docker.app']
        : [];
  const app = candidates.find((path) => existsSync(path));
  if (!app) throw new Error('Docker is not running. Start Docker, then run this again.');

  step('Starting Docker Desktop (this can take a minute)');
  if (process.platform === 'darwin') spawn('open', ['-a', app], { detached: true, stdio: 'ignore' }).unref();
  else spawn(app, [], { detached: true, stdio: 'ignore' }).unref();

  const deadline = Date.now() + 180_000;
  while (!dockerReady()) {
    if (Date.now() > deadline) throw new Error('Docker did not start within 3 minutes. Start it by hand, then run this again.');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

/**
 * Creates .env from .env.example, or adds settings that are new since it was made (keeping existing values).
 * Every *_PASSWORD gets a random value. A MongoDB address from before authentication gets the new one with a user.
 */
function ensureEnv() {
  const envPath = join(root, '.env');
  const template = readFileSync(join(root, '.env.example'), 'utf8');
  const secret = () => randomBytes(18).toString('base64url');
  const setting = /^([A-Z0-9_]+)=(.*)$/;

  if (!existsSync(envPath)) {
    step('Creating .env with random passwords');
    writeFileSync(envPath, template.replace(/^([A-Z0-9_]*PASSWORD)=.*$/gm, (_, key) => `${key}=${secret()}`));
    return;
  }

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  const keyOf = (line) => line.match(setting)?.[1];
  const templateKeys = template.split(/\r?\n/).map(keyOf).filter(Boolean);
  const added = [];
  // A new setting goes just before the next template setting the file already has, so a value that refers to
  // another (MONGO_URI uses ${MONGO_PASSWORD}) still comes after it; Compose reads .env top to bottom.
  templateKeys.forEach((key, i) => {
    if (lines.some((line) => keyOf(line) === key)) return;
    const value = key.endsWith('PASSWORD') ? `${key}=${secret()}` : template.match(new RegExp(`^${key}=.*$`, 'm'))[0];
    const nextKey = templateKeys.slice(i + 1).find((k) => lines.some((line) => keyOf(line) === k));
    const at = nextKey ? lines.findIndex((line) => keyOf(line) === nextKey) : lines.length;
    lines.splice(at, 0, value);
    added.push(key);
  });
  const mongo = lines.findIndex((line) => keyOf(line) === 'MONGO_URI');
  if (mongo >= 0 && !lines[mongo].includes('@')) {
    lines[mongo] = template.match(/^MONGO_URI=.*$/m)[0];
    console.log('  Updated MONGO_URI in .env: MongoDB now requires a user.');
  }
  if (added.length) step(`Adding new settings to .env: ${added.join(', ')}`);
  const current = lines.join('\n');
  writeFileSync(envPath, current);
  const weak = [...current.matchAll(/^([A-Z0-9_]*PASSWORD)=change-me\s*$/gm)].map((m) => m[1]);
  if (weak.length) {
    console.log(`  ! ${weak.join(', ')} still "change-me" in .env. For an existing database, change it there too, e.g.`);
    console.log(`    docker compose exec postgres psql -U risk -d riskdb -c "alter user risk password '<new>'"`);
  }
}

function openBrowser(url) {
  const [command, commandArgs] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, commandArgs, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

try {
  if (args.includes('--prepare')) {
    ensureEnv();
    await run(process.execPath, [join(root, 'scripts', 'gen-dev-keys.mjs')]);
    process.exit(0);
  }
  await ensureDocker();
  ensureEnv();
  await run(process.execPath, [join(root, 'scripts', 'gen-dev-keys.mjs')]);

  step('Building and starting the containers (first build takes a few minutes)');
  console.log('  Order: postgres, mongo, kafka, redis → control-service → risk-service → gateway → dashboard;');
  console.log('         prometheus, tempo → grafana (monitoring) alongside.');
  console.log('  Each one starts only when the ones before it report healthy.');
  await run('docker', ['compose', 'up', '-d', '--build', '--wait']);

  step('Health check');
  const ps = spawnSync('docker', ['compose', 'ps', '--format', '{{.Service}}\t{{.Status}}'], { cwd: root, encoding: 'utf8' });
  for (const line of ps.stdout.trim().split('\n').sort()) {
    const [service, status] = line.split('\t');
    console.log(`  ${status.includes('(healthy)') ? '✓' : '✗'} ${service.padEnd(16)} ${status}`);
  }
  // The Gateway's health endpoint is on the unpublished management port; on the API, 401 means it's up and checking.
  const answering = [
    ['Gateway', 'http://localhost:8080/api/risks', (r) => r.status === 401],
    ['Dashboard', DASHBOARD, (r) => r.ok],
    ['Grafana', GRAFANA, (r) => r.ok],
    ['Prometheus', 'http://localhost:9090/-/ready', (r) => r.ok],
  ];
  for (const [name, url, ok] of answering) {
    const response = await fetch(url).catch(() => null);
    await response?.body?.cancel(); // an unread body keeps the connection, and this process, alive
    if (!response || !ok(response)) throw new Error(`${name} is not answering at ${url}. See: docker compose logs`);
    console.log(`  ✓ ${name.padEnd(16)} answering at ${url}`);
  }

  if (!args.includes('--no-seed')) {
    step('Loading the demo data');
    await run(process.execPath, [join(root, 'scripts', 'seed-demo.mjs')]);
  }

  console.log(`\n✓ Running at ${DASHBOARD}  (sign in as alice, bob, carol or dave; password demo123)`);
  console.log(`  Monitoring: ${GRAFANA} (dashboards) · http://localhost:9090 (Prometheus, alerts)`);
  console.log('  Stop it with: docker compose down');
  if (!args.includes('--no-open')) openBrowser(DASHBOARD);
  process.exit(0);
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}
