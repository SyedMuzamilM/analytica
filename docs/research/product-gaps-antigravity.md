# Analytica Product Gap Review

**Reviewer Model:** `gemini-3.8-flash-high`  
**Harness / Environment:** Antigravity research subagent via T3 Code harness  
**Target Repository:** `/Users/syedmuzamilm/work/mzml/analytica`  
**Source Baseline Commit:** `80be717` (pinned to commit `80be7177e68cf1b4aa988df9ea0ecb4ef1d011c7`)  
**Evaluation Scope & Boundaries:** Static source analysis, product architecture inspection, API contract and flow audit across `apps/dashboard`, `apps/worker`, `public/tracker.js`, migrations, and operational documentation. No credentials or `.dev.vars` accessed; no application code, configuration, or test suites modified; no deployment or browser preview commands executed; no external network contact made. No claims of runtime execution are made unless directly verified.

---

## 1. Executive Summary & Verification Context

Analytica has achieved an impressive engineering foundation at commit `80be717`. It delivers a fully custom, privacy-conscious analytics platform built on Cloudflare Workers, Static Assets, and D1. It features WebAuthn passkey authentication, dual privacy models (cookieless document sessions vs. consented attribution), session conversion funnels, visitor journey timelines, and signed Dodo Payments webhook intake with multi-currency tracking.

The previous implementation reviews (Antigravity at `852c52e`, GLM Free, DeepSeek Free at `4d90769`, and Sol) resolved concrete race conditions, deletion deadlocks, and edge-case contracts. However, those reviews evaluated whether existing code was structurally sound and defensively written. This review evaluates the **product proposition itself**: what a founder or small product team actually needs to answer critical business questions, where the onboarding and verification flows fail or create friction, what capabilities are missing from the dashboard, and what operational constraints will surprise self-hosters.

### Summary of Core Product Observations
1. **The Installation Feedback Loop is Broken:** After creating a site, the user is given a snippet and told to wait. There is zero live verification, no incoming event listener, no status indicator on the settings screen, and silent failure when testing on `localhost` (due to unconfigured tracker flags and server-side origin/hostname rejection).
2. **High-Value Data is Ingested but Never Exposed:** The tracker collects and the backend persists `campaign` (UTM campaign), `channel`, `entry_page` (landing page), `exit_page`, and `outbound` link clicks. None of these dimensions are exposed in `AnalyticsReport` or visible on any dashboard view. `outbound` events are literally write-only into D1.
3. **Report Granularity is artifically constrained in the UI:** The Worker backend already supports `period=today` and `period=custom`, but `App.tsx` hardcodes a select box with only `7d`, `30d`, and `90d`. Founders launching products cannot view "Today" or "Yesterday", nor does the backend support hourly bucketing.
4. **Hardcoded Quotas Will Halt Growing Sites Silently:** The database migration (`0001_analytics.sql`) hardcodes a trigger aborting at 1,000 events/site/day and 2,000 events/installation/day across all sites. The dashboard provides no usage meters, no warning banners, and no UI or API mechanism to adjust `daily_limit`.
5. **Zero Shareability for Non-WebAuthn Stakeholders:** There are no public dashboards, password-protected links, or read-only guest URLs. To let a co-founder, investor, or client see metrics, they must register a personal WebAuthn passkey into the workspace.

---

## 2. Original Product Proposition & JTBD Assessment

Analytica positions itself as a lightweight, privacy-respecting alternative to Google Analytics, Plausible, and Umami, running entirely within Cloudflare's serverless edge and D1 database, augmented with native server-side revenue tracking.

### Founder & Small-Team Jobs: Solved vs. Missing

