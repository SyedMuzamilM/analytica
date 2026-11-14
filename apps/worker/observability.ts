import { Hono, type Context } from "hono";
import { boundedJson, safeTag } from "./analytics";
import { requireAuth, requireWorkspace } from "./auth";
import type { AppEnv } from "./env";

type JsonRecord = Record<string, unknown>;
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
const levels = new Set<LogLevel>([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);
const secretKey =
  /password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|credit|card/i;
const MAX_STRING = 8000;
const MAX_JSON = 24000;

const asRecord = (value: unknown): JsonRecord | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (typeof value === "number" || typeof value === "boolean" || value === null)
    return value;
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => redact(item, depth + 1));
  const object = asRecord(value);
  if (!object) return undefined;
  const result: JsonRecord = {};
  for (const [key, item] of Object.entries(object).slice(0, 200)) {
    result[key] = secretKey.test(key) ? "[REDACTED]" : redact(item, depth + 1);
  }
  return result;
}

function json(value: unknown, max = MAX_JSON): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(redact(value)).slice(0, max);
  } catch {
    return JSON.stringify({ value: "[UNSERIALIZABLE]" });
  }
}

function parsedJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown, max = 200): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed)
    ? parsed
    : undefined;
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function bearer(request: Request): string | undefined {
  const value = request.headers.get("authorization") || "";
  const token = value.replace(/^Bearer\s+/i, "").trim();
  return /^an_[0-9a-f]{64}$/.test(token) ? token : undefined;
}

