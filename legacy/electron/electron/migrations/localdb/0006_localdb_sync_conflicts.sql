CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  client_base_version INTEGER,
  server_version INTEGER,
  server_event_id INTEGER,
  local_payload_json TEXT NOT NULL DEFAULT '{}',
  server_entity_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_workspace_status_created
  ON sync_conflicts(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity_created
  ON sync_conflicts(entity_type, entity_id, created_at DESC);
