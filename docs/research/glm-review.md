# Research note: Minilytics upstream review for Analytica

- **Author model (actual):** GLM-5.3-Flash Free, provider `opencode` (running inside OpenCode / T3 Code). Free tier confirmed — research proceeded.
- **Date:** 2026-10-26
- **Scope:** research only. No code written, nothing deployed, no credentials touched, upstream not modified, no agents spawned. All inspection done locally.
- **Local source:** `/tmp/analytica-research/minilytics-d665db4`
- **Upstream pin verified:** `d665db48ad253b8f037af8459c960650cdc02fc3` is GitHub commit **"Add sponsors section and GitHub Sponsor button"** by surendrapandar/minilytics (parent `a5002ca`). The local checkout matches this pin (its README contains the sponsors section added by that commit, including `.github/FUNDING.yml` and `docs/sponsors/`). Verified by fetching the commit page on github.com.
- **Target product (working name):** Analytica — comparable analytics with original UI/copy, entirely on Cloudflare, offered as hosted SaaS **and** one-click Cloudflare self-host.
- **License note:** upstream is MIT (`LICENSE`, `package.json:6`). Reuse of logic is permitted; Analytica is planned with original UI/copy. MIT requires keeping the copyright/license notice in any reused code. `[VERIFIED]`

Claim labels used below: `[VERIFIED]` = confirmed by reading labeled source lines or official Cloudflare or vendor docs; `[PROPOSAL]` = my recommendation for Analytica, not in upstream; `[TO VERIFY]` = reasoned but not yet proven at runtime.

---

## 1. Architecture snapshot `[VERIFIED]`

| Layer | File(s) | Notes |
| --- | --- | --- |
| Tracker (client) | `public/js/script.js` (215 lines, ~9 KB) | Cookies, pageviews, SPA navigation, engaged time, goals, outbound links, Dodo link tagging |
| API worker | `src/worker/index.ts` (Hono) | Routes: `/api/event`, `/api/webhooks/dodo/:siteId`, `/api/v1/payments`, `/api/v1/goals`, `/api/auth/*`, `/api/sites*` |
| Ingest | `src/worker/collect.ts` | Validation, bot filter, geo, session upsert, event insert, payment claiming |
| Stats | `src/worker/stats.ts` | Overview, breakdown, customers, visitors, visitor profile, funnels — all SQL on D1 |
| Payments | `src/worker/payments.ts` | Dodo webhook (Standard Webhooks), generic payments API, goals API, 5-strategy attribution |
| Auth helpers | `src/worker/lib/crypto.ts` | HMAC-SHA256 token sign/verify, webhook signature verify, constant-time compare |
| Classification | `src/shared/sources.ts` | Channel/source taxonomy shared worker+dashboard |
| Schema | `migrations/0001_init.sql`, `0002_login_failures.sql`, `0003_payment_matching.sql` | 8 tables total |
| Config | `wrangler.jsonc` | Workers + static assets + one D1 binding; only runtime dependency is `hono` (`package.json:26`) |

Deployment shape (`wrangler.jsonc`): `run_worker_first: ["/api/*"]` (line 12) means only API calls run the Worker; the dashboard and `/js/script.js` are served as free static assets with `not_found_handling: "single-page-application"`. One D1 database, binding `DB`, placeholder id (line 19). `[VERIFIED]`

---

## 2. Capability inventory `[VERIFIED]`

### 2.1 What the tracker collects (`public/js/script.js`)

- **Visitor + session cookies** (lines 12, 63–69): `ml_vid` (1-year) and `ml_sid` (**sliding 30-minute session**, cookie max-age refreshed on every send) set on the **root domain** so subdomains share one visitor (lines 32–55, `rootDomain()` probes candidate domains). `?ml_ignore=true|false` localStorage opt-out and `navigator.webdriver` / localhost guard (lines 17–30).
- **Pageviews** incl. SPA `pushState/replaceState/popstate` hooks (lines 113–131); first view sends `document.referrer`.
- **Engaged time**: visibility-gated "ping" each 60s while visible, max 30 pings per page (lines 97–111); server clamps each ping to ≤ 10 min (`collect.ts:8,117`).
- **Goals**: `data-ml-goal` DOM attributes or `window.minilytics('goal', …)` (lines 134–137, 181–188, 204–211).
- **Outbound click** tracking (lines 190–199).
- **URL hygiene**: query params matching a private-param regex (`email|name|phone|password|token|auth|code|secret|key|api_key|license…`) are stripped **in the browser** before sending (lines 72–82).
- **Transport**: body as `text/plain` (no CORS preflight), `sendBeacon` / `fetch(keepalive)` accounting (lines 88–95).
- **Dodo checkout tagging**: any `dodopayments.com` link gets `metadata_ml_visitor_id`/`metadata_ml_session_id` appended, kept fresh via MutationObserver + pointerdown/keydown re-tagging (lines 142–177); `window.minilytics.attribution()` exposes ids for server-side checkout metadata.
- **Identify**: `window.minilytics('identify', {user_id, email, name})` sends PII to the worker (line 207; server side `collect.ts:125–135`).

