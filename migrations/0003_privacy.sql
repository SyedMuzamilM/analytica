ALTER TABLE sites ADD COLUMN deletion_completed_at INTEGER;

-- These records deliberately have no foreign key to sites: recovery must retain
-- suppression evidence even when an operator removes an old site tombstone.
CREATE TABLE visitor_suppressions (
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,site_id,visitor_id)
);
CREATE TABLE privacy_journal (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('site','visitor')),
  subject_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(workspace_id,site_id,kind,subject_id)
);
CREATE INDEX privacy_journal_workspace ON privacy_journal(workspace_id,created_at);
CREATE TABLE privacy_jobs (
  id TEXT PRIMARY KEY NOT NULL REFERENCES privacy_journal(id),
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('site','visitor')),
  subject_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX privacy_jobs_pending ON privacy_jobs(completed_at,created_at);
CREATE INDEX analytics_events_visitor ON analytics_events(workspace_id,site_id,visitor_id);
CREATE INDEX analytics_sessions_visitor ON analytics_sessions(workspace_id,site_id,visitor_id);

CREATE TRIGGER privacy_journal_identity BEFORE INSERT ON privacy_journal BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM privacy_journal j WHERE j.id=NEW.id AND
    (j.workspace_id!=NEW.workspace_id OR j.site_id!=NEW.site_id OR j.kind!=NEW.kind OR j.subject_id!=NEW.subject_id))
    THEN RAISE(ABORT,'journal_id_conflict') END;
END;

CREATE TRIGGER analytics_visitor_suppressed BEFORE INSERT ON analytics_events BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM visitor_suppressions
    WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND visitor_id=NEW.visitor_id)
    THEN RAISE(ABORT,'visitor_suppressed') END;
END;
CREATE TRIGGER checkout_visitor_suppressed BEFORE INSERT ON checkout_claims WHEN NEW.visitor_id IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM visitor_suppressions
    WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND visitor_id=NEW.visitor_id)
    THEN RAISE(ABORT,'visitor_suppressed') END;
END;
CREATE TRIGGER checkout_visitor_suppressed_update BEFORE UPDATE OF visitor_id ON checkout_claims WHEN NEW.visitor_id IS NOT NULL BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM visitor_suppressions
    WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND visitor_id=NEW.visitor_id)
    THEN RAISE(ABORT,'visitor_suppressed') END;
END;

-- Ordinary retention must preserve closed summaries. Only a subject erasure
-- dirties a bucket as raw records disappear.
CREATE TRIGGER privacy_erased_event AFTER DELETE ON analytics_events
WHEN EXISTS(SELECT 1 FROM visitor_suppressions s WHERE s.workspace_id=OLD.workspace_id AND s.site_id=OLD.site_id AND s.visitor_id=OLD.visitor_id)
  AND EXISTS(SELECT 1 FROM sites s WHERE s.workspace_id=OLD.workspace_id AND s.id=OLD.site_id AND s.status!='deleting') BEGIN
  INSERT OR IGNORE INTO dirty_buckets(workspace_id,site_id,day,timezone)
    VALUES(OLD.workspace_id,OLD.site_id,OLD.local_day,OLD.timezone);
END;

CREATE TRIGGER privacy_site_deleted AFTER UPDATE OF status ON sites
WHEN NEW.status='deleting' AND OLD.status!='deleting' BEGIN
  UPDATE sites SET deletion_completed_at=NULL WHERE id=NEW.id AND workspace_id=NEW.workspace_id;
  INSERT OR IGNORE INTO privacy_journal(id,workspace_id,site_id,kind,subject_id,created_at)
    VALUES(lower(hex(randomblob(16))),NEW.workspace_id,NEW.id,'site','',CAST(strftime('%s','now') AS INTEGER)*1000);
  INSERT OR IGNORE INTO privacy_jobs(id,workspace_id,site_id,kind,subject_id,created_at)
    SELECT id,workspace_id,site_id,kind,subject_id,created_at FROM privacy_journal
    WHERE workspace_id=NEW.workspace_id AND site_id=NEW.id AND kind='site';
END;
CREATE TRIGGER privacy_prevent_site_recreation BEFORE INSERT ON sites BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM privacy_journal j WHERE j.workspace_id=NEW.workspace_id AND j.site_id=NEW.id AND j.kind='site')
    THEN RAISE(ABORT,'site_previously_deleted') END;
END;
CREATE TRIGGER privacy_prevent_site_reactivation BEFORE UPDATE OF status ON sites
WHEN NEW.status!='deleting' AND EXISTS(SELECT 1 FROM privacy_journal j WHERE j.workspace_id=NEW.workspace_id AND j.site_id=NEW.id AND j.kind='site') BEGIN
  SELECT RAISE(ABORT,'site_previously_deleted');
END;

-- Installations upgrading with deletion already pending need the same journal.
INSERT OR IGNORE INTO privacy_journal(id,workspace_id,site_id,kind,subject_id,created_at)
  SELECT lower(hex(randomblob(16))),workspace_id,id,'site','',CAST(strftime('%s','now') AS INTEGER)*1000 FROM sites WHERE status='deleting';
INSERT OR IGNORE INTO privacy_jobs(id,workspace_id,site_id,kind,subject_id,created_at)
  SELECT id,workspace_id,site_id,kind,subject_id,created_at FROM privacy_journal WHERE kind='site';
