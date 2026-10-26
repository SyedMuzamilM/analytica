CREATE TABLE funnels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX funnels_site ON funnels(workspace_id,site_id,created_at);
CREATE TRIGGER funnel_admission BEFORE INSERT ON funnels BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM sites WHERE workspace_id=NEW.workspace_id AND id=NEW.site_id AND status!='deleting' AND privacy_mode='attribution'
  ) THEN RAISE(ABORT,'funnel_site_unavailable') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM funnels WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id)>=20
    THEN RAISE(ABORT,'funnel_limit_reached') END;
END;
