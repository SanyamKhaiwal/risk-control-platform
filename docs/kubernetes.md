# Kubernetes

The platform on a local Kubernetes cluster ([kind](https://kind.sigs.k8s.io/)), with the production habits a real
cluster needs: HTTPS at the edge, network policies, Secrets, probes, rolling updates without errors, and an autoscaled
Gateway. Manifests: [`deploy/k8s/`](../deploy/k8s/). Checks: [`load-tests/k8s-checks.mjs`](../load-tests/k8s-checks.mjs).

## Run it

```bash
node scripts/start.mjs --no-open   # once, for .env and the keys (then `docker compose stop` to free memory)
node scripts/k8s.mjs               # cluster, images, Secrets, manifests, demo data: about 5 minutes
# https://localhost:8443 (self-signed certificate: the browser asks once)
node load-tests/make-tokens.mjs 6000 && node load-tests/k8s-checks.mjs
node load-tests/k8s-failures.mjs   # crash and restart each part under load (about 10 minutes)
node scripts/k8s.mjs down          # delete the cluster
```

Needs Docker, kind (0.33+) and kubectl. Nothing is pushed to a registry: the images are built locally and imported
into the kind node.

## What runs

```
             https://localhost:8443
                      │  (kind node port 30443)
              ┌───────▼────────┐
              │  edge  ×2      │  nginx: TLS, the dashboard's files, /api → Gateways
              └───────┬────────┘
              ┌───────▼────────┐
              │ gateway ×2–4   │  HPA on CPU; rolling updates never drop below the ready count
              └──┬──────────┬──┘
     ┌───────────▼──┐    ┌──▼──────────────┐
     │ risk-service │───►│ control-service │   1 replica each (single outbox publisher)
     └──┬───────┬───┘    └───┬─────────┬───┘
   postgres   redis        mongo     kafka ◄── both services
```

| Object | Notes |
|---|---|
| `edge` Deployment ×2, NodePort | The dashboard image with [`edge.conf.template`](../deploy/k8s/edge.conf.template) mounted: TLS 1.2/1.3, HSTS and the same security headers as compose, 256 KB body limit, `/api/live` unbuffered. One origin, so no CORS. ingress-nginx is retired, so the edge is a plain Deployment rather than an Ingress. |
| `gateway` Deployment, HPA 2–4, PDB | Target 60% of requested CPU (500m). `maxUnavailable: 0`, graceful shutdown with a 5 s `preStop` pause so the Service stops sending new requests before the pod stops. |
| `risk-service`, `control-service` | One replica, `Recreate` strategy: the outbox has a single publisher (ARCHITECTURE.md §8.2). API docs off. |
| postgres, mongo, kafka StatefulSets; redis Deployment | 1 Gi volume each. Same images and settings as compose. |
| Secrets | `rcp-secrets` (passwords, from `.env`), `rcp-keys` (every key file; each pod mounts only its own, as in compose), `edge-tls`. Made by `scripts/k8s.mjs` through stdin, never written to disk or to a manifest. |
| Pod security | Namespace enforces the `baseline` standard, warns on `restricted`. App pods meet `restricted`: non-root (UID 999 / 101), no privilege escalation, all capabilities dropped, seccomp, read-only root filesystem for the Java services. The data stores' official images start as root, so they don't. |
| Probes | Startup, readiness and liveness on the management port 9091 (not reachable through any Service). |

## Network policies

Everything in the namespace is closed by default ([`networkpolicies.yaml`](../deploy/k8s/networkpolicies.yaml));
each rule opens one path:

| To | Only from |
|---|---|
| edge :8443 | anywhere |
| gateway :8080 | edge |
| risk-service :8081 | gateway |
| control-service :8082 | gateway, risk-service |
| postgres | risk-service |
| mongo | control-service |
| kafka | risk-service, control-service |
| redis | gateway, risk-service |

kind's default network plugin (kindnet) enforces these; the checks below prove it rather than assume it.

## Results

On the same laptop as the load tests (i5-11300H, 4 cores; Docker Desktop VM with 8 CPUs and 12 GB), kind v0.33
(Kubernetes 1.37), the compose stack stopped. `load-tests/out/k8s-full.json` and `k8s.json` hold the raw output.

| Check | Result |
|---|---|
| Pods | 10/10 ready, 0 restarts |
| HTTPS edge | dashboard 200 with HSTS and CSP; API without token 401; sign-in and register read through the edge; 300 KB body 413; plain HTTP on the TLS port redirected to HTTPS (301) |
| Network policies | a pod that isn't part of the platform reaches **none** of postgres, mongo, kafka, redis, risk-service, control-service, gateway, but does reach the edge (so the probe works); the edge reaches the gateway but not postgres, kafka or risk-service. 13/13 |
| Rolling restart of every Gateway, 40 viewers reading without pause | **9,744 requests, 0 failed** (52 s) |
| One Gateway deleted under the same load | **9,830 requests, 0 failed** |
| Autoscaling, 150 viewers without pause | 2 → **4 Gateways** within 63 s (CPU 199% of request); 27,092 requests, 0 failed |
| Live updates: 400 viewers spread over 4 Gateways, a change every 5 s for 60 s | Risk Service sees **1.22 req/s** (0.2 of it the writer); 400/400 streams open; 100% of changes delivered, p95 1.04 s |
| Spoofed `X-Forwarded-For` on 35 sign-ins | 30 × 401, then 429: the edge overwrites the header, so a client can't pose as many addresses |
| API docs on the services | `/v3/api-docs` and `/swagger-ui.html` 404 |

What they show:

- **Zero-downtime deploys work.** Readiness probes, `maxUnavailable: 0` and the graceful shutdown with a `preStop`
  pause together mean no request saw an error while every Gateway was replaced.
- **The shared live hub works across pods.** With 4 Gateways the Risk Service load stays about where it was with 1 or 2
  (2.2 req/s at 4,000 viewers in compose): one fetch per change for the whole cluster, not per Gateway.
- **The autoscaler works, but Java start-up is its cost.** A new Gateway takes about 30 s to become ready, and while
  it starts it uses a lot of CPU. The first run of this check started with 4 Gateways already, because the rolling
  restart just before had scaled them out by itself. The check now waits for the Gateways to settle back to 2 first.
  In production a longer scale-up window or CPU-only-when-ready metrics would avoid that flapping.

Limits, stated plainly:

- **One node.** kind runs everything in one Docker container, so this proves the manifests and the behaviour
  (rollouts, policies, scaling, the hub), not multi-node capacity. Throughput numbers stay in
  [performance.md](performance.md), measured on compose with fixed CPU limits.
- **Kafka still has no login** (SEC-13). The network policy means only the two services can reach it, and forged
  events are rejected by signature (SEC-07); SASL/TLS with ACLs is still the right fix on a shared cluster.
- **Client address.** Behind kind's port mapping every client arrives from the Docker network's address, so the
  per-address sign-in limit is shared, as in compose. On a real cluster the load balancer would pass the real address
  (`externalTrafficPolicy: Local` or the PROXY protocol), and the edge already forwards it safely.
- **Data stores are single-instance** StatefulSets with no backups: development-grade, as in compose.
- **Self-signed certificate.** A real cluster would use cert-manager with Let's Encrypt.

## Failures

What users see when one part fails ([`load-tests/k8s-failures.mjs`](../load-tests/k8s-failures.mjs)): 20 viewers on
the Overview (Risk Service → Postgres, Redis) and 20 on the controls list (Control Service → MongoDB), each reading
every 100 ms through the edge, while one part is crashed or restarted. Kubernetes brings every part back by itself.
Output: `load-tests/out/k8s-failures-full.log`.

| What fails | Overview | Controls | Back in |
|---|---|---|---|
| One Gateway crashes (SIGKILL), one still running | 8 failed, within 0.1 s | 3 failed, within 0.1 s | 14 s (unnoticed) |
| Risk Service restarted (a deploy) | down **13 s** (was 35 s) | 0 failed | 15 s |
| Control Service restarted (a deploy) | 0 failed | down **9 s** (was 25 s) | 12 s |
| Risk Service crashes (SIGKILL) | down **9 s** (was 40–56 s) | 0 failed | 13 s |
| PostgreSQL pod deleted | 0 failed (back in ~3 s; the caches covered it) | 0 failed | 3 s |
| MongoDB pod deleted | 0 failed | 80 failed over 15 s (504) | 10 s |
| Redis pod deleted | 40 failed over 5 s (504) | 0 failed | 3 s |
| **Kafka pod deleted, a control assessed during the outage** | assessment accepted (201); the risk's residual score still went 16 → 4, 22 s after Kafka was back | | 14 s |

What this shows:

- **A crashed Gateway costs only the requests it was handling** (about 20, in a fifth of a second); the others carry on.
  A deleted one (above) costs nothing, because it finishes its requests first.
- **Each failure stays in its own part.** When the Risk Service or Redis is down the controls list keeps working,
  and the reverse: a service down never takes the other one down with it.
- **No event is lost.** An assessment recorded while Kafka is down waits in the outbox and reaches the Risk Service
  when Kafka is back (ARCHITECTURE.md §8.2).
- **The single-replica services are the weak point:** 9 to 13 s of downtime for their screens (25 to 56 s before
  the start-up work below). Running two of each removes it, but needs the outbox publisher to be elected (a lock in
  the database) rather than assumed single; that's the next step for full zero-downtime deploys.
- **One fix came out of it.** A service killed mid-request made the Gateway answer some requests with a generic 500
  (connection reset, or closed before the request was sent); it now answers 502 like the other upstream failures, so
  clients know to retry (`UpstreamErrorHandlerTests`).

Not tested here: losing the whole node (kind has one), and a disk failure (the volumes aren't replicated).

## Faster restarts

A restarted service is down for as long as its JVM takes to start, so start-up was cut instead of running a spare
copy of each service all the time:

- **Ahead-of-time cache (Java 25, JEP 483/514/515).** The image build starts each service once (stopping when the
  application context is ready, with no database or broker) and records the classes Spring loads and links and how
  hot methods were used; each real start maps that in. The code still compiles for Java 21; only the runtime is 25.
  Spring Boot's plain `java -jar` layout is used, because the cache only covers the JVM's own class loaders.
- **CPU to start with.** The Java pods reserve the same CPU as before (250m / 500m) but may use up to 2 CPUs while
  there's room, instead of 1. Start-up is where they need it; running, they use what they used before.
- **Probes every 1-2 s** instead of 5, so traffic returns as soon as the pod is ready.

Measured on the Risk Service (the slowest), restarted alone on an idle cluster, each setup twice, in alternating order;
"started" is Spring Boot's own figure (`process running for`):

| Setup | Started in |
|---|---|
| no cache, 1 CPU (as before, but on Java 25) | 26.7 s, 26.7 s |
| cache, 1 CPU | 13.8 s, 14.1 s |
| no cache, 2 CPU | 14.4 s, 16.9 s |
| **cache, 2 CPU** | **7.6 s, 7.5 s** |

Each change halves the start-up on its own; together, 3.5 times faster. Under the failure test's load, the screens
of a restarted service are now down 9-13 s instead of 25-56 s (table above).

On Docker Compose (all services starting together, cold), Spring Boot's start-up figure before and after:
Risk Service 19.1 → 10.0 s, Control Service 11.8–17.3 → 6.8 s, Gateway 15.1 → 9.0 s.

Three things came out of it:

- **The Java 25 image has no `curl`,** which compose's health checks used: the services ran but were reported
  unhealthy. The checks now use bash alone (Kubernetes probes never needed it).

- **A Gateway couldn't start while Redis was down:** its live-update channels connected at start-up. They now
  connect on first use and retry every 5 s, and until then the Gateway fetches for its own viewers
  (`LiveWithoutRedisTests`).
- **A full Docker disk breaks everything at once.** The build cache had grown to 16 GB and filled Docker Desktop's
  disk; Docker crashed and left a corrupt image in the kind node. `docker builder prune` freed 13.6 GB.

Not done: GraalVM native images (start in well under a second, but slow builds and extra configuration for Kafka,
MongoDB and Hibernate), and two replicas per service (above). The throughput figures in performance.md were measured
on Java 21.

## Notes for running it

- **Docker Desktop and `kind load`.** With Docker Desktop's containerd image store, `kind load docker-image` imports
  every platform and the build attestations, which failed ("content digest not found") and once crashed Docker
  Desktop. `scripts/k8s.mjs` instead streams `docker save --platform linux/amd64` into the node's `ctr images import`.
- **Images under the same tag.** After a rebuild, `scripts/k8s.mjs` restarts the app Deployments so the pods pick up
  the new images (they use `imagePullPolicy: Never`).
- **Memory.** The cluster requests about 3.5 GB. Stop the compose stack first (`docker compose stop`) on a 16 GB
  machine.