| Job to be Done (JTBD) | Status | Evidence at `80be717` | Practical Evaluation |
| --- | --- | --- | --- |
| **"Is anyone on my website right now?"** | **Solved** | `apps/worker/reports.ts:215,278`; `apps/dashboard/App.tsx:478` | Active browsers in the last 5 minutes are counted via `online` and displayed next to a pulsating green dot in the chart footer. |
| **"Where is my traffic coming from?"** | **Partially Solved** | `apps/worker/reports.ts:232,280`; `apps/dashboard/App.tsx:1754` | Top referrer source domains are aggregated and filterable. However, sub-channels, campaign tags, and full referrer paths are omitted. |
| **"How did my marketing campaign perform?"** | **Missing** | `public/tracker.js:109-118`; `migrations/0001_analytics.sql:22`; `packages/contracts/index.ts:54-68` | UTM parameters (`utm_campaign`, `utm_medium`) are parsed by tracker and stored in DB columns `campaign` and `channel`, but completely omitted from `AnalyticsReport` and the UI. |
| **"Where do visitors land, and where do they leave?"** | **Missing** | `migrations/0001_analytics.sql:28-29`; `apps/worker/reports.ts:232-236` | `entry_page` and `exit_page` are recorded in `analytics_sessions`, but never queried in `reports.ts`. Only general pageview `path` counts are returned. |
| **"Did visitors complete key conversion actions?"** | **Solved** | `public/tracker.js:255-260`; `apps/dashboard/App.tsx:1855-1900` | Custom goals (`window.analytica('goal', 'name')`) and DOM goal triggers (`data-analytica-goal`) are recorded and charted. |
| **"Which outbound links do visitors click?"** | **Defect / Missing** | `public/tracker.js:311-318`; `apps/worker/analytics.ts:133-145`; `apps/worker/reports.ts:232-236` | Tracker captures outbound link clicks and Worker inserts them as `type='outbound'`, but reports only query `type='goal'`. Outbounds are completely invisible in the dashboard. |
| **"Did traffic translate into real customer revenue?"** | **Solved (Technical)** | `apps/worker/revenue.ts`; `apps/dashboard/RevenueView.tsx` | Multi-currency gross/net/refund totals, merchant checkout claim tokens, and signed Dodo webhooks are implemented. (Requires merchant backend integration). |
| **"Can I view my site's conversion funnel?"** | **Solved (Restricted)** | `apps/dashboard/FunnelsView.tsx:38-42` | Ordered session funnels (2-8 steps, 30-min window) are implemented, but strictly locked to `attribution` mode. Sites created in default `aggregate` mode cannot use funnels. |
| **"Can I share metrics with an investor or client?"** | **Missing** | `apps/dashboard/App.tsx:960-985`; `apps/dashboard/AccountView.tsx:430-490` | No shareable links or public dashboards exist. Every single viewer must register a WebAuthn passkey device into the database. |
| **"Can I verify that tracking works during local development?"** | **Defect / Blocked** | `public/tracker.js:18-21`; `apps/worker/analytics.ts:255-258,295-305` | Tracker disables itself on `localhost` unless `data-allow-localhost` is set, and the Worker rejects non-matching origins/hostnames with 403 unless site domain is registered as `localhost`. |

### Analytical Features vs. Marketing / Customer Acquisition Needs
For an early-stage founder, analytics serves two distinct jobs:
1. **Marketing & Acquisition Validation:** "Which tweet, newsletter link, or Product Hunt badge drove visitors who actually signed up?" (Requires UTM campaign breakdowns, landing pages, and date flexibility).
2. **Product Engagement & Conversion:** "Are visitors reading docs and completing onboarding?" (Requires funnels, page depth, and outbound tracking).

Analytica currently leans heavily into core statistical mechanics (session duration, bounce rate, exact-step funnels) while neglecting basic marketing acquisition dimensions (campaigns, referrers, landing pages) and onboarding feedback.

---

## 3. Detailed Area-by-Area Inspection

### 3.1 Dashboard & Onboarding Flow
- **First Site Experience:** When an owner signs in for the first time, `App.tsx:1120-1135` loads sites. If no site exists, the app renders a blank workspace shell and automatically opens `SiteModal`.
- **Default Privacy Mode Trap:** In `SiteModal` (`apps/dashboard/App.tsx:684-704`), the form defaults to `privacyMode="aggregate"`. Once created, `privacyMode` is **immutable** (`apps/worker/analytics.ts:503-512`). If a founder accepts default settings and later navigates to "Funnels" or "Journeys", both views display disabled banners stating that attribution mode is required (`FunnelsView.tsx:120-128`; `JourneysView.tsx:35-40`). The user cannot enable funnels without deleting and recreating the site.
- **Decorative Keyboard Shortcut:** In `apps/dashboard/App.tsx:1304`, the sidebar navigation renders `<span className="nav-shortcut">G O</span>` next to Overview. There is **no keyboard event listener** (`keydown`/`keyup`) anywhere in the application. Pressing `G` then `O` does nothing. This is a purely cosmetic visual badge that creates false usability expectations.

