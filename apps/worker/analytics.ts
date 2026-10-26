import { Hono, type Context } from "hono";
import type { CollectEvent, Site } from "../../packages/contracts";
import type { AppEnv } from "./env";
import { requireAuth, requireWorkspace } from "./auth";
import { buildReport, localDate } from "./reports";

export interface SiteRecord {
  id: string;
  workspace_id: string;
  name: string;
  domain: string;
  timezone: string;
  privacy_mode: "aggregate" | "attribution";
  status: "active" | "paused" | "deleting";
  created_at: number;
  daily_limit: number;
}
export const mapSite = (s: SiteRecord): Site => ({
  id: s.id,
  workspaceId: s.workspace_id,
  name: s.name,
  domain: s.domain,
  timezone: s.timezone,
  privacyMode: s.privacy_mode,
  status: s.status,
  createdAt: s.created_at,
  dailyLimit: s.daily_limit,
});
export async function boundedJson(
  request: Request,
  maxBytes = 8192,
): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new Error("payload_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_json");
  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error("payload_too_large");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("invalid_json");
  }
}
export const safeTag = (v: unknown, max = 100) =>
  typeof v === "string"
    ? v
        .trim()
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, max)
    : "";
export function cleanPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    throw new Error("invalid_path");
  const path = value.split(/[?#]/)[0];
  return (
    path
      .split("/")
      .map((segment) => {
        let plain = segment;
        try {
          plain = decodeURIComponent(segment);
        } catch {
          /* retain bounded encoded text */
        }
        return /@|^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(plain) ||
          /^\d{5,}$/.test(plain)
          ? ":redacted"
          : segment;
      })
      .join("/")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 500) || "/"
  );
}
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(v);
const TYPES = new Set(["pageview", "goal", "outbound", "engagement"]);
export function validateEvent(input: unknown, now: number): CollectEvent {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid_event");
  const v = input as Record<string, unknown>;
  if (
    v.version !== 1 ||
    !validId(v.id) ||
    !validId(v.siteId) ||
    !validId(v.visitorId) ||
    !validId(v.sessionId) ||
    !TYPES.has(String(v.type))
  )
    throw new Error("invalid_event");
  if (v.mode !== "aggregate" && v.mode !== "attribution")
    throw new Error("invalid_mode");
  if (
    !Number.isSafeInteger(v.timestamp) ||
    Number(v.timestamp) < now - 86_400_000 ||
    Number(v.timestamp) > now + 300_000
  )
    throw new Error("invalid_timestamp");
  if (
    !Number.isSafeInteger(v.sequence) ||
    Number(v.sequence) < 0 ||
    Number(v.sequence) > 1_000_000_000
  )
    throw new Error("invalid_sequence");
  const hostname = safeTag(v.hostname, 253).toLowerCase().replace(/\.$/, "");
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(
      hostname,
    )
  )
    throw new Error("invalid_hostname");
  let name = safeTag(v.name, v.type === "outbound" ? 500 : 64);
  if (v.type === "outbound" && name) {
    try {
      const target = new URL(name);
      if (!/^https?:$/.test(target.protocol)) throw new Error();
      name = target.origin + cleanPath(target.pathname);
    } catch {
      throw new Error("invalid_outbound_url");
    }
  }
  if ((v.type === "goal" || v.type === "outbound") && !name)
    throw new Error("event_name_required");
  if (
    v.type === "goal" &&
    /@|(?:password|access_token|api_key|secret)\s*[=:]/i.test(name)
  )
    throw new Error("sensitive_event_name");
  let referrer = "";
  if (typeof v.referrer === "string" && v.referrer) {
    try {
      const r = new URL(
        v.referrer.includes("://") ? v.referrer : "https://" + v.referrer,
      );
      if (/^https?:$/.test(r.protocol)) referrer = r.hostname.toLowerCase();
    } catch {
      /* invalid referrals become unknown */
    }
  }
  let campaign: CollectEvent["campaign"];
  if (
    v.campaign &&
    typeof v.campaign === "object" &&
    !Array.isArray(v.campaign)
  ) {
    const c = v.campaign as Record<string, unknown>;
    const tag = (x: unknown) =>
      safeTag(x, 100).replace(/[^\p{L}\p{N} _./-]/gu, "");
    campaign = {
      source: tag(c.source),
      medium: tag(c.medium),
      name: tag(c.name),
    };
  }
  const duration = v.type === "engagement" ? Math.round(Number(v.duration)) : 0;
  if (!Number.isFinite(duration) || duration < 0 || duration > 60_000)
    throw new Error("invalid_duration");
  return {
    version: 1,
    id: v.id,
    siteId: v.siteId,
    type: v.type as CollectEvent["type"],
    timestamp: Number(v.timestamp),
    sequence: Number(v.sequence),
    visitorId: v.visitorId,
    sessionId: v.sessionId,
    mode: v.mode,
    hostname,
    path: cleanPath(v.path),
    ...(name ? { name } : {}),
    ...(referrer ? { referrer } : {}),
    ...(campaign ? { campaign } : {}),
    ...(duration ? { duration } : {}),
  };
}
function sourceOf(event: CollectEvent, domain: string) {
  const ref = (event.referrer || "").replace(/^www\./, "");
  const source =
    event.campaign?.source ||
    (ref === domain.replace(/^www\./, "") || ref.endsWith("." + domain)
      ? ""
      : ref);
  const medium = event.campaign?.medium?.toLowerCase() || "";
  if (!source) return { source: "Direct", channel: "Direct" };
  if (/cpc|ppc|paid|display/.test(medium)) return { source, channel: "Paid" };
  if (/email|newsletter/.test(medium)) return { source, channel: "Email" };
  if (
    /chatgpt|openai|claude|perplexity|gemini|copilot|deepseek|grok/.test(source)
  )
    return {
      source: /chatgpt|openai/.test(source)
        ? "ChatGPT"
        : /claude/.test(source)
          ? "Claude"
          : /perplexity/.test(source)
            ? "Perplexity"
            : source,
      channel: "AI",
    };
  if (/(^|\.)google\.|(^|\.)bing\.|duckduckgo|baidu|yahoo/.test(source))
    return {
      source: /google/.test(source)
        ? "Google"
        : /bing/.test(source)
          ? "Bing"
          : source,
      channel: "Search",
    };
  if (
    /^(t\.co|x|x\.com|twitter\.com)$|reddit|facebook|instagram|linkedin/.test(
      source,
    )
  )
    return {
      source: /^(t\.co|x|x\.com|twitter\.com)$/.test(source)
        ? "X"
        : /reddit/.test(source)
          ? "Reddit"
          : source,
      channel: "Social",
    };
  return { source, channel: "Referral" };
}
export const digestEvent = async (event: CollectEvent) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(event)),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const hostnameAllowed = (hostname: string, domain: string) =>
  hostname === domain ||
  hostname === "www." + domain ||
  domain === "www." + hostname;

