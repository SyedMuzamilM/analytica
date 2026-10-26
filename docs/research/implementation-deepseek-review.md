# Implementation review (DeepSeek) of Analytica at HEAD `4d90769`

- **Author model (actual):** DeepSeek V4.1 Flash Free, provider `opencode` (OpenCode / T3 Code harness). Free tier confirmed; the review proceeded.
- **Date:** 26 October 2026.
- **Scope:** independent, read-only review of the committed implementation against its release and operations documentation. No Cloudflare or Dodo account, credential, secret, or deployment was used. No application, configuration, test, or migration file was modified; no PR, push, or new top-level thread was created. The only file written is this report. Public provider documentation was fetched over HTTPS.
- **Pinned snapshot:** `git archive 4d90769`, unpacked at `/tmp/analytica-4d90769`. The repository advanced to `41dd411` ("Use one ordered deletion work list to prevent cleanup deadlocks") and the working tree was being edited by another process while this review ran. Every line reference below is from the pinned `4d90769` snapshot, not from the newer working tree. Uncommitted changes were deliberately excluded.
- **Focus:** Dodo webhook/claim behaviour, passkey origin binding, restore locking, guided Deploy-to-Cloudflare provisioning, rate-limit binding, and Cloudflare resource/budget compatibility.
- **Not a live validation:** no Dodo sandbox checkout, clean-account button install, Cloudflare restore drill, remote CPU measurement, or hardware/device passkey test was performed. Those remain documented remote gates, not confirmed defects. This report separates them explicitly.

Severity: **P1 / High** = a core documented flow loses money records or cannot work at all; fix before any real payment integration. **P2 / Medium** = unsafe or misleading recovery/security behaviour on current code; fix before relying on the runbook or admitting customer data. **P3 / Low** = a real but narrow correctness, operational, or budget gap; fix with a small change.

## Bottom line

The local implementation is substantially stronger than the earlier research reports assumed. The webhook signature check, passkey origin binding, fail-closed secret placeholders, binding-based migration script, and rate-limit binding all have real code behind them, and the committed checks pass locally.

Two payment-contract defects are nevertheless confirmed on the pinned code:

1. The documented Dodo checkout-correlation flow cannot be satisfied with Dodo's create-time metadata API. A correctly signed `payment.succeeded` carrying a valid claim is rejected as `invalid_claim` and is never recorded.
2. A schema-valid `refund.succeeded` that omits `currency` (or `amount`) is rejected with `400` and is never recorded. The app does not fall back to the original payment's currency.

Both are local contract defects, even though a live Dodo sandbox run is also an open release gate. The restore lock also needs a scope/lifecycle correction before it can be trusted during recovery.

## Findings at a glance

| # | Severity | Area | Finding |
| --- | --- | --- | --- |
| 1 | **P1 / High** | Dodo checkout correlation | Claim issuance and Dodo metadata ordering are mutually unsatisfiable; a valid claim makes the payment unrecordable |
| 2 | **P1 / High** | Dodo refunds | Refund events without `currency` or `amount` are rejected and dropped after retries |
| 3 | **P2 / Medium** | Restore lock | `/api/auth/*` security mutations bypass `RESTORE_LOCK`; a restored credential can add a passkey or create workspaces during recovery |
| 4 | **P2 / Medium** | Restore runbook | `RESTORE_LOCK` is not in the template and its set/remove procedure is unsafe under Wrangler's variable reconciliation |
| 5 | **P3 / Low** | Checkout claims | A claim insert that writes zero rows still returns `201`; duplicate checkouts return `409` instead of reissuing the same token |
| 6 | **P3 / Low** | Setup secret | `SETUP_TOKEN` is required for every auth route forever; removing the bootstrap token after setup locks all users out |
| 7 | **P3 / Low** | Edge limiting | The edge limiter covers only `/v1/*` and `/api/auth/*`; authenticated report/export traffic bypasses it, and the key is IP-based |

I did not re-report the peer fixes already present in `4d90769`. In particular, paused/deleting webhook classification (`apps/worker/revenue.ts:640-645`, `:701-716`), trailing-slash tracker deduplication, erasure phantom rows, journal export bounds, and API-key admission are present and were excluded from the findings list.

