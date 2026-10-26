# Independent source and plan review

Reviewer: OpenAI, `gpt-6.1-sol`, through the Codex harness in T3 Code, high reasoning effort. Reviewed 26 October 2026. I performed this review myself and started no agents.

I read `docs/implementation-plan.md`, `docs/minilytics-assessment.md`, `docs/research/README.md` and all three provider reports. I independently inspected the source checkout at `/tmp/analytica-research/minilytics-d665db4` and confirmed its HEAD is `d665db48ad253b8f037af8459c960650cdc02fc3`. Source links below refer to that pin. Cloudflare and Better Auth links are primary documentation consulted during this review.

This is a planning review. No app exists in this workspace. I did not build, repeat upstream tests or audits, deploy, access accounts, handle credentials, modify upstream, or create a PR. The main agent's recorded 18 passing tests, typecheck, build and scoped dependency audit are accepted as local evidence only. No proposed runtime or deployment behavior has been validated here.

## Verdict

The plan is ready for a bounded Phase 0 investigation. It is not ready to pass Phase 0, start the full implementation, or collect customer data without the decisions and evidence below. Its central choices fit the request: original UI/copy, Cloudflare hosting and storage, hosted deployment, and an official guided Cloudflare self-host flow. There is no reason to add the other providers' enterprise features or infrastructure before measurements justify them.

No P0 critical finding is established. P1 findings block the affected implementation or release; they do not prohibit a disposable Phase 0 experiment. P2 findings require corrections to contracts, evidence or acceptance criteria before the corresponding feature is built.

## Severity-ranked findings and required corrections

### P1-1. The alpha can ship before its own safety and feature requirements exist

Evidence: [implementation plan](../implementation-plan.md), lines 17-23, 138-154 and 210-217.

The release table promises a generic payment/refund API, daily cleanup, limits and hosted staging/production in the first alpha. The roadmap places money APIs in Phase 3 and deployment, retention, deletion, export and recovery in Phase 4, while line 217 permits a deployed alpha after Phase 2. Opt-out is listed under v1 even though Phase 1 builds privacy modes and opt-out. Session/key revocation and recovery also appear as v1 features despite being required for the hosted alpha authentication contract.

An alpha after Phase 2 can be a synthetic-data demonstration. It cannot satisfy the stated customer alpha without pulling forward prerequisites. Invitation-only access does not make stored visitor activity, payment identity or compromised sessions harmless.

Required correction: define a single alpha gate. Before external customer collection, require tenant authorization, working logout/revocation and recovery, consent/opt-out behavior, bounded intake and storage, scheduled retention, an operator-supported deletion/export procedure, and isolated deployment resources. Keep customer payments disabled until Phase 3 passes, or move the minimal ledger/refund work into the alpha path. A full self-service deletion UI and full role-management UI can follow later. Make the release table and phase dependencies agree. Capacity testing may overlap development, but an admission envelope must pass before customer intake starts.

### P1-2. Ninety-day analytics retention conflicts with thirteen-month attributed revenue unless the surviving data is specified

