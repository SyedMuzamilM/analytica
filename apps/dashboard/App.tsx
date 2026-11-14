import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { startRegistration } from "@simplewebauthn/browser";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  BarChart3,
  Check,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Fingerprint,
  GitBranch,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  MousePointerClick,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Terminal,
  Layers3,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  AnalyticsReport,
  AuthStatus,
  BreakdownRow,
  MetricSet,
  Site,
  Workspace,
} from "../../packages/contracts";
import {
  api,
  compact,
  formatDuration,
  formatNumber,
  friendlyError,
  post,
} from "./api";
import { AuthScreen } from "./AuthScreen";
import { Brand } from "./Brand";
import { demoReport, demoSites } from "./demo";
import { RevenueView } from "./RevenueView";
import { AccountView } from "./AccountView";
import { FunnelsView } from "./FunnelsView";
import { JourneysView } from "./JourneysView";
import { ProjectsView, ProjectIcon } from "./ProjectsView";
import { SelectField } from "./SelectField";
import { ProjectImage } from "./ProjectImage";
import { LayoutGrid } from "lucide-react";
import { ObservabilityView, type ObservabilityKind } from "./ObservabilityView";

type ObservabilityViewId =
  "logs" | "traces" | "metrics" | "alerts" | "services";
type View =
  | "projects"
  | "overview"
  | "acquisition"
  | "pages"
  | "events"
  | "revenue"
  | "settings"
  | "account"
  | "funnels"
  | "journeys"
  | ObservabilityViewId;
type FilterKey = "source" | "path" | "country" | "device" | "event";
const filters: { key: FilterKey; label: string }[] = [
  { key: "source", label: "Source" },
  { key: "path", label: "Page" },
  { key: "country", label: "Country" },
  { key: "device", label: "Device" },
  { key: "event", label: "Event" },
];
const nav: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "acquisition", label: "Acquisition", icon: Globe },
  { id: "pages", label: "Pages", icon: FileText },
  { id: "events", label: "Events", icon: MousePointerClick },
  { id: "funnels", label: "Funnels", icon: MousePointerClick },
  { id: "journeys", label: "Journeys", icon: Users },
  { id: "revenue", label: "Revenue", icon: Wallet },
];
const observabilityNav: {
  id: ObservabilityViewId;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "logs", label: "Logs", icon: Terminal },
  { id: "traces", label: "Traces", icon: GitBranch },
  { id: "metrics", label: "Metrics", icon: BarChart3 },
  { id: "alerts", label: "Alerts", icon: ShieldAlert },
  { id: "services", label: "Service map", icon: Layers3 },
];
const observabilityViews: ObservabilityViewId[] = [
  "logs",
  "traces",
  "metrics",
  "alerts",
  "services",
];
const viewDescriptions: Record<View, string> = {
  projects: "A home for every website, application and experiment.",
  overview: "The people, pages, and paths behind your traffic.",
  acquisition: "Understand what brings people to your website.",
  pages: "See where attention lands, and where it leads.",
  events: "Keep an eye on the actions that matter.",
  funnels: "See where a visit becomes a completed action.",
  journeys: "Follow the activity behind a consent-enabled visit.",
  revenue: "Connect the visits to the value they create.",
  settings: "Your website, its installation, and your controls.",
  account: "Manage workspaces, members, and your account security.",
  logs: "Search structured events across every service and environment.",
  traces: "Follow slow or failing requests across your service graph.",
  metrics: "Measure latency, throughput, and reliability over time.",
  alerts: "Turn important changes into a clear, accountable response.",
  services: "See service health, dependencies, and the traffic between them.",
};

