# Payment integration

All money uses integer minor units and an explicit ISO currency. USD 2900 is $29.00; JPY 2900 is ¥2900. No automatic FX conversion occurs. Totals remain separate by currency. The generic API accepts authenticated server keys generated in the site's Revenue view. Keys are displayed once and stored as hashes. Revocation is checked for subsequent requests.

```text
POST /v1/server/payments
Authorization: Bearer YOUR_SERVER_KEY
{"transaction_id":"sale_123","amount_minor":2900,"currency":"USD"}

POST /v1/server/refunds
Authorization: Bearer YOUR_SERVER_KEY
{"refund_id":"refund_1","transaction_id":"sale_123","amount_minor":500,"currency":"USD"}
```

A logical sale has one stable transaction ID inside the configured merchant/source namespace. Retrying the same economic content does not add revenue. Reusing an ID with changed amount, currency or checkout correlation conflicts. Omitted occurrence timestamps use first-received time; an explicit timestamp is part of the idempotent payload and must remain stable across retries. Use a distinct ID per partial refund. Refunds arriving before the sale are pending; invalid currency or excessive cumulative refunds are rejected/quarantined and excluded from confirmed net totals.

Do not send one sale independently through a generic namespace and a Dodo namespace. If a server key is explicitly bound to a Dodo integration, it shares that integration's canonical `dodo:MERCHANT` namespace and disabled-state checks. The underlying provider transaction ID must match across both paths. Generic-only sources use `api:YOUR_NAMESPACE`. The Revenue view supports choosing the checkout integration when creating a key.

## Trusted checkout correlation

Only an authenticated merchant backend can create a correlation. The browser's `window.analytica.attribution()` returns consent-enabled random visitor/session IDs, or null when attribution is unavailable. They are telemetry hints, not proof of identity. On the backend, send them together with a merchant-generated order ID to POST `/v1/server/checkouts`, using a key in the same merchant namespace that will record the payment.

```json
{"checkout_id":"order_123","visitor_id":"CONSENT_ENABLED_VISITOR_ID","session_id":"CONSENT_ENABLED_SESSION_ID"}
```

The response returns a signed `claim_token`, bound to that order, site, merchant and expiry. The same unconsumed, unexpired association returns the same token on retry, without extending expiry. A changed visitor/session conflicts. Revoked keys, disabled integrations and inactive sites cannot receive a token after a competing state change.

For Dodo, create the claim **before** creating its checkout. Send both values as create-time metadata:

```json
{"metadata":{"analytica_claim":"SIGNED_CLAIM_TOKEN","analytica_checkout":"order_123"}}
```

The webhook uses this merchant order ID for correlation. Dodo's generated `checkout_session_id` can differ and is a fallback only when the merchant metadata field is absent. Never copy browser-supplied metadata without issuing a claim from your trusted backend. Generic payment intake includes both `claim_token` and the same `checkout_id`. A missing or unverifiable correlation never establishes customer identity. A supplied invalid correlation rejects the payment rather than silently attributing it elsewhere. Do not rely on a public return URL payment_id. Signed fixtures cover this sequence; live provider propagation remains a sandbox release gate.

Attribution selects the visitor's most recent eligible non-direct session in the preceding 30 days, falling back to direct. The ledger stores a sanitized acquisition snapshot without email/name or a permanent visitor reference. The nonce consumes atomically with the new payment. Retries use stored economic identity even after the claim expires; a different claim cannot repoint an existing sale.

## Dodo webhooks

Connect an integration in Revenue and enter its signing secret privately. The dashboard returns a webhook URL. Subscribe to `payment.succeeded` and `refund.succeeded`. The Worker verifies raw-body Standard Webhooks signatures and a five-minute timestamp window, then admits the delivery receipt and economic record atomically. One delivery ID with a different signed body conflicts.

Integration secrets are AES-GCM encrypted with the installation APP_SECRET. Rotating APP_SECRET requires re-entering or deliberately re-encrypting existing integration secrets and renewing sessions/claims. Do not replace it casually during deployment. Runtime token/secret rotation is an operator procedure to test before customer launch.

Financial records retain 396 days of intake history. A minimal older payment can remain while a still-retained refund depends on it, preserving confirmation and attribution. Visitor/session links in checkout evidence expire separately. Individual erasure suppresses analytics identity and clears checkout links. Site deletion removes financial records too. This analytics ledger is not a tax/accounting system or a payment processor.

Pausing a site stops financial intake as well as browser collection. A verified webhook for a paused site returns `503 site_paused` with Retry-After; deleting sites return `410 site_deleted`, while unknown/disabled integrations return404. Transitions between lookup and insertion are classified too. Retry-After is a hint, not a guarantee about Dodo's delivery window. A pause longer than that window can lose deliveries; reconcile with provider records after resuming. Site deletion intentionally prevents recording future financial events.

## Refunds with incomplete provider fields

Dodo's [official SDK refund contract](https://github.com/dodopayments/dodopayments-node/blob/main/src/resources/refunds.ts) permits omitted/null `amount` and `currency`. The webhook derives omitted currency from the original payment in the same workspace, site and merchant namespace. It derives omitted amount only when `is_partial` is explicitly `false`, using that payment's full amount. Missing partial-refund amounts are never guessed or treated as zero.

If required information is unavailable, the signed delivery is acknowledged with HTTP 202 and minimal evidence is saved in `pending_provider_refunds`, atomically with its delivery receipt. No raw body, customer details or checkout claim is retained. The revenue response exposes counts and the oldest 100 unresolved records; the dashboard shows refund/payment IDs and the next step. These records are excluded from net revenue until resolved.

Scheduled maintenance retries at most 20 pending deliveries per invocation in attempt order. An original payment arriving later can resolve an incomplete full refund. For an unknown partial amount, verify it with Dodo and send the actual amount/currency through `/v1/server/refunds` with a key bound to the original integration and the same refund/payment IDs. Maintenance clears the saved delivery only after verifying the scoped economic record. Conflicting or excessive refunds remain visible for review. Keep the integration enabled during reconciliation.

Unresolved evidence and its receipt do not silently expire; it preserves a referenced original payment across financial retention. Site deletion purges it. A per-site admission cap of 1,000 unresolved deliveries returns retryable 503 when full. Resolve this backlog before provider retries end. This is a bounded recovery mechanism, not an unlimited webhook archive.
