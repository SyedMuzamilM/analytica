# Current product inventory

As of 26 October 2026. Source baseline: `80be717`. This inventory reflects source inspection and the recorded verification baseline. It does not claim remote deployment or capacity verification.

## What is implemented

| Area | Current behavior | Practical boundary |
| --- | --- | --- |
| Cloudflare foundation | One TypeScript/Hono Worker, React/Vite Static Assets, D1, cron and edge rate limiting | Remote account/tier performance remains unmeasured |
| Accounts | Token-protected first owner, passkeys, recovery codes, backup passkeys, sessions and revocation | Manual invitation tokens; no email delivery or public signup |
| Teams | Workspaces, multiple sites, owner/admin/viewer permissions and member management | Commercial organization lifecycle and complete workspace/account deletion need review |
| Dashboard | Overview, Acquisition, Pages, Events, Funnels, Journeys, Revenue, Website settings and Account views; responsive shell and isolated synthetic demo | Wider accessibility/device coverage remains outstanding |
| Tracker | Pageviews, SPA navigation, goals, outbound events, engagement, campaign/referrer/source and coarse country/device dimensions | Public browser events are untrusted; no promise of perfect bot/spam exclusion |
| Privacy modes | Aggregate document-scoped identifiers; consent-controlled attribution identifiers; opt-out and path redaction | Aggregate identifiers reset on full navigation; no cross-page people/returning-visitor claim |
| Reports | Period comparisons, URL filters, IANA timezones/DST, source/page/country/device/event breakdowns and coverage labels | Exact-detail and bounded queries; changing a site's timezone/privacy mode is unsupported |
| Funnels/journeys | Ordered exact-step session funnels and bounded consented-browser journeys | Attribution mode only; random browser IDs are not verified people |
| Customer revenue analytics | Server payment/refund API, signed Dodo webhooks, per-currency gross/refund/net totals, deduplication and verified checkout claims | Dodo sandbox propagation remains unverified; this does not bill Analytica customers |
| Incomplete refunds | Minimal durable evidence, bounded retries, reconciliation counts and oldest 100 unresolved deliveries in UI | Unknown partial amounts require trusted manual reconciliation; bounded backlog |
| Data operations | Scheduled retention, event export, visitor erasure, site deletion, suppression and paginated recovery journal | Event download caps at 10,000 rows; larger export needs an operator |
| Recovery | Persistent lock runbook, explicit allowed routes, deletion-only scheduled work and journal replay | Real remote restore and external journal custody still need proof |
| Distribution | Public MIT repository, deploy-button link, portable D1 binding, forward migrations and upgrade guidance | No deployed hosted service yet; guided install is not remotely verified |

## Evidence already recorded

79 Worker/D1 integration tests and five Chromium flows pass, plus typecheck, formatting, production build, deployment dry-run and dependency audit. GitHub CI passed the implementation commit `3fa5ec4`; `80be717` only added the research index. Prior Antigravity, GLM Free, DeepSeek Free and Sol findings and their corrections are recorded in [implementation review disposition](research/implementation-review-disposition.md).

## Next priorities

1. Prove both deployment paths. Deploy synthetic staging to the intended account; record health, real-device auth, install → event → report → export → deletion and update behavior. Exercise the official button in a clean account with rename/retry/upgrade checks.
2. Prove a safe operating envelope. Measure CPU, D1 reads/writes/storage and report/maintenance behavior under mixed load; validate recovery and add useful ingestion/cleanup/webhook monitoring.
3. Make activation and limits clear. Review first-event verification, installation diagnostics, quota visibility, freshness, privacy guidance and error recovery against actual UI.
4. Close data and account lifecycle gaps. Review complete exports, workspace/account removal, owner transfer and operational privacy/support processes before broader onboarding.
5. Choose commercial scope. Public signup, subscriptions, billing/entitlements, email, pricing, legal disclosures, final brand/domain and support are unfinished product work.
6. Expand reporting only when justified. Saved views, sharing, scheduled reports, additional payment providers, richer events, cohorts and advanced attribution are candidates, not launch prerequisites by default.

