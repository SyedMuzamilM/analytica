# Product roadmap after the gap reviews

Prepared 26 October 2026 by the primary GPT-6.1 Sol agent against application baseline `80be717`. This is the selected next-work plan. It supplements the original [implementation plan](implementation-plan.md), whose historical phase estimates are not a current completion schedule.

## Current position

Analytica implements a local analytics application on Workers, Static Assets and D1, with original UI, passkey workspaces, tracking, reports, funnels/journeys, customer revenue analytics and privacy operations. The recorded baseline is 79 Worker/D1 tests, five Chromium flows and passing CI. No hosted deployment or clean-account guided installation is verified. More details are in the [inventory](current-product.md) and [release matrix](operations/release-status.md).

The next objective is an operable invite-only alpha. A hosted URL alone is insufficient: installation, access, data fidelity, capacity and recovery must pass together. Customer signup and commercial billing remain separate scope.

## Review inputs and judgment

| Input | Execution status | What informed this plan |
| --- | --- | --- |
| [GLM Free](research/product-gaps-glm.md) | Completed, source inspection only | Quota visibility, export dead end, credential/invite lifecycle, routing boundaries and metric definitions |
| [Antigravity](research/product-gaps-antigravity.md) | Completed, static source/flow review only | First-event onboarding, acquisition breakdowns, date controls and misleading shortcut badge |
| [DeepSeek Free](research/product-gaps-deepseek.md) | Report written; harness run interrupted before final response | Hosted quota fairness, release/readiness, supportability, backup/recovery and lifecycle |

The primary agent checked their main source claims and selected the work below. These reports do not prove security, remote performance or launch readiness. DeepSeek's report is a recovered written artifact, not a normally completed delegate turn. Preserve original reports; corrections are recorded in the inventory and below.

## Milestone 1: activation, limits and support

This is the first implementation slice. It can proceed locally while deployment credentials are unavailable.

| Work | Acceptance checks |
| --- | --- |
| Site/workspace usage and clear quota responses | Authenticated owner/admin sees accepted event envelopes, limit and next UTC reset. Duplicate delivery is free. A concurrent fixture exercises site, workspace and installation denial separately. Usage queries never expose another workspace's counters. |
| Hosted workspace budgets | Add forward schema changes and atomic admission using the existing transaction boundary. One workspace reaching its budget must not exhaust another's allocated budget. Keep a global circuit breaker. Allocated tenant budgets must fit beneath the measured global allowance; adding a workspace must not silently oversubscribe it. Configuration is operator-owned initially. |
| First-event verification in settings | Bounded, cancellable polling supports waiting, receiving, paused, quota-limited, stale and connection-failed states. Leaving/changing a site cancels work. A real accepted fixture event updates status; an error is never displayed as zero visits. |
| Accurate installation help | Explain explicit consent, domain checking, separate development sites and `data-allow-localhost`. No broad localhost bypass for production sites. State that current SPA tracking covers path navigation; any hash-routing support is explicitly opt-in and sanitized. |
| Support request identifiers | Server error response/header and sanitized log share a generated request ID; dashboard preserves and lets the user copy it. Do not reveal exception text, bodies or SQL values. |
| Metric definitions and honest affordances | Publish definitions for pageviews, document estimates, consented browser IDs, sessions, bounce, duration and periods/retention. Link them from reporting. Remove the unimplemented G O shortcut badge unless a tested shortcut is provided. |

Do not let tenant admins raise installation safety limits. Do not expose raw installation-wide consumption to every tenant. Installation circuit-breaker messages can explain service capacity without revealing private tenant volumes.

Rejected-request diagnosis has limits. A server cannot detect a script that never loaded or a client that never sent anything. Show a useful checklist when no request exists. If rejection counters are added, rate-limit and bound them so diagnostics do not create a new unbounded write path.

## Milestone 2: access and data lifecycle

This is the second implementation slice and can share backend foundations with milestone 1.

| Work | Acceptance checks |
| --- | --- |
| Passkey inventory/removal | List only the signed-in user's credential metadata. Removal requires recent authentication, has a safe last-credential policy and cannot race an enrollment/login into unauthorized persistent access. Lost-device session handling is explicit; test revocation with real cryptographic credentials. |
| Revocable invitations | Owners list/revoke invitations without recovering stored token plaintext. Revocation races safely with token acceptance; unauthorized members cannot inspect or revoke invites. Existing accepted memberships are managed separately. |
| Complete scoped event export | Replace the >10,000-row documentation dead end with stable bounded pagination or a concrete reviewed operator procedure. A customer never receives a whole shared-D1 dump. Prove tenant scope, suppression, boundary/retry behavior and completeness beyond 10,000 rows. |
| Workspace closure | Owner-authorized, recent-auth confirmation stops new intake and schedules bounded cleanup across sites, money, keys, integrations, invitations and memberships. Preserve only explicitly documented journal/tombstone data. Repeated closure and concurrent intake cannot restore access/data. |
| Operator suspension/closure procedure | Define session, passkey, recovery-code, invitation, membership and key effects for a user, without disabling other owners' resources accidentally. Test scoped revocation and document escalation when all credentials are lost. |

Workspace closure needs an operator-supported path before external alpha data. A polished self-service account-deletion/owner-transfer flow can follow before public v1. Parent planning documents previously placed all workspace deletion in v1; that was too late for the original alpha deletion gate.

## Milestone 3: useful acquisition reports

