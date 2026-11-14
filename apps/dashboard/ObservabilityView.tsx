import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  Clock3,
  Cloud,
  Database,
  GitBranch,
  Globe2,
  Info,
  Layers3,
  ListFilter,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Terminal,
  TimerReset,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { Site } from "../../packages/contracts";
import { api } from "./api";

export type ObservabilityKind =
  "logs" | "traces" | "metrics" | "alerts" | "services";

type Props = {
  kind: ObservabilityKind;
  site: Site;
  workspaceId: string;
  demo: boolean;
  notify: (message: string) => void;
};

type LiveLog = {
  id: string;
  timestamp: number;
  level: string;
  message: string;
  service?: string | null;
  namespace?: string | null;
  region?: string | null;
  traceId?: string | null;
  requestId?: string | null;
  meta?: Record<string, unknown>;
  error?: Record<string, unknown>;
  raw?: unknown;
};

type LiveTrace = {
  traceId: string;
  spans: Array<{
    spanId: string;
    parentSpanId?: string | null;
    name: string;
    service?: string | null;
    durationMs: number;
    status: string;
    start: number;
    attributes?: Record<string, unknown>;
  }>;
};

type LiveService = {
  service: string;
  logs: number;
  errors: number;
  last_seen: number;
};

type LiveOverview = {
  logs: number;
  traces: number;
  audit: number;
  levels: Array<{ level: string; count: number }>;
  services: Array<{ service: string; count: number }>;
};

type LiveAlert = {
  id: string;
  name: string;
  service?: string;
  state: string;
  value?: number | null;
  started_at: number;
  owner_user_id?: string | null;
};

const logs = [
  {
    time: "10:42:18.721",
    level: "error",
    service: "checkout-api",
    message: "Payment provider timed out after 3 retries",
    detail: "POST /v1/checkout/confirm · request_id=req_8f20d2",
    region: "iad1",
  },
  {
    time: "10:42:18.699",
    level: "warn",
    service: "checkout-api",
    message: "Retrying payment intent request",
    detail: "attempt=3 · provider=stripe · amount=12900",
    region: "iad1",
  },
  {
    time: "10:42:17.210",
    level: "info",
    service: "edge-gateway",
    message: "Request completed with 200",
    detail: "GET /pricing · duration=82ms · cache=HIT",
    region: "fra1",
  },
  {
    time: "10:42:16.983",
    level: "info",
    service: "accounts-worker",
    message: "Session refreshed",
    detail: "user=usr_29a8 · auth=passkey · duration=41ms",
    region: "sin1",
  },
  {
    time: "10:42:15.445",
    level: "debug",
    service: "web",
    message: "Navigation event captured",
    detail: "path=/checkout · referrer=/pricing · viewport=1440x900",
    region: "lhr1",
  },
  {
    time: "10:42:14.882",
    level: "info",
    service: "analytics-ingest",
    message: "Batch acknowledged",
    detail: "events=42 · partition=events-03 · lag=1.2s",
    region: "iad1",
  },
];

const services = [
  {
    name: "web",
    type: "Edge application",
    health: "Healthy",
    latency: "86ms",
    error: "0.08%",
    traffic: "4.8k rpm",
    color: "teal",
  },
  {
    name: "checkout-api",
    type: "Worker",
    health: "Degraded",
    latency: "420ms",
    error: "2.4%",
    traffic: "1.1k rpm",
    color: "red",
  },
  {
    name: "accounts-worker",
    type: "Worker",
    health: "Healthy",
    latency: "112ms",
    error: "0.14%",
    traffic: "680 rpm",
    color: "teal",
  },
  {
    name: "analytics-ingest",
    type: "Queue consumer",
    health: "Healthy",
    latency: "1.2s",
    error: "0.02%",
    traffic: "12.6k rpm",
    color: "teal",
  },
  {
    name: "postgres",
    type: "Database",
    health: "Healthy",
    latency: "19ms",
    error: "0.00%",
    traffic: "8.3k rpm",
    color: "teal",
  },
];

function SeverityIcon({ level }: { level: string }) {
  if (level === "error") return <TriangleAlert size={15} />;
  if (level === "warn") return <AlertTriangle size={15} />;
  if (level === "debug") return <Terminal size={15} />;
  return <Info size={15} />;
}

function SelectPill({ children }: { children: ReactNode }) {
  return (
    <button className="obs-select">
      {children}
      <ChevronDown size={14} />
    </button>
  );
}