async function ingestionKey(c: Context<AppEnv>) {
  const token = bearer(c.req.raw);
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT k.workspace_id,k.site_id,k.namespace,s.status
     FROM site_api_keys k JOIN sites s ON s.workspace_id=k.workspace_id AND s.id=k.site_id
     WHERE k.token_hash=? AND k.revoked_at IS NULL AND s.status='active'`,
  )
    .bind(await digest(token))
    .first<{
      workspace_id: string;
      site_id: string;
      namespace: string;
      status: string;
    }>();
}

function siteFromContext(c: Context<AppEnv>) {
  return c.env.DB.prepare(
    "SELECT * FROM sites WHERE workspace_id=? AND id=? AND status!='deleting'",
  )
    .bind(c.get("workspace").id, c.req.param("sid"))
    .first<{
      id: string;
      workspace_id: string;
      name: string;
      domain: string;
      timezone: string;
    }>();
}

function timestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000
      ? Math.round(value)
      : Math.round(value * 1000);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function metaValue(
  meta: JsonRecord | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = stringValue(meta?.[key]);
    if (value) return value;
  }
  return undefined;
}

interface NormalizedLog {
  id: string;
  ts: number;
  level: LogLevel;
  message: string;
  namespace?: string;
  service?: string;
  environment?: string;
  region?: string;
  release?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  contextJson: string | null;
  metaJson: string | null;
  errorJson: string | null;
  rawJson: string;
}

async function normalizeLog(value: unknown): Promise<NormalizedLog | null> {
  const entry = asRecord(value);
  if (
    !entry ||
    !levels.has(entry.level as LogLevel) ||
    typeof entry.message !== "string"
  )
    return null;
  const context = asRecord(entry.context);
  const meta = asRecord(entry.meta);
  const error = asRecord(entry.error);
  const raw = redact(entry) as JsonRecord;
  const ts = timestamp(entry.timestamp);
  const requestId = stringValue(context?.requestId);
  const traceId = stringValue(context?.traceId);
  const spanId = stringValue(context?.spanId);
  const service =
    metaValue(meta, "service", "service.name") || stringValue(entry.namespace);
  const eventId = stringValue(meta?.eventId, 120);
  const id =
    eventId ||
    (
      await digest(
        `${ts}|${entry.level}|${entry.message}|${requestId || ""}|${traceId || ""}|${JSON.stringify(raw)}`,
      )
    ).slice(0, 40);
  return {
    id,
    ts,
    level: entry.level as LogLevel,
    message: entry.message.slice(0, MAX_STRING),
    namespace: stringValue(entry.namespace),
    service,
    environment: metaValue(
      meta,
      "environment",
      "deployment.environment",
      "deployment.environment.name",
    ),
    region: metaValue(meta, "region", "cloud.region"),
    release: metaValue(meta, "release", "service.version"),
    requestId,
    traceId,
    spanId,
    contextJson: json(context),
    metaJson: json(meta),
    errorJson: json(error),
    rawJson: json(raw, 48000) || "{}",
  };
}

interface NormalizedAudit {
  id: string;
  ts: number;
  action: string;
  outcome: "success" | "failure" | "denied";
  traceId?: string;
  resourceJson: string;
  actorJson: string | null;
  tenantJson: string | null;
  sessionJson: string | null;
  changesJson: string | null;
  detailsJson: string | null;
  rawJson: string;
}

async function normalizeAudit(value: unknown): Promise<NormalizedAudit | null> {
  const record = asRecord(value);
  const resource = asRecord(record?.resource);
  if (
    !record ||
    typeof record.action !== "string" ||
    !resource?.type ||
    !resource.id
  )
    return null;
  const outcome =
    record.outcome === "failure" || record.outcome === "denied"
      ? record.outcome
      : "success";
  const raw = redact(record) as JsonRecord;
  const id =
    stringValue(record.eventId, 120) ||
    (
      await digest(
        `${record.timestamp || ""}|${record.action}|${JSON.stringify(raw)}`,
      )
    ).slice(0, 40);
  return {
    id,
    ts: timestamp(record.timestamp),
    action: record.action.slice(0, 200),
    outcome,
    traceId: stringValue(record.traceId),
    resourceJson: json(resource, 12000) || "{}",
    actorJson: json(record.actor),
    tenantJson: json(record.tenant),
    sessionJson: json(record.session),
    changesJson: json(record.changes),
    detailsJson: json(record.details),
    rawJson: json(raw, 48000) || "{}",
  };
}

function otelValue(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
    if (record[key] !== undefined) return record[key];
  }
  if (Array.isArray(record.arrayValue)) return record.arrayValue.map(otelValue);
  if (record.kvlistValue) return record.kvlistValue;
  return redact(value);
}

function attributes(list: unknown): JsonRecord {
  if (!Array.isArray(list)) return {};
  return Object.fromEntries(
    list.slice(0, 200).flatMap((item) => {
      const pair = asRecord(item);
      const key = stringValue(pair?.key);
      return key ? [[key, otelValue(pair?.value)]] : [];
    }),
  );
}

function nanoToMs(value: unknown): number {
  if (typeof value === "number")
    return value > 10_000_000_000_000 ? value / 1_000_000 : value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed / 1_000_000;
  }
  return Date.now();
}

async function saveLogs(
  c: Context<AppEnv>,
  key: { workspace_id: string; site_id: string },
  values: unknown[],
  receivedAt: number,
) {
  const rows = (
    await Promise.all(values.slice(0, 100).map(normalizeLog))
  ).filter((value): value is NormalizedLog => !!value);
  if (!rows.length) return 0;
  await c.env.DB.batch(
    rows.map((row) =>
      c.env.DB.prepare(
        `INSERT INTO observability_logs(workspace_id,site_id,id,ts,received_at,level,message,namespace,service,environment,region,release,request_id,trace_id,span_id,context_json,meta_json,error_json,raw_json)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,site_id,id) DO NOTHING`,
      ).bind(
        key.workspace_id,
        key.site_id,
        row.id,
        row.ts,
        receivedAt,
        row.level,
        row.message,
        row.namespace || null,
        row.service || null,
        row.environment || null,
        row.region || null,
        row.release || null,
        row.requestId || null,
        row.traceId || null,
        row.spanId || null,
        row.contextJson,
        row.metaJson,
        row.errorJson,
        row.rawJson,
      ),
    ),
  );
  return rows.length;
}

async function saveAudits(
  c: Context<AppEnv>,
  key: { workspace_id: string; site_id: string },
  values: unknown[],
  receivedAt: number,
) {
  const rows = (
    await Promise.all(values.slice(0, 100).map(normalizeAudit))
  ).filter((value): value is NormalizedAudit => !!value);
  if (!rows.length) return 0;
  await c.env.DB.batch(
    rows.map((row) =>
      c.env.DB.prepare(
        `INSERT INTO observability_audit(workspace_id,site_id,event_id,ts,received_at,action,outcome,trace_id,resource_json,actor_json,tenant_json,session_json,changes_json,details_json,raw_json)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,site_id,event_id) DO NOTHING`,
      ).bind(
        key.workspace_id,
        key.site_id,
        row.id,
        row.ts,
        receivedAt,
        row.action,
        row.outcome,
        row.traceId || null,
        row.resourceJson,
        row.actorJson,
        row.tenantJson,
        row.sessionJson,
        row.changesJson,
        row.detailsJson,
        row.rawJson,
      ),
    ),
  );
  return rows.length;
}

async function saveOtelSpans(
  c: Context<AppEnv>,
  key: { workspace_id: string; site_id: string },
  body: unknown,
  receivedAt: number,
) {
  const root = asRecord(body);
  const resourceSpans = Array.isArray(root?.resourceSpans)
    ? root.resourceSpans
    : [];
  const rows: Array<Record<string, unknown>> = [];
  for (const resourceSpan of resourceSpans.slice(0, 20)) {
    const resource = asRecord(resourceSpan)?.resource as unknown;
    const resourceAttributes = attributes(asRecord(resource)?.attributes);
    const service = stringValue(resourceAttributes["service.name"]);
    const environment = stringValue(
      resourceAttributes["deployment.environment"] ||
        resourceAttributes["deployment.environment.name"],
    );
    const scopeSpans = Array.isArray(asRecord(resourceSpan)?.scopeSpans)
      ? (asRecord(resourceSpan)?.scopeSpans as unknown[])
      : [];
    for (const scope of scopeSpans.slice(0, 20)) {
      const spans = Array.isArray(asRecord(scope)?.spans)
        ? (asRecord(scope)?.spans as unknown[])
        : [];
      for (const rawSpan of spans.slice(0, 500)) {
        const span = asRecord(rawSpan);
        const traceId = stringValue(span?.traceId, 80);
        const spanId = stringValue(span?.spanId, 80);
        if (!traceId || !spanId || !stringValue(span?.name)) continue;
        const startMs = nanoToMs(span?.startTimeUnixNano);
        const endMs = nanoToMs(span?.endTimeUnixNano);
        const durationMs = Math.max(0, Math.min(86_400_000, endMs - startMs));
        const status = asRecord(span?.status);
        rows.push({
          traceId,
          spanId,
          parentSpanId: stringValue(span?.parentSpanId, 80),
          name: stringValue(span?.name, 500)!,
          service,
          environment,
          startMs,
          durationMs,
          status:
            Number(status?.code) === 2
              ? "error"
              : Number(status?.code) === 1
                ? "ok"
                : "unset",
          attributes: attributes(span?.attributes),
          raw: redact(span),
        });
      }
    }
  }
  if (!rows.length) return 0;
  await c.env.DB.batch(
    rows.map((row) =>
      c.env.DB.prepare(
        `INSERT INTO observability_spans(workspace_id,site_id,trace_id,span_id,parent_span_id,name,service,environment,start_ts,duration_ms,status,attributes_json,raw_json,received_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,site_id,trace_id,span_id) DO UPDATE SET duration_ms=excluded.duration_ms,status=excluded.status,attributes_json=excluded.attributes_json,raw_json=excluded.raw_json,received_at=excluded.received_at`,
      ).bind(
        key.workspace_id,
        key.site_id,
        row.traceId,
        row.spanId,
        row.parentSpanId || null,
        row.name,
        row.service || null,
        row.environment || null,
        row.startMs,
        row.durationMs,
        row.status,
        json(row.attributes),
        json(row.raw, 48000) || "{}",
        receivedAt,
      ),
    ),
  );
  return rows.length;
}

export const observabilityIngestRoutes = new Hono<AppEnv>();
observabilityIngestRoutes.post("/observability/ingest", async (c) => {
  const key = await ingestionKey(c);
  if (!key || !["api:aegislog", "api:observability"].includes(key.namespace))
    return c.json({ error: "invalid_api_key" }, 401);
  const body = await boundedJson(c.req.raw, 65536).catch(() => null);
  const input = asRecord(body);
  if (!input) return c.json({ error: "invalid_json" }, 400);
  const receivedAt = Date.now();
  const logs = Array.isArray(input.logs) ? input.logs : [];
  const audit = Array.isArray(input.audit) ? input.audit : [];
  const [logCount, auditCount] = await Promise.all([
    saveLogs(c, key, logs, receivedAt),
    saveAudits(c, key, audit, receivedAt),
  ]);
  return c.json({ accepted: true, logs: logCount, audit: auditCount }, 202);
});

observabilityIngestRoutes.post("/observability/otlp/traces", async (c) => {
  const key = await ingestionKey(c);
  if (!key || !["api:aegislog", "api:observability"].includes(key.namespace))
    return c.json({ error: "invalid_api_key" }, 401);
  const body = await boundedJson(c.req.raw, 65536).catch(() => null);
  if (!body) return c.json({ error: "invalid_json" }, 400);
  const accepted = await saveOtelSpans(c, key, body, Date.now());
  return c.json({ accepted: true, spans: accepted }, 202);
});

export const observabilityRoutes = new Hono<AppEnv>();
observabilityRoutes.use("/workspaces/*", requireAuth);
observabilityRoutes.use("/workspaces/:wid/*", requireWorkspace("viewer"));

observabilityRoutes.get(
  "/workspaces/:wid/sites/:sid/observability/connection",
  async (c) => {
    const site = await siteFromContext(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    const origin = c.env.APP_ORIGIN || new URL(c.req.url).origin;
    return c.json({
      ingestUrl: `${origin}/v1/observability/ingest`,
      tracesUrl: `${origin}/v1/observability/otlp/traces`,
      namespace: "aegislog",
      serviceExample: "your-service-name",
      setup: {
        package: "@aegislog/transports",
        snippet: `new HttpBatchSink({ url: "${origin}/v1/observability/ingest", headers: { Authorization: "Bearer <server-key>" } })`,
      },
    });
  },
);

observabilityRoutes.get(
  "/workspaces/:wid/sites/:sid/observability/overview",
  async (c) => {
    const site = await siteFromContext(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    const from = timestamp(c.req.query("from"), Date.now() - 86_400_000);
    const to = timestamp(c.req.query("to"), Date.now());
    const bind = [c.get("workspace").id, c.req.param("sid"), from, to];
    const [
      levelsResult,
      servicesResult,
      logsResult,
      tracesResult,
      auditResult,
    ] = await Promise.all([
      c.env.DB.prepare(
        "SELECT level,COUNT(*) AS count FROM observability_logs WHERE workspace_id=? AND site_id=? AND ts>=? AND ts<? GROUP BY level ORDER BY count DESC",
      )
        .bind(...bind)
        .all(),
      c.env.DB.prepare(
        "SELECT COALESCE(service,namespace,'unknown') AS service,COUNT(*) AS count FROM observability_logs WHERE workspace_id=? AND site_id=? AND ts>=? AND ts<? GROUP BY service ORDER BY count DESC LIMIT 20",
      )
        .bind(...bind)
        .all(),
      c.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM observability_logs WHERE workspace_id=? AND site_id=? AND ts>=? AND ts<?",
      )
        .bind(...bind)
        .first<{ count: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(DISTINCT trace_id) AS count FROM observability_spans WHERE workspace_id=? AND site_id=? AND start_ts>=? AND start_ts<?",
      )
        .bind(...bind)
        .first<{ count: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM observability_audit WHERE workspace_id=? AND site_id=? AND ts>=? AND ts<?",
      )
        .bind(...bind)
        .first<{ count: number }>(),
    ]);
    return c.json({
      from,
      to,
      logs: logsResult?.count ?? 0,
      traces: tracesResult?.count ?? 0,
      audit: auditResult?.count ?? 0,
      levels: levelsResult.results,
      services: servicesResult.results,
    });
  },
);

observabilityRoutes.get(
  "/workspaces/:wid/sites/:sid/observability/logs",
  async (c) => {
    const site = await siteFromContext(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    const limit = Math.min(
      Math.max(Number(c.req.query("limit") || 100), 1),
      200,
    );
    const values: unknown[] = [c.get("workspace").id, c.req.param("sid")];
    const where = ["workspace_id=?", "site_id=?"];
    const from = c.req.query("from");
    const to = c.req.query("to");
    const level = c.req.query("level");
    const service = c.req.query("service");
    const traceId = c.req.query("traceId");
    const query = c.req.query("q");
    if (from) {
      where.push("ts>=?");
      values.push(timestamp(from));
    }
    if (to) {
      where.push("ts<?");
      values.push(timestamp(to));
    }
    if (level && levels.has(level as LogLevel)) {
      where.push("level=?");
      values.push(level);
    }
    if (service) {
      where.push("(service=? OR namespace=?)");
      values.push(safeTag(service, 100), safeTag(service, 100));
    }
    if (traceId) {
      where.push("trace_id=?");
      values.push(safeTag(traceId, 100));
    }
    if (query) {
      where.push("(message LIKE ? OR raw_json LIKE ?)");
      values.push(`%${safeTag(query, 200)}%`, `%${safeTag(query, 200)}%`);
    }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM observability_logs WHERE ${where.join(" AND ")} ORDER BY ts DESC LIMIT ?`,
    )
      .bind(...values, limit)
      .all();
    return c.json({ results: rows.results.map(mapLog), limit });
  },
);