### 3.2 Installing and Verifying First Event
- **Copying the Snippet:** Upon site creation, the user is redirected to `SettingsView` (`apps/dashboard/App.tsx:1930-1937`), where the `<script>` tag is displayed:
  ```html
  <script defer src="https://example.com/tracker.js" data-site="site_xxx" data-mode="aggregate"></script>
  ```
- **Silent Tracker Execution:** In `public/tracker.js`, there is not a single `console.log`, `console.warn`, or `console.error` statement. If an installation error occurs (invalid site ID, rejected origin, consent withheld, localhost disabled), the tracker fails completely silently.
- **The Localhost / Staging Deadlock:**
  - `public/tracker.js:18-21` sets `disabled = true` if `location.hostname` is `localhost`, `127.0.0.1`, or `[::1]`, unless the tag has `data-allow-localhost`.
  - Even if a developer adds `data-allow-localhost`, `apps/worker/analytics.ts:255-258,295-305` evaluates `hostnameAllowed(event.hostname, site.domain)` and `hostnameAllowed(originHostname, site.domain)`. If the site was created with domain `example.com`, any request from `http://localhost:3000` is rejected with HTTP 403 `hostname_not_allowed` or `origin_not_allowed`.
  - Because `site.domain` is immutable (`App.tsx:868`; `analytics.ts:480-530`), developers cannot test tracking in local development or staging environments against their production site configuration.
- **Absence of a "Listening for First Event" Verification Loop:** In `SettingsView`, there is no "Test connection", "Send test event", or "Listening for events..." widget. The user must manually navigate to Overview. On Overview, if 0 events have arrived, it displays:
  *"No visits in this period. We haven't received a pageview in this range. Check your snippet and website domain."* (`App.tsx:1723-1735`). The dashboard does not poll (`setInterval`), so the user must manually reload the page to see if their event registered.

### 3.3 Empty, Error, and Limit States
- **The 1,000 / 2,000 Daily Event Hard Ceiling:**
  - In `migrations/0001_analytics.sql:115-116`, the SQLite `trg_analytics_events_before_insert` trigger enforces:
    ```sql
    WHEN COALESCE((SELECT events FROM daily_usage WHERE ...), 0) >= (SELECT daily_limit FROM sites ...) THEN RAISE(ABORT, 'site_quota_exceeded')
    WHEN COALESCE((SELECT events FROM installation_usage WHERE ...), 0) >= 2000 THEN RAISE(ABORT, 'installation_quota_exceeded')
    ```
  - Default `daily_limit` in `sites` is 1,000 (`0001_analytics.sql:10`).
  - Total installation cap is hardcoded to 2,000 events/day across all sites.
  - When either quota is hit, `apps/worker/analytics.ts:377-380` returns HTTP 429 `{ error: "quota_exceeded" }`.
- **Zero Quota Visibility in UI:**
  - `daily_usage` and `installation_usage` are never queried or returned in any API.
  - The dashboard provides no meter or banner indicating current daily event consumption (e.g., "750 / 1,000 events used today").
  - `PATCH /api/workspaces/:wid/sites/:sid` (`apps/worker/analytics.ts:480-530`) only accepts `name` and `status`. It does **not** allow updating `daily_limit`. An administrator cannot raise their site quota through the UI or API; it requires direct database mutation.
- **Transient Error Banner Handling:** When network errors or 404s occur, child views display inline error panels (`role="alert"`), but often leave the dashboard in a half-rendered state without a clean retry or fallback button.