### 2.2 Ingest path (`src/worker/collect.ts`)

- Payload ≤ 8192 bytes; `w`, `t ∈ {pageview, goal, outbound, ping, identify}`, `vid`, `sid` validated as `/^[\w-]{8,64}$/` (lines 7, 49–57).
- Bot filter by UA regex + empty UA (`src/worker/lib/ua.ts:7–12`).
- **Domain allowlist**: event rejected 403 unless the hostname of the **posted URL** belongs to the site's domain or subdomains (`belongsTo`, lines 41–46, 71–72).
- **Geo** from `request.cf` (`country/region/city`) — or `x-vercel-ip-*` headers when proxied (lines 84–102).
- Session creation on first sighting of `sid` (lines 138–146, 222–301): attribution from same-domain-excluded referrer, utm params, `?ref=`/`via=`; classification into channel/source via `src/shared/sources.ts:82–107` (explicit tags beat HTTP-style referrer; known-source table lines 19–56 includes AI assistants, paid/email/social medium regexes lines 58–60). Pageview count increment is a separate statement so concurrent first events don't double-count (lines 296–299).
- `identify` upserts visitor PII with COALESCE (lines 125–135); goal props JSON ≤ 1000 chars (line 161); payment claiming when a pageview URL carries `payment_id`/`subscription_id` (lines 181–204, migration `0003`).

### 2.3 Stats & dashboards (`src/worker/stats.ts`)

- KPIs: visitors, sessions, pageviews, bounce (session with `pageviews<=1 AND goals=0`, line 108), avg duration, revenue, payments, customers, conversion, revenue-per-visitor — current vs previous period, online-now, and a time-series chart (`overview`, lines 147–200; one `db.batch` of 7 statements).
- Breakdown dimensions (lines 203–222 plus page/exit_link/goal, lines 269–317), always revenue-joined (payments ↔ credited session) with filter support.
- Click-to-filter system: 18 whitelisted session columns (`SESSION_FILTERS`, lines 7–26) built into parameterized SQL (`filterSql`, lines 45–66) — no SQL injection surface; keys are an allowlist and `limit` is numeric-clamped (line 236).
- Journey (customers, 339–358), Users (visitors, 361–377), full visitor timeline (visitorProfile, 380–397), funnels with ordered per-visitor progression and `GLOB` wildcard page steps, computed in the Worker from ≤ 100k scanned events (funnel, 406–445).
- Timezone-correct ranges and buckets (Monday weeks), auto granularity `src/worker/lib/time.ts:50–147`.

### 2.4 Payments & attribution (`src/worker/payments.ts`)

- Dodo webhook `POST /api/webhooks/dodo/:siteId` verified as **Standard Webhooks** HMAC-SHA256, 5-min timestamp tolerance, multi-signature parse (crypto.ts:37–58; test coverage `test/core.test.ts:88–101`). Only `payment.succeeded` / `refund.succeeded` recorded; other types acked (payments.ts:256–301). Currency conversion only when Dodo reports a settlement amount in the site's currency (259–262). Refunds stored as negative amounts (`migrations/0001_init.sql:80`).
- **5-strategy attribution** (`attribute`, payments.ts:29–95): checkout metadata (`ml_visitor_id`) → return-page claim table → prior payment by same customer/email (marks renewal) → email match on identified visitor → **timing heuristic** (3-hour window of checkout clicks, requiring a unique candidate — payments.ts:97–146). Credit goes to the visitor's **last non-direct visit** (`creditedSessionSql`, 32–35). A "rematch" endpoint re-runs matching for unmatched payments (188–222).
- Generic payments API `POST /api/v1/payments` with Bearer site api_key (304–340, amounts as major units converted to minor units via `currencyDecimals`, line 323) and server-side goals API (346–367).

