# Product gaps: hosted operations, activation, and the commercial boundary

**Source baseline:** `80be717` (application/configuration/test source is unchanged in the working tree; only documentation is modified or added).
**Reviewer:** `opencode/deepseek-v4.1-flash-free`; confirmed cost **$0**.
**Date:** 26 October 2026.
**Method:** read-only source inspection, plus official Cloudflare documentation fetched 26 October 2026. No deployment, credentials, remote mutation, application change, test run, or customer contact occurred. The only file written is this report; no PR, push, or deployment was made. This report does not claim runtime results.

**Bottom line:** Analytica is a coherent self-hosted analytics application with unusually careful local correctness work. It is not yet an operable hosted service. The gap is not another dashboard feature or another storage engine; it is proving one hosted release end to end, isolating tenants at the quota layer, proving recovery, making silent ingestion failure visible, and closing account lifecycle. Everything else should wait for measured demand.

---

## 1. Scope and evidence standard

The review covers hosted and one-click self-host deployment, fresh-account provisioning order, upgrades, monitoring/quotas/cost/capacity, backup/recovery, supportability, commercial signup/billing separation, and release gates.

Every finding is classified as one of:

| Class | Meaning |
| --- | --- |
| **Confirmed source defect** | Current code or configuration behaves incorrectly or unsafely for the stated product goal; reproducible by reading source. |
| **Absent capability** | The behavior is not implemented. It is not a bug unless it was promised, but it blocks the next stage. |
| **Unverified runtime/release evidence** | The implementation may be correct, but no recorded execution exists in the target account or environment. Not a defect. |
| **Optional idea** | Not required for alpha or public v1; defer until measured demand. Section 6 lists the ideas this review recommends deferring. |

This review treats the payment and recovery findings recorded in [implementation review corrections](implementation-review-disposition.md) as fixed at `80be717` and does not re-report them. Where relevant it checks that the fix boundary still exists. It also does not repeat earlier provider findings that are not present in current source.

**Limits of this review:** no target Cloudflare account, no clean-account Deploy button run, no real-device passkey test, no remote migration, no restore, no load test, and no cost observation. Statements about Cloudflare limits and retention are from official documentation, not from this account.

---

## 2. What is already sound

These are not gaps. They should be preserved while fixing the operational layer.

| Strength | Evidence at `80be717` | Why it matters |
| --- | --- | --- |
| First-owner setup is one atomic batch | `apps/worker/auth.ts:393-430` | User, workspace, owner membership, setup state, recovery codes, passkey and session commit together or not at all. This is the right provisioning order. |
| Bootstrap is fail-closed | `apps/worker/auth.ts:72-89` | Placeholder or weak secrets are rejected; `SETUP_TOKEN` is unnecessary after setup. |
| Restore lock has explicit allowlists | `apps/worker/index.ts:104-137` | Intake, money, ordinary workspace reads, and security mutations are blocked while recovery runs. |
| Event admission and quota checks are atomic in D1 | `migrations/0001_analytics.sql:105-152` | Duplicate delivery, site state, quota, session and counters are evaluated in the same insert transaction. This is stronger than a naive insert-then-increment design. |
| Migrations are applied by binding and documented as forward-only | `package.json:14-16`; `docs/operations/deployment.md:24-32` | A renamed D1 database does not require editing migration SQL, and deploy stops if migration fails. |
| Revenue analytics is explicitly not Analytica billing | `docs/operations/payments.md` | The customer payment ledger is separated from our commercial model. Keep it that way. |

The local evidence is also meaningful: the release matrix records 79 Worker/D1 integration tests and five Chromium flows, with no remote deployment ([release status](../operations/release-status.md), lines 7-14). This review did not re-run them.

---

## 3. Findings

### 3.1 Hosted and self-host deployment