## Gap review brief

Requested on 26 October 2026: independent product/activation, data/security/lifecycle and Cloudflare/operations gap reviews against the current implementation. Each reviewer must cite actual source, distinguish defects from missing capability and missing runtime evidence, prioritize alpha versus public v1, and recommend what to defer. They must not modify application code, deploy resources, use credentials or repeat prior fixed findings without confirming the current source.


## First returned gap review: GLM Free

The [GLM report](research/product-gaps-glm.md) reviewed source baseline `80be717` and ran no runtime tests. The primary agent rechecked its main findings against the tracker, auth routes, collector, export endpoint and report implementation. This section records the first review disposition; the selected combined plan is now in [product roadmap](product-roadmap.md).

| Finding | Parent disposition | Next deliverable |
| --- | --- | --- |
| Site and installation caps share `quota_exceeded`; owners cannot see current usage | Confirmed. `dailyLimit` already exists in the site response, so adding it again is unnecessary. Expose scoped usage and the correct cap without disclosing other tenants' activity. | Visible UTC-day usage/budget state, specific collector denial reasons and coverage for the installation cap. Document bounded tracker retry/drop behavior. |
| Over-10,000-row export points to an absent operator procedure | Confirmed documentation dead end. A raw whole-database export can include other tenants and credentials, so it is not a customer-deliverable workaround. | Document a reviewed, scoped export procedure or provide paginated site exports. Verify the boundary and suppression/authorization rules. |
| Hash-router navigation is untracked | Confirmed capability boundary. Normal path-based SPA navigation is supported. Fragments can contain tokens or private text, so adding unconditional hash collection would be unsafe. | Narrow current SPA documentation; if required, add explicit opt-in hash-route parsing with sanitization, privacy controls and browser coverage. |
| No passkey inventory/removal or invite revocation | Confirmed missing security lifecycle controls, rather than proof the implemented registration flow is broken. | Recent-auth-gated credential inventory/removal with safe last-credential and session rules; owner-scoped invite listing/revocation. Verify concurrent auth/invite use races. |
| Metric definitions need a customer-facing page | Confirmed opportunity, with a report correction: definitions already exist in `docs/decisions/atomic-ingestion.md` as well as response coverage text. | Publish/link customer-readable definitions from actual metric behavior; preserve differences between document IDs, consented browsers and verified people. |
| Complete account/workspace lifecycle | Missing owner transfer, role changes and whole-account/workspace removal need a coherent design. | Public-v1 lifecycle milestone, with data deletion, membership and ownership safety rules. |

Recommended next implementation slice is activation and trust: quota/first-event diagnostics, honest routing/metric documentation, a usable scoped export path, passkey management and revocable invitations. Remote mixed-load, storage and recovery proof remains an alpha gate, as already specified by the original plan; it must not be postponed solely to public v1 as parts of the GLM prioritization suggest.

Defer general long-range reporting, cohorts, extra payment vendors and pricing/entitlement configuration until core customer flows and measured capacity justify them. Email and public signup are product-scope decisions, not automatic prerequisites for an invite-only alpha.


## Second returned gap review: Antigravity

The [Antigravity report](research/product-gaps-antigravity.md) is static source/flow inspection at `80be717`; no browser or runtime verification was performed. The primary agent checked its main source claims. The report's broad praise of security/backend stability and unmeasured D1 throughput claims are not adopted as evidence.