---

## 1. P1 / High — Dodo checkout correlation is unsatisfiable with the documented API order

**Location:** `apps/worker/revenue.ts:492-573` (claim issuance), `:402-415` (claim lookup), `:668-682` (webhook mapping); `docs/operations/payments.md:19-29` (documented flow); `migrations/0002_revenue.sql:55-71` (claim identity).

**Defect.** The app's trusted-correlation flow requires a `checkout_claims` row whose `checkout_id` equals the provider checkout ID presented by the webhook. It also requires the merchant to put the signed claim token into Dodo metadata. Dodo's checkout API makes those two requirements impossible to satisfy in the documented order:

- Dodo generates the checkout `session_id` when the session is created and returns it in the create response. Metadata is a create-time field; the published checkout API has create, get, and preview operations, but no metadata-update operation ([Dodo checkout sessions](https://docs.dodopayments.com/developer-resources/checkout-session.md), [Create Checkout Session](https://docs.dodopayments.com/api-reference/checkout-sessions)).
- Analytica's `POST /v1/server/checkouts` creates the claim with the `checkout_id` supplied by the caller and returns the token (`revenue.ts:499-508`, `:536-573`).
- The Dodo webhook reads the token from `metadata.analytica_claim`, but reads the checkout ID only from `data.checkout_session_id || data.checkout_id` (`revenue.ts:668-682`). It never reads a merchant checkout ID from metadata.
- `recordMoney` then requires an exact match between that provider ID and the stored claim `checkout_id` (`revenue.ts:402-415`). A mismatch throws `invalid_claim` before any money row is inserted.

There is no working sequence:

- Create the claim **before** the Dodo session: the merchant can use its own order ID, but the webhook will compare the claim's order ID with Dodo's generated `checkout_session_id` and reject it.
- Create the claim **after** the Dodo session using `checkout_id = session_id`: the token cannot be added to the already-created session's metadata.
- Pre-generate the token but not the claim: `/v1/server/checkouts` generates the claim ID internally; the merchant has no API to choose it, and no claim-update endpoint exists.

The result is a false sense of a working correlation feature. If a merchant follows the docs and attaches a claim, every `payment.succeeded` for that checkout returns `409 invalid_claim`; Dodo treats any non-2xx response as a failure, retries up to eight times, and then drops the delivery ([Dodo webhooks: automatic retries](https://docs.dodopayments.com/developer-resources/webhooks)). The payment is never recorded. Without a claim the payment is recorded unattributed, so the documented attributed path is the one that is broken.

The payments page already admits that actual sandbox metadata propagation is unverified (`docs/operations/payments.md:27`). That gate does not excuse the local contract error: the code path cannot succeed for any Dodo-created session as written.

**Reproduction (executed).** The throwaway suite at `/tmp/analytica-4d90769/tests/tmp-deepseek-repro.test.ts` (not committed) creates a claim with `checkout_id = "merchant_order_1"`, then sends a correctly signed `payment.succeeded` with `checkout_session_id = "cks_generated_by_dodo"` and `metadata.analytica_claim` set to the valid token. Result: `409 {"error":"invalid_claim"}`, with `SELECT COUNT(*) FROM money_records` equal to `0`.

**Suggested fix and test.** Choose one contract and make the docs and code agree:

- Add a second metadata key, for example `analytica_checkout`, set at Dodo session creation, and have the webhook use `metadata.analytica_checkout` as the claim `checkout_id` when present (falling back to provider fields for compatibility). Create the claim before the Dodo session using the merchant order ID. This requires no post-create metadata update.
- Or add an authenticated claim-update/reissue endpoint keyed by the signed token, and document that the merchant must create the session, then update the claim with Dodo's `session_id`, then store the token. This is a more awkward order but also works.

Add a signed-fixture test that mirrors the chosen order end to end: create claim, create Dodo-like session, send `payment.succeeded` with both metadata keys, and assert `200`, one money record, and `matched_by = 'verified_checkout'`. Also add a negative fixture for a mismatched checkout ID so the intended 409 remains covered.

## 2. P1 / High — Dodo refund events without `currency` or `amount` are rejected and lost

**Location:** `apps/worker/revenue.ts:295-309` (`moneyInput` requires a valid ISO currency and a safe-integer amount), `:668-683` (maps `data.amount` / `data.currency` and returns `400`), `docs/operations/payments.md:15` (invalid currency is rejected).

**Defect.** The Dodo refund schema does not guarantee either field. The published `RefundListItem` schema marks `amount` and `currency` as optional/nullable, and the refund object is the same family used by refund webhooks ([Dodo refunds API](https://docs.dodopayments.com/api-reference/refunds)). `moneyInput` rejects the whole event when `currency` is absent or null, and also when `amount` is absent or null. It does not fall back to the original payment's currency or amount, even though the database already stores the original payment and the refund trigger enforces currency consistency (`migrations/0002_revenue.sql:75-79`).

The webhook returns `400 invalid_provider_money_record` (`revenue.ts:683`). Dodo retries non-2xx deliveries and eventually drops them. A refund that is valid at the provider therefore never appears in Analytica; net revenue is overstated and the refund quarantine/confirmation logic never sees it.

This is a contract defect independent of the sandbox gate: a provider payload that the published schema permits is rejected before any database work. It is also asymmetric with the payment path, where `total_amount` and `currency` are required.

**Reproduction (executed).** The throwaway suite sends a signed `refund.succeeded` with `refund_id`, `payment_id`, `amount: 500`, and no `currency` — a schema-shaped refund event. Result: `400 {"error":"invalid_provider_money_record"}`, with zero `money_records` rows. A second variant with `currency` but `amount: null` follows the same path.

**Suggested fix and test.** Normalize refund events before validation:

- If `currency` is absent/null, look up the original payment by `(workspace_id, site_id, namespace, kind='payment', external_id=data.payment_id)` and use its currency. If the original payment is not present, keep the refund pending or return a classified retryable error rather than a permanent 400.
- If `amount` is absent/null, use the original payment amount only when the provider marks the refund as full (`is_partial === false` or equivalent); otherwise reject/quarantine with an explicit reason. Do not silently treat a missing amount as zero.
- Add fixtures for omitted currency, null currency, and null amount. Existing tests cover partial refunds with explicit currency (`tests/revenue-security.test.ts:272-309`) but not a refund event shaped like the provider's optional-field schema.

## 3. P2 / Medium — `RESTORE_LOCK` leaves all auth security mutations open

**Location:** `apps/worker/index.ts:90-102` (lock applies only to `/v1/*` and `/api/workspaces/*`); `apps/worker/auth.ts:611-623` (only the secret-presence gate applies to auth routes); `apps/worker/auth.ts:778-826` (passkey and recovery-code changes), `:826-846` (recovery), `:847-881` (invitations), `:883-908` (workspace creation), `:945-968` (member removal); `docs/operations/data-recovery.md:7,13`.

**Defect.** The runbook says the lock "blocks collection and ordinary workspace reports/mutations while allowing auth and deletion-journal replay" (`data-recovery.md:7`). The implementation blocks only `/v1/*` and `/api/workspaces/*`. Every `/api/auth/*` mutation remains available, including:

- `POST /api/auth/workspaces` — creates a new workspace during recovery.
- `POST /api/auth/invites` — creates new membership invitations.
- `DELETE /api/auth/workspaces/:wid/members/:uid` — removes members.
- `POST /api/auth/passkeys/options` and `/passkeys/verify` — adds a passkey (recent-auth protected, but a restored passkey can produce a recent session).
- `POST /api/auth/recovery-codes/regenerate`, `/recovery/options`, `/recovery/verify` — changes recovery credentials.
- `/setup/*` — still reachable if the restored snapshot predates `setup_state`.

The operational consequence is not just "a write happened during restore." A restored account credential that was revoked after the snapshot can sign in, add a new passkey, and retain access after the operator revokes the restored sessions and API keys. The runbook's inventory mentions "sessions/keys" (`data-recovery.md:13`) but not passkeys or recovery codes, so the new credential can survive the recovery check. Workspace creation and invitations also create post-restore rows that are outside the deletion journal's scope.

**Reproduction (executed).** With `RESTORE_LOCK=true`, `POST /api/auth/workspaces` returns `201` and creates the workspace, while `POST /api/workspaces/:wid/sites` returns `503 restore_in_progress`. The throwaway test constructs a valid session and calls both routes in the same locked environment (`tests/tmp-deepseek-repro.test.ts`, test "allows auth workspace creation while RESTORE_LOCK is on").

**Suggested fix and test.** Apply the lock to all `/api/auth/*` mutations except an explicit read/login allowlist. A workable allowlist is `GET /status`, `POST /login/options`, `POST /login/verify`, and `POST /logout`; block setup, passkey enrollment, recovery, recovery-code regeneration, invitations, workspace creation, member removal, and session revocation during the lock unless the operator deliberately needs one. Add fixtures asserting each blocked route returns `503 restore_in_progress` and that login still works. Extend the runbook's revocation inventory to passkeys and recovery codes, or provide an operator query/export for them.

## 4. P2 / Medium — `RESTORE_LOCK` set/remove procedure is unsafe under Wrangler variable reconciliation

**Location:** `docs/operations/data-recovery.md:7,13`; `wrangler.jsonc:21` (only `MODE` is declared); `apps/worker/env.ts:10` (optional binding); `package.json:16` (`deploy` runs `wrangler deploy`).

**Defect.** The runbook says "set the runtime variable `RESTORE_LOCK=true` and deploy it" and later "only then remove `RESTORE_LOCK`." It does not say whether the value is a Wrangler `vars` entry, a dashboard variable, a secret, or a one-off CLI override. That ambiguity is dangerous:

- If the operator sets `RESTORE_LOCK` in the Cloudflare dashboard as a plain variable, the next `npm run deploy` removes it unless `keep_vars = true` is set. Wrangler's documented source-of-truth behaviour is that dashboard environment variables are overridden on the next deploy ([Wrangler configuration: source of truth](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)). A mid-recovery deploy could silently unlock the installation.
- If the operator adds `RESTORE_LOCK: "true"` to `wrangler.jsonc`, a later deploy can ship the lock permanently, and a rollback can carry it to another environment.
- If the operator uses `wrangler deploy --var RESTORE_LOCK:true`, the next ordinary deploy drops the override; the removal step is implicit and easy to miss.
- The setting is not declared in the template, so a clean install has no documented default and no deploy-check visibility.

**Suggested fix and test.** Document one deterministic mechanism. The simplest is a secret: `npx wrangler secret put RESTORE_LOCK` with value `true`, then verify a `/v1/collect` request returns `503 restore_in_progress`, and finally `npx wrangler secret delete RESTORE_LOCK`. Secrets are not reconciled away by `wrangler deploy`. Alternatively, declare `"RESTORE_LOCK": "false"` in `wrangler.jsonc` and use `wrangler deploy --var RESTORE_LOCK:true` for the recovery deploy, then redeploy the config default; document that `keep_vars = true` is required if the operator insists on dashboard variables. Add the chosen command sequence to `data-recovery.md` and a release-check note that the lock value is verified before and after deploy.

## 5. P3 / Low — Checkout claim issuance can return a token with no claim row; retries are not idempotent

**Location:** `apps/worker/revenue.ts:535-573` (insert and unconditional `201`), `:402-415` (claim lookup), `migrations/0002_revenue.sql:68` (unique `workspace_id, site_id, namespace, checkout_id`), `:811` (expired-claim cleanup).

**Defect.** The claim insert uses `INSERT ... SELECT ... WHERE EXISTS(...)` but ignores `result.meta.changes`. If the API key is revoked, or the site is paused/deleted between the initial `serverKey` lookup and the insert, the statement writes zero rows while the handler still returns `201` with a signed `claim_token`. A subsequent payment using that token cannot find a claim and is rejected as `invalid_claim`; the payment is not recorded. This is a narrow race, but it is exactly the kind of transition the money path is supposed to classify.

Separately, a retry of `POST /v1/server/checkouts` for the same `checkout_id` hits the unique constraint and returns `409 checkout_already_registered` without the token. If the first response was lost, the caller cannot recover the token until cleanup removes the expired row (the cleanup at `revenue.ts:811` runs on the 15-minute cron and only removes rows whose `expires_at` has passed, i.e. after 24 hours). The endpoint is therefore not idempotent even though the surrounding payment API emphasizes idempotent retries.

**Reproduction (executed).** With a proxy that revokes the key immediately after the initial key SELECT, `POST /v1/server/checkouts` returns `201` with a `claim_token` and `SELECT COUNT(*) FROM checkout_claims` is `0`. A second test posts the same valid checkout twice: the first returns `201`, the second returns `409 {"error":"checkout_already_registered"}` with no token.

**Suggested fix and test.** Check `meta.changes`; if zero, return a classified `409`/`503` (for example `key_revoked_or_site_inactive` or `checkout_not_created`) and do not sign a token. On a unique conflict, look up the existing unconsumed, unexpired claim for the same `(workspace, site, namespace, checkout_id)` and, if its visitor/session match the request, return the existing token with `200`; otherwise return the current `409`. Add both fixtures.

## 6. P3 / Low — `SETUP_TOKEN` is required for all auth, so removing it after setup locks everyone out

**Location:** `apps/worker/auth.ts:72-85` (`secretsReady` requires both `APP_SECRET` and `SETUP_TOKEN`), `:611-623` (all auth routes except `/status` return `503` when either secret is missing), `:648-669` (setup uses the token), `docs/operations/deployment.md:9` (both secrets are required at install); `docs/decisions/passkey-auth.md:17`.

**Defect.** `SETUP_TOKEN` is a first-owner bootstrap credential. After setup completes, `POST /setup/options` already refuses to run because `setup_state` exists (`auth.ts:651-655`), so the token has no remaining setup purpose on a normal installation. But `secretsReady` still requires it on every auth request. An operator who follows normal hardening practice and deletes the bootstrap token with `wrangler secret delete SETUP_TOKEN` immediately breaks `POST /login/options`, `POST /login/verify`, passkey sign-in, recovery, and every authenticated workspace action with a `503` that says to configure two secrets. The deployment page does not warn that the token must remain forever, and the runbook's recovery advice says not to reopen first-owner setup, which makes the permanent token look unnecessary.

**Suggested fix and test.** Split readiness: require `APP_SECRET` for all auth, and require `SETUP_TOKEN` only for `/setup/*` (and optionally report `setupAvailable` separately in `/status`). Alternatively, document explicitly that `SETUP_TOKEN` must remain installed and is a permanent recovery credential, and include it in the secret-rotation runbook. Add a fixture: complete setup, delete `SETUP_TOKEN`, assert `POST /login/options` still returns a challenge (or a deliberate, typed failure) rather than a generic 503.

## 7. P3 / Low — The edge limiter covers only collection/auth, and its IP-based key conflicts with Cloudflare guidance

**Location:** `apps/worker/index.ts:58-78` (limiter runs only when the path starts with `/v1/` or `/api/auth/`); `wrangler.jsonc:22-27` (120 requests / 60 seconds); `docs/operations/deployment.md:36` (approximate per-edge gate).

**Defect.** Authenticated report, export, journey, funnel, and revenue requests under `/api/workspaces/*` never call `EDGE_RATE_LIMIT`. A single authenticated viewer or a compromised session can issue repeated 90-day report/export queries and consume D1 read rows and Worker CPU without an edge gate. The D1 daily event quotas protect ingestion, not report reads. This does not contradict the docs, which call the binding approximate and only promise a "gate before D1," but it leaves the capacity-preservation goal incomplete for the most expensive read paths.

The limiter key is `SHA-256(APP_SECRET:CF-Connecting-IP)`. Cloudflare explicitly recommends against IP-based keys because many valid users share an IP through NAT, mobile networks, or privacy proxies; one noisy user can throttle others in the same Cloudflare location ([Rate Limiting API: best practices](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)). The per-location and eventual-consistency caveats are already documented and are not defects.

**Suggested fix and test.** Add a second limiter (or route-specific keys) for `/api/workspaces/*`, keyed by authenticated session or user ID plus route, and keep a coarse IP key only for unauthenticated `/v1/collect`. Add a fixture or load script that sends repeated report requests from one session and asserts the limiter is consulted; a unit test with a fake binding can assert the call count for a report path. Measure the selected keys against the remote profile gate before claiming a capacity envelope.

---

## Verified controls (what is actually implemented)

### Dodo webhook signature and idempotency

`verifyWebhook` reads the raw request body, enforces a 300-second clock window, decodes the `whsec_` base64 secret, computes `HMAC-SHA256(id.timestamp.body)`, and compares any `v1,` signature in constant time (`apps/worker/revenue.ts:576-616`). The handler rejects a reused `webhook-id` with a different body (`revenue.ts:646-653`, `migrations/0002_revenue.sql:86-88`) and writes the receipt and money row in one batch (`revenue.ts:444`). This matches the Standard Webhooks procedure in Dodo's documentation, including the five-minute window and raw-body requirement ([Dodo webhooks: verifying signatures](https://docs.dodopayments.com/developer-resources/webhooks)).

### Passkey origin and relying-party binding

`configuration` requires HTTPS (except loopback), rejects credentials, paths, queries, and fragments, and derives `origin`/`rpID` from `APP_ORIGIN` or the request origin (`apps/worker/auth.ts:112-131`). The challenge row stores both values, and `loadChallenge` refuses a challenge if the current configuration differs (`auth.ts:272-311`). Registration verification passes `expectedOrigin` and `expectedRPID` to SimpleWebAuthn (`auth.ts:565-575`), and login selects the credential by `p.rp_id = data.rpID` (`auth.ts:692-696`). Same-origin checks apply to all auth POSTs (`auth.ts:132-141`), and recent-auth checks guard passkey and recovery-code changes (`auth.ts:237-253`). This is a coherent origin-migration design; the remaining gate is real-device/custom-domain testing, not a local defect.

### Guided Deploy-to-Cloudflare provisioning

The repository-root template matches Cloudflare's documented button contract: `wrangler.jsonc` declares a D1 binding without an ID (`wrangler.jsonc:14-20`), `package.json` runs `wrangler d1 migrations apply DB --remote` before `wrangler deploy` (`package.json:16`), `.dev.vars.example` names the two required secrets, and `package.json` `cloudflare.bindings` supplies descriptions (`package.json:48-59`). The deploy script references the binding, not the database name, so a renamed database still migrates. The example values contain `REPLACE...` and are rejected by `secretsReady`'s placeholder regex (`auth.ts:75-79`), so they fail closed rather than becoming known credentials. These match the Cloudflare button guidance on automatic provisioning, secret prompts, custom deploy scripts, and binding-name migrations ([Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)).

The clean-account install, resource rename, partial-failure retry, update, and token-permission matrix remains a remote gate (`docs/operations/release-status.md:14`). Nothing in the local configuration contradicts the documented contract.

### Rate-limit binding

`wrangler.jsonc:22-27` declares `EDGE_RATE_LIMIT` with `limit: 120`, `period: 60`, which is a valid binding shape (`period` must be 10 or 60). The middleware hashes the client IP with `APP_SECRET` and returns `429` with `Retry-After` on failure (`index.ts:58-78`). `wrangler deploy --dry-run` reports `env.EDGE_RATE_LIMIT (120 requests/60s)`, so the binding is recognized by Wrangler. The approximate, per-location behaviour is documented in `deployment.md:36` and matches Cloudflare's own caveats. The coverage/key concerns are finding 7, not a failure of the binding itself.

### Resource and budget compatibility

The declared resources are one Worker, one D1 database, Static Assets, a rate-limit namespace, and one 15-minute cron (`wrangler.jsonc`). That is within the Workers Free plan's 100,000 requests/day, 10 ms HTTP CPU, 50 subrequests, and 128 MB memory limits on paper ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). D1 Free provides 500 MB per database and 5 GB per account ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)). The app's own admission limits are 1,000 accepted envelopes per site per UTC day and 2,000 per installation, with measured local writes of 9-12 rows per event (`README.md:60`, `docs/decisions/atomic-ingestion.md:13-25`). Those numbers are conservative enough that a 90-day detail window plus 396-day summaries is plausible within 500 MB, but it is not proven: the repo explicitly defers remote CPU, actual write/read billing, indexed storage at the retention ceiling, and mixed-load measurements (`release-status.md:7-14`; `atomic-ingestion.md:45-49`). No local contradiction was found; no free-capacity promise is made, which is the correct posture.

### Other controls checked

- `RESTORE_LOCK` does block `/v1/*` and `/api/workspaces/*` (except deletion-journal replay) and returns a typed `503 restore_in_progress` (`index.ts:90-102`). The gap is the auth surface in finding 3, not the middleware itself.
- The deletion journal replay path is explicitly exempted from the lock, matching the runbook (`index.ts:97-99`; `data-recovery.md:11`).
- The `.dev.vars.example` placeholders are rejected by both `secretsReady` and `revenue.validSecret` (`auth.ts:75-79`; `revenue.ts:81-82`), so a button install that accepts the example text does not get a working known secret.
- `APP_ORIGIN` is optional and defaults to the request origin; the deployment docs correctly warn that passkeys registered on a `workers.dev` hostname will not work on an unrelated custom domain (`deployment.md:11`). This is a documented migration constraint, not a defect.

## Local evidence at `4d90769`

All commands were run in `/tmp/analytica-4d90769`, the pinned archive, not in the concurrently changing working tree.

| Check | Result |
| --- | --- |
| `npx vitest run` | 63 passed (58 committed tests + 5 throwaway repro tests) |
| `npx vitest run tests/tmp-deepseek-repro.test.ts` | 5 passed, 0 failed |
| `npm run typecheck` | pass |
| `npm run build` | pass; 1,960 modules transformed |
| `npm run format:check` | pass for all committed paths; the uncommitted repro test was excluded |
| `npx wrangler deploy --dry-run` | pass; `env.DB (analytica)`, `env.EDGE_RATE_LIMIT (120 requests/60s)`, `env.ASSETS`, `env.MODE ("self-hosted")`; 892.64 KiB upload / 170.41 KiB gzip |
| `npm audit --omit=dev` and `npm audit` | 0 vulnerabilities |

The five throwaway tests and their observed results:

1. **Refund without currency** → `400 invalid_provider_money_record`, zero money rows.
2. **Valid claim with mismatched `checkout_session_id`** → `409 invalid_claim`, zero money rows.
3. **`RESTORE_LOCK=true` auth workspace creation** → `201` for `/api/auth/workspaces`, `503` for `/api/workspaces/:wid/sites`.
4. **Key revoked between lookup and claim insert** → `201` with a claim token, zero claim rows.
5. **Duplicate checkout claim POST** → first `201`, second `409 checkout_already_registered`, no token.

The repro file is not part of the repository; it was created only to demonstrate the defects and is excluded from the committed test count. No application source or configuration was changed.

## Local defects versus remote release gates

The following table separates what this review can prove from what remains a documented gate. A missing credential or account is not a defect.

| Area | Local finding | Remote gate |
| --- | --- | --- |
| Dodo claim correlation | **Finding 1 is a local contract defect**: valid claim + Dodo-style session ID cannot match | Real sandbox checkout metadata propagation and delivery verification remain unproven (`release-status.md:10`; `payments.md:27`) |
| Dodo refunds | **Finding 2 is a local contract defect** for schema-valid refunds without currency/amount | Live `refund.succeeded` payload shape and delivery remain unproven |
| Restore locking | **Findings 3-4 are local**: auth mutations bypass the lock; the set/remove procedure is ambiguous | A real D1 Time Travel restore, external journal custody, and drain/replay drill remain unproven (`release-status.md:11`; `data-recovery.md:15`) |
| Guided install | Template, secret placeholders, binding-name migrations, and binding descriptions are locally consistent | Clean-account button install, rename, retry, update, and token permissions remain unproven (`release-status.md:14`) |
| Rate limiting | **Finding 7 is a local coverage/key gap**; the binding itself is valid | Documented edge profile and noisy-tenant measurements remain unproven (`deployment.md:36`; `release-status.md:9`) |
| CPU/storage/budget | No local contradiction with Free limits; admission limits are conservative | Remote Free/Paid CPU, D1 billing, mixed load, and retained storage at the 90-day ceiling remain unmeasured (`release-status.md:7,9`; `atomic-ingestion.md:45-49`) |
| Passkeys | Origin binding and challenge binding are implemented and locally tested | Real hardware passkeys, supported-device coverage, and custom-domain migration remain unproven (`release-status.md:7`; `passkey-auth.md:66`) |

## Unable to verify

- No live Dodo sandbox account, checkout session, webhook endpoint, or refund was used. I could not confirm whether Dodo's `payment.succeeded` event includes metadata exactly as the payment object schema suggests, whether the refund event includes `currency` in practice, or whether a specific Dodo plan permits the documented metadata keys. The findings above are based on the published API/schema and on the local code's own contract, not on a live failure.
- No Cloudflare account, API token, D1 database, or deployment was used. I could not verify the Deploy button's secret prefill behaviour, the build token's D1 migration permission, resource rename/retry, or the post-deploy smoke path.
- No D1 Time Travel restore, off-account journal custody, or recovery drain was performed. The restore-lock findings are code-path and runbook findings, not a live drill.
- No remote CPU, memory, D1 row-read/write billing, storage, or mixed-load measurement was made. The local test suite runs in workerd with a local D1 emulation; it is not a production capacity measurement.
- No real browser/hardware authenticator test was made beyond the committed virtual-authenticator suite.

## Primary sources

Repository paths are relative to the pinned `4d90769` archive:

- `apps/worker/revenue.ts` — Dodo webhook, claim lookup/issuance, money validation, refund enrichment.
- `apps/worker/index.ts` — restore-lock and edge-rate-limit middleware, route mounting.
- `apps/worker/auth.ts` — passkey origin, setup/recovery/invite/workspace/member routes, secret readiness.
- `apps/worker/env.ts` — optional `RESTORE_LOCK` and rate-limit bindings.
- `wrangler.jsonc` — D1, rate-limit, cron, vars.
- `package.json` — deploy/migration scripts and `cloudflare.bindings`.
- `.dev.vars.example` — guided-install secret prompts.
- `migrations/0002_revenue.sql` — claim uniqueness, money/claim triggers, receipt conflict.
- `docs/operations/payments.md`, `docs/operations/data-recovery.md`, `docs/operations/deployment.md`, `docs/operations/release-status.md`.
- `docs/decisions/atomic-ingestion.md`, `docs/decisions/passkey-auth.md`.
- `tests/revenue-security.test.ts` — existing webhook/claim/refund fixtures; no Dodo-shaped refund-without-currency or mismatched-checkout fixture.
- `/tmp/analytica-4d90769/tests/tmp-deepseek-repro.test.ts` — throwaway reproduction suite, not committed.

External documentation:

- Dodo webhooks: <https://docs.dodopayments.com/developer-resources/webhooks>
- Dodo checkout sessions: <https://docs.dodopayments.com/developer-resources/checkout-session.md>
- Dodo create checkout session: <https://docs.dodopayments.com/api-reference/checkout-sessions>
- Dodo refunds: <https://docs.dodopayments.com/api-reference/refunds>
- Dodo payments: <https://docs.dodopayments.com/api-reference/payments>
- Cloudflare Deploy to Cloudflare buttons: <https://developers.cloudflare.com/workers/platform/deploy-buttons/>
- Cloudflare Wrangler source of truth: <https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth>
- Cloudflare Rate Limiting API: <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
- Cloudflare D1 limits: <https://developers.cloudflare.com/d1/platform/limits/>
- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
