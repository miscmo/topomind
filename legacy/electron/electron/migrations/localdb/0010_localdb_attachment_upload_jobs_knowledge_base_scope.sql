CREATE TABLE IF NOT EXISTS attachment_upload_jobs_v2 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  local_file_path TEXT NOT NULL,
  knowledge_base_id TEXT,
  card_id TEXT,
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
  updated_at TEXT NOT NULL,
  CHECK (
    (CASE WHEN knowledge_base_id IS NOT NULL AND TRIM(knowledge_base_id) <> '' THEN 1 ELSE 0 END)
    + (CASE WHEN card_id IS NOT NULL AND TRIM(card_id) <> '' THEN 1 ELSE 0 END) = 1
  ),
  CHECK (card_id IS NOT NULL OR document_id IS NULL)
);

INSERT INTO attachment_upload_jobs_v2 (
  id,
  workspace_id,
  local_file_path,
  knowledge_base_id,
  card_id,
  document_id,
  file_name,
  mime_type,
  size_bytes,
  upload_ticket_json,
  storage_key,
  sha256,
  status,
  attempt_count,
  last_error_code,
  last_error_message,
  created_at,
  updated_at
)
SELECT
  id,
  workspace_id,
  local_file_path,
  NULL AS knowledge_base_id,
  card_id,
  document_id,
  file_name,
  mime_type,
  size_bytes,
  upload_ticket_json,
  storage_key,
  sha256,
  status,
  attempt_count,
  last_error_code,
  last_error_message,
  created_at,
  updated_at
FROM attachment_upload_jobs;

DROP TABLE attachment_upload_jobs;

ALTER TABLE attachment_upload_jobs_v2 RENAME TO attachment_upload_jobs;

CREATE INDEX IF NOT EXISTS idx_attachment_upload_jobs_workspace_status_updated
  ON attachment_upload_jobs(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachment_upload_jobs_card_updated
  ON attachment_upload_jobs(card_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachment_upload_jobs_knowledge_base_updated
  ON attachment_upload_jobs(knowledge_base_id, updated_at DESC);
