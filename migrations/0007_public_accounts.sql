CREATE TABLE auth_challenges_next (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('setup', 'signup', 'login', 'recovery', 'passkey', 'invite')),
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_token TEXT
);
INSERT INTO auth_challenges_next SELECT * FROM auth_challenges;
DROP TABLE auth_challenges;
ALTER TABLE auth_challenges_next RENAME TO auth_challenges;
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);

ALTER TABLE sites ADD COLUMN logo_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE setup_state_next (
  id INTEGER PRIMARY KEY CHECK (id=1),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at INTEGER NOT NULL
);
INSERT INTO setup_state_next SELECT * FROM setup_state;
DROP TABLE setup_state;
ALTER TABLE setup_state_next RENAME TO setup_state;

CREATE TABLE workspace_deletions (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_at INTEGER NOT NULL
);
CREATE TRIGGER workspace_deletion_no_new_sites BEFORE INSERT ON sites
WHEN EXISTS(SELECT 1 FROM workspace_deletions WHERE workspace_id=NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT,'workspace_deleted');
END;
