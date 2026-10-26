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

## Upgrades and rollback

Commit every schema change as a new forward migration after a release exists. Editing an already-applied SQL file does not update a deployed database. Keep the source template free of any one customer's database ID; do not overwrite the deployer's effective configuration during updates.

Apply compatible additive migrations, deploy the new Worker, check `/healthz`, passkey sign-in, first event/report, money intake and maintenance. Test a second deploy and update without recreating owner/data. Roll back Worker code only to versions compatible with the current schema. Use forward fixes for schema changes; use D1 Time Travel as an incident recovery operation with its data-loss consequences.

Follow [data recovery](data-recovery.md) for the persistent RESTORE_LOCK Worker secret, external deletion journals, replay, credential revocations and release of the lock. Never configure that lock as a plain deployment variable. A real restore drill remains a customer-launch gate.
