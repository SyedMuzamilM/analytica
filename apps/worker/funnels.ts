import { Hono, type Context } from "hono";
import type { AppEnv, Bindings } from "./env";
import { requireAuth, requireWorkspace } from "./auth";
import { boundedJson, safeTag, type SiteRecord } from "./analytics";
import { resolveReportRange } from "./reports";

const DAY = 86_400_000;
const WINDOW = 30 * 60_000;
const MAX_EVENTS = 20_000;
export interface FunnelStep {
  type: "pageview" | "goal";
  value: string;
}
interface FunnelRow {
  id: string;
  name: string;
  steps: string;
  created_at: number;
}
interface FunnelEvent {
  id: string;
  session_id: string;
  ts: number;
  sequence: number;
  type: string;
  path: string;
  name: string | null;
}
export const funnelRoutes = new Hono<AppEnv>();
funnelRoutes.use("/workspaces/*", requireAuth);
funnelRoutes.use("/workspaces/:wid/*", requireWorkspace("viewer"));

async function scopedSite(c: Context<AppEnv>) {
  return c.env.DB.prepare(
    "SELECT * FROM sites WHERE workspace_id=? AND id=? AND status!='deleting'",
  )
    .bind(c.get("workspace").id, c.req.param("sid"))
    .first<SiteRecord>();
}
function parseSteps(input: unknown): FunnelStep[] | null {
  if (!Array.isArray(input) || input.length < 2 || input.length > 8)
    return null;
  const steps: FunnelStep[] = [];
  for (const step of input) {
    if (!step || typeof step !== "object" || Array.isArray(step)) return null;
    const { type, value } = step as Record<string, unknown>;
    if (
      (type !== "pageview" && type !== "goal") ||
      typeof value !== "string" ||
      value !== value.trim() ||
      !value ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      return null;
    if (
      type === "pageview" &&
      (!value.startsWith("/") ||
        value.startsWith("//") ||
        value.length > 500 ||
        /[?#]/.test(value))
    )
      return null;
    if (
      type === "goal" &&
      (value.length > 64 ||
        /@|(?:password|access_token|api_key|secret)\s*[=:]/i.test(value))
    )
      return null;
    steps.push({ type, value });
  }
  return steps;
}
function publicFunnel(row: FunnelRow) {
  return {
    id: row.id,
    name: row.name,
    steps: JSON.parse(row.steps) as FunnelStep[],
    createdAt: row.created_at,
    windowMinutes: 30,
  };
}

/** Each session starts one attempt at its first first-step event. One event advances at most one step. */
export function countFunnel(events: FunnelEvent[], steps: FunnelStep[]) {
  const counts = steps.map(() => 0);
  const attempts = new Map<string, { startedAt: number; next: number }>();
  for (const event of events) {
    const prior = attempts.get(event.session_id);
    const next = prior?.next ?? 0;
    if (next >= steps.length || (prior && event.ts - prior.startedAt > WINDOW))
      continue;
    const step = steps[next];
    if (
      event.type !== step.type ||
      (step.type === "pageview" ? event.path : event.name) !== step.value
    )
      continue;
    counts[next]++;
    attempts.set(event.session_id, {
      startedAt: prior?.startedAt ?? event.ts,
      next: next + 1,
    });
  }
  return {
    steps: steps.map((step, index) => ({
      ...step,
      sessions: counts[index],
      conversionFromPrevious:
        index === 0
          ? null
          : counts[index - 1]
            ? counts[index] / counts[index - 1]
            : 0,
    })),
    sessions: counts[0],
    windowMinutes: 30,
  };
}
export async function buildFunnelReport(
  db: D1Database,
  site: SiteRecord,
  steps: FunnelStep[],
  query: Record<string, string>,
  now = Date.now(),
) {
  const range = resolveReportRange(query, site.timezone, now);
  const filters: string[] = [],
    params: string[] = [];
  const included = new Set<string>();
  // Deduplicate matching predicates without deduplicating repeated funnel steps.
  for (const step of steps) {
    const condition =
      step.type === "pageview"
        ? "(e.type='pageview' AND e.path=?)"
        : "(e.type='goal' AND e.name=?)";
    const key = `${step.type}:${step.value}`;
    if (included.has(key)) continue;
    included.add(key);
    filters.push(condition);
    params.push(step.value);
  }
  const rows = await db
    .prepare(
      `SELECT e.id,e.session_id,e.ts,e.sequence,e.type,e.path,e.name
    FROM analytics_events e WHERE e.workspace_id=? AND e.site_id=? AND e.privacy_mode='attribution'
    AND e.ts>=? AND e.ts<? AND e.received_at>=? AND NOT EXISTS(SELECT 1 FROM visitor_suppressions v WHERE v.workspace_id=e.workspace_id AND v.site_id=e.site_id AND v.visitor_id=e.visitor_id) AND (${filters.join(" OR ")})
    ORDER BY e.session_id,e.ts,e.sequence,e.id LIMIT 20001`,
    )
    .bind(
      site.workspace_id,
      site.id,
      range.from,
      range.to,
      now - 90 * DAY,
      ...params,
    )
    .all<FunnelEvent>();
  if (rows.results.length > MAX_EVENTS) return null;
  return {
    ...countFunnel(rows.results, steps),
    range: {
      from: range.from,
      to: range.to,
      timezone: site.timezone,
      label: range.label,
    },
    coverage:
      "Session-scoped consented browser IDs. Every step must occur inside this period and within 30 minutes of the first step. Current periods may be incomplete.",
  };
}

funnelRoutes.get("/workspaces/:wid/sites/:sid/funnels", async (c) => {
  const site = await scopedSite(c);
  if (!site) return c.json({ error: "site_not_found" }, 404);
  if (site.privacy_mode !== "attribution")
    return c.json(
      {
        error: "attribution_required",
        message:
          "Funnels require an attribution-mode site and consented session identifiers.",
      },
      409,
    );
  const records = await c.env.DB.prepare(
    "SELECT id,name,steps,created_at FROM funnels WHERE workspace_id=? AND site_id=? ORDER BY created_at,id LIMIT 20",
  )
    .bind(site.workspace_id, site.id)
    .all<FunnelRow>();
  return c.json(records.results.map(publicFunnel));
});
funnelRoutes.post(
  "/workspaces/:wid/sites/:sid/funnels",
  requireWorkspace("admin"),
  async (c) => {
    const site = await scopedSite(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    if (site.privacy_mode !== "attribution")
      return c.json({ error: "attribution_required" }, 409);
    const input = await boundedJson(c.req.raw).catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input))
      return c.json({ error: "invalid_funnel" }, 400);
    const body = input as Record<string, unknown>;
    const name = safeTag(body.name, 100),
      steps = parseSteps(body.steps);
    if (!name || !steps)
      return c.json(
        {
          error: "invalid_funnel",
          message: "Provide a name and 2 to 8 exact pageview or goal steps.",
        },
        400,
      );
    const row: FunnelRow = {
      id: crypto.randomUUID().replaceAll("-", ""),
      name,
      steps: JSON.stringify(steps),
      created_at: Date.now(),
    };
    try {
      await c.env.DB.prepare(
        "INSERT INTO funnels(id,workspace_id,site_id,name,steps,created_at) VALUES(?,?,?,?,?,?)",
      )
        .bind(
          row.id,
          site.workspace_id,
          site.id,
          row.name,
          row.steps,
          row.created_at,
        )
        .run();
    } catch (error) {
      const reason = String(error);
      if (/funnel_limit_reached/.test(reason))
        return c.json({ error: "funnel_limit_reached" }, 409);
      if (/funnel_site_unavailable/.test(reason))
        return c.json({ error: "site_not_found" }, 404);
      throw error;
    }
    return c.json(publicFunnel(row), 201);
  },
);
funnelRoutes.delete(
  "/workspaces/:wid/sites/:sid/funnels/:fid",
  requireWorkspace("admin"),
  async (c) => {
    const site = await scopedSite(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    await c.env.DB.prepare(
      "DELETE FROM funnels WHERE workspace_id=? AND site_id=? AND id=?",
    )
      .bind(site.workspace_id, site.id, c.req.param("fid"))
      .run();
    return c.json({ ok: true });
  },
);
funnelRoutes.get(
  "/workspaces/:wid/sites/:sid/funnels/:fid/report",
  async (c) => {
    const site = await scopedSite(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    if (site.privacy_mode !== "attribution")
      return c.json({ error: "attribution_required" }, 409);
    const row = await c.env.DB.prepare(
      "SELECT id,name,steps,created_at FROM funnels WHERE workspace_id=? AND site_id=? AND id=?",
    )
      .bind(site.workspace_id, site.id, c.req.param("fid"))
      .first<FunnelRow>();
    if (!row) return c.json({ error: "funnel_not_found" }, 404);
    try {
      const report = await buildFunnelReport(
        c.env.DB,
        site,
        JSON.parse(row.steps) as FunnelStep[],
        c.req.query(),
      );
      if (!report)
        return c.json(
          {
            error: "funnel_range_too_large",
            message:
              "More than 20,000 matching events. Choose a shorter period. No partial result is shown.",
          },
          422,
        );
      return c.json({ id: row.id, name: row.name, ...report });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/^(invalid_|range_)/.test(message))
        return c.json({ error: message }, 400);
      throw error;
    }
  },
);
funnelRoutes.get(
  "/workspaces/:wid/sites/:sid/journeys",
  requireWorkspace("admin"),
  async (c) => {
    const site = await scopedSite(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    if (site.privacy_mode !== "attribution")
      return c.json({ error: "attribution_required" }, 409);
    const supplied = c.req.query("limit");
    const limit = supplied === undefined ? 50 : Number(supplied);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return c.json({ error: "invalid_limit" }, 400);
    const result = await c.env.DB.prepare(
      `SELECT id,visitor_id visitorId,started_at startedAt,last_event_at lastEventAt,pageviews,goals,duration,
    entry_page entryPage,exit_page exitPage,source,channel,campaign FROM analytics_sessions s WHERE workspace_id=? AND site_id=? AND privacy_mode='attribution'
    AND NOT EXISTS(SELECT 1 FROM visitor_suppressions v WHERE v.workspace_id=s.workspace_id AND v.site_id=s.site_id AND v.visitor_id=s.visitor_id)
    AND last_received_at>=? ORDER BY last_event_at DESC,id LIMIT ?`,
    )
      .bind(site.workspace_id, site.id, Date.now() - 90 * DAY, limit + 1)
      .all();
    return c.json({
      sessions: result.results.slice(0, limit),
      truncated: result.results.length > limit,
      identity: "Random consented browser IDs, not verified people.",
      retentionDays: 90,
    });
  },
);
funnelRoutes.get(
  "/workspaces/:wid/sites/:sid/journeys/:visitorId",
  requireWorkspace("admin"),
  async (c) => {
    const site = await scopedSite(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    if (site.privacy_mode !== "attribution")
      return c.json({ error: "attribution_required" }, 409);
    const visitor = c.req.param("visitorId");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(visitor))
      return c.json({ error: "invalid_visitor" }, 400);
    const since = Date.now() - 90 * DAY;
    const [sessions, events] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT id,started_at startedAt,last_event_at lastEventAt,pageviews,goals,duration,entry_page entryPage,exit_page exitPage,source,channel,campaign
      FROM analytics_sessions s WHERE workspace_id=? AND site_id=? AND visitor_id=? AND privacy_mode='attribution' AND last_received_at>=? AND NOT EXISTS(SELECT 1 FROM visitor_suppressions v WHERE v.workspace_id=s.workspace_id AND v.site_id=s.site_id AND v.visitor_id=s.visitor_id) ORDER BY started_at DESC,id LIMIT 101`,
      ).bind(site.workspace_id, site.id, visitor, since),
      c.env.DB.prepare(
        `SELECT id,session_id sessionId,type,ts timestamp,sequence,path,name,source,channel FROM analytics_events e
      WHERE workspace_id=? AND site_id=? AND visitor_id=? AND privacy_mode='attribution' AND received_at>=? AND ts>=? AND type!='engagement' AND NOT EXISTS(SELECT 1 FROM visitor_suppressions v WHERE v.workspace_id=e.workspace_id AND v.site_id=e.site_id AND v.visitor_id=e.visitor_id)
      ORDER BY ts DESC,sequence DESC,id DESC LIMIT 501`,
      ).bind(site.workspace_id, site.id, visitor, since, since),
    ]);
    if (!sessions.results.length && !events.results.length)
      return c.json({ error: "visitor_not_found" }, 404);
    return c.json({
      visitorId: visitor,
      sessions: sessions.results.slice(0, 100),
      events: events.results.slice(0, 500),
      truncated: sessions.results.length > 100 || events.results.length > 500,
      identity: "Random consented browser ID, not a verified person.",
      retentionDays: 90,
    });
  },
);

/** Called alongside other bounded deleting-site domain cleanup. */
export async function cleanupFunnels(env: Pick<Bindings, "DB">) {
  return env.DB.prepare(
    "DELETE FROM funnels WHERE rowid IN(SELECT f.rowid FROM funnels f JOIN sites s ON s.workspace_id=f.workspace_id AND s.id=f.site_id WHERE s.status='deleting' AND s.deletion_completed_at IS NULL LIMIT 100)",
  ).run();
}