### 2.5 Auth (`src/worker/index.ts`, `lib/crypto.ts`)

- **Single shared admin** — one `ADMIN_PASSWORD` + one `SESSION_SECRET` (`src/worker/env.ts:1–8`). Login posts password; sets cookie `ml_auth` = `admin.<expiryMs>.<HMAC-SHA256>`, HttpOnly, SameSite=Lax, 30 days (index.ts:11–14, 55–62).
- Brute-force lockout: 10 failures per IP / 15 min persisted in D1 `login_failures`, plus a 500 ms delay on failure (index.ts:13–14, 36–54; migration `0002`).
- `isLoggedIn` verifies HMAC and compares expiry > now (index.ts:26–30); all `/api/sites*` routes gated (79–89). No CSRF token (JSON + SameSite=Lax mitigations). Constant-time compare (`safeEqual`, crypto.ts:26–31) — but **password compared as plaintext against the secret** (`passwordsMatch`, crypto.ts:75–77; the secret itself is the plaintext password).

---

## 3. Data model as-is `[VERIFIED — migrations + ingest]`

`migrations/0001_init.sql` (prefixes trimmed here; all tables carry `site_id`):

- **sites** — id (8-byte random id → 16 base36 chars, `index.ts:137,142`), name, domain, timezone, currency, `api_key` (`ml_`+random), `dodo_webhook_secret`, created_at.
- **visitors** — (site_id, id) PK, first_seen, optional user_id/name/email (PII only when identify() or a payment supplies it).
- **sessions** — (site_id, id) PK, visitor_id, started/last_seen, duration, pageviews, goals, hostname, entry/exit_page, referrer (+domain), source, channel, the 5 utm fields, `ref`, country/region/city, browser/os/device. Index (site_id, started_at) + (site_id, visitor_id).
- **events** — autoincrement id, site_id, session, visitor, ts, type, name, path, props (≤1KB JSON). Index (site_id, ts) + (site_id, session).
- **payments** — id PK, provider (dodo/api), ts, amount (minor units, refunds negative), kind, currency, visitor/session/customer, email/name, renewal; `0003` adds `matched_by` + `subscription_id`. Index (site_id, ts) + (site_id, customer).
- **funnels** — steps JSON (≤10 steps of page/goal).
- `0002` **login_failures** (ip, ts); `0003` **payment_claims** (site_id, payment_id → visitor_id).

**Write accounting per pageview** `[VERIFIED code; arithmetic is mine]`: event row + its 2 index entries, session UPDATE (pageviews/exit/last_seen), ping rewrites every 60s, occasional visitor INSERT-OR-IGNORE → roughly 3–10 "rows written" per pageview. This makes the D1 free-tier 100k rows-written/day cap ≈ low tens of thousands of pageviews/day; upstream's README estimates "about 10k pageviews per day" (`README.md:113–115`), which is the same ballpark, slightly conservative.

Most dashboard dimensions query `sessions` (clever: attribution is denormalized onto the visit row); `events` is only scanned for page/goal/exit-link dims and funnels. There are **no rollup tables and no retention/expiry jobs**.

---

## 4. Cloudflare budget for this app `[VERIFIED vs official docs]`

Cross-checked against Cloudflare docs (fetched 2026-10-26):

| Constraint | Free plan | Paid | Source |
| --- | --- | --- | --- |
| Worker requests (self-host) | 100,000/day | unlimited | Workers limits doc |
| Worker CPU | 10 ms | 30 s default (≤5 min) | Workers limits doc |
| Subrequests / queries per invocation | 50 | 10,000 / 1,000 D1 queries | Workers + D1 limits docs |
| D1 rows read | 5M/day | 25B/mo included | D1 pricing doc |
| D1 rows written | 100k/day | 50M/mo included | D1 pricing doc |
| D1 storage **per account** | 5 GB | 5 GB included + $0.75/GB | D1 pricing doc |
| **D1 storage per database** | **500 MB** | 10 GB (hard cap) | D1 limits doc |
| D1 databases per account | 10 (50k on paid) | 50,000 | D1 limits doc |
| D1 throughput | single-threaded DO per database; ~1,000 qps at 1 ms/query; queues then "overloaded" errors | same | D1 limits FAQ |
| Time Travel PITR | 7 days | 30 days | D1 limits doc |
| Static assets | don't run the Worker (`run_worker_first`) → don't consume request quota | — | `wrangler.jsonc:12` + Workers docs |