| ID | Finding | Class | Evidence at `80be717` | Customer/product impact | Stage |
| --- | --- | --- | --- | --- | --- |
| D1 | `npm run deploy` applies migrations and deploys the Worker but never builds the dashboard. A stale `dist/` can be published silently; a fresh clone has no `dist/` and can fail at the deploy step. | Confirmed source defect | `package.json:16`; `dist/` is ignored at `.gitignore:2`; build is a separate script at `package.json:10` | A release can ship old UI against new Worker code, or fail after migrations have already run. | Alpha |
| D2 | `/healthz` only proves that one `workspaces` row can be selected. It does not prove the latest migration, required secrets, or which release is serving. `version` is hardcoded. | Confirmed source defect | `apps/worker/index.ts:140-147` | A deploy with missing `APP_SECRET` or a partially applied schema can report healthy; support cannot confirm an upgrade. | Alpha |
| D3 | There is no hosted deployment profile. The template has `workers_dev: true`, no `env` blocks, no route/custom-domain configuration, and `MODE` is a label only. | Absent capability | `wrangler.jsonc:7,21`; `apps/worker/auth.ts:679` | Hosted staging/production cannot be separated from the self-host template without hand-editing; the workers.dev origin remains reachable and passkeys bind to it. | Alpha |
| D4 | The clean-account button path, CLI path, rename, retry and upgrade are documented but not recorded as executed. | Unverified runtime/release evidence | `docs/operations/deployment.md:7,24,32`; `docs/operations/release-status.md:13-14` | The guided install is the main distribution promise; an unverified button is a launch risk, not a proven feature. | Alpha |
| D5 | CI validates local tests, build and a Wrangler dry run. The tests apply migrations to the test database, but CI does not run the production `wrangler d1 migrations apply` path against a fresh D1, nor an upgrade from a released schema. | Unverified runtime/release evidence | `.github/workflows/ci.yml:16-24`; fresh test migrations at `tests/setup.ts:16` | Migration ordering, remote permissions and upgrade compatibility can fail only in the target account. | Alpha |
| D6 | `deploy` runs migrations *before* the new Worker, so the old Worker serves against the new schema for a short window. The additive-only rule is documented, but no mixed-version test enforces it. | Absent capability | `package.json:16`; `docs/operations/deployment.md:40-42` | A non-additive migration can break the old Worker during rollout; rollback becomes unsafe. | Alpha/v1 |

**Deployment detail.** The deploy-button documentation confirms that Cloudflare auto-provisions D1 and updates the Wrangler configuration, and that a custom `deploy` script is detected. That makes the button plausible, but not proven: the repository still needs a recorded clean-account run, including the case where a resource name differs from `analytica`. The CLI path deliberately requires the operator to record a `database_id`; that is acceptable, but it should be a single documented command sequence, not an implied edit.

**Fresh-account order.** The intended order is: create/provision D1 → set `APP_SECRET` and `SETUP_TOKEN` → apply migrations → deploy → open the URL → enter the setup token → register owner passkey → save recovery codes → create site → send first event. The atomic setup transaction is correct. The weak point is that a deploy without secrets or with a partial schema still reports healthy, so the operator has no readiness gate between deploy and first visitor.

**Upgrades.** Forward migrations are the right policy. The missing evidence is a release-to-release test: start on the previous commit, create owner/site/events, apply the new migration with the old Worker still running, deploy the new Worker, and verify sign-in, report, ingestion, export and deletion. Without that, "additive migration" is a convention, not a tested contract. A Worker rollback also needs a documented compatibility statement; there is no deployed version identifier to compare.

### 3.2 Tenancy, quotas, cost and capacity

| ID | Finding | Class | Evidence at `80be717` | Customer/product impact | Stage |
| --- | --- | --- | --- | --- | --- |
| Q1 | The installation-wide quota is **2,000 events/day**, shared by every workspace. Per-site is hardcoded **1,000/day**; 20 sites per workspace; 100 workspaces per installation. | Confirmed source defect for hosted multi-tenancy | `migrations/0001_analytics.sql:116`; `apps/worker/analytics.ts:442-453`; `apps/worker/auth.ts:927-929` | Two busy sites can exhaust the installation and return 429 to every other customer. This is a single-tenant safety cap, not a hosted fairness model. | Alpha |
| Q2 | There is no workspace-level quota and no usage API or UI. Owners cannot see today's events, limit, reset time or remaining headroom. | Absent capability | Routes in `apps/worker/analytics.ts:393-591`; no usage route; dashboard has no quota surface | Limits are invisible until traffic is rejected; support cannot distinguish "no traffic" from "quota exhausted." | Alpha |
| Q3 | Both quota failures collapse into `quota_exceeded` with `Retry-After: 3600`. The client cannot tell site vs installation, and the hint is not tied to the actual UTC-day reset. | Confirmed source defect | `apps/worker/analytics.ts:378-380`; quota day is UTC at `migrations/0001_analytics.sql:115-116` | Trackers retry without useful guidance; customers cannot self-diagnose; support tickets lack a scope. | Alpha |
| Q4 | Hosted cost/capacity has not been measured. The configured observability is Workers Logs at 10% head sampling; the repository configures no alerts for D1 errors, write/read consumption, storage growth, cleanup failure or webhook rejection. | Unverified evidence + absent capability | `wrangler.jsonc:30`; `apps/worker/index.ts:187-198` | A slow D1, failed cleanup or quota exhaustion can be invisible until customers report it. Ten percent sampling can miss rare 5xx entirely. | Alpha |