function PageIntro({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Activity;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="obs-intro">
      <div className="obs-intro-icon">
        <Icon size={21} />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action && <div className="obs-intro-action">{action}</div>}
    </div>
  );
}

function LogsView({
  notify,
  liveLogs,
  demo,
}: {
  notify: Props["notify"];
  liveLogs?: LiveLog[];
  demo: boolean;
}) {
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const entries =
    !demo && liveLogs !== undefined
      ? liveLogs.map((entry) => ({
          time: new Date(entry.timestamp).toLocaleTimeString("en", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          level: entry.level,
          service: entry.service || entry.namespace || "unknown",
          message: entry.message,
          detail:
            [
              entry.requestId ? `request_id=${entry.requestId}` : "",
              entry.traceId ? `trace_id=${entry.traceId}` : "",
              entry.error?.name ? `error=${entry.error.name}` : "",
            ]
              .filter(Boolean)
              .join(" · ") || "Structured AegisLog event",
          region: entry.region || "—",
          raw: entry.raw || entry,
        }))
      : logs.map((entry) => ({ ...entry, raw: entry }));
  const [selectedDetail, setSelectedDetail] = useState<unknown>(null);
  const filtered = useMemo(
    () =>
      entries.filter((entry) =>
        `${entry.service} ${entry.message} ${entry.detail}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [entries, query],
  );
  return (
    <div className="obs-page">
      <PageIntro
        icon={Terminal}
        title="Logs"
        description="Search every application event in one fast, structured stream."
        action={
          <button
            className="button secondary small"
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? "Resume stream" : "Pause stream"}
          </button>
        }
      />
      <section className="obs-query-bar" aria-label="Log filters">
        <div className="obs-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search logs, services, request IDs…"
          />
        </div>
        <SelectPill>
          <span className="status-dot status-red" /> Errors & warnings
        </SelectPill>
        <SelectPill>
          <Server size={14} /> All services
        </SelectPill>
        <SelectPill>
          <Globe2 size={14} /> All regions
        </SelectPill>
        <button
          className="icon-button"
          aria-label="More log filters"
          onClick={() =>
            notify(
              "Add filters for trace ID, host, release, and custom attributes.",
            )
          }
        >
          <ListFilter size={17} />
        </button>
      </section>
      <div className="obs-subbar">
        <span>
          <strong>{filtered.length}</strong> events{" "}
          {liveLogs?.length
            ? "from the connected AegisLog stream"
            : "in the last 15 minutes"}
        </span>
        <span className="obs-live">
          <span className="live-dot" />{" "}
          {paused
            ? "Stream paused"
            : liveLogs?.length
              ? "Live data connected"
              : "Listening for new events"}
        </span>
      </div>
      <section className="obs-panel obs-log-panel">
        <div className="obs-panel-heading">
          <div>
            <h3>Live event stream</h3>
            <p>Newest events appear at the top.</p>
          </div>
          <button
            className="button secondary small"
            onClick={() =>
              notify("Log export prepared for the current filters.")
            }
          >
            <ArrowDownRight size={14} /> Export
          </button>
        </div>
        <div className="obs-log-list">
          {filtered.map((entry) => (
            <button
              className="obs-log-row"
              key={`${entry.time}-${entry.service}`}
              onClick={() => {
                setSelectedDetail(entry.raw);
                notify(`${entry.service}: ${entry.detail}`);
              }}
            >
              <time>{entry.time}</time>
              <span className={`obs-level obs-level-${entry.level}`}>
                <SeverityIcon level={entry.level} />
                {entry.level}
              </span>
              <span className="obs-service">{entry.service}</span>
              <span className="obs-log-copy">
                <strong>{entry.message}</strong>
                <small>{entry.detail}</small>
              </span>
              <span className="obs-region">{entry.region}</span>
              <MoreHorizontal size={16} className="obs-row-more" />
            </button>
          ))}
        </div>
        {selectedDetail !== null && (
          <div className="obs-log-detail">
            <div className="obs-panel-heading">
              <div>
                <h3>Selected event payload</h3>
                <p>Redacted structured data received from AegisLog.</p>
              </div>
              <button
                className="text-button"
                onClick={() => setSelectedDetail(null)}
              >
                Close
              </button>
            </div>
            <pre>
              <code>{JSON.stringify(selectedDetail, null, 2)}</code>
            </pre>
          </div>
        )}
      </section>
      {demo ? (
        <div className="obs-bottom-grid">
          <section className="obs-panel obs-code-panel">
            <div className="obs-panel-heading">
              <div>
                <h3>Saved query</h3>
                <p>Checkout failures · shared with your team</p>
              </div>
              <button
                className="icon-button"
                aria-label="More saved query actions"
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
            <pre>
              <code>{`service:checkout-api AND level:error\n| json\n| line_format "{{.message}}"`}</code>
            </pre>
            <div className="obs-code-footer">
              <span>Updated 8 minutes ago</span>
              <button
                className="text-button"
                onClick={() => notify("Saved query copied to your clipboard.")}
              >
                Copy query
              </button>
            </div>
          </section>
          <section className="obs-panel obs-mini-chart">
            <div className="obs-panel-heading">
              <div>
                <h3>Events by severity</h3>
                <p>Last 60 minutes</p>
              </div>
              <button className="text-button">
                View chart <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="obs-bars">
              <span style={{ height: "18%" }} />
              <span style={{ height: "29%" }} />
              <span style={{ height: "21%" }} />
              <span style={{ height: "44%" }} />
              <span style={{ height: "36%" }} />
              <span className="bar-alert" style={{ height: "84%" }} />
              <span style={{ height: "31%" }} />
              <span style={{ height: "55%" }} />
              <span style={{ height: "40%" }} />
              <span style={{ height: "68%" }} />
            </div>
            <div className="obs-legend">
              <span>
                <i className="legend-blue" /> info 18.4k
              </span>
              <span>
                <i className="legend-red" /> error 246
              </span>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function TracesView({
  notify,
  liveTraces,
  demo,
}: {
  notify: Props["notify"];
  liveTraces?: LiveTrace[];
  demo: boolean;
}) {
  const [selectedTrace, setSelectedTrace] = useState(0);
  const connectedTrace = liveTraces?.[selectedTrace];
  return (
    <div className="obs-page">
      <PageIntro
        icon={GitBranch}
        title="Traces"
        description="Follow a request across every service, queue, and database call."
        action={
          <button
            className="button secondary small"
            onClick={() =>
              notify("Trace search can be shared once a backend is connected.")
            }
          >
            <ArrowUpRight size={14} /> Share view
          </button>
        }
      />
      <section className="obs-query-bar">
        <div className="obs-search">
          <Search size={16} />
          <input placeholder="Search by trace ID, route, or user…" />
        </div>
        <SelectPill>
          <Server size={14} /> All services
        </SelectPill>
        <SelectPill>
          <Clock3 size={14} /> P95 &gt; 500ms
        </SelectPill>
        <SelectPill>
          <TimerReset size={14} /> Last 15 minutes
        </SelectPill>
      </section>
      {liveTraces?.length ? (
        <section className="obs-panel live-trace-panel">
          <div className="obs-panel-heading">
            <div>
              <h3>Connected AegisLog traces</h3>
              <p>
                {liveTraces.length} traces loaded from the OTLP trace endpoint.
              </p>
            </div>
            <span className="small-pill">
              {connectedTrace?.spans.length || 0} spans selected
            </span>
          </div>
          <div className="live-trace-grid">
            <div className="live-trace-list">
              {liveTraces.map((trace, index) => (
                <button
                  className={`obs-trace-item ${index === selectedTrace ? "selected" : ""}`}
                  key={trace.traceId}
                  onClick={() => setSelectedTrace(index)}
                >
                  <span className="trace-state" />
                  <span className="trace-item-main">
                    <strong>{trace.traceId}</strong>
                    <small>
                      {trace.spans.length} spans ·{" "}
                      {trace.spans[0]?.service || "unknown service"}
                    </small>
                  </span>
                  <span className="trace-duration">
                    {Math.round(
                      trace.spans.reduce(
                        (sum, span) =>
                          Math.max(sum, span.start + span.durationMs),
                        0,
                      ) - Math.min(...trace.spans.map((span) => span.start)),
                    )}
                    ms
                  </span>
                </button>
              ))}
            </div>
            <div className="live-trace-detail">
              <div className="live-trace-detail-heading">
                <strong>{connectedTrace?.traceId}</strong>
                <span>Span attributes are redacted at ingestion.</span>
              </div>
              {connectedTrace?.spans.map((span) => (
                <div className="live-span-row" key={span.spanId}>
                  <span
                    className={`trace-state trace-state-${span.status === "error" ? "error" : "ok"}`}
                  />
                  <span>
                    <strong>{span.name}</strong>
                    <small>
                      {span.service || "unknown"} · {span.spanId}
                    </small>
                  </span>
                  <b>{Math.round(span.durationMs)}ms</b>
                  <code>{JSON.stringify(span.attributes || {})}</code>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      {demo ? (
        <div className="obs-trace-layout">
          <section className="obs-panel obs-trace-list">
            <div className="obs-panel-heading">
              <div>
                <h3>Slow traces</h3>
                <p>Sorted by total duration</p>
              </div>
              <span className="small-pill">38 traces</span>
            </div>
            {[
              [
                "trace_7d91e",
                "POST /v1/checkout/confirm",
                "2.84s",
                "checkout-api",
                "2m ago",
                "error",
              ],
              [
                "trace_2ac40",
                "GET /v1/account",
                "1.42s",
                "accounts-worker",
                "4m ago",
                "warn",
              ],
              [
                "trace_09bf2",
                "POST /v1/events",
                "804ms",
                "analytics-ingest",
                "6m ago",
                "ok",
              ],
              [
                "trace_17d3b",
                "GET /pricing",
                "644ms",
                "edge-gateway",
                "8m ago",
                "ok",
              ],
            ].map(([id, route, duration, service, time, state], index) => (
              <button
                className={`obs-trace-item ${index === 0 ? "selected" : ""}`}
                key={id}
                onClick={() => notify(`Opened ${id}`)}
              >
                <span className={`trace-state trace-state-${state}`} />{" "}
                <span className="trace-item-main">
                  <strong>{route}</strong>
                  <small>
                    {service} · {time}
                  </small>
                </span>
                <span className="trace-duration">{duration}</span>
              </button>
            ))}
          </section>
          <section className="obs-panel obs-waterfall">
            <div className="obs-panel-heading">
              <div>
                <h3>trace_7d91e</h3>
                <p>POST /v1/checkout/confirm · 2.84s · 14 spans</p>
              </div>
              <button
                className="button secondary small"
                onClick={() => notify("Trace JSON copied to your clipboard.")}
              >
                Copy trace ID
              </button>
            </div>
            <div className="waterfall-scale">
              <span>0 ms</span>
              <span>500 ms</span>
              <span>1 s</span>
              <span>1.5 s</span>
              <span>2 s</span>
              <span>2.8 s</span>
            </div>
            <div className="waterfall-rows">
              {[
                ["edge-gateway", "82ms", "0ms", "3%", "teal"],
                ["checkout-api", "2.84s", "5ms", "96%", "red"],
                ["  └─ accounts-worker", "108ms", "220ms", "18%", "blue"],
                ["  └─ stripe.request", "1.92s", "384ms", "66%", "amber"],
                ["  └─ postgres.query", "426ms", "2.31s", "15%", "purple"],
                ["analytics-ingest", "34ms", "2.78s", "4%", "teal"],
              ].map(([name, duration, start, width, color]) => (
                <div className="waterfall-row" key={name}>
                  <span>{name}</span>
                  <small>{duration}</small>
                  <div className="waterfall-track">
                    <i
                      className={`waterfall-bar bar-${color}`}
                      style={{
                        left:
                          start === "0ms"
                            ? "0%"
                            : start === "5ms"
                              ? "1%"
                              : start === "220ms"
                                ? "8%"
                                : start === "384ms"
                                  ? "14%"
                                  : start === "2.31s"
                                    ? "80%"
                                    : "93%",
                        width,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="trace-detail">
              <div>
                <span>HTTP status</span>
                <strong>504 Gateway Timeout</strong>
              </div>
              <div>
                <span>Region</span>
                <strong>iad1</strong>
              </div>
              <div>
                <span>Release</span>
                <strong>2026.11.14-rc3</strong>
              </div>
              <div>
                <span>User</span>
                <strong>usr_29a8</strong>
              </div>
            </div>
          </section>
        </div>
      ) : !liveTraces?.length ? (
        <section className="obs-panel obs-empty-state">
          <Layers3 size={20} />
          <h3>No trace data yet</h3>
          <p>
            Connect AegisLog profiling or send OTLP spans to populate request
            waterfalls for this project.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function MetricsView({
  notify,
  overview,
  demo,
}: {
  notify: Props["notify"];
  overview?: LiveOverview;
  demo: boolean;
}) {
  return (
    <div className="obs-page">
      <PageIntro
        icon={BarChart3}
        title="Metrics"
        description="Measure what your services are doing over time, at a glance."
        action={
          <button
            className="button primary small"
            onClick={() =>
              notify("Metric builder opened. Choose a source to begin.")
            }
          >
            <Sparkles size={14} /> Create metric
          </button>
        }
      />
      <section className="obs-query-bar metrics-query">
        <div className="obs-query-label">
          <Activity size={15} /> Explore
        </div>
        <div className="obs-search metric-input">
          <Search size={16} />
          <input value="http.server.request.duration" readOnly />
        </div>
        <SelectPill>
          <span className="metric-swatch" /> p95
        </SelectPill>
        <SelectPill>by route</SelectPill>
        <button
          className="button secondary small"
          onClick={() => notify("Metric query copied.")}
        >
          Copy query
        </button>
      </section>
      <div className="metric-stat-grid">
        {overview ? (
          <>
            <MetricStat
              label="Logs ingested"
              value={overview.logs.toLocaleString()}
              change="connected"
              positive
            />
            <MetricStat
              label="Traces captured"
              value={overview.traces.toLocaleString()}
              change="connected"
              positive
            />
            <MetricStat
              label="Audit events"
              value={overview.audit.toLocaleString()}
              change="connected"
              positive
            />
            <MetricStat
              label="Error logs"
              value={(
                overview.levels.find((item) => item.level === "error")?.count ||
                0
              ).toLocaleString()}
              change="review"
            />
          </>
        ) : demo ? (
          <>
            <MetricStat
              label="Requests / min"
              value="12,648"
              change="18.2%"
              positive
            />
            <MetricStat label="P95 latency" value="428 ms" change="12.4%" />
            <MetricStat label="Error rate" value="0.84%" change="0.18%" />
            <MetricStat
              label="Apdex score"
              value="0.92"
              change="0.04"
              positive
            />
          </>
        ) : null}
      </div>
      {demo ? (
        <section className="obs-panel metrics-chart-panel">
          <div className="obs-panel-heading">
            <div>
              <h3>Request duration by route</h3>
              <p>Last 6 hours · p50, p95, p99</p>
            </div>
            <div className="chart-legend">
              <span>
                <i className="legend-blue" /> p50
              </span>
              <span>
                <i className="legend-teal" /> p95
              </span>
              <span>
                <i className="legend-red" /> p99
              </span>
            </div>
          </div>
          <div
            className="line-chart"
            aria-label="Line chart showing request duration rising around 10:30"
          >
            <div className="chart-y-labels">
              <span>1.2s</span>
              <span>800ms</span>
              <span>400ms</span>
              <span>0ms</span>
            </div>
            <svg viewBox="0 0 900 250" preserveAspectRatio="none" role="img">
              <path
                d="M0 192 C40 180 55 198 90 178 S135 160 165 169 S220 175 252 155 S302 160 334 146 S374 160 408 136 S460 145 498 134 S548 144 579 129 S628 134 666 102 S711 121 750 95 S803 86 835 104 S870 100 900 78"
                fill="none"
                stroke="#087f8c"
                strokeWidth="4"
              />
              <path
                d="M0 218 C38 215 54 220 89 211 S135 202 166 211 S219 204 251 203 S301 193 334 202 S373 192 408 188 S459 195 498 178 S547 188 579 180 S630 179 666 166 S710 176 749 153 S802 157 835 164 S871 153 900 146"
                fill="none"
                stroke="#5684c8"
                strokeWidth="3"
              />
              <path
                d="M0 175 C38 171 52 186 90 166 S137 147 166 159 S216 161 251 133 S302 151 334 122 S373 136 408 119 S459 131 498 111 S547 127 579 112 S628 122 666 73 S711 107 749 63 S802 47 835 80 S871 73 900 27"
                fill="none"
                stroke="#cb173f"
                strokeWidth="3"
                strokeDasharray="8 8"
              />
            </svg>
            <div className="chart-x-labels">
              <span>05:00</span>
              <span>06:00</span>
              <span>07:00</span>
              <span>08:00</span>
              <span>09:00</span>
              <span>10:00</span>
              <span>11:00</span>
            </div>
          </div>
        </section>
      ) : (
        <section className="obs-panel obs-empty-state">
          <BarChart3 size={20} />
          <h3>No metric samples yet</h3>
          <p>
            Metrics will appear after a connected service starts emitting
            AegisLog request and profiling data.
          </p>
        </section>
      )}
      {demo ? (
        <div className="obs-bottom-grid">
          <section className="obs-panel">
            <div className="obs-panel-heading">
              <div>
                <h3>Top routes by volume</h3>
                <p>Requests in the selected window</p>
              </div>
              <button className="text-button">
                View all <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="metric-table">
              {[
                ["GET /pricing", "42.8k", "86ms", "0.04%"],
                ["POST /v1/checkout/confirm", "18.2k", "420ms", "2.4%"],
                ["GET /v1/account", "14.6k", "112ms", "0.14%"],
                ["POST /v1/events", "11.9k", "210ms", "0.02%"],
              ].map(([route, volume, latency, error]) => (
                <div className="metric-row" key={route}>
                  <strong>{route}</strong>
                  <span>{volume}</span>
                  <span>{latency}</span>
                  <span
                    className={
                      error !== "0.02%" && error !== "0.04%" ? "metric-bad" : ""
                    }
                  >
                    {error}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="obs-panel metric-note">
            <div className="metric-note-icon">
              <Zap size={18} />
            </div>
            <h3>Make this a service signal</h3>
            <p>
              Pin this query to a dashboard or turn it into an alert when p95
              stays above 500ms for five minutes.
            </p>
            <button
              className="button secondary small"
              onClick={() =>
                notify("Metric added to the reliability dashboard.")
              }
            >
              Add to dashboard
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function MetricStat({
  label,
  value,
  change,
  positive,
}: {
  label: string;
  value: string;
  change: string;
  positive?: boolean;
}) {
  return (
    <div className="metric-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={positive ? "positive" : "negative"}>
        {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{" "}
        {change} vs previous
      </small>
    </div>
  );
}

function AlertsView({
  notify,
  liveAlerts,
  demo,
}: {
  notify: Props["notify"];
  liveAlerts?: LiveAlert[];
  demo: boolean;
}) {
  const alertRows =
    !demo && liveAlerts !== undefined
      ? liveAlerts.map((alert) => [
          alert.name,
          alert.service || "observability",
          `${alert.state} · ${Math.max(0, Math.round((Date.now() - alert.started_at) / 60000))} min`,
          alert.value == null ? "—" : String(alert.value),
          alert.state === "firing" || alert.state === "acknowledged"
            ? "red"
            : "amber",
          alert.owner_user_id || "Unassigned",
        ])
      : [
          [
            "Checkout error rate above 2%",
            "checkout-api",
            "Firing for 8 min",
            "2.4%",
            "red",
            "Maya Chen",
          ],
          [
            "P95 latency above 500ms",
            "checkout-api",
            "Firing for 4 min",
            "640ms",
            "red",
            "Unassigned",
          ],
          [
            "Queue lag above 30 seconds",
            "analytics-ingest",
            "Pending for 2 min",
            "18s",
            "amber",
            "Alex Morgan",
          ],
        ];
  return (
    <div className="obs-page">
      <PageIntro
        icon={ShieldAlert}
        title="Alerts"
        description="Turn important changes into a clear, accountable response."
        action={
          <button
            className="button primary small"
            onClick={() => notify("Alert rule builder opened.")}
          >
            <Sparkles size={14} /> New alert rule
          </button>
        }
      />
      <div className="alert-summary">
        <div>
          <span className="summary-icon summary-red">
            <TriangleAlert size={18} />
          </span>
          <div>
            <strong>
              {demo
                ? "2"
                : liveAlerts?.filter((alert) => alert.state === "firing")
                    .length || 0}{" "}
              firing
            </strong>
            <small>Needs attention now</small>
          </div>
        </div>
        <div>
          <span className="summary-icon summary-amber">
            <Clock3 size={18} />
          </span>
          <div>
            <strong>
              {demo
                ? "1"
                : liveAlerts?.filter((alert) => alert.state === "pending")
                    .length || 0}{" "}
              pending
            </strong>
            <small>Waiting for confirmation</small>
          </div>
        </div>
        <div>
          <span className="summary-icon summary-teal">
            <Check size={18} />
          </span>
          <div>
            <strong>
              {demo
                ? "18"
                : liveAlerts?.filter((alert) => alert.state === "resolved")
                    .length || 0}{" "}
              resolved
            </strong>
            <small>In the last 7 days</small>
          </div>
        </div>
      </div>
      <section className="obs-panel alert-panel">
        <div className="obs-panel-heading">
          <div>
            <h3>Active alerts</h3>
            <p>Every alert has an owner, a reason, and a next step.</p>
          </div>
          <div className="alert-filters">
            <SelectPill>All states</SelectPill>
            <SelectPill>All services</SelectPill>
          </div>
        </div>
        <div className="alert-list">
          {alertRows.length ? (
            alertRows.map(([title, service, age, value, state, owner]) => (
              <button
                className="alert-row"
                key={title}
                onClick={() => notify(`${title} opened in incident detail.`)}
              >
                <span className={`alert-state alert-${state}`}>
                  <span />
                </span>
                <span className="alert-main">
                  <strong>{title}</strong>
                  <small>
                    {service} · {age}
                  </small>
                </span>
                <strong className={`alert-value value-${state}`}>
                  {value}
                </strong>
                <span className="alert-owner">
                  <span className="mini-avatar">
                    {owner === "Unassigned"
                      ? "?"
                      : owner
                          .split(" ")
                          .map((word) => word[0])
                          .join("")}
                  </span>
                  {owner}
                </span>
                <MoreHorizontal size={16} />
              </button>
            ))
          ) : (
            <div className="obs-empty-inline">
              <Check size={16} /> No alert incidents have been recorded for this
              project.
            </div>
          )}
        </div>
      </section>
      {demo ? (
        <div className="obs-bottom-grid">
          <section className="obs-panel">
            <div className="obs-panel-heading">
              <div>
                <h3>Alert activity</h3>
                <p>Recent transitions across your workspace</p>
              </div>
              <button className="text-button">
                View history <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="alert-timeline">
              {[
                ["10:42", "Firing", "Checkout error rate above 2%", "red"],
                ["10:39", "Acknowledged", "Maya Chen took ownership", "blue"],
                ["10:35", "Firing", "P95 latency above 500ms", "red"],
                ["10:28", "Resolved", "Database connections recovered", "teal"],
              ].map(([time, state, copy, color]) => (
                <div key={`${time}-${copy}`}>
                  <time>{time}</time>
                  <span className={`timeline-dot dot-${color}`} />
                  <p>
                    <strong>{state}</strong>
                    {copy}
                  </p>
                </div>
              ))}
            </div>
          </section>
          <section className="obs-panel alert-empty">
            <div className="alert-empty-mark">
              <BellDot />
            </div>
            <h3>Make alerts actionable</h3>
            <p>
              Route incidents to email, Slack, or a webhook and keep a visible
              owner on every firing signal.
            </p>
            <button
              className="button secondary small"
              onClick={() =>
                notify("Notification integrations are ready for setup.")
              }
            >
              Configure notifications
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function BellDot() {
  return (
    <span className="bell-dot-icon">
      <AlertTriangle size={20} />
    </span>
  );
}

function ServicesView({
  notify,
  liveServices,
  demo,
}: {
  notify: Props["notify"];
  liveServices?: LiveService[];
  demo: boolean;
}) {
  const serviceRows =
    !demo && liveServices !== undefined
      ? liveServices.map((service) => ({
          name: service.service,
          type: "Observed AegisLog service",
          health: service.errors > 0 ? "Degraded" : "Healthy",
          latency: "—",
          error: service.errors ? `${service.errors} errors` : "0 errors",
          traffic: `${service.logs.toLocaleString()} logs`,
          color: service.errors > 0 ? "red" : "teal",
        }))
      : services;
  return (
    <div className="obs-page">
      <PageIntro
        icon={Layers3}
        title="Service map"
        description="See how your product is connected and where health is changing."
        action={
          <button
            className="button secondary small"
            onClick={() => notify("Service map refreshed.")}
          >
            <Activity size={14} /> Refresh map
          </button>
        }
      />
      <section className="service-map-panel obs-panel">
        <div className="service-map-toolbar">
          <div>
            <h3>Request topology</h3>
            <p>Live dependencies from the last 15 minutes</p>
          </div>
          <div className="service-map-legend">
            <span>
              <i className="legend-teal" /> healthy
            </span>
            <span>
              <i className="legend-red" /> degraded
            </span>
          </div>
        </div>
        <div className="service-map-canvas">
          <div className="map-node node-web">
            <Globe2 size={19} />
            <strong>web</strong>
            <small>86ms · 4.8k rpm</small>
          </div>
          <div className="map-node node-checkout degraded">
            <Cloud size={19} />
            <strong>checkout-api</strong>
            <small>420ms · 2.4% errors</small>
          </div>
          <div className="map-node node-accounts">
            <Server size={19} />
            <strong>accounts-worker</strong>
            <small>112ms · healthy</small>
          </div>
          <div className="map-node node-db">
            <Database size={19} />
            <strong>postgres</strong>
            <small>19ms · healthy</small>
          </div>
          <div className="map-node node-ingest">
            <Activity size={19} />
            <strong>analytics-ingest</strong>
            <small>1.2s lag · healthy</small>
          </div>
          <svg viewBox="0 0 900 330" aria-hidden="true">
            <path d="M180 153 C270 153 270 93 358 93" />
            <path d="M180 177 C275 177 275 239 358 239" />
            <path d="M528 112 C620 112 620 128 722 145" />
            <path d="M528 248 C620 248 632 186 722 174" />
            <path d="M450 136 C450 163 450 196 450 218" />
          </svg>
        </div>
      </section>
      <section className="obs-panel service-table-panel">
        <div className="obs-panel-heading">
          <div>
            <h3>Services</h3>
            <p>
              {!demo
                ? "Observed directly from the connected AegisLog stream."
                : "Health, latency, and traffic at a glance."}
            </p>
          </div>
          <button
            className="button secondary small"
            onClick={() => notify("Service inventory export prepared.")}
          >
            <ArrowDownRight size={14} /> Export
          </button>
        </div>
        <div className="service-table">
          <div className="service-table-head">
            <span>Service</span>
            <span>Health</span>
            <span>Latency</span>
            <span>Error rate</span>
            <span>Traffic</span>
          </div>
          {serviceRows.length ? (
            serviceRows.map((service) => (
              <button
                className="service-table-row"
                key={service.name}
                onClick={() => notify(`${service.name} service detail opened.`)}
              >
                <span className="service-name">
                  <span className={`service-symbol ${service.color}`}>
                    <Server size={15} />
                  </span>
                  <span>
                    <strong>{service.name}</strong>
                    <small>{service.type}</small>
                  </span>
                </span>
                <span className={`service-health ${service.color}`}>
                  <i />
                  {service.health}
                </span>
                <span>{service.latency}</span>
                <span className={service.color === "red" ? "metric-bad" : ""}>
                  {service.error}
                </span>
                <span>{service.traffic}</span>
              </button>
            ))
          ) : (
            <div className="obs-empty-inline">
              <Layers3 size={16} /> No service signals have been received yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function ObservabilityView({
  kind,
  site,
  workspaceId,
  demo,
  notify,
}: Props) {
  const [liveLogs, setLiveLogs] = useState<LiveLog[] | undefined>();
  const [liveTraces, setLiveTraces] = useState<LiveTrace[] | undefined>();
  const [liveServices, setLiveServices] = useState<LiveService[] | undefined>();
  const [liveAlerts, setLiveAlerts] = useState<LiveAlert[] | undefined>();
  const [overview, setOverview] = useState<LiveOverview | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    const base = `/api/workspaces/${workspaceId}/sites/${site.id}/observability`;
    setLoading(true);
    setError("");
    setLiveLogs(undefined);
    setLiveTraces(undefined);
    setLiveServices(undefined);
    setLiveAlerts(undefined);
    setOverview(undefined);
    const load = async () => {
      try {
        if (kind === "logs") {
          const result = await api<{ results: LiveLog[] }>(`${base}/logs`, {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setLiveLogs(result.results);
        } else if (kind === "traces") {
          const result = await api<{ results: LiveTrace[] }>(`${base}/traces`, {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setLiveTraces(result.results);
        } else if (kind === "services") {
          const result = await api<{ results: LiveService[] }>(
            `${base}/services`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) setLiveServices(result.results);
        } else if (kind === "alerts") {
          const result = await api<{ results: LiveAlert[] }>(`${base}/alerts`, {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setLiveAlerts(result.results);
        } else {
          const result = await api<LiveOverview>(`${base}/overview`, {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setOverview(result);
        }
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Observability data could not be loaded.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [demo, kind, site.id, workspaceId]);

  const view =
    kind === "logs" ? (
      <LogsView notify={notify} liveLogs={liveLogs} demo={demo} />
    ) : kind === "traces" ? (
      <TracesView notify={notify} liveTraces={liveTraces} demo={demo} />
    ) : kind === "metrics" ? (
      <MetricsView notify={notify} overview={overview} demo={demo} />
    ) : kind === "alerts" ? (
      <AlertsView notify={notify} liveAlerts={liveAlerts} demo={demo} />
    ) : (
      <ServicesView notify={notify} liveServices={liveServices} demo={demo} />
    );
  return (
    <div
      className="observability-shell"
      data-demo={demo ? "true" : undefined}
      data-site={site.id}
    >
      {!demo && (loading || error) && (
        <div
          className="obs-connection-status"
          role={error ? "alert" : "status"}
        >
          <span className={error ? "status-dot status-red" : "live-dot"} />
          {error || "Loading connected observability data…"}
        </div>
      )}
      {view}
    </div>
  );
}