### 3.4 Report Usefulness & Analytical Capabilities
- **Date Range Picker Artificial Limitation:**
  - In `apps/worker/reports.ts:65-75`, `resolveReportRange` accepts `period=today`, `period=7d`, `period=30d`, `period=90d`, and `period=custom` (with `from` and `to` ISO date strings).
  - In `apps/dashboard/App.tsx:1058,1475-1486`, the UI strictly permits `7d`, `30d`, and `90d`.
  - A founder cannot select "Today", "Yesterday", or any custom date range.
- **Lack of Hourly Resolution for Short Ranges:**
  - In `apps/worker/reports.ts:222`, chart time series are strictly grouped by `e.local_day` (YYYY-MM-DD). Even if `period=today` were enabled in the UI, the chart would display a single bar or dot for the entire day. Hourly bucketing (`strftime('%H', ...)`) is unimplemented.
- **Ghost Data Dimensions (Ingested but Hidden):**
  - **Campaigns (UTM):** `tracker.js:109-118` extracts `utm_source`, `utm_medium`, and `utm_campaign`. `apps/worker/analytics.ts:335` inserts `source.campaign` into `analytics_events.campaign`. However, `apps/worker/reports.ts:232-236` does not include a `dimensionStatement("campaign")`. It is never returned in `AnalyticsReport` (`packages/contracts/index.ts:54-68`), and no Campaign tab or card exists in the dashboard.
  - **Landing Pages (Entry Pages):** `analytics_sessions.entry_page` is tracked for every session (`migrations/0001_analytics.sql:28,125`), but `reports.ts` only queries pageviews by `path`. A marketer cannot see which pages convert best as initial landing pages.
  - **Outbound Link Clicks:** `tracker.js:311-318` automatically tracks clicks on external links and emits `outbound` events. `analytics.ts:133-145` validates them. But `reports.ts:236` queries `WHERE e.type='goal'`. Outbounds are discarded from reporting queries, consuming write quota while providing zero analytical value to the user.

### 3.5 Shareability & Team Access
- **No Shared or Public Dashboards:** In open-source and privacy-friendly analytics tools, public dashboards (e.g. `analytica.example.com/share/mysite`) or unguessable passwordless view tokens are standard for transparency, client reporting, and startup investor updates.
- **Passkey-Only Wall for Viewers:** In `apps/dashboard/AccountView.tsx:430-490`, inviting a viewer creates an invitation token. The invitee must visit the login page, provide the token, and bind a physical WebAuthn authenticator. For non-technical team members or external clients who just want to glance at website traffic, this creates unacceptable friction.

### 3.6 Accessible & Mobile UX
- **Theme Support:** The dashboard is exclusively styled in light mode (`styles.css`). There is no `prefers-color-scheme: dark` media query or theme toggle.
- **Narrow Mobile Devices (<380px):** While responsive layouts down to 390px are tested, table views with many columns (`JourneysView.tsx`, `RevenueView.tsx`) rely on `.table-scroll`. On devices <380px, horizontal scrolling lacks scroll affordances (shadows or sticky column headers), making rightmost actions easy to miss.
- **Screen Reader Polish:** While previous PRs added ARIA progressbar roles to funnels and aria-labels to journey buttons, metric breakdown cards lack `aria-live` announcements when filter chips are applied or cleared.

### 3.7 Self-Host User Experience & Operational Realities
- **The "Deploy to Cloudflare" Button:**
  - The repository contains a deploy button in `README.md`.
  - In `wrangler.jsonc`, the configuration specifies `d1_databases` with binding `DB` and migrations directory `migrations`.
  - However, `wrangler.jsonc:17-23` includes an `EDGE_RATE_LIMIT` binding (`namespace_id: "1001"`). As documented in Cloudflare Workers official documentation, Workers Rate Limiting bindings are restricted to specific paid tiers. Deploying to a clean Cloudflare Free account risks failure if the rate limiting namespace cannot be provisioned.
