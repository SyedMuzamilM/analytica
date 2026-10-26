import { Hono } from "hono";
import { requireAuth, requireWorkspace } from "./auth";
import { boundedJson } from "./analytics";
import type { AppEnv, Bindings } from "./env";

type PrivacyKind = "site" | "visitor";
interface JournalRow {
  id: string;
  workspace_id: string;
  site_id: string;
  kind: PrivacyKind;
  subject_id: string;
  created_at: number;
}
interface PrivacyJob extends JournalRow {
  completed_at: number | null;
}
export interface JournalRecord {
  id: string;
  workspaceId: string;
  siteId: string;
  kind: PrivacyKind;
  visitorId?: string;
  createdAt: number;
}
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
const serialize = (row: JournalRow): JournalRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  siteId: row.site_id,
  kind: row.kind,
  ...(row.kind === "visitor" ? { visitorId: row.subject_id } : {}),
  createdAt: row.created_at,
});
const parse = (
  value: unknown,
  workspaceId: string,
  now: number,
): JournalRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !validId(row.id) ||
    row.workspaceId !== workspaceId ||
    !validId(row.siteId) ||
    (row.kind !== "site" && row.kind !== "visitor") ||
    !Number.isSafeInteger(row.createdAt) ||
    Number(row.createdAt) < 946684800000 ||
    Number(row.createdAt) > now + 300000 ||
    (row.kind === "visitor" && !validId(row.visitorId)) ||
    (row.kind === "site" && row.visitorId !== undefined)
  )
    return null;
  return {
    id: row.id,
    workspaceId,
    siteId: row.siteId,
    kind: row.kind,
    ...(row.kind === "visitor" ? { visitorId: row.visitorId as string } : {}),
    createdAt: Number(row.createdAt),
  };
};

