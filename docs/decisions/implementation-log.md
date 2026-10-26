# Implementation decisions

## 26 October 2026

The build begins with one repository-root Worker deployment, Static Assets and D1. The dashboard, browser tracker, and server modules are independent source directories with shared TypeScript contracts.

Authentication uses a passkey spike with SimpleWebAuthn rather than password hashing. This avoids assuming a secure password algorithm fits Free CPU. Setup requires a privately supplied installation token; sessions and recovery remain server-side and revocable. Native Worker execution and remote CPU still need measurement.

Three implementation agents are working in separate file sets: passkey/authentication, analytics ingestion/reporting, and dashboard. The primary agent integrates them and implements tracking, revenue and deployment. The independent free provider reviews will assess concrete code after integration. Security and platform reviews remain required before customer intake.

Local Cloudflare OAuth is available, but it belongs to an account different from the requested deployment target. No cloud resources will be changed using that account. Target account credentials will be requested through the private secret card when the deployable build is ready.

The first selected Cloudflare test-pool package is deprecated. The build is moving to its maintained replacement, `@cloudflare/vitest-plugin`, with compatible Vitest 5. The lockfile records actual dependency versions; dependency audit findings will be resolved or scoped before deployment.

The integrated implementation passes 54 Worker/D1 tests, four Chromium flows, TypeScript checking, the production build and Wrangler deployment dry-run. npm audit reports zero vulnerabilities after compatible Undici/Zod patch overrides. Screenshots were inspected on desktop and mobile. Peer reviews resulted in fixes for webhook receipt races, claim idempotency, refund acquisition snapshots, late-refund retention, deletion starvation, prequeued opt-out, SPA redaction, event cohort filters, concurrent session attribution and immediate erasure visibility.

Two native implementation agents reached their provider usage limit after writing their files. The primary agent finished integration and verified all current suites. Independent GLM Free, DeepSeek Free and Antigravity reviews of the actual implementation follow before target-account deployment.

Antigravity's implementation UI findings were corrected and covered by an expanded browser flow. The deployment secret card timed out without a credential, so target-account mutations remain pending. Local development uses generated ignored secrets only; no token from conversation history was stored. The primary agent is continuing source cleanup and deployment packaging while the other provider reviews run.

Created the public source repository https://github.com/SyedMuzamilM/analytica for the requested self-host distribution. README contains the official guided deploy-button URL with an explicit unverified-remote-install note. Publishing a template does not mark the clean-account deployment gate complete.

GLM Free completed a pinned-source implementation review with no P1 finding in its inspected scope. Its canonical-path issue is fixed and browser-tested. Paused/deleting money-webhook responses are classified, including a D1 competing-write fixture. Erasure now requires known evidence, journal exports paginate over a stable boundary, and a forward migration enforces concurrent key limits. The expanded baseline is 58 Worker integration tests and five Chromium flows. DeepSeek's deployment/payment review and target-account credentials remain pending.

Linux CI caught a deterministic scheduling defect after the GLM fixes. The four-site deletion regression now deliberately reverses job and site order. It failed before the fix and passed after all domain purges adopted one shared job-ordered candidate query. This replaces reliance on incidental SQLite row ordering. The full suite is rerun because the scheduling change crosses analytics, revenue, funnel and privacy cleanup.

The current-schema per-event write probe was rerun because later indexes and attribution updates changed the cost. Local and Linux CI agree on 14 indexed writes for a new-session event,10 for a subsequent pageview and10 for engagement with established buckets. Documentation now supersedes the earlier12/9/9 spike numbers. These remain emulation measurements, not remote billing/capacity promises.


## Final independent payment/recovery review

DeepSeek Free completed its implementation review at `4d90769`. All seven findings are corrected in the current source. Checkout claims now precede Dodo checkout creation using a merchant order ID in signed correlation metadata. Optional refund fields normalize only from scoped evidence; unresolved deliveries are persisted and shown for reconciliation, with bounded fair retry and explicit capacity. Two native agents implemented the refund and authentication/recovery changes while the primary agent integrated claims, reporting, retention, deletion and dashboard states.

The recovery lock now closes account-security changes and freezes ordinary scheduled retention, auth expiry and refund retry. Deletion-only cleanup remains active so external journal replay can finish before unlock. The lock is an operator-set Worker secret. SETUP_TOKEN is removable after owner configuration, and authenticated report/export limits use verified account identity.

The final local baseline is 79 Worker/D1 tests and five Chromium flows, plus typecheck, formatting, build, dry-run and a zero-advisory audit. The forward migration was applied to local development storage without recreating the owner/database. All requested provider reviews have returned; remote deployment, clean-account guided install, Dodo sandbox and restore/load drills remain separate evidence gates.