**Quantify the problem.** 2,000 events/day is about 60,000 events/month for the entire installation. A single site at 1,000/day consumes half of it. This is defensible for a synthetic staging demo and a handful of tiny design partners only if each workspace is capped well below the installation cap. It is not a hosted product boundary.

**Cost floor.** Official Workers pricing puts the Paid plan at **$5/month** with 10M requests and 30M CPU-ms included; D1 Paid includes 50M writes and 25B reads/month with 5 GB storage. A hosted alpha should run on Workers Paid, not Free: the Free plan's 10 ms CPU per invocation, 50 D1 queries per invocation, 500 MB database cap and 7-day Time Travel are the wrong operating envelope. Self-host can remain Free with documented limits. Actual D1 usage is still unmeasured; $5 is a floor, not a cost model.

**Observability.** Workers Logs retain 3 days on Free and 7 days on Paid. `head_sampling_rate: 0.1` means only 10% of requests are logged. For an alpha whose main risk is "the snippet did not fire" or "a rare write failed," 10% sampling is a support liability. Raise sampling for alpha, or export all error-level logs; do not rely on a sampled dashboard.

### 3.3 Backup and recovery

| ID | Finding | Class | Evidence at `80be717` | Customer/product impact | Stage |
| --- | --- | --- | --- | --- | --- |
| R1 | No off-account database backup or export procedure is configured. The app relies on D1 Time Travel plus a manually exported deletion journal. | Absent capability | `docs/operations/data-recovery.md:33`; `docs/operations/release-status.md:11` | A deleted account, bad migration or provider incident has no independent copy. Time Travel is not a backup archive. | Alpha |
| R2 | The repository does not state the actual Time Travel window by plan: **30 days on Workers Paid, 7 days on Workers Free**, always on, restore in place. | Absent documentation | `docs/operations/data-recovery.md:19`; official D1 Time Travel documentation | The app retains 90 days of detail, but a Free installation can only restore the last 7 days; the difference is not stated. Hosted alpha on Free would have a 7-day recovery window. | Alpha |
| R3 | No recorded restore drill. The runbook is detailed and locally fixture-tested, but no real Cloudflare restore, journal replay, lock persistence or access reconciliation has been executed. | Unverified runtime/release evidence | `docs/operations/data-recovery.md:33`; `docs/operations/release-status.md:11` | The first real restore would be during an incident, with customer data at stake. | Alpha |
| R4 | One shared D1 database means a Time Travel restore overwrites **every tenant**. There is no per-workspace restore or clone. | Confirmed architectural limitation | Shared database design in `migrations/0001_analytics.sql`; `docs/operations/data-recovery.md:19` | Restoring one customer's data also rolls back every other customer. This must be disclosed and compensated for, not discovered in an incident. | Alpha disclosure; v1 decision |
| R5 | Customer export stops at 10,000 event rows and points to an operator procedure; there is no full workspace/account export. | Absent capability | `apps/worker/analytics.ts:561-591` | Portability, deletion preparation and legal requests require operator SQL. Acceptable for alpha, not for self-service v1. | Alpha operator; v1 self-service |

**Do not build an in-app backup service yet.** The correct smallest step is an operator runbook and script: `wrangler d1 export` to encrypted, access-controlled storage outside the Cloudflare account, with checksums and a retention schedule, plus a quarterly restore drill. Cloudflare documents an R2/Workflows export pattern, but that is a later automation decision, not an alpha dependency.

### 3.4 Activation and supportability

