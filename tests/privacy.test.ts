import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { privacyRoutes, cleanupPrivacy } from "../apps/worker/privacy";
import { collectRoutes, type SiteRecord } from "../apps/worker/analytics";
import { buildReport } from "../apps/worker/reports";
import { runMaintenance } from "../apps/worker/maintenance";
import { cleanupRevenue } from "../apps/worker/revenue";
import type { AppEnv } from "../apps/worker/env";

const origin = "https://analytica.test";
const workspaceId = "workspace_privacy";
const siteId = "site_privacy_001";
const visitorId = "visitor_privacy";
const now = Date.now();
const app = new Hono<AppEnv>().route("/api", privacyRoutes);
async function owner(role = "owner") {
  const token = "a".repeat(43);
  const secret = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hash = Buffer.from(
    await crypto.subtle.sign(
      "HMAC",
      secret,
      new TextEncoder().encode(`session:${token}`),
    ),
  ).toString("base64url");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,name,created_at) VALUES(?,?,?)").bind(
      "owner_privacy",
      "Owner",
      now,
    ),
    env.DB.prepare(
      "INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)",
    ).bind(workspaceId, "Privacy", now),
    env.DB.prepare(
      "INSERT INTO memberships(user_id,workspace_id,role) VALUES(?,?,?)",
    ).bind("owner_privacy", workspaceId, role),
    env.DB.prepare(
      "INSERT INTO auth_sessions(id,token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?,?)",
    ).bind("auth_privacy", hash, "owner_privacy", now, now + 86_400_000),
  ]);
  return `analytica_session=${token}`;
}
async function site(id = siteId) {
  await env.DB.prepare(
    "INSERT INTO sites(id,workspace_id,name,domain,timezone,privacy_mode,status,created_at,daily_limit) VALUES(?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      workspaceId,
      "Example",
      "example.com",
      "UTC",
      "attribution",
      "active",
      now,
      2000,
    )
    .run();
  return await env.DB.prepare("SELECT * FROM sites WHERE id=?")
    .bind(id)
    .first<SiteRecord>();
}
async function request(path: string, cookie: string, body?: object) {
  return app.request(
    `${origin}/api/workspaces/${workspaceId}${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}
function eventStatement(
  subject = visitorId,
  id = crypto.randomUUID(),
  targetSite = siteId,
  ts = now,
) {
  return env.DB.prepare(
    `INSERT INTO analytics_events(workspace_id,site_id,id,digest,visitor_id,session_id,privacy_mode,type,ts,received_at,sequence,hostname,path,name,duration,source,channel,campaign,country,device,local_day,timezone)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    workspaceId,
    targetSite,
    id,
    id,
    subject,
    `session_${subject}_${targetSite}`,
    "attribution",
    "pageview",
    ts,
    now,
    0,
    "example.com",
    "/pricing",
    null,
    0,
    "Newsletter",
    "Email",
    "Launch",
    "US",
    "Desktop",
    new Date(ts).toISOString().slice(0, 10),
    "UTC",
  );
}
const count = (table: string) =>
  env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first<number>("n");
async function collect(subject = visitorId) {
  return collectRoutes.request(
    "https://collector.example/collect",
    {
      method: "POST",
      headers: {
        Origin: "https://example.com",
        "User-Agent": "Mozilla/5.0 Chrome/130",
      },
      body: JSON.stringify({
        version: 1,
        id: crypto.randomUUID(),
        siteId,
        type: "pageview",
        timestamp: Date.now(),
        sequence: 1,
        visitorId: subject,
        sessionId: `session_${subject}_${siteId}`,
        mode: "attribution",
        hostname: "example.com",
        path: "/new",
      }),
    },
    env,
  );
}

