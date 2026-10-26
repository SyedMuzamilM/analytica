import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { app } from "../apps/worker/index";
import { digest, recordMoney, moneyRoutes } from "../apps/worker/revenue";

const KEY = "an_" + "a".repeat(64);
const now = Date.now();
async function setup() {
  await env.DB.prepare(
    "INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)",
  )
    .bind("ws_revenue", "Revenue", now)
    .run();
  await env.DB.prepare(
    "INSERT INTO sites(id,workspace_id,name,domain,timezone,privacy_mode,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      "site_revenue",
      "ws_revenue",
      "Shop",
      "example.com",
      "UTC",
      "attribution",
      "active",
      now,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO site_api_keys(id,workspace_id,site_id,name,token_hash,prefix,namespace,created_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      "key_revenue",
      "ws_revenue",
      "site_revenue",
      "API",
      await digest(KEY),
      "an_aaaa",
      "api:shop",
      now,
    )
    .run();
}
async function send(path: string, body: object) {
  return app.request(
    `https://analytica.test/v1/server/${path}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    env,
  );
}
const key = {
  id: "key_revenue",
  workspace_id: "ws_revenue",
  site_id: "site_revenue",
  namespace: "api:shop",
  privacy_mode: "attribution",
};
const payment = {
  transactionId: "sale_1",
  kind: "payment" as const,
  originalId: null,
  amount: 1000,
  currency: "USD",
  occurredAt: now,
};

describe("economic idempotency and tenant-bound money", () => {
  it("concurrent payment retries persist one sale and changed amount conflicts", async () => {
    await setup();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        send("payments", {
          transaction_id: "sale_1",
          amount_minor: 1000,
          currency: "USD",
        }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM money_records").first("n"),
    ).toBe(1);
    const conflict = await send("payments", {
      transaction_id: "sale_1",
      amount_minor: 1100,
      currency: "USD",
    });
    expect(conflict.status).toBe(409);
    expect(
      await env.DB.prepare("SELECT amount_minor FROM money_records").first(
        "amount_minor",
      ),
    ).toBe(1000);
  });
  it("refuses malformed amounts, currencies, revoked keys and deleting sites", async () => {
    await setup();
    for (const body of [
      { transaction_id: "a", amount_minor: 1.5, currency: "USD" },
      { transaction_id: "a", amount_minor: 10, currency: "XYZ" },
      { transaction_id: "a", amount_minor: -1, currency: "USD" },
    ])
      expect((await send("payments", body)).status).toBe(400);
    await env.DB.prepare("UPDATE site_api_keys SET revoked_at=?")
      .bind(now)
      .run();
    expect(
      (
        await send("payments", {
          transaction_id: "sale_1",
          amount_minor: 1000,
          currency: "USD",
        })
      ).status,
    ).toBe(401);
    await env.DB.prepare("UPDATE site_api_keys SET revoked_at=NULL").run();
    await env.DB.prepare("UPDATE sites SET status='deleting'").run();
    expect(
      (
        await send("payments", {
          transaction_id: "sale_1",
          amount_minor: 1000,
          currency: "USD",
        })
      ).status,
    ).toBe(401);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM money_records").first("n"),
    ).toBe(0);
  });
  it("supports multiple partial refunds while rejecting currency mismatch and cumulative over-refund", async () => {
    await setup();
    await recordMoney(env, key, payment);
    const first = await send("refunds", {
      refund_id: "refund_1",
      transaction_id: "sale_1",
      amount_minor: 300,
      currency: "USD",
    });
    expect(first.status).toBe(201);
    expect(
      (
        await send("refunds", {
          refund_id: "refund_1",
          transaction_id: "sale_1",
          amount_minor: 300,
          currency: "USD",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await send("refunds", {
          refund_id: "refund_2",
          transaction_id: "sale_1",
          amount_minor: 200,
          currency: "EUR",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send("refunds", {
          refund_id: "refund_2",
          transaction_id: "sale_1",
          amount_minor: 800,
          currency: "USD",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send("refunds", {
          refund_id: "refund_2",
          transaction_id: "sale_1",
          amount_minor: 700,
          currency: "USD",
        })
      ).status,
    ).toBe(201);
    expect(
      await env.DB.prepare(
        "SELECT SUM(amount_minor) FROM money_records WHERE kind='refund'",
      ).first("SUM(amount_minor)"),
    ).toBe(1000);
  });
  it("keeps refund-before-payment visible and transaction IDs independent across merchant namespaces", async () => {
    await setup();
    expect(
      (
        await send("refunds", {
          refund_id: "early",
          transaction_id: "future",
          amount_minor: 200,
          currency: "USD",
        })
      ).status,
    ).toBe(201);
    await recordMoney(env, key, { ...payment, transactionId: "future" });
    await recordMoney(env, { ...key, namespace: "api:other" }, payment);
    await recordMoney(env, key, payment);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM money_records WHERE kind='payment'",
      ).first("n"),
    ).toBe(3);
  });
  it("rejects unknown or unsigned checkout claims without creating revenue", async () => {
    await setup();
    expect(
      (
        await send("payments", {
          transaction_id: "sale_1",
          amount_minor: 1000,
          currency: "USD",
          claim_token: "fake.signature",
          checkout_id: "checkout_1",
        })
      ).status,
    ).toBe(409);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM money_records").first("n"),
    ).toBe(0);
  });
});

it("admits no more than ten active server keys under concurrent creation", async () => {
  await setup();
  const attempts = Array.from({ length: 15 }, (_, i) =>
    env.DB.prepare(
      "INSERT INTO site_api_keys(id,workspace_id,site_id,name,token_hash,prefix,namespace,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        `concurrent_key_${i}`,
        "ws_revenue",
        "site_revenue",
        "Key",
        `unique_hash_${i}`,
        "an_key",
        "api:shop",
        now,
      )
      .run(),
  );
  const results = await Promise.allSettled(attempts);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(9);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) n FROM site_api_keys WHERE revoked_at IS NULL",
    ).first("n"),
  ).toBe(10);
  expect(
    results
      .filter((r) => r.status === "rejected")
      .every((r) =>
        String((r as PromiseRejectedResult).reason).includes("key_limit"),
      ),
  ).toBe(true);
});
