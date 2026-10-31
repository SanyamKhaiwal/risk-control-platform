# Performance

Measured load-test results, what limits the platform, and an estimate of what it would take to serve 1,000 to 1,000,000 people. Every number here was measured on the machine below; the estimates say how they were derived.

**In one paragraph:** on a 4-core laptop the platform first served **200 people** with a live screen open, each screen re-asking for its data every 2 seconds; the Gateway's CPU was the limit, and 100,000 people would have needed about 1,300 cores. Rather than plan for that hardware, the design changed: screens now get **changes pushed** to them over one open connection (server-sent events), and the Gateway fetches each thing being watched **once a second for everyone**. Measured on the same laptop, one Gateway with 1 CPU and 512 MB keeps **4,000 people live, every change on every screen within 0.9 s**, while the services answer **2 requests a second in total**, whatever the number of people. 100,000 people becomes a matter of about 25 Gateway cores and 4 GB of memory, not 1,300 cores.

## The machine and the setup

| | |
| --- | --- |
| CPU | Intel Core i5-11300H laptop: 4 cores, 8 threads, 3.1 GHz base, turbo for about half a minute under full load, then held to its power limit |
| Memory | 24 GB (12 GB for Docker) |
| Also running | Windows, VS Code, a browser with Grafana open: about 40% of the CPU busy at rest |
| Platform | The Docker stack as in `compose.yaml`, run as a throwaway copy (so the demo data stays clean), with CPU limits that fit the laptop ([load-tests/variants/laptop.yaml](../load-tests/variants/laptop.yaml)): Gateway 1 CPU, Risk and Control services 0.75 each, MongoDB and Kafka 0.5, PostgreSQL and Redis 0.25 |
| Data | A register of realistic size: 500 risks, 300 controls, each tested, risks linked to 1–3 controls |
| Load generator | k6 1.2.3 in Docker, 1 CPU, on the same machine |
| Run | `node load-tests/run.mjs --levels 25,50,…,400 --hold 1m --cooldown 60 --k6-cpus 1 --compose-extra load-tests/variants/laptop.yaml` |

### What a simulated person does

Exactly what the React app does (`dashboard/src/api`): every open screen re-asks for its data every 2 seconds.

| Share | Person | Every 2 s | Also |
| --- | --- | --- | --- |
| 80% | Viewer | The Overview's 5 requests (heat-map, top 10, first 100 risks, first 100 controls, re-test count), or a risk's page (the risk, its controls, its history, the control list, re-test count) | |
| 15% | Tester | The Controls page (2 requests) | Records a test about once a minute |
| 5% | Risk owner | The register (2 requests) | Adds a risk about every two minutes |

That averages **1.8 requests a second per person** (measured), whether or not anything changed. Each simulated person has their own sign-in token, so the Gateway's per-user rate limit applies as for real people. The service level checked: **95% of requests under 500 ms, under 1% failing.**

## Results

### Concurrent users

| People | Requests/s | p50 | p95 | p99 | Errors | Test → new score (p95) | Gateway CPU (avg / peak) | |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | 47 | 9 ms | 40 ms | 77 ms | 0% | 0.60 s | 9% / – | ✅ |
| 50 | 93 | 6 ms | 16 ms | 52 ms | 0% | 0.53 s | 13% / – | ✅ |
| 100 | 182 | 6 ms | 16 ms | 34 ms | 0% | 0.51 s | 29% / – | ✅ |
| 125 | 229 | 6 ms | 16 ms | 34 ms | 0% | 0.50 s | 33% / – | ✅ |
| 150 | 275 | 19 ms | 83 ms | 144 ms | 0% | 0.61 s | 49% / 78% | ✅ |
| **200** | **364** | 19 ms | **460 ms** | 759 ms | 0% | 0.69 s | 80% / 109% | ✅ **limit** |
| 250 | 452 | 83 ms | 1,295 ms | 2,243 ms | 0% | 0.53 s | 78% / 106% | ❌ |
| 300 | 461 | 1,588 ms | 2,722 ms | 3,276 ms | 0% | 0.71 s | 82% / 101% | ❌ |
| 400 | 475 | 1,828 ms | 3,218 ms | 7,915 ms | 0.8% | 0.78 s | 83% / 104% | ❌ |

- **The limit is about 200 people**, where the Gateway's one CPU starts to run full in bursts. Past it, throughput stops growing at about 460–475 requests a second and requests queue: slower, but at 250–300 people still no errors.
- **The event flow never was the bottleneck.** From a test being recorded to the linked risks' new scores stayed at 0.5–0.8 s at every level, the outboxes never held more than 4 events, and Kafka lag stayed at 0.
- At 400 people, 0.8% of requests failed: requests waiting too long in the Gateway's queue. Past the 5-second Gateway timeout (below), a request that can't be served gets a fast 504 instead of hanging.

