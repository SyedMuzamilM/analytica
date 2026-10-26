# Deletion and recovery

The app supports owner/admin visitor erasure and owner site deletion. Erasure commits a suppression record before deleting visit detail in bounded batches; new events using that identifier are rejected. Raw reports, journeys, funnels and exports exclude the suppressed identifier while cleanup drains. Financial snapshots contain sanitized acquisition dimensions, not customer email or name. Site deletion also removes its money, keys and integrations. A retained site tombstone prevents intake and marks completion after every domain table is empty.

GET `/api/workspaces/WORKSPACE_ID/deletion-journal` lets an authenticated workspace owner download the opaque deletion records. Exports are paginated, at most 1,000 records per response. Follow each `nextCursor` using the `cursor` query parameter until `complete` is true, and save every page. Each cursor pins the initial export boundary, so new records appear in the next fresh export rather than changing the current page set. Erasure requests for never-seen visitor IDs return `visitor_not_found` without adding permanent journal rows. Keep this journal privately outside the D1 database before any restore, alongside the account's backup process. A journal inside a restored database cannot prove deletions that happened after that snapshot. Treat opaque visitor/site identifiers as sensitive operational data and restrict access.

Before restoring D1, set `RESTORE_LOCK` as a **Worker secret** in the same account/config/environment as the deployment:

```bash
npx wrangler secret put RESTORE_LOCK
```

Enter `true` at the private prompt. Do not add this name to `vars` or use a dashboard plain-text variable: ordinary Wrangler deployment reconciles plain variables and can silently remove a lock. A Worker secret survives ordinary code deployments. Confirm POST `/v1/collect` returns `503` with `restore_in_progress` before restoring. If any deployment is necessary during recovery, verify that response again immediately afterward.

The lock blocks collection, money intake, ordinary workspace reads/mutations and all account security changes. Its auth allowlist is GET `/api/auth/status` and POST `/api/auth/login/options`, `/api/auth/login/verify`, `/api/auth/logout`. Passkey enrollment, recovery, invitations, workspace creation, member removal and session-revocation APIs stay closed. Owner-authenticated journal export and replay remain available in a separate rate-limit bucket. Scheduled work runs only deletion cleanup while locked so replayed erasure/site jobs can drain. Auth expiry, summary rebuilding, ordinary retention and provider-refund retries stay paused until the lock is removed.

Preserve the existing APP_SECRET and final application origin. Do not delete `setup_state`, reopen first-owner setup or replace the configured passkey relying-party origin during recovery. SETUP_TOKEN is needed only before the first owner is configured; an already-configured installation can sign in without it.

Restore the chosen D1 Time Travel snapshot using the pinned Wrangler version's `d1 time-travel` commands. Consult `npx wrangler d1 time-travel --help` and verify the target account/database/environment before mutation. A restore can remove writes made after the chosen timestamp. Worker rollback and database restore are different operations; prefer compatible forward migrations and Worker version rollback for ordinary application errors.

For every workspace, reapply its newest external journal with owner-authenticated POST `/api/workspaces/WORKSPACE_ID/deletion-journal/reapply` and JSON `{ "records": [...] }`. Send at most 20 records per batch, preserving the opaque record IDs. Repeating a batch is safe. This schedules deletion and suppression without recreating users. A `workspaceReplayComplete` response covers only that workspace, never the whole installation.

Keep RESTORE_LOCK set while scheduled cleanup drains and while checking every workspace's required replay. Reconcile money totals and summaries, verify erased identifiers are absent from reports and intake, and verify all pending site-deletion work has finished. Use the operator's current external access inventory to reconcile every security change since the snapshot: disabled users, removed memberships, revoked passkeys, consumed or replaced recovery codes, revoked sessions/API keys/invitations and disabled payment integrations. Restored revoked passkeys or recovery codes must not remain valid when the lock is released. The journal records visitor/site erasure; it does not record these account security changes. With account mutation APIs locked, perform the required revocations through reviewed, scoped D1 maintenance statements in the intended account/database. Invalidate pending auth challenges before unlock so proofs issued before reconciliation cannot complete afterward. Preserve a verified owner passkey that can sign in after reconciliation, and test that revoked credentials cannot do so.

Only after all workspace replay, deletion cleanup and access checks pass, remove the secret:

```bash
npx wrangler secret delete RESTORE_LOCK
```

Confirm ordinary intake no longer returns `restore_in_progress`, sign in with the retained owner passkey and verify a report. Record the before/after lock checks and access-inventory reconciliation in the incident log.

This runbook has local regression fixtures for suppression, owner journal access under lock, blocked auth mutations, real passkey login under lock, replay and more than two deleting sites. Secret persistence across a remote deployment still needs a recorded remote check. A real Cloudflare backup/restore drill and retained-journal storage/access process remain required before admitting external customer data. No automatic off-account backup service is configured by the app.
