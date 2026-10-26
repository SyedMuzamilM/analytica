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

DeepSeek Free's implementation/deployment review is still running. No remote deployment has occurred.
