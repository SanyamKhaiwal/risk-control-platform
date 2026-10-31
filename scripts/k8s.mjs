#!/usr/bin/env node
// The platform on a local Kubernetes cluster (kind), in one step: creates the cluster, adds metrics-server (for the
// Gateway's autoscaler), builds the images and loads them into the cluster, makes the Secrets from .env and
// deploy/keys, applies deploy/k8s and waits for every workload, then loads the demo data.
// Open https://localhost:8443 afterwards (a self-signed certificate, so the browser asks once).
// Usage: node scripts/k8s.mjs [--no-build] [--no-seed]      node scripts/k8s.mjs down   (deletes the cluster)
// Needs Docker, kind and kubectl; run node scripts/start.mjs once first for .env and the keys.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLUSTER = 'rcp';
const NAMESPACE = 'rcp';
const EDGE = 'https://localhost:8443';
const METRICS_SERVER = 'https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.8.0/components.yaml';
const APP_IMAGES = ['risk-service', 'control-service', 'gateway'].map((name) => `risk-control-platform/${name}:local`);
const DASHBOARD_IMAGE = 'risk-control-platform/dashboard:k8s';
const DATA_IMAGES = ['postgres:17.11', 'mongo:8.0.34', 'apache/kafka:4.3.2', 'redis:7.4.12'];
const args = process.argv.slice(2);

const run = (command, commandArgs, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${commandArgs.join(' ')} exited with ${code}`))));
  });

/** Applies a manifest given on standard input, so Secrets never touch the disk. */
const apply = (manifest) => {
  const result = spawnSync('kubectl', ['apply', '-f', '-'], { cwd: root, input: manifest, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  process.stdout.write(result.stdout);
};

const step = (text) => console.log(`\n▸ ${text}`);
const output = (command, commandArgs) => spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8' }).stdout ?? '';

function readEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) throw new Error('No .env: run node scripts/start.mjs once first (it makes .env and the keys).');
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value]),
  );
}

const secret = (name, data, type = 'Opaque') =>
  JSON.stringify({
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, namespace: NAMESPACE },
    type,
    data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Buffer.from(value).toString('base64')])),
  });

async function edgeCertificate() {
  const cert = join(root, 'deploy', 'keys', 'edge-tls.crt');
  const key = join(root, 'deploy', 'keys', 'edge-tls.key');
  if (!existsSync(cert)) {
    step('Making a self-signed certificate for https://localhost:8443');
    await run('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '365',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout', key, '-out', cert,
    ]);
  }
  return { 'tls.crt': readFileSync(cert), 'tls.key': readFileSync(key) };
}

async function up() {
  const env = readEnv();
  const keyDir = join(root, 'deploy', 'keys');
  const keyFiles = ['jwt-private.pem', 'jwt-public.pem', 'events-risk-private.pem', 'events-risk-public.pem',
    'events-control-private.pem', 'events-control-public.pem', 'assessment-chain.key'];
  const missing = keyFiles.filter((file) => !existsSync(join(keyDir, file)));
  if (missing.length) throw new Error(`Missing keys (${missing.join(', ')}): run node scripts/gen-dev-keys.mjs`);

  if (!output('kind', ['get', 'clusters']).split(/\r?\n/).includes(CLUSTER)) {
    step(`Creating the kind cluster "${CLUSTER}"`);
    await run('kind', ['create', 'cluster', '--config', 'deploy/k8s/kind-cluster.yaml']);
  }
  await run('kubectl', ['config', 'use-context', `kind-${CLUSTER}`]);

  step('Adding metrics-server (CPU figures for the autoscaler)');
  await run('kubectl', ['apply', '-f', METRICS_SERVER]);
  // kind's kubelets have self-signed serving certificates.
  await run('kubectl', ['-n', 'kube-system', 'patch', 'deployment', 'metrics-server', '--type=json', '-p',
    '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]']).catch(() => {});

  if (!args.includes('--no-build')) {
    step('Building the images');
    await run('docker', ['compose', 'build', 'risk-service', 'control-service', 'gateway']);
    // The dashboard calls /api on its own origin (the edge), so no API address is baked in.
    await run('docker', ['build', '-f', 'deploy/docker/dashboard.Dockerfile', '--build-arg', 'VITE_API_URL=', '-t', DASHBOARD_IMAGE, '.']);
  }
  step('Loading the images into the cluster');
  // One platform at a time, not "kind load": with Docker Desktop's image store, kind imports every platform and the
  // build attestations, which fails ("content digest not found") and has crashed Docker Desktop.
  for (const image of [...APP_IMAGES, DASHBOARD_IMAGE, ...DATA_IMAGES, 'busybox:1.37.0']) {
    if (!output('docker', ['image', 'inspect', '--format', 'x', image]).trim()) await run('docker', ['pull', '-q', image]);
    await run('sh', ['-c', `docker save --platform linux/amd64 ${image} | docker exec -i ${CLUSTER}-control-plane ctr -n k8s.io images import --snapshotter=overlayfs - > /dev/null`]);
    console.log(`  loaded ${image}`);
  }

  step('Making the Secrets from .env and deploy/keys');
  apply(JSON.stringify({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: NAMESPACE } }));
  apply(secret('rcp-secrets', {
    DB_PASSWORD: env.DB_PASSWORD,
    MONGO_ADMIN_PASSWORD: env.MONGO_ADMIN_PASSWORD,
    MONGO_PASSWORD: env.MONGO_PASSWORD,
    REDIS_PASSWORD: env.REDIS_PASSWORD,
  }));
  apply(secret('rcp-keys', Object.fromEntries(keyFiles.map((file) => [file, readFileSync(join(keyDir, file))]))));
  apply(secret('edge-tls', await edgeCertificate(), 'kubernetes.io/tls'));

  step('Applying deploy/k8s');
  await run('kubectl', ['apply', '-k', 'deploy/k8s']);
  // A changed image under the same tag isn't noticed by Kubernetes: restart the app workloads so they pick it up.
  if (!args.includes('--no-build')) {
    await run('kubectl', ['-n', NAMESPACE, 'rollout', 'restart', 'deployment/risk-service', 'deployment/control-service',
      'deployment/gateway', 'deployment/edge']);
  }

  step('Waiting for every workload');
  for (const workload of ['statefulset/postgres', 'statefulset/mongo', 'statefulset/kafka', 'deployment/redis',
    'deployment/control-service', 'deployment/risk-service', 'deployment/gateway', 'deployment/edge']) {
    await run('kubectl', ['-n', NAMESPACE, 'rollout', 'status', workload, '--timeout=10m']);
  }

  if (!args.includes('--no-seed')) {
    step('Loading the demo data');
    await run('node', ['scripts/seed-demo.mjs'], {
      env: { ...process.env, GATEWAY_URL: EDGE, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    });
  }
  console.log(`\n✓ The platform is running on Kubernetes: ${EDGE}`);
  console.log('  kubectl -n rcp get pods        node scripts/k8s.mjs down   (deletes the cluster)');
}

try {
  if (args[0] === 'down') await run('kind', ['delete', 'cluster', '--name', CLUSTER]);
  else await up();
  process.exit(0);
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}
