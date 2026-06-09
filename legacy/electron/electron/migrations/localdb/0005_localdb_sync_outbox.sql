CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  acked_event_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_outbox_idempotency_key
  ON sync_outbox(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_workspace_status_retry
  ON sync_outbox(workspace_id, status, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity_created
  ON sync_outbox(entity_type, entity_id, created_at DESC);
