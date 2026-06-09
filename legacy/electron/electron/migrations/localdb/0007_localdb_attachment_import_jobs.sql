CREATE TABLE IF NOT EXISTS attachment_upload_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  local_file_path TEXT NOT NULL,
  card_id TEXT NOT NULL,
  document_id TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  upload_ticket_json TEXT NOT NULL DEFAULT '{}',
  storage_key TEXT,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachment_upload_jobs_workspace_status_updated
  ON attachment_upload_jobs(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachment_upload_jobs_card_updated
  ON attachment_upload_jobs(card_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'scan',
  status TEXT NOT NULL DEFAULT 'pending',
  summary_json TEXT NOT NULL DEFAULT '{}',
  report_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_workspace_status_updated
  ON import_jobs(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_jobs_stage_updated
  ON import_jobs(stage, updated_at DESC);
