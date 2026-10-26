# Atomic collection and report decisions

Implemented 26 October 2026. Original SQL and TypeScript, rather than a Minilytics code adaptation.

## Transaction boundary

`migrations/0001_analytics.sql` stores an event receipt keyed by workspace, site and logical event ID. A SHA-256 digest covers the canonical validated client envelope. Equal-ID/equal-content delivery returns duplicate success. Changed content conflicts.

A `BEFORE INSERT` trigger checks the authoritative site status, immutable privacy/timezone configuration, per-site and installation UTC-day quotas, and session ownership/inactivity. Existing equal receipts bypass quota/session checks. An `AFTER INSERT` trigger creates a session only for an interaction and updates its counters, usage and dirty summary bucket. `ON CONFLICT DO NOTHING` does not run the acceptance trigger for a duplicate. A trigger error aborts the complete statement and every derived mutation.

This was exercised with the actual Workers Vitest integration and D1, not a mocked SQL adapter. Fifteen tests cover eight concurrent deliveries, changed-content replay, concurrent quota exhaustion, spoofed visitor/session mapping, a later trigger deliberately aborting an event, cross-workspace/viewer denial, membership revocation, midnight-spanning reports, summary replay/expiry, DST boundaries and rejection after deletion begins. These local tests prove the exercised SQL behavior; they do not establish global production capacity or resistance to deliberate resource-exhaustion attacks.

## Conservative initial limits

New sites allow 1,000 accepted event envelopes per UTC day. The installation allows 2,000 total envelopes per day. Engagement updates count as events and retain receipts for idempotency. Duplicate deliveries do not charge quota. These limits are deliberately conservative and currently require an operator migration to change; a browser request cannot raise them.

Local workerd D1 `meta.rows_written`, with an existing daily/summary bucket, measured:

| Event case | Indexed rows written |
| --- | --- |
| First event in a new session | 12 |
| Subsequent pageview | 9 |
| Engagement receipt | 9 |

The first bucket can add more writes. Auth, reporting reads, summaries, cleanup deletes and other resources share the installation/account allowance. The previous research estimate of a cheap one-row engagement ping does not describe this implementation. These numbers are measurements of local D1 emulation; remote billing/CPU/storage evidence is still needed before promising a free supported capacity. A quota-rejected request still performs reads, so the quota is not a complete denial-of-service defense. Deployment-level throttling remains necessary for public service.

## Metrics and ordering

Pageviews and goals count retained events inside the selected time interval. Sessions count only sessions that started inside the interval and contain a matching selected event. A midnight-spanning session does not inflate the next day's session count. Distinct IDs are available only in attribution mode. Aggregate-mode visitors are `null`, and the report explains full-navigation identity loss.

The collector fixes source attribution when a session first appears, and freezes its start and entry path. Subsequent paths update the exit only in event-time order, with client sequence breaking timestamp ties. Engagement never renews the interaction clock or creates a session. After 30 minutes without a tracked interaction, the server rejects the old session with `resetSession: true`; the tracker rotates it. Ambiguous late events older than their established session start are explicitly rejected rather than changing historical entry attribution.

Client time is bounded to 24 hours late and five minutes ahead. Receipts remain for 90 days. This deduplication window does not promise permanent protection from an attacker creating a new logical event ID or timestamp. Public telemetry is not trusted purchase identity.

IANA date boundaries are found separately for each date, not through a single range-end offset. Tests cover a 23-hour spring-forward day, a 25-hour fall-back day and Kolkata's half-hour offset. Date formatter instances are bounded and reused within an isolate. A previous comparison that begins before retained detail carries an explicit incomplete-comparison warning.

## Summaries, retention and deletion

Accepted events mark a site-local date/timezone bucket dirty. Maintenance waits until local day end plus the 24-hour lateness allowance before finalizing it, avoiding repeated full-day write amplification while live reports use raw events. A maintenance transaction replaces that finalized bucket's additive totals and independent source/page/country/event dimensions, then clears its checkpoint. Retried maintenance produces the same result; a newly accepted event marks the bucket dirty again. Exact distinct visitors are never summed from daily values.

Scheduled work rebuilds at most two buckets, purges at most 250 expired events and 250 sessions, and performs bounded site cleanup per invocation. Detail is deleted only after the relevant summary is clean. Retention keeps additive summaries for 396 days. The current report API intentionally exposes at most 90 days of retained detail; older summaries are retained for future additive reporting and must not be represented as an existing long-range UI feature.

DELETE first commits a `deleting` site state. The collector's trigger rejects new receipts even if request code fetched an earlier enabled state. Reporting hides deleting sites. Cleanup removes owned analytics tables in batches and keeps a tiny site tombstone while other domain cleanup can finish. Parent revenue cleanup must cover money/key/integration tables separately. No foreign key may make retention delete a financial ledger.

## Remaining release gates

- Remote Free/Paid CPU for reporting, collection and scheduled work, actual D1 billing metadata and retained/indexed storage at the admitted 90-day ceiling.
- A documented edge rate-limit profile and noisy-tenant/load measurements. The D1 quota cannot stop adversarial read costs by itself.
- A restore/deletion journal and operator recovery drill before external customer data is admitted.
- Identity erasure across revenue records and any future visitor attributes, with summaries reconciled according to the privacy policy.
- Path redaction is a bounded heuristic for emails, UUIDs and long numeric IDs. Sites with other sensitive path formats must use the tracker's full `data-redact-path` option. No generic URL scrubber can classify all personal text.