**Discrepancy to flag** `[VERIFIED]`: `README.md:114` presents "5 GB D1 storage" as the self-host ceiling. That is the **account-total** on Free; the **per-database** Free cap is **500 MB**, which a single-tenant deployment will actually hit first (sessions+events+indexes). For Analytica's docs this must be corrected; for hosted SaaS on Workers Paid the 10 GB per-database cap is the real boundary (and a per-tenant-DB architecture sidesteps it entirely).

The overview endpoint is one `db.batch()` (counts as 1 query against the per-invocation limit; `stats.ts:158–178`), so even Free's 50-query budget per invocation is safe for normal dashboard loads. `[VERIFIED]`

---

## 5. Concrete risks `[VERIFIED unless marked]`

**R1. Not multi-tenant — the blocker for hosted SaaS.** Auth is a single shared admin password (`env.ts:1–8`; `README.md:50` "Every person deploys their own copy"). There is no user/account model, no ownership of `sites`, and no billing. A SaaS requires a real tenancy layer; the current schema has zero support.

**R2. Ingest is freely writable / spam-poisoning + cost attack.** `POST /api/event` has CORS `origin: *` (`index.ts:18`), no authentication, no rate limiting anywhere in the codebase, and bot/rate protections are absent beyond the UA regex. The 403 domain check (`collect.ts:71–72`) validates the hostname **inside the posted body**, which any client can set — knowing a site's public `data-website-id` lets anyone inject arbitrary pageviews/goals/referrers/utms (and `identify` PII, `collect.ts:125–135`) from anywhere. For Analytica hosted: this is both a data-integrity problem (poisoned dashboards) and a **commercial risk**, since attacker POSTs consume D1 rows-written quota that maps to real money. `[VERIFIED attack path; mitigation PROPOSAL]`

**R3. Geo + proxy headers are client-influenceable.** `geoOf` (`collect.ts:88–102`) trusts `x-vercel-ip-country/region/city` if present — but that check runs on **every** event, not only via a verified proxy, so a direct attacker can forge country/city. Cloudflare's own `request.cf` geo comes from the edge and is trustworthy; the Vercel-fallback path is not.

**R4. Server trusts client-issued session/visitor ids and never expires sessions server-side.** `ingest` reuses any `sid` present in the table indefinitely (`collect.ts:138–146`); the 30-minute window lives only in the browser cookie (`script.js:67`). A scripted client (or an expired cookie replay) can keep one "session" alive for months or mint unlimited session ids. Also means a stolen/spoofed `vid` lets an attacker append events to a real visitor's timeline (visitorProfile exposes everything; `stats.ts:380–397`).

**R5. Funnel GLOB patterns can hit D1's 50-byte pattern limit.** Funnel page steps are stored up to 200 chars (`index.ts:227`) and queried via `GLOB` (`stats.ts:417`). The official D1 limits doc caps **LIKE/GLOB patterns at 50 bytes**, so longer paths (e.g. typical blog slugs) will likely break funnel stats at runtime. `[Verified limits doc; runtime behavior TO VERIFY]`

**R6. README's own-limit table slightly overstates Free storage** — see §4 discrepancy (500 MB per-database on Free). `[VERIFIED]`

**R7. Deletion is one huge multi-table DELETE.** Site delete runs `DELETE FROM events|sessions|visitors|payments|funnels WHERE site_id = ?` plus the site row in one batch (`index.ts:187–196`). D1 docs warn single large UPDATE/DELETE over hundreds of MB exceed execution limits — big sites will need chunked deletion, and `login_failures`/`payment_claims` rows are never cleaned (stale PII-adjacent data). `[Verified code + D1 guidance]`

**R8. Auth hard-flaws for SaaS reuse:** plaintext password comparison, no revocation (logout only clears the cookie; a stolen token is valid 30 days until expiry — rotate `SESSION_SECRET` kills all sessions), no 2FA, no audit trail, no per-IP throttling beyond the D1 lockout (`crypto.ts:75–77`, `index.ts:26–30`, 32–64).

