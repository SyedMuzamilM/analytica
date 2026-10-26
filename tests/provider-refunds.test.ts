import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { app } from "../apps/worker/index";
import { cleanupRevenue, recordMoney } from "../apps/worker/revenue";
import { retryProviderRefunds } from "../apps/worker/provider-refunds";

const encoder = new TextEncoder();
const origin = "https://analytica.test";
const secret = encoder.encode("test-only-provider-refund-signing-secret");
const b64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const key = {
  id: "",
  workspace_id: "ws_provider_refunds",
  site_id: "site_provider_refunds",
  namespace: "dodo:merchant_refunds",
  privacy_mode: "attribution",
  integrationId: "integration_refunds",
};
async function setup() {
  const now = Date.now();
  const encryptionKey = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", encoder.encode(env.APP_SECRET)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    encoder.encode(`whsec_${b64(secret)}`),
  );
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)",
    ).bind(key.workspace_id, "Refunds", now),
    env.DB.prepare(
      "INSERT INTO sites(id,workspace_id,name,domain,timezone,privacy_mode,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(
      key.site_id,
      key.workspace_id,
      "Shop",
      "example.com",
      "UTC",
      "attribution",
      "active",
      now,
    ),
    env.DB.prepare(
      "INSERT INTO payment_integrations(id,workspace_id,site_id,provider,merchant_id,secret_ciphertext,created_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(
      key.integrationId,
      key.workspace_id,
      key.site_id,
      "dodo",
      "merchant_refunds",
      `v1.${b64(iv)}.${b64(new Uint8Array(ciphertext))}`,
      now,
    ),
  ]);
}
async function sale(transactionId = "pay_refunds", namespace = key.namespace) {
  await recordMoney(
    env,
    { ...key, namespace },
    {
      kind: "payment",
      transactionId,
      originalId: null,
      amount: 2500,
      currency: "USD",
      occurredAt: Date.now(),
    },
  );
}
async function webhook(
  data: Record<string, unknown>,
  eventId = "refund_delivery",
) {
  const raw = JSON.stringify({ type: "refund.succeeded", data });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signingKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = b64(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        signingKey,
        encoder.encode(`${eventId}.${timestamp}.${raw}`),
      ),
    ),
  );
  return app.request(
    `${origin}/v1/webhooks/dodo/${key.integrationId}`,
    {
      method: "POST",
      headers: {
        "webhook-id": eventId,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
        "content-type": "application/json",
      },
      body: raw,
    },
    env,
  );
}
const refund = (extra: Record<string, unknown> = {}) => ({
  refund_id: "ref_provider",
  payment_id: "pay_refunds",
  ...extra,
});

