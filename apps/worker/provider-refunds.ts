import type { Bindings } from "./env";

const DAY = 86_400_000;
const identifier = /^[a-zA-Z0-9_.:-]{1,128}$/;
interface ProviderKey {
  id: string;
  workspace_id: string;
  site_id: string;
  namespace: string;
  privacy_mode: string;
  integrationId?: string;
}
interface Receipt {
  integrationId: string;
  eventId: string;
  digest: string;
}
interface RefundInput {
  kind: "refund";
  transactionId: string;
  originalId: string;
  amount: number;
  currency: string;
  occurredAt: number;
  timestampProvided: boolean;
}
type RecordRefund = (
  env: Bindings,
  key: ProviderKey,
  input: RefundInput,
  receipt: Receipt,
) => Promise<{ ok: boolean; attributed: boolean; duplicate?: boolean }>;
interface PendingRefund {
  integration_id: string;
  event_id: string;
  workspace_id: string;
  site_id: string;
  namespace: string;
  refund_id: string;
  payment_id: string;
  amount_minor: number | null;
  currency: string | null;
  is_full: number;
  occurred_at: number;
  timestamp_provided: number;
  digest: string;
  received_at: number;
  last_attempt_at: number;
  status: "pending" | "needs_review";
  reason: string;
}
function isoCurrency(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string")
    throw new Error("invalid_provider_money_record");
  const normalized = value.toUpperCase();
  if (!Intl.supportedValuesOf("currency").includes(normalized))
    throw new Error("invalid_provider_money_record");
  return normalized;
}
async function resolve(
  db: D1Database,
  row: PendingRefund,
): Promise<RefundInput | null> {
  const original = await db
    .prepare(
      "SELECT amount_minor,currency FROM money_records WHERE workspace_id=? AND site_id=? AND namespace=? AND external_id=? AND kind='payment'",
    )
    .bind(row.workspace_id, row.site_id, row.namespace, row.payment_id)
    .first<{ amount_minor: number; currency: string }>();
  const amount =
    row.amount_minor ?? (row.is_full === 1 ? original?.amount_minor : null);
  const currency = row.currency ?? original?.currency;
  if (amount == null || !currency) return null;
  return {
    kind: "refund",
    transactionId: row.refund_id,
    originalId: row.payment_id,
    amount,
    currency,
    occurredAt: row.occurred_at,
    timestampProvided: row.timestamp_provided === 1,
  };
}
function reason(row: PendingRefund) {
  return row.amount_minor === null && row.is_full !== 1
    ? "refund_amount_required"
    : "original_payment_required";
}
async function remove(db: D1Database, row: PendingRefund) {
  await db
    .prepare(
      "DELETE FROM pending_provider_refunds WHERE integration_id=? AND event_id=?",
    )
    .bind(row.integration_id, row.event_id)
    .run();
}
async function reconciled(
  db: D1Database,
  row: PendingRefund,
  input: RefundInput | null,
) {
  const recorded = await db
    .prepare(
      "SELECT original_id,amount_minor,currency FROM money_records WHERE workspace_id=? AND site_id=? AND namespace=? AND kind='refund' AND external_id=?",
    )
    .bind(row.workspace_id, row.site_id, row.namespace, row.refund_id)
    .first<{ original_id: string; amount_minor: number; currency: string }>();
  return (
    !!recorded &&
    recorded.original_id === row.payment_id &&
    ((input?.amount ?? row.amount_minor) === null ||
      recorded.amount_minor === (input?.amount ?? row.amount_minor)) &&
    ((input?.currency ?? row.currency) === null ||
      recorded.currency === (input?.currency ?? row.currency))
  );
}