**R9. No privacy modes.** Cookie-based IDs always on, city-level geo stored, `identify` accepts raw emails, no consent-mode, no cookieless fallback, no DNT handling, no data-retention settings. Readable EU cities are processed regardless of jurisdiction. For a hosted SaaS this is a DPA/consent/compliance blocker; also the "self-serve opt-out" is only `?ml_ignore=true` localStorage (`script.js:17–30`). `[VERIFIED absence; compliance read is interpretation]`

**R10. Funnel/breakdown scale ceilings.** Funnel scans ≤ 100k raw events per call (`stats.ts:426`), visitorProfile pulls all payments + up to 1k events per visitor. No rollups means dashboard cost grows with row count; D1 read pricing charges per scanned row (`rows_read`), so big sites on paid plans pay proportionally.

**R11. Dodo coupling.** Hard-coded Dodo domain tagging in tracker (`script.js:148,157`), webhook path, timing heuristics keyed to `dodopayments.com`/checkout-goal names (`payments.ts:106–146`). It's a nice template for one provider, but Analytica should isolate payment-provider adapters behind the generic `payments` API it already has.

**R12. Duplicate/failed sends are not idempotent at ingest.** No event dedupe key; `fetch(keepalive)` retries and double-script installs double-count. Minor, but worth fixing server-side with a client event id. `[VERIFIED absence]`

Also noted (minor): "online now" is computed with two slightly different windows — 24h/5min on the Sites list (`index.ts:116–119`) vs 6h/5min in overview (`stats.ts:163–165`) — numbers can disagree between screens. `[VERIFIED]`

---

## 6. Verified summary of what Analytica must change vs. what it can keep

**Keep (proven design, rebuild with original UI/copy):**
- Single-Worker + static assets + D1 (`run_worker_first`) shape; cookie semantics; SPA handling; engaged-time pings; URL-scrubbing in browser; `text/plain` transport.
- Denormalized attribution on the session row (makes nearly every dashboard query one indexed scan), whitelisted filter system, timezone-correct bucketing (incl. Monday weeks and per-site TZ), last-non-direct revenue credit.
- Standard Webhooks signature handling, multi-strategy payment attribution with explicit `matched_by` audit column, rematch endpoint, refunds-as-negative-rows.

**Change (proposals):** everything in §5 that collides with SaaS requirements: tenancy, auth, ingest protection, privacy modes, rollups/retention, idempotency. Details below.

---

## 7. Recommendations for Analytica `[PROPOSAL — design direction, not verified upstream]`

### 7.1 Data model

