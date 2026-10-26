# Analytica

Web analytics for traffic, conversions and revenue, built on Cloudflare Workers, Static Assets and D1. Analytica has an original dashboard and tracker, workspace permissions, passkey sign-in, and explicit privacy modes.

This is an early implementation. Local integration and browser checks are available; remote capacity, the clean-account guided install and a Cloudflare restore drill must pass before admitting external customer data. See [release status](docs/operations/release-status.md).

## Run locally

Use Node.js 24 and npm.

```bash
npm ci
npm run setup:local
npm run db:migrate:local
npm run build
npm run dev:worker
```

Open http://localhost:8787/demo to explore labeled synthetic traffic. Open http://localhost:8787 to create the owner using the setup token generated in your ignored `.dev.vars` file. Keep that token private. The setup creates a passkey and shows single-use recovery codes once. Save them before continuing. No global default password exists.

`npm run setup:local` generates fresh local secrets and never overwrites an existing `.dev.vars`. For the optional Vite development server, configure `APP_ORIGIN=http://localhost:5173` in that file and run `npm run dev -- --host localhost` in a second terminal. Passkeys are bound to the hostname; use localhost consistently. Production requires HTTPS.

## What works

- Workspace creation, owner/admin/viewer authorization, invitations, passkeys, recovery and session revocation.
- Multiple sites, aggregate or consent-controlled attribution measurement, SPA tracking, goals and outbounds.
- Period comparisons, source/page/country/device/event filters and exact retained-detail reports with IANA timezone boundaries.
- Ordered session funnels, admin-only visitor journeys and visitor erasure for attribution-mode sites.
- Integer-minor-unit payment/refund API, per-currency totals, idempotency, partial refunds, and signed Dodo webhook intake.
- Bounded retention, export, deletion and a replayable deletion journal for operator recovery.

The aggregate tracker uses document-scoped identifiers in memory. Full navigation loses the identifier; it does not count verified people or returning visitors. Attribution mode starts only after `window.analytica('consent', true)`. Neither mode makes a blanket claim about consent-law exemptions. Sensitive paths can be fully redacted with `data-redact-path`.

## Install the tracker

Add a site in the dashboard and copy its installation snippet.

```html
<script defer src="https://YOUR_INSTALLATION/tracker.js"
  data-site="YOUR_PUBLIC_SITE_ID" data-mode="aggregate"></script>
```

```js
window.analytica('goal', 'signup');
window.analytica('optOut', true);
// Attribution-mode sites require the configured consent condition first:
window.analytica('consent', true);
```

Server keys and webhook secrets belong on the backend. Never embed them in this snippet, browser code or coding-assistant prompts. Read [payment integration](docs/operations/payments.md) for trusted checkout correlation and transaction namespaces.

## Cloudflare deployment

The default distribution is one repository-root Worker and D1 binding `DB`. The deployment script applies migrations using the binding name, so database renames do not break the template. Runtime secrets `APP_SECRET` and `SETUP_TOKEN` must be different fresh random values, at least 32 characters, entered through Cloudflare's secret controls. Example placeholders fail closed. SETUP_TOKEN can be removed after the first owner is configured; APP_SECRET remains required.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SyedMuzamilM/analytica)

This is the guided installation template. Its clean-account install/rename/retry/update matrix is still pending remote verification; the button link alone is not evidence that those checks passed. See [deployment](docs/operations/deployment.md) for CLI, account selection, environment isolation, upgrades and the clean-install checks. The running app never needs a Cloudflare control-plane API token.

Initial conservative limits are 1,000 accepted event envelopes per site/day and 2,000 per installation/day. Engagement and idempotency receipts consume writes too. These are safety defaults, not a verified free-tier capacity promise. Free D1 databases are limited to 500 MB each. See [measured local write costs](docs/decisions/atomic-ingestion.md).

## Verify

```bash
npm run typecheck
npm test
npm run build
npm run deploy:check
npx playwright install chromium
npm run test:browser
npm audit --audit-level=high
```

Worker tests use real D1 and cryptographic WebAuthn verification. Browser tests start an isolated temporary database and a Chromium virtual authenticator; they never provision a production owner. Screenshots remain in the ignored `output/playwright` directory. Remote Free CPU, actual billing/storage and payment-provider sandbox behavior require separate checks.

## Design and research

[Implementation plan](docs/implementation-plan.md), [Minilytics assessment](docs/minilytics-assessment.md), [provider research](docs/research/README.md), and [source acknowledgements](THIRD_PARTY_NOTICES.md).

MIT licensed. Minilytics was the benchmark for the source review; Analytica's current application is a new implementation.
