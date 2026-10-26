# Minilytics assessment

Reviewed on 26 October 2026 at upstream commit [`d665db48ad253b8f037af8459c960650cdc02fc3`](https://github.com/surendrapandar/minilytics/tree/d665db48ad253b8f037af8459c960650cdc02fc3). This is a source review. No live upstream installation, remote database, payment account, or Cloudflare account was exercised.

## What is worth keeping

Minilytics offers a useful small-product scope. It connects acquisition, activity, goals, and payments without a large infrastructure footprint. Its runtime consists of a Hono Worker and D1, with a Vite/React dashboard and tracker delivered through Workers Static Assets. See [configuration](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/wrangler.jsonc) and [package scripts](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/package.json).

The feature set includes multiple sites, period comparisons, source and campaign filters, geography/device breakdowns, SPA pageviews, engagement time, custom goals, funnels, visitor timelines, a Dodo integration, and generic server-side goals/payments. See [README](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/README.md), [routes](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/src/worker/index.ts), and [stats](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/src/worker/stats.ts).

Its payment matching records the matching method and gives credit to the last non-direct session. This is a useful basis for explaining attribution to users. Its timing heuristics are estimates, however, and the new product should make that distinction visible. See [payments.ts, lines 29-145](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/src/worker/payments.ts#L29-L145).

## Constraints that affect our implementation

| Observation | Evidence in the pinned source | Consequence for Analytica |
| --- | --- | --- |
| One administrator owns every site. Login checks one configured password and issues an `admin` cookie. | `src/worker/index.ts:20-116`; schema has no users or memberships | Build workspace membership and role checks before offering hosted accounts. |
| A public event supplies its own page URL, visitor ID, and session ID. The collector checks the URL's hostname. | `src/worker/collect.ts:46-74` | Treat browser events as untrusted telemetry. A hostname check cannot authenticate the sender. Add origin checks where available, quotas, payload validation, and abuse controls. |
| Events have database-generated IDs, not a client idempotency key. Session counters increase for each delivery. | `collect.ts:143-174,213-227`; `migrations/0001_init.sql` | A replay can inflate counters. Introduce event IDs and atomic deduplication before retries or Queues. |
| Session identity comes from cookies. The collector does not enforce that an existing session belongs to the submitted visitor. | `public/js/script.js:60-67`; `collect.ts:108-174` | Enforce visitor/session consistency server-side and test concurrent tabs, expired sessions, and reordered events. |
| `ping` updates duration and last seen but does not create a missing session. Each call to the tracker ID helper renews cookies. | `collect.ts:113-122`; tracker `ids()` and `flushTime()` | Write an explicit inactivity and engagement contract. Visible time is different from user activity; heartbeat traffic must not keep a session alive forever. |
| URL privacy uses a parameter denylist. Full URL and referrer can leave the browser, including values the denylist misses. | `public/js/script.js:72-89,124`; `collect.ts:233-260` | Send only an allowlist of attribution fields, strip fragments, support sensitive-path redaction, and sanitize on the server too. |
| A return-page `payment_id` can link an unassigned payment and copy its name/email into the claimed visitor. | `collect.ts:182-212` | Require a signed, single-use checkout correlation token. A public query parameter is insufficient proof of purchase identity. |
| Revenue totals sum amounts without a currency restriction. Dodo conversion only happens when matching settlement information is present. | `stats.ts:93-116,147-178`; `payments.ts:256-262,320-349` | Keep totals per currency, or reject unsupported currency at intake. Never sum minor units from different currencies. |
| Dodo payment IDs use a global primary key. Generic payment IDs include the site ID. | `migrations/0001_init.sql:77`; `payments.ts:153-165,264,339` | Use composite tenant/site/provider identifiers for events, payments, refunds, and webhook receipts. |
| Funnels read at most 100,000 events and calculate progress in Worker memory. | `stats.ts:406-451` | Bound funnel queries and report truncation; do not show a partial result as complete. |
| Queries commonly scan sessions/events for every dimension and comparison. | `stats.ts:147-178,234-319` | Measure scanned rows and isolate expensive reporting from collection. Rollups require explicit metric rules. |
| Site configuration is cached per isolate for 60 seconds. Its invalidation helper affects only the current isolate. | `env.ts:23-43`; `index.ts` site update/delete handlers | Config changes can remain stale elsewhere. The generic payment key lookup reads D1 directly, so this cache is not evidence that a rotated bearer key remains accepted. Keep membership, revocation and setup ownership strongly checked. |
| Geolocation accepts Vercel headers from requests before using Cloudflare metadata. | `collect.ts:88-103` | Trust proxy metadata only from an authenticated proxy integration; otherwise use Cloudflare edge metadata. |
| Reporting computes one timezone offset at the range end and uses it across every bucket. | `stats.ts:82`; `lib/time.ts:109-129` | Do not reuse it as proven DST-correct bucketing. Test spring/fall transitions, repeated hours and midnight boundaries using IANA rules. |

These observations describe behavior in the reviewed commit. They are not claims that the upstream project promises multi-tenant SaaS guarantees.

## Deployment and cost corrections

Upstream provides a manual clone, database creation, secret setup, and deploy workflow. It does not currently ship a Deploy to Cloudflare button. Its deploy script migrates a database by name. Our template must migrate by binding so a user can rename the resource. Cloudflare documents the [button setup and migrations convention](https://developers.cloudflare.com/workers/platform/deploy-buttons/).

D1 Free includes 5 GB across an account, but a single free database is limited to 500 MB. Paid databases allow 10 GB each. Each database executes queries serially, so a queue buffers bursts but does not remove its throughput limit. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

The free allowances are not a pageview guarantee. Heartbeats, goals, session updates, indexes, dashboard reads, and retention deletes all consume resources. Use measured rows read/written and request counts. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Reuse policy

The [MIT license](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/LICENSE) permits commercial reuse. Keep the upstream copyright and permission notice with copied or substantial adapted code. Record reused paths and commit in `THIRD_PARTY_NOTICES.md` when code is introduced. New visual design and copy are product decisions, not a condition of the MIT license. Do not describe the work as a legal clean-room implementation after inspecting upstream source.

Recommendation: build a new application around a written metric and ingestion contract, selectively adapting reviewed utilities if useful. Avoid starting the hosted service by adding a tenant column to every existing handler without changing its authorization and data invariants.

## Local verification

Installed the pinned upstream lockfile in the temporary checkout with `npm ci --ignore-scripts`. On 26 October 2026, `npm test` passed all 18 tests, `npm run typecheck` passed, and `npm run build` passed. The production dashboard JavaScript bundle was about 637 KB uncompressed and 183 KB gzipped. These checks establish that this source builds locally; they do not exercise live ingestion, D1 concurrency, tenant isolation, or payments.

`npm audit` reported 9 dependency entries: 6 moderate, 1 high and 2 critical. Several entries refer to the same underlying advisory through dependency chains. They are predominantly build/test/development tooling, including Vitest/Tinypool, Wrangler/Undici and Tailwind's PostCSS dependencies. This is a dependency report, not evidence that the deployed Worker is remotely exploitable. The new project should select supported versions and investigate affected execution paths before reusing the lockfile. Relevant primary advisory records include [Tinypool](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), [Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), and [Undici](https://github.com/advisories/GHSA-4qv8-2p9j-2685). No automated dependency fixes were applied upstream.

## Independent research

- [Antigravity product report](research/antigravity-review.md). Input for navigation and onboarding. Treat its zero-cost, zero-configuration, scale, and privacy assertions as proposals until the release checks in the implementation plan pass.
- [GLM ingestion and tenant report](research/glm-review.md).
- [DeepSeek deployment report](research/deepseek-review.md).
- [Research reconciliation](research/README.md) records which recommendations were adopted, deferred, or rejected.
- [GPT-6.1 Sol review](research/sol-review.md) is complete. Its [disposition record](research/review-disposition.md) records the incorporated corrections. The resulting plan is ready for Phase 0 investigation; runtime and deployment readiness remain unproven.
