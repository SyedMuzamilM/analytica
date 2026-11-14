import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  observabilityIngestRoutes,
  observabilityRoutes,
} from "../apps/worker/observability";

const NOW = Date.now();
const workspaceId = "workspace_obs_test";
const siteId = "site_obs_test_123";
const token = `an_${"a".repeat(64)}`;

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function setup() {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)",
    ).bind(workspaceId, "Observability test", NOW),
    env.DB.prepare(
      "INSERT INTO sites(id,workspace_id,name,domain,timezone,privacy_mode,status,created_at,daily_limit) VALUES(?,?,?,?,?,?,?,?,?)",
    ).bind(
      siteId,
      workspaceId,
      "Observability site",
      "example.com",
      "UTC",
      "aggregate",
      "active",
      NOW,
      1000,
    ),
    env.DB.prepare(
      "INSERT INTO site_api_keys(id,workspace_id,site_id,name,token_hash,prefix,namespace,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(
      "key_obs_test",
      workspaceId,
      siteId,
      "AegisLog",
      await sha256(token),
      token.slice(0, 11),
      "api:aegislog",
      NOW,
    ),
  ]);
}

describe("AegisLog observability ingestion", () => {
  it("accepts logs and audits through a project-scoped key and redacts secrets", async () => {
    await setup();
    const response = await observabilityIngestRoutes.request(
      "https://analytica.test/observability/ingest",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          logs: [
            {
              level: "error",
              message: "Payment failed",
              timestamp: new Date(NOW).toISOString(),
              context: { requestId: "req_1", traceId: "trace_1" },
              meta: { service: "checkout-api", password: "do-not-store" },
              error: { name: "TimeoutError", message: "provider timeout" },
            },
          ],
          audit: [
            {
              eventId: "aud_1",
              timestamp: new Date(NOW).toISOString(),
              action: "checkout.failed",
              resource: { type: "order", id: "ord_1" },
              outcome: "failure",
            },
          ],
        }),
      },
      env,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: true,
      logs: 1,
      audit: 1,
    });
    const log = await env.DB.prepare(
      "SELECT message,level,service,trace_id,meta_json FROM observability_logs",
    ).first<Record<string, string>>();
    expect(log).toMatchObject({
      message: "Payment failed",
      level: "error",
      service: "checkout-api",
      trace_id: "trace_1",
    });
    expect(log?.meta_json).toContain("[REDACTED]");
    expect(log?.meta_json).not.toContain("do-not-store");
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM observability_audit",
      ).first("count"),
    ).toBe(1);
  });

  it("accepts OTLP spans and groups them by trace", async () => {
    await setup();
    const response = await observabilityIngestRoutes.request(
      "https://analytica.test/observability/otlp/traces",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resourceSpans: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: "checkout-api" },
                  },
                ],
              },
              scopeSpans: [
                {
                  spans: [
                    {
                      traceId: "trace_2",
                      spanId: "span_2",
                      name: "POST /checkout",
                      startTimeUnixNano: "1700000000000000000",
                      endTimeUnixNano: "1700000000125000000",
                      status: { code: 2 },
                      attributes: [
                        {
                          key: "http.route",
                          value: { stringValue: "/checkout" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
      env,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, spans: 1 });
    const span = await env.DB.prepare(
      "SELECT trace_id,span_id,service,duration_ms,status FROM observability_spans",
    ).first();
    expect(span).toMatchObject({
      trace_id: "trace_2",
      span_id: "span_2",
      service: "checkout-api",
      status: "error",
    });
    expect(Number(span?.duration_ms)).toBe(125);
  });

  it("rejects revoked or non-observability keys", async () => {
    await setup();
    await env.DB.prepare(
      "UPDATE site_api_keys SET namespace='api:payments'",
    ).run();
    const response = await observabilityIngestRoutes.request(
      "https://analytica.test/observability/ingest",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ logs: [] }),
      },
      env,
    );
    expect(response.status).toBe(401);
  });

  it("protects project reads behind the existing workspace session boundary", async () => {
    await setup();
    const response = await observabilityRoutes.request(
      `https://analytica.test/workspaces/${workspaceId}/sites/${siteId}/observability/logs`,
      { method: "GET" },
      env,
    );
    expect(response.status).toBe(401);
  });
});