- **Domain Migration Passkey Lockout:**
  - In `apps/worker/auth.ts:116-135,728-732`, WebAuthn credentials store `rp_id: url.hostname`. Sign-in strictly queries `WHERE p.id=? AND p.rp_id=?`.
  - If a user sets up Analytica on their Workers subdomain (`my-app.workers.dev`), registers an owner passkey, and later configures a custom domain (`analytics.company.com`), their existing passkey stops working. Without recovery codes, they are permanently locked out of their self-hosted instance.

---

## 4. Categorized Evidence Taxonomy

Below, every identified gap and defect is classified according to the required four-part taxonomy, with exact line citations pinned to commit `80be717`:

```
Taxonomy:
[1] Confirmed Source Defect: Code present in repo produces an error, broken state, or fails its own design.
[2] Absent Capability: Feature or contract is completely missing from current source.
[3] Unverified Runtime/Release Evidence: Code exists locally, but remote deployment or live operational stability is unproven.
[4] Optional Feature Idea: Quality-of-life or advanced capability not essential for initial customer viability.
```

| ID | Category | Item Description | Pinned File & Line Evidence (`80be717`) |
| --- | --- | --- | --- |
| **G-01** | **[1] Confirmed Source Defect** | Outbound link events are collected by tracker and stored in D1, but omitted from `reports.ts` queries, making them write-only dead data. | [`public/tracker.js:311-318`](file:///Users/syedmuzamilm/work/mzml/analytica/public/tracker.js#L311-L318), [`apps/worker/analytics.ts:133-145`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/analytics.ts#L133-L145), [`apps/worker/reports.ts:236`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/reports.ts#L236) |
| **G-02** | **[1] Confirmed Source Defect** | Decorative navigation shortcut `<span className="nav-shortcut">G O</span>` is rendered in DOM without any keyboard event listeners. | [`apps/dashboard/App.tsx:1304`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/dashboard/App.tsx#L1304) |
| **G-03** | **[1] Confirmed Source Defect** | Localhost tracking fails completely due to silent tracker deactivation and rigid server-side hostname/origin allowlist rejection. | [`public/tracker.js:18-21`](file:///Users/syedmuzamilm/work/mzml/analytica/public/tracker.js#L18-L21), [`apps/worker/analytics.ts:255-258,295-305`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/analytics.ts#L255-L305) |
| **G-04** | **[1] Confirmed Source Defect** | Site `daily_limit` cannot be viewed or updated via UI or API (`PATCH /sites/:sid` ignores it), stranding sites at 1,000 events/day. | [`apps/worker/analytics.ts:480-530`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/analytics.ts#L480-L530), [`migrations/0001_analytics.sql:10`](file:///Users/syedmuzamilm/work/mzml/analytica/migrations/0001_analytics.sql#L10) |
| **G-05** | **[2] Absent Capability** | Marketing campaign dimensions (UTM campaign, channel) and landing pages (`entry_page`, `exit_page`) are stored in DB but omitted from `AnalyticsReport`. | [`migrations/0001_analytics.sql:22,28-29`](file:///Users/syedmuzamilm/work/mzml/analytica/migrations/0001_analytics.sql#L22-L29), [`apps/worker/reports.ts:232-236`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/reports.ts#L232-L236), [`packages/contracts/index.ts:54-68`](file:///Users/syedmuzamilm/work/mzml/analytica/packages/contracts/index.ts#L54-L68) |
| **G-06** | **[2] Absent Capability** | Dashboard UI lacks "Today", "Yesterday", and Custom Date Range selection, despite Worker backend support in `resolveReportRange`. | [`apps/dashboard/App.tsx:1058,1475-1486`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/dashboard/App.tsx#L1058-L1486), [`apps/worker/reports.ts:65-75`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/reports.ts#L65-L75) |
| **G-07** | **[2] Absent Capability** | First-event installation verification loop is absent; no "listening for first event" state, test beacon trigger, or live onboarding feedback. | [`apps/dashboard/App.tsx:860-940,1723-1735`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/dashboard/App.tsx#L860-L1735) |
| **G-08** | **[2] Absent Capability** | Shareable or public dashboards do not exist; all viewers require WebAuthn device enrollment into the workspace database. | [`apps/dashboard/AccountView.tsx:430-490`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/dashboard/AccountView.tsx#L430-L490), [`apps/worker/auth.ts:230-260`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/auth.ts#L230-L260) |
| **G-09** | **[2] Absent Capability** | No mechanism to delete an empty workspace, leave a workspace, transfer ownership, or delete a user account. | [`apps/worker/auth.ts:980`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/auth.ts#L980), [`apps/dashboard/AccountView.tsx:150-250`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/dashboard/AccountView.tsx#L150-L250) |
| **G-10** | **[3] Unverified Runtime Evidence** | Deploy to Cloudflare button and clean-account setup with D1 binding migrations and Workers Rate Limiting tier compatibility. | [`wrangler.jsonc:17-23`](file:///Users/syedmuzamilm/work/mzml/analytica/wrangler.jsonc#L17-L23), [`README.md:55-65`](file:///Users/syedmuzamilm/work/mzml/analytica/README.md#L55-L65), [`docs/operations/release-status.md:14`](file:///Users/syedmuzamilm/work/mzml/analytica/docs/operations/release-status.md#L14) |
| **G-11** | **[3] Unverified Runtime Evidence** | Hardcoded 2,000 installation-wide daily event quota behavior under continuous traffic. | [`migrations/0001_analytics.sql:116`](file:///Users/syedmuzamilm/work/mzml/analytica/migrations/0001_analytics.sql#L116) |
| **G-12** | **[3] Unverified Runtime Evidence** | Passkey RP ID compatibility during domain transitions from `workers.dev` to custom domain. | [`apps/worker/auth.ts:116-135,728-732`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/auth.ts#L116-L732), [`docs/operations/deployment.md:18-22`](file:///Users/syedmuzamilm/work/mzml/analytica/docs/operations/deployment.md#L18-L22) |
| **G-13** | **[4] Optional Feature Idea** | Hourly time series bucketing for "Today" and single-day reports. | [`apps/worker/reports.ts:222`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/reports.ts#L222) |
| **G-14** | **[4] Optional Feature Idea** | Dark mode theme support (`prefers-color-scheme: dark`). | [`apps/dashboard/styles.css`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/dashboard/styles.css) |
| **G-15** | **[4] Optional Feature Idea** | Additional payment gateway integrations (Stripe, LemonSqueezy, Polar) beyond Dodo. | [`apps/worker/revenue.ts`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/worker/revenue.ts), [`apps/dashboard/RevenueView.tsx`](file:///Users/syedmuzamilm/work/mzml/analytica/apps/dashboard/RevenueView.tsx) |

---

## 5. What NOT to Build Yet (Challenging Overcomplicated Proposals)

Previous provider research and general SaaS advice frequently suggest architectural expansions that are premature or actively harmful for Analytica's current stage. These must be rejected:

1. **DO NOT Introduce ClickHouse, Tinybird, or External Analytical DBs:**
   - *The Claim:* "SQLite/D1 cannot scale to millions of events; switch to ClickHouse."
   - *Why Reject:* Analytica's core value proposition is zero-infrastructure self-hosting on Cloudflare's serverless edge. Introducing ClickHouse requires external cloud subscriptions, API keys, VPC connections, and operational maintenance. D1 with SQLite handles tens of thousands of daily events efficiently when queries are indexed and bounded. Keep D1.
2. **DO NOT Build an LLM / AI "Chat with Your Analytics" Widget:**
   - *The Claim:* "Add an AI assistant in the dashboard to generate natural language traffic summaries."
   - *Why Reject:* This burns Worker CPU, adds Workers AI latency and costs, introduces prompt injection risks over user data, and distracts from core analytical utility. Founders want to see numbers, charts, and referral URLs, not conversational AI summaries.
3. **DO NOT Implement Subscription Billing / Multi-Tenant Stripe SaaS Before Alpha:**
   - *The Claim:* "Build Stripe billing, tiered subscription plans, and self-service customer registration now."
   - *Why Reject:* Commercial multi-tenancy requires customer support workflows, tax handling, email verification, and abuse mitigation. Analytica is not yet validated in a self-hosted alpha. Building billing before product validation is textbook premature optimization.
4. **DO NOT Build Enterprise SSO (SAML / SCIM / Okta):**
   - *The Claim:* "Enterprise teams need SAML/OIDC single sign-on."
   - *Why Reject:* Analytica is built for founders, indie developers, and small agile teams. Passkey-based WebAuthn is modern, phishing-resistant, and requires zero external identity providers.
5. **DO NOT Build Probabilistic Fingerprinting or Cross-Device Identity Stitching:**
   - *The Claim:* "Use canvas/audio fingerprinting or IP heuristics to track returning visitors across devices without cookies."
   - *Why Reject:* This directly violates Analytica's privacy proposition, triggers ePrivacy/GDPR regulatory consent violations, and degrades trust. Cookieless document sessions for aggregate mode and explicit first-party consent for attribution mode are the right, ethical architecture.

---

## 6. Top 5 Priorities for Real Customer Usability

These five priorities address the highest-friction barriers preventing founders from successfully deploying, adopting, and trusting Analytica:

### Priority 1: First-Event Installation Verification & Local/Staging Testing Affordance
- **Customer Impact:** High / Critical. First-time users frequently abandon analytics tools when they install the script and cannot tell if it is working. Fixing the localhost/staging rejection enables developers to test tracking during development before deploying to production.
- **Smallest Coherent Deliverable:**
  1. Add a "Verify Installation" card in `SettingsView` that polls `/api/workspaces/:wid/sites/:sid/report?period=today` every 3 seconds for 60 seconds with an active "Listening for first pageview..." animation.
  2. Allow `localhost` and staging subdomains in `apps/worker/analytics.ts:hostnameAllowed` when an optional query/header development flag is present, or support an explicit `allowed_origins` site setting.
  3. Include diagnostic console warnings in `tracker.js` when running on `localhost` or unapproved domains.
- **Dependencies:** None. Self-contained across `tracker.js`, `analytics.ts`, and `SettingsView`.
- **Acceptance Evidence:** A developer running a local test site on `localhost:3000` sees events immediately accepted and acknowledged in the dashboard's "Listening for first event" widget without manual page refreshes.
- **Phase Placement:** **Customer Alpha (Immediate)**.

### Priority 2: Expose Ingested Marketing Dimensions (Campaigns, Landing Pages, Outbound Events)
- **Customer Impact:** Very High. Founders need to know which launch campaigns, ads, or social posts convert, where visitors land, and what external links they click.
- **Smallest Coherent Deliverable:**
  1. Update `apps/worker/reports.ts` to include `dimensionStatement("campaign")` and `dimensionStatement("name", "outbound")`.
  2. Query top `entry_page` from `analytics_sessions` in `reports.ts`.
  3. Add `campaigns: BreakdownRow[]` and `outbounds: BreakdownRow[]` to `AnalyticsReport` in `contracts/index.ts`.
  4. Render "Campaigns" and "Landing Pages" cards in `AcquisitionView` (`apps/dashboard/App.tsx`).
- **Dependencies:** None. Schema columns already exist in `analytics_events` and `analytics_sessions`.
- **Acceptance Evidence:** Triggering a pageview with `?utm_campaign=producthunt` and clicking an outbound link renders "producthunt" in the Acquisition tab and the external link in an Outbound Links table.
- **Phase Placement:** **Customer Alpha (Immediate)**.

### Priority 3: Expose "Today", "Yesterday", and Custom Date Ranges in the Dashboard UI
- **Customer Impact:** High. Founders checking launch-day performance cannot wait for rolling 7-day averages.
- **Smallest Coherent Deliverable:**
  1. Expand the date range select in `apps/dashboard/App.tsx:1475` to offer "Today", "Yesterday", "Last 7 days", "Last 30 days", and "Last 90 days".
  2. Add simple start/end date inputs when "Custom range" is chosen.
  3. Wire the selected period into the existing backend `resolveReportRange` handler.
- **Dependencies:** Worker backend already implements `today` and `custom` range parsing in `apps/worker/reports.ts`.
- **Acceptance Evidence:** Selecting "Today" requests `/report?period=today` and renders only events from the current site-local date.
- **Phase Placement:** **Customer Alpha (Immediate)**.

### Priority 4: Quota Visibility & Configurable Site/Installation Caps
- **Customer Impact:** High. Prevents sudden, unexplained event loss when a site hits the default 1,000-event ceiling.
- **Smallest Coherent Deliverable:**
  1. Include `dailyUsage: number` and `dailyLimit: number` in the site metadata returned by `GET /api/workspaces/:wid/sites`.
  2. Allow workspace admins to update `daily_limit` (up to an installation ceiling) in `PATCH /api/workspaces/:wid/sites/:sid`.
  3. Display a progress meter or warning badge in `SettingsView` when approaching 80% of daily quota.
  4. Move the hardcoded `2000` installation limit in `migrations/0001_analytics.sql` to a configurable setting or raise it for paid D1 databases.
- **Dependencies:** Forward migration modifying trigger `trg_analytics_events_before_insert`.
- **Acceptance Evidence:** An administrator can increase a site's daily limit to 10,000 in `SettingsView`, and the dashboard displays current daily events consumed.
- **Phase Placement:** **Public v1 (Preparation)**.

### Priority 5: Frictionless Read-Only Dashboard Sharing (Public / Shared Token Links)
- **Customer Impact:** Medium / High for acquisition and viral product adoption. Enables founders to share live traction without creating accounts.
- **Smallest Coherent Deliverable:**
  1. Add a `share_token` column to `sites` table.
  2. Add an unauthenticated read-only endpoint `GET /v1/share/:token/report` scoped strictly to that site's public report.
  3. Add a "Public Dashboard" toggle in `SettingsView` that generates a shareable URL (`/share/site_token`).
- **Dependencies:** Scope checks ensuring workspace or account APIs cannot be accessed via share token.
- **Acceptance Evidence:** Opening `/share/<token>` in an incognito window renders the site's Overview report without prompting for WebAuthn authentication.
- **Phase Placement:** **Public v1**.

---

## 7. Recommended Compact Next Milestone: "Customer Alpha"

Before attempting broader public launch or commercial multi-tenancy, Analytica should execute a compact, highly focused **Customer Alpha** milestone aimed at supporting 10 to 20 friendly startup deployments.

### Milestone Scope: Customer Alpha Deliverables
1. **Developer Verification & Onboarding:**
   - Live "Listening for first event..." feedback loop on site creation.
   - Developer documentation and clear error logs for `localhost` testing.
   - Remove fake `<span className="nav-shortcut">G O</span>` UI pretense.
2. **Core Acquisition Reporting:**
   - Expose UTM campaigns and landing pages in the Acquisition view.
   - Fix the write-only outbound link click defect so outbounds are visible.
   - Enable "Today" and "Yesterday" date range presets in the dashboard header.
3. **Quota Transparency:**
   - Expose daily event usage on Website Settings.
   - Ensure the user understands the 1,000/day alpha ceiling.
4. **Platform & Operational Verification:**
   - Execute the real-account guided Cloudflare deploy test to confirm D1 binding and rate limiting compatibility.
   - Conduct a documented passkey domain transition drill from `.workers.dev` to a custom domain.

### What Stays Out of Customer Alpha
- Public customer registration and subscription billing.
- Additional payment providers beyond Dodo.
- Dark mode theme toggle.
- Complex cohort retention tables.
- Mobile native apps or email report digests.

---

## 8. Summary for Parent Agent

- **Report Location:** `docs/research/product-gaps-antigravity.md` created as requested.
- **Baseline Pin:** All file and line citations are pinned to commit `80be717`.
- **Key Insight:** Analytica's core serverless engine and security architecture are exceptionally solid. The primary gaps are not algorithmic or cryptographic; they are **developer activation** (first-event feedback and local testing), **marketing visibility** (UTM campaigns, landing pages, outbounds), **timeframe flexibility** (Today/Yesterday UI), and **quota transparency** (1,000/day hard trigger ceiling).
- **Recommendation:** Adopt the compact "Customer Alpha" scope to make the product immediately useful to real founders before considering broader commercial features.
