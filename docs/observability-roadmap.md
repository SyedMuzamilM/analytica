# Analytica observability direction

The observability area should feel like the same product as the analytics report: quiet surfaces, dense but readable tables, crimson for action and failure, teal for healthy state, and a clear explanation beside every number.

The first UI pass is available in the demo workspace. Open `/demo` and choose one of the new Observability navigation items:

- `/demo?view=logs` — structured live log stream with search, severity, service, region, export, saved query, and event volume.
- `/demo?view=traces` — trace search, slow-trace list, and a request waterfall with span timing and request metadata.
- `/demo?view=metrics` — query builder, key health numbers, time-series chart, route table, and the path from a query to an alert or dashboard.
- `/demo?view=alerts` — active alert summary, owned alert rows, alert activity, and notification setup.
- `/demo?view=services` — dependency map plus service inventory with health, latency, errors, and traffic.

These screens use deterministic sample data so the information architecture can be reviewed before ingestion and storage are wired in.

## AegisLog connection

In a real project, create an **AegisLog ingestion** server key from Website settings and keep it in the backend's secret manager. The key is scoped to one Analytica project and is only shown once.

```ts
import { createLogger } from "aegislog";
import { HttpBatchSink } from "@aegislog/transports";

const logger = createLogger({
  sinks: [
    new HttpBatchSink({
      url: `${ANALYTICA_ORIGIN}/v1/observability/ingest`,
      headers: {
        Authorization: `Bearer ${process.env.ANALYTICA_AEGISLOG_KEY}`,
      },
    }),
  ],
  gracefulShutdown: true,
});
```

For request waterfalls, configure AegisLog profiling to export OTLP traces to the trace endpoint shown in Website settings. The current ingestion path accepts OTLP `resourceSpans`, keeps service and timing attributes, and scrubs arbitrary span attributes before storage.

The dashboard and ingest API live in this same Cloudflare Worker project. The browser code is under `apps/dashboard`; authenticated project reads and unauthenticated server-to-server ingestion are under `apps/worker`; D1 stores the normalized records. A separate backend deployment is only needed for an application that emits AegisLog events. The application sends telemetry to Analytica over HTTPS, and the Analytica Worker serves the UI and the storage API.

## What each page should do

### Logs

Logs are the fastest way to answer “what happened?” The working view should support full-text search, structured attribute filters, severity, service, environment, region, release, trace ID, and time range. Selecting a row should open a detail drawer with the complete JSON payload, related trace, request ID, deployment, and copy/export actions.

The first backend slice needs a normalized event envelope:

```ts
type LogEvent = {
  id: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  environment: string;
  message: string;
  attributes: Record<string, string | number | boolean | null>;
  traceId?: string;
  spanId?: string;
  release?: string;
};
```

### Traces and waterfall

Traces answer “where did this request spend time?” The waterfall should preserve parent/child nesting, show gaps between spans, highlight the slowest span, and let a user jump from a span to its logs and metrics. A trace detail view should include status, route, user or session context where consent permits it, region, release, and the exact error cause.

The minimum instrumentation contract is W3C trace context at ingress, propagation through Workers and queues, and a span model with start time, duration, status, attributes, and parent span ID.

### Metrics

Metrics answer “is this getting better or worse?” Keep the query builder close to the chart. A useful first release supports counters, rates, p50/p95/p99 latency, error rate, grouping by route/service/region, saved queries, dashboard pins, and a “turn into alert” action.

The page should always show the selected aggregation and time range in plain language. Users should not have to infer whether a number is a count, rate, percentile, or sampled estimate.

### Alerts

Alerts answer “what requires a response?” Every firing alert should show the rule, observed value, threshold, duration, owner, acknowledgement state, and a link to the related logs/traces. Add a short incident timeline so a user can see when an alert fired, was acknowledged, changed, and resolved.

Start with email and webhook delivery. Add Slack, Microsoft Teams, and PagerDuty once the rule and ownership model are stable. Keep alert evaluation idempotent and deduplicate repeated events into one incident.

### Service map

The service map answers “what depends on what?” It should be driven by observed traffic rather than a manually maintained diagram. Each node needs request rate, latency, error rate, and current health. Clicking a node should open its metrics, recent traces, logs, deployments, and SLOs.

## High-value additions after the first pass

1. **SLOs and error budgets** — define availability, latency, and freshness objectives; show burn rate and remaining budget next to alerts.
2. **Deployments and releases** — correlate a spike with a release, compare two releases, and add deploy markers to charts.
3. **Dashboards** — let teams pin saved metrics, log queries, trace panels, and service health into a shared board.
4. **Incident workspace** — timeline, owner, notes, related alerts, and a post-incident summary with links to evidence.
5. **Synthetic checks** — scheduled HTTP checks for the critical customer paths; show uptime and latency by region.
6. **Queue and job health** — depth, age of oldest item, retries, dead letters, and consumer lag.
7. **Database and storage signals** — connection saturation, query latency, D1/R2 operation errors, and storage growth.
8. **Usage and retention controls** — ingestion volume, sampling, retention per source, export, and a clear cost/limit view.
9. **Access and audit trail** — workspace roles, query sharing, alert ownership, and an audit log for configuration changes.
10. **Privacy controls** — field redaction, PII detection, retention policies, consent-aware user context, and an obvious “why is this data here?” explanation.

## Suggested delivery order

**Phase 1 — Find the signal:** logs, traces, metrics, service detail, and basic search/filtering.

**Phase 2 — Act on the signal:** alerts, ownership, notifications, saved queries, dashboards, and release markers.

**Phase 3 — Operate the system:** SLOs, error budgets, incident workspace, synthetic checks, queue/database views, and usage controls.

The product should keep its current analytics model separate from raw observability data. Analytics can remain privacy-first and aggregate, while logs and traces use explicit retention, redaction, sampling, and role controls. That separation will make the trust story easier to explain and keeps high-volume telemetry from changing the meaning of the existing reports.
