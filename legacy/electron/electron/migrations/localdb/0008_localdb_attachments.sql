CREATE TABLE IF NOT EXISTS local_attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  document_id TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_provider TEXT NOT NULL,
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  dirty_state TEXT NOT NULL DEFAULT 'clean'
);

CREATE INDEX IF NOT EXISTS idx_local_attachments_workspace_card_created
  ON local_attachments(workspace_id, card_id, created_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_local_attachments_document_created
  ON local_attachments(document_id, created_at DESC, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_local_attachments_storage_key_unique
  ON local_attachments(storage_provider, storage_bucket, storage_key);
