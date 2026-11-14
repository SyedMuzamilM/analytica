# Security model: analytica

Threat model used to prioritize security scan findings for this repository. It was written with the maintainer from the code. Facts marked *(maintainer)* came from the maintainer; the rest is read from the code. Edit it as the system changes.

## Maintainer priorities *(maintainer)*
- **Assets:** all assets weigh the same; none is ranked above the others.
- **Attackers:** all count. None is ruled out.
- **Out of scope:** `docs/`, `examples/`, `bench/` and tests (`test/`, `tests/`, `Tests/`, `*.test.*`, `*_test*`). Findings located only in those paths are not worth fixing. Production code that a test exercises stays in scope.

## Components

| Component | Code | Trust boundary |
|---|---|---|
| **analytica-worker** | `apps/worker/**`, `migrations/**`, `packages/contracts/**`, `wrangler.jsonc` | Internet-facing Cloudflare Worker; D1, R2, rate limiter, cron |
| **analytica-dashboard** | `apps/dashboard/**`, `public/**` (incl. tracker) | Browser SPA served from Static Assets; tracker runs on customer sites |
| **analytica-proxy** | `apps/proxy/**`, `apps/worker/proxied.ts` | First-party proxy worker; shared secret `X-Analytica-Proxy-Secret` |

## System, entry points, assets and attackers

Web analytics SaaS / self-hosted on Cloudflare Workers + D1 + R2 (`wrangler.jsonc`, `MODE=self-hosted`, `workers_dev: true`, cron every 15 min). Release status says not yet admitting external customer data.
- Entry points: anonymous `/v1/collect` tracker intake (CORS `*`), `/v1/webhooks/*` (Dodo, signed via `verifyWebhook`), `/v1/server/*` server-side money API, `/api/auth/*` (setup token, passkeys/WebAuthn, recovery codes, invites, optional `PUBLIC_SIGNUP`), `/api/*` dashboard API (cookie sessions, Origin check on non-GET), proxied requests trusted via `PROXY_SECRET`.
- Controls: edge rate limit by hashed IP per group, 64 KB body limit, CSP/secure headers, Origin check, role ranks viewer<admin<owner (`auth.ts` `requireAuth`), HMAC claim tokens with `APP_SECRET`, RESTORE_LOCK.
- Assets: workspace analytics and visitor data (privacy modes, erasure), revenue/payment/refund records, passkeys, sessions, recovery codes, invites, R2 project logos, `APP_SECRET`/`PROXY_SECRET`/setup token.
- Attackers: anonymous internet (ingest abuse, auth bypass, spoofed client IP/proxy header, webhook forgery), authenticated users of another workspace (IDOR / tenant isolation), lower-role members escalating (viewer→admin/owner), malicious tracker payloads rendered in the dashboard (stored XSS).

## Open questions
- Is analytica deployed with real customer data yet? `docs/operations/release-status.md` says not.