### Sign-ins

| Sign-ins tried per second | Handled | p50 | p95 | Gateway CPU |
| --- | --- | --- | --- | --- |
| 2 | 2.0/s | 69 ms | 96 ms | 17% |
| 5 | 5.0/s | 71 ms | 140 ms | 37% |
| 10 | 10.0/s | 1,009 ms | 2,713 ms | 87% |

Each sign-in runs a bcrypt check, deliberately slow so stolen password hashes are hard to crack: about **10 sign-ins a second per Gateway core**. With 2 CPUs the Gateway handled 20 a second (measured earlier).

### What one request costs

CPU time per request, in milliseconds of one core, averaged over the 150–400-people levels (where fixed background work such as health checks and Prometheus scrapes is negligible):

| Gateway | Risk Service | Control Service | MongoDB | PostgreSQL | Redis | Kafka | **Total** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.85 | 1.13 | 0.79 | 0.47 | 0.12 | 0.13 | 0.09 | **4.6 ms** |

The Gateway is the most expensive piece per request: it verifies the sign-in token, checks the per-user rate limit in Redis, records metrics and traces, and proxies the request. The model below uses these numbers; as a check, it predicts the Gateway's single core to be about two-thirds busy at 200 people (1.8 requests × 1.85 ms × 200 ≈ 0.67 cores), which is what was measured where response times start to climb (80% average, bursts over 100%).

## What changed because of the tests

