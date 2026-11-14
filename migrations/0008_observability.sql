CREATE TABLE observability_logs (
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('trace','debug','info','warn','error','fatal')),
  message TEXT NOT NULL,
  namespace TEXT,
  service TEXT,
  environment TEXT,
  region TEXT,
  release TEXT,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  context_json TEXT,
  meta_json TEXT,
  error_json TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY(workspace_id,site_id,id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX observability_logs_time ON observability_logs(workspace_id,site_id,ts DESC);
CREATE INDEX observability_logs_level ON observability_logs(workspace_id,site_id,level,ts DESC);
CREATE INDEX observability_logs_trace ON observability_logs(workspace_id,site_id,trace_id,ts DESC);

CREATE TABLE observability_audit (
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('success','failure','denied')),
  trace_id TEXT,
  resource_json TEXT NOT NULL,
  actor_json TEXT,
  tenant_json TEXT,
  session_json TEXT,
  changes_json TEXT,
  details_json TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY(workspace_id,site_id,event_id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX observability_audit_time ON observability_audit(workspace_id,site_id,ts DESC);
CREATE INDEX observability_audit_action ON observability_audit(workspace_id,site_id,action,ts DESC);

CREATE TABLE observability_spans (
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  service TEXT,
  environment TEXT,
  start_ts INTEGER NOT NULL,
  duration_ms REAL NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok','error','unset')),
  attributes_json TEXT,
  raw_json TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,site_id,trace_id,span_id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX observability_spans_time ON observability_spans(workspace_id,site_id,start_ts DESC);
CREATE INDEX observability_spans_trace ON observability_spans(workspace_id,site_id,trace_id,start_ts);
CREATE INDEX observability_spans_service ON observability_spans(workspace_id,site_id,service,start_ts DESC);

CREATE TABLE observability_alert_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  query_json TEXT NOT NULL,
  threshold REAL NOT NULL,
  window_seconds INTEGER NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('warning','critical')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX observability_alert_rules_site ON observability_alert_rules(workspace_id,site_id,enabled);

CREATE TABLE observability_alert_incidents (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','firing','acknowledged','resolved')),
  value REAL,
  started_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  resolved_at INTEGER,
  owner_user_id TEXT,
  last_notification_at INTEGER,
  FOREIGN KEY(rule_id) REFERENCES observability_alert_rules(id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,id)
);
CREATE INDEX observability_alert_incidents_site ON observability_alert_incidents(workspace_id,site_id,state,started_at DESC);
