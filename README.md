# Risk & Control Assessment Platform

An event-driven microservices platform (Spring Boot, Kafka, Redis, React, Kubernetes) that recalculates risk scores in real time as controls are assessed.

> Work in progress: build steps 1–10 (services, events, caching, login and roles, dashboard, demo data) are done. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and build plan.

## Prerequisites

- Java 21 (Temurin)
- Docker Desktop
- Node 22 LTS or newer
- Git

Maven isn't required: the repo ships the Maven wrapper (`./mvnw`, or `mvnw.cmd` on Windows).

## Getting started

Run the whole platform (8 containers) with one command:

```bash
node scripts/start.mjs
```

It starts Docker Desktop if it isn't running, creates `.env` with random passwords (or adds settings that are new since it was made) and the dev keys on first run, builds and starts every container, loads the demo data into an empty register, and opens http://localhost:5173. The first build takes a few minutes; after that it is up in seconds. Add `--no-open` or `--no-seed` to skip those steps.

Stop with `docker compose down` (add `-v` to delete all data). The same steps by hand:

```bash
cp .env.example .env                    # then replace every change-me
node scripts/gen-dev-keys.mjs           # dev keys in deploy/keys/ (git-ignored, mounted at run time)
docker compose up -d --build --wait
node scripts/seed-demo.mjs              # demo data, on an empty register
```

For development, run only the infrastructure in Docker and the apps from the IDE or Maven:

```bash
docker compose up -d --wait postgres mongo kafka redis
./mvnw verify                           # build and test all services
```

Run a service locally:

```bash
./mvnw -pl risk-service spring-boot:run      # http://localhost:8081/actuator/health
./mvnw -pl control-service spring-boot:run   # http://localhost:8082/actuator/health
./mvnw -pl gateway spring-boot:run           # http://localhost:8080/actuator/health (login + routing)
```

Everything goes through the gateway on port 8080. Log in to get a token:

```bash
curl -s -X POST localhost:8080/api/auth/login -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "demo123"}'
# then: curl localhost:8080/api/risks -H "Authorization: Bearer <accessToken>"
```

Demo users (local development only, password `demo123`): `alice` risk owner, `bob` control owner, `carol` control tester, `dave` viewer, `erin` control owner + tester.

Run the dashboard and load the demo data (with the three services running):

```bash
cd dashboard && npm install && npm run dev     # http://localhost:5173
node scripts/seed-demo.mjs                     # from the repo root, on an empty register
```

The 30-second demo: sign in as **carol**, open **Controls → MFA on admin accounts**, record **Ineffective**. On the Overview (or the "Risks it mitigates" panel) *Account takeover of privileged users* moves from Medium 10 to Critical 20 within about a second, and *SIEM alerting on privileged access* appears in the **Re-test queue**. To reset, run `docker compose down -v`, then `node scripts/start.mjs`.

Dashboard tests: `cd dashboard && npm test`.

## Monitoring

Grafana at http://localhost:3000 (dashboards: platform overview, events, security), Prometheus at http://localhost:9090 (metrics and alerts), and traces in Grafana's *Explore → Tempo*: one control test is one trace across the Gateway, both services and Kafka. See [docs/monitoring.md](docs/monitoring.md); check it end to end with `node scripts/check-monitoring.mjs`.

## Performance

Screens get changes **pushed** over one open connection instead of polling: on a 4-core laptop one Gateway (1 CPU, 512 MB) keeps **4,000 people live**, every change on every screen within 0.9 s, while the services answer about **2 requests a second in total**. Polling the old way, the same laptop served 200. Measurements, the bottleneck hunt and estimates up to 1,000,000 users: [docs/performance.md](docs/performance.md). Run it: `node load-tests/run.mjs` (`--live 1000,4000` for the push test).

## Kubernetes

`node scripts/k8s.mjs` runs the platform on a local kind cluster at **https://localhost:8443**: HTTPS edge, network policies (a stray pod reaches nothing but the edge), Secrets, probes, and 2–4 autoscaled Gateways. Every Gateway was replaced under load with **0 failed requests out of 9,744**, and 400 live viewers across 4 Gateways cost the Risk Service 1.2 requests a second. Every part was also crashed under load: each one comes back by itself, a failure never spreads to the other service, and no event is lost while Kafka is down. A crashed service is back in about 9 s (it was 40–56 s): Java 25's ahead-of-time cache and room to use 2 CPUs while starting made start-up 3.5 times faster. Details and limits: [docs/kubernetes.md](docs/kubernetes.md).

## CI/CD

Every push and pull request runs [`ci.yml`](.github/workflows/ci.yml) on GitHub Actions:

1. **Java services:** build, unit and integration tests against real PostgreSQL, MongoDB, Kafka and Redis (Testcontainers), on Java 25.
2. **Dashboard:** tests, type check, production build, `npm audit`.
3. **Secrets:** gitleaks over the whole history.
4. **Whole platform:** started with `node scripts/start.mjs` as a developer would; images scanned with Trivy (a fixable critical vulnerability fails the build); the monitoring check (10 checks) and the attack suite (58 attacks, including XSS in a real browser) run against it.
5. **Publish (main only):** the images that passed are pushed to `ghcr.io/sanyamkhaiwal/rcp-{gateway,risk-service,control-service,dashboard}`, tagged with the commit.

[`k8s.yml`](.github/workflows/k8s.yml) deploys each change on main to a throwaway kind cluster with `scripts/k8s.mjs` and checks it through the HTTPS edge: pods, network policies, and Gateways replaced under load without a failed request. Dependabot opens weekly update pull requests, which go through the same pipeline.

Found by the pipeline on its first runs: a heat-map cache cleared lazily (the dashboard could show old counts for a moment), dev keys unreadable by the containers on Linux, and MongoDB 8 refusing to start on the runners' Linux kernel (SERVER-121912; CI runs MongoDB 7.0, everything else 8.0).

## Security

The platform has been penetration-tested by its author and by an independent reviewer, and scanned; findings, fixes and accepted risks are in [docs/security-review.md](docs/security-review.md). With the stack running:

```bash
node security/attack-tests.mjs    # 57 scripted attacks: forged tokens and Kafka events, role bypass, injection, DB tampering, XSS in a browser
bash security/scan.sh             # Trivy (dependencies and images), gitleaks (secrets), npm audit
bash security/zap.sh              # OWASP ZAP: passive scan of the UI, active scan of every API endpoint
```

The browser check in `attack-tests.mjs` needs `playwright-core` (set `PLAYWRIGHT_CORE` to its folder) and Edge or Chrome. Attacks that would create junk data run against a throwaway copy of the stack: `security/compose.isolated.yaml` explains how.

Stop the infrastructure with `docker compose down` (add `-v` to delete the database volumes).

## Repository layout

| Path | What it is |
| --- | --- |
| `risk-service/` | Risks, scoring, links (Spring Boot, PostgreSQL) |
| `control-service/` | Controls and assessments (Spring Boot, MongoDB) |
| `gateway/` | API gateway (Spring Cloud Gateway) |
| `dashboard/` | React UI |
| `compose.yaml` | The whole platform in Docker, monitoring included |
| `deploy/docker/` | Dockerfiles and the nginx config |
| `deploy/monitoring/` | Prometheus, alert rules, Tempo, Grafana data sources and dashboards |
| `scripts/` | Start, seed, dev keys, monitoring check |
| `load-tests/` | k6 load tests and the runner (`run.mjs`) |
| `security/` | Attack suite, scanners, OWASP ZAP, the throwaway stack for destructive tests |
| `docs/` | Architecture and design docs |