function useLocation() {
  const [location, setLocation] = useState(
    () => window.location.pathname + window.location.search,
  );
  useEffect(() => {
    const listener = () =>
      setLocation(window.location.pathname + window.location.search);
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  const update = useCallback((values: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    Object.entries(values).forEach(([key, value]) =>
      value === null
        ? url.searchParams.delete(key)
        : url.searchParams.set(key, value),
    );
    window.history.pushState({}, "", url.pathname + url.search);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);
  return {
    location,
    params: new URLSearchParams(location.split("?")[1] ?? ""),
    update,
  };
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const current = dialog.current;
    const previousFocus = document.activeElement;
    current?.showModal();
    return () => {
      current?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function CopyButton({
  value,
  label = "Copy",
  onCopied,
}: {
  value: string;
  label?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <button
      className="button secondary small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setError(false);
          onCopied?.();
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setError(true);
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {error ? "Select and copy manually" : copied ? "Copied" : label}
    </button>
  );
}

function RecoveryCodes({
  codes,
  onClose,
}: {
  codes: string[];
  onClose: () => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <Modal title="Save your recovery codes" onClose={onClose} wide>
      <p className="modal-copy">
        Store these codes somewhere private. Each one can replace a lost passkey
        once. They will not be shown again.
      </p>
      <div className="recovery-grid">
        {codes.map((code) => (
          <code key={code}>{code}</code>
        ))}
      </div>
      <div className="modal-actions">
        <CopyButton value={codes.join("\n")} label="Copy all codes" />
        <button
          className="button primary"
          onClick={() => (saved ? onClose() : setSaved(true))}
        >
          {saved ? "Continue to your workspace" : "I have saved these codes"}
        </button>
      </div>
    </Modal>
  );
}

function Stat({
  label,
  value,
  previous,
  display,
  note,
}: {
  label: string;
  value: number | null;
  previous?: number | null;
  display?: (value: number) => string;
  note?: string;
}) {
  const change =
    previous && value !== null ? ((value - previous) / previous) * 100 : null;
  return (
    <div className="stat">
      <span className="stat-label">
        {label}
        {note && (
          <span className="info-dot" title={note} aria-label={note}>
            i
          </span>
        )}
      </span>
      <div className="stat-value">
        {value === null ? (
          <span className="unavailable">—</span>
        ) : display ? (
          display(value)
        ) : (
          formatNumber(value)
        )}
      </div>
      <div className="stat-comparison">
        {change !== null ? (
          <>
            <span className={`change ${change >= 0 ? "positive" : "negative"}`}>
              {change >= 0 ? (
                <ArrowUpRight size={13} />
              ) : (
                <ArrowDownRight size={13} />
              )}
              {Math.abs(change).toFixed(1)}%
            </span>
            <span>vs. previous period</span>
          </>
        ) : (
          <span>
            {value === null
              ? "Not measured in this mode"
              : previous === 0 && value !== 0
                ? "No previous-period activity"
                : "No change to compare yet"}
          </span>
        )}
      </div>
    </div>
  );
}

function Chart({
  report,
  metric,
  onMetric,
}: {
  report: AnalyticsReport;
  metric: "pageviews" | "sessions" | "goals";
  onMetric: (metric: "pageviews" | "sessions" | "goals") => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const points = report.series;
  const max = Math.max(4, ...points.map((point) => point[metric]));
  const ceiling = Math.ceil(max / 4 / 10) * 40 || 4;
  const width = 900,
    height = 210,
    top = 18,
    bottom = 190;
  const coords = points.map((point, index) => ({
    x:
      points.length <= 1
        ? width / 2
        : 10 + (index / (points.length - 1)) * (width - 20),
    y: bottom - (point[metric] / ceiling) * (bottom - top),
  }));
  const line = coords
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(" ");
  const area = coords.length
    ? `${line} L${coords.at(-1)!.x} ${bottom} L${coords[0].x} ${bottom} Z`
    : "";
  const hovered = hover !== null && points[hover] ? points[hover] : null;
  const labelIndexes = [
    ...new Set([
      0,
      Math.floor((points.length - 1) * 0.25),
      Math.floor((points.length - 1) * 0.5),
      Math.floor((points.length - 1) * 0.75),
      points.length - 1,
    ]),
  ].filter((index) => index >= 0);
  return (
    <section
      className="panel chart-panel"
      aria-labelledby="traffic-chart-title"
    >
      <div className="panel-heading chart-heading">
        <div className="chart-tabs" aria-label="Chart metric">
          {(["pageviews", "sessions", "goals"] as const).map((value) => (
            <button
              key={value}
              className={value === metric ? "selected" : ""}
              onClick={() => onMetric(value)}
              aria-pressed={value === metric}
            >
              {value === "pageviews"
                ? "Pageviews"
                : value === "sessions"
                  ? "Sessions"
                  : "Goals"}
            </button>
          ))}
        </div>
        <span className="chart-legend">
          <span />
          Current period
        </span>
      </div>
      <h2 id="traffic-chart-title" className="sr-only">
        {metric} by day
      </h2>
      <div className="chart-inner">
        <div className="chart-y-axis">
          {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
            <span key={ratio}>{compact(ceiling * ratio)}</span>
          ))}
        </div>
        <div className="chart-canvas">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${formatNumber(report.current[metric])} ${metric} across ${points.length} days`}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setHover(
                Math.max(
                  0,
                  Math.min(
                    points.length - 1,
                    Math.round(
                      ((event.clientX - bounds.left) / bounds.width) *
                        (points.length - 1),
                    ),
                  ),
                ),
              );
            }}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity=".12" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity=".008" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3, 4].map((index) => (
              <line
                key={index}
                x1="0"
                x2={width}
                y1={top + ((bottom - top) * index) / 4}
                y2={top + ((bottom - top) * index) / 4}
                stroke="var(--line)"
                strokeDasharray={index === 4 ? undefined : "3 5"}
              />
            ))}
            <path d={area} fill="url(#trafficFill)" />
            <path
              d={line}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.4"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {hover !== null && coords[hover] && (
              <>
                <line
                  x1={coords[hover].x}
                  x2={coords[hover].x}
                  y1={top}
                  y2={bottom}
                  stroke="var(--accent-soft)"
                  strokeDasharray="4 4"
                />
                <circle
                  cx={coords[hover].x}
                  cy={coords[hover].y}
                  r="4"
                  fill="var(--accent)"
                  stroke="white"
                  strokeWidth="2"
                />
              </>
            )}
          </svg>
          {hovered && (
            <div
              className="chart-tooltip"
              style={{
                left: `${Math.min(83, Math.max(10, ((hover ?? 0) / Math.max(1, points.length - 1)) * 100))}%`,
              }}
            >
              <span>
                {new Date(`${hovered.date}T12:00:00Z`).toLocaleDateString(
                  "en",
                  { month: "short", day: "numeric", timeZone: "UTC" },
                )}
              </span>
              <strong>
                {formatNumber(hovered[metric])} {metric}
              </strong>
            </div>
          )}
          <div className="chart-x-axis">
            {labelIndexes.map((index) => (
              <span key={index}>
                {new Date(`${points[index].date}T12:00:00Z`).toLocaleDateString(
                  "en",
                  { month: "short", day: "numeric", timeZone: "UTC" },
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-footer">
        <span>
          <span className="live-dot" />
          {report.online === 1
            ? "1 browser active now"
            : `${report.online} browsers active now`}
        </span>
        <span>Daily totals · {report.range.timezone}</span>
      </div>
    </section>
  );
}

function SourceMark({ name }: { name: string }) {
  const lower = name.toLowerCase();
  const symbol = lower.includes("google")
    ? "G"
    : lower.includes("direct")
      ? "↗"
      : lower.includes("twitter") || lower === "x"
        ? "𝕏"
        : lower.includes("github")
          ? "gh"
          : lower.includes("chatgpt") || lower.includes("openai")
            ? "◎"
            : lower.includes("newsletter") || lower.includes("email")
              ? "@"
              : lower.includes("reddit")
                ? "r"
                : name.slice(0, 1).toUpperCase();
  return (
    <span
      className={`source-mark ${lower.includes("google") ? "google-mark" : lower.includes("chatgpt") ? "chatgpt-mark" : ""}`}
      aria-hidden="true"
    >
      {symbol}
    </span>
  );
}

function Breakdown({
  title,
  rows,
  filterKey,
  onFilter,
  total,
  limit = 6,
  kind = "plain",
  full = false,
}: {
  title: string;
  rows: BreakdownRow[];
  filterKey: FilterKey;
  onFilter: (key: FilterKey, value: string) => void;
  total?: number;
  limit?: number;
  kind?: "source" | "page" | "country" | "device" | "plain";
  full?: boolean;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const summed = total ?? rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <section
      className={`panel breakdown-panel ${full ? "breakdown-full" : ""}`}
      aria-label={title}
    >
      <div className="panel-heading">
        <h2>{title}</h2>
        <span className="column-label">
          {filterKey === "event" ? "Events" : "Pageviews"}
        </span>
      </div>
      {rows.length ? (
        <div className="breakdown-list">
          {rows.slice(0, limit).map((row) => (
            <button
              className="breakdown-row"
              key={row.name}
              onClick={() => onFilter(filterKey, row.name)}
              aria-label={`Filter by ${filterKey}: ${row.name}`}
            >
              <span
                className="row-bar"
                style={{ width: `${(row.count / max) * 88}%` }}
              />
              <span className="row-name">
                {kind === "source" && <SourceMark name={row.name} />}
                {kind === "page" && (
                  <FileText size={15} className="row-type-icon" />
                )}
                {kind === "country" && (
                  <span className="country-mark">
                    {(
                      {
                        "United States": "US",
                        "United Kingdom": "GB",
                        Germany: "DE",
                        India: "IN",
                        Canada: "CA",
                      } as Record<string, string>
                    )[row.name] ?? row.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                {kind === "device" && (
                  <span className="device-mark">
                    {row.name === "Mobile"
                      ? "▯"
                      : row.name === "Tablet"
                        ? "▭"
                        : "▱"}
                  </span>
                )}
                <span title={row.name}>{row.name || "Unknown"}</span>
              </span>
              <span className="row-numbers">
                <strong>{formatNumber(row.count)}</strong>
                <span>
                  {summed
                    ? `${((row.count / summed) * 100).toFixed(1)}%`
                    : "0%"}
                </span>
                {full && <ArrowRight size={14} />}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="panel-empty">
          No {title.toLowerCase()} to show in this period.
        </div>
      )}
      <div className="panel-footer">
        <span>
          {rows.length}{" "}
          {filterKey === "source"
            ? "sources"
            : filterKey === "path"
              ? "pages"
              : filterKey === "country"
                ? "countries"
                : filterKey === "device"
                  ? "device types"
                  : "event names"}
        </span>
        {rows.length > limit && <span>Showing top {limit}</span>}
        <span>Click a row to filter</span>
      </div>
    </section>
  );
}

function SiteModal({
  workspaceId,
  onClose,
  onCreated,
  demo,
  onNotice,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: (site: Site) => void;
  demo: boolean;
  onNotice: (text: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (demo) {
      onNotice(
        "The demo is read-only. Create your workspace to add a website.",
      );
      onClose();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const site = await post<Site>(`/api/workspaces/${workspaceId}/sites`, {
        name: form.get("name"),
        domain: form.get("domain"),
        timezone: form.get("timezone"),
        privacyMode: form.get("privacyMode"),
      });
      onCreated(site);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add a project" onClose={onClose}>
      <p className="modal-copy">
        Create a separate project for your website or application. Connect its
        tracker or native collector next.
      </p>
      <form onSubmit={submit}>
        <label>
          Project name
          <input
            name="name"
            required
            maxLength={80}
            placeholder="Orchard Ledger Desktop"
            autoFocus
          />
        </label>
        <label>
          Domain
          <input
            name="domain"
            required
            placeholder="example.com"
            maxLength={253}
          />
        </label>
        <label>
          Reporting timezone
          <SelectField
            label="Reporting timezone"
            name="timezone"
            defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
            options={[
              ...new Set([
                Intl.DateTimeFormat().resolvedOptions().timeZone,
                "UTC",
                "America/New_York",
                "America/Los_Angeles",
                "Europe/London",
                "Europe/Berlin",
                "Asia/Kolkata",
                "Asia/Tokyo",
                "Australia/Sydney",
              ]),
            ].map((value) => ({ value, label: value }))}
          />
        </label>
        <fieldset>
          <legend>How should this project measure traffic?</legend>
          <label className="radio-card">
            <input
              type="radio"
              name="privacyMode"
              value="aggregate"
              defaultChecked
            />
            <span>
              <strong>Aggregate</strong>
              <small>
                No persistent visitor cookie. Pageviews and document-session
                estimates.
              </small>
            </span>
          </label>
          <label className="radio-card">
            <input type="radio" name="privacyMode" value="attribution" />
            <span>
              <strong>Attribution</strong>
              <small>
                First-party identifiers after consent. Returning visitors and
                session journeys.
              </small>
            </span>
          </label>
        </fieldset>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="button primary">
            {busy ? "Adding project…" : "Add project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SettingsView({
  site,
  demo,
  workspace,
  onSiteChange,
  notify,
}: {
  site: Site;
  demo: boolean;
  workspace: Workspace;
  onSiteChange: (site: Site) => void;
  notify: (message: string) => void;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [invitation, setInvitation] = useState("");
  const [observabilityConnection, setObservabilityConnection] = useState<{
    ingestUrl: string;
    tracesUrl: string;
  } | null>(null);
  const [observabilityKey, setObservabilityKey] = useState("");
  const [observabilityBusy, setObservabilityBusy] = useState(false);
  const snippet = `<script defer src="${window.location.origin}/tracker.js" data-site="${site.id}" data-mode="${site.privacyMode}"></script>`;
  const siteBase = `/api/workspaces/${workspace.id}/sites/${site.id}`;
  const canEdit = workspace.role !== "viewer";
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    api<{ ingestUrl: string; tracesUrl: string }>(
      `${siteBase}/observability/connection`,
      { signal: controller.signal },
    )
      .then(setObservabilityConnection)
      .catch(() => {});
    return () => controller.abort();
  }, [demo, siteBase]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) {
      notify("Sample website settings are read-only.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const next = await api<Site>(siteBase, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          status: form.get("status"),
        }),
      });
      onSiteChange(next);
      notify("Website settings saved.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }
  async function addPasskey() {
    if (demo) {
      notify("Passkeys are available in your own workspace.");
      return;
    }
    try {
      const data = await post<{
        challengeId: string;
        options: Parameters<typeof startRegistration>[0]["optionsJSON"];
      }>("/api/auth/passkeys/options");
      const response = await startRegistration({ optionsJSON: data.options });
      await post("/api/auth/passkeys/verify", {
        challengeId: data.challengeId,
        response,
      });
      notify("Additional passkey registered.");
    } catch (err) {
      notify(friendlyError(err));
    }
  }
  async function createObservabilityKey() {
    if (demo) {
      notify("Create an account to connect AegisLog.");
      return;
    }
    setObservabilityBusy(true);
    try {
      const result = await post<{ token: string }>(`${siteBase}/keys`, {
        name: "AegisLog ingestion",
        namespace: "aegislog",
      });
      setObservabilityKey(result.token);
      notify("AegisLog key created. Copy it now; it will not be shown again.");
    } catch (err) {
      notify(friendlyError(err));
    } finally {
      setObservabilityBusy(false);
    }
  }
  async function createInvite() {
    if (demo) {
      notify("Invitations are available in your own workspace.");
      return;
    }
    try {
      const data = await post<{ token: string; expiresAt: number }>(
        "/api/auth/invites",
        { workspaceId: workspace.id, role: "viewer" },
      );
      setInvitation(data.token);
    } catch (err) {
      notify(friendlyError(err));
    }
  }
  return (
    <div className="settings-grid">
      <div className="settings-stack">
        <section className="panel settings-panel">
          <div className="panel-heading">
            <h2>Website details</h2>
            <span className={`status-tag ${site.status}`}>{site.status}</span>
          </div>
          <form onSubmit={save}>
            <label>
              Website name
              <input
                name="name"
                defaultValue={site.name}
                maxLength={80}
                required
                disabled={!canEdit}
              />
            </label>
            <label>
              Domain
              <input value={site.domain} readOnly />
              <small>The collection domain is fixed for this website.</small>
            </label>
            <label>
              Timezone
              <SelectField
                label="Timezone"
                name="timezone"
                defaultValue={site.timezone}
                disabled
                options={[{ value: site.timezone, label: site.timezone }]}
              />
              <small>
                The reporting timezone is fixed for this website to keep
                historical totals consistent.
              </small>
            </label>
            <label>
              Collection
              <SelectField
                label="Collection"
                name="status"
                defaultValue={site.status}
                disabled={!canEdit}
                options={[
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                ]}
              />
              <small>
                Pausing stops browser events and money intake. Payment
                deliveries may expire if the provider stops retrying.
              </small>
            </label>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            {canEdit && (
              <button className="button primary" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            )}
          </form>
        </section>
        <section className="panel settings-panel">
          <div className="panel-heading">
            <h2>Access and data</h2>
          </div>
          <div className="settings-action">
            <div>
              <strong>Add a backup passkey</strong>
              <p>Use another device or security key.</p>
            </div>
            <button className="button secondary small" onClick={addPasskey}>
              <Fingerprint size={15} />
              Add passkey
            </button>
          </div>
          {workspace.role === "owner" && (
            <div className="settings-action">
              <div>
                <strong>Invite a viewer</strong>
                <p>Share a private invitation token manually.</p>
              </div>
              <button className="button secondary small" onClick={createInvite}>
                <Users size={15} />
                Create invitation
              </button>
            </div>
          )}
          {invitation && (
            <div className="invitation-token">
              <p>
                Share this token privately. The recipient can choose "Have an
                invitation?" on the sign-in page.
              </p>
              <code>{invitation}</code>
              <CopyButton value={invitation} label="Copy invitation" />
            </div>
          )}
          {canEdit && (
            <div className="settings-action">
              <div>
                <strong>Export your data</strong>
                <p>Download a bounded export for this website.</p>
              </div>
              <button
                className="button secondary small"
                onClick={() =>
                  demo
                    ? notify("Sample data is not included in customer exports.")
                    : window.open(
                        `${siteBase}/export`,
                        "_blank",
                        "noopener,noreferrer",
                      )
                }
              >
                <Download size={15} />
                Export
              </button>
            </div>
          )}
          {canEdit && (
            <div className="settings-action danger-zone">
              <div>
                <strong>Delete this website</strong>
                <p>Stop collection and remove its analytics.</p>
              </div>
              <button
                className="button danger small"
                onClick={async () => {
                  if (demo) {
                    notify("Sample websites are read-only.");
                    return;
                  }
                  if (
                    !window.confirm(
                      `Delete ${site.name} and its analytics? This cannot be undone.`,
                    )
                  )
                    return;
                  try {
                    await api(siteBase, { method: "DELETE" });
                    onSiteChange({ ...site, status: "deleting" });
                    notify(
                      "Collection stopped. Website deletion is in progress.",
                    );
                  } catch (err) {
                    notify(friendlyError(err));
                  }
                }}
              >
                Delete website
              </button>
            </div>
          )}
        </section>
      </div>
      <div className="settings-stack">
        <ProjectImage
          site={site}
          canEdit={canEdit}
          demo={demo}
          onChanged={onSiteChange}
          notify={notify}
        />
        <section className="panel settings-panel">
          <div className="panel-heading">
            <h2>Install the tracker</h2>
            <span className="small-pill">
              {site.privacyMode === "aggregate"
                ? "Aggregate mode"
                : "Attribution mode"}
            </span>
          </div>
          <p>
            Add this snippet before the closing <code>&lt;/head&gt;</code> tag
            on your website.
          </p>
          <pre>
            <code>{snippet}</code>
          </pre>
          <CopyButton value={snippet} label="Copy snippet" />
          <div className="installation-note">
            <ShieldCheck size={17} />
            <p>
              {site.privacyMode === "aggregate"
                ? "No persistent visitor cookie or fingerprint. Full page navigation starts a new document ID."
                : "Attribution starts only after your site grants consent. Call analytica('consent', true) after your configured consent condition."}
            </p>
          </div>
          <div className="code-example">
            <span>Track an action</span>
            <code>window.analytica('goal', 'signup')</code>
            <span>Respect an opt-out</span>
            <code>window.analytica('optOut', true)</code>
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="panel-heading">
            <h2>Application connection</h2>
          </div>
          <p>
            For desktop and mobile collectors, use these public project values.
            Enable application analytics only after opt-in.
          </p>
          <dl className="connection-facts">
            {[
              ["Collector endpoint", `${window.location.origin}/v1/collect`],
              ["Public project ID", site.id],
              ["Collection hostname", site.domain],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <code>{value}</code>
                  <CopyButton
                    value={value}
                    label={`Copy ${label.toLowerCase()}`}
                  />
                </dd>
              </div>
            ))}
          </dl>
          <a href="/docs#applications" className="subtle-link">
            Read the application guide <ArrowRight size={14} />
          </a>
        </section>
        <section className="panel settings-panel aegislog-connection-panel">
          <div className="panel-heading">
            <h2>Connect AegisLog</h2>
            <span className="small-pill">Structured observability</span>
          </div>
          <p>
            Send detailed logs, audit records, and OTLP request traces from a
            backend service into this project. AegisLog redacts sensitive fields
            before transport, and Analytica redacts again at ingestion.
          </p>
          <dl className="connection-facts">
            <div>
              <dt>Log ingest endpoint</dt>
              <dd>
                <code>
                  {observabilityConnection?.ingestUrl ||
                    `${window.location.origin}/v1/observability/ingest`}
                </code>
                <CopyButton
                  value={
                    observabilityConnection?.ingestUrl ||
                    `${window.location.origin}/v1/observability/ingest`
                  }
                  label="Copy endpoint"
                />
              </dd>
            </div>
            <div>
              <dt>Trace ingest endpoint</dt>
              <dd>
                <code>
                  {observabilityConnection?.tracesUrl ||
                    `${window.location.origin}/v1/observability/otlp/traces`}
                </code>
                <CopyButton
                  value={
                    observabilityConnection?.tracesUrl ||
                    `${window.location.origin}/v1/observability/otlp/traces`
                  }
                  label="Copy endpoint"
                />
              </dd>
            </div>
          </dl>
          {observabilityKey ? (
            <div className="aegislog-key-reveal">
              <strong>Copy this key now</strong>
              <p>It is shown once. Store it in your backend secret manager.</p>
              <code>{observabilityKey}</code>
              <CopyButton value={observabilityKey} label="Copy AegisLog key" />
            </div>
          ) : (
            <button
              className="button primary small"
              disabled={!canEdit || observabilityBusy}
              onClick={() => void createObservabilityKey()}
            >
              {observabilityBusy ? "Creating key…" : "Create AegisLog key"}
            </button>
          )}
          <pre className="aegislog-snippet">
            <code>{`import { createLogger } from "aegislog";
import { HttpBatchSink } from "@aegislog/transports";

const logger = createLogger({
  sinks: [new HttpBatchSink({
    url: "${observabilityConnection?.ingestUrl || `${window.location.origin}/v1/observability/ingest`}",
    headers: { Authorization: "Bearer \${process.env.ANALYTICA_AEGISLOG_KEY}" },
  })],
});`}</code>
          </pre>
          <pre className="aegislog-snippet">
            <code>{`import { startProfiling } from "@aegislog/profiling";

startProfiling({
  serviceName: "your-service-name",
  otlp: {
    endpoint: "${observabilityConnection?.tracesUrl || `${window.location.origin}/v1/observability/otlp/traces`}",
    headers: { Authorization: "Bearer \${process.env.ANALYTICA_AEGISLOG_KEY}" },
  },
});`}</code>
          </pre>
        </section>
      </div>
    </div>
  );
}

export function App() {
  const { location, params, update } = useLocation();
  const isDemo = /^\/demo\/?$/.test(location.split("?")[0]);
  const requestedView = params.get("view") as View | null;
  const view =
    requestedView &&
    [
      ...nav.map((item) => item.id),
      ...observabilityNav.map((item) => item.id),
      "settings",
      "account",
      "projects",
    ].includes(requestedView)
      ? requestedView
      : !isDemo && !params.get("site")
        ? "projects"
        : "overview";
  const period = ["7d", "30d", "90d"].includes(params.get("period") ?? "")
    ? params.get("period")!
    : "7d";
  const isObservability = observabilityViews.includes(
    view as ObservabilityViewId,
  );
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState("");
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [reportError, setReportError] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [addSite, setAddSite] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [metric, setMetric] = useState<"pageviews" | "sessions" | "goals">(
    "pageviews",
  );
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 6500);
  }, []);
  const workspaces = isDemo
    ? [{ id: "demo", name: "Orbit workspace", role: "owner" as const }]
    : (status?.workspaces ?? []);
  const workspace =
    workspaces.find((item) => item.id === params.get("workspace")) ??
    workspaces[0];
  const availableSites = isDemo
    ? demoSites
    : sites.filter((item) => item.workspaceId === workspace?.id);
  const site =
    availableSites.find((item) => item.id === params.get("site")) ??
    availableSites[0];
  const queryKey = params.toString();

  const loadAuth = useCallback(async () => {
    try {
      setAuthError("");
      setStatus(await api<AuthStatus>("/api/auth/status"));
    } catch (err) {
      setAuthError(friendlyError(err));
    }
  }, []);
  useEffect(() => {
    if (!isDemo) void loadAuth();
  }, [isDemo, loadAuth]);
  useEffect(() => {
    const title =
      view === "projects"
        ? "Projects"
        : view === "overview"
          ? "Overview"
          : (nav.find((item) => item.id === view)?.label ??
            observabilityNav.find((item) => item.id === view)?.label ??
            (view === "account" ? "Workspace & account" : "Settings"));
    document.title = `${title}${site ? ` · ${site.name}` : ""} · Analytica`;
  }, [view, site?.name]);
  useEffect(() => {
    if (isDemo || !status?.authenticated || !workspace) return;
    const controller = new AbortController();
    setSitesLoading(true);
    setSitesError("");
    api<Site[]>(`/api/workspaces/${workspace.id}/sites`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setSites(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setSitesError(friendlyError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSitesLoading(false);
      });
    return () => controller.abort();
  }, [isDemo, status?.authenticated, workspace?.id, refresh]);
  const demoData = useMemo(
    () =>
      isDemo && site ? demoReport(new URLSearchParams(queryKey), site) : null,
    [isDemo, queryKey, site?.id],
  );
  useEffect(() => {
    if (
      isDemo ||
      !site ||
      !workspace ||
      view === "settings" ||
      view === "account" ||
      view === "projects" ||
      isObservability
    )
      return;
    const controller = new AbortController();
    setReportLoading(true);
    setReportError("");
    setReport(null);
    const query = new URLSearchParams(queryKey);
    query.set("period", period);
    query.delete("view");
    query.delete("site");
    query.delete("workspace");
    api<AnalyticsReport>(
      `/api/workspaces/${workspace.id}/sites/${site.id}/report?${query}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setReport(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setReportError(friendlyError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setReportLoading(false);
      });
    return () => controller.abort();
  }, [
    isDemo,
    site?.id,
    workspace?.id,
    queryKey,
    period,
    refresh,
    view === "settings" ||
      view === "account" ||
      view === "projects" ||
      isObservability,
  ]);
  const data = isDemo ? demoData : report;
  const activeFilters = filters.filter((filter) => params.get(filter.key));
  function onFilter(key: FilterKey, value: string) {
    update({ [key]: value });
  }
  function changeView(next: View) {
    update({ view: next });
    setSidebarOpen(false);
  }
  function onSiteChange(next: Site) {
    setSites((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
    setRefresh((value) => value + 1);
  }

  if (!isDemo && !status && !authError)
    return (
      <div className="app-loading">
        <Brand />
        <div className="loading-dots" />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!isDemo && authError)
    return (
      <div className="app-loading">
        <Brand />
        <div className="load-error">
          <h1>We couldn't reach this installation</h1>
          <p>{authError}</p>
          <div>
            <button className="button primary" onClick={() => void loadAuth()}>
              Try again
            </button>
            <a href="/demo" className="button secondary">
              Explore the demo
            </a>
          </div>
        </div>
      </div>
    );
  if (!isDemo && !status?.authenticated)
    return (
      <>
        <AuthScreen
          key={String(status?.configured)}
          status={status!}
          onSuccess={(codes) => {
            if (codes) setRecoveryCodes(codes);
            window.history.replaceState({}, "", "/app");
            window.dispatchEvent(new PopStateEvent("popstate"));
            void loadAuth();
          }}
        />
        {recoveryCodes.length > 0 && (
          <RecoveryCodes
            codes={recoveryCodes}
            onClose={() => setRecoveryCodes([])}
          />
        )}
      </>
    );

  return (
    <div className="app-shell">
      <header className="console-globalbar">
        <a href="/" aria-label="Analytica home">
          <Brand small />
        </a>
        <span className="console-product-name">Product analytics</span>
        <nav aria-label="Global navigation">
          <a href="/docs">Documentation</a>
          <a href="/demo">Demo</a>
          <button onClick={() => changeView("account")}>
            {isDemo ? "Demo account" : status?.user?.name || "Account"}
          </button>
        </nav>
      </header>
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <a
          className="brand-link"
          href={isDemo ? "/demo" : "/app"}
          aria-label="Analytica overview"
        >
          <Brand small />
        </a>
        <div className="workspace-switch">
          <SelectField
            label="Workspace"
            caption="Workspace"
            className="workspace-select"
            value={workspace?.id ?? ""}
            options={workspaces.map((item) => ({
              value: item.id,
              label: item.name,
              icon: (
                <span className="workspace-avatar" aria-hidden="true">
                  {item.name.slice(0, 1)}
                </span>
              ),
            }))}
            onValueChange={(value) => {
              setSites([]);
              update({
                workspace: value,
                site: null,
                source: null,
                path: null,
                country: null,
                device: null,
                event: null,
              });
            }}
          />
        </div>
        <button
          className={`workspace-manage ${view === "account" ? "selected" : ""}`}
          onClick={() => changeView("account")}
        >
          Workspace & account <Settings size={12} />
        </button>
        <button
          className={`nav-item ${view === "projects" ? "active" : ""}`}
          onClick={() => changeView("projects")}
          aria-current={view === "projects" ? "page" : undefined}
        >
          <LayoutGrid size={18} />
          <span>Projects</span>
        </button>
        <div className="nav-section-label">Project analytics</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => changeView(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "overview" && (
                <span className="nav-shortcut">G O</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-section-label observability-nav-label">
          Observability
        </div>
        <nav aria-label="Observability navigation">
          {observabilityNav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => changeView(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "alerts" && (
                <span className="nav-alert-count">2</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <button
          className={`nav-item ${view === "settings" ? "active" : ""}`}
          onClick={() => changeView("settings")}
        >
          <Settings size={18} />
          <span>Website settings</span>
        </button>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <span>
              Hosted on your terms.<small>Built for Cloudflare.</small>
            </span>
          </div>
          <button
            className="nav-item help-button"
            onClick={() =>
              notify(
                "For installation help, open Website settings and check the tracker snippet, domain, privacy mode, and last received event.",
              )
            }
          >
            <CircleHelp size={17} />
            <span>Help & installation</span>
            <ExternalLink size={13} />
          </button>
          <div className="profile-row">
            <span className="profile-avatar">
              {isDemo ? "A" : (status?.user?.name.slice(0, 1) ?? "A")}
            </span>
            <div>
              <strong>
                {isDemo
                  ? "Alex Morgan"
                  : (status?.user?.name ?? "Your account")}
              </strong>
              <span>
                {isDemo ? "Demo workspace" : (workspace?.role ?? "Member")}
              </span>
            </div>
            {!isDemo && (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={async () => {
                  try {
                    await post("/api/auth/logout");
                    setSites([]);
                    setReport(null);
                    await loadAuth();
                  } catch (err) {
                    notify(friendlyError(err));
                  }
                }}
              >
                <LogOut size={16} />
              </button>
            )}
            {isDemo && <span className="profile-demo">Demo</span>}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Workspace<span>/</span>
            </span>
            <div className="site-switch">
              <SelectField
                label="Project"
                className="project-select"
                value={site?.id ?? ""}
                placeholder="No projects yet"
                options={availableSites.map((item) => ({
                  value: item.id,
                  label: item.name,
                  description: item.domain,
                  icon: <ProjectIcon site={item} />,
                }))}
                onValueChange={(value) =>
                  update({
                    site: value,
                    source: null,
                    path: null,
                    country: null,
                    device: null,
                    event: null,
                  })
                }
              />
            </div>
          </div>
          <div className="topbar-right">
            <span className="connection-label">
              <span className="live-dot" />
              {isDemo ? "Demo environment" : "Live workspace"}
            </span>
            {workspace?.role !== "viewer" && (
              <button
                className="button secondary small"
                onClick={() => setAddSite(true)}
              >
                <Plus size={15} />
                <span>Add project</span>
              </button>
            )}
          </div>
        </header>
        {isDemo && (
          <div className="demo-banner">
            <span>
              <span className="demo-badge">Demo data</span>You're exploring
              sample traffic. Try a date range or click a source.
            </span>
            <a href="/signup">
              Create your account <ArrowRight size={14} />
            </a>
          </div>
        )}
        <main className="main-content" id="main-content">
          <div className="page-heading">
            <div>
              <div className="page-context">
                {view === "projects"
                  ? (workspace?.name ?? "Your workspace")
                  : (site?.name ?? "Your workspace")}
                <span className="context-dot" />
                {view === "settings" || view === "account"
                  ? "Configuration"
                  : "Website analytics"}
              </div>
              <h1>
                {view === "projects"
                  ? "Projects"
                  : view === "overview"
                    ? "Website overview"
                    : view === "settings"
                      ? "Website settings"
                      : view === "account"
                        ? "Workspace & account"
                        : (nav.find((item) => item.id === view)?.label ??
                          observabilityNav.find((item) => item.id === view)
                            ?.label)}
              </h1>
              <p>{viewDescriptions[view]}</p>
            </div>
            <div className="page-actions">
              {view !== "settings" &&
                view !== "account" &&
                view !== "projects" &&
                !isObservability && (
                  <>
                    <button
                      className={`icon-button refresh-button ${reportLoading ? "spinning" : ""}`}
                      aria-label="Refresh report"
                      disabled={reportLoading}
                      onClick={() => {
                        setRefresh((value) => value + 1);
                        if (isDemo) notify("Sample report refreshed.");
                      }}
                    >
                      <RefreshCw size={16} />
                    </button>
                    <SelectField
                      label="Date range"
                      className="date-select"
                      value={period}
                      icon={<CalendarDays size={15} />}
                      onValueChange={(value) => update({ period: value })}
                      options={[
                        { value: "7d", label: "Last 7 days" },
                        { value: "30d", label: "Last 30 days" },
                        { value: "90d", label: "Last 90 days" },
                      ]}
                    />
                  </>
                )}
            </div>
          </div>
          {view !== "settings" &&
            view !== "account" &&
            view !== "projects" &&
            !isObservability &&
            site && (
              <div className="report-toolbar">
                <div className="filter-chips">
                  {activeFilters.length ? (
                    <>
                      {activeFilters.map((filter) => (
                        <button
                          className="filter-chip"
                          key={filter.key}
                          onClick={() => update({ [filter.key]: null })}
                        >
                          <span>{filter.label}:</span> {params.get(filter.key)}
                          <X size={12} />
                        </button>
                      ))}
                      <button
                        className="text-button clear-filters"
                        onClick={() =>
                          update(
                            Object.fromEntries(
                              filters.map((filter) => [filter.key, null]),
                            ),
                          )
                        }
                      >
                        Clear all
                      </button>
                    </>
                  ) : (
                    <span className="all-traffic">
                      <Globe size={14} />
                      All traffic
                    </span>
                  )}
                </div>
                <span className="report-freshness">
                  {isDemo
                    ? "Sample data"
                    : data?.lastEventAt
                      ? `Last event ${new Date(data.lastEventAt).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}`
                      : "Waiting for traffic"}
                  <span className="context-dot" />
                  {site.timezone}
                </span>
              </div>
            )}
          {sitesError && (
            <div role="alert" className="error-panel">
              <strong>We couldn't load your websites.</strong>
              <p>{sitesError}</p>
              <button
                className="button secondary small"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          )}
          {!site &&
            !sitesLoading &&
            !sitesError &&
            view !== "account" &&
            view !== "projects" && (
              <section className="panel welcome-empty">
                <span className="empty-icon">
                  <Globe size={28} />
                </span>
                <h2>Your first website starts here</h2>
                <p>
                  Add a website, install a small snippet, and see which visits
                  turn into action.
                </p>
                {workspace?.role !== "viewer" ? (
                  <button
                    className="button primary"
                    onClick={() => setAddSite(true)}
                  >
                    <Plus size={16} />
                    Add your first website
                  </button>
                ) : (
                  <p>Ask your workspace owner to add a website.</p>
                )}
                <a href="/demo" className="subtle-link">
                  Explore a sample report <ArrowRight size={15} />
                </a>
              </section>
            )}
          {(sitesLoading || reportLoading) &&
            !data &&
            view !== "account" &&
            view !== "projects" &&
            !isObservability && (
              <div
                className="report-skeleton"
                aria-label="Loading report"
                role="status"
              >
                <div className="skeleton-stats">
                  {[0, 1, 2, 3].map((index) => (
                    <div key={index} />
                  ))}
                </div>
                <div className="skeleton-chart" />
                <span className="sr-only">Loading your report…</span>
              </div>
            )}
          {site &&
            reportError &&
            view !== "settings" &&
            view !== "account" &&
            view !== "projects" &&
            !isObservability && (
              <div role="alert" className="error-panel">
                <strong>This report couldn't be loaded.</strong>
                <p>{reportError}</p>
                <button
                  className="button secondary small"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  Try again
                </button>
              </div>
            )}
          {view === "projects" && (
            <ProjectsView
              sites={availableSites}
              workspace={workspace}
              loading={sitesLoading}
              demo={isDemo}
              onAdd={() => setAddSite(true)}
              onOpen={(next) =>
                update({
                  site: next.id,
                  view: "overview",
                  source: null,
                  path: null,
                  country: null,
                  device: null,
                  event: null,
                })
              }
            />
          )}
          {view === "account" && (
            <AccountView
              key={workspace?.id}
              workspace={workspace}
              demo={isDemo}
              onCodes={setRecoveryCodes}
              onSignedOut={async () => {
                setSites([]);
                setReport(null);
                await loadAuth();
              }}
              onCreated={async (next) => {
                await loadAuth();
                setSites([]);
                update({
                  workspace: next.id,
                  site: null,
                  view: "account",
                  source: null,
                  path: null,
                  country: null,
                  device: null,
                  event: null,
                });
                notify("Workspace created. Add a website when you are ready.");
              }}
              notify={notify}
            />
          )}
          {site && workspace && view === "settings" && (
            <SettingsView
              key={site.id}
              site={site}
              workspace={workspace}
              demo={isDemo}
              onSiteChange={onSiteChange}
              notify={notify}
            />
          )}
          {site && workspace && isObservability && (
            <ObservabilityView
              kind={view as ObservabilityKind}
              site={site}
              workspaceId={workspace.id}
              demo={isDemo}
              notify={notify}
            />
          )}
          {site &&
            view !== "settings" &&
            view !== "account" &&
            view !== "projects" &&
            !isObservability &&
            data &&
            !reportError && (
              <>
                {site.status !== "active" && (
                  <div className="notice-panel">
                    {site.status === "paused"
                      ? "Collection is paused for this website."
                      : "This website is being deleted. Collection has stopped."}
                  </div>
                )}
                {view === "funnels" ? (
                  <FunnelsView
                    key={site.id}
                    site={site}
                    workspace={workspace!}
                    demo={isDemo}
                    period={period}
                    notify={notify}
                  />
                ) : view === "journeys" ? (
                  <JourneysView
                    key={site.id}
                    site={site}
                    workspace={workspace!}
                    demo={isDemo}
                    notify={notify}
                  />
                ) : view === "revenue" ? (
                  <RevenueView
                    key={site.id}
                    site={site}
                    workspace={workspace!}
                    demo={isDemo}
                    from={data.range.from}
                    to={data.range.to}
                    notify={notify}
                  />
                ) : (
                  <>
                    <section
                      className="stats-strip"
                      aria-label="Period summary"
                    >
                      <Stat
                        label="Pageviews"
                        value={data.current.pageviews}
                        previous={data.previous.pageviews}
                      />
                      <Stat
                        label={
                          data.privacyMode === "aggregate"
                            ? "Document sessions"
                            : "Sessions"
                        }
                        value={data.current.sessions}
                        previous={data.previous.sessions}
                        note={
                          data.privacyMode === "aggregate"
                            ? "In-memory document IDs reset on full navigation. This is an estimate, not a count of people."
                            : "Sessions starting in the selected period."
                        }
                      />
                      <Stat
                        label="Goals completed"
                        value={data.current.goals}
                        previous={data.previous.goals}
                      />
                      <Stat
                        label="Average engagement"
                        value={data.current.avgDuration}
                        previous={data.previous.avgDuration}
                        display={formatDuration}
                        note="Visible engagement time reported by the tracker. This is not a measure of attention."
                      />
                    </section>
                    <Chart report={data} metric={metric} onMetric={setMetric} />
                    {data.current.pageviews === 0 && (
                      <div className="no-traffic-panel">
                        <div>
                          <strong>No visits in this period.</strong>
                          <p>
                            {activeFilters.length
                              ? "Try removing a filter or choosing a longer date range."
                              : "We haven't received a pageview in this range. Check your snippet and website domain."}
                          </p>
                        </div>
                        <button
                          className="button secondary small"
                          onClick={() =>
                            activeFilters.length
                              ? update(
                                  Object.fromEntries(
                                    filters.map((filter) => [filter.key, null]),
                                  ),
                                )
                              : changeView("settings")
                          }
                        >
                          {activeFilters.length
                            ? "Clear filters"
                            : "Check installation"}
                        </button>
                      </div>
                    )}
                    {view === "overview" && (
                      <>
                        <div className="report-grid">
                          <Breakdown
                            title="Top sources"
                            rows={data.sources}
                            filterKey="source"
                            kind="source"
                            total={data.current.pageviews}
                            onFilter={onFilter}
                          />
                          <Breakdown
                            title="Top pages"
                            rows={data.pages}
                            filterKey="path"
                            kind="page"
                            total={data.current.pageviews}
                            onFilter={onFilter}
                          />
                        </div>
                        <div className="report-grid three-columns">
                          <Breakdown
                            title="Countries"
                            rows={data.countries}
                            filterKey="country"
                            kind="country"
                            onFilter={onFilter}
                            limit={5}
                          />
                          <Breakdown
                            title="Devices"
                            rows={data.devices}
                            filterKey="device"
                            kind="device"
                            onFilter={onFilter}
                            limit={5}
                          />
                          <Breakdown
                            title="Tracked events"
                            rows={data.events}
                            filterKey="event"
                            onFilter={onFilter}
                            limit={5}
                          />
                        </div>
                      </>
                    )}
                    {view === "acquisition" && (
                      <>
                        <div className="section-context">
                          <div>
                            <h2>Where your traffic begins</h2>
                            <p>
                              Click a source to see its pages, countries, and
                              activity.
                            </p>
                          </div>
                          <span className="small-pill">
                            {data.sources.length} sources
                          </span>
                        </div>
                        <Breakdown
                          title="All sources"
                          rows={data.sources}
                          filterKey="source"
                          kind="source"
                          total={data.current.pageviews}
                          onFilter={onFilter}
                          limit={100}
                          full
                        />
                        <div className="report-grid">
                          <Breakdown
                            title="Countries"
                            rows={data.countries}
                            filterKey="country"
                            kind="country"
                            onFilter={onFilter}
                          />
                          <Breakdown
                            title="Landing and visited pages"
                            rows={data.pages}
                            filterKey="path"
                            kind="page"
                            onFilter={onFilter}
                          />
                        </div>
                      </>
                    )}
                    {view === "pages" && (
                      <>
                        <div className="section-context">
                          <div>
                            <h2>The pages people spend their visits on</h2>
                            <p>
                              Pageviews count events inside this period,
                              including sessions that began earlier.
                            </p>
                          </div>
                        </div>
                        <Breakdown
                          title="All visited pages"
                          rows={data.pages}
                          filterKey="path"
                          kind="page"
                          onFilter={onFilter}
                          limit={100}
                          full
                        />
                      </>
                    )}
                    {view === "events" && (
                      <>
                        <div className="section-context">
                          <div>
                            <h2>Actions worth following</h2>
                            <p>
                              Goals are named actions sent by your website.
                              Click one to filter this report.
                            </p>
                          </div>
                          <button
                            className="button secondary small"
                            onClick={() => changeView("settings")}
                          >
                            <Plus size={14} />
                            Install an event
                          </button>
                        </div>
                        <Breakdown
                          title="Custom events"
                          rows={data.events}
                          filterKey="event"
                          onFilter={onFilter}
                          limit={100}
                          full
                        />
                        <div className="event-instructions">
                          <MousePointerClick size={21} />
                          <div>
                            <strong>
                              Turn an action into a useful signal.
                            </strong>
                            <p>
                              Call{" "}
                              <code>window.analytica('goal', 'signup')</code>{" "}
                              after a successful signup. Name events
                              consistently so their totals stay comparable.
                            </p>
                          </div>
                          <CopyButton value="window.analytica('goal', 'signup')" />
                        </div>
                      </>
                    )}
                  </>
                )}
                <footer className="report-footer">
                  <span>
                    {isDemo
                      ? "Synthetic traffic for exploration. No customer data."
                      : data.privacyMode === "aggregate"
                        ? "Aggregate measurement. No persistent visitor identifiers."
                        : "Attribution measurement. First-party identifiers require site consent."}
                  </span>
                  <span>
                    Made for a clearer picture
                    <span className="footer-dot">.</span>
                  </span>
                </footer>
              </>
            )}
        </main>
      </div>
      {addSite && workspace && (
        <SiteModal
          workspaceId={workspace.id}
          demo={isDemo}
          onNotice={notify}
          onClose={() => setAddSite(false)}
          onCreated={(next) => {
            setSites((current) => [...current, next]);
            update({ site: next.id, view: "settings" });
            setAddSite(false);
            notify("Project added. Copy its tracking snippet to get started.");
          }}
        />
      )}
      {recoveryCodes.length > 0 && (
        <RecoveryCodes
          codes={recoveryCodes}
          onClose={() => setRecoveryCodes([])}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
