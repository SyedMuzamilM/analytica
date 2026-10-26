# Implementation review corrections

The implementation at `852c52e` was submitted to GLM Free, DeepSeek Free and Antigravity. Their reports are independent inputs, not a deployment approval or a substitute for runtime evidence.

## Antigravity UI review

Reviewed by `gemini-3.8-flash-high`. The primary agent checked its findings against the actual source before editing.

- Active funnel deletion now clears selected ID, result and error before refreshing the list. A regression flow checks that deletion does not request the deleted funnel's report.
- Page steps receive specific client-side validation for `/`-prefixed exact paths without queries/fragments. Input is trimmed; an invalid path is explained instead of silently changed.
- Funnel bars expose progressbar role, named metric and numeric min/max/value semantics.
- Available live sites are filtered by their selected workspace before child views mount. Aborted list/report requests cannot replace current state.
- Journey actions identify the browser and entry path to assistive technology. Narrow tables have a keyboard-accessible region, mobile swipe guidance and sticky first column.
- Demo funnels/journeys continue to explain their limitations without invented personal activity. A richer synthetic preview is deferred.

The report's broad claims about proven isolation, compliance or general engineering quality are not adopted. Its verification baseline was supplied by the parent; it did not run a live deploy or establish legal compliance. Several quoted snippets/line references are approximate. The current test plugin is `@cloudflare/vitest-plugin`, not its deprecated predecessor.

## Other provider reviews

GLM Free's review is complete. It pinned commit `852c52e` because the working tree was being formatted during inspection. The larger line counts reflected source formatting, not a separate rewrite. Its findings were rechecked against the current tree. It found no P1 defect in the reviewed scope; that is not a production-security guarantee.

- Canonical route deduplication now strips trailing slashes independently of path redaction. A Chromium fixture checks both normal and redacted navigation.
- Signed money webhooks distinguish paused sites, deleted sites and unknown integrations. A real-D1 test interposes a competing pause after lookup to verify the classified retryable response and no financial write.
- Unknown visitor IDs no longer create erasure records; repeated known erasure remains idempotent. Journal export uses a stable, paginated boundary and a fixture exports 1,005 rows without omission or duplication, excluding records added after export began.
- The active server-key cap is now enforced by forward migration `0005_key_admission.sql`, with a concurrent-insert test. Checkout visitor/session IDs have explicit bounds, and server money errors use stable codes.
- Report coverage now states event/session boundary rules and warns when the earliest day can include expired detail. Auth request-write overhead remains part of remote resource measurement.

## DeepSeek payment and recovery review

DeepSeek Free reviewed committed snapshot `4d90769` as `opencode/deepseek-v4.1-flash-free`. Its seven findings were reproduced or checked against the current tree and corrected. Two native implementation agents handled refund normalization and auth/recovery changes; the primary agent integrated and reviewed their changes and fixed checkout issuance.

- Dodo checkout correlation now uses a merchant-generated order ID. The backend issues the claim before provider checkout creation and sends `analytica_claim` plus `analytica_checkout` in metadata. A signed fixture uses a different Dodo-generated session ID and checks rejection of a changed merchant order.
- Optional Dodo refund currency resolves from the scoped original payment. Omitted amount resolves only for an explicit full refund. Incomplete deliveries persist minimal evidence and receipts in forward migration `0006_provider_refunds.sql`, acknowledge HTTP 202, and retry in bounded fair batches. Unknown partial amounts require trusted reconciliation. Tests cover namespace isolation, receipt conflicts, repeated delivery, retention, deletion, admission cap and retry fairness.
- Recovery blocks security/account mutations using explicit allowlists. Owner journal replay remains available. Scheduled work performs deletion cleanup only, freezing other retention, auth expiry and financial retries.
- The runbook sets RESTORE_LOCK as a persistent Worker secret and checks it across any recovery deployment. Remote secret-persistence verification remains pending. Security reconciliation includes revoked passkeys, recovery codes, sessions, invites, API keys and integrations.
- Claim issuance checks persisted admission, rechecks revoked keys/disabled integrations, and returns the same unexpired unconsumed claim on identical retry. Concurrent duplicates and competing revocation/disable are tested.
- Ordinary sign-in needs APP_SECRET after setup. SETUP_TOKEN can be removed without reopening bootstrap. Tests use cryptographic WebAuthn login and verify setup stays closed.
- Authenticated reads/exports are rate-limited by verified user identity; account and journal-recovery buckets are separate. Anonymous auth, collector, server and webhook gates use separate coarse abuse buckets. Approximate per-edge limits still require public-load testing.

Final local checks pass: 79 Worker/D1 tests, five Chromium flows, typecheck, formatting, production build, dependency audit and Wrangler dry-run. All requested independent reports are complete. No remote deployment has occurred; target-account credentials and the documented remote release gates remain outstanding.

## CI deletion ordering regression

Linux CI exposed a remaining nondeterministic deletion deadlock. Completed-site filtering alone was insufficient: domain modules selected sites in incidental database order while the finalizer selected privacy jobs by timestamp/random journal ID. With four sites, their two-item work lists could be disjoint forever. A deterministic fixture reverses the journal order and reproduced the exact two-events-left failure locally before the fix.

All domain purges now call `pendingSiteDeletions`, which uses the finalizer's timestamp/ID job order. The adversarial fixture passes after that single scheduling change. The initial possibilities were work-list mismatch, a missed domain table, or a clock boundary; the order-only change resolved the failure. No production logging or temporary probes were introduced.
