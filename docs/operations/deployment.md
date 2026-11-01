# Deploy Analytica

Run all local checks in README before deploying. The app is an early implementation; its release matrix distinguishes local tests from remote account evidence.

## Guided Cloudflare installation

Use the repository-root Deploy to Cloudflare flow after publication. Cloudflare should copy the repository, provision D1, prompt for secrets, build the dashboard and run migrations/deploy. Normal setup must require no terminal or database-ID editing. A clean-account button installation, a resource rename, safe secret defaults, migration permissions, retry and upgrade still require a recorded real test.

Set two different high-entropy runtime secrets: APP_SECRET and SETUP_TOKEN. Never accept the example values. Generate them with a password manager or a trusted local cryptographic generator and enter them in Cloudflare's private secret fields. No automatic secret-generation behavior is assumed. Open the deployed URL, enter the setup token, register the owner passkey and save its recovery codes. Another visitor cannot claim an unconfigured installation without the private token. After owner setup succeeds, SETUP_TOKEN can be deleted without affecting sign-in; APP_SECRET remains required. Owner setup stays closed.

The initial passkey relying party is the installation hostname. Choose the final custom domain before enrolling production users. A passkey registered for a workers.dev hostname will not automatically work on an unrelated custom domain. Keep a working origin/recovery route during any domain migration, and test replacement credentials before removing the old hostname.

## CLI deployment

Authenticate privately using Wrangler OAuth or a least-privilege token supplied through a secret file/environment. Set CLOUDFLARE_ACCOUNT_ID explicitly and verify `npx wrangler whoami` shows the intended account. The local OAuth account may differ from the requested production account. Do not deploy to an account merely because it is logged in.

```bash
npm ci
npm run build
npx wrangler whoami
npx wrangler d1 create analytica
```

Record that database ID in a private deployment configuration copied from `wrangler.jsonc`, or use Wrangler's tested automatic provisioning path. Enter secrets with `wrangler secret put` and the same config/environment used for migration/deployment. Do not commit secrets or an operator's account-specific configuration to the portable template.

```bash
npx wrangler secret put APP_SECRET
npx wrangler secret put SETUP_TOKEN
npm run deploy
```

The package build script and deployment script are intentionally separate for Workers Builds. Configure build `npm run build`, deploy `npm run deploy`, repository root. Confirm the build credential can run D1 migrations and distinguish build-time secrets from Worker runtime secrets. Both migration and Worker deploy must use the identical environment/config. A migration failure must stop deployment.

Use separate Worker names, D1 databases, secrets and config files for staging and production. Never expose production resources or credentials to untrusted preview code. Staging uses synthetic data. In hosted mode set runtime MODE=hosted; initial access is invite-only, with no email delivery or subscription billing dependency.

The rate-limit binding is an approximate per-edge gate before D1. It is not an exact global quota or protection against distributed floods. Authoritative daily event quotas are checked atomically in D1. Profile public intake with actual edge limits and preserve auth/maintenance capacity before opening customer signup.

## Deploying across two Cloudflare accounts

A Worker custom domain must belong to the same account as its Worker. When the database/application account differs from the domain account, deploy `apps/proxy/index.ts` as a separate Worker in the domain account. Set its `ORIGIN` to the application Worker's HTTPS URL and attach the custom domain to this proxy. Disable the proxy's workers.dev and preview URLs.

For this topology, the application Worker's entry point must be `apps/worker/proxied.ts`. Set the same fresh random `PROXY_SECRET` in both Workers, set the application's `APP_ORIGIN` to the final custom-domain origin, and set `assets.run_worker_first` to `true`. Keep account-specific configurations in ignored private files. Deploy migrations and the application's secrets in the application account; deploy the proxy and its secret in the domain account.

The proxy replaces incoming forwarding credentials and supplies the original visitor IP. The application entry point checks the proxy secret before serving application requests, restores the visitor IP for rate limits, and removes forwarding credentials before calling the application. Unauthenticated GET/HEAD requests to workers.dev redirect to the configured APP_ORIGIN, while unauthenticated writes and forged forwarding credentials are denied. This prevents direct writes to the application's workers.dev URL from bypassing the proxy and avoids treating every forwarded visitor as the same cross-account Worker IP. Scheduled maintenance still runs in the application account. Preserve both Workers' shared proxy secret during upgrades.

## Public product and project images

Set `PUBLIC_SIGNUP=true` to enable direct passkey signup into isolated user-owned workspaces. Leave it unset for token-protected self-hosted owner setup. Public signup requires a valid APP_SECRET; it does not use or grant access to the installation setup token. Every new account receives one-time recovery codes. Current admission is bounded to 100 accounts/workspaces per installation and existing site/event limits remain in effect.

The product home is `/`, account routes are `/signup` and `/login`, the project dashboard is `/app`, documentation is `/docs`, and labeled sample reports are `/demo`. A fresh passkey verification and typed DELETE confirmation protect account deletion. Credentials are removed immediately. Sole-owner workspaces stop collection and enter bounded background deletion, including their private images; shared-owner workspaces remain with their other owners. Opaque deletion journals remain for recovery suppression.

Bind `PROJECT_ASSETS` to a private R2 bucket for project logos. Supported uploads are PNG, JPEG and WebP up to 48 KB. Reads require current workspace membership, writes require admin/owner access, and executable SVG uploads are rejected. No public bucket URL is needed. Account-specific bucket and database configuration belongs in the private deployment config.

See [Orchard Ledger integration](orchard-ledger-analytics.md) for testing and release configuration.

## Upgrades and rollback

Commit every schema change as a new forward migration after a release exists. Editing an already-applied SQL file does not update a deployed database. Keep the source template free of any one customer's database ID; do not overwrite the deployer's effective configuration during updates.

Apply compatible additive migrations, deploy the new Worker, check `/healthz`, passkey sign-in, first event/report, money intake and maintenance. Test a second deploy and update without recreating owner/data. Roll back Worker code only to versions compatible with the current schema. Use forward fixes for schema changes; use D1 Time Travel as an incident recovery operation with its data-loss consequences.

Follow [data recovery](data-recovery.md) for the persistent RESTORE_LOCK Worker secret, external deletion journals, replay, credential revocations and release of the lock. Never configure that lock as a plain deployment variable. A real restore drill remains a customer-launch gate.