export const collectRoutes = new Hono<AppEnv>();
collectRoutes.options(
  "/collect",
  (c) =>
    new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    }),
);
collectRoutes.post("/collect", async (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Cache-Control", "no-store");
  let event: CollectEvent;
  const now = Date.now();
  try {
    event = validateEvent(await boundedJson(c.req.raw), now);
  } catch (error) {
    const code = (error as Error).message;
    return c.json({ error: code }, code === "payload_too_large" ? 413 : 400);
  }
  const ua = c.req.header("user-agent") || "";
  if (
    /bot\b|crawler|spider|headless|selenium|phantom|lighthouse|preview/i.test(
      ua,
    )
  )
    return c.json({ accepted: false, reason: "bot" }, 202);
  const site = await c.env.DB.prepare("SELECT * FROM sites WHERE id=?")
    .bind(event.siteId)
    .first<SiteRecord>();
  if (!site || site.status === "deleting")
    return c.json({ error: "site_unavailable" }, 404);
  if (!hostnameAllowed(event.hostname, site.domain))
    return c.json({ error: "hostname_not_allowed" }, 403);
  const origin = c.req.header("origin");
  if (origin) {
    try {
      if (!hostnameAllowed(new URL(origin).hostname, site.domain))
        return c.json({ error: "origin_not_allowed" }, 403);
    } catch {
      return c.json({ error: "origin_not_allowed" }, 403);
    }
  }
  const digest = await digestEvent(event);
  // The acceptance trigger freezes inherited attribution and checks suppression
  // inside the same transaction, including duplicate deliveries.
  const source = {
    ...sourceOf(event, site.domain),
    campaign: event.campaign?.name || null,
  };
  const country = String(c.req.raw.cf?.country || "Unknown")
    .slice(0, 2)
    .toUpperCase();
  const device = /iPad|Tablet/i.test(ua)
    ? "Tablet"
    : /Mobile|Android|iPhone/i.test(ua)
      ? "Mobile"
      : "Desktop";
  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO analytics_events(workspace_id,site_id,id,digest,visitor_id,session_id,privacy_mode,type,ts,received_at,sequence,hostname,path,name,duration,source,channel,campaign,country,device,local_day,timezone) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,site_id,id) DO NOTHING`,
    )
      .bind(
        site.workspace_id,
        site.id,
        event.id,
        digest,
        event.visitorId,
        event.sessionId,
        event.mode,
        event.type,
        event.timestamp,
        now,
        event.sequence,
        event.hostname,
        event.path,
        event.name || null,
        event.duration || 0,
        source.source,
        source.channel,
        source.campaign,
        country === "UN" ? "Unknown" : country,
        device,
        localDate(event.timestamp, site.timezone),
        site.timezone,
      )
      .run();
    const duplicate = result.meta.changes === 0;
    return c.json({ accepted: true, duplicate }, duplicate ? 200 : 202);
  } catch (error) {
    const msg = String(error);
    if (/visitor_suppressed/.test(msg))
      return c.json({ accepted: false, error: "visitor_suppressed" }, 409);
    if (/event_conflict|session_identity_conflict/.test(msg))
      return c.json(
        {
          error: msg.includes("event_conflict")
            ? "event_conflict"
            : "session_identity_conflict",
        },
        409,
      );
    if (/session_expired|session_missing/.test(msg))
      return c.json(
        {
          error: msg.includes("session_expired")
            ? "session_expired"
            : "session_missing",
          resetSession: true,
        },
        409,
      );
    if (/quota_exceeded/.test(msg)) {
      c.header("Retry-After", "3600");
      return c.json({ error: "quota_exceeded" }, 429);
    }
    if (/site_unavailable|site_configuration_changed/.test(msg))
      return c.json({ error: "site_unavailable" }, 409);
    if (/ambiguous_late_event/.test(msg))
      return c.json({ error: "ambiguous_late_event" }, 422);
    throw error;
  }
});

export const analyticsRoutes = new Hono<AppEnv>();
analyticsRoutes.use("/workspaces/*", requireAuth);
analyticsRoutes.use("/workspaces/:wid/*", requireWorkspace("viewer"));
analyticsRoutes.get("/workspaces/:wid/sites", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM sites WHERE workspace_id=? AND status!='deleting' ORDER BY created_at",
  )
    .bind(c.get("workspace").id)
    .all<SiteRecord>();
  return c.json(result.results.map(mapSite));
});
analyticsRoutes.post(
  "/workspaces/:wid/sites",
  requireWorkspace("admin"),
  async (c) => {
    const body = (await boundedJson(c.req.raw).catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return c.json({ error: "invalid_json" }, 400);
    let domain: string;
    try {
      const url = new URL(
        String(body.domain).includes("://")
          ? String(body.domain)
          : "https://" + body.domain,
      );
      domain = url.hostname.toLowerCase().replace(/\.$/, "");
      if (
        !domain ||
        !/^https?:$/.test(url.protocol) ||
        url.port ||
        !/^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(domain)
      )
        throw new Error();
    } catch {
      return c.json({ error: "invalid_domain" }, 400);
    }
    const timezone = safeTag(body.timezone || "UTC", 80);
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    } catch {
      return c.json({ error: "invalid_timezone" }, 400);
    }
    const privacyMode = body.privacyMode || "aggregate";
    if (privacyMode !== "aggregate" && privacyMode !== "attribution")
      return c.json({ error: "invalid_privacy_mode" }, 400);
    const limit = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sites WHERE workspace_id=? AND status!='deleting'",
    )
      .bind(c.get("workspace").id)
      .first<{ n: number }>();
    if ((limit?.n || 0) >= 20)
      return c.json({ error: "site_limit_reached" }, 409);
    const site: SiteRecord = {
      id: crypto.randomUUID().replaceAll("-", ""),
      workspace_id: c.get("workspace").id,
      name: safeTag(body.name || domain, 100),
      domain,
      timezone,
      privacy_mode: privacyMode,
      status: "active",
      created_at: Date.now(),
      daily_limit: 1000,
    };
    await c.env.DB.prepare(
      "INSERT INTO sites(id,workspace_id,name,domain,timezone,privacy_mode,status,created_at,daily_limit) VALUES(?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        site.id,
        site.workspace_id,
        site.name,
        site.domain,
        site.timezone,
        site.privacy_mode,
        site.status,
        site.created_at,
        site.daily_limit,
      )
      .run();
    return c.json(mapSite(site), 201);
  },
);
async function scopedSite(c: Context<AppEnv>) {
  return c.env.DB.prepare(
    "SELECT * FROM sites WHERE workspace_id=? AND id=? AND status!='deleting'",
  )
    .bind(c.get("workspace").id, c.req.param("sid"))
    .first<SiteRecord>();
}
analyticsRoutes.patch(
  "/workspaces/:wid/sites/:sid",
  requireWorkspace("admin"),
  async (c) => {
    const site = await scopedSite(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    const body = (await boundedJson(c.req.raw).catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return c.json({ error: "invalid_json" }, 400);
    if (
      body.status !== undefined &&
      body.status !== "active" &&
      body.status !== "paused"
    )
      return c.json({ error: "invalid_status" }, 400);
    if (
      body.privacyMode !== undefined &&
      body.privacyMode !== site.privacy_mode
    )
      return c.json(
        {
          error: "privacy_mode_immutable",
          message:
            "Create a separate site to change privacy mode without mixing incompatible metrics.",
        },
        409,
      );
    if (body.timezone !== undefined && body.timezone !== site.timezone)
      return c.json(
        {
          error: "timezone_immutable",
          message:
            "Timezone changes require rebuilding report summaries and are not supported yet.",
        },
        409,
      );
    const name = body.name !== undefined ? safeTag(body.name, 100) : site.name;
    if (!name) return c.json({ error: "name_required" }, 400);
    await c.env.DB.prepare(
      "UPDATE sites SET name=?,status=? WHERE workspace_id=? AND id=? AND status!='deleting'",
    )
      .bind(name, body.status || site.status, site.workspace_id, site.id)
      .run();
    return c.json(
      mapSite({
        ...site,
        name,
        status: (body.status || site.status) as SiteRecord["status"],
      }),
    );
  },
);
analyticsRoutes.delete(
  "/workspaces/:wid/sites/:sid",
  requireWorkspace("owner"),
  async (c) => {
    const site = await scopedSite(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    await c.env.DB.prepare(
      "UPDATE sites SET status='deleting' WHERE workspace_id=? AND id=?",
    )
      .bind(site.workspace_id, site.id)
      .run();
    return c.json({ ok: true, status: "deleting" }, 202);
  },
);
analyticsRoutes.get("/workspaces/:wid/sites/:sid/report", async (c) => {
  const site = await scopedSite(c);
  if (!site) return c.json({ error: "site_not_found" }, 404);
  c.header("Cache-Control", "private, no-store");
  try {
    return c.json(await buildReport(c.env.DB, site, c.req.query()));
  } catch (error) {
    const msg = (error as Error).message;
    if (/^(invalid_|range_|unsupported_)/.test(msg))
      return c.json({ error: msg }, 400);
    throw error;
  }
});
analyticsRoutes.get(
  "/workspaces/:wid/sites/:sid/export",
  requireWorkspace("admin"),
  async (c) => {
    const site = await scopedSite(c);
    if (!site) return c.json({ error: "site_not_found" }, 404);
    const result = await c.env.DB.prepare(
      "SELECT id,type,ts,path,name,source,channel,campaign,country,device,privacy_mode FROM analytics_events e WHERE workspace_id=? AND site_id=? AND NOT EXISTS(SELECT 1 FROM visitor_suppressions p WHERE p.workspace_id=e.workspace_id AND p.site_id=e.site_id AND p.visitor_id=e.visitor_id) ORDER BY ts DESC LIMIT 10001",
    )
      .bind(site.workspace_id, site.id)
      .all();
    if (result.results.length > 10000)
      return c.json(
        {
          error: "export_too_large",
          message:
            "This export exceeds 10,000 rows. Use the operator D1 export procedure.",
        },
        413,
      );
    c.header("Cache-Control", "private, no-store");
    c.header(
      "Content-Disposition",
      `attachment; filename="analytica-${site.id}.json"`,
    );
    return c.json({
      site: mapSite(site),
      exportedAt: new Date().toISOString(),
      records: result.results,
    });
  },
);
