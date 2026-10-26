# Analytica — deploy and data-platform research

**Reviewer:** OpenCode provider, model `opencode/deepseek-v4.1-flash-free`. Model catalog at review time showed $0 input / $0 output, so this work is within the “free or stop” constraint.

**Date:** 2026-10-26

**Upstream under review:** `surendrapandar/minilytics` at `d665db48ad253b8f037af8459c960650cdc02fc3`. Verified locally with `git rev-parse HEAD`; working tree clean.

**Local source:** `/tmp/analytica-research/minilytics-d665db4`

**Scope:** research only. No build, deploy, credentials, upstream changes, or sub-agents. This is the only file written.

**Evidence tags used below**

| Tag | Meaning |
| --- | --- |
| **[V]** | Verified in the pinned source or in official Cloudflare documentation fetched on 2026-10-26. |
| **[P]** | Proposal or recommendation from this review. Not implemented or tested. |
| **[U]** | Unverified or community-reported. Must be tested in a scratch account before being relied on. |

---

## 1. Bottom line

1. **Self-host path:** a Deploy to Cloudflare button on a public repo, one Worker (static assets + API) and one D1 database. Cloudflare provisions the D1 database and rewrites the database ID, then runs the repo’s deploy command. Put migrations in that deploy command and reference the **binding** `DB`, not the database name. Keep a CLI fallback for people without GitHub/GitLab. **[V]** mechanics, **[P]** product packaging.
2. **Hosted path:** Workers Builds connected to our repo on the Workers Paid plan ($5/month minimum), one Worker, one D1 database, tenant scoping from day one. No Analytics Engine, no Queues, no per-tenant databases at launch. **[P]**
3. **D1 is not optional for the product as scoped.** The revenue attribution model mutates rows (refunds, re-matching, identify, session stitching) and must answer “all time” ranges. Analytics Engine is append-only with three-month retention; Queues is a transport, not a store. D1 remains the system of record. Analytics Engine is a possible later read/rollup layer; Queues is a later ingestion buffer, and on the free plan it would *reduce* capacity below D1’s. **[V]** limits, **[P]** sequencing.
4. **Cost shape:** self-host is $0 inside free limits. Hosted is roughly $5/month at ~1M pageviews/month and on the order of $90–110/month at ~20M pageviews/month, dominated by D1 rows written (about 6–7 per pageview once pings and indexes are counted). **[P]** estimates with stated assumptions.
5. **“One-click” is not true today.** Three concrete blockers: the secret example file ships local-development defaults that the button treats as production secret values **[U, community-reported]**; migrations are invoked by database name, which breaks if the deployer renames the database **[V]**; and the schema/auth are single-tenant, so the same build cannot serve a hosted multi-customer product **[V]**.
6. **Original UI/copy is a rewrite, not a reskin.** MIT permits code reuse with the copyright notice, but it does not license the “Minilytics” name/logo or third-party positioning. The tracker’s public API and cookies are branded (`window.minilytics`, `ml_vid`, `data-ml-goal`, `ml_auth`), so renaming is an interface change to do before any installs exist. **[V]** license and identifiers, **[P]** execution.

---

## 2. What the upstream actually is

This is a compact, revenue-first web analytics app: a public tracking script, a Hono Worker API, D1 storage, and a React dashboard served as static assets from the same Worker. About 4.8k lines of TypeScript/TSX/JS/SQL (excluding generated files and dependencies).

| Area | What exists | Evidence |
| --- | --- | --- |
| Ingest | `POST /api/event`, CORS `*`, 8 KB body cap, event types `pageview/goal/outbound/ping/identify`, bot filtering, same-domain check | `src/worker/index.ts:18-22`, `src/worker/collect.ts:48-76` |
| Data model | `sites`, `visitors`, `sessions`, `events`, `payments`, `funnels`; plus `login_failures` and `payment_claims` | `migrations/0001_init.sql:2-98`, `migrations/0002_login_failures.sql:2-5`, `migrations/0003_payment_matching.sql:4-14` |
| Tracker | ~9 KB script; first-party cookies, 30-min sliding session, SPA history hooks, engaged-time pings, goals, outbound clicks, `identify`, ignore flag, Dodo checkout tagging | `public/js/script.js:12-215` |
| Auth | One admin password, HMAC-signed cookie, 30-day expiry, D1-backed per-IP lockout after 10 failures in 15 minutes | `src/worker/index.ts:11-14, 26-64` |
| Dashboard | React/Vite/Tailwind/Recharts SPA: Sites, Dashboard, Settings, Login; filters live in session columns | `src/dashboard/App.tsx`, `src/dashboard/pages/*.tsx`, `vite.config.ts:1-13` |
| Stats | SQL aggregates on D1, timezone-aware buckets, comparison period, breakdowns, visitor profiles, funnels, customers/journey | `src/worker/stats.ts:106-200, 234-445`, `src/worker/lib/time.ts:47-147` |
| Payments | Dodo webhook with Standard Webhooks HMAC verification, generic bearer-key payments API, server-side goals API, five-step attribution ladder | `src/worker/payments.ts:31-95, 232-367`, `src/worker/lib/crypto.ts:37-58` |
| Deploy | Wrangler config with D1 binding, static assets, `run_worker_first: ["/api/*"]`; deploy script builds, migrates, deploys | `wrangler.jsonc:1-23`, `package.json:12-24` |