| ID | Finding | Class | Evidence at `80be717` | Customer/product impact | Stage |
| --- | --- | --- | --- | --- | --- |
| S1 | Website settings show a static snippet and privacy note. There is no first-event check, no per-site verification state in settings, and no hostname/domain diagnostic. The report header shows only the selected site's last event or "Waiting for traffic." | Absent capability | `apps/dashboard/App.tsx:918-947`; `apps/dashboard/App.tsx:1529-1534` | The most common activation failure — snippet missing, wrong domain, blocked script — looks identical to "no visitors yet." | Alpha |
| S2 | The 500 response logs a request ID but does not return it in the JSON body; the dashboard error helper discards headers. | Confirmed source defect | `apps/worker/index.ts:35-36,166-184`; `apps/dashboard/api.ts:1-38` | A customer cannot give support the ID that correlates to the server log. | Alpha |
| S3 | There is no operator view or read-only diagnostic for tenant health: last event, today's usage, quota state, deletion backlog, webhook backlog. | Absent capability | No such route in `apps/worker`; dashboard is tenant-facing only | Every support question becomes manual SQL or log search; founder time does not scale past a few design partners. | Alpha |
| S4 | There is no real support contact or status surface: the Help action is a local toast pointing back to settings. There is no audit log of security-sensitive changes (invites, member removal, passkey/key changes). | Absent capability | `apps/dashboard/App.tsx:1324-1335`; `apps/dashboard/AccountView.tsx:359-455`; no status route | Customers cannot tell outage from misconfiguration; security questions cannot be reconstructed. | Alpha minimal; v1 full |
| S5 | Invitations are one-use tokens returned to the owner and must be delivered privately; there is no email. | Absent capability, by design | `apps/worker/auth.ts:882-917`; `apps/dashboard/AccountView.tsx:432-470` | Fine for a hands-on alpha; a public signup/team flow cannot depend on the founder copying tokens. | Alpha manual; v1 email |

**Supportability is a product feature, not an afterthought.** The alpha should be able to answer four questions in under two minutes: Is the tenant ingesting? What is the last event? Is it near a quota? Did a deletion or webhook job fail? Today none of those answers is one click or one documented command away.

### 3.5 Account lifecycle and commercial boundary

| ID | Finding | Class | Evidence at `80be717` | Customer/product impact | Stage |
| --- | --- | --- | --- | --- | --- |
| L1 | There is no workspace deletion. Only member removal and site deletion exist. | Absent capability | Route list at `apps/worker/auth.ts:966-1003`; `apps/dashboard/AccountView.tsx:359-455` | A team cannot close a workspace; deletion/legal requests require operator SQL; analytics and money data remain. | Alpha gate |
| L2 | There is no owner transfer or "last owner" invariant. The owner cannot promote another member and step down. | Absent capability | Member roles in `apps/dashboard/AccountView.tsx:393-430`; no transfer route | A departing owner leaves the workspace unmanageable; the only recovery is operator intervention. | Alpha manual; v1 self-service |
| L3 | `users.disabled_at` exists and is enforced in auth queries, but no application route or UI can set it. Account suspension is SQL-only. | Absent capability | `migrations/0000_auth.sql:5`; enforcement at `apps/worker/auth.ts:229,286`; no mutation route | Abuse suspension and employee offboarding are operator-only and easy to get wrong. | Alpha runbook; v1 admin |
| L4 | `MODE` only appears in `/api/auth/status`. Hosted mode does not change provisioning, signup, quotas or support behavior. | Absent capability | `apps/worker/auth.ts:679`; `wrangler.jsonc:21` | "Hosted" is a label, not a control plane. Do not mistake it for tenancy or commercial readiness. | Alpha |
| L5 | There is no public signup, email verification, terms/privacy page, pricing, entitlement model or subscription billing. This is intentional for alpha. | Absent capability, by design | `docs/operations/release-status.md:16`; `docs/operations/deployment.md:34` | Public v1 cannot launch on invite tokens and a founder-managed inbox alone. | Public v1 |

**The commercial boundary is currently documented correctly, and that is a strength.** Analytica's Dodo integration records *the customer's* revenue (`docs/operations/payments.md`). Analytica's own plan, invoice, entitlement and cancellation state belongs in a separate billing boundary with separate tables, webhook secrets and retention. Do not add a `plan` column to the analytics site or reuse the customer payment ledger for our subscriptions. Mixing merchant namespaces, webhook contracts and retention rules would corrupt both products.

---

## 4. Top five priorities

These are ordered by dependency and customer risk, not by engineering novelty.

### Priority 1 — Prove one hosted release path and a safe upgrade

