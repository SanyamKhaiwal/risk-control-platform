# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Real GRC practitioners at a bank or large company, using it as a daily tool (confirmed: design for them first, not for demo viewers):

- **Risk owners** keep their risks scored and linked to the controls that mitigate them.
- **Control owners** define controls.
- **Control testers** assess controls (effective / partially effective / ineffective) and work through the re-test queue.
- **Viewers** (risk committee, auditors) read the register and heat-maps.

Secondary audience: hiring managers and engineers watching a 2-minute demo. They are served by the product being believable as a real tool, not by extra show.

## Product Purpose

A cut-down GRC risk & control assessment platform. Risks are scored by likelihood × impact; linked controls reduce residual likelihood (preventive) or impact (detective/corrective); assessments recalculate residual risk automatically within about a second through an event pipeline. Success: a user can see where residual risk sits, why it moved, and what needs re-testing, without asking anyone.

## Positioning

Residual risk is live and causal: a single control assessment visibly moves a risk on the residual 5×5 heat-map within a second, and every move traces back to the assessment that caused it (score history carries the causing event id; assessments are hash-chained and verifiable). Enterprise tools like OpenPages or Archer recalculate on batch cycles and bury the cause.

## Operating Context

- Office desktops and meeting-room projectors in bright light; information-dense, scanned repeatedly through the day.
- Login with one of five seeded demo users (alice risk owner, bob control owner, carol tester, dave viewer, erin owner + tester); password `demo123`, local development only.
- All API calls go through the gateway at `VITE_API_URL` (default http://localhost:8080) with a bearer token; tokens last 30 minutes, no refresh.
- The UI polls the cached dashboard endpoints; it does not read Kafka.

## Capabilities and Constraints

- API (see docs/ARCHITECTURE.md §9): risks CRUD with status changes (no delete), filters by status/rating/owner/control, score history; link/unlink controls; inherent and residual 5×5 heat-maps (`inherent[likelihood-1][impact-1]`), top risks; controls CRUD; record assessments; assessment history; hash-chain verify; re-test flags.
- Ratings: LOW 1–5, MEDIUM 6–11, HIGH 12–19, CRITICAL 20–25. Closed risks are excluded from dashboards.
- Rules the UI must reflect, not re-implement: only a risk's owner edits it; only a control's owner edits it; testers can't assess controls they own (403 "Segregation of duties"); owner and tester always come from the token.
- Errors are RFC 7807 problem+json (`title`, `detail`, `errors` map for field validation).
- Stack is fixed by the architecture: React 19 + TypeScript + Vite, tested with Vitest + React Testing Library.

## Brand Commitments

- Name: "Risk & Control Assessment Platform".
- Must not look like a generic admin template (sidebar + cards + chart widgets) — confirmed.
- Must not feel flashy: no neon, gradients or heavy animation; it has to feel trustworthy to a bank — confirmed.

## Evidence on Hand

- No real customers, testimonials, benchmarks or performance numbers exist yet; none may be invented. Performance numbers come from build step 15.
- All data is synthetic demo data created by the seed script (scripts/seed-demo.mjs); label it as demo data where a viewer could mistake it for real.

## Product Principles

1. Show cause, not just state: every residual score can be traced to the assessment that moved it.
2. Density over decoration: a practitioner should scan the register and both heat-maps without scrolling through chrome.
3. The role decides the screen: actions a user's role can't take are absent or explained, never left to fail.
4. Calm under change: live updates are visible and legible, never theatrical.
5. Plain words first (confirmed after a walkthrough, 29 Oct 2026): someone who has never heard of GRC must understand every screen. Say "Before controls / Risk now", "how likely × how bad", "Works / Works partly / Doesn't work", "Stops it happening / Spots it quickly"; keep jargon (inherent, residual, effectiveness, hash) out of labels. Explain why a score is what it is, and tell each role what to do next.

## Accessibility & Inclusion

Rating colours must never be the only signal (pair with the rating word or score); readable on a projector in a bright room; full keyboard operation for forms and tables. Target WCAG 2.2 AA.