### 2.1 Ingestion write path (important for cost)

A first pageview of a new session performs roughly:

| Unit | Rows written (approx.) | Why |
| --- | --- | --- |
| `visitors` insert | 1 | `collect.ts:261-263` |
| `sessions` insert | 1 + 2 index rows | table plus `sessions_site_time`, `sessions_visitor` (`migrations/0001_init.sql:55-56`) |
| `sessions` pageview update | 1 | `collect.ts:297-299` or `150-154` |
| `events` insert | 1 + 2 index rows | table plus `events_site_time`, `events_session` (`migrations/0001_init.sql:70-71`) |
| **First pageview total** | **~8** | |
| Later pageview | ~4 | session update + event + two indexes |
| Ping | 1 | `UPDATE sessions SET duration…` (`collect.ts:116-123`) |
| Goal / outbound | ~4 | session update + event + indexes |
| Identify | 1–2 | insert-ignore + update (`collect.ts:125-136`) |

D1 explicitly counts index writes as extra rows written (`d1/platform/pricing`, definition 6). That is why the free 100,000 writes/day is closer to **~13–15k pageviews/day** than the “about 10k” in the README once a few pings per session are included. The README’s own table is at `README.md:107-116`.

The code batches the multi-statement writes (`collect.ts:143-174`), and D1 batches are SQL transactions that roll back on failure (`d1/worker-api/d1-database`). One inefficiency: every non-ping event first runs `SELECT 1 FROM sessions …` (`collect.ts:138-141`) as a separate round trip, then batches. That is two D1 calls per event. It is correct, but it doubles latency and consumes two subrequests. **[P]** Replace with `INSERT … ON CONFLICT DO NOTHING` plus the update in one batch, or accept it for MVP.

### 2.2 What is reusable vs. what must be replaced

**Reusable as code (MIT):** schema shape, ingestion normalization, bot/UA parsing, time bucketing, attribution ladder, webhook verification, dashboard data contracts, smoke test.

**Must be original for Analytica:** product name, logo, visual system, all marketing/README/UI copy, tracker global and cookie names, CSS theme, screenshots, sponsor block, Dodo-specific setup copy. MIT’s notice requirement applies to copied code (`LICENSE:1-13`); it does not grant trademark rights.

**Concrete rename inventory (do before first install):**

| Surface | Current | Evidence |
| --- | --- | --- |
| Tracker global | `window.minilytics` | `public/js/script.js:14, 27-28, 211` |
| Cookies | `ml_vid`, `ml_sid`, `ml_auth` | `public/js/script.js:12`, `src/worker/index.ts:11` |
| Markup hooks | `data-ml-goal`, `data-ml-goal-*` | `public/js/script.js:181-188` |
| Ignore flag | `?ml_ignore=true` | `public/js/script.js:17-24` |
| API key prefix | `ml_…` | `src/worker/index.ts:142, 182` |
| Dodo metadata keys | `ml_visitor_id`, `ml_session_id` | `public/js/script.js:150-151`, `src/worker/payments.ts:270-271` |
| Brand/logo | “Minilytics”, orange/stone mark | `src/dashboard/components/Logo.tsx:4-8`, `README.md:1-33` |

---

## 3. Cloudflare deploy mechanics (verified)

### 3.1 Deploy to Cloudflare button

Official behavior, from `https://developers.cloudflare.com/workers/platform/deploy-buttons/`:

- Clones the public repo into the deployer’s GitHub/GitLab account. **[V]**
- Shows a setup page for repo name, Worker name, and resource names. **[V]**
- Builds with Workers Builds and deploys. **[V]**
- **Automatically provisions supported resources, including D1**, then updates the Wrangler config with new IDs. Repos must include default values for resource names/IDs. **[V]**
- If `package.json` has `build`/`deploy` scripts, Cloudflare pre-populates them; otherwise deploy defaults to `npx wrangler deploy` and build is blank. **[V]**
- For migrations, the docs explicitly recommend running them in the deploy script and **referencing the binding name**, so a renamed database still works. Example: `wrangler d1 migrations apply DB_BINDING --remote`. **[V]**
- Secrets are declared in `.dev.vars.example` or `.env.example`; `package.json` → `cloudflare.bindings.<NAME>.description` supplies setup help. Values are “presented to users in the dashboard as they deploy” (`changelog/post/2025-07-01-workers-deploy-button-supports-environment-variables-and-secrets`). **[V]**
- Limits: public GitHub/GitLab only, Workers only (not Pages), monorepos not fully supported (each Worker needs its own button). **[V]**

