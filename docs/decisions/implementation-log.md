# Implementation decisions

## 26 October 2026

The build begins with one repository-root Worker deployment, Static Assets and D1. The dashboard, browser tracker, and server modules are independent source directories with shared TypeScript contracts.

Authentication uses a passkey spike with SimpleWebAuthn rather than password hashing. This avoids assuming a secure password algorithm fits Free CPU. Setup requires a privately supplied installation token; sessions and recovery remain server-side and revocable. Native Worker execution and remote CPU still need measurement.

Three implementation agents are working in separate file sets: passkey/authentication, analytics ingestion/reporting, and dashboard. The primary agent integrates them and implements tracking, revenue and deployment. The independent free provider reviews will assess concrete code after integration. Security and platform reviews remain required before customer intake.

Local Cloudflare OAuth is available, but it belongs to an account different from the requested deployment target. No cloud resources will be changed using that account. Target account credentials will be requested through the private secret card when the deployable build is ready.

The first selected Cloudflare test-pool package is deprecated. The build is moving to its maintained replacement, `@cloudflare/vitest-plugin`, with compatible Vitest 5. The lockfile records actual dependency versions; dependency audit findings will be resolved or scoped before deployment.

The integrated implementation passes 54 Worker/D1 tests, four Chromium flows, TypeScript checking, the production build and Wrangler deployment dry-run. npm audit reports zero vulnerabilities after compatible Undici/Zod patch overrides. Screenshots were inspected on desktop and mobile. Peer reviews resulted in fixes for webhook receipt races, claim idempotency, refund acquisition snapshots, late-refund retention, deletion starvation, prequeued opt-out, SPA redaction, event cohort filters, concurrent session attribution and immediate erasure visibility.

Two native implementation agents reached their provider usage limit after writing their files. The primary agent finished integration and verified all current suites. Independent GLM Free, DeepSeek Free and Antigravity reviews of the actual implementation follow before target-account deployment.