**Customer impact:** Without this, no external customer can be admitted. A wrong domain or an unverified deploy also creates an expensive passkey re-enrollment problem: the relying party is the installation hostname, so passkeys enrolled on `workers.dev` do not move to a custom domain.

**Smallest coherent deliverable:**
- Create a dedicated staging account/Worker/D1 with synthetic data. Add an explicit hosted configuration (separate `env.staging`/`env.production` or separate config files), set `workers_dev: false` for hosted production, and choose the final domain *before* alpha users enroll passkeys.
- Make the deploy path fail fast instead of publishing stale assets: a preflight that requires a current `dist/`, or a single `release` command that builds, migrates and deploys. Keep the Deploy button's build/deploy detection working.
- Replace the shallow `/healthz` with a readiness response that checks the expected migration head, `secretsReady`, and a deploy version/commit. Keep a simple liveness check if the platform needs one.
- Add a CI job that applies all migrations to a fresh D1 and an upgrade fixture that starts at the previous released schema. Add a smoke script: setup status → create owner/site → synthetic collect → report → export → site deletion.
- Record the clean-account button matrix: install, rename resource, retry after a failed secret, second deploy, upgrade with existing owner/data, custom-domain sign-in on a real device.

**Dependency:** Cloudflare account access, a domain decision, and secrets. The code changes are small; the evidence is the deliverable.

**Acceptance evidence:** A dated staging runbook with URLs, commit SHA, screenshots/log excerpts, and a signed-off matrix. `/healthz` must fail before secrets/migrations and report the new version after upgrade. An upgrade from the previous commit must preserve owner, site, events and reports. A second deploy must not recreate the owner.

**Timing:** Alpha gate. Nothing else in this list should be called "alpha-ready" before it passes.

### Priority 2 — Isolate tenants, make usage visible, and measure the operating envelope

**Customer impact:** Today one tenant can exhaust the installation cap and cause 429s for everyone. Invisible limits turn a capacity decision into a support incident. An unmeasured envelope means the first real traffic spike is the capacity test. This is the difference between "a shared demo" and "a hosted alpha."