**Critical caveat [U]:** community reports say every **uncommented** line in `.dev.vars.example` is prompted as a required secret **with the example value pre-filled** (`cloudflare/workers-sdk` discussion #14639; `cloudflare/cloudflare-docs` issue #31988). If true, upstream’s example file (`ADMIN_PASSWORD` and `SESSION_SECRET` placeholders, `.dev.vars.example:1-2`) would ship a known admin password and a known cookie-signing key to a public deployment unless the deployer edits them. Treat `.dev.vars.example` as an **installer prompt**, not a local-dev scratchpad. Must be tested in Phase 0.

**Configuration mismatch in upstream:** `package.json:21` runs `wrangler d1 migrations apply minilytics --remote` (database name). The deploy-button guidance says use the binding (`DB`). If a deployer renames the database during setup, migrations fail or target the wrong database. This is a one-line fix and a hard requirement for the button flow.

Note the two official docs give opposite default advice: the D1 migrations page says prefer the database name because bindings can change; the deploy-button page says prefer the binding because database names can change. Reconcile by context:

- **Template deploy scripts:** binding `DB` (portable across renames).
- **Operator runbooks / manual commands:** database name (safer against a changed binding).

### 3.2 Workers Builds (hosted and button flows)

From `https://developers.cloudflare.com/workers/ci-cd/builds/configuration/`:

- Two-step process: optional build command, then deploy command (default `npx wrangler deploy`); preview command for non-production branches. **[V]**
- Build variables/secrets are **build-time only**, not runtime. Runtime vars/secrets are separate under Settings → Variables & Secrets. **[V]**
- API token is auto-generated or user-supplied. The documented auto-token permissions are Account Settings (read), Workers Scripts (edit), KV (edit), R2 (edit), zone Workers Routes (edit), User Details (read), Memberships (read). **D1 is not in that list.** **[V]**
- Free plan: 3,000 build minutes/month, 1 concurrent build, 20-minute timeout, 20 GB disk, 64 env vars. Paid: 6,000 minutes then $0.005/minute, 6 concurrent. **[V]**

**Risk [U]:** with the auto-generated token, `wrangler d1 migrations apply … --remote` may fail authorization because D1:Edit is absent. A community thread confirms D1 migrations require an API token with D1 edit permission (`cloudflare/wrangler-action` issue #221). The deploy-button docs nevertheless recommend migrations in the deploy script, which implies the button path gets D1 permissions. Test both. If it fails, the fix is explicit: create/select a Workers Builds API token that includes **D1:Edit** for the account, and document it.

### 3.3 D1 migrations

From `https://developers.cloudflare.com/d1/reference/migrations/` and `https://developers.cloudflare.com/workers/wrangler/commands/d1/`:

- SQL files in `migrations/`, applied in filename order, tracked in `d1_migrations`. **[V]**
- `migrations_dir` and `migrations_table` are configurable per D1 binding (`wrangler.jsonc:20` sets `migrations_dir`). **[V]**
- Binding name or database name both work; binding can change, database name cannot. **[V]**
- In CI/non-interactive use, confirmation is skipped, a backup is captured, and a failed migration rolls back while the previous successful one remains applied. **[V]**
- D1 limits that matter for migrations: 100 KB per SQL statement, 30-second query duration, 2 MB row/string/BLOB. Split large backfills. **[V]**

Upstream’s three migrations are additive (`CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE … ADD COLUMN`), so applying them before deploying new code is safe. Keep that expand/contract discipline: a deploy that both adds a column and drops an old one is not rollback-safe.

### 3.4 Secrets and bootstrap

From `https://developers.cloudflare.com/workers/configuration/secrets/` and the deploy-button docs:

- Runtime secrets are set with `wrangler secret put NAME` or the dashboard; values are write-only afterward. **[V]**
- Local development uses `.dev.vars` (gitignored upstream, `.gitignore:4`). **[V]**
- Deploy button reads `.dev.vars.example` and turns entries into Worker secrets, with optional descriptions in `package.json`. **[V]** mechanism, **[U]** prefill behavior.
- No secret generation is built into the button. **[V]** by omission; the changelog only describes presenting values.

**Recommendation [P]:**

1. `.dev.vars.example` contains only `ADMIN_PASSWORD` and `SESSION_SECRET`, both with **empty or clearly invalid** values, never working defaults.
2. `package.json` `cloudflare.bindings` describes both, including `openssl rand -hex 32`.
3. The Worker refuses to start serving authenticated routes if either secret is empty or matches a known placeholder, returning a 503 with setup instructions. Upstream already fails login if secrets are missing (`index.ts:33-35`), but not if they are weak/placeholder.
4. Never put real values in `.dev.vars.example`, README, tests, or this document. The smoke test currently defaults to the placeholder password (`scripts/smoke.mjs:5`); change it to require an explicit env var so a placeholder cannot silently pass CI.
5. For hosted, keep runtime secrets out of build secrets; rotate on a schedule and after any operator departure.

### 3.5 Static assets and request accounting

- Requests to static assets are free and unlimited; only Worker invocations are billed/limited (`workers/static-assets/billing-and-limitations`). **[V]**
- `run_worker_first` patterns always invoke the Worker; if the free daily request limit is exceeded, matching requests return 429 instead of falling back to assets. **[V]**
- Upstream routes only `/api/*` to the Worker and serves the dashboard and `/js/script.js` as assets (`wrangler.jsonc:7-13`). That is the right shape: tracker downloads and dashboard HTML/CSS/JS do not consume the 100k/day Worker allowance. **[V]**

---

## 4. Limits and cost assumptions

Prices/limits fetched 2026-10-26. Free limits reset daily at 00:00 UTC; paid included usage is monthly. **[V]**

| Product | Free | Paid |
| --- | --- | --- |
| Workers requests | 100,000/day; 10 ms CPU/invocation; 50 subrequests; 64 vars | $5/mo minimum; 10M requests included, +$0.30/M; 30M CPU-ms included, +$0.02/M ms; 10k subrequests; 5 min CPU |
| D1 reads | 5M rows/day | 25B rows/month included, +$0.001/M |
| D1 writes | 100,000 rows/day | 50M rows/month included, +$1.00/M |
| D1 storage | 5 GB/account, 500 MB/database, 10 databases, 7-day Time Travel | 5 GB included, +$0.75/GB-mo; 10 GB/database; 50k databases; 30-day Time Travel |
| Workers Builds | 3,000 min/month, 1 concurrent | 6,000 min included, +$0.005/min, 6 concurrent |
| Analytics Engine | 100k data points/day; 10k read queries/day; 3-month retention | 10M points/mo +$0.25/M; 1M queries/mo +$1/M; **currently not billed** |
| Queues | 10k operations/day; 24 h retention | 1M ops/mo +$0.40/M; 4–14 day retention |
| R2 (optional backups) | 10 GB-month; 1M Class A; 10M Class B; free egress | $0.015/GB-mo etc. |

Platform limits that change design decisions:

- Free CPU is **10 ms per invocation**. D1/network wait does not count as CPU, but JSON serialization and the funnel’s in-Worker event processing do. The funnel query loads up to 100,000 event rows into the Worker (`src/worker/stats.ts:421-430`) and then iterates them in JS (`432-443`). That is a credible Error 1102 on the free plan with a busy site. **[V]** limit, **[P]** mitigation.
- Free subrequests are **50 per invocation**; a D1 `batch()` counts as one query against the D1 limit, not one per statement (`d1/platform/limits`, batch note). Current stats code uses one batch of 7 queries (`stats.ts:158-178`), so it is within limits. **[V]**
- Each D1 database is single-threaded and processes queries one at a time; throughput is roughly `1 / query duration`, minus per-request overhead (`d1/platform/limits`, FAQ). A single DB is fine for MVP but is the scale boundary. **[V]**
- D1 read replication is free of extra storage/compute charge and requires the Sessions API; writes still go to the primary (`d1/best-practices/read-replication`). **[V]**
- D1 `batch()` is a SQL transaction: sequential, non-concurrent, aborts/rolls back the sequence on failure (`d1/worker-api/d1-database`). **[V]**

### 4.1 Cost model (estimates, not quotes)

Assumptions **[P]**:

- One pageview = 1 event row + session update; first pageview of a session also inserts visitor/session.
- 2.5 pageviews per session; 3 engaged minutes per session; one ping per visible minute (upstream sends at most one per 60 s, `script.js:109-111`).
- Index writes counted; ~6–7 rows written per pageview blended.
- ~2.2 Worker requests per pageview (pageview + pings + a small dashboard share).
- Dashboard reads measured later; estimates below assume 5 aggregate queries per load and 1–2× sessions scanned per aggregate.

| Scenario | Volume | Monthly writes | Monthly requests | Est. bill |
| --- | --- | --- | --- | --- |
| Self-host hobby | 5k pageviews/mo | ~35k | ~12k | **$0** |
| Self-host busy | 300k pageviews/mo (~10k/day) | ~2M (~66k/day) | ~700k (~23k/day) | **$0** (within free; storage ~100 MB) |
| Self-host over limit | 600k pageviews/mo (~20k/day) | ~4M (~130k/day) | ~1.3M (~43k/day) | **$5** (writes exceed 100k/day) |
| Hosted launch | 1M pageviews/mo | ~6.8M | ~2.2M | **~$5** |
| Hosted growth | 10M pageviews/mo | ~68M | ~22M | **~$22–27** (D1 writes ~$18, requests ~$3.6, CPU/storage ~$1–2) |
| Hosted scale | 20M pageviews/mo | ~136M | ~44M | **~$95–110** (D1 writes ~$86, requests ~$10, CPU/storage ~$2–3) |

Read caveat: the self-host rows assume the operator opens the dashboard on the order of tens–low hundreds of times per day. At 10k sessions in a 30-day range, one dashboard load is roughly 50k–100k rows read; the free 5M reads/day can bind before the write cap if the dashboard is refreshed heavily. Paid removes the daily read cap. Measure with `meta.rows_read` in Phase 0.

Consequences:

- **D1 writes dominate variable cost**, not storage or requests. Pings are ~1 row written per engaged minute and do not appear in the README’s model.
- The cheapest optimization is reducing write amplification: batch pings (e.g., 2–3 minutes instead of 60 s), avoid updating session rows on every goal, and revisit the `events` indexes if funnel queries can use one composite index. Each change trades accuracy or query speed; measure before changing.
- At 20M pageviews/month, 200 customers at $9/month gives ~$1,800 revenue against ~$100 infrastructure. The model works; the risk is a single tenant or bot flood consuming the shared quota.

### 4.2 Corrections to upstream’s free-plan claims

| Upstream claim | Reality |
| --- | --- |
| “100,000 Worker requests/day ≈ 100k tracked events/day” (`README.md:111`) | Pings and dashboard API calls also count. ~2.2 requests per pageview means ~45k pageviews/day request-bound; D1 writes bind sooner. Static files are correctly excluded. |
| “100,000 D1 rows written/day ≈ 10k pageviews/day” (`README.md:112`) | Conservative but plausible; with ~6–7 writes/pageview and pings it is closer to 13–15k pageviews/day, and less if goals/outbound are heavy. |
| “5 GB D1 storage” (`README.md:114`) | Free plan is **5 GB per account** but **500 MB per database**; a single-DB self-host hits 500 MB first. |
| “A dashboard load reads roughly 10× the sessions … hundreds of loads a day” (`README.md:113`) | Depends heavily on range and indexes; “all time” scans everything. Measure with `meta.rows_read`; do not size a plan from this sentence. |

---

## 5. D1 vs Analytics Engine vs Queues

Requirement set for Analytica **[P]**:

- **R1** Mutable attribution graph: visitor → session → payment, refunds, re-matching, identify.
- **R2** Arbitrary ranges including 12 months and all time.
- **R3** Per-visitor ordered timelines and funnels.
- **R4** Low-ops self-host on a free account.
- **R5** Burst tolerance and predictable scale.
- **R6** Cheap dashboard reads.
- **R7** Export/ownership and retention control.

| Criterion | D1 | Analytics Engine | Queues |
| --- | --- | --- | --- |
| System of record | Yes: SQL, joins, transactions, updates/deletes | No: append-only write API + SQL read API; no documented update/delete | No: transient buffer |
| Mutable payments/refunds | Yes | No | N/A |
| Retention | Until deleted; 10 GB/DB paid, 500 MB/DB free | **3 months** | 24 h free / 4–14 days paid |
| Query model | SQL from Worker, indexes, joins | SQL API over HTTP, one read query per POST | None |
| Free capacity | 100k writes/day, 5M reads/day, 500 MB/DB | 100k points/day, 10k queries/day | 10k ops/day (~3.3k messages at 3 ops/message) |
| Write cost at scale | $1/M rows after 50M | $0.25/M points after 10M (not billed today) | $0.40/M ops after 1M |
| Operational fit | Deploy button provisions it; migrations built in | Needs account/dataset setup and a read token | Needs producer + consumer Worker, retries, DLQ |
| Fits R1–R4 | Yes | Fails R1, R2 | Fails R1, R3; weak R4 on free |

**Verdict [P]:**

- **D1: keep as the only required store.** It is the only option that satisfies attribution mutation, long ranges, visitor timelines, and one-click provisioning.
- **Analytics Engine: do not add at MVP.** Adopt only when measured D1 pressure justifies it, and then as a **parallel rollup** for high-volume pageview/source metrics, not as the source of truth. It cannot serve refunds, re-matching, journey timelines, or >3-month ranges. Its “currently not billed” status is not a business-model assumption.
- **Queues: do not add at MVP.** On free, 10k ops/day is *less* than the 100k D1 writes/day it would protect, so it lowers self-host capacity. It also introduces retries without an idempotency key in the events schema (`events.id` is only an autoincrement, `migrations/0001_init.sql:59-71`), so duplicate pageviews become possible. Add it only when bursts or webhook latency demand decoupling, and add a client-generated event UUID + unique index first.
- **Durable Objects: skip.** They would help per-site counters/WebSockets/rate limits, but current “online now” is a cheap D1 query (`stats.ts:163-166`) and dashboards are request/response.

**Scale triggers to revisit [P]:**

- D1 writes approach 50M/month (~8M pageviews/month at current amplification) → optimize writes, then shard D1 by tenant group/region, then consider AE for pageview metrics.
- Sustained ingest causes D1 “overloaded” errors or per-DB queueing → add Queues (with idempotency) or shard.
- Dashboard reads approach 25B rows/month or p95 > 1.5 s → add AE rollups or pre-aggregated daily tables in D1.

A pragmatic hybrid if needed later: D1 keeps `sites`, `visitors`, `sessions`, `payments`, `funnels`; AE receives one point per pageview/goal for source/page/country aggregates; the dashboard reads AE for large ranges and D1 for journeys/payments. This is a larger rewrite of `stats.ts`, so do not start there.

---

## 6. Recommended deploy paths

### 6.1 Self-host: Deploy to Cloudflare button (primary)

**Target experience:** a public repo, a button, a Cloudflare login, two secret fields, deploy. No local Node, no manual database-ID editing. About 5 minutes, not “one click” in the literal sense.

**Required repo changes before the button is credible [P]:**

1. `.dev.vars.example`: only required secrets, no usable defaults. Add `package.json` → `cloudflare.bindings` descriptions.
2. `package.json` deploy script: `wrangler d1 migrations apply DB --remote && wrangler deploy` (binding `DB`). Keep `vite build` in the build command, not duplicated in deploy. Avoid building twice.
3. Add `GET /api/health` returning non-sensitive `{ ok, schemaVersion, secretsConfigured }`. Use it in acceptance checks and uptime monitoring.
4. Refuse login (503 with instructions) when `ADMIN_PASSWORD`/`SESSION_SECRET` are empty or placeholders. Remove the placeholder fallback from `scripts/smoke.mjs`.
5. Make `wrangler.jsonc` defaults explicit and minimal: one D1 binding named `DB`, `migrations_dir: "migrations"`, placeholder `database_id` only.
6. README split into two paths: **Button** (no manual ID edit) and **CLI** (manual ID edit). Do not mix them.
7. Add a `NOTICE`/license section if any upstream code is copied; replace all upstream branding/copy per §2.2.
8. Test the “deployer renames the database” path. That is the failure mode the binding-name migration fixes.

**Flow [V + P]:**

1. User opens the button, authorizes GitHub/GitLab, gets a copy of the repo.
2. Setup page shows Worker name, D1 name, and the two secrets.
3. Cloudflare creates the D1 database, rewrites `database_id`, runs build, then deploy (migrations + `wrangler deploy`).
4. User opens `https://<worker>.<subdomain>.workers.dev`, logs in, adds a site, copies the snippet.

**Caveats to state in the README:**

- Requires a GitHub or GitLab account (the repo is cloned into it). **[V]**
- Worker name in the dashboard must match `name` in Wrangler config or the build fails (`workers/ci-cd/builds`). **[V]**
- The user’s copy diverges from upstream; updates require a merge. The database ID lives in tracked config after provisioning. Document a simple update path and avoid promising automatic upgrades.
- Free plan includes D1 but with 500 MB/DB and daily caps; link to the limits table, not a vague “free forever” claim.

**CLI fallback (for no-GitHub users) [P]:**

```bash
git clone <analytica-repo> && cd analytica
npm ci
npx wrangler login
npx wrangler d1 create analytica
# paste the printed database_id into wrangler.jsonc (binding DB)
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET   # openssl rand -hex 32
npm run deploy
```

This is the path upstream documents today (`README.md:57-105`), with the secret-safety and binding-name fixes above.

**Why not Pages:** Deploy buttons support Workers only, and the app already uses Workers static assets. Pages adds a second deployment model for no benefit. **[V]** button limitation, **[P]** conclusion.

### 6.2 Hosted SaaS: Workers Builds + one Worker + one D1

**Target architecture [P]:**

- One Cloudflare account we control, Workers **Paid** from day one ($5/month). Free is for self-host; hosted needs headroom above 10 ms CPU and daily caps.
- One Worker: static dashboard + API + ingest. Split later only if a measured bottleneck demands it.
- One D1 database for MVP, with `account_id`/`tenant_id` on every tenant-owned row and every query scoped. D1’s 10 GB/DB paid limit and single-writer model are the first scale boundary; shard later by tenant group or region, not at launch.
- Workers Builds connected to our GitHub repo: production branch `main`; build `npm ci && npm run build`; deploy `npm run deploy:prod` (migrations using binding `DB` + `wrangler deploy`); PR previews use `wrangler versions upload` with a preview D1, no production migrations.
- Custom API token for Workers Builds with **D1:Edit** (plus Workers Scripts edit and whatever else is needed), because the documented auto-token list omits D1. **[V]** list, **[P]** action.
- Runtime secrets in Settings → Variables & Secrets or `wrangler secret put`; never as build secrets. **[V]** build secrets are build-only.
- Custom domain on our own Cloudflare zone; `workers.dev` for staging. No Cloudflare for SaaS unless we sell per-customer hostnames (separate product/cost; verify before promising). **[P]**
- Observability: Workers Logs (200k events/day free, 3-day retention; 20M/month paid, 7-day) plus alerts on 5xx, D1 errors, and daily usage. Upstream already enables observability (`wrangler.jsonc:6`). **[V]** Note that Cloudflare states Workers Logs moves to Cloudflare Observability pricing on **2026-12-01**, so re-check this line item before finalizing the hosted cost model. **[V]**
- Backups: D1 Time Travel is 30 days on paid; run a scheduled `wrangler d1 export` from an operator environment to R2 (10 GB free) for longer retention. Time Travel is the fast recovery; export is the portable copy. **[V]** Time Travel/export, **[P]** cadence.

**Why this is the simplest reliable path:** one deploy unit, one database, one CI connection, no queue/consumer, no second runtime, no Terraform state. It matches the app’s current shape and keeps failure modes observable.

**Do not do at launch [P]:**

- Analytics Engine dual-write (two sources of truth, migration pain).
- Queues (free capacity regression, idempotency missing).
- D1 per tenant (static bindings; thousands of migration targets).
- Workers for Platforms (only for reselling customer Workers).
- Multi-region active-active (D1 writes are primary-only; read replication is the supported lever). **[V]**

### 6.3 Hosted auth and tenancy: the real blocker

Upstream is single-tenant by construction:

- `sites` has no owner/account column (`migrations/0001_init.sql:2-11`).
- One admin password signs one cookie (`index.ts:26-64`); there are no users, teams, invites, or roles.
- `sites.api_key` and `dodo_webhook_secret` are stored in plaintext (`migrations/0001_init.sql:8-9`), and `GET /api/sites` returns the API key to any logged-in admin (`index.ts:109, 122-128`).

For hosted SaaS, add before any customer data:

1. `accounts`, `users`, `memberships` (role), `auth_sessions`; `sites.account_id`.
2. Scoping in every query and a test that user A cannot read site B by ID or by list.
3. Hash API keys (store a prefix + hash); encrypt per-site webhook secrets at rest or move to Secrets Store.
4. Auth mechanism decision. Cloudflare Access with one-time PIN can gate an operator beta, but it is an operator-facing access product, not customer signup (`cloudflare-one/integrations/identity-providers/one-time-pin`). Customer auth likely means OAuth (GitHub/Google) or password + verification; email delivery is the open dependency. “Entirely Cloudflare” applies to hosting, not necessarily identity/email. Decide explicitly. **[P + U]**
5. Quotas and abuse controls per tenant (events/day, sites, retention) before opening signup.

This is product work, not deploy plumbing, but it changes the schema and therefore the migration plan. Do it before the first hosted migration, not after.

---

## 7. Phased acceptance checks

Each check is binary and runnable. Use a scratch Cloudflare account and a scratch repo. Never use production secrets in a test.

### Phase 0 — deploy spike (half a day)

| ID | Check | Method | Pass |
| --- | --- | --- | --- |
| P0-1 | Button provisions D1 | Fresh account, click button on a test repo with one D1 binding | DB exists in D1 dashboard; cloned repo’s `database_id` is a real UUID, no manual edit |
| P0-2 | Migrations survive a rename | Rename DB in setup (e.g. `analytica-spike-<rand>`), deploy | `wrangler d1 migrations list DB --remote` → no pending; `SELECT COUNT(*) FROM d1_migrations` = 3 |
| P0-3 | Secrets prompt and store | Put sentinel test values in the setup form; inspect Workers Settings → Variables & Secrets | Both names exist as secrets; values are not readable afterward; app logs in with the chosen password |
| P0-4 | No default credentials | Deploy with blank placeholder secrets | App returns 503 on login/health, not a working default login |
| P0-5 | Build token can migrate | Read Workers Builds log for `d1 migrations apply` | Succeeds. If auth error, add a custom token with D1:Edit and re-run; record which path works |
| P0-6 | Free-plan CPU | Seed 30 days (~4k sessions), hit overview + funnel, inspect Workers Logs CPU | p95 < 10 ms and no 1102. If funnel fails, cap rows or move funnels to SQL before launch |
| P0-7 | Write/read measurement | Send 100 pageviews + 300 pings; inspect D1 `meta.rows_written`/`rows_read` and Workers requests | Documented per-event numbers; free-plan ceiling computed from measured values |
| P0-8 | Static assets are free | Load dashboard + script repeatedly, check Worker request metrics | Asset requests do not increment Worker invocations |

If P0-3 confirms pre-filled secret values, do not ship the button until `.dev.vars.example` is sanitized. If P0-5 fails, the button flow needs either a documented custom-token step or a CLI-first launch.

### Phase 1 — self-host MVP

| ID | Check | Pass |
| --- | --- | --- |
| P1-1 | Fresh-account install | Button to working dashboard in < 10 minutes, no local Node, no manual SQL |
| P1-2 | Core ingest | Pageview appears within 2 s; goal, outbound, identify, and engaged time visible |
| P1-3 | Isolation | Event for another domain → 403; bot UA → 202 and zero rows; >8 KB body → 413 |
| P1-4 | Auth | Unauthenticated dashboard API → 401; 10 wrong passwords → 429; logout clears cookie |
| P1-5 | Upgrade | Add a migration, push, redeploy; `d1_migrations` increments once; existing data intact |
| P1-6 | Export/restore | `wrangler d1 export DB --remote --output backup.sql`; restore into a local DB; row counts match |
| P1-7 | 7-day soak | 5k pageviews/day stays within free requests/writes/reads/storage; no 1027/1102 |
| P1-8 | CLI fallback | Same result on a machine without GitHub using the CLI steps |
| P1-9 | Docs/copy | No upstream brand, placeholder secrets, sponsor block, or copied marketing copy in the deployed UI/README |

### Phase 2 — hosted beta

| ID | Check | Pass |
| --- | --- | --- |
| P2-1 | Tenant isolation | A/B accounts: no cross-tenant read via list, ID guess, filter, export, or webhook |
| P2-2 | Auth lifecycle | Signup, login, logout, session expiry, password/OAuth reset; no shared admin password |
| P2-3 | Quotas | Per-tenant event cap returns 429 and writes nothing; cap is visible to the customer |
| P2-4 | CI/CD | PR preview uses preview D1; production migration runs only on `main`; failed migration blocks deploy |
| P2-5 | Backups | Time Travel restore into a scratch DB; scheduled export lands in R2; restore documented |
| P2-6 | Load | 50 events/s for 10 minutes: p95 ingest < 300 ms, no D1 overload, dashboard p95 < 1.5 s |
| P2-7 | Cost | Actual bill within ±20% of the model at 1M pageviews/month |
| P2-8 | Abuse | Bot/flood from one tenant does not degrade another; rate limits and alerts fire |

### Phase 3 — scale gates (only when measured)

| Trigger | Action |
| --- | --- |
| D1 writes > 50M/month or consistently > 60% of included writes | Reduce pings/index writes; then shard D1 by tenant group; then AE rollups |
| D1 reads > 25B/month or dashboard p95 > 1.5 s | Pre-aggregate daily tables in D1; then AE read path |
| Ingest bursts cause overloaded errors | Add Queues with client event UUID + unique index, or shard |
| Single DB > 5 GB or > 8 GB | Retention policy + archival; shard before 10 GB |
| Customer demand for per-customer hostnames | Evaluate Cloudflare for SaaS cost/limits; do not promise early |

---

## 8. Risks and open questions

| Risk | Evidence | Mitigation |
| --- | --- | --- |
| Button ships unsafe secret defaults | `.dev.vars.example:1-2`; community reports of prefill **[U]** | Sanitize the file, add boot validation, test P0-3/P0-4 |
| Deploy-token lacks D1:Edit, migrations fail | Auto-token permission list omits D1 **[V]**; community report **[U]** | Custom token with D1:Edit; test P0-5; document fallback |
| Migrations by DB name break on rename | `package.json:21`; button guidance says binding **[V]** | Change to `DB`; test P0-2 |
| Free CPU 10 ms breaks funnels | Funnel loads 100k rows into Worker (`stats.ts:421-430`) **[V]** | Cap rows, rewrite as SQL, or put funnels behind paid |
| Free D1 storage is 500 MB/DB, not 5 GB | D1 limits **[V]**; README:114 | Correct docs; retention/archival plan |
| Single D1 writer becomes the ceiling | D1 limits FAQ **[V]** | Measure; shard or AE at gates |
| No multi-tenant schema/auth | `migrations/0001_init.sql:2-11`, `index.ts:26-64` **[V]** | Add accounts/users/scoping before hosted beta |
| API keys and webhook secrets plaintext | `migrations/0001_init.sql:8-9` **[V]** | Hash/encrypt; scope list responses |
| Upstream branding/copy leakage | `Logo.tsx:8`, `script.js:12-14, 181-188`, `README.md:1-33` **[V]** | Rename inventory + full copy/design pass; NOTICE for MIT code |
| AE pricing/status changes | AE “currently not billed” **[V]** | Do not price the product on AE being free |
| Email/auth dependency outside Cloudflare | No verified Cloudflare transactional-email product in this review **[U]** | Decide OAuth vs Access-gated beta vs external email; document the exception |
| PII in D1 (email/name) | `collect.ts:125-136`, `payments.ts:174-182` **[V]** | Retention/deletion policy, DPA, data-subject export before hosted launch |

---

## 9. Source index

**Upstream files (pinned `d665db4`)**

- `README.md:47-116` — CLI deploy, free-plan claims, update flow.
- `wrangler.jsonc:1-23` — Worker entry, assets routing, D1 binding.
- `package.json:12-24` — build/deploy/migrate scripts.
- `.dev.vars.example:1-2` — required secret names and placeholder values.
- `src/worker/index.ts:18-64, 75-89, 109-196` — routes, auth, site CRUD.
- `src/worker/collect.ts:48-175, 206-300` — ingest, bots, domain check, writes.
- `src/worker/stats.ts:106-200, 234-320, 406-445` — KPIs, breakdowns, funnel.
- `src/worker/payments.ts:31-95, 148-185, 232-367` — attribution, webhook, API.
- `src/worker/lib/crypto.ts:37-77` — webhook HMAC, cookie signing, password compare.
- `src/worker/lib/time.ts:47-147` — periods and buckets.
- `src/worker/lib/ua.ts:7-56` — bot/browser parsing.
- `public/js/script.js:12-215` — cookies, transport, pings, goals, Dodo tagging.
- `migrations/0001_init.sql:2-98`, `0002_login_failures.sql:2-5`, `0003_payment_matching.sql:4-14`.
- `scripts/smoke.mjs:5` — placeholder password default.
- `LICENSE:1-13` — MIT + copyright.

**Cloudflare documentation (fetched 2026-10-26)**

- Deploy to Cloudflare buttons — https://developers.cloudflare.com/workers/platform/deploy-buttons/
- Deploy button secrets changelog — https://developers.cloudflare.com/changelog/post/2025-07-01-workers-deploy-button-supports-environment-variables-and-secrets
- Workers Builds — https://developers.cloudflare.com/workers/ci-cd/builds/
- Workers Builds configuration — https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- Workers Builds limits/pricing — https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- Workers pricing — https://developers.cloudflare.com/workers/platform/pricing/
- Workers limits — https://developers.cloudflare.com/workers/platform/limits/
- Static assets billing/limits — https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- D1 pricing — https://developers.cloudflare.com/d1/platform/pricing/
- D1 limits — https://developers.cloudflare.com/d1/platform/limits/
- D1 migrations — https://developers.cloudflare.com/d1/reference/migrations/
- D1 Worker API (`batch`, Sessions) — https://developers.cloudflare.com/d1/worker-api/d1-database/
- D1 read replication — https://developers.cloudflare.com/d1/best-practices/read-replication/
- Analytics Engine pricing — https://developers.cloudflare.com/analytics/analytics-engine/pricing/
- Analytics Engine limits/retention — https://developers.cloudflare.com/analytics/analytics-engine/limits/
- Queues limits — https://developers.cloudflare.com/queues/platform/limits/
- Cloudflare Access one-time PIN — https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/

**Community evidence (unverified, flagged [U])**

- Deploy button pre-fills `.dev.vars.example` values — https://github.com/cloudflare/workers-sdk/discussions/14639
- Docs request describing the same behavior — https://github.com/cloudflare/cloudflare-docs/issues/31988
- D1 migrations require D1:Edit token — https://github.com/cloudflare/wrangler-action/issues/221

---

## 10. Decision summary for the planning docs

- **Launch self-host first.** It is one Worker + one D1, and the button can be made reliable with a small, testable set of repo changes. Hosted SaaS is blocked on tenancy/auth, not on Cloudflare plumbing.
- **Do not add Analytics Engine or Queues to the initial architecture.** Keep D1; instrument it; let measured pressure choose the next component.
- **Treat the Deploy button as a distribution channel with a test matrix**, not a magic step. The three checks that matter most are secret prefill, migrations by binding, and D1 permission on the build token.
- **Budget for D1 writes, not requests or storage.** Pings and indexes are the hidden multiplier.
- **Original UI/copy is a pre-install task.** Rename the public API and cookies before anyone embeds the script; rewrite copy and visuals; keep the MIT notice for reused code.