| Change | Why | Evidence |
| --- | --- | --- |
| **Short-lived list caches** in both services ([RiskListCache](../risk-service/src/main/java/com/riskcontrol/risk/cache/RiskListCache.java), [ControlListCache](../control-service/src/main/java/com/riskcontrol/control/service/ControlListCache.java)) | Hundreds of open screens asked for the same "first 100 risks" and "first 100 controls" every 2 seconds, and each time the database answered the same thing | Alternating runs, cache off/on twice: per request, MongoDB −57%, PostgreSQL −50%, Control Service −33%. Answers are kept up to 1 s and cleared on every change the service makes, so nobody misses their own change |
| **Push, one request per screen, local rate limits, remembered tokens** | Polling was almost all of the load | See [Optimisations](#optimisations-from-polling-to-push) |
| **Gateway timeouts**: 2 s to connect, 5 s to answer | An overloaded service made people wait a full minute before an error (p99 of 60 s) | Overloaded requests now fail with 504 after 5 s |
| **Tempo memory** 384 MB → 1 GB | Trace storage ran out of memory under load and crash-looped (57 restarts), taking CPU from everything else | 0 restarts since |
| **JVM garbage collector left at the JVM's choice** (Serial) | G1 and Parallel were tried and measured worse here: more GC threads competing for 4 cores | Same load, back to back: Serial 457 req/s, p95 267 ms; G1 271 req/s, 4.6 s; Parallel 290 req/s, 4.8 s. Worth re-testing on servers with dedicated cores |

**A lesson about measuring on a laptop.** The first runs looked far worse than these (a limit near 100 people) and got worse the longer testing went on: the same settings dropped from 457 to 125 requests a second within half an hour. Requests at rest stayed fast (8–35 ms), the data was small, and fresh JVMs didn't help: the laptop was hot and running below its turbo speed, and the containers were allowed far more CPU (about 10) than its 4 cores have. The results above come from runs sized to the machine, with a 60-second cool-down before each level; comparisons between settings were made in alternating runs (A, B, A, B), never one after another.

## Optimisations: from polling to push

The results above showed where the cost was: every open screen re-asked for everything every 2 seconds (1.8 requests a second per person), and every request paid the Gateway's fixed cost (token check, rate limit, metrics, proxying). So instead of adding servers:

| # | Change | Where |
| --- | --- | --- |
| 1 | **Push instead of polling.** The browser opens one stream (`POST /api/live`, server-sent events) naming what its screen shows. For each distinct address the Gateway fetches the answer once a second, on behalf of everyone watching it, and pushes it only when it changed. Polling stays as a fallback while the stream is down. | [LiveHub](../gateway/src/main/java/com/riskcontrol/gateway/live/LiveHub.java), [LiveController](../gateway/src/main/java/com/riskcontrol/gateway/live/LiveController.java), [live.ts](../dashboard/src/api/live.ts) |
| 2 | **One request per screen.** `GET /api/dashboard/overview` returns both maps and the top risks; the Overview fetches the 100-risk list only when a square is clicked, and the "next steps" box fetches lists only for the roles that use them (viewers, 80% of users, need none). | [DashboardController](../risk-service/src/main/java/com/riskcontrol/risk/api/DashboardController.java), [OverviewPage](../dashboard/src/pages/OverviewPage.tsx) |
| 3 | **Shared answers.** The live hub is the shared cache: one fetch per address per second, however many watch. (A response cache at the Gateway was not used: API responses are `Cache-Control: no-store` by design, so risk data is never stored outside the platform.) | LiveHub |
| 4 | **Cheaper Gateway requests.** Tokens already verified are remembered until they expire; the per-user rate limit is counted in the Gateway's memory instead of a Redis round trip per request (sign-in attempts are still counted in Redis). | [CachingJwtDecoder](../gateway/src/main/java/com/riskcontrol/gateway/auth/CachingJwtDecoder.java), [LocalRateLimiter](../gateway/src/main/java/com/riskcontrol/gateway/security/LocalRateLimiter.java) |
| 5 | **Idle screens slow down.** Without the stream, a page nobody has touched for 5 minutes polls every 30 s instead of 2 s (hidden tabs already stopped). | live.ts |

### Push, measured

Same laptop and limits as above (Gateway 1 CPU, 512 MB). Each simulated viewer holds a stream watching the Overview and the re-test count, as the dashboard does; every 5 seconds a writer adds a risk, which always changes the Overview, and the test records when each viewer receives it ([load-tests/live-load.mjs](../load-tests/live-load.mjs)).

| Viewers live | Streams held | Changes delivered | p50 | p95 | Requests the services answered | Gateway |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 1,000 | 12,000 of 12,000 | 224 ms | 1.08 s | 2.1 /s | 377 MiB |
| 2,000 | 2,000 | 24,000 of 24,000 | 920 ms | 1.34 s | 2.2 /s | 85% CPU, 367 MiB |
| **4,000** | **4,000** | **48,000 of 48,000** | **505 ms** | **0.82 s** | **2.1 /s** | 90% CPU, 395 MiB |
| 8,000 | 8,000 | 89,250 of 96,000 within 5 s | 4.1 s | 7.9 s | 1.6 /s | 500 MiB of 512 |

- **The services' load no longer depends on how many people are watching**: about 2 requests a second whether 1,000 or 8,000 are live. With polling, 4,000 people would have been about 7,000 requests a second, 15 times what the laptop could serve.
- **One Gateway (1 CPU, 512 MB) holds about 4,000 live viewers comfortably.** At 8,000 it ran out of memory (each stream costs it about 35 KB), not CPU; more memory or more Gateways raise it directly.
- A browser check confirms it end to end: an open Overview sends **no requests** while it sits there (25 in 10 seconds before), and a risk added elsewhere appears on it in 0.5–1.2 s.

**Found and fixed while testing push.** The first version kept each address's latest answer in Reactor's replay sink, which copies its whole subscriber list on every join and leave: with thousands of viewers on one address that took a quarter of the Gateway's CPU (profiled with Java Flight Recorder) and slowed the ramp-up. It now uses a concurrent set (constant time) where a slow viewer keeps only the newest update ([Broadcast](../gateway/src/main/java/com/riskcontrol/gateway/live/Broadcast.java)); one shared heartbeat replaced a timer per stream; and the streams are left out of the request metrics, whose active-request timer struggled with thousands of hour-long "requests". Gateway CPU at 2,000 viewers went from 101–104% to 85%.

### Polling, measured again

For browsers without the stream: at 250 users, back to back on the same build after a cool-down, the new Overview (2 requests) against the old (5 requests):

| Overview polls | Requests/s | p95 | |
| --- | --- | --- | --- |
| New: 2 requests | 269 | **21 ms** | ✅ |
| Old: 5 requests | 457 | 801 ms | ❌ |

41% fewer requests for the same people, and the service level met with room to spare. (The first pair, run with JVMs just started, was slower for both; the second pair is the fair comparison.)

### Caching, second pass

| Change | Measured |
| --- | --- |
| **One fetch per address for the whole cluster.** With several Gateways each hub polled the same addresses (worst case 50 Gateways × 2,000 addresses = 100,000 requests a second). Now one Gateway owns each address through a 3-second lease in Redis, fetches it, and publishes the answer to every Gateway over Redis pub/sub; without Redis, each Gateway falls back to fetching for itself. | Two Gateways, 4,000 viewers: the services answered **2.2 requests a second**, the same as one Gateway (2.1), not double; 48,000 of 48,000 changes delivered, p95 1.3 s |
| **Each change encoded once per Gateway**, every viewer handed the same bytes, instead of building the event text per viewer | One Gateway, 4,000 viewers, after a cool-down: delivery p95 **0.70 s** (0.82 s before), 48,000 of 48,000. Memory couldn't be compared: the JVM grows its heap toward its limit on its own schedule (259 MiB in one run, 510 MiB in the next) |
| **The heat-map cache survives text-only edits.** A change to a risk's title, description or category no longer clears the heat-map counts, only what shows the text | Covered by a test (`aTextOnlyEditKeepsTheHeatMapCachedAndAScoreEditClearsIt`) |

Not built, because the shared hub makes them negligible: a **running read model** for the heat-map (counts updated per change instead of recounted) and **serving the cached JSON as stored** instead of re-encoding it. With one fetch per address per second for the whole cluster, the heat-map is recounted at most once a second however fast risks change, and the services answer a few requests a second in total. Both are worth revisiting only if the services were again answering thousands of reads a second.

One Gateway with 512 MB still reaches its memory limit at 8,000 viewers (93% delivered within 5 s); more memory per Gateway or more Gateways is the lever there, and the hub now lets Gateways be added without adding load to the services.

## Estimates for more people

### With push (the platform as it is now)

What grows with people is the Gateway: open connections (about 35 KB each) and fanning out each change. The services see one fetch per watched address per second for the whole cluster (shared hub, below), plus writes (about 0.5 a second per 200 people).

| People live | Gateway | Services and databases |
| --- | --- | --- |
| 4,000 | 1 instance: 1 CPU, 512 MB (measured) | about 2 requests/s (measured) |
| 100,000 | about 25 CPU cores and 4 GB in total, e.g. 5 instances of 5 cores and 1 GB | one fetch per watched address per second for the whole cluster (at most the number of distinct addresses, up to a few thousand/s), plus about 250 writes/s |
| 1,000,000 | about 250 cores and 40 GB, e.g. 25–50 instances | the same: one fetch per watched address per second, whatever the number of Gateways, plus about 2,500 writes/s |

These assume changes at the rate tested (a visible change about every 5 seconds). The Gateway never pushes an address more than once a second, so the worst case is about 5 times the fan-out work above: still a fraction of polling. Gateways share one hub through Redis, so adding Gateways adds no load to the services; they scale by adding instances behind a load balancer. A million open connections is where load balancers and kernels need tuning for connection counts; that isn't tested here.

### Before push, for comparison

With every screen polling every 2 seconds (4.6 ms of CPU per request, 1.8 requests a second per person, 65% utilisation): about **80 people per core**, so 1,000 people ≈ 13 cores, 100,000 ≈ 1,300 cores, 1,000,000 ≈ 13,000 cores.

### Limits beyond the Gateway

1. **More service instances** for writes: each service sends its outbox from a single publisher (ARCHITECTURE.md §8.2); several instances need the outbox rows claimed per instance (`FOR UPDATE SKIP LOCKED`). Kafka topics have 3 partitions, so at most 3 consumers per service.
2. **Sign-ins**: about 10 a second per Gateway core (bcrypt). A morning peak of 100,000 people over 15 minutes needs about 11 cores for that alone; a bank would use its single sign-on.
3. **Redis** is no longer on every request (rate limits are local), so it is not a ceiling for reads.

### For scale

A risk register is used by risk, control and audit staff: a large bank has a few thousand such users, with hundreds online at once. One laptop now keeps 4,000 of them live. 100,000 to 1,000,000 concurrent users is consumer-app scale; the estimates show what it would take, not what the platform is expected to face.

## Not yet tested under load

The architecture's test plan (ARCHITECTURE.md §16) also lists reliability tests. Where they stand:

| Test | Status |
| --- | --- |
| Duplicate replay (no score changes twice) | Covered by automated tests and by the independent reviewer's replay of a captured event (docs/security-review.md, SEC-07); not repeated under load |
| Consumer outage (Risk Service stopped, then catches up) | Tested without load during development (back in 21 s, nothing lost); not under load |
| Assessment burst (1,000 tests in 60 s) and producer crash during it | Not done |

## Running it

```bash
node load-tests/run.mjs                          # 100, 250, 500, 1000 people, 2 min each, plus sign-ins
node load-tests/run.mjs --levels 50,100,200 --hold 1m --cooldown 60 --k6-cpus 1 \
  --compose-extra load-tests/variants/laptop.yaml   # sized for a 4-core laptop (as above)
```

It stops the normal stack while it runs (its data is kept), starts a throwaway copy, watch it in Grafana at http://localhost:3001, and starts the normal stack again at the end (`--keep` leaves the copy running). Results are printed and saved in `load-tests/out/` (git-ignored).
