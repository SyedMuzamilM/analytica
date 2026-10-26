# Research inputs and decisions

Research completed on 26 October 2026. The source benchmark is Minilytics commit `d665db48ad253b8f037af8459c960650cdc02fc3`. All three requested research providers ran. Their reports contain both evidence and proposals. The [implementation plan](../implementation-plan.md) defines the selected approach; conflicting recommendations in the reports do not override it.

| Provider | Actual model | Assignment | Report |
| --- | --- | --- | --- |
| Antigravity | `gemini-3.8-flash-high` | Product scope, UI differentiation and onboarding | [Product report](antigravity-review.md) |
| OpenCode | `opencode/glm-5.3-flash-free` | Ingestion, sessions, tenant data and Cloudflare limits | [GLM report](glm-review.md) |
| OpenCode | `opencode/deepseek-v4.1-flash-free` | Deployment, resource choices, cost assumptions and release checks | [DeepSeek report](deepseek-review.md) |
| Codex subscriptions | `gpt-6.1-sol` | Final source and plan review | [Sol review](sol-review.md) and [corrections](review-disposition.md) |

GLM and DeepSeek ran the models advertised as free in the provider catalog. This records the selected model, not a guarantee about future provider pricing. Antigravity used its configured model; no free-pricing claim is made for that run.

## Reconciliation

| Topic | Selected approach | Why |
| --- | --- | --- |
| Minimum platform | Worker, Static Assets, D1 and scheduled maintenance | Shared conclusion on the existing small architecture; DeepSeek argued against adding storage systems before measurements. |
| Hosted identity | Workspace memberships and revocable user sessions | All reports confirmed that upstream has one owner password. A site-owner column alone does not implement workspace roles or organization membership. |
| Collection | Treat browser events as untrusted; validate, throttle and atomically deduplicate | All reports found a public collector. Origin/domain checks and collector tokens can deter misuse but cannot establish trusted analytics. |
| UI | Dedicated reporting views, persistent filters and installation diagnostics | Adopt Antigravity's task-oriented navigation. Defer its maps, multi-touch models, AI summaries and multiple payment integrations. |
| Privacy | Aggregate mode with no persistent ID/fingerprint, optional consent-controlled attribution | Reject GLM's suggested IP/UA-derived ID and the implication that a mode label establishes GDPR compliance. |
| Residency | No EU-only promise | A Worker location, a D1 location hint and country-only reporting do not establish end-to-end regional processing guarantees. Any future residency claim needs a separate primary-source and runtime review. |
| Queue | Later if load tests justify it | Antigravity/GLM proposed it early; DeepSeek favored deferral. A queue adds delivery/retry complexity and cannot remove D1's serial throughput or write costs. Verify the selected tier's operations allowance if introduced. |
| KV | Optional non-sensitive config only | Eventual consistency is unsuitable for strict owner bootstrap, session revocation, membership, or exact security counters. |
| Quota response | Explicit rejection/backpressure with customer-visible state | Reject GLM's proposed successful acknowledgement for events deliberately not persisted. |
| Storage and throughput | 500 MB per free DB, 10 GB per paid DB, measured admission limits | GLM's "tens of GB" shared-database suggestion conflicts with its own quoted per-DB cap. Per-tenant databases are an additional architecture change, not an automatic escape. |
| Cost | Scenario arithmetic with measured writes, scanned reads and storage | Research estimates use different heartbeat/session ratios. Do not publish any estimate as a tested cost. DeepSeek's growth subtotal also needs the paid base fee included. |
| One-click install | Official guided deployment with tested secrets, binding-based migrations and owner bootstrap | Adopt DeepSeek's test matrix. Secret prefill and token-permission failures remain unverified hypotheses until exercised. |
| Licensing | Keep MIT notice for copied/adapted code; original product brand and UI | Avoid unsupported trademark ownership conclusions. New visual work does not require calling this a clean-room implementation. |
| Installation prompts | Public IDs and placeholders only | Reject Antigravity's proposed inclusion of webhook secrets in generated assistant prompts. Server signing material stays out of them. |
| Time handling | Implement and test IANA/DST boundaries independently | GLM and DeepSeek overstate upstream bucketing correctness. One range-end offset cannot describe every bucket across DST. |
| Mail | Evaluate Cloudflare Email Service eligibility and actual sending behavior | Email Routing alone is insufficient. The separate sending service is a candidate, not an established dependency or account entitlement. |

## Evidence limitations

The independent providers inspected source and documentation. Their reports did not exercise a live Cloudflare deploy, verify a real payment integration, or benchmark the proposed design. Labels such as "verified" describe the stated source inspection; they do not prove the recommended implementation is correct. Some line references are approximate and should be checked against the pinned source when implementing.

The primary assessment separately records successful upstream tests, typecheck and build, plus the scope of its dependency audit. The final review is complete and its findings have been incorporated. Phase 0 executable checks are still required before implementing dependent features or representing the installation as deployment-ready. The original reports remain historical research inputs; the reconciliation and corrected plan govern implementation.
