CREATE TABLE site_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  namespace TEXT NOT NULL,
  integration_id TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX site_api_keys_site ON site_api_keys(workspace_id,site_id);
CREATE TABLE payment_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider='dodo'),
  merchant_id TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER,
  UNIQUE(workspace_id,site_id,provider,merchant_id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE TABLE payment_receipts (
  integration_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(integration_id,event_id)
);
CREATE TABLE money_records (
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),
  original_id TEXT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>=0 AND amount_minor<=100000000000),
  currency TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  digest TEXT NOT NULL,
  source TEXT,
  channel TEXT,
  campaign TEXT,
  matched_by TEXT,
  claim_id TEXT,
  PRIMARY KEY(workspace_id,site_id,namespace,kind,external_id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX money_records_time ON money_records(workspace_id,site_id,occurred_at);
CREATE TABLE checkout_claims (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  checkout_id TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  source TEXT NOT NULL,
  channel TEXT NOT NULL,
  campaign TEXT,
  expires_at INTEGER NOT NULL,
  consumed_by TEXT,
  UNIQUE(workspace_id,site_id,namespace,checkout_id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX checkout_claims_expiry ON checkout_claims(expires_at);
CREATE TRIGGER money_site_active BEFORE INSERT ON money_records BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sites WHERE workspace_id=NEW.workspace_id AND id=NEW.site_id AND status='active') THEN RAISE(ABORT,'site_inactive') END;
  SELECT CASE WHEN NEW.claim_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM checkout_claims c WHERE c.id=NEW.claim_id AND c.workspace_id=NEW.workspace_id AND c.site_id=NEW.site_id AND c.namespace=NEW.namespace AND c.expires_at>NEW.received_at AND (c.consumed_by IS NULL OR c.consumed_by=NEW.external_id)) THEN RAISE(ABORT,'invalid_claim') END;
  SELECT CASE WHEN NEW.kind='refund' AND EXISTS(
    SELECT 1 FROM money_records p WHERE p.workspace_id=NEW.workspace_id AND p.site_id=NEW.site_id AND p.namespace=NEW.namespace AND p.kind='payment' AND p.external_id=NEW.original_id AND (
      p.currency!=NEW.currency OR NEW.amount_minor + COALESCE((SELECT SUM(r.amount_minor) FROM money_records r WHERE r.workspace_id=NEW.workspace_id AND r.site_id=NEW.site_id AND r.namespace=NEW.namespace AND r.kind='refund' AND r.original_id=NEW.original_id AND r.external_id!=NEW.external_id),0)>p.amount_minor
    )
  ) THEN RAISE(ABORT,'invalid_refund') END;
END;

CREATE TRIGGER consume_money_claim AFTER INSERT ON money_records WHEN NEW.claim_id IS NOT NULL BEGIN
  UPDATE checkout_claims SET consumed_by=NEW.external_id WHERE id=NEW.claim_id;
END;

CREATE TRIGGER payment_receipt_conflict BEFORE INSERT ON payment_receipts BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM payment_receipts WHERE integration_id=NEW.integration_id AND event_id=NEW.event_id AND digest!=NEW.digest) THEN RAISE(ABORT,'webhook_id_conflict') END;
END;
