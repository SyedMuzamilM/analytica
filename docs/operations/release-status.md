# Implementation and release evidence

Updated 26 October 2026. This file distinguishes a working local implementation from a validated public service.

| Area | Current evidence | Remaining check |
| --- | --- | --- |
| Worker/D1/auth | 58 passing workerd integration tests with concurrent SQL and cryptographic WebAuthn, no mocked database | Remote CPU, supported-device sign-in and custom-domain RP policy |
| Dashboard/tracker | Original React app; demo isolated from live APIs; 5 passing Chromium flows: virtual-owner setup, site creation, pageview/goal reporting consent/opt-out and canonical SPA paths | Broader browser/device coverage and accessibility review |
| Ingestion | Insert-trigger atomic deduplication, quota/session mutations, cross-site checks, suppression and conflict fixtures | Mixed public load, distributed-abuse profile, actual storage/billing metadata |
| Revenue | Signed webhook races, economic idempotency, partial refunds, claim trust/retry and retained snapshot tests | Real Dodo sandbox checkout metadata and delivery verification |
| Privacy/operations | Bounded cleanup, replay journal, suppression and >2-site deletion fixtures | Off-database journal custody and a real Cloudflare restore drill |
| Funnels/journeys | Session-scoped exact-step funnels, explicit caps, scoped attribution-only journeys and local fixtures | Browser editing/use tests and capacity at retained-detail ceiling |
| Hosted deployment | Deployment-ready root configuration and dry-run build | Target-account credential, remote deploy and smoke evidence |
| Guided self-hosting | Portable D1 binding, migration-by-binding script, fail-closed example secrets and documented owner setup | Public repository/button now prepared; clean-account install/rename/retry/update evidence remains pending |

The app's local code is reviewable. It must not admit external customer data until the customer-alpha checklist in the implementation plan passes. An invite-only staging/demo deployment can be used for platform verification with synthetic data. There is no automatic customer signup, subscription billing, commercial uptime claim, or unsupported free-capacity promise.

The selected Cloudflare test package was replaced with the maintained plugin. Compatible patched overrides for Undici and Zod currently allow `npm audit` to pass with zero reported vulnerabilities. Re-run the audit against the committed lockfile in CI. Development-tool advisories are not evidence of a deployed exploit.

Provider reviews of this actual implementation and their disposition are recorded under `docs/research` as they complete. Earlier Minilytics research is historical input, not proof of this implementation's runtime properties.
