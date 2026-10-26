import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  Copy as CopyIcon,
  KeyRound,
  Plus,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import type { Site, Workspace } from "../../packages/contracts";
import { api, formatNumber, friendlyError, post } from "./api";

interface MoneyReport {
  totals: {
    currency: string;
    gross: number;
    refunded: number;
    net: number;
    payments: number;
    unmatched: number;
  }[];
  records: {
    id: string;
    kind: string;
    amountMinor: number;
    currency: string;
    timestamp: number;
    source: string | null;
    channel: string | null;
    matchedBy: string | null;
    namespace: string;
    status: string;
  }[];
  pending: { status: string; count: number }[];
  attribution: string;
}
interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  namespace: string;
  created_at: number;
  revoked_at: number | null;
}
interface Integration {
  id: string;
  provider: string;
  merchant_id: string;
  created_at: number;
  disabled_at: number | null;
}
function money(value: number, currency: string) {
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    value / 10 ** digits,
  );
}
function Copy({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      className="button secondary small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setFailed(true);
        }
      }}
    >
      {copied ? <Check size={13} /> : <CopyIcon size={13} />}
      {failed ? "Select and copy manually" : copied ? "Copied" : "Copy"}
    </button>
  );
}

export function RevenueView({
  site,
  workspace,
  demo,
  from,
  to,
  notify,
}: {
  site: Site;
  workspace: Workspace;
  demo: boolean;
  from: number;
  to: number;
  notify: (message: string) => void;
}) {
  const [data, setData] = useState<MoneyReport | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [showKey, setShowKey] = useState(false);
  const [showDodo, setShowDodo] = useState(false);
  const [credential, setCredential] = useState("");
  const [webhook, setWebhook] = useState("");
  const [currency, setCurrency] = useState("");
  const base = `/api/workspaces/${workspace.id}/sites/${site.id}`;
  const canEdit = workspace.role !== "viewer";
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setError("");
    setBusy(true);
    const requests: Promise<unknown>[] = [
      api<MoneyReport>(`${base}/revenue?from=${from}&to=${to}`, {
        signal: controller.signal,
      }).then(setData),
    ];
    if (canEdit)
      requests.push(
        api<ApiKey[]>(`${base}/keys`, { signal: controller.signal }).then(
          setKeys,
        ),
        api<Integration[]>(`${base}/integrations`, {
          signal: controller.signal,
        }).then(setIntegrations),
      );
    Promise.all(requests)
      .catch((err) => {
        if (!controller.signal.aborted) setError(friendlyError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [base, from, to, demo, version, canEdit]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      const result = await post<{ token: string }>(`${base}/keys`, {
        name: form.get("name"),
        namespace: form.get("namespace"),
        integrationId: form.get("integrationId") || undefined,
      });
      setCredential(result.token);
      setShowKey(false);
      setVersion((value) => value + 1);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  async function createDodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      const result = await post<{ webhookUrl: string }>(
        `${base}/integrations`,
        {
          provider: "dodo",
          merchantId: form.get("merchantId"),
          webhookSecret: form.get("webhookSecret"),
        },
      );
      setWebhook(result.webhookUrl);
      setShowDodo(false);
      setVersion((value) => value + 1);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove(path: string, description: string) {
    if (!window.confirm(description)) return;
    try {
      await api(path, { method: "DELETE" });
      setVersion((value) => value + 1);
      notify("Access revoked.");
    } catch (err) {
      notify(friendlyError(err));
    }
  }
  if (demo)
    return (
      <section className="panel revenue-empty">
        <div className="revenue-illustration">
          <Wallet size={31} />
        </div>
        <span className="small-pill">No sample financial records</span>
        <h2>Every sale should have a clear explanation.</h2>
        <p>
          Your workspace can accept server-side payments and refunds, or
          verified Dodo webhooks. Financial totals stay separate by currency,
          and unverified visits remain unmatched.
        </p>
        <div className="revenue-promises">
          <span>
            <ShieldCheck size={16} />
            Verified payment intake
          </span>
          <span>
            <Wallet size={16} />
            Separate totals by currency
          </span>
        </div>
        <a href="/" className="button secondary">
          Set up your workspace
        </a>
      </section>
    );
  const selected =
    data?.totals.find((total) => total.currency === currency) ??
    data?.totals[0];
  const records =
    data?.records.filter(
      (record) => !selected || record.currency === selected.currency,
    ) ?? [];
  return (
    <div className="revenue-view">
      {error && (
        <div className="error-panel" role="alert">
          <strong>We couldn't complete this revenue request.</strong>
          <p>{error}</p>
          <button
            className="button secondary small"
            onClick={() => setVersion((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {busy && !data && (
        <div className="notice-panel" role="status">
          Loading revenue records…
        </div>
      )}
      {selected && (
        <>
          <div className="revenue-heading">
            <span>Money by transaction date</span>
            <select
              aria-label="Revenue currency"
              value={selected.currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {data!.totals.map((total) => (
                <option key={total.currency}>{total.currency}</option>
              ))}
            </select>
          </div>
          <div className="stats-strip">
            <div className="stat">
              <span className="stat-label">Gross revenue</span>
              <div className="stat-value money-value">
                {money(selected.gross, selected.currency)}
              </div>
              <span className="stat-comparison">
                {formatNumber(selected.payments)} payments
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Refunded</span>
              <div className="stat-value money-value">
                {money(selected.refunded, selected.currency)}
              </div>
              <span className="stat-comparison">
                Confirmed refunds in this period
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Net revenue</span>
              <div className="stat-value money-value">
                {money(selected.net, selected.currency)}
              </div>
              <span className="stat-comparison">
                Gross less confirmed refunds
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Unmatched payments</span>
              <div className="stat-value">
                {formatNumber(selected.unmatched)}
              </div>
              <span className="stat-comparison">Included in gross revenue</span>
            </div>
          </div>
        </>
      )}
      {data && !data.totals.length && (
        <section className="panel revenue-empty compact-empty">
          <div className="revenue-illustration">
            <Wallet size={28} />
          </div>
          <h2>No payments in this period.</h2>
          <p>
            {canEdit
              ? "Connect a payment source below to start recording verified payments and refunds."
              : "Payments will appear when your workspace connects a payment source."}
          </p>
        </section>
      )}
      {!!data?.pending.length && (
        <div className="notice-panel">
          {data.pending
            .map(
              (item) =>
                `${formatNumber(item.count)} ${item.status} refund${item.count === 1 ? "" : "s"}`,
            )
            .join(", ")}
          . These amounts are excluded from confirmed net revenue until
          reconciled.
        </div>
      )}
      {!!records.length && (
        <section className="panel money-table">
          <div className="panel-heading">
            <h2>Payment activity</h2>
            <span className="column-label">
              Latest 100 records in this period
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Amount</th>
                  <th>Attribution</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={`${record.namespace}:${record.kind}:${record.id}`}>
                    <td>
                      <strong>{record.id}</strong>
                      <small>
                        {record.kind} · {record.namespace}
                      </small>
                    </td>
                    <td
                      className={
                        record.kind === "refund" ? "refund-amount" : ""
                      }
                    >
                      {record.kind === "refund" ? "−" : ""}
                      {money(record.amountMinor, record.currency)}
                    </td>
                    <td>
                      {record.source ?? "Unmatched"}
                      <small>
                        {record.matchedBy === "verified_checkout"
                          ? "Verified checkout correlation"
                          : "No verified visit match"}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`status-tag ${record.status === "confirmed" ? "active" : "paused"}`}
                      >
                        {record.status}
                      </span>
                    </td>
                    <td>
                      {new Date(record.timestamp).toLocaleDateString("en", {
                        month: "short",
                        day: "numeric",
                        timeZone: site.timezone,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-footer">
            Financial totals are not visitor-cohort conversion rates.
          </div>
        </section>
      )}
      {canEdit && (
        <>
          <div className="section-context">
            <div>
              <h2>Connect your payments</h2>
              <p>
                Use one intake path for each sale. Repeated transaction IDs do
                not create extra revenue.
              </p>
            </div>
          </div>
          {credential && (
            <div className="secret-once" role="status">
              <div>
                <KeyRound size={18} />
                <strong>
                  Save this server key now. It will not be shown again.
                </strong>
                <button
                  className="icon-button"
                  aria-label="Hide server key"
                  onClick={() => setCredential("")}
                >
                  <X size={15} />
                </button>
              </div>
              <code>{credential}</code>
              <Copy value={credential} />
              <p>
                Keep this on your backend. Never put it in the tracker, browser
                code, or assistant prompts.
              </p>
            </div>
          )}
          {webhook && (
            <div className="secret-once">
              <strong>Your Dodo webhook URL</strong>
              <code>{webhook}</code>
              <Copy value={webhook} />
              <p>
                Subscribe to payment.succeeded and refund.succeeded in your Dodo
                dashboard.
              </p>
            </div>
          )}
          <div className="report-grid">
            <section className="panel settings-panel">
              <div className="panel-heading">
                <h2>Server API</h2>
                <KeyRound size={16} color="#8a9bb7" />
              </div>
              <p>
                Send payments and distinct partial refunds from your backend
                using integer minor units.
              </p>
              {keys
                .filter((key) => !key.revoked_at)
                .map((key) => (
                  <div className="credential-row" key={key.id}>
                    <div>
                      <strong>{key.name}</strong>
                      <code>{key.prefix}…</code>
                      <small>{key.namespace}</small>
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        void remove(
                          `${base}/keys/${key.id}`,
                          `Revoke ${key.name}? Requests using this key will stop working.`,
                        )
                      }
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              {showKey ? (
                <form className="connection-form" onSubmit={createKey}>
                  <label>
                    Key name
                    <input
                      name="name"
                      required
                      maxLength={80}
                      placeholder="Production backend"
                    />
                  </label>
                  <label>
                    Transaction namespace
                    <input
                      name="namespace"
                      required
                      maxLength={128}
                      pattern="[a-zA-Z0-9_.:\-]+"
                      placeholder="my-store"
                    />
                    <small>A stable name for this source of sales.</small>
                  </label>
                  <label>
                    Checkout integration
                    <select name="integrationId" defaultValue="">
                      <option value="">Generic API only</option>
                      {integrations
                        .filter((i) => !i.disabled_at)
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            Dodo: {i.merchant_id}
                          </option>
                        ))}
                    </select>
                    <small>
                      Choose Dodo to correlate backend-created checkouts with
                      its signed webhooks.
                    </small>
                  </label>
                  <div className="inline-actions">
                    <button className="button primary small" disabled={busy}>
                      Create server key
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setShowKey(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  className="button secondary small connect-button"
                  onClick={() => setShowKey(true)}
                >
                  <Plus size={14} />
                  Create server key
                </button>
              )}
              <div className="code-example revenue-code">
                <span>POST /v1/server/payments</span>
                <code>
                  {
                    '{ "transaction_id": "sale_123", "amount_minor": 2900, "currency": "USD" }'
                  }
                </code>
                <span>Authorization: Bearer YOUR_SERVER_KEY</span>
              </div>
            </section>
            <section className="panel settings-panel">
              <div className="panel-heading">
                <h2>Dodo Payments</h2>
                <span className="small-pill">Signed webhooks</span>
              </div>
              <p>
                Record successful payments and refunds after verifying their
                webhook signature.
              </p>
              {integrations
                .filter((item) => !item.disabled_at)
                .map((item) => (
                  <div className="credential-row" key={item.id}>
                    <div>
                      <strong>{item.merchant_id}</strong>
                      <small>Dodo Payments</small>
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        void remove(
                          `${base}/integrations/${item.id}`,
                          "Disable this integration? New webhooks will no longer be recorded.",
                        )
                      }
                    >
                      Disable
                    </button>
                  </div>
                ))}
              {showDodo ? (
                <form className="connection-form" onSubmit={createDodo}>
                  <label>
                    Merchant account identifier
                    <input
                      name="merchantId"
                      required
                      maxLength={128}
                      placeholder="your-merchant-id"
                    />
                    <small>
                      Use a stable identifier for this Dodo account.
                    </small>
                  </label>
                  <label>
                    Webhook signing secret
                    <input
                      name="webhookSecret"
                      type="password"
                      required
                      autoComplete="off"
                      placeholder="whsec_…"
                    />
                  </label>
                  <div className="inline-actions">
                    <button className="button primary small" disabled={busy}>
                      Connect Dodo
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setShowDodo(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  className="button secondary small connect-button"
                  onClick={() => setShowDodo(true)}
                >
                  <Plus size={14} />
                  Connect Dodo
                </button>
              )}
              <div className="installation-note">
                <ShieldCheck size={17} />
                <p>
                  The signing secret is encrypted by your installation. Checkout
                  metadata alone never proves a visit match.
                </p>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