| Finding | Parent disposition | Next deliverable |
| --- | --- | --- |
| Weak first-event verification | Confirmed installation-flow gap. Overview already has last-event feedback and a manual refresh button, so there is some feedback today. Settings lacks a focused listening/diagnostic flow. | Add bounded, cancellable first-event checks with clear consent, paused, quota and domain troubleshooting. Never fabricate successful test events or silently alter production counts. |
| Local development is hard to discover | Deliberate safeguards, not a reason to bypass production hostname checks. A separate localhost site plus explicit tracker opt-in is available. Production/staging domains need an explicit environment policy. | Document/test a separate development site and flag; explain why development events do not belong in production reports. Avoid broad wildcard localhost/staging admission. |
| Campaign, landing-page and outbound breakdowns are missing | Confirmed report/UI gaps in AnalyticsReport. Correction: campaign/channel/entry/exit data appears in journeys/revenue or exports, so it is not all inaccessible or write-only. Outbounds lack a dedicated aggregate report. | Add bounded campaign and outbound breakdowns and a clearly defined landing-page report. Preserve privacy-mode semantics, suppression and metric denominators. Do not label acquisition pageview counts as campaign sales/conversion rates. |
| Today/custom date support is hidden | Confirmed backend supports today/custom while UI only accepts 7d/30d/90d. Yesterday can use a custom one-day range; it is not a native backend preset. | Add date controls and URL state consistently across overview, demo, revenue, funnels and journeys; verify timezone/DST and comparison coverage. Hourly charts are separate work. |
| G O shortcut badge has no handler | Confirmed misleading affordance. | Remove the badge or implement and test the documented shortcut. |
| Raise quotas through admin UI | Defer until capacity is measured. Quota visibility belongs in alpha, not only public v1. Raising site limits alone cannot change the hard installation cap. | Visible usage and operator capacity policy first; tenant admins cannot raise installation-wide cost/safety limits. |
| Public read-only sharing | Optional v1/later scope, not an alpha prerequisite. A share_token column alone is not an adequate access design. | If customer demand warrants it, design hashed/revocable/scoped tokens, report field allowlists, expiration, rate limits and privacy-safe defaults before implementation. Authenticated viewer invitations already support team access. |

Combined with GLM, the clearest small product milestone is first-event/limit diagnostics, safe exports and credential/invite lifecycle, then useful acquisition dimensions and date controls. The final order and remote release gates are now recorded in [product roadmap](product-roadmap.md). Existing alpha capacity, restore and deployment gates remain mandatory regardless of the new UI scope. A proposed cohort of 10–20 customers is not an established supported operating envelope.


## DeepSeek written report and combined outcome

The [DeepSeek report](research/product-gaps-deepseek.md) was written before its harness run was interrupted; it did not post a normal final response. The primary agent recovered the report and checked its main source claims. No remote operation or runtime test was performed by this review.

- Confirmed: every workspace shares the installation's 2,000-event cap. Atomic workspace budgets and controlled allocation are needed for hosted fairness; simply adding a per-workspace counter cannot guarantee headroom if allocations oversubscribe the global cap.
- Confirmed: current health checks one schema table and a fixed version. This is a basic health/liveness endpoint, not proof of full readiness. Add a separate readiness/version contract rather than treating all lightweight health checks as defective.
- Confirmed: dashboard errors discard the response request-ID header. Support needs the ID surfaced and correlated with sanitized server logs.
- Qualified: build/deploy separation is intentional for Workers Builds and the CLI guide already builds first. Stale local assets remain a release ergonomics risk; a safe combined release command or freshness check should preserve the hosted build contract.
- Confirmed operational gaps: explicit hosted environments, measured resource envelope, alert/triage evidence, complete export/closure, remote recovery and guided deployment proof remain missing.
- Existing controls already protect tenancy and deletion in the exercised local fixtures. MODE is only a label; it does not add hosted lifecycle, budget allocation or an operator service.
- A full database backup is operator-only. It cannot be handed to one customer. Shared-database recovery affects every workspace; backup retention and deletion-journal handling must be reconciled explicitly.
- Public email, sharing and subscription billing are conditional product choices. The original plan requires private self-host proof for alpha and full public button verification for v1; the report's stricter clean-button alpha placement is not automatically adopted.

The [selected product roadmap](product-roadmap.md) combines the useful findings from all three written reports, records their execution limits, and defines acceptance checks. None of these newly recommended capabilities has been implemented by the review pass.
