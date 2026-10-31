# Security review

Penetration test and vulnerability scan of the platform as it runs in Docker (`node scripts/start.mjs`), done before publishing. Scope: the dashboard, the Gateway, both services, the data stores and message bus behind them, the four images and the repository. Out of scope: cloud and Kubernetes (not built yet; see [Planned](#planned-in-later-steps)).

**Result:** 13 vulnerabilities found and fixed, 7 of them high; 9 lower risks accepted for a local demo, each with a reason and a plan. After the fixes, all 58 scripted attacks are refused, OWASP ZAP reports no failures, the scanners report no critical or high vulnerabilities, and an independent reviewer's retest confirmed the fixes to its findings.

Run it again: `node security/attack-tests.mjs` (attacks), `bash security/scan.sh` (Trivy, gitleaks, npm audit), `bash security/zap.sh` (OWASP ZAP). Reports go to `security/reports/` (git-ignored).

## How it was tested, and its limits

The platform's author tested it first, which carries an obvious bias: the attacks follow how the author knows it works. So the review had two more parts:

1. **First pass (author).** Scanners (Trivy, gitleaks, npm audit, OWASP ZAP) and a scripted set of attacks through the network: forged tokens, role and ownership bypass, injection, oversized requests, configuration leaks. Five findings, all at the Gateway or the services' input handling (SEC-01 to SEC-06).
2. **Independent review.** A separate reviewer was given the code and the running system, but none of the first pass's findings or scripts, and asked to break the product's core promise: *a risk's score only changes through an authorised action, and test records are tamper-evident.* It found what the first pass had rated as a minor configuration issue to be the most serious problem: everything behind the Gateway trusted anything that could reach it (SEC-07 to SEC-09, SEC-16). Its retest after the fixes found one fix incomplete (SEC-16, chain rollback), which was then fixed and retested again.
3. **Gaps closed by the author** after reviewing the first pass critically: Kafka message forgery (proved live before the fix: a risk went from 12 High to 3 Low with no sign-in), the missing HTTPS finding, ZAP signed in as users who can write (the first pass used a viewer, so write endpoints were never really attacked), token header tricks, a real-browser XSS check, and tighter checks where the first pass's were weak (timing, sort parameter).

Destructive attacks ran against a throwaway copy of the whole stack ([security/compose.isolated.yaml](../security/compose.isolated.yaml)), never the demo data. Every fix was confirmed by re-running the attack that found it; attacks that worked before a fix are kept in `security/attack-tests.mjs`, so the suite is known to fail when a defence is missing.

What this review is not: a professional penetration test, a review of the cloud setup, or a test of anyone who holds the service keys (that is game over by definition, and the reason keys are mounted only into the service that needs them).

## Findings

Severity: how much damage, how easy. "Fixed" means retested after the fix.

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| SEC-07 | Messages written straight to Kafka change risk scores | High | Fixed |
| SEC-16 | Test records can be rewritten or rolled back without detection | High | Fixed (one limit remains) |
| SEC-01 | Oversized requests crash a service | High | Fixed |
| SEC-02 | Vulnerable compression libraries in the Java services | High | Fixed |
| SEC-03 | Vulnerable packages in the dashboard image | High | Fixed |
| SEC-08 | MongoDB accepts connections without a password | High | Fixed |
| SEC-09 | Redis accepts connections without a password (cache poisoning) | Medium | Fixed |
| SEC-10 | Every service can read every key, including the token-signing key | Medium | Fixed |
| SEC-04 | Password spraying is not slowed down | Medium | Fixed |
| SEC-05 | A stopped service shows up as a Gateway error (500) | Medium | Fixed |
| SEC-06 | NUL characters in input cause server errors | Low | Fixed |
| SEC-11 | The database password was the template default | Low | Fixed |
| SEC-12 | Unpatched OS packages in the Java base image | Medium | Accepted; no fix released |
| SEC-13 | Kafka itself accepts unauthenticated connections | Medium | Mitigated in Kubernetes (network policy); SASL open |
| SEC-14 | No HTTPS: passwords and tokens travel in plain text | Medium | Fixed in Kubernetes; accepted for local |
| SEC-15 | The services can be called directly, skipping the Gateway's rate limits | Low | Fixed in Kubernetes; accepted for local |
| SEC-17 | The per-address login limit depends on knowing the real client address | Low | Fixed in Kubernetes (edge sets the header) |
| SEC-18 | Sign-in tokens can't be revoked early | Low | Accepted |
| SEC-19 | The sign-in token is readable by scripts on the page | Low | Accepted |
| SEC-20 | Anyone can lock a user out of signing in for a minute | Low | Accepted |
| SEC-21 | API docs are public on the services' own ports | Low | Fixed in Kubernetes; accepted for local |
| SEC-22 | Private keys in the repository | Info | Not a leak; documented and allow-listed |

### SEC-07 Messages written straight to Kafka change risk scores (High, fixed)

**What we found.** The Risk Service applied any `control.assessed` message on the topic: nothing said who sent it. Publishing one fake "this control works" message, with no account and no token, moved "Customer data leak via email" from **12 High to 3 Low**. The risk's history recorded the change as an assessment of that control, while the Control Service's only real test of it said "Doesn't work" and its hash chain still verified, so the register and the audit trail silently disagreed. The independent reviewer reproduced it (25 Critical to 5 Low) and rated it Critical for any deployment where Kafka is reachable over a network; it is High here because Kafka's port is bound to this machine only.

**Fix.** Events are signed. Each service signs an event with its own Ed25519 private key **when it writes the outbox row**, inside the same database transaction, and stores the signature with it; the publisher sends it as the `rcp-signature` header. Each consumer accepts only events signed by the other service's key, and sends anything else to the dead-letter topic with a `SECURITY` log line ([EventSignatures](../risk-service/src/main/java/com/riskcontrol/risk/events/EventSignatures.java)). Signing at write time means even someone who can insert outbox rows can't produce a valid signature. The Risk Service's outbox payload column changed from `jsonb` to `text`, because `jsonb` rewrites JSON and would have broken the signatures.

**Retest.** Unsigned, made-up and wrongly-keyed messages are rejected and change nothing; genuine assessments still rescore in under a second. The independent reviewer also **replayed a genuine signed message** captured from the topic after the risk had worsened again: no effect, because the event id was already processed and its assessment time was older (both inside the signed payload). Automated tests in both services and in the attack suite.

### SEC-16 Test records can be rewritten or rolled back without detection (High, fixed; one limit remains)

**What we found (independent reviewer).** The hash chain used plain SHA-256, which anyone can compute. With write access to MongoDB, the reviewer changed a test result, recomputed the hashes, and `/verify` still reported the chain valid. After the first fix, its retest found a second way: delete the newest (failing) result and point the control back at the older (passing) one; every value needed was already in the database.

**Fix.** The chain is keyed: each record's hash is an HMAC-SHA256 with a secret that only the Control Service holds, in a key file, never in MongoDB ([AssessmentHasher](../control-service/src/main/java/com/riskcontrol/control/domain/AssessmentHasher.java)). The control also carries a keyed **seal of its chain head** (number of records plus newest hash), re-sealed with every test and checked by `/verify`, so deleting or rolling back the newest records is detected too. Existing chains were moved to the key once with an operator-only switch (`CONTROL_ASSESSMENTS_RESEAL=true` for one start); nothing in the database can turn it on.

**Retest.** With the MongoDB admin password assumed stolen: an edited result with recomputed SHA-256 hashes → "Content does not match its hash"; the reviewer's rollback → "Chain head seal does not match". Automated tests for both.

**Independent retest of the head seal.** Fixed: the rollback above, reordering records (caught by the per-record hashes), and moving one control's seal onto another (the control id is inside the seal).

**Limit (confirmed by the reviewer).** The seal has no notion of time, so an attacker with *ongoing* read and write access to MongoDB who saved a control's older head (count, newest hash, seal) can restore it later, rolling the control back to that earlier state or, with the seal saved at creation, wiping its history; `/verify` then reports valid. They still can't create, edit or reorder records, only return to a state they saw. Risk scores don't follow such a rollback on their own: the Risk Service keeps its own copy of each control's latest result, taken from signed events (SEC-07). They would if the risk owner later unlinked and relinked the control, because linking reads the control's current result from the Control Service (suspected by the reviewer, not tried). Closing the gap needs the head anchored outside the database (for example, chain heads published to an append-only log); on the roadmap.

**Operating note.** A reseal re-hashes the records as they are at that moment, so running it on tampered data would make the tampering verify. Run it only right after `/verify` reports every chain valid.

### SEC-01 Oversized requests crash a service (High, fixed)

**What we found.** A request body is read whole into memory before its fields are checked. Three 150 MB requests sent at once ran the Risk Service out of memory (`OutOfMemoryError: Java heap space`); it crashed and Docker restarted it. Anyone with an account could repeat this to keep the service down.

**Fix.** Bodies are capped at 256 KB, ten times the largest real request. The Gateway answers **413** for a larger declared body and **411** for a body with no declared length, before routing ([RequestSizeFilter](../gateway/src/main/java/com/riskcontrol/gateway/web/RequestSizeFilter.java)); each service enforces the same cap itself in case it is called directly.

**Retest.** Three 150 MB bodies at once: 413, 413, 413, no restarts; straight to the Risk Service: 413; chunked: 411. Automated tests in all three modules.

### SEC-02 Vulnerable compression libraries in the Java services (High, fixed)

**What we found.** Trivy: 3 high and 5 medium vulnerabilities in `lz4-java` 1.10.1 and `snappy-java` 1.1.10.7, brought in by the Kafka client. The worst (CVE-2026-106451) allows running code through an insecure temporary file.

**Fix.** Pinned `lz4-java` 1.11.4 and `snappy-java` 1.1.10.9 in the root `pom.xml` (remove once Kafka's client depends on these or later). **Retest.** No high or critical vulnerabilities in the Java images; all backend tests pass.

### SEC-03 Vulnerable packages in the dashboard image (High, fixed)

**What we found.** 1 critical (brotli, CVE-2026-111497), 2 high and 3 medium vulnerabilities in the nginx image's Alpine packages. **Fix.** The image installs Alpine's security updates when built, removes `curl` (unused), and states its non-root user. **Retest.** Trivy: 0 vulnerabilities.

### SEC-08 MongoDB accepts connections without a password (High, fixed)

**What we found.** Any program on the machine could read and change controls and test records (`mongosh` connected without credentials); combined with SEC-16 this made test records rewritable. **Fix.** Authentication is on, with two users: `admin` (root, used only by the container health check) and `control`, which can read and write `controldb` and nothing else, used by the Control Service. Users are created on first start, including on existing data from before authentication. **Retest.** Unauthenticated queries: "requires authentication".

### SEC-09 Redis accepts connections without a password (Medium, fixed)

**What we found (independent reviewer).** Overwriting a cached risk in Redis made the API serve a residual score of 99, outside the legal 1–25, to every user until the cache entry was replaced; the same store holds the login-attempt and rate-limit counters, which could be reset. **Fix.** Redis requires a password. **Retest.** Unauthenticated commands: `NOAUTH`.

### SEC-10 Every service can read every key (Medium, fixed)

**What we found.** All three Java containers mounted the whole key folder, so the Risk and Control services could read the Gateway's token-signing key: compromising either service would have meant being able to sign in as anyone. **Fix.** Each container mounts only the files it needs: the Gateway the token keys, each service its own event-signing key, the other's public key and the token public key; the chain key only the Control Service.

### SEC-04 Password spraying is not slowed down (Medium, fixed)

**What we found.** Sign-in was limited per username only; 70 attempts with 70 usernames from one address were all processed, each costing the Gateway a deliberately slow bcrypt check. **Fix.** A second limit: 30 attempts a minute per client address ([LoginThrottle](../gateway/src/main/java/com/riskcontrol/gateway/auth/LoginThrottle.java)). **Retest.** 70 attempts: the ones over the limit refused with 429. Automated test.

### SEC-05 A stopped service shows up as a Gateway error (Medium, fixed)

**What we found.** With the Control Service stopped, the Gateway answered **500**. **Fix.** **503** when a service can't be reached, **502** when it drops the connection, **504** on a timeout ([UpstreamErrorHandler](../gateway/src/main/java/com/riskcontrol/gateway/web/UpstreamErrorHandler.java)). **Retest.** 503 "Service unavailable". Automated test.

### SEC-06 NUL characters in input cause server errors (Low, fixed)

**What we found.** OWASP ZAP sent `owner=%00` and got a 500: PostgreSQL can't store NUL. A risk title with NUL failed the same way. **Fix.** The Risk Service refuses NUL in text fields, and the owner filter accepts only username characters. **Retest.** 400 for both; automated test.

### SEC-11 The database password was the template default (Low, fixed)

**What we found (independent reviewer).** `.env` still had `DB_PASSWORD=change-me` from the template. **Fix.** Rotated to a random password in the database and `.env`; `start.mjs` generates random values for every password in a new `.env`, adds any new ones to an existing `.env`, and warns about any left at `change-me`.

### SEC-12 Unpatched OS packages in the Java base image (Medium, accepted)

27 medium and 4 low vulnerabilities in Ubuntu 24.04 packages of the Temurin JRE image (glibc, gnutls, pcre2, tar and others), none with a fix released and none used by the services directly. **Plan:** CI rebuilds and rescans regularly; a distroless base would remove most of these packages.

### SEC-13 Kafka itself accepts unauthenticated connections (Medium, accepted for local)

Forged messages no longer have any effect (SEC-07), but anyone who can reach the broker can still read events (risk scores and ratings) and fill topics, including the dead-letter topics. The port is bound to this machine. **Kubernetes:** a network policy lets only the Risk and Control services connect to Kafka, which a stray pod and the edge were both shown unable to do (docs/kubernetes.md). SASL with TLS and per-topic ACLs remain the fix for a shared cluster.

### SEC-14 No HTTPS (Medium, accepted for local)

The dashboard, Gateway and services speak plain HTTP, so passwords and tokens would be readable on a shared network. Everything here is on one machine, over the loopback interface. **Kubernetes:** the edge serves only HTTPS (TLS 1.2/1.3) with `Strict-Transport-Security`; plain HTTP on that port is redirected to HTTPS. The certificate is self-signed locally.

### SEC-15 The services can be called directly, skipping the Gateway's rate limits (Low, accepted for local)

Ports 8081 and 8082 are reachable from this machine. Each service still checks the token, roles, ownership and request size itself, so no access rule is bypassed, only the Gateway's per-user rate limit. **Kubernetes:** the services have no outside address, and network policies admit only the Gateway (and the Risk Service, for the Control Service); verified from a stray pod and from the edge.

### SEC-17 The per-address login limit depends on knowing the real client address (Low, accepted for local)

In Docker Desktop every request from the host arrives from one internal address, so locally the limit is shared: 30 sign-ins a minute for everyone (raised for the load test; `LOGIN_ATTEMPTS_PER_ADDRESS`). **Kubernetes:** the edge overwrites `X-Forwarded-For` with the address it sees, and only the edge can reach the Gateway. 35 sign-ins each claiming a different address were still refused after 30. Behind kind's port mapping every client shares one address; a real load balancer must pass the client's (`externalTrafficPolicy: Local` or the PROXY protocol).

### SEC-18 Sign-in tokens can't be revoked early (Low, accepted)

Signing out forgets the token in the browser, but a copied token works until it expires after 30 minutes. A revocation list in Redis is the usual fix if needed.

### SEC-19 The sign-in token is readable by scripts on the page (Low, accepted)

The token is kept in `sessionStorage`, so injected script could read it. Injection was tried in a real browser and failed: hostile titles on the overview, register and risk pages were shown as text and never ran (React escapes all values; the Content-Security-Policy allows only the dashboard's own scripts). The alternative, an httpOnly cookie, would need CSRF protection.

### SEC-20 Anyone can lock a user out of signing in for a minute (Low, accepted)

Ten wrong passwords for `alice` block her sign-in for the rest of that minute: the price of the per-username limit.

### SEC-21 API docs are public on the services' own ports (Low, accepted for local)

Swagger UI and the OpenAPI description on ports 8081 and 8082 describe the API but return no data. **Kubernetes:** turned off (`SPRINGDOC_*_ENABLED=false`): both paths return 404.

### SEC-22 Private keys in the repository (Info)

gitleaks found private keys. The ones under `*/src/test/resources/test-keys/` exist only for the automated tests (see their README), the copies under `target/` are build output, and `deploy/keys/` is generated per machine and git-ignored. `.gitleaks.toml` allow-lists exactly these paths. (Trivy also notes that the Dockerfiles have no `HEALTHCHECK`; every container has one in `compose.yaml`, and Kubernetes uses its own probes.)

## Changes since the review

The performance work (docs/performance.md) added a live-update endpoint and changed how rate limits are counted. What that means for security:

- **`POST /api/live`** (server-sent events) needs a valid sign-in token; the stream ends when the token expires. It accepts at most 10 addresses per stream and 5 streams per user, only read-only API addresses matching a fixed pattern (dashboards, risk and control lists with simple filters, one risk or control), and at most 2,000 distinct addresses across all users, so it can't be used to make the Gateway fetch arbitrary or endless things. Tested in `LiveTests` (refused: other paths, `/actuator`, path tricks, outside URLs, too many addresses, no token).
- **The live hub reads with its own identity**, `live-hub` with the VIEWER role, minted by the Gateway and never given to a browser. This is safe because every role may read everything (ARCHITECTURE.md §10); if reads ever became role-dependent, the hub would have to fetch per role.
- **The per-user rate limit is now counted in each Gateway's memory** instead of Redis. With several Gateway instances, a user spread across N of them gets up to N times the limit; that still stops one client from flooding the platform. Sign-in attempts, where an exact count matters (SEC-04), are still counted in Redis.
- **Verified tokens are remembered** until they expire; expiry is checked on every use, and a token that failed is never remembered.

The attack suite (58 checks) passes unchanged.

## What held up

Tried and refused without changes (all in `security/attack-tests.mjs` unless noted):

- **Forged sign-in tokens:** missing, garbage, unsigned (`alg: none`), HMAC-signed with the public key (algorithm confusion), signed with an attacker's key, header tricks pointing the verifier at an attacker's key (`jwk`, `jku`, `x5u`) or a known file (`kid` path traversal), real token with extra roles added, expired, wrong issuer. All 401, at the Gateway **and** at each service.
- **Discovering usernames:** a wrong password and an unknown user get the same message and take as long (measured: within a few milliseconds of each other).
- **Doing more than your role allows:** viewers and testers creating risks, risk owners creating controls, a control owner without the tester role recording a test, Erin testing her own control, Bob editing Erin's control, another risk owner editing, closing or linking controls to Alice's risk. All 403.
- **Setting fields the server decides:** owner, score, rating, status and id sent with a new risk were ignored.
- **Injection:** SQL in filters and sort parameters, MongoDB operators in filters, parameter names and field values, path tricks towards internal endpoints; plus 31 hostile texts (SQL, NoSQL, template and JNDI injection, scripts, path traversal, header injection, control characters, emoji, right-to-left text, length limits) in risk titles and descriptions with otherwise valid values (`security/experiments/risk-text-fuzz.mjs`): no server errors, and everything stored came back exactly as sent.
- **Bad input:** out-of-range values, unknown categories, malformed JSON, invalid ids, a page size of 100,000. All 400 without stack traces.
- **Stored XSS in a real browser:** see SEC-19.
- **Configuration:** sensitive actuator endpoints not exposed; CORS refuses other websites; the dashboard sends CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy` and (added during the review) cross-origin isolation headers, and hides the nginx version; API responses send `nosniff` and `no-cache`.
- **Containers:** non-root users; no keys baked into images; all ports bound to localhost.

## Scans

| Scan | Before | After |
| --- | --- | --- |
| Trivy, repository (Maven and npm dependencies) | 0 vulnerabilities; 1 high, 2 low Dockerfile findings | 0 vulnerabilities; 2 low (no `HEALTHCHECK`, SEC-22) |
| Trivy, Java images (each) | 3 high, 32 medium, 5 low | 0 high, 27 medium, 4 low (SEC-12) |
| Trivy, dashboard image | 1 critical, 2 high, 3 medium, 44 low | 0 |
| npm audit (dashboard) | 0 | 0 |
| gitleaks | 7 keys (all test or git-ignored) | 0 (allow-listed, SEC-22) |
| OWASP ZAP | 0 failures; 1 server error (SEC-06) | 0 failures, 0 server errors |

### OWASP ZAP

Passive baseline scans of the dashboard and the Gateway, and active API scans of both services: ZAP read each service's OpenAPI description and sent its attack payloads (SQL, NoSQL, command and template injection, cross-site scripting, path traversal, buffer overflow and more) to every parameter of every endpoint. It ran first as the viewer Dave on the normal stack, then as Alice, Bob and Carol, who can write, on the throwaway copy.

| Target | Checks passed | Failures | Warnings after fixes |
| --- | --- | --- | --- |
| Dashboard (baseline) | 61 | 0 | informational only, see below |
| Gateway (baseline) | 65 | 0 | none that apply |
| Risk Service (active, as Dave, Alice, Bob, Carol) | 113–114 each | 0 | none (the one server error became SEC-06, fixed) |
| Control Service (active, as Dave, Alice, Bob, Carol) | 113 each | 0 | none |

The writing users' scans did reach the Control Service's write endpoints (ZAP created 256 controls in the copy). They did not reach the Risk Service's: ZAP filled the 1–5 score fields with out-of-range values, so validation refused every risk before the text payloads mattered. The text fuzz under "What held up" covers that gap.

Remaining dashboard warnings, all accepted:
- **Spectre site isolation:** `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` were added (12 warnings down to 3); the rest ask for `Cross-Origin-Embedder-Policy`, not needed by a page that embeds nothing from other sites.
- **CSP allows inline styles:** React's `style` attributes need it; scripts stay restricted to the dashboard's own files.
- **"Suspicious comments" and "cacheable content":** comments inside the bundled libraries' minified code, and static files being cacheable, as intended.

## Planned in later steps

- **Kubernetes (step 13), done:** HTTPS (SEC-14), network policies (SEC-13 mitigated, SEC-15), trusted `X-Forwarded-For` (SEC-17), API docs off (SEC-21), Secrets; see docs/kubernetes.md. Still open: Kafka SASL/TLS and ACLs.
- **CI (step 14):** run `security/attack-tests.mjs`, Trivy and gitleaks on every change, and rescan images regularly (SEC-12).
- **Roadmap:** anchor assessment chain heads outside the database (SEC-16's remaining limit).
