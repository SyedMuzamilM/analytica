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

Only an authenticated merchant backend can create a correlation. The browser's `window.analytica.attribution()` returns consent-enabled random visitor/session IDs, or null when attribution is unavailable. They are telemetry hints, not proof of identity. On the backend, send them together with a known checkout ID to POST `/v1/server/checkouts`, using a key in the same merchant namespace that will record the payment.

```json
{"checkout_id":"checkout_123","visitor_id":"CONSENT_ENABLED_VISITOR_ID","session_id":"CONSENT_ENABLED_SESSION_ID"}
```

The response returns a signed `claim_token`, bound to that checkout, site, merchant and expiry. The backend must keep the provider checkout-to-transaction mapping. Generic payment intake includes both `claim_token` and `checkout_id`. Dodo metadata uses `analytica_claim`; its webhook must contain the matching checkout ID in `checkout_session_id` or `checkout_id`. Actual provider sandbox checkout fields and metadata propagation remain to be verified; the app has signed-fixture tests, not a completed live Dodo checkout test. A missing or unverifiable correlation never establishes customer identity. Do not rely on a public return URL payment_id.

Attribution selects the visitor's most recent eligible non-direct session in the preceding 30 days, falling back to direct. The ledger stores a sanitized acquisition snapshot without email/name or a permanent visitor reference. The nonce consumes atomically with the new payment. Retries use stored economic identity even after the claim expires; a different claim cannot repoint an existing sale.

## Dodo webhooks

Connect an integration in Revenue and enter its signing secret privately. The dashboard returns a webhook URL. Subscribe to `payment.succeeded` and `refund.succeeded`. The Worker verifies raw-body Standard Webhooks signatures and a five-minute timestamp window, then admits the delivery receipt and economic record atomically. One delivery ID with a different signed body conflicts.

Integration secrets are AES-GCM encrypted with the installation APP_SECRET. Rotating APP_SECRET requires re-entering or deliberately re-encrypting existing integration secrets and renewing sessions/claims. Do not replace it casually during deployment. Runtime token/secret rotation is an operator procedure to test before customer launch.

Financial records retain 396 days of intake history. A minimal older payment can remain while a still-retained refund depends on it, preserving confirmation and attribution. Visitor/session links in checkout evidence expire separately. Individual erasure suppresses analytics identity and clears checkout links. Site deletion removes financial records too. This analytics ledger is not a tax/accounting system or a payment processor.