Start from the upstream shape (it's sound) plus a tenancy spine. _$ → minor-units everywhere (upstream does this correctly)._

```
users          (id, email_hash?, password_hash/scrypt or passkey, created_at, role)
sites          (id, owner_user_id, name, domain, timezone, currency,
                api_key_hash?, privacy_mode, created_at, plan/cap columns)
sessions       (… unchanged shape, + new indexes as needed)
events         (… + optional client_event_id for idempotency)
rollups        (site_id, bucket_start, granularity, dim_hash?, ...) ← new
payments       (… matched_by + provider column already proven)
api_tokens     (id, site_id, token_hash, name, created_at, last_used, revoked_at) ← note upstream stores api_key plaintext; hash at rest
quota_counters (site_id, period, events_used) or DO-based counter
```

- **Do not** store `api_key`/webhook secrets plainly if we clone upstream habit — upstream stores `api_key` in cleartext (`sites` schema, `0001_init.sql:8`) with plaintext display+rotate (`index.ts:181–185`). Only show once, store a hash; rotation already exists.
- Add `client_event_id` (client-generated uuid) unique per (site_id, event) to make ingest idempotent (fix R12).
- Partitioning: keep `site_id` as the first clause of every WHERE (upstream consistency) and rely on the existing composite indexes.

### 7.2 Tenancy

- **Ownership**: `sites.owner_user_id → users`; every `/api/sites*` query gains `AND owner = current_user`. Upstream's `loadSite` middleware (`index.ts:82–89`) is the single fixed point — extend it.
- **Isolation strategy** `[PROPOSAL with options; defaults stated]`:
  1. **Phase 1 (recommended): one shared D1**, all rows keyed by `site_id`, ownership enforced in the API layer only. Simplest, cheapest, matches upstream queries; acceptable to ~tens of GB.
  2. **Phase 2 (escape hatch): D1-per-tenant** for large/payded tenants. Paid accounts allow 50,000 D1 databases and ~5,000 bindings/Worker; a Worker can't switch bindings dynamically, so per-tenant DBs would go through the D1 REST API (extra latency + not all features) or Workers for Platforms. Only do this when a tenant actually threatens the 10 GB or noisy-neighbor queue (`overloaded`) errors.
- **Data already has good tenant hygiene**: `site_id` on every table; site delete already cascades per-table (fix R7 with chunked deletes + clean `payment_claims`, `login_failures`).

### 7.3 Auth

- Replace single-password with per-user accounts. Password sign-in with **scrypt/argon2-style hashing** (WebCrypto offers PBKDF2; scrypt not native — PBKDF2-SHA256 with high iterations is the portable Cloudflare option; or offer passkeys/WebAuthn).
- Keep the HMAC-signed cookie format (`crypto.ts:61–73` is solid) but bind it to a **server-side session id** so sessions are revocable (`sessions` of users, not visitors); keep 15-failure/15-min lockout but move the counter to KV/DO so D1 outage can't disable login retry logic and the counter survives isolate restarts. `[PROPOSAL]`
- Keep CSRF posture (JSON-only + SameSite=Lax) and add per-session CSRF token for state-changing dashboard actions.

### 7.4 Session semantics

Keep the client cookie contract (`ml_vid`/`ml_sid`, root-domain, sliding 30 min) — it works, and Safari 7-day cap applies to all cookie-carrying tools (upstream documents this honestly, `README.md:185–187`). Fix the server side:

1. **Regenerate sessions server-side**, not just client-side: if an event arrives for a session whose `last_seen_at` < now−30 min (R4), create a NEW session row with fresh `sid` and current attribution; treat the client `sid` only as a hint. Keeps duration math honest.
2. **Clamp ping windows**: ping duration already capped at 10 min per ping (`collect.ts:8,117`); also cap "online now" strictly to the 5-minute `last_seen` rule and unify the two definitions (R-minor).
3. **Idempotency** via `client_event_id` (7.1).
4. **Visitor identity**: keep identify()'s COALESCE-merge, but in privacy modes below, PII fields are ignored/rejected.

### 7.5 Privacy modes `[PROPOSAL; upstream has none]`

Per-site mode chosen in site settings:

| Mode | IDs | Geo | PII | Notes |
| --- | --- | --- | --- | --- |
| **Standard** (default, cookie-aware) | cookies | country/region, city opt-out | identify allowed | upstream parity |
| **Cookieless** | none persisted; per-(site,day-HMAC) aggregation id derived server-side from hashed IP+UA salt, *or* sessionless counting (pageviews only, visitor counts derived heuristically) | country only, no city | rejected | GDPR-friendly |
| **EU-only** | cookies | country only | rejected | route only through EU-hosted self-host deployment; upstream geo comes from edge so it's deploy-region dependent |

Implementation notes: geo comes from the same `request.cf` plumbing `collect.ts:100–101` already uses (drop the Vercel fallback in Analytica, fixing R3, or gate it to a verified proxy route). For cookieless mode, UA/IP-derived hashing requires a per-site salt stored as a secret; rotation invalidates continuity (tradeoff to document). Consent banner handling is the site owner's product decision, but the mode switch is our offering. Data-retention setting per site (30/90/365 days) with a scheduled cron cleanup (D1 free plan has 5 cron triggers/account; paid 250 — one shared housekeeping Worker suffices).

### 7.6 Quotas & abuse protection (SaaS)

- **Edge rate limiting** on `POST /api/event`: Cloudflare WAF rate-limiting rule per site-id header, plus **Cloudflare Queues** in front of ingest for burst absorption with batched D1 writes (upstream does all writes inline; a queue consumer can batch dozens of events per statement). `[PROPOSAL; Queues docs to verify batch sizing]`
- **Per-site event quotas** by plan (e.g. 10k/100k/1M events per month): count via a cheap DO counter or daily rollup query; when exceeded, return 202-accepted-but-unwritten ("paused") with dashboard notice rather than dropping silently.
- **Deep protection against R2**: require script-engine traffic to pass a lightweight proof (e.g. same-origin POST with `Origin` check, plus rotating short-lived collector token issued by a mini `/api/collect-config` handoff), accept that data integrity vs. spoofing is probabilistic (every analytics tool has this problem); the practical mitigations are UA filtering (already there), rate limits, quotas, and anomaly flags in the dashboard.
- **Currency/geo overwrite**: accept `x-vercel-*` only on the documented proxy endpoint, never on the direct one (R3).

### 7.7 Scale boundaries (state these in product copy honestly) `[VERIFIED platform facts + arithmetic]`

- **Self-host Free**: ~100k events/day Worker quota; D1 100k rows-written/day ≈ 15–25k pageviews/day realistically; 500 MB/database (not 5 GB) ≈ months of data on low-traffic projects; dashboard reads eat into 5M rows/day quickly (overview batch + breakdown + visitors ≈ a few thousand rows read per load).
- **Self-host Paid ($5/mo)**: daily caps disappear; 10 GB/database hard cap → for a heavy single site, rollups + retention become necessary long before 10 GB.
- **Hosted SaaS (our deployment, Workers Paid)**: single shared D1 is single-threaded per its backing DO — ~1,000 qps at 1ms query times; ingest is small (a few ms), so ~100–300 qps sustained ingest per database is the practical ceiling before needing the per-tenant-DB escape hatch or read replicas (D1 read replication exists in beta per Cloudflare D1 docs — untested here).
- Funnel `LIMIT 100000` event scan (upstream `stats.ts:426`) should move to bounded chunks or to rollup precomputation once `events` passes low tens of millions of rows (also mitigates D1's 30s per-query limit and the 50-byte GLOB limit R5 by matching pages via join table instead of GLOB).
- Fix **R7** deletions with chunked deletes (e.g. 500–1000-row batches — D1 docs explicitly recommend batching).

### 7.8 One-click self-host (Cloudflare only) `[VERIFIED mechanism]`

Cloudflare's official **Deploy to Cloudflare button** handles exactly this flow: clone `URL=?your-repo`, provision resources declared in `wrangler.jsonc` automatically (D1 supported), read secrets from `.dev.vars.example`, and run the repo's `deploy` script (where migrations go) — with the caveat that D1 migrations should be referenced by **binding name**, not database name, since users may rename the database. Requirements: public GitHub/GitLab repo; Workers-only (no Pages); monorepos not fully supported. For Analytica: keep `wrangler.jsonc` with placeholder D1 id (upstream does), put `db:migrate` into the deploy script, and let the setup wizard (bcrypt/PBKDF2 the user-typed password is not required — set the raw password as a Worker secret) guide `ADMIN_PASSWORD` + `SESSION_SECRET` prompts. The button flow satisfies "one-click Cloudflare self-host" without a custom setup Worker. `[VERIFIED doc behavior; exact wizard UX depends on Cloudflare's websh deployer at runtime — TO VERIFY]`

---

## 8. Open questions for the planning docs

1. **SaaS billing rail**: "entirely Cloudflare" constrains compute/data; billing still needs a processor (Stripe/others) — confirm with the product owner whether that's in scope or if self-host-only distribution starts first.
2. **Payment-provider matrix for v1**: upstream hard-couples attribution heuristics to Dodo checkout signals (`payments.ts:106–146`) and has a generic API; decide which real-world providers (Stripe?) get first-class link-tagging, and keep Dodo's 5-strategy chain as the reference model with provider adapters.
3. **Consent-mode integration** (CMP signal detection) vs. pure privacy-mode selection — product decision, affects the tracker spec.
4. **Funnel page-step matching**: replace GLOB (R5) with pre-normalized path patterns or pattern tables; verify the 50-byte limit behavior empirically before committing.
5. **Whether to adopt Cloudflare Queues for ingest** — depends on SaaS event volume targets; adds a paid-plan requirement (Queues are paid-tier; docs to verify) and ordering tradeoffs.

---

*End of research note. Source inspected: 24 worker/dashboard files, 3 migrations, tests, wrangler config, README; upstream pin independently confirmed; Cloudflare limits/pricing/deploy-button docs fetched and quoted 2026-10-26.*