describe("signed Dodo refunds with optional provider fields", () => {
  it("fills omitted currency from the scoped payment and full amount only for an explicit full refund", async () => {
    await setup();
    await sale();
    const response = await webhook(
      refund({ is_partial: false, amount: null, currency: null }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(
      await env.DB.prepare(
        "SELECT amount_minor,currency FROM money_records WHERE kind='refund'",
      ).first(),
    ).toMatchObject({ amount_minor: 2500, currency: "USD" });
    expect(
      (
        await webhook(
          refund({ is_partial: false, amount: null, currency: null }),
        )
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM money_records WHERE kind='refund'",
      ).first("n"),
    ).toBe(1);
  });
  it("records a partial refund with its explicit amount and omitted currency", async () => {
    await setup();
    await sale();
    expect(
      (await webhook(refund({ amount: 500, is_partial: true }))).status,
    ).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT amount_minor,currency FROM money_records WHERE kind='refund'",
      ).first(),
    ).toMatchObject({ amount_minor: 500, currency: "USD" });
  });
  it("durably keeps an early full refund and resolves it when its payment arrives", async () => {
    await setup();
    const data = refund({
      is_partial: false,
      created_at: new Date().toISOString(),
      customer: { email: "must-not-be-persisted@example.com" },
      metadata: { analytica_claim: "must-not-be-persisted" },
    });
    const early = await webhook(data);
    expect(early.status).toBe(202);
    expect(await early.json()).toMatchObject({ ok: true, pending: true });
    expect((await webhook(data)).status).toBe(202);
    const stored = await env.DB.prepare(
      "SELECT * FROM pending_provider_refunds",
    ).first();
    expect(stored).toMatchObject({
      payment_id: "pay_refunds",
      amount_minor: null,
      currency: null,
      is_full: 1,
      status: "pending",
    });
    expect(JSON.stringify(stored)).not.toContain("must-not-be-persisted");
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM payment_receipts").first(
        "n",
      ),
    ).toBe(1);
    await sale();
    await retryProviderRefunds(env, recordMoney);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pending_provider_refunds",
      ).first("n"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT amount_minor,currency FROM money_records WHERE kind='refund'",
      ).first(),
    ).toMatchObject({ amount_minor: 2500, currency: "USD" });
    expect((await webhook(data)).status).toBe(200);
  });
  it("never guesses an omitted partial or unspecified refund amount", async () => {
    await setup();
    await sale();
    for (const [index, is_partial] of [true, undefined].entries()) {
      const response = await webhook(
        refund({ refund_id: `ref_unknown_${index}`, is_partial }),
        `delivery_${index}`,
      );
      expect(response.status).toBe(202);
    }
    await retryProviderRefunds(env, recordMoney);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM money_records WHERE kind='refund'",
      ).first("n"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pending_provider_refunds WHERE status='needs_review' AND reason='refund_amount_required'",
      ).first("n"),
    ).toBe(2);
  });
  it("cannot infer missing fields from a payment in another merchant namespace", async () => {
    await setup();
    await sale("pay_refunds", "api:other_merchant");
    expect((await webhook(refund({ is_partial: false }))).status).toBe(202);
    await retryProviderRefunds(env, recordMoney);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM money_records WHERE kind='refund'",
      ).first("n"),
    ).toBe(0);
  });
  it("a changed signed delivery body conflicts even while unresolved", async () => {
    await setup();
    expect((await webhook(refund({ is_partial: false }))).status).toBe(202);
    const changed = await webhook(refund({ amount: 10, is_partial: true }));
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ error: "webhook_id_conflict" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pending_provider_refunds",
      ).first("n"),
    ).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT amount_minor FROM pending_provider_refunds",
      ).first("amount_minor"),
    ).toBeNull();
  });
  it("redelivery after an early refund resolves the same row without leaving pending evidence", async () => {
    await setup();
    const data = refund({ amount: 500, is_partial: true });
    expect((await webhook(data)).status).toBe(202);
    await sale();
    expect((await webhook(data)).status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pending_provider_refunds",
      ).first("n"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM money_records WHERE kind='refund'",
      ).first("n"),
    ).toBe(1);
  });
  it("reconciles a trusted server refund without making timestamp differences a permanent conflict", async () => {
    await setup();
    const data = refund({
      is_partial: false,
      created_at: new Date(Date.now() - 60000).toISOString(),
    });
    expect((await webhook(data)).status).toBe(202);
    await sale();
    await recordMoney(env, key, {
      kind: "refund",
      transactionId: "ref_provider",
      originalId: "pay_refunds",
      amount: 2500,
      currency: "USD",
      occurredAt: Date.now(),
    });
    for (let index = 0; index < 2; index++)
      expect((await webhook(data)).status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pending_provider_refunds",
      ).first("n"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM money_records WHERE kind='refund'",
      ).first("n"),
    ).toBe(1);
  });
  it("keeps unresolved evidence and its original payment through retention, then deletes it with its site", async () => {
    await setup();
    await sale();
    expect((await webhook(refund({ is_partial: true }))).status).toBe(202);
    const old = Date.now() - 397 * 86400000;
    await env.DB.batch([
      env.DB.prepare("UPDATE money_records SET received_at=?").bind(old),
      env.DB.prepare("UPDATE pending_provider_refunds SET received_at=?").bind(
        old,
      ),
      env.DB.prepare("UPDATE payment_receipts SET received_at=?").bind(old),
    ]);
    await cleanupRevenue(env);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pending_provider_refunds",
      ).first("n"),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM payment_receipts").first(
        "n",
      ),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM money_records").first("n"),
    ).toBe(1);
    await env.DB.prepare("UPDATE sites SET status='deleting' WHERE id=?")
      .bind(key.site_id)
      .run();
    await cleanupRevenue(env);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pending_provider_refunds",
      ).first("n"),
    ).toBe(0);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM payment_receipts").first(
        "n",
      ),
    ).toBe(0);
  });
  it("bounds pending admission and rolls back the receipt when storage is full", async () => {
    await setup();
    expect((await webhook(refund({ is_partial: true }))).status).toBe(202);
    await env.DB.prepare(
      `WITH RECURSIVE counts(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM counts WHERE n<999)
      INSERT INTO pending_provider_refunds(integration_id,event_id,workspace_id,site_id,namespace,refund_id,payment_id,amount_minor,currency,is_full,occurred_at,timestamp_provided,digest,received_at,last_attempt_at,status,reason)
      SELECT integration_id,'fill_'||n,workspace_id,site_id,namespace,'refund_'||n,payment_id,amount_minor,currency,is_full,occurred_at,timestamp_provided,digest,received_at,last_attempt_at,status,reason
      FROM pending_provider_refunds CROSS JOIN counts WHERE event_id='refund_delivery'`,
    ).run();
    const overflow = await webhook(
      refund({ refund_id: "ref_overflow", is_partial: true }),
      "overflow_delivery",
    );
    expect(overflow.status).toBe(503);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pending_provider_refunds",
      ).first("n"),
    ).toBe(1000);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM payment_receipts WHERE event_id='overflow_delivery'",
      ).first("n"),
    ).toBe(0);
  });
  it("fairly advances a bounded retry batch past unresolved records", async () => {
    await setup();
    for (let i = 0; i < 21; i++)
      expect(
        (
          await webhook(
            refund({ refund_id: `ref_unknown_${i}`, is_partial: true }),
            `unknown_${i}`,
          )
        ).status,
      ).toBe(202);
    expect(
      (
        await webhook(
          refund({ refund_id: "ref_ready", is_partial: false }),
          "ready_delivery",
        )
      ).status,
    ).toBe(202);
    await env.DB.prepare(
      "UPDATE pending_provider_refunds SET last_attempt_at=0,received_at=CASE WHEN event_id='ready_delivery' THEN 1 ELSE 0 END",
    ).run();
    await sale();
    const now = Date.now();
    await retryProviderRefunds(env, recordMoney, now);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM money_records WHERE kind='refund'",
      ).first("n"),
    ).toBe(0);
    await retryProviderRefunds(env, recordMoney, now + 1);
    expect(
      await env.DB.prepare(
        "SELECT external_id FROM money_records WHERE kind='refund'",
      ).first("external_id"),
    ).toBe("ref_ready");
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pending_provider_refunds",
      ).first("n"),
    ).toBe(21);
  });
  it("malformed explicit money fields remain errors rather than pending records", async () => {
    await setup();
    await sale();
    for (const [index, extra] of [
      { amount: -1 },
      { amount: 1.5 },
      { currency: "XYZ" },
    ].entries())
      expect(
        (await webhook(refund({ ...extra, is_partial: false }), `bad_${index}`))
          .status,
      ).toBe(400);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM pending_provider_refunds",
      ).first("n"),
    ).toBe(0);
  });
});
