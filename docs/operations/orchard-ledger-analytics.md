# Connect Orchard Ledger to Analytica

The product dashboard is https://analytica.mzml.dev. The collector endpoint is https://analytica.mzml.dev/v1/collect. Use the custom domain for application events; the workers.dev URL redirects browsers to the product domain and rejects unauthenticated writes.

## Test Analytica first

1. Open `/signup`, create a passkey, and save the recovery codes. Use a test name and a workspace such as “Analytica sandbox”.
2. Add a project named “Orchard Ledger Desktop Test”. Select aggregate privacy mode and set the domain to `desktop.orchardledger.mzml.dev`. This is a collection label under your domain; it does not require a website or DNS record at that hostname.
3. Open the project's settings and copy its public project ID. Save it with the collector endpoint and the exact project domain.
4. Send one app open and visit two screens using the configured desktop build below. Check Overview, Pages and Events. Retrying an event should keep the same event ID and count once.
5. Add another project and confirm switching projects shows separate data. Try a logo upload and a data export. Use separate workspaces for teams that must not share access.
6. In Orchard Ledger, turn off usage analytics. New views must stop producing events. Close and reopen the app and verify that the opt-out persists.
7. Delete the test project in Project settings, or delete your test account in Workspace & account. Account deletion asks you to type DELETE and verify your passkey. Access is removed immediately; owned projects stop collection and are cleaned up in bounded background jobs.

The current cleanup schedule runs every 15 minutes. Large projects can take more than one pass. Another account's data is unaffected. An account's sole-owner workspaces are deleted; a workspace with another owner remains with that owner. Opaque site deletion journal entries remain for restore suppression, and provider recovery snapshots expire under the provider's retention policy.

## Configure the desktop application

The existing Orchard Ledger implementation is described in `/Users/syedmuzamilm/work/mzml/cropup/docs/analytics.md` and desktop PR https://github.com/mzml-dev/orchard-ledger/pull/4, which was reported as stacked on PR #3 in the referenced development thread. Check their current merge/release state before shipping a configured build.

Configure these public values in the build environment:

```sh
export ORCHARD_ANALYTICS_ENDPOINT=https://analytica.mzml.dev/v1/collect
export ORCHARD_ANALYTICS_SITE_ID=YOUR_DESKTOP_PROJECT_ID
export ORCHARD_ANALYTICS_HOSTNAME=desktop.orchardledger.mzml.dev
bun run build
bun run tauri build
```

Runtime environment values override compiled values for operator testing. No server API key, Cloudflare token, report credential or passkey secret belongs in the desktop application.

In a disposable Orchard installation, open Settings → Application → Share usage analytics. New installations default to off. The integration sends an `app_opened` goal and fixed screen pageviews such as `parties`, `goods-receipts`, `sales`, `payments`, `vouchers`, `reports` and `settings`. Paths identify the desktop OS, app version and fixed screen. It excludes customer details, ledger documents, amounts, searches, credentials and backups. Consent and retries are owned by the native collector.

Use the custom-domain endpoint directly: Orchard's client deliberately rejects redirects, endpoint query strings and fragments. The public project hostname must exactly match the project's configured domain.

## Keep products and environments separate

Create these projects as you need them, under your real account after testing:

| Project                | Configuration                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Orchard Ledger website | Actual marketing hostname; use the browser tracker snippet.                                        |
| Orchard Ledger desktop | Dedicated aggregate project; use the three ORCHARD_ANALYTICS variables.                            |
| Orchard Ledger mobile  | Dedicated project and opt-in native collector; the desktop PR does not implement mobile telemetry. |
| Other products         | Separate project IDs, hostnames and backend credentials.                                           |
| Test/staging builds    | Separate test project IDs so test events do not enter production reports.                          |

Analytica stores product usage events and optional verified product-payment analytics. Orchard's sync service continues to store its ledger data. Do not forward accounting records or sync payloads to the analytics collector. If you later measure Orchard subscription purchases, integrate the billing backend with the project's scoped server keys and payment API; keep those credentials on the backend.

## Deployment boundaries

This deployment has direct passkey signup, project administration, scoped reports, private R2 project logos, account deletion, browser tracking and a native collector endpoint. It does not establish unrestricted capacity. Default admission limits remain 1,000 event envelopes per project/day and 2,000 per installation/day, including engagement receipts. Remote mixed-load and restore drills remain release checks before broad customer onboarding.