/** Creates an authoritative suppression before any deletion can yield to intake. */
async function scheduleVisitorErasure(
  db: D1Database,
  workspaceId: string,
  siteId: string,
  visitorId: string,
  now: number,
) {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO visitor_suppressions(workspace_id,site_id,visitor_id,created_at) VALUES(?,?,?,?)",
      )
      .bind(workspaceId, siteId, visitorId, now),
    db
      .prepare(
        "INSERT OR IGNORE INTO privacy_journal(id,workspace_id,site_id,kind,subject_id,created_at) VALUES(?,?,?,'visitor',?,?)",
      )
      .bind(id, workspaceId, siteId, visitorId, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO privacy_jobs(id,workspace_id,site_id,kind,subject_id,created_at)
      SELECT id,workspace_id,site_id,kind,subject_id,created_at FROM privacy_journal WHERE workspace_id=? AND site_id=? AND kind='visitor' AND subject_id=?`,
      )
      .bind(workspaceId, siteId, visitorId),
    db
      .prepare(
        `INSERT OR IGNORE INTO dirty_buckets(workspace_id,site_id,day,timezone)
      SELECT workspace_id,site_id,local_day,timezone FROM analytics_events WHERE workspace_id=? AND site_id=? AND visitor_id=? GROUP BY local_day,timezone`,
      )
      .bind(workspaceId, siteId, visitorId),
  ]);
  return db
    .prepare(
      "SELECT * FROM privacy_jobs WHERE workspace_id=? AND site_id=? AND kind='visitor' AND subject_id=?",
    )
    .bind(workspaceId, siteId, visitorId)
    .first<PrivacyJob>();
}

async function eraseVisitorBatch(
  db: D1Database,
  job: PrivacyJob,
  now: number,
): Promise<boolean> {
  const args = [job.workspace_id, job.site_id, job.subject_id];
  await db.batch([
    db
      .prepare(
        "DELETE FROM analytics_events WHERE rowid IN(SELECT rowid FROM analytics_events WHERE workspace_id=? AND site_id=? AND visitor_id=? LIMIT 250)",
      )
      .bind(...args),
    db
      .prepare(
        "DELETE FROM analytics_sessions WHERE rowid IN(SELECT rowid FROM analytics_sessions WHERE workspace_id=? AND site_id=? AND visitor_id=? LIMIT 250)",
      )
      .bind(...args),
    db
      .prepare(
        "UPDATE checkout_claims SET visitor_id=NULL,session_id=NULL WHERE rowid IN(SELECT rowid FROM checkout_claims WHERE workspace_id=? AND site_id=? AND visitor_id=? LIMIT 250)",
      )
      .bind(...args),
    db
      .prepare(
        `UPDATE privacy_jobs SET completed_at=? WHERE id=?
      AND NOT EXISTS(SELECT 1 FROM analytics_events WHERE workspace_id=? AND site_id=? AND visitor_id=?)
      AND NOT EXISTS(SELECT 1 FROM analytics_sessions WHERE workspace_id=? AND site_id=? AND visitor_id=?)
      AND NOT EXISTS(SELECT 1 FROM checkout_claims WHERE workspace_id=? AND site_id=? AND visitor_id=?)`,
      )
      .bind(now, job.id, ...args, ...args, ...args),
  ]);
  return !!(
    await db
      .prepare("SELECT completed_at FROM privacy_jobs WHERE id=?")
      .bind(job.id)
      .first<{ completed_at: number | null }>()
  )?.completed_at;
}

// Domain modules purge their own site records. A finished tombstone must leave
// their bounded LIMIT queues so it cannot starve a third deleted site forever.
async function finalizeDeletedSite(
  db: D1Database,
  job: PrivacyJob,
  now: number,
): Promise<boolean> {
  const candidates = [
    "analytics_events",
    "analytics_sessions",
    "daily_usage",
    "daily_summaries",
    "dirty_buckets",
    "checkout_claims",
    "money_records",
    "site_api_keys",
    "payment_integrations",
    "funnels",
  ];
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all<{ name: string }>();
  const present = new Set(tables.results.map((r) => r.name));
  const clauses = candidates
    .filter((table) => present.has(table))
    .map(
      (table) =>
        `NOT EXISTS(SELECT 1 FROM ${table} WHERE workspace_id=? AND site_id=?)`,
    );
  const args = clauses.flatMap(() => [job.workspace_id, job.site_id]);
  const result = await db
    .prepare(
      `UPDATE sites SET deletion_completed_at=? WHERE workspace_id=? AND id=? AND status='deleting' AND ${clauses.join(" AND ")}`,
    )
    .bind(now, job.workspace_id, job.site_id, ...args)
    .run();
  const absent = !(await db
    .prepare("SELECT 1 FROM sites WHERE workspace_id=? AND id=?")
    .bind(job.workspace_id, job.site_id)
    .first());
  if (!result.meta.changes && !absent) return false;
  await db
    .prepare(
      "UPDATE privacy_jobs SET completed_at=? WHERE workspace_id=? AND site_id=? AND completed_at IS NULL",
    )
    .bind(now, job.workspace_id, job.site_id)
    .run();
  return true;
}

export async function cleanupPrivacy(
  env: Pick<Bindings, "DB">,
  now = Date.now(),
) {
  const jobs = await env.DB.prepare(
    "SELECT * FROM privacy_jobs WHERE completed_at IS NULL ORDER BY created_at,id LIMIT 2",
  ).all<PrivacyJob>();
  let completed = 0;
  for (const job of jobs.results) {
    if (
      job.kind === "visitor"
        ? await eraseVisitorBatch(env.DB, job, now)
        : await finalizeDeletedSite(env.DB, job, now)
    )
      completed++;
  }
  return { processed: jobs.results.length, completed };
}

export const privacyRoutes = new Hono<AppEnv>();
privacyRoutes.use("/workspaces/:wid/*", requireAuth, requireWorkspace("admin"));
privacyRoutes.post("/workspaces/:wid/sites/:sid/erasure", async (c) => {
  const body = (await boundedJson(c.req.raw, 8192).catch(() => null)) as {
    visitorId?: unknown;
  } | null;
  if (!body || !validId(body.visitorId))
    return c.json({ error: "invalid_visitor_id" }, 400);
  const workspaceId = c.get("workspace").id;
  const siteId = c.req.param("sid");
  const site = await c.env.DB.prepare(
    "SELECT 1 FROM sites WHERE workspace_id=? AND id=? AND status!='deleting'",
  )
    .bind(workspaceId, siteId)
    .first();
  if (!site) return c.json({ error: "site_not_found" }, 404);
  const now = Date.now();
  const job = await scheduleVisitorErasure(
    c.env.DB,
    workspaceId,
    siteId,
    body.visitorId,
    now,
  );
  if (!job) return c.json({ error: "erasure_not_scheduled" }, 503);
  const complete =
    job.completed_at !== null || (await eraseVisitorBatch(c.env.DB, job, now));
  return c.json(
    {
      jobId: job.id,
      status: complete ? "complete" : "pending",
      suppressed: true,
    },
    202,
  );
});
privacyRoutes.get(
  "/workspaces/:wid/deletion-journal",
  requireWorkspace("owner"),
  async (c) => {
    const records = await c.env.DB.prepare(
      "SELECT * FROM privacy_journal WHERE workspace_id=? ORDER BY created_at,id LIMIT 1001",
    )
      .bind(c.get("workspace").id)
      .all<JournalRow>();
    if (records.results.length > 1000)
      return c.json(
        {
          error: "journal_export_too_large",
          message:
            "Use the operator D1 export procedure for this workspace journal.",
        },
        413,
      );
    c.header("Cache-Control", "private, no-store");
    c.header(
      "Content-Disposition",
      `attachment; filename="analytica-deletions-${c.get("workspace").id}.json"`,
    );
    return c.json({
      version: 1,
      workspaceId: c.get("workspace").id,
      exportedAt: new Date().toISOString(),
      records: records.results.map(serialize),
    });
  },
);
privacyRoutes.post(
  "/workspaces/:wid/deletion-journal/reapply",
  requireWorkspace("owner"),
  async (c) => {
    const body = (await boundedJson(c.req.raw, 65536).catch(() => null)) as {
      records?: unknown;
    } | null;
    if (!body || !Array.isArray(body.records) || body.records.length > 20)
      return c.json(
        {
          error: "invalid_journal",
          message: "Supply up to 20 records per replay batch within 64 KiB.",
        },
        400,
      );
    const workspaceId = c.get("workspace").id;
    const now = Date.now();
    const records = body.records.map((value) => parse(value, workspaceId, now));
    if (records.some((record) => record === null))
      return c.json({ error: "invalid_journal_record" }, 400);
    const suppliedIds = new Map<string, string>();
    for (const record of records as JournalRecord[]) {
      const identity = JSON.stringify([
        record.siteId,
        record.kind,
        record.visitorId || "",
      ]);
      if (suppliedIds.has(record.id) && suppliedIds.get(record.id) !== identity)
        return c.json({ error: "journal_id_conflict" }, 409);
      suppliedIds.set(record.id, identity);
    }
    // Validate the entire upload before any mutation. A repeated opaque record ID
    // must never be repointed to a different deletion target.
    for (const record of records as JournalRecord[]) {
      const existing = await c.env.DB.prepare(
        "SELECT * FROM privacy_journal WHERE id=?",
      )
        .bind(record.id)
        .first<JournalRow>();
      if (
        existing &&
        (existing.workspace_id !== workspaceId ||
          existing.site_id !== record.siteId ||
          existing.kind !== record.kind ||
          existing.subject_id !== (record.visitorId || ""))
      ) {
        return c.json({ error: "journal_id_conflict" }, 409);
      }
    }
    const statements: D1PreparedStatement[] = [];
    for (const record of records as JournalRecord[]) {
      statements.push(
        c.env.DB.prepare(
          "INSERT OR IGNORE INTO privacy_journal(id,workspace_id,site_id,kind,subject_id,created_at) VALUES(?,?,?,?,?,?)",
        ).bind(
          record.id,
          workspaceId,
          record.siteId,
          record.kind,
          record.visitorId || "",
          record.createdAt,
        ),
      );
      if (record.kind === "visitor") {
        statements.push(
          c.env.DB.prepare(
            "INSERT OR IGNORE INTO visitor_suppressions(workspace_id,site_id,visitor_id,created_at) VALUES(?,?,?,?)",
          ).bind(
            workspaceId,
            record.siteId,
            record.visitorId,
            record.createdAt,
          ),
        );
        statements.push(
          c.env.DB.prepare(
            `INSERT OR IGNORE INTO dirty_buckets(workspace_id,site_id,day,timezone)
        SELECT workspace_id,site_id,local_day,timezone FROM analytics_events WHERE workspace_id=? AND site_id=? AND visitor_id=? GROUP BY local_day,timezone`,
          ).bind(workspaceId, record.siteId, record.visitorId),
        );
      } else {
        statements.push(
          c.env.DB.prepare(
            "UPDATE sites SET status='deleting',deletion_completed_at=NULL WHERE workspace_id=? AND id=?",
          ).bind(workspaceId, record.siteId),
        );
      }
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO privacy_jobs(id,workspace_id,site_id,kind,subject_id,created_at)
      SELECT id,workspace_id,site_id,kind,subject_id,created_at FROM privacy_journal WHERE workspace_id=? AND site_id=? AND kind=? AND subject_id=?
      ON CONFLICT(id) DO UPDATE SET completed_at=NULL`,
        ).bind(workspaceId, record.siteId, record.kind, record.visitorId || ""),
      );
    }
    try {
      if (statements.length) await c.env.DB.batch(statements);
    } catch (error) {
      if (String(error).includes("journal_id_conflict"))
        return c.json({ error: "journal_id_conflict" }, 409);
      throw error;
    }
    const cleanup = await cleanupPrivacy(c.env, now);
    const pending = await c.env.DB.prepare(
      "SELECT COUNT(*) n FROM privacy_jobs WHERE workspace_id=? AND completed_at IS NULL",
    )
      .bind(workspaceId)
      .first<{ n: number }>();
    return c.json(
      {
        accepted: records.length,
        pending: pending?.n || 0,
        cleanup,
        workspaceReplayComplete: (pending?.n || 0) === 0,
      },
      202,
    );
  },
);
