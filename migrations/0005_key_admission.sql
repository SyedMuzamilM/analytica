-- Enforce key admission in the same transaction as insertion, including races.
CREATE TRIGGER site_api_key_admission BEFORE INSERT ON site_api_keys
WHEN NEW.revoked_at IS NULL BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sites WHERE workspace_id=NEW.workspace_id AND id=NEW.site_id AND status!='deleting') THEN RAISE(ABORT,'site_inactive') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM site_api_keys WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND revoked_at IS NULL)>=10 THEN RAISE(ABORT,'key_limit') END;
  SELECT CASE WHEN NEW.integration_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_integrations WHERE id=NEW.integration_id AND workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND disabled_at IS NULL) THEN RAISE(ABORT,'integration_unavailable') END;
END;