**Smallest coherent deliverable:**
- Add a forward migration for workspace-level daily event limits (or a `workspace_limits` table with per-workspace overrides). Keep the installation cap as a circuit breaker, not the primary fairness mechanism.
- Enforce in the existing atomic trigger: workspace quota first, then per-site, then installation. Emit distinct stable codes (`workspace_quota_exceeded`, `site_quota_exceeded`, `installation_quota_exceeded`).
- Return the scope and the actual reset time in the 429 body; compute `Retry-After` to the next UTC midnight, or document the UTC boundary. Do not hardcode 3600.
- Add a read-only usage endpoint for owner/admin: today's events, workspace/site limits, remaining, reset time, last event per site. Show a dashboard banner at 70/90/100% and map 429s to a readable message.
- Run a bounded staging load test at the intended alpha envelope (for example, the plan's 10 requests/second sustained and 50 requests/second one-minute burst), recording Worker CPU, D1 rows read/written, storage, p95 collection/report latency and provider cost. Set workspace and installation caps below the measured knee, preserving auth and maintenance headroom.
- Set alpha defaults deliberately: for three to five design partners, 300–400 events/day per workspace keeps the sum below the 2,000/day installation cap; alternatively raise the installation cap only after measurement. Keep the values configurable; do not build plan billing.

**Dependency:** Priority 1's migration/deploy path and staging evidence. A schema migration, a small UI surface, and a synthetic load fixture.

**Acceptance evidence:** A two-workspace fixture where workspace A is at its cap and workspace B still receives `202`; the installation cap still rejects total abuse; the 429 body names the scope and reset; the dashboard shows usage and a clear reset; the load report names CPU, D1 read/write, storage, p95 and cost headroom, and the configured caps sit below that measured limit.

**Timing:** Alpha minimum for isolation, 429 clarity and a measured envelope; public v1 for plan defaults and self-service visibility.

### Priority 3 — Prove backup and recovery, and document the real window

**Customer impact:** Without a drill, the first restore happens during an incident. With a shared database, one restore affects every tenant. If a deleted visitor reappears after restore and the journal is not replayed, the privacy promise is broken.

**Smallest coherent deliverable:**
- Add an operator backup procedure using `wrangler d1 export` to encrypted, access-controlled storage outside the Cloudflare account, with checksums, a schedule and a retention rule. This is an operator script/runbook, not an in-app service.
- Document the actual provider window: **7 days on Workers Free, 30 days on Workers Paid**, always on, restore overwrites in place, no clone. State that hosted alpha should use Workers Paid for the 30-day window.
- Run a staging drill: seed two synthetic tenants, record a bookmark, delete selected data, set `RESTORE_LOCK`, restore, replay each workspace's external journal, reconcile access and totals, unlock. Record RPO/RTO and the blast radius.
- Document per-workspace export and the >10,000-row operator path. Keep the deletion journal outside D1 before any restore.
- Add the drill and the export file restore to the release checklist.

**Dependency:** Priority 1's staging environment and a real account. The runbook already exists; the missing piece is execution and evidence.

**Acceptance evidence:** A dated drill record showing the restore target, the data removed, the journal pages, the lock checks (`503 restore_in_progress`), the replayed records, the post-restore report, the disabled/revoked credential checks, and the unlock. The export file must restore into a scratch database and pass the smoke path. The documented window must match the provider plan actually used.

**Timing:** Alpha drill; public v1 mandatory. Do not admit customer data before it passes.

### Priority 4 — Make activation and support observable

**Customer impact:** "No data" is the most common first-day failure. A static snippet and a global "Waiting for traffic" label cannot distinguish a missing script from a wrong domain, a blocked request, a quota rejection or a processing delay. Silent failure becomes churn and founder support load.

**Smallest coherent deliverable:**
- Add an "Installation check" to website settings/onboarding: per-site last event, events in the last 24 hours, hostname/domain match, privacy mode, and a state of `waiting`, `receiving` or `stale`. Link to a short troubleshooting panel.
- Include the request ID in 5xx JSON and show it in the dashboard error state with a copy action. Raise error log capture for alpha (sampling 1.0, or export errors separately) so the ID is actually useful.
- Add a read-only operator diagnostic command/script: last event, today's usage, quota state, pending site deletions, webhook/refund backlog. Document the triage matrix in a support runbook.
- Add a minimal status/contact surface for alpha (a static page or shared document is enough). Do not build a full status-page service.

**Dependency:** Priority 2's usage data; logging configuration; a support owner.

**Acceptance evidence:** A new site receives a synthetic event and flips to `receiving` on refresh; a wrong domain or missing snippet shows a specific diagnostic; a forced 500 shows a request ID that matches the server log; an operator can answer "is tenant X ingesting?" in under two minutes using the documented command.

**Timing:** Alpha. This is the highest-leverage non-infrastructure work for design-partner retention.

### Priority 5 — Close account lifecycle and keep billing separate

**Customer impact:** A team cannot currently close a workspace or transfer ownership. A departing owner leaves the workspace unmanageable; a deletion request requires SQL. Public v1 also needs a lawful account-closure and export path.

**Smallest coherent deliverable:**
- Workspace deletion for the owner: export-first warning, typed confirmation, retention explanation, block intake, delete analytics/money/keys/invites/memberships, and preserve only what the deletion journal and legal retention require.
- Owner transfer: promote an existing member to owner and demote/remove the old owner, with an invariant that every workspace has at least one owner.
- Operator account closure/suspension runbook: set `disabled_at`, revoke sessions/passkeys/recovery codes/invites/API keys, export or delete data, and verify access is gone.
- State explicitly that Analytica subscription billing is outside the analytics Worker. Keep customer revenue in `payments.md`; do not add plan entitlements to that ledger.
- Alpha: manual provisioning, invite tokens, basic terms/privacy and a support contact. Public v1: signup, email verification, abuse control, pricing/entitlements and legal review only after the alpha proves retention.

**Dependency:** Priority 3's export/retention procedure; a legal review before public v1.

**Acceptance evidence:** A two-owner transfer fixture where the old owner loses owner powers and the new owner can invite; a workspace deletion that removes data and blocks access, with a successful export beforehand; a disabled user whose existing session is invalid; a review confirming no subscription tables or webhook namespaces were added to the customer revenue ledger.

**Timing:** Workspace deletion and operator closure are alpha gates (the plan already includes workspace deletion). Self-service owner transfer, account deletion/export and public signup are public-v1 work. Subscription billing is later and conditional on choosing a paid model.

---

## 5. Release gates

| Gate | Invite-only alpha | Public v1 | Current evidence at `80be717` |
| --- | --- | --- | --- |
| Hosted deployment | Staging deploy, health/readiness, real-device sign-in, custom domain | Production deploy, rollback, on-call | None remote ([release status](../operations/release-status.md), line 13) |
| Fresh install | Clean-account button + CLI, rename, retry, update | Supported install matrix and support path | Pending ([release status](../operations/release-status.md), line 14) |
| Upgrade | Apply migration with old Worker, deploy, smoke; second deploy preserves owner/data | Repeated upgrades and rollback compatibility | Local fresh migrations only ([CI](../../.github/workflows/ci.yml), lines 16-24) |
| Data safety | Off-account export, restore drill, journal replay | RPO/RTO, per-tenant restore or explicit shared-blast-radius disclosure | Local fixtures; no remote drill ([recovery](../operations/data-recovery.md), line 33) |
| Capacity | Measured baseline, per-workspace caps below it, usage visibility | Load test at retention ceiling, cost model, alert thresholds | Unmeasured; 2,000/day shared cap |
| Activation | First-event diagnostic, usage, request ID | Onboarding funnel, self-serve troubleshooting | Absent |
| Lifecycle | Workspace deletion, operator suspension/closure | Owner transfer, account deletion/export, audit | Absent |
| Commercial | Invite-only, basic terms/privacy, support contact | Signup, email, abuse control, pricing/entitlements, status page | Absent by design |
| Observability | Error-level logs retained, triage runbook | Alerting, status page, incident process | 10% sampling, no alerts ([wrangler.jsonc](../../wrangler.jsonc), line 30) |

**A gate is not passed by a document.** Each row needs a dated artifact: a URL, a command output, a screenshot, a log excerpt or a restore record. The current release-status table is good at naming gaps; it should become the index to those artifacts.

---

## 6. What not to build yet

Earlier research proposed several additions that are not justified by current evidence. Adding them now would increase failure modes before the first hosted release.

| Idea | Why defer | Revisit trigger |
| --- | --- | --- |
| Queue-based ingestion | The atomic D1 trigger already handles duplicate/conflict/quota admission locally. A queue adds delivery, ordering, deletion and cost complexity before throughput is measured. | Measured D1 overload or sustained backpressure that cannot be solved by admission limits. |
| Analytics Engine for traffic | Approximate, sampled, separate retention and deletion semantics; it cannot be the payment ledger and would create a second truth for reports. | A measured high-volume aggregate use case with validated sampling/deletion. |
| KV security counters | Eventually consistent; wrong for authoritative quotas and admission. D1 atomic counters are the correct mechanism. | Never for quota authority; only for non-authoritative edge hints if measured. |
| Per-tenant D1 sharding | Public v1 does not depend on it; it multiplies migrations, backups, routing and support. The shared database is acceptable for a capped alpha. | Measured database size/throughput ceiling, or a contractual isolation requirement. |
| In-app backup/R2 archive service | Operator `d1 export` + Time Travel + journal replay are enough for alpha. An in-app service needs its own retention, access and deletion design. | Customers pay for self-serve restore or compliance requires automated off-account retention. |
| Scheduled email digests | No email infrastructure exists; activation and support are higher-value. | Retention proves users want digests and an email provider is selected. |
| Multi-touch attribution, cohorts, saved views | Reporting expansion is not an alpha blocker; retention and correctness come first. | Alpha usage shows demand and the retained-detail ceiling is measured. |
| Multiple payment providers / subscription engine | This is Analytica's commercial model, not customer revenue analytics. It must not be mixed into the existing ledger. | A paid public-v1 decision, pricing and legal terms exist. |
| Turnstile/public signup before alpha | Invite-only is the correct alpha control; public signup adds abuse, email, legal and entitlement work. | Alpha retention and a support model are proven. |
| Full admin control plane | `MODE` is a label; a separate admin service is premature. Read-only diagnostics and runbooks solve the immediate need. | Multiple operators and repeated tenant interventions justify tooling. |
| Custom-domain automation | Choose the domain once; manual configuration is acceptable for alpha. | Self-serve hosted onboarding at scale. |

**Challenge to prior reviews:** the payment/recovery corrections are fixed and should not be reopened. The queue, Analytics Engine, KV-counter, sharding, R2-archive, email-digest and multi-provider billing proposals are not supported by current measurements. They should be recorded as deferred options, not folded into the alpha plan.

---

## 7. Suggested sequence and decisions

**Sequence (dependency order, not a schedule promise):**

1. Choose the hosted domain and account; create staging; add the hosted config profile; fix the deploy preflight and readiness check.
2. Deploy staging; run the install → event → report → export → deletion smoke; record the button and CLI matrix.
3. Add the fresh-DB/upgrade CI fixture; run an upgrade with existing owner/data.
4. Add workspace quotas, distinct 429s, usage endpoint and dashboard visibility; run the bounded staging load test and set caps below the measured knee.
5. Run the restore drill with external journal custody; document the 7/30-day window and shared-DB blast radius.
6. Add first-event diagnostics, request IDs and the operator triage command.
7. Add workspace deletion and operator suspension/closure; publish basic alpha terms/privacy and a support contact.
8. Invite 3–5 design partners on synthetic-then-real data; measure activation, ingestion, quota and support load.
9. Only then decide public signup, pricing, email, entitlements and any scaling architecture.

**Decisions required before alpha:**
- Is hosted alpha on Workers Paid? **Recommend yes** for CPU, D1 query budget and 30-day Time Travel.
- Which domain is final before passkeys are enrolled? Changing it later forces re-enrollment.
- Who owns support and incident response for the alpha? A runbook without an owner is not a gate.
- Is a shared-database restore blast radius acceptable for alpha with disclosure, or is per-tenant export/restore required earlier?
- Is public v1 paid, free, or invite-only? This determines whether entitlements and billing are in scope at all.

**External references used (fetched 26 October 2026):**
- Deploy to Cloudflare buttons: <https://developers.cloudflare.com/workers/platform/deploy-buttons/>
- D1 limits (storage, Time Travel duration, per-invocation queries): <https://developers.cloudflare.com/d1/platform/limits/>
- D1 Time Travel and backups: <https://developers.cloudflare.com/d1/reference/time-travel/>
- Workers pricing (Free/Paid, CPU, D1, Logs): <https://developers.cloudflare.com/workers/platform/pricing/>
- Workers Logs and head sampling: <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>

---

## 8. Summary for parent

- **The application is stronger than its operating model.** Atomic setup, atomic admission, restore-lock allowlists and forward migrations are sound. The missing work is deployment proof, tenant fairness, recovery evidence, activation visibility and lifecycle.
- **Confirmed source defects to fix now:** deploy can publish stale assets (`package.json:16`), `/healthz` is shallow and hardcoded (`apps/worker/index.ts:140-147`), the hosted installation quota is shared by all tenants (`migrations/0001_analytics.sql:116`), 429s conflate scope and use a fixed `Retry-After` (`apps/worker/analytics.ts:378-380`), and 5xx responses omit the request ID from the body (`apps/worker/index.ts:166-184`).
- **Absent capabilities that block alpha or public v1:** for alpha — hosted configuration/profile and custom-domain decision, per-workspace quotas and usage UI, off-account backup and restore drill, first-event diagnostics, operator diagnostics, workspace deletion, user suspension runbook, and a real support contact; for public v1 — self-service owner transfer, account deletion/export, status page, public signup, email, legal terms and any paid entitlement model.
- **Unverified evidence, not defects:** clean-account button install, CLI install, remote migration permissions, real-device passkeys, custom-domain RP behavior, remote restore and lock persistence, and capacity/cost measurements. The release-status table already names most of these; it needs dated artifacts.
- **Top five:** (1) hosted release/upgrade proof; (2) per-workspace quota isolation, usage visibility and a measured operating envelope; (3) backup/recovery drill with plan-aware retention; (4) activation and supportability; (5) account lifecycle with billing kept separate.
- **Do not build yet:** queues, Analytics Engine, KV quota counters, per-tenant sharding, an in-app backup service, email digests, multi-touch attribution, multiple payment providers or a subscription engine. None is justified before the first hosted alpha is measured.
- **Recommended alpha posture:** Workers Paid, invite-only, synthetic staging first, a single chosen domain, per-workspace caps below the installation cap, 30-day Time Travel plus off-account export, and a founder-owned support runbook. Public v1 should wait for the gate matrix and a paid/free commercial decision.
- **No runtime tests were executed for this review.** All claims are source inspection at `80be717` plus official Cloudflare documentation; payment/recovery findings already fixed in `80be717` are not re-reported.
