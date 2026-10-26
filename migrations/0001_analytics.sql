CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  privacy_mode TEXT NOT NULL DEFAULT 'aggregate' CHECK (privacy_mode IN ('aggregate','attribution')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','deleting')),
  created_at INTEGER NOT NULL,
  daily_limit INTEGER NOT NULL DEFAULT 1000 CHECK (daily_limit BETWEEN 1 AND 1000000),
  UNIQUE (workspace_id,id)
);
CREATE INDEX sites_workspace ON sites(workspace_id,created_at);

CREATE TABLE analytics_sessions (
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  privacy_mode TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  started_day TEXT NOT NULL,
  exit_ts INTEGER NOT NULL,
  exit_sequence INTEGER NOT NULL,
  last_interaction_at INTEGER NOT NULL,
  last_received_at INTEGER NOT NULL,
  last_event_at INTEGER NOT NULL,
  pageviews INTEGER NOT NULL DEFAULT 0,
  goals INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  entry_page TEXT NOT NULL,
  exit_page TEXT NOT NULL,
  source TEXT NOT NULL,
  channel TEXT NOT NULL,
  campaign TEXT,
  PRIMARY KEY (workspace_id,site_id,id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX analytics_sessions_time ON analytics_sessions(workspace_id,site_id,started_at);

CREATE TABLE analytics_events (
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  digest TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  privacy_mode TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('pageview','goal','outbound','engagement')),
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  hostname TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT,
  duration INTEGER NOT NULL DEFAULT 0 CHECK(duration BETWEEN 0 AND 60000),
  source TEXT NOT NULL,
  channel TEXT NOT NULL,
  campaign TEXT,
  country TEXT NOT NULL,
  device TEXT NOT NULL,
  local_day TEXT NOT NULL,
  timezone TEXT NOT NULL,
  PRIMARY KEY(workspace_id,site_id,id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX analytics_events_time ON analytics_events(workspace_id,site_id,ts);
CREATE INDEX analytics_events_session ON analytics_events(workspace_id,site_id,session_id,ts);
CREATE INDEX analytics_events_bucket ON analytics_events(workspace_id,site_id,local_day,timezone);
CREATE INDEX analytics_events_expiry ON analytics_events(received_at);

CREATE TABLE daily_usage (
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  events INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(workspace_id,site_id,day)
);
CREATE TABLE installation_usage (
  day TEXT PRIMARY KEY,
  events INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE dirty_buckets (
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  timezone TEXT NOT NULL,
  PRIMARY KEY(workspace_id,site_id,day,timezone)
);
CREATE TABLE daily_summaries (
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  day TEXT NOT NULL,
  timezone TEXT NOT NULL,
  dimension TEXT NOT NULL,
  name TEXT NOT NULL,
  pageviews INTEGER NOT NULL,
  goals INTEGER NOT NULL,
  definition_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,site_id,day,timezone,dimension,name)
);

-- This trigger runs in the same transaction as the event insert. All checks
-- except changed-payload conflicts bypass an already accepted event ID.
CREATE TRIGGER analytics_event_admission BEFORE INSERT ON analytics_events BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM analytics_events WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND id=NEW.id AND digest!=NEW.digest
  ) THEN RAISE(ABORT,'event_conflict') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM analytics_events WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND id=NEW.id
  ) THEN CASE
    WHEN NOT EXISTS (SELECT 1 FROM sites WHERE id=NEW.site_id AND workspace_id=NEW.workspace_id AND status='active') THEN RAISE(ABORT,'site_unavailable')
    WHEN NOT EXISTS (SELECT 1 FROM sites WHERE id=NEW.site_id AND workspace_id=NEW.workspace_id AND privacy_mode=NEW.privacy_mode AND timezone=NEW.timezone) THEN RAISE(ABORT,'site_configuration_changed')
    WHEN COALESCE((SELECT events FROM daily_usage WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND day=strftime('%Y-%m-%d',NEW.received_at/1000,'unixepoch')),0) >= (SELECT daily_limit FROM sites WHERE id=NEW.site_id AND workspace_id=NEW.workspace_id) THEN RAISE(ABORT,'site_quota_exceeded')
    WHEN COALESCE((SELECT events FROM installation_usage WHERE day=strftime('%Y-%m-%d',NEW.received_at/1000,'unixepoch')),0) >= 2000 THEN RAISE(ABORT,'installation_quota_exceeded')
    WHEN EXISTS (SELECT 1 FROM analytics_sessions WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND id=NEW.session_id AND (visitor_id!=NEW.visitor_id OR privacy_mode!=NEW.privacy_mode)) THEN RAISE(ABORT,'session_identity_conflict')
    WHEN NEW.type='engagement' AND NOT EXISTS (SELECT 1 FROM analytics_sessions WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND id=NEW.session_id) THEN RAISE(ABORT,'session_missing')
    WHEN EXISTS (SELECT 1 FROM analytics_sessions WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND id=NEW.session_id AND last_interaction_at < NEW.received_at-1800000) THEN RAISE(ABORT,'session_expired')
    WHEN EXISTS (SELECT 1 FROM analytics_sessions WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND id=NEW.session_id AND started_at > NEW.ts) THEN RAISE(ABORT,'ambiguous_late_event')
  END END;
END;

CREATE TRIGGER analytics_event_accepted AFTER INSERT ON analytics_events BEGIN
  INSERT INTO analytics_sessions(workspace_id,site_id,id,visitor_id,privacy_mode,started_at,started_day,exit_ts,exit_sequence,last_interaction_at,last_received_at,last_event_at,entry_page,exit_page,source,channel,campaign)
    SELECT NEW.workspace_id,NEW.site_id,NEW.session_id,NEW.visitor_id,NEW.privacy_mode,NEW.ts,NEW.local_day,NEW.ts,NEW.sequence,NEW.received_at,NEW.received_at,NEW.ts,NEW.path,NEW.path,NEW.source,NEW.channel,NEW.campaign
    WHERE NEW.type!='engagement'
    ON CONFLICT(workspace_id,site_id,id) DO NOTHING;
  -- Freeze every accepted event to the winner's session attribution. A request
  -- cannot safely inherit this through a separate pre-insert SELECT under races.
  -- Keep digest unchanged: it identifies the original canonical client envelope.
  UPDATE analytics_events SET (source,channel,campaign)=(
    SELECT s.source,s.channel,s.campaign FROM analytics_sessions s
    WHERE s.workspace_id=NEW.workspace_id AND s.site_id=NEW.site_id AND s.id=NEW.session_id
  ) WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND id=NEW.id
    AND EXISTS(SELECT 1 FROM analytics_sessions s WHERE s.workspace_id=NEW.workspace_id AND s.site_id=NEW.site_id AND s.id=NEW.session_id
      AND (s.source IS NOT analytics_events.source OR s.channel IS NOT analytics_events.channel OR s.campaign IS NOT analytics_events.campaign));
  UPDATE analytics_sessions SET
    pageviews=pageviews+CASE WHEN NEW.type='pageview' THEN 1 ELSE 0 END,
    goals=goals+CASE WHEN NEW.type='goal' THEN 1 ELSE 0 END,
    duration=MIN(duration+NEW.duration,MAX(0,NEW.received_at-started_at)),
    last_received_at=MAX(last_received_at,NEW.received_at),
    last_interaction_at=CASE WHEN NEW.type!='engagement' THEN MAX(last_interaction_at,NEW.received_at) ELSE last_interaction_at END,
    exit_page=CASE WHEN NEW.type='pageview' AND (NEW.ts>exit_ts OR (NEW.ts=exit_ts AND NEW.sequence>=exit_sequence)) THEN NEW.path ELSE exit_page END,
    exit_sequence=CASE WHEN NEW.type='pageview' AND (NEW.ts>exit_ts OR (NEW.ts=exit_ts AND NEW.sequence>=exit_sequence)) THEN NEW.sequence ELSE exit_sequence END,
    exit_ts=CASE WHEN NEW.type='pageview' THEN MAX(exit_ts,NEW.ts) ELSE exit_ts END,
    last_event_at=MAX(last_event_at,NEW.ts)
    WHERE workspace_id=NEW.workspace_id AND site_id=NEW.site_id AND id=NEW.session_id;
  INSERT INTO daily_usage(workspace_id,site_id,day,events) VALUES(NEW.workspace_id,NEW.site_id,strftime('%Y-%m-%d',NEW.received_at/1000,'unixepoch'),1)
    ON CONFLICT(workspace_id,site_id,day) DO UPDATE SET events=events+1;
  INSERT INTO installation_usage(day,events) VALUES(strftime('%Y-%m-%d',NEW.received_at/1000,'unixepoch'),1)
    ON CONFLICT(day) DO UPDATE SET events=events+1;
  INSERT OR IGNORE INTO dirty_buckets(workspace_id,site_id,day,timezone) VALUES(NEW.workspace_id,NEW.site_id,NEW.local_day,NEW.timezone);
END;
