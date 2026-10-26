-- Minimal signed refund evidence only. Raw webhook bodies and customer metadata
-- are deliberately excluded. Unresolved records require reconciliation rather
-- than being silently expired by analytics retention.
CREATE TABLE pending_provider_refunds (
  integration_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  amount_minor INTEGER CHECK(amount_minor IS NULL OR (amount_minor>=0 AND amount_minor<=100000000000)),
  currency TEXT,
  is_full INTEGER NOT NULL CHECK(is_full IN (0,1)),
  occurred_at INTEGER NOT NULL,
  timestamp_provided INTEGER NOT NULL CHECK(timestamp_provided IN (0,1)),
  digest TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','needs_review')),
  reason TEXT NOT NULL,
  PRIMARY KEY(integration_id,event_id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX pending_provider_refunds_retry ON pending_provider_refunds(last_attempt_at,received_at);
CREATE INDEX pending_provider_refunds_payment ON pending_provider_refunds(workspace_id,site_id,namespace,payment_id);

CREATE TRIGGER pending_provider_refund_admission BEFORE INSERT ON pending_provider_refunds BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sites s WHERE s.workspace_id=NEW.workspace_id AND s.id=NEW.site_id AND s.status='active') THEN RAISE(ABORT,'site_inactive') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM payment_integrations i WHERE i.id=NEW.integration_id AND i.workspace_id=NEW.workspace_id AND i.site_id=NEW.site_id AND 'dodo:'||i.merchant_id=NEW.namespace AND i.disabled_at IS NULL) THEN RAISE(ABORT,'key_revoked_or_site_inactive') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM pending_provider_refunds p WHERE p.integration_id=NEW.integration_id AND p.event_id=NEW.event_id AND p.digest!=NEW.digest) THEN RAISE(ABORT,'webhook_id_conflict') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pending_provider_refunds p WHERE p.integration_id=NEW.integration_id AND p.event_id=NEW.event_id) AND (SELECT COUNT(*) FROM pending_provider_refunds p WHERE p.workspace_id=NEW.workspace_id AND p.site_id=NEW.site_id)>=1000 THEN RAISE(ABORT,'provider_refund_limit') END;
END;