/** Called only after verifying the original raw-body provider signature. */
export async function recordProviderRefund(
  env: Bindings,
  key: ProviderKey,
  data: Record<string, unknown>,
  timestamp: unknown,
  receipt: Receipt,
  record: RecordRefund,
): Promise<{
  ok: boolean;
  pending?: boolean;
  attributed?: boolean;
  duplicate?: boolean;
}> {
  if (
    typeof data.refund_id !== "string" ||
    !identifier.test(data.refund_id) ||
    typeof data.payment_id !== "string" ||
    !identifier.test(data.payment_id) ||
    (data.amount != null &&
      (!Number.isSafeInteger(data.amount) ||
        Number(data.amount) < 0 ||
        Number(data.amount) > 100000000000))
  )
    throw new Error("invalid_provider_money_record");
  const now = Date.now();
  const occurredAt =
    timestamp === undefined
      ? now
      : typeof timestamp === "string"
        ? Date.parse(timestamp)
        : Number(timestamp);
  if (
    !Number.isFinite(occurredAt) ||
    occurredAt > now + 300000 ||
    occurredAt < now - 395 * DAY
  )
    throw new Error("invalid_provider_money_record");
  const existing = await env.DB.prepare(
    "SELECT * FROM pending_provider_refunds WHERE integration_id=? AND event_id=?",
  )
    .bind(receipt.integrationId, receipt.eventId)
    .first<PendingRefund>();
  if (existing && existing.digest !== receipt.digest)
    throw new Error("webhook_id_conflict");
  const row: PendingRefund = existing ?? {
    integration_id: receipt.integrationId,
    event_id: receipt.eventId,
    workspace_id: key.workspace_id,
    site_id: key.site_id,
    namespace: key.namespace,
    refund_id: data.refund_id,
    payment_id: data.payment_id,
    amount_minor: data.amount == null ? null : Number(data.amount),
    currency: isoCurrency(data.currency),
    is_full: data.is_partial === false ? 1 : 0,
    occurred_at: occurredAt,
    timestamp_provided: timestamp === undefined ? 0 : 1,
    digest: receipt.digest,
    received_at: now,
    last_attempt_at: now,
    status: "pending",
    reason: "original_payment_required",
  };
  const input = await resolve(env.DB, row);
  // A trusted merchant may reconcile incomplete provider evidence using the
  // integration-bound server API. Its explicit timestamp can differ from the
  // webhook; economic fields must still agree before removing the pending item.
  const acknowledged =
    existing ||
    (await env.DB.prepare(
      "SELECT 1 FROM payment_receipts WHERE integration_id=? AND event_id=? AND digest=?",
    )
      .bind(receipt.integrationId, receipt.eventId, receipt.digest)
      .first());
  if (acknowledged && (await reconciled(env.DB, row, input))) {
    if (existing) await remove(env.DB, row);
    return { ok: true, attributed: false, duplicate: true };
  }
  if (input) {
    const result = await record(env, key, input, receipt);
    if (existing) await remove(env.DB, row);
    return result;
  }
  row.reason = reason(row);
  row.status =
    row.reason === "refund_amount_required" ? "needs_review" : "pending";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO payment_receipts(integration_id,event_id,digest,received_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
    ).bind(receipt.integrationId, receipt.eventId, receipt.digest, now),
    env.DB.prepare(
      `INSERT INTO pending_provider_refunds(integration_id,event_id,workspace_id,site_id,namespace,refund_id,payment_id,amount_minor,currency,is_full,occurred_at,timestamp_provided,digest,received_at,last_attempt_at,status,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(integration_id,event_id) DO NOTHING`,
    ).bind(
      row.integration_id,
      row.event_id,
      row.workspace_id,
      row.site_id,
      row.namespace,
      row.refund_id,
      row.payment_id,
      row.amount_minor,
      row.currency,
      row.is_full,
      row.occurred_at,
      row.timestamp_provided,
      row.digest,
      row.received_at,
      row.last_attempt_at,
      row.status,
      row.reason,
    ),
  ]);
  return { ok: true, pending: true, duplicate: !!existing };
}

/** Fair, bounded retries. Unknown partial amounts remain visible for reconciliation. */
export async function retryProviderRefunds(
  env: Bindings,
  record: RecordRefund,
  now = Date.now(),
) {
  const { results } = await env.DB.prepare(
    `SELECT p.*,s.privacy_mode FROM pending_provider_refunds p
     JOIN sites s ON s.workspace_id=p.workspace_id AND s.id=p.site_id
     JOIN payment_integrations i ON i.id=p.integration_id
     WHERE s.status='active' AND i.disabled_at IS NULL
     ORDER BY p.last_attempt_at,p.received_at,p.integration_id,p.event_id LIMIT 20`,
  ).all<PendingRefund & { privacy_mode: string }>();
  for (const row of results) {
    await env.DB.prepare(
      "UPDATE pending_provider_refunds SET last_attempt_at=? WHERE integration_id=? AND event_id=?",
    )
      .bind(now, row.integration_id, row.event_id)
      .run();
    const input = await resolve(env.DB, row);
    if (await reconciled(env.DB, row, input)) {
      await remove(env.DB, row);
      continue;
    }
    if (!input) {
      continue;
    }
    try {
      await record(
        env,
        {
          id: "",
          workspace_id: row.workspace_id,
          site_id: row.site_id,
          namespace: row.namespace,
          privacy_mode: row.privacy_mode,
          integrationId: row.integration_id,
        },
        input,
        {
          integrationId: row.integration_id,
          eventId: row.event_id,
          digest: row.digest,
        },
      );
      await remove(env.DB, row);
    } catch (error) {
      const message = String(error);
      if (/invalid_refund|idempotency_conflict/.test(message)) {
        await env.DB.prepare(
          "UPDATE pending_provider_refunds SET status='needs_review',reason=? WHERE integration_id=? AND event_id=?",
        )
          .bind(
            message.includes("invalid_refund")
              ? "invalid_refund"
              : "idempotency_conflict",
            row.integration_id,
            row.event_id,
          )
          .run();
      } else if (!/site_inactive|key_revoked_or_site_inactive/.test(message))
        throw error;
    }
  }
}