describe("erasure and recovery journal", () => {
  it("suppresses intake atomically, deletes in bounded batches and clears checkout identity", async () => {
    const cookie = await owner();
    const trackedSite = await site();
    await env.DB.batch(Array.from({ length: 300 }, () => eventStatement()));
    await env.DB.prepare(
      `INSERT INTO checkout_claims(id,workspace_id,site_id,namespace,checkout_id,visitor_id,session_id,source,channel,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        "claim_privacy",
        workspaceId,
        siteId,
        "api:store",
        "checkout_privacy",
        visitorId,
        `session_${visitorId}_${siteId}`,
        "Newsletter",
        "Email",
        now + 86_400_000,
      )
      .run();
    const response = await request(`/sites/${siteId}/erasure`, cookie, {
      visitorId,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      suppressed: true,
      status: "pending",
    });
    expect(await count("analytics_events")).toBe(50);
    expect(await count("visitor_suppressions")).toBe(1);
    expect((await collect()).status).toBe(409);
    expect(
      await buildReport(env.DB, trackedSite!, { period: "7d" }),
    ).toMatchObject({ current: { pageviews: 0 }, online: 0 });
    await cleanupPrivacy(env);
    expect(await count("analytics_events")).toBe(0);
    expect(await count("analytics_sessions")).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT visitor_id,session_id FROM checkout_claims",
      ).first(),
    ).toEqual({ visitor_id: null, session_id: null });
    expect(
      await env.DB.prepare("SELECT completed_at FROM privacy_jobs").first(
        "completed_at",
      ),
    ).not.toBeNull();
    expect(await count("privacy_journal")).toBe(1);
    await expect(
      env.DB.prepare(
        `INSERT INTO checkout_claims(id,workspace_id,site_id,namespace,checkout_id,visitor_id,session_id,source,channel,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          "claim_replay",
          workspaceId,
          siteId,
          "api:store",
          "checkout_replay",
          visitorId,
          "session_replay",
          "Direct",
          "Direct",
          now + 86_400_000,
        )
        .run(),
    ).rejects.toThrow("visitor_suppressed");
  });

  it("rebuilds an erased closed bucket without destroying ordinary retained summaries", async () => {
    const cookie = await owner();
    await site();
    const old = now - 4 * 86_400_000;
    await env.DB.batch([
      eventStatement(visitorId, crypto.randomUUID(), siteId, old),
      eventStatement("visitor_retained", crypto.randomUUID(), siteId, old),
    ]);
    await runMaintenance(env, now);
    expect(
      await env.DB.prepare(
        "SELECT pageviews FROM daily_summaries WHERE dimension='total'",
      ).first("pageviews"),
    ).toBe(2);
    await request(`/sites/${siteId}/erasure`, cookie, { visitorId });
    expect(await count("dirty_buckets")).toBe(1);
    await runMaintenance(env, now);
    expect(
      await env.DB.prepare(
        "SELECT pageviews FROM daily_summaries WHERE dimension='total'",
      ).first("pageviews"),
    ).toBe(1);
    await env.DB.prepare("UPDATE analytics_events SET received_at=?")
      .bind(now - 91 * 86_400_000)
      .run();
    await env.DB.prepare("UPDATE analytics_sessions SET last_received_at=?")
      .bind(now - 91 * 86_400_000)
      .run();
    await runMaintenance(env, now);
    expect(await count("analytics_events")).toBe(0);
    expect(await count("dirty_buckets")).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT pageviews FROM daily_summaries WHERE dimension='total'",
      ).first("pageviews"),
    ).toBe(1);
  });

  it("handles intake racing erasure and never reintroduces a suppressed visitor", async () => {
    const cookie = await owner();
    await site();
    await env.DB.batch([eventStatement()]);
    await Promise.all([
      request(`/sites/${siteId}/erasure`, cookie, { visitorId }),
      collect(),
    ]);
    for (let i = 0; i < 3; i++) await cleanupPrivacy(env);
    expect(await count("analytics_events")).toBe(0);
    expect(await count("analytics_sessions")).toBe(0);
    expect((await collect()).status).toBe(409);
    expect((await collect("unrelated_visitor")).status).toBe(202);
  });

  it("journals site deletion automatically and completes more than two tombstones fairly", async () => {
    await owner();
    for (let i = 0; i < 4; i++) {
      const id = `site_privacy_00${i}`;
      await site(id);
      await eventStatement(`visitor_site_${i}`, crypto.randomUUID(), id).run();
      await env.DB.prepare("UPDATE sites SET status='deleting' WHERE id=?")
        .bind(id)
        .run();
    }
    expect(await count("privacy_journal")).toBe(4);
    for (let i = 0; i < 5; i++) {
      await runMaintenance(env, now);
      await cleanupRevenue(env, now);
      await cleanupPrivacy(env, now);
    }
    expect(await count("analytics_events")).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM sites WHERE deletion_completed_at IS NULL",
      ).first("n"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM privacy_jobs WHERE completed_at IS NULL",
      ).first("n"),
    ).toBe(0);
    await expect(
      env.DB.prepare(
        "UPDATE sites SET status='active' WHERE id='site_privacy_000'",
      ).run(),
    ).rejects.toThrow("site_previously_deleted");
  });

  it("replays an externally saved visitor journal over restored pre-erasure data", async () => {
    const cookie = await owner();
    await site();
    await eventStatement().run();
    const snapshot = await env.DB.prepare(
      "SELECT * FROM analytics_events",
    ).first<Record<string, unknown>>();
    await request(`/sites/${siteId}/erasure`, cookie, { visitorId });
    const exported = await request("/deletion-journal", cookie);
    expect(exported.status).toBe(200);
    const journal = (await exported.json()) as {
      records: Array<Record<string, unknown>>;
    };
    expect(journal.records).toHaveLength(1);
    expect(journal.records[0]).toMatchObject({
      workspaceId,
      siteId,
      kind: "visitor",
      visitorId,
    });
    // Model a restore from before the erasure. External journal survives outside D1.
    await env.DB.batch([
      env.DB.prepare("DELETE FROM privacy_jobs"),
      env.DB.prepare("DELETE FROM privacy_journal"),
      env.DB.prepare("DELETE FROM visitor_suppressions"),
    ]);
    const columns = Object.keys(snapshot!);
    await env.DB.prepare(
      `INSERT INTO analytics_events(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
    )
      .bind(...Object.values(snapshot!))
      .run();
    expect(await count("analytics_events")).toBe(1);
    const reapplied = await request("/deletion-journal/reapply", cookie, {
      records: journal.records,
    });
    expect(reapplied.status, await reapplied.clone().text()).toBe(202);
    expect(await reapplied.json()).toMatchObject({
      accepted: 1,
      pending: 0,
      workspaceReplayComplete: true,
    });
    expect(await count("analytics_events")).toBe(0);
    expect((await collect()).status).toBe(409);
    expect(
      (
        await request("/deletion-journal/reapply", cookie, {
          records: journal.records,
        })
      ).status,
    ).toBe(202);
    expect(await count("privacy_journal")).toBe(1);
    expect(await count("users")).toBe(1);
  });

  it("scopes journal imports and erasure to authorized workspaces and rejects conflicting records before mutation", async () => {
    const cookie = await owner("viewer");
    await site();
    expect(
      (await request(`/sites/${siteId}/erasure`, cookie, { visitorId })).status,
    ).toBe(403);
    expect((await request("/deletion-journal", cookie)).status).toBe(403);
    await env.DB.prepare("UPDATE memberships SET role='owner'").run();
    const record = {
      id: "journal_test_001",
      workspaceId,
      siteId,
      kind: "visitor",
      visitorId,
      createdAt: now,
    };
    expect(
      (
        await request("/deletion-journal/reapply", cookie, {
          records: [{ ...record, workspaceId: "workspace_other" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/deletion-journal/reapply", cookie, {
          records: [record, { ...record, visitorId: "different_visitor" }],
        })
      ).status,
    ).toBe(409);
    expect(await count("visitor_suppressions")).toBe(0);
    expect(
      (
        await request("/deletion-journal/reapply", cookie, {
          records: [record],
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await request("/deletion-journal/reapply", cookie, {
          records: [{ ...record, visitorId: "different_visitor" }],
        })
      ).status,
    ).toBe(409);
    expect(await count("visitor_suppressions")).toBe(1);
  });
});