Evidence: [implementation plan](../implementation-plan.md), lines 87-95, 109-112 and 140-146. Upstream filtered revenue [joins sessions](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/src/worker/stats.ts#L93-L103), and its customer report joins both visitors and sessions at lines 339-355.

Deleting a credited session after 90 days can remove the source/campaign information needed to explain a payment retained for 13 months. A cascading foreign key could delete revenue; a restrictive one could block retention; keeping references without their targets leaves misleading reports. Retaining customer IDs, emails or attribution links in the ledger can also preserve identity after deleting a visitor row. The current text does not choose among these outcomes. A 30-day attribution evidence window does not resolve the lifetime of an already-created attribution link.

Required correction: define the retention and foreign-key behavior of payment receipts, refunds, customer identity, checkout claims and attribution links separately. One possible design is a minimal versioned attribution snapshot with explicitly allowed dimensions, followed by removal of expired visitor/session links. This is a proposal to assess, not a validated schema. Define whether later refunds inherit that snapshot and how rematching works after detail expires. A retained payment must not silently disappear because its session expires.

Add a feature/retention matrix for periods crossing the 90-day boundary. Specify which summaries retain which dimensions, which filters are unavailable, and how deletion affects retained totals and identity. Site deletion must cover every summary; individual identity erasure needs a separate policy rather than an assumption that deleting `visitors` removes all personal data. Include recovery snapshots and reapplication of deletions in the restore procedure.

Acceptance: advance a fixture through detail expiry, then issue a partial refund, run reports with and without source filters, erase identity and delete the site. Verify money totals, retained explanations and actual remaining columns.

### P1-3. Event deduplication is specified, but summary and payment idempotency still have missing contracts

Evidence: [implementation plan](../implementation-plan.md), lines 93-105, 109-112, 134 and 144-146. The [D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) documents sequential transactional execution and rollback on failure. It does not validate this application's insert-gating design.

The plan correctly rejects an unconditional counter update after `INSERT OR IGNORE`. The same rule must govern summary checkpoints, quota counters, payment normalization, claim consumption and corrections. A checkpoint advanced separately from summary writes can lose or double-count data after a crash. An event arriving within the allowed 24-hour delay can change a bucket already summarized. Payment corrections and late rematching can change attribution after a summary was written.

Webhook event IDs deduplicate delivery, not economic transactions. A generic API call and a Dodo webhook can describe the same sale using different event/provider identifiers. Conversely, two integrations can use identical locally scoped transaction IDs. The proposed uniqueness rules do not state how either case is handled. Reusing an idempotency key with a different amount or visitor also needs a defined conflict response.

Required correction: specify accepted-event identity and payload-conflict behavior, the deduplication lifetime relative to retention/retry limits, atomic checkpoint advancement, and how late/corrected data marks or rebuilds affected buckets. Summary replacement per bucket is a candidate; it must be tested. Define a canonical transaction namespace, integration/account scope and an explicit policy for overlapping API/webhook ingestion. Define distinct refund IDs, original-transaction references, pending refund-before-payment state, currency consistency and correction records. Either prevent both inputs for one sale or require an explicit shared transaction mapping.

Phase 0 must test duplicates with changed payloads, failure between each derived mutation, rerun of a maintenance batch, late data after summarization, and one sale arriving through both supported paths. Refund fixtures must include several partial refunds and an inconsistent cumulative refund amount, with a documented reject/quarantine policy.

### P1-4. A signed checkout token needs a trusted issuer and binding contract

Evidence: [assessment](../minilytics-assessment.md), line 23; [implementation plan](../implementation-plan.md), lines 94, 103, 109, 140 and 213. Upstream [return-page claiming](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/src/worker/collect.ts#L181-L203) accepts a public payment/subscription parameter and then updates payment and visitor records. Upstream [metadata matching](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/src/worker/payments.ts#L47-L94) also accepts the supplied visitor identity without establishing its provenance.

Signing attacker-supplied visitor/payment IDs through a public minting endpoint would preserve the same attribution-poisoning path. A valid provider webhook proves delivery provenance, not that every metadata field was originally supplied by a trusted backend. A bare visitor ID is public telemetry, not evidence of a customer identity.

Required correction: define an authenticated checkout-creation or correlation-issuance flow. Bind a claim to workspace/site, integration, checkout or transaction, consent-eligible visitor/session, expiry, purpose and nonce. Define signature key rotation, atomic single-use consumption and delivery-order behavior. An untrusted collector must not mint, exchange or repoint payment identity using arbitrary IDs. Keep aggregate-mode payments unmatched to persistent browser identity, even if revenue totals are recorded. Preserve the distinction between a verified correlation and a verified human visit.

Acceptance: test a swapped visitor, cross-site checkout, expired/reused token, browser-supplied metadata, webhook-before-return and return-before-webhook. These are proposed tests, not verified security properties.

### P2-1. Free-tier authentication and maintenance need a firmer Phase 0 decision gate

Evidence: [implementation plan](../implementation-plan.md), lines 75, 150-154 and 210. [Better Auth documents scrypt as its default](https://better-auth.com/docs/authentication/email-password#configuration). [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) specify 10 ms CPU for Free HTTP requests and Free Cron invocations. Database/network wait is excluded; asynchronous JavaScript alone is not evidence of zero CPU cost.

The plan appropriately marks Better Auth and passkeys as candidates. Compatibility with D1 or `nodejs_compat` does not establish that secure hashing fits Free CPU. The maintenance path is also missing from the explicit free-mode CPU gate. A paid daily Cron budget must not be assumed for free self-host cleanup, summaries or deletion.

Required correction: record the selected library/version, hashing implementation and security parameters, memory/bundle constraints, D1 adapter and migration behavior. Measure owner creation, correct/incorrect password verification, recovery and representative reports/maintenance in the actual target runtime. Record tail CPU and resource-limit errors; a p95 below 10 ms alone can hide repeated failures. Never weaken password hashing merely to meet Free limits. If it does not fit, choose and test a passkey/recovery flow or state a paid-plan requirement before promising free operation. Passkeys also need a chosen RP ID/origin and a policy for moving from `workers.dev` to a custom domain.

Bootstrap requirements are sound but need explicit fixtures. Reject placeholders, keep setup proof out of URLs/logs, close alternate signup paths, and atomically create user, workspace, membership and consumed setup state. Test two different simultaneous owner claims, failure halfway through setup, restart, upgrade and restore. Recovery must not silently turn into public first-visitor registration. These are Phase 0 requirements, not deployment facts established by this review.

### P2-2. Aggregate mode and session ordering need precise observable rules

Evidence: [implementation plan](../implementation-plan.md), lines 105-113 and 138-142.

In-memory tab IDs disappear on a full navigation. The same person's two document loads therefore need not share a session even within 30 minutes, while SPA navigation can retain one. The current labels exclude cross-tab and cross-session identity but do not explain this full-navigation discontinuity. Saved filters must also distinguish the two privacy modes rather than presenting their combined distinct IDs as a comparable people count.

An ingestion sequence resolves ties by arrival order, not necessarily action order. For a funnel, two same-millisecond client actions arriving in reverse order can change completion. Using received time for intake is sensible, but the server still needs a rule for late interactions, immutable session start, entry/exit ordering, and an interaction arriving after a heartbeat-only idle period.

Required correction: describe aggregate counts as observed tab/ID counts with navigation limitations, or narrow that mode to pageviews/events and clearly defined session estimates. Decide whether session-scoped funnels are supported there. Define ordering with a bounded client sequence plus event ID where appropriate, session-expiry clock, repeated funnel-step behavior and conversion denominators. Unmatched payments or purchases attributed to earlier visits must not be divided by this period's unrelated visitors and labeled a cohort conversion rate.

Upstream is not a safe timezone reference. [GLM](glm-review.md), lines 62 and 154, calls its time handling correct, while [DeepSeek](deepseek-review.md), lines 45 and 71, recommends reusing bucketing. In fact, [stats.ts:82](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/src/worker/stats.ts#L82) computes one offset at the range end and [time.ts:109-129](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/src/worker/lib/time.ts#L109-L129) uses it for every bucket. Ranges crossing DST need different offsets. `startOfDay` also uses the offset at the input instant, which can differ from midnight on a transition day. Retain the plan's IANA/DST requirement and add spring/fall, repeated-hour and site-timezone-change fixtures. Define whether old summaries can be rebucketed after raw detail expires.

### P2-3. Admission limits and deletion need an authoritative state transition

Evidence: [implementation plan](../implementation-plan.md), lines 67-81, 96, 103 and 146; [research reconciliation](README.md), lines 20 and 25-27.

The selected architecture rejects KV for exact security counters and leaves Durable Objects optional, but does not select the initial atomic quota mechanism. Per-isolate throttles cannot enforce a global tenant/storage ceiling. An unconditional D1 lookup/write for every rejected request can itself exhaust the resource it is meant to protect. Fine-grained edge throttling can be approximate, but the plan needs to distinguish it from authoritative admission.

Deletion also needs to stop new intake first. Upstream [getSite caches configuration for 60 seconds](https://github.com/surendrapandar/minilytics/blob/d665db48ad253b8f037af8459c960650cdc02fc3/src/worker/env.ts#L23-L35). A stale enabled-site cache can admit events while a chunked delete or summary rebuild is running. Optional cached configuration must not establish deletion/revocation state.

Required correction: propose an insert-gated D1 usage counter and enabled/deleting-state check inside the intake transaction for Phase 0, or select a measured alternative. Define duplicate quota charging, global/per-site limits, quota resets, admin/reporting/cleanup headroom, backpressure and bounded client retry. Disable the site before deleting rows and prevent summaries/jobs from recreating them. Test intake racing site deletion, membership removal and key revocation across independent requests, plus a flood against one tenant while another still ingests and reports. Do not claim immunity to a single-database denial-of-service attack from a small load test.

### P2-4. Deployment advice is plausible, but acceptance must pin the exact configuration and permission path

Evidence: [implementation plan](../implementation-plan.md), lines 65, 162, 168-178 and 232-246. The [official deploy-button documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/) supports D1 provisioning, example-file secret prompts and migrations by binding. It also distinguishes repository-root applications from unsupported subdirectory layouts with outside dependencies.

The proposed npm workspace can work as one repository-root deployment. It must not be published with a button targeting `apps/worker` while its dependencies remain in sibling packages. Copying upstream's `/api/*` asset-routing rule would also omit the new `/v1/*` and `/healthz` routes. Pin an explicit route matrix and test unknown dynamic endpoints, navigation requests, `OPTIONS`, and ordinary asset loads. [Static Assets routing documentation](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) explains why SPA fallback and Worker-first routing need deliberate configuration.

The [Workers Builds permission list](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token) currently omits D1. That is reason to test migration authorization, not proof that every generated token fails or that the button has an undocumented permission bypass. Likewise, neither the docs nor the reports establish automatic secret generation or the exact placeholder-prefill behavior.

Required correction: make the Phase 0 evidence identify the Wrangler version, root build/deploy commands, effective rewritten config, provisioning order, runtime versus build secrets, migration binding and actual permission scope. Test first deploy, renamed resources, failed/partially completed migration, retry, second deploy, and update without data/owner recreation. Keep the environment selection identical for migration and Worker deployment. If the normal button path needs a manually created API token, assess that against the guided-install target before declaring success. A CLI fallback does not pass the button requirement. All of this requires later authorized Phase 0 account testing; it was not performed here.

### P2-5. The plan's arithmetic is sound, but its storage and fixture envelope is incomplete

Evidence: [implementation plan](../implementation-plan.md), lines 184-202; [DeepSeek report](deepseek-review.md), lines 188-209. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) support the stated basic allowances. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) distinguish the 500 MB Free and 10 GB Paid per-database caps.

The plan correctly computes 230,000 collection requests and 1.84 million writes per month at eight writes/request; the tenfold example is also correct. At an even 30-day distribution, the small example averages about 61,333 writes/day before auth, cleanup and other work. That is not evidence of fitting the daily cap during spikes or fitting 90-day storage.

At the small workload, 90 days holds about 390,000 pageview/goal/outbound records, or about 690,000 event records if engagement envelopes are also retained. A decimal 500 MB divided by those counts permits only about 1,282 or 725 bytes per event across the entire database before allowing for visitors, sessions, indexes, summaries, auth and money records. This is a sizing illustration, not a measured row size or a finding that the app necessarily exceeds the cap. Decide whether heartbeats leave persistent event/dedupe rows. The 100,000-event report fixture is smaller than either retention scenario.

Required correction: test at the advertised retention/admission ceiling with realistic bounded fields, indexes, summaries and concurrent maintenance. Record peak storage, database size after deletion, and per-event-class reads/writes/CPU. Reserve headroom so quota exhaustion does not prevent auth, cleanup or recovery. Account for staging resources and other account workloads sharing allowances. Replace the assumed average write multiplier with measurements before publishing quotas.

DeepSeek's 10M-pageview example has a concrete subtotal error. Its own 68M writes and 22M requests imply $18 write overage + $3.60 request overage + $5 base = $26.60 before CPU, storage, reads, builds and logs. Adding its assumed $1-2 for CPU/storage gives $27.60-28.60, rather than $22-27. Its 20M example reaches $101.20 from those three components alone. Neither example establishes capacity or a commercial margin. The reconciliation correctly flags the missing base fee; do not reuse the report's revenue/margin conclusion.

## Objections to provider claims and reconciliation decisions

The plan has resolved most of the dangerous advice correctly. The remaining report claims should remain historical inputs, not implementation specifications.

| Provider advice or claim | Review decision and evidence |
| --- | --- |
| Antigravity's enterprise positioning, maps, multiple gateways, multi-touch models, AI/SDK generation, automatic archives and email digests | Reject as first-release requirements. They exceed the stated Minilytics-like scope. The plan correctly defers them. Its original task-oriented UI and clear unmatched-payment states are useful product proposals, subject to a later design review. See `antigravity-review.md:18-24,239-301,487-506`. |
| Antigravity's active API keys in KV, relational "row-level security", and queue/Analytics Engine bypass of SQLite contention | Reject as guarantees. KV is unsuitable for immediate key revocation. SQL tenant predicates are application authorization, not a separately enforced RLS policy. Queues still deliver writes to D1; Analytics Engine changes the data model. Its proposed schema also preserves plaintext keys and a global payment primary key. See `antigravity-review.md:168,186-189,343-435`. |
| Antigravity's verified free database storage and zero-cost operation | Correct the per-DB cap and treat workload feasibility as untested. Its table uses the account's 5 GB as database capacity, and its architecture has no tested free authentication/retention envelope. See `antigravity-review.md:175-182,514`. |
| Antigravity's instruction to embed webhook secrets in a coding-assistant setup prompt | Explicitly reject. Installation examples and generated prompts should use public site IDs and secret references/placeholders. This would disclose server-side signing material outside the chosen hosting/data system. See `antigravity-review.md:300-301`. |
| GLM's IP/UA-derived cookieless identity and EU-only mode | Reject as the plan does. A hashed IP/UA identifier is still a fingerprinting design; country-only reporting or an EU location hint does not establish residency or consent compliance. See `glm-review.md:208-216` and `README.md:22-23`. |
| GLM's raw administrator password, KV auth counters, and successful acknowledgement of quota-discarded events | Reject. These contradict per-user revocable auth, authoritative security state and delivery semantics. See `glm-review.md:193-195,220-235`. |
| GLM's shared DB acceptable to "tens of GB", tenant DBs sidestepping limits, and 100-300 qps | Reject as capacity evidence. Every database still has its own cap and serial execution; tenant routing/provisioning and migrations add work. The plan correctly requires a measured envelope. See `glm-review.md:114,187-188,229`. |
| GLM's browser retries, uncleaned login failures and reusable session behavior | Narrow the factual claims. The tracker falls back from an unqueued beacon to fetch; it has no application retry loop. Login failures are cleaned during failed login and cleared for an IP on success. Its suggested session-expiry check on `last_seen_at` would still let heartbeats extend sessions indefinitely. See `glm-review.md:134,144,199-202`; upstream `public/js/script.js:83-94`, `index.ts:47-54`, `collect.ts:116-121`. The plan's separate interaction clock is the right correction. |
| DeepSeek's D1-first, single deploy unit and deployment failure matrix | Adopt. Keep its build-token failure, example-secret prefill and secret-generation assertions as hypotheses. "Verified by omission" is insufficient proof that a platform feature does not exist. See `deepseek-review.md:104,122,143,245-258,358-371`. |
| DeepSeek's external email dependency and Antigravity's Resend/Postmark digests | Do not adopt an external service by default. Current [Cloudflare Email Service documentation](https://developers.cloudflare.com/email-service/) describes transactional Email Sending beta on Workers Paid and verified-destination sending on Free. Evaluate eligibility, domain setup, binding behavior, delivery/recovery, cost and self-host implications in Phase 0. This does not establish that Email Routing alone supports arbitrary customer signup email or that an account has sending enabled. See `deepseek-review.md:347,426` and `antigravity-review.md:505`. |
| Assessment's site-cache/API-key-rotation observation | The missing invalidation call is real, but it does not establish continued acceptance of the old generic bearer key. Upstream `payments.ts:304-307` looks up that key directly in D1; cached site configuration affects collection/webhook configuration instead. Preserve the main plan's strong revocation requirement without overstating this evidence. See `minilytics-assessment.md:28`. |
| Clean-room or blanket trademark conclusions | Keep the assessment's narrower MIT reuse policy. Original UI/copy is the user's requirement. Retain notices for copied/adapted code and record source provenance; this source-informed review is not a legal clean-room process. See `minilytics-assessment.md:41-45` and `README.md:30`. |

The assessment's core source findings are supported: global owner auth, public self-reported telemetry, no event dedupe, visitor/session mismatch risk, heartbeat renewal, URL denylist limitations, unsigned return claims, mixed-currency totals, global Dodo payment keys and a capped in-memory funnel. Its dependency-audit language correctly avoids equating development-tool advisories with a proven deployed exploit.

## Required Phase 0 exit record

These are proposed experiments and decisions. None has passed in this review. Local fixtures can establish logic; remote Free CPU, fresh-account provisioning, permissions and actual button behavior require later authorized account testing.

| Gate | Required evidence before proceeding |
| --- | --- |
| Release contract | One alpha checklist reconciles phase order, money API availability, minimum privacy/operations and both installation modes. Public paid signup remains a separate decision. |
| Auth and owner setup | Chosen library/schema and secure credential method; measured Free/Paid behavior; atomic setup race/failure results; revocation and recovery; fail-closed placeholders and no public signup bypass. |
| Tenant/security state | Composite references and route/action permission matrix, authoritative site/key/member state, atomic usage admission, deletion/intake race and two-workspace negative fixtures. |
| Intake and maintenance | Insert-gated derived updates and payload-conflict behavior; duplicate/failure/reorder cases; atomic summary checkpoint and late-data correction; bounded Free Cron work. |
| Privacy and metric contract | Full-navigation/tab behavior, consent transitions and no pre-consent replay; exact event/session/visitor denominators and ordering; DST and retained-summary coverage rules. |
| Money and retention | Trusted checkout issuer contract; currency/refund and cross-input transaction dedupe fixtures; explicit surviving attribution/identity fields after 90 days and deletion/restore semantics. |
| Cloudflare deployment | Minimal repository-root template, pinned Wrangler/config, dynamic route matrix, button secrets and provisioning/migration order, actual CI permissions, fresh install/rename/retry/update evidence. |
| Capacity | Measurements by event class, realistic storage at the retention ceiling, mixed collector/report/cleanup load, quota headroom and limits below the measured envelope. |

Phase 0 may conclude that the free self-host profile needs a different authentication method, lower limits, simpler reports or a paid requirement. Record that outcome before implementing dependent features. A failed platform assumption must change the plan rather than being converted into a deployment claim.