Implement after basic activation/trust flows, or as an independent frontend/backend slice once those contracts are stable.

| Work | Acceptance checks |
| --- | --- |
| Today, Yesterday and custom date controls | URL state and UI agree across live/demo views. Yesterday uses the site's calendar timezone. Existing custom API dates are reused; DST, previous-period coverage, invalid ranges and navigation back/forward are tested. Revenue/funnel/journey range behavior is either consistent or clearly labeled. |
| Campaign breakdown | Bounded campaign/source/channel grouping, with clear counting units and suppression/filter consistency. Do not present traffic counts as verified sales or conversion rates. |
| Outbound report | Expose sanitized outbound destinations and counts separately from goals. Maintain date/filter/authorization rules and avoid revealing dropped query/fragment data. |
| Landing-page report | Define whether a row represents sessions that started in the period or pageviews. Preserve aggregate-mode limitations and handle midnight sessions without inflated totals. |

Hourly charts, arbitrary event properties, cohorts, multi-touch attribution and a general long-range rollup engine are separate features. Existing summary storage does not make long-range distinct-browser or revenue queries correct automatically.

## Release track: remote proof before customer data

Prepare tooling and fixtures locally in parallel with milestones 1–2. Remote execution requires the intended account credential and selected application origin.

| Gate | Required dated evidence |
| --- | --- |
| Hosted isolation | Separate staging/production Worker names, D1 databases and secrets; portable self-host template remains free of customer account IDs. Final passkey origin selected before production enrollment. MODE is currently only a label. |
| Build and deploy safety | A release command builds first and stops on failure before migrations/deploy, or proves asset freshness. Preserve Workers Builds' documented separate build/deploy contract. Pin code/assets to one release identifier. |
| Readiness | Keep basic liveness if useful; add a non-sensitive readiness check for expected schema and current installation secret requirements. Configured owners do not need SETUP_TOKEN. Missing secrets, partial schema and a new version produce distinguishable evidence without secret disclosure. |
| Fresh deployment and update | Hosted synthetic install → real-device sign-in → first accepted event → report → export → deletion. Update with owner/data preserved; exercise old Worker against additive new schema and document compatible rollback. |
| Self-host distribution | Private self-host proof is an alpha requirement. The public button's clean-account provision/secret/migrate/build order, renamed resources, failed-run retry and upgrade must be recorded before declaring one-click distribution ready for v1. CLI fallback alone does not prove the button. |
| Capacity and tenant fairness | Mixed collector/report/auth/financial/maintenance workload, CPU and D1 reads/writes/storage at the proposed retention ceiling, latency and denial distribution. Default tenant budgets and maintenance reserves sit below the measured envelope. No capacity claim comes from local emulation alone. |
| Recovery and backups | Encrypted, access-controlled operator backup and external journal custody; restore into scratch storage; two-tenant Time Travel drill with persistent lock, journal replay, credential reconciliation and deletion verification before unlock. Record whole-database restore impact, retention, observed recovery point and elapsed recovery time. |
| Monitoring and support | Confirm platform log/error sampling behavior before changing settings. Record useful alerts or explicit operator checks for ingestion failure, database/storage budget, stale cleanup and unresolved refunds. Provide a support contact and a triage procedure. |
| Dodo | Real sandbox checkout created after claim issuance, merchant metadata propagation, signed payment/refund deliveries, retries and reconciliation. Until verified, limit the integration to synthetic tests. |

Workers Paid is a candidate hosted profile, not an authorization to upgrade or proof that a workload fits. Select the tier from measured CPU/storage/recovery needs; verify current provider limits at execution time. Self-host Free remains a bounded profile to prove independently.

Do not call the alpha complete until the existing customer-data gate is satisfied. No numerical customer cohort or fixed per-workspace event budget is promised by this plan.

## Public v1 and commercial decision

After alpha evidence and actual usage:

- Complete owner transfer, role changes, account closure/export and security-change history.
- Choose supported brand/domain, privacy/terms disclosures, incident/support responsibilities and retention promises.
- Decide whether public signup and paid subscriptions are in scope. Choose email delivery only where needed for that lifecycle; passkeys do not require passwords.
- If billing is selected, create a separate subscription/entitlement boundary. Do not reuse customer revenue records, Dodo merchant integrations or their retention as Analytica billing.
- Consider sharing only with scoped, hashed, revocable tokens, explicit report-field policy, rate limits and privacy-safe defaults. A public site token is insufficient access design.

## Defer until evidence justifies them

Queues, KV quota authority, Analytics Engine as a second reporting truth, per-tenant database sharding, automated in-app backup services, extra payment vendors, AI assistants, native mobile apps, scheduled digests, cohorts and enterprise SSO. Revisit a proposal when observed customer demand or measured platform limits justify its operational cost.

## Selected implementation order

1. Atomic workspace budgets, scoped usage, distinct quota/reset responses and first-event diagnostics.
2. Passkey/invite lifecycle, customer-readable definitions, request-ID support and usable scoped exports.
3. Workspace closure and operator support/recovery tooling.
4. Today/custom date UI and campaign/outbound/landing-page reporting.
5. Execute remote release gates as credentials and environment choices become available; evidence is required before customer onboarding regardless of local feature completion.
6. Use alpha feedback to choose public-v1 scope and commercial work.

This document specifies work still to do. No new application feature, deployment or remote verification is claimed by the gap-review pass.
