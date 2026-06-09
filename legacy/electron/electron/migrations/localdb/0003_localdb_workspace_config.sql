CREATE TABLE IF NOT EXISTS local_workspace_configs (
  workspace_id TEXT PRIMARY KEY,
  config_version INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_workspace_configs_updated_at
  ON local_workspace_configs(updated_at DESC);