observabilityRoutes.get(
  "/workspaces/:wid/sites/:sid/observability/audit",
  async (c) => {
    const site = await siteFromContext(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    const limit = Math.min(
      Math.max(Number(c.req.query("limit") || 100), 1),
      200,
    );
    const rows = await c.env.DB.prepare(
      "SELECT * FROM observability_audit WHERE workspace_id=? AND site_id=? ORDER BY ts DESC LIMIT ?",
    )
      .bind(c.get("workspace").id, c.req.param("sid"), limit)
      .all();
    return c.json({ results: rows.results.map(mapAudit), limit });
  },
);

observabilityRoutes.get(
  "/workspaces/:wid/sites/:sid/observability/traces",
  async (c) => {
    const site = await siteFromContext(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    const limit = Math.min(
      Math.max(Number(c.req.query("limit") || 50), 1),
      100,
    );
    const rows = await c.env.DB.prepare(
      `SELECT * FROM observability_spans WHERE workspace_id=? AND site_id=? AND trace_id IN
      (SELECT trace_id FROM observability_spans WHERE workspace_id=? AND site_id=? ORDER BY start_ts DESC LIMIT ?)
      ORDER BY start_ts ASC LIMIT ?`,
    )
      .bind(
        c.get("workspace").id,
        c.req.param("sid"),
        c.get("workspace").id,
        c.req.param("sid"),
        limit,
        limit * 50,
      )
      .all();
    const grouped = new Map<string, unknown[]>();
    for (const row of rows.results) {
      const traceId = String((row as JsonRecord).trace_id);
      const list = grouped.get(traceId) || [];
      list.push(mapSpan(row as JsonRecord));
      grouped.set(traceId, list);
    }
    return c.json({
      results: [...grouped].map(([traceId, spans]) => ({ traceId, spans })),
    });
  },
);

observabilityRoutes.get(
  "/workspaces/:wid/sites/:sid/observability/services",
  async (c) => {
    const site = await siteFromContext(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    const rows = await c.env.DB.prepare(
      `SELECT COALESCE(service,namespace,'unknown') AS service,
      COUNT(*) AS logs,
      SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END) AS errors,
      MAX(ts) AS last_seen
     FROM observability_logs WHERE workspace_id=? AND site_id=? GROUP BY service ORDER BY errors DESC,logs DESC LIMIT 100`,
    )
      .bind(c.get("workspace").id, c.req.param("sid"))
      .all();
    return c.json({ results: rows.results });
  },
);

observabilityRoutes.get(
  "/workspaces/:wid/sites/:sid/observability/alerts",
  async (c) => {
    const site = await siteFromContext(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    const rows = await c.env.DB.prepare(
      `SELECT i.*,r.name,r.severity,r.threshold,r.window_seconds FROM observability_alert_incidents i
     JOIN observability_alert_rules r ON r.id=i.rule_id
     WHERE i.workspace_id=? AND i.site_id=? ORDER BY i.started_at DESC LIMIT 100`,
    )
      .bind(c.get("workspace").id, c.req.param("sid"))
      .all();
    return c.json({ results: rows.results });
  },
);

function mapLog(row: JsonRecord) {
  return {
    id: row.id,
    timestamp: row.ts,
    receivedAt: row.received_at,
    level: row.level,
    message: row.message,
    namespace: row.namespace,
    service: row.service,
    environment: row.environment,
    region: row.region,
    release: row.release,
    requestId: row.request_id,
    traceId: row.trace_id,
    spanId: row.span_id,
    context: parsedJson(String(row.context_json || "")),
    meta: parsedJson(String(row.meta_json || "")),
    error: parsedJson(String(row.error_json || "")),
    raw: parsedJson(String(row.raw_json || "{}")),
  };
}

function mapAudit(row: JsonRecord) {
  return {
    eventId: row.event_id,
    timestamp: row.ts,
    action: row.action,
    outcome: row.outcome,
    traceId: row.trace_id,
    resource: parsedJson(String(row.resource_json || "{}")),
    actor: parsedJson(String(row.actor_json || "")),
    tenant: parsedJson(String(row.tenant_json || "")),
    session: parsedJson(String(row.session_json || "")),
    changes: parsedJson(String(row.changes_json || "")),
    details: parsedJson(String(row.details_json || "")),
    raw: parsedJson(String(row.raw_json || "{}")),
  };
}

function mapSpan(row: JsonRecord) {
  return {
    traceId: row.trace_id,
    spanId: row.span_id,
    parentSpanId: row.parent_span_id,
    name: row.name,
    service: row.service,
    environment: row.environment,
    start: row.start_ts,
    durationMs: row.duration_ms,
    status: row.status,
    attributes: parsedJson(String(row.attributes_json || "{}")),
    raw: parsedJson(String(row.raw_json || "{}")),
  };
}
