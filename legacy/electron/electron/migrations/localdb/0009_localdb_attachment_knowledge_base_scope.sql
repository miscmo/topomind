ALTER TABLE local_attachments
  ADD COLUMN knowledge_base_id TEXT;

CREATE INDEX IF NOT EXISTS idx_local_attachments_workspace_kb_created
  ON local_attachments(workspace_id, knowledge_base_id, created_at DESC, updated_at DESC);
