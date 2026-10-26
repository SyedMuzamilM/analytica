import { Hono, type Context } from "hono";
import { requireAuth, requireWorkspace } from "./auth";
import type { AppEnv, Bindings } from "./env";
import { pendingSiteDeletions } from "./deletion";
import { recordProviderRefund, retryProviderRefunds } from "./provider-refunds";

const encoder = new TextEncoder();
const identifier = /^[a-zA-Z0-9_.:-]{1,128}$/;
const DAY = 86400000;
export const revenueRoutes = new Hono<AppEnv>();
export const moneyRoutes = new Hono<AppEnv>();
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function randomToken() {
  return (
    crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "")
  );
}
function equal(a: string, b: string) {
  let result = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return result === 0;
}
function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
function bytes(value: string) {
  return Uint8Array.from(atob(value), (x) => x.charCodeAt(0));
}
async function encryptionKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", encoder.encode(secret)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
async function encrypt(secret: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    encoder.encode(value),
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(ciphertext))}`;
}
async function decrypt(secret: string, value: string) {
  const [, iv, data] = value.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(iv) },
      await encryptionKey(secret),
      bytes(data),
    ),
  );
}
async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function validSecret(value: string | undefined) {
  return !!value && value.length >= 32 && !/REPLACE|CHANGEME/i.test(value);
}
function currency(value: unknown) {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) return null;
  try {
    if (!Intl.supportedValuesOf("currency").includes(value)) return null;
    return value;
  } catch {
    return null;
  }
}
async function site(c: Context<AppEnv>) {
  return c.env.DB.prepare(
    "SELECT * FROM sites WHERE workspace_id=? AND id=? AND status!=?",
  )
    .bind(c.req.param("wid"), c.req.param("sid"), "deleting")
    .first<Record<string, unknown>>();
}
revenueRoutes.use(
  "/workspaces/:wid/sites/:sid/*",
  requireAuth,
  requireWorkspace("viewer"),
);
revenueRoutes.get("/workspaces/:wid/sites/:sid/keys", async (c) => {
  if (!(await site(c))) return c.json({ error: "site_not_found" }, 404);
  if (c.get("workspace").role === "viewer")
    return c.json({ error: "forbidden" }, 403);
  const records = await c.env.DB.prepare(
    "SELECT id,name,prefix,namespace,created_at,revoked_at FROM site_api_keys WHERE workspace_id=? AND site_id=? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(c.req.param("wid"), c.req.param("sid"))
    .all();
  return c.json(records.results);
});
revenueRoutes.post(
  "/workspaces/:wid/sites/:sid/keys",
  requireWorkspace("admin"),
  async (c) => {
    if (!(await site(c))) return c.json({ error: "site_not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    if (
      typeof body.name !== "string" ||
      body.name.length > 80 ||
      !body.name.trim() ||
      typeof body.namespace !== "string" ||
      !identifier.test(body.namespace)
    )
      return c.json({ error: "invalid_key_configuration" }, 400);
    let namespace = `api:${body.namespace}`;
    let integrationId: string | null = null;
    if (typeof body.integrationId === "string") {
      const integration = await c.env.DB.prepare(
        "SELECT id,merchant_id FROM payment_integrations WHERE id=? AND workspace_id=? AND site_id=? AND disabled_at IS NULL",
      )
        .bind(body.integrationId, c.req.param("wid"), c.req.param("sid"))
        .first<{ id: string; merchant_id: string }>();
      if (!integration) return c.json({ error: "integration_not_found" }, 404);
      namespace = `dodo:${integration.merchant_id}`;
      integrationId = integration.id;
    } else if (body.namespace.startsWith("dodo:"))
      return c.json({ error: "integration_required" }, 400);
    const count = await c.env.DB.prepare(
      "SELECT COUNT(*) n FROM site_api_keys WHERE workspace_id=? AND site_id=? AND revoked_at IS NULL",
    )
      .bind(c.req.param("wid"), c.req.param("sid"))
      .first<{ n: number }>();
    if ((count?.n || 0) >= 10) return c.json({ error: "key_limit" }, 409);
    const token = "an_" + randomToken(),
      id = crypto.randomUUID();
    try {
      await c.env.DB.prepare(
        "INSERT INTO site_api_keys(id,workspace_id,site_id,name,token_hash,prefix,namespace,integration_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          id,
          c.req.param("wid"),
          c.req.param("sid"),
          body.name.trim(),
          await digest(token),
          token.slice(0, 11),
          namespace,
          integrationId,
          Date.now(),
        )
        .run();
    } catch (error) {
      if (String(error).includes("key_limit"))
        return c.json({ error: "key_limit" }, 409);
      if (/site_inactive|integration_unavailable/.test(String(error)))
        return c.json({ error: "key_configuration_changed" }, 409);
      throw error;
    }
    return c.json({ id, token, namespace }, 201);
  },
);
revenueRoutes.delete(
  "/workspaces/:wid/sites/:sid/keys/:key",
  requireWorkspace("admin"),
  async (c) => {
    await c.env.DB.prepare(
      "UPDATE site_api_keys SET revoked_at=? WHERE id=? AND workspace_id=? AND site_id=?",
    )
      .bind(
        Date.now(),
        c.req.param("key"),
        c.req.param("wid"),
        c.req.param("sid"),
      )
      .run();
    return c.json({ ok: true });
  },
);
revenueRoutes.get("/workspaces/:wid/sites/:sid/integrations", async (c) => {
  if (!(await site(c))) return c.json({ error: "site_not_found" }, 404);
  if (c.get("workspace").role === "viewer")
    return c.json({ error: "forbidden" }, 403);
  const data = await c.env.DB.prepare(
    "SELECT id,provider,merchant_id,created_at,disabled_at FROM payment_integrations WHERE workspace_id=? AND site_id=?",
  )
    .bind(c.req.param("wid"), c.req.param("sid"))
    .all();
  return c.json(data.results);
});
revenueRoutes.post(
  "/workspaces/:wid/sites/:sid/integrations",
  requireWorkspace("admin"),
  async (c) => {
    if (!(await site(c))) return c.json({ error: "site_not_found" }, 404);
    if (!validSecret(c.env.APP_SECRET))
      return c.json({ error: "application_secret_required" }, 503);
    const body = await c.req.json<Record<string, unknown>>();
    if (
      body.provider !== "dodo" ||
      typeof body.merchantId !== "string" ||
      !identifier.test(body.merchantId) ||
      typeof body.webhookSecret !== "string" ||
      !body.webhookSecret.startsWith("whsec_") ||
      body.webhookSecret.length > 500
    )
      return c.json({ error: "invalid_integration" }, 400);
    const id = crypto.randomUUID();
    try {
      await c.env.DB.prepare(
        "INSERT INTO payment_integrations(id,workspace_id,site_id,provider,merchant_id,secret_ciphertext,created_at) VALUES(?,?,?,?,?,?,?)",
      )
        .bind(
          id,
          c.req.param("wid"),
          c.req.param("sid"),
          "dodo",
          body.merchantId,
          await encrypt(c.env.APP_SECRET, body.webhookSecret),
          Date.now(),
        )
        .run();
    } catch {
      return c.json({ error: "integration_already_exists" }, 409);
    }
    return c.json(
      {
        id,
        webhookUrl: `${c.env.APP_ORIGIN || new URL(c.req.url).origin}/v1/webhooks/dodo/${id}`,
      },
      201,
    );
  },
);
revenueRoutes.delete(
  "/workspaces/:wid/sites/:sid/integrations/:integration",
  requireWorkspace("admin"),
  async (c) => {
    await c.env.DB.prepare(
      "UPDATE payment_integrations SET disabled_at=? WHERE workspace_id=? AND site_id=? AND id=?",
    )
      .bind(
        Date.now(),
        c.req.param("wid"),
        c.req.param("sid"),
        c.req.param("integration"),
      )
      .run();
    return c.json({ ok: true });
  },
);
interface ServerKey {
  id: string;
  workspace_id: string;
  site_id: string;
  namespace: string;
  privacy_mode: string;
  integrationId?: string;
  integration_id?: string | null;
}
async function serverKey(c: Context<AppEnv>) {
  const token = c.req.header("authorization")?.replace(/^Bearer /i, "");
  if (!token || !/^an_[0-9a-f]{64}$/.test(token)) return null;
  return c.env.DB.prepare(
    "SELECT k.*,s.privacy_mode FROM site_api_keys k JOIN sites s ON s.workspace_id=k.workspace_id AND s.id=k.site_id WHERE k.token_hash=? AND k.revoked_at IS NULL AND s.status=? AND (k.integration_id IS NULL OR EXISTS(SELECT 1 FROM payment_integrations i WHERE i.id=k.integration_id AND i.disabled_at IS NULL))",
  )
    .bind(await digest(token), "active")
    .first<ServerKey>();
}
interface MoneyInput {
  transactionId: string;
  kind: "payment" | "refund";
  originalId: string | null;
  amount: number;
  currency: string;
  occurredAt: number;
  claimToken?: string;
  checkoutId?: string;
  timestampProvided?: boolean;
}
function moneyInput(
  body: Record<string, unknown>,
  kind: "payment" | "refund",
): MoneyInput | null {
  const external = kind === "payment" ? body.transaction_id : body.refund_id;
  const cur = currency(body.currency);
  if (
    typeof external !== "string" ||
    !identifier.test(external) ||
    !Number.isSafeInteger(body.amount_minor) ||
    Number(body.amount_minor) < 0 ||
    Number(body.amount_minor) > 100000000000 ||
    !cur
  )
    return null;
  if (
    kind === "refund" &&
    (typeof body.transaction_id !== "string" ||
      !identifier.test(body.transaction_id))
  )
    return null;
  const occurred =
    body.timestamp === undefined
      ? Date.now()
      : typeof body.timestamp === "string"
        ? Date.parse(body.timestamp)
        : Number(body.timestamp);
  if (
    !Number.isFinite(occurred) ||
    occurred < 946684800000 ||
    occurred > Date.now() + 300000 ||
    occurred < Date.now() - 395 * DAY
  )
    return null;
  if (
    body.claim_token !== undefined &&
    (typeof body.claim_token !== "string" || body.claim_token.length > 256)
  )
    return null;
  return {
    transactionId: external,
    kind,
    originalId: kind === "refund" ? (body.transaction_id as string) : null,
    amount: Number(body.amount_minor),
    currency: cur,
    occurredAt: occurred,
    claimToken: body.claim_token as string | undefined,
    checkoutId:
      typeof body.checkout_id === "string" ? body.checkout_id : undefined,
    timestampProvided: body.timestamp !== undefined,
  };
}
export async function recordMoney(
  env: Bindings,
  key: ServerKey,
  input: MoneyInput,
  receipt?: { integrationId: string; eventId: string; digest: string },
) {
  // Omitted timestamp must not make a repeated transaction a conflicting economic payload.
  const fingerprint = await digest(
    JSON.stringify([
      input.kind,
      input.transactionId,
      input.originalId,
      input.amount,
      input.currency,
      input.claimToken || null,
      input.checkoutId || null,
      input.timestampProvided ? input.occurredAt : null,
    ]),
  );
  const receiptStatement = receipt
    ? env.DB.prepare(
        "INSERT INTO payment_receipts(integration_id,event_id,digest,received_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
      ).bind(receipt.integrationId, receipt.eventId, receipt.digest, Date.now())
    : null;
  const previous = await env.DB.prepare(
    "SELECT digest,matched_by FROM money_records WHERE workspace_id=? AND site_id=? AND namespace=? AND kind=? AND external_id=?",
  )
    .bind(
      key.workspace_id,
      key.site_id,
      key.namespace,
      input.kind,
      input.transactionId,
    )
    .first<{ digest: string; matched_by: string | null }>();
  if (previous) {
    if (previous.digest !== fingerprint)
      throw new Error("idempotency_conflict");
    if (receiptStatement) await env.DB.batch([receiptStatement]);
    return { ok: true, attributed: !!previous.matched_by, duplicate: true };
  }
  let claim: Record<string, unknown> | null = null;
  if (
    input.claimToken &&
    input.kind === "payment" &&
    key.privacy_mode === "attribution" &&
    validSecret(env.APP_SECRET)
  ) {
    const [claimId, signature] = input.claimToken.split(".");
    if (
      !claimId ||
      !signature ||
      !equal(await hmac(env.APP_SECRET, claimId), signature)
    )
      throw new Error("invalid_claim");
    claim = await env.DB.prepare(
      "SELECT * FROM checkout_claims WHERE id=? AND workspace_id=? AND site_id=? AND namespace=? AND checkout_id=? AND expires_at>? AND (consumed_by IS NULL OR consumed_by=?)",
    )
      .bind(
        claimId,
        key.workspace_id,
        key.site_id,
        key.namespace,
        input.checkoutId || "",
        Date.now(),
        input.transactionId,
      )
      .first();
    if (!claim) throw new Error("invalid_claim");
  }
  const sql = env.DB.prepare(
    "INSERT INTO money_records(workspace_id,site_id,namespace,external_id,kind,original_id,amount_minor,currency,occurred_at,received_at,digest,source,channel,campaign,matched_by,claim_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sites WHERE workspace_id=? AND id=? AND status=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM site_api_keys WHERE id=? AND revoked_at IS NULL)) AND (? IS NULL OR EXISTS(SELECT 1 FROM payment_integrations WHERE id=? AND disabled_at IS NULL)) ON CONFLICT(workspace_id,site_id,namespace,kind,external_id) DO NOTHING",
  ).bind(
    key.workspace_id,
    key.site_id,
    key.namespace,
    input.transactionId,
    input.kind,
    input.originalId,
    input.amount,
    input.currency,
    input.occurredAt,
    Date.now(),
    fingerprint,
    claim?.source ?? null,
    claim?.channel ?? null,
    claim?.campaign ?? null,
    claim ? "verified_checkout" : null,
    claim?.id ?? null,
    key.workspace_id,
    key.site_id,
    "active",
    key.id || null,
    key.id || null,
    key.integrationId || key.integration_id || null,
    key.integrationId || key.integration_id || null,
  );
  await env.DB.batch([...(receiptStatement ? [receiptStatement] : []), sql]);
  const stored = await env.DB.prepare(
    "SELECT digest FROM money_records WHERE workspace_id=? AND site_id=? AND namespace=? AND kind=? AND external_id=?",
  )
    .bind(
      key.workspace_id,
      key.site_id,
      key.namespace,
      input.kind,
      input.transactionId,
    )
    .first<{ digest: string }>();
  if (!stored) throw new Error("key_revoked_or_site_inactive");
  if (stored.digest !== fingerprint) throw new Error("idempotency_conflict");
  return { ok: true, attributed: !!claim };
}
for (const [path, kind] of [
  ["payments", "payment"],
  ["refunds", "refund"],
] as const)
  moneyRoutes.post(`/server/${path}`, async (c) => {
    const key = await serverKey(c);
    if (!key) return c.json({ error: "invalid_api_key" }, 401);
    const input = moneyInput(await c.req.json<Record<string, unknown>>(), kind);
    if (!input)
      return c.json(
        {
          error: "invalid_money_record",
          message:
            "Supply a unique transaction/refund ID, integer amount_minor, ISO currency, and valid timestamp.",
        },
        400,
      );
    try {
      return c.json(await recordMoney(c.env, key, input), 201);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      const code = [
        "idempotency_conflict",
        "invalid_refund",
        "invalid_claim",
        "key_revoked_or_site_inactive",
        "site_inactive",
      ].find((value) => reason.includes(value));
      if (code) return c.json({ error: code }, 409);
      throw error;
    }
  });
moneyRoutes.post("/server/checkouts", async (c) => {
  const key = await serverKey(c);
  if (!key) return c.json({ error: "invalid_api_key" }, 401);
  if (!validSecret(c.env.APP_SECRET))
    return c.json({ error: "application_secret_required" }, 503);
  if (key.privacy_mode !== "attribution")
    return c.json({ error: "attribution_not_enabled" }, 409);
  const body = await c.req.json<Record<string, unknown>>();
  if (
    typeof body.checkout_id !== "string" ||
    !identifier.test(body.checkout_id) ||
    typeof body.visitor_id !== "string" ||
    !/^[A-Za-z0-9_-]{8,80}$/.test(body.visitor_id) ||
    typeof body.session_id !== "string" ||
    !/^[A-Za-z0-9_-]{8,80}$/.test(body.session_id)
  )
    return c.json({ error: "invalid_checkout" }, 400);
  const session = await c.env.DB.prepare(
    "SELECT * FROM analytics_sessions WHERE workspace_id=? AND site_id=? AND id=? AND visitor_id=? AND privacy_mode=? AND started_at>=? AND NOT EXISTS(SELECT 1 FROM visitor_suppressions v WHERE v.workspace_id=analytics_sessions.workspace_id AND v.site_id=analytics_sessions.site_id AND v.visitor_id=analytics_sessions.visitor_id)",
  )
    .bind(
      key.workspace_id,
      key.site_id,
      body.session_id,
      body.visitor_id,
      "attribution",
      Date.now() - 30 * DAY,
    )
    .first<Record<string, unknown>>();
  if (!session) return c.json({ error: "eligible_session_not_found" }, 404);
  const credited = await c.env.DB.prepare(
    "SELECT * FROM analytics_sessions WHERE workspace_id=? AND site_id=? AND visitor_id=? AND privacy_mode='attribution' AND started_at>=? AND started_at<=? ORDER BY (channel!='Direct') DESC,started_at DESC LIMIT 1",
  )
    .bind(
      key.workspace_id,
      key.site_id,
      body.visitor_id,
      Date.now() - 30 * DAY,
      Date.now(),
    )
    .first<Record<string, unknown>>();
  const snapshot = credited || session;
  const id = crypto.randomUUID();
  let inserted = false;
  try {
    const result = await c.env.DB.prepare(
      "INSERT INTO checkout_claims(id,workspace_id,site_id,namespace,checkout_id,visitor_id,session_id,source,channel,campaign,expires_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM site_api_keys k WHERE k.id=? AND k.revoked_at IS NULL AND (k.integration_id IS NULL OR EXISTS(SELECT 1 FROM payment_integrations i WHERE i.id=k.integration_id AND i.disabled_at IS NULL))) AND EXISTS(SELECT 1 FROM sites WHERE id=? AND workspace_id=? AND status=? AND privacy_mode='attribution') ON CONFLICT(workspace_id,site_id,namespace,checkout_id) DO NOTHING",
    )
      .bind(
        id,
        key.workspace_id,
        key.site_id,
        key.namespace,
        body.checkout_id,
        body.visitor_id,
        body.session_id,
        snapshot.source,
        snapshot.channel,
        snapshot.campaign,
        Date.now() + DAY,
        key.id,
        key.site_id,
        key.workspace_id,
        "active",
      )
      .run();
    inserted = result.meta.changes === 1;
  } catch (error) {
    if (!String(error).includes("visitor_suppressed")) throw error;
    return c.json({ error: "visitor_suppressed" }, 409);
  }
  // Check persisted admission as well as the association on retries. A competing
  // revocation/disable must never return an unusable token after a zero-row insert.
  const stored = await c.env.DB.prepare(
    `SELECT c.* FROM checkout_claims c
     JOIN sites s ON s.workspace_id=c.workspace_id AND s.id=c.site_id
     WHERE c.workspace_id=? AND c.site_id=? AND c.namespace=? AND c.checkout_id=?
     AND s.status='active' AND s.privacy_mode='attribution'
     AND EXISTS(SELECT 1 FROM site_api_keys k WHERE k.id=? AND k.revoked_at IS NULL
       AND (k.integration_id IS NULL OR EXISTS(SELECT 1 FROM payment_integrations i WHERE i.id=k.integration_id AND i.disabled_at IS NULL)))
     AND NOT EXISTS(SELECT 1 FROM visitor_suppressions v WHERE v.workspace_id=c.workspace_id AND v.site_id=c.site_id AND v.visitor_id=c.visitor_id)`,
  )
    .bind(
      key.workspace_id,
      key.site_id,
      key.namespace,
      body.checkout_id,
      key.id,
    )
    .first<{
      id: string;
      visitor_id: string | null;
      session_id: string | null;
      expires_at: number;
      consumed_by: string | null;
    }>();
  if (!stored) return c.json({ error: "checkout_unavailable" }, 409);
  if (
    stored.visitor_id !== body.visitor_id ||
    stored.session_id !== body.session_id ||
    stored.consumed_by !== null ||
    stored.expires_at <= Date.now()
  )
    return c.json({ error: "checkout_already_registered" }, 409);
  return c.json(
    {
      claim_token: `${stored.id}.${await hmac(c.env.APP_SECRET, stored.id)}`,
      expires_in: Math.max(
        0,
        Math.floor((stored.expires_at - Date.now()) / 1000),
      ),
      checkout_id: body.checkout_id,
    },
    inserted ? 201 : 200,
  );
});

async function verifyWebhook(
  secret: string,
  id: string,
  timestamp: string,
  signature: string,
  body: string,
) {
  const seconds = Number(timestamp);
  if (
    !Number.isFinite(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > 300 ||
    !id ||
    id.length > 200
  )
    return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(secret.replace(/^whsec_/, "")),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = b64(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(`${id}.${timestamp}.${body}`),
        ),
      ),
    );
    return signature
      .split(" ")
      .some(
        (entry) => entry.startsWith("v1,") && equal(entry.slice(3), expected),
      );
  } catch {
    return false;
  }
}
moneyRoutes.post("/webhooks/dodo/:integrationId", async (c) => {
  const integration = await c.env.DB.prepare(
    "SELECT i.*,s.privacy_mode,s.status AS site_status FROM payment_integrations i JOIN sites s ON s.workspace_id=i.workspace_id AND s.id=i.site_id WHERE i.id=? AND i.disabled_at IS NULL",
  )
    .bind(c.req.param("integrationId"))
    .first<Record<string, unknown>>();
  if (!integration) return c.json({ error: "integration_not_found" }, 404);
  if (!validSecret(c.env.APP_SECRET))
    return c.json({ error: "application_secret_required" }, 503);
  const raw = await c.req.text();
  if (encoder.encode(raw).length > 65536)
    return c.json({ error: "body_too_large" }, 413);
  const eventId = c.req.header("webhook-id") || "";
  if (
    !(await verifyWebhook(
      await decrypt(c.env.APP_SECRET, String(integration.secret_ciphertext)),
      eventId,
      c.req.header("webhook-timestamp") || "",
      c.req.header("webhook-signature") || "",
      raw,
    ))
  )
    return c.json({ error: "invalid_signature" }, 401);
  if (integration.site_status === "deleting")
    return c.json({ error: "site_deleted" }, 410);
  if (integration.site_status === "paused") {
    c.header("Retry-After", "60");
    return c.json({ error: "site_paused" }, 503);
  }
  const fingerprint = await digest(raw);
  const previous = await c.env.DB.prepare(
    "SELECT digest FROM payment_receipts WHERE integration_id=? AND event_id=?",
  )
    .bind(integration.id, eventId)
    .first<{ digest: string }>();
  if (previous && previous.digest !== fingerprint)
    return c.json({ error: "webhook_id_conflict" }, 409);
  const event = JSON.parse(raw) as {
    type: string;
    timestamp?: string;
    data?: Record<string, unknown>;
  };
  const data = event.data || {};
  if (!["payment.succeeded", "refund.succeeded"].includes(event.type))
    return c.json({ ok: true, ignored: true });
  const kind = event.type === "payment.succeeded" ? "payment" : "refund";
  // Provider currency/amount fields are kept in their original minor units. No mixed-currency conversion.
  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};
  const input = moneyInput(
    {
      claim_token: metadata.analytica_claim,
      checkout_id:
        metadata.analytica_checkout ??
        data.checkout_session_id ??
        data.checkout_id,
      transaction_id: data.payment_id,
      refund_id: data.refund_id,
      amount_minor: kind === "payment" ? data.total_amount : data.amount,
      currency:
        typeof data.currency === "string"
          ? data.currency.toUpperCase()
          : data.currency,
      timestamp: data.created_at || event.timestamp,
    },
    kind,
  );
  if (!input && kind === "payment")
    return c.json({ error: "invalid_provider_money_record" }, 400);
  const key: ServerKey = {
    id: "",
    workspace_id: String(integration.workspace_id),
    site_id: String(integration.site_id),
    namespace: `dodo:${integration.merchant_id}`,
    privacy_mode: String(integration.privacy_mode),
    integrationId: String(integration.id),
  };
  try {
    if (kind === "refund") {
      const result = await recordProviderRefund(
        c.env,
        key,
        data,
        data.created_at || event.timestamp,
        {
          integrationId: String(integration.id),
          eventId,
          digest: fingerprint,
        },
        recordMoney,
      );
      return c.json(result, result.pending ? 202 : 200);
    }
    const result = await recordMoney(c.env, key, input!, {
      integrationId: String(integration.id),
      eventId,
      digest: fingerprint,
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("invalid_provider_money_record"))
      return c.json({ error: "invalid_provider_money_record" }, 400);
    if (message.includes("provider_refund_limit")) {
      c.header("Retry-After", "60");
      return c.json({ error: "provider_refund_limit" }, 503);
    }
    if (/site_inactive|key_revoked_or_site_inactive/.test(message)) {
      const status = await c.env.DB.prepare(
        "SELECT status FROM sites WHERE workspace_id=? AND id=?",
      )
        .bind(key.workspace_id, key.site_id)
        .first<string>("status");
      if (!status || status === "deleting")
        return c.json({ error: "site_deleted" }, 410);
      c.header("Retry-After", "60");
      return c.json(
        {
          error:
            status === "paused" ? "site_paused" : "integration_unavailable",
        },
        503,
      );
    }
    if (
      /idempotency_conflict|invalid_refund|invalid_claim|webhook_id_conflict/.test(
        message,
      )
    )
      return c.json(
        {
          error: message.includes("invalid_refund")
            ? "invalid_refund"
            : message.includes("webhook_id_conflict")
              ? "webhook_id_conflict"
              : message.includes("invalid_claim")
                ? "invalid_claim"
                : "idempotency_conflict",
        },
        409,
      );
    throw error;
  }
});

revenueRoutes.get("/workspaces/:wid/sites/:sid/revenue", async (c) => {
  if (!(await site(c))) return c.json({ error: "site_not_found" }, 404);
  const from = Number(c.req.query("from")) || Date.now() - 30 * DAY,
    to = Number(c.req.query("to")) || Date.now();
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from >= to ||
    to - from > 396 * DAY
  )
    return c.json({ error: "invalid_range" }, 400);
  const args = [c.req.param("wid"), c.req.param("sid"), from, to];
  const refunds = `SELECT r.*,p.amount_minor original_amount,p.currency original_currency,p.source original_source,p.channel original_channel,p.matched_by original_matched_by,
    CASE WHEN p.external_id IS NULL THEN 'pending' WHEN p.currency!=r.currency OR
      (SELECT SUM(x.amount_minor) FROM money_records x WHERE x.workspace_id=r.workspace_id AND x.site_id=r.site_id AND x.namespace=r.namespace AND x.kind='refund' AND x.original_id=r.original_id)>p.amount_minor THEN 'quarantined' ELSE 'confirmed' END refund_status
    FROM money_records r LEFT JOIN money_records p ON p.workspace_id=r.workspace_id AND p.site_id=r.site_id AND p.namespace=r.namespace AND p.kind='payment' AND p.external_id=r.original_id WHERE r.kind='refund'`;
  const [totals, records, pending, providerPending] = await c.env.DB.batch([
    c.env.DB.prepare(
      `WITH valid_refunds AS (${refunds}) SELECT currency,SUM(gross) gross,SUM(refunded) refunded,SUM(gross)-SUM(refunded) net,SUM(payments) payments,SUM(unmatched) unmatched FROM (
      SELECT currency,SUM(amount_minor) gross,0 refunded,COUNT(*) payments,SUM(source IS NULL) unmatched FROM money_records WHERE workspace_id=? AND site_id=? AND occurred_at>=? AND occurred_at<? AND kind='payment' GROUP BY currency
      UNION ALL SELECT currency,0,SUM(amount_minor),0,0 FROM valid_refunds WHERE workspace_id=? AND site_id=? AND occurred_at>=? AND occurred_at<? AND refund_status='confirmed' GROUP BY currency) GROUP BY currency`,
    ).bind(...args, ...args),
    c.env.DB.prepare(
      `WITH refunds AS (${refunds}) SELECT m.external_id id,m.kind,m.amount_minor amountMinor,m.currency,m.occurred_at timestamp,CASE WHEN m.kind='refund' THEN (SELECT original_source FROM refunds r WHERE r.workspace_id=m.workspace_id AND r.site_id=m.site_id AND r.namespace=m.namespace AND r.external_id=m.external_id) ELSE m.source END source,CASE WHEN m.kind='refund' THEN (SELECT original_channel FROM refunds r WHERE r.workspace_id=m.workspace_id AND r.site_id=m.site_id AND r.namespace=m.namespace AND r.external_id=m.external_id) ELSE m.channel END channel,CASE WHEN m.kind='refund' THEN (SELECT original_matched_by FROM refunds r WHERE r.workspace_id=m.workspace_id AND r.site_id=m.site_id AND r.namespace=m.namespace AND r.external_id=m.external_id) ELSE m.matched_by END matchedBy,m.namespace,
      CASE WHEN m.kind='payment' THEN 'confirmed' ELSE (SELECT refund_status FROM refunds r WHERE r.workspace_id=m.workspace_id AND r.site_id=m.site_id AND r.namespace=m.namespace AND r.external_id=m.external_id) END status
      FROM money_records m WHERE workspace_id=? AND site_id=? AND occurred_at>=? AND occurred_at<? ORDER BY occurred_at DESC LIMIT 100`,
    ).bind(...args),
    c.env.DB.prepare(
      `WITH refunds AS (${refunds}) SELECT refund_status status,COUNT(*) count FROM refunds WHERE workspace_id=? AND site_id=? AND refund_status!='confirmed' GROUP BY refund_status`,
    ).bind(c.req.param("wid"), c.req.param("sid")),
    c.env.DB.prepare(
      "SELECT CASE WHEN status='needs_review' THEN 'needs review' ELSE 'awaiting provider details' END status,COUNT(*) count FROM pending_provider_refunds WHERE workspace_id=? AND site_id=? GROUP BY status",
    ).bind(c.req.param("wid"), c.req.param("sid")),
  ]);
  const providerRecords = await c.env.DB.prepare(
    "SELECT integration_id integrationId,event_id eventId,refund_id refundId,payment_id paymentId,namespace,amount_minor amountMinor,currency,status,reason FROM pending_provider_refunds WHERE workspace_id=? AND site_id=? ORDER BY received_at LIMIT 100",
  )
    .bind(c.req.param("wid"), c.req.param("sid"))
    .all();
  return c.json({
    totals: totals.results,
    records: records.results,
    pending: [...pending.results, ...providerPending.results],
    providerRefunds: providerRecords.results,
    range: { from, to },
    attribution:
      "Verified backend checkout correlation only. Unmatched payments remain in revenue.",
  });
});

export async function cleanupRevenue(env: Bindings, now = Date.now()) {
  const db = env.DB;
  const deleting = await pendingSiteDeletions(db);
  for (const entry of deleting) {
    await db.batch([
      db
        .prepare(
          "DELETE FROM payment_receipts WHERE rowid IN(SELECT r.rowid FROM payment_receipts r JOIN payment_integrations i ON i.id=r.integration_id WHERE i.workspace_id=? AND i.site_id=? LIMIT 250)",
        )
        .bind(entry.workspace_id, entry.id),
      ...[
        "pending_provider_refunds",
        "checkout_claims",
        "money_records",
        "site_api_keys",
      ].map((table) =>
        db
          .prepare(
            `DELETE FROM ${table} WHERE rowid IN(SELECT rowid FROM ${table} WHERE workspace_id=? AND site_id=? LIMIT 250)`,
          )
          .bind(entry.workspace_id, entry.id),
      ),
      db
        .prepare(
          "DELETE FROM payment_integrations WHERE workspace_id=? AND site_id=? AND NOT EXISTS(SELECT 1 FROM payment_receipts r WHERE r.integration_id=payment_integrations.id) AND NOT EXISTS(SELECT 1 FROM pending_provider_refunds p WHERE p.integration_id=payment_integrations.id)",
        )
        .bind(entry.workspace_id, entry.id),
    ]);
  }
  if (env.RESTORE_LOCK === "true") return;
  await retryProviderRefunds(env, recordMoney, now);
  await db.batch([
    db
      .prepare(
        "DELETE FROM checkout_claims WHERE rowid IN(SELECT rowid FROM checkout_claims WHERE (consumed_by IS NULL AND expires_at<?) OR expires_at<? LIMIT 250)",
      )
      .bind(now, now - 395 * DAY),
    db
      .prepare(
        "UPDATE checkout_claims SET visitor_id=NULL,session_id=NULL WHERE rowid IN(SELECT rowid FROM checkout_claims WHERE expires_at<? AND visitor_id IS NOT NULL LIMIT 250)",
      )
      .bind(now - 89 * DAY),
    db
      .prepare(
        `DELETE FROM money_records WHERE rowid IN(SELECT m.rowid FROM money_records m WHERE m.received_at<? AND NOT EXISTS(SELECT 1 FROM pending_provider_refunds p WHERE p.workspace_id=m.workspace_id AND p.site_id=m.site_id AND p.namespace=m.namespace AND p.payment_id=m.external_id AND m.kind='payment') AND (m.kind='refund' OR NOT EXISTS(SELECT 1 FROM money_records r WHERE r.workspace_id=m.workspace_id AND r.site_id=m.site_id AND r.namespace=m.namespace AND r.kind='refund' AND r.original_id=m.external_id AND r.received_at>=?)) LIMIT 250)`,
      )
      .bind(now - 396 * DAY, now - 396 * DAY),
    db
      .prepare(
        "DELETE FROM payment_receipts WHERE rowid IN(SELECT rowid FROM payment_receipts WHERE received_at<? AND NOT EXISTS(SELECT 1 FROM pending_provider_refunds p WHERE p.integration_id=payment_receipts.integration_id AND p.event_id=payment_receipts.event_id) LIMIT 250)",
      )
      .bind(now - 396 * DAY),
  ]);
}
