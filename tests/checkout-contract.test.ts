import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { app } from "../apps/worker/index";
import { digest as digestForKey } from "../apps/worker/revenue";

const encoder = new TextEncoder();
const origin = "https://analytica.test";
const b64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const url64 = (value: Uint8Array) =>
  b64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(secret: string, value: string) {
  const imported = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return url64(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", imported, encoder.encode(value)),
    ),
  );
}
async function seedSite() {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)",
    ).bind("ws_repro", "Repro", now),
    env.DB.prepare(
      "INSERT INTO sites(id,workspace_id,name,domain,timezone,privacy_mode,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(
      "site_repro",
      "ws_repro",
      "Shop",
      "example.com",
      "UTC",
      "attribution",
      "active",
      now,
    ),
  ]);
  return now;
}
async function seedIntegration(secretText: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", encoder.encode(env.APP_SECRET)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const secret = `whsec_${b64(encoder.encode(secretText))}`;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(secret),
  );
  await env.DB.prepare(
    "INSERT INTO payment_integrations(id,workspace_id,site_id,provider,merchant_id,secret_ciphertext,created_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      "integration_repro",
      "ws_repro",
      "site_repro",
      "dodo",
      "merchant_repro",
      `v1.${b64(iv)}.${b64(new Uint8Array(ciphertext))}`,
      Date.now(),
    )
    .run();
  return encoder.encode(secretText);
}
async function webhook(secretText: string, id: string, payload: object) {
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signingKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = b64(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        signingKey,
        encoder.encode(`${id}.${timestamp}.${raw}`),
      ),
    ),
  );
  return app.request(
    `${origin}/v1/webhooks/dodo/integration_repro`,
    {
      method: "POST",
      headers: {
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
        "content-type": "application/json",
      },
      body: raw,
    },
    env,
  );
}
const serverKeyToken = "an_" + "c".repeat(64);
async function seedAttribution() {
  const now = await seedSite();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO site_api_keys(id,workspace_id,site_id,name,token_hash,prefix,namespace,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(
      "key_repro",
      "ws_repro",
      "site_repro",
      "API",
      await digestForKey(serverKeyToken),
      serverKeyToken.slice(0, 11),
      "api:repro",
      now,
    ),
    env.DB.prepare(
      `INSERT INTO analytics_sessions(workspace_id,site_id,id,visitor_id,privacy_mode,started_at,started_day,exit_ts,exit_sequence,last_interaction_at,last_received_at,last_event_at,entry_page,exit_page,source,channel)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      "ws_repro",
      "site_repro",
      "session_repro_1",
      "visitor_repro_1",
      "attribution",
      now,
      "2026-10-26",
      now,
      0,
      now,
      now,
      now,
      "/",
      "/",
      "Newsletter",
      "Email",
    ),
  ]);
}
async function checkout(body: object, bindings: typeof env = env) {
  return app.request(
    `${origin}/v1/server/checkouts`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${serverKeyToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    bindings,
  );
}

const checkoutBody = {
  checkout_id: "merchant_order_1",
  visitor_id: "visitor_repro_1",
  session_id: "session_repro_1",
};
describe("checkout creation contract", () => {
  it("retries one persisted claim without extending expiry and rejects association changes", async () => {
    await seedAttribution();
    const issued = await Promise.all([
      checkout(checkoutBody),
      checkout(checkoutBody),
      checkout(checkoutBody),
    ]);
    expect(issued.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    const tokens = await Promise.all(
      issued.map((r) => r.json() as Promise<{ claim_token: string }>),
    );
    expect(new Set(tokens.map((t) => t.claim_token)).size).toBe(1);
    const before = await env.DB.prepare(
      "SELECT expires_at FROM checkout_claims",
    ).first("expires_at");
    expect((await checkout(checkoutBody)).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT expires_at FROM checkout_claims").first(
        "expires_at",
      ),
    ).toBe(before);
    // Same eligible visitor can have another session, but cannot repoint the checkout.
    await env.DB.prepare(
      "UPDATE analytics_sessions SET id='session_repro_2'",
    ).run();
    expect(
      (await checkout({ ...checkoutBody, session_id: "session_repro_2" }))
        .status,
    ).toBe(409);
  });
  for (const change of ["revoke", "disable"] as const)
    it(`does not issue a token after competing ${change}`, async () => {
      await seedAttribution();
      await seedIntegration("checkout-race-signing-secret");
      await env.DB.prepare(
        "UPDATE site_api_keys SET integration_id='integration_repro',namespace='dodo:merchant_repro'",
      ).run();
      const racingDb = new Proxy(env.DB, {
        get(target, property) {
          if (property === "prepare")
            return (sql: string) => {
              const statement = target.prepare(sql);
              if (sql.startsWith("SELECT k.*,s.privacy_mode"))
                return {
                  bind: (...args: unknown[]) => {
                    const bound = statement.bind(...args);
                    return {
                      first: async () => {
                        const read = await bound.first();
                        await env.DB.prepare(
                          change === "revoke"
                            ? "UPDATE site_api_keys SET revoked_at=1"
                            : "UPDATE payment_integrations SET disabled_at=1",
                        ).run();
                        return read;
                      },
                    };
                  },
                };
              return statement;
            };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as D1Database;
      const response = await checkout(checkoutBody, { ...env, DB: racingDb });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "checkout_unavailable" });
      expect(
        await env.DB.prepare("SELECT COUNT(*) n FROM checkout_claims").first(
          "n",
        ),
      ).toBe(0);
    });
  it("accepts merchant metadata on a provider-generated checkout and rejects a mismatched order", async () => {
    await seedAttribution();
    await seedIntegration("checkout-contract-signing-secret");
    await env.DB.prepare(
      "UPDATE site_api_keys SET integration_id='integration_repro',namespace='dodo:merchant_repro'",
    ).run();
    const issued = await checkout(checkoutBody);
    expect(issued.status).toBe(201);
    const { claim_token } = (await issued.json()) as { claim_token: string };
    const payload = {
      type: "payment.succeeded",
      data: {
        payment_id: "pay_checkout",
        total_amount: 2500,
        currency: "USD",
        created_at: new Date().toISOString(),
        checkout_session_id: "cks_generated_by_dodo",
        metadata: {
          analytica_claim: claim_token,
          analytica_checkout: checkoutBody.checkout_id,
        },
      },
    };
    const wrong = await webhook(
      "checkout-contract-signing-secret",
      "wrong_order",
      {
        ...payload,
        data: {
          ...payload.data,
          metadata: {
            ...payload.data.metadata,
            analytica_checkout: "another_order",
          },
        },
      },
    );
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toEqual({ error: "invalid_claim" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM money_records").first("n"),
    ).toBe(0);
    const response = await webhook(
      "checkout-contract-signing-secret",
      "good_order",
      payload,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, attributed: true });
    expect(
      await env.DB.prepare(
        "SELECT namespace,source,matched_by FROM money_records",
      ).first(),
    ).toMatchObject({
      namespace: "dodo:merchant_repro",
      source: "Newsletter",
      matched_by: "verified_checkout",
    });
    expect(
      (await webhook("checkout-contract-signing-secret", "good_order", payload))
        .status,
    ).toBe(200);
  });
});
