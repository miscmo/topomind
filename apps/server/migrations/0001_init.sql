-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_email_unique ON users ((lower(email)));

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_refresh_tokens_token_hash_unique ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_user_active ON refresh_tokens (user_id, revoked_at, expires_at DESC);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_workspaces_created_by_updated ON workspaces (created_by, updated_at DESC);

CREATE TABLE workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_workspace_members_workspace_user_unique
  ON workspace_members (workspace_id, user_id);
CREATE INDEX idx_workspace_members_user_role
  ON workspace_members (user_id, role, workspace_id);

CREATE TABLE workspace_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_workspace_configs_workspace_unique
  ON workspace_configs (workspace_id);
CREATE INDEX idx_workspace_configs_updated_at
  ON workspace_configs (updated_at DESC);

CREATE TABLE knowledge_bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  cover_attachment_id UUID,
  description TEXT,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_knowledge_bases_workspace_deleted_sort
  ON knowledge_bases (workspace_id, deleted_at, sort_order, updated_at DESC);

CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES cards(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_cards_workspace_kb_parent_deleted_sort
  ON cards (workspace_id, kb_id, parent_id, deleted_at, sort_order, updated_at DESC);
CREATE INDEX idx_cards_parent_lookup
  ON cards (parent_id, sort_order, updated_at DESC);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('smart', 'mindmap', 'flowchart')),
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  parent_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_documents_workspace_card_parent_deleted_sort
  ON documents (workspace_id, card_id, parent_document_id, deleted_at, sort_order, updated_at DESC);
CREATE INDEX idx_documents_card_type
  ON documents (card_id, type, updated_at DESC);

CREATE TABLE graph_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  room_card_id UUID REFERENCES cards(id) ON DELETE SET NULL,
  layout_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  viewport_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_graph_layouts_workspace_kb_room_unique
  ON graph_layouts (workspace_id, kb_id, COALESCE(room_card_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX idx_graph_layouts_workspace_updated
  ON graph_layouts (workspace_id, updated_at DESC);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id UUID REFERENCES knowledge_bases(id) ON DELETE SET NULL,
  card_id UUID REFERENCES cards(id) ON DELETE SET NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  storage_provider TEXT NOT NULL,
  storage_bucket TEXT,
  storage_key TEXT NOT NULL,
  sha256 TEXT,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_attachments_storage_unique
  ON attachments (storage_provider, COALESCE(storage_bucket, ''), storage_key);
CREATE INDEX idx_attachments_workspace_deleted_created
  ON attachments (workspace_id, deleted_at, created_at DESC);
CREATE INDEX idx_attachments_card_lookup
  ON attachments (card_id, deleted_at, created_at DESC);
CREATE INDEX idx_attachments_document_lookup
  ON attachments (document_id, deleted_at, created_at DESC);

ALTER TABLE knowledge_bases
  ADD CONSTRAINT fk_knowledge_bases_cover_attachment
  FOREIGN KEY (cover_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL;

CREATE TABLE sync_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('knowledge_base', 'card', 'document', 'graph_layout', 'attachment', 'workspace_config')),
  entity_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'deleted', 'restored', 'purged')),
  entity_version BIGINT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_events_workspace_id
  ON sync_events (workspace_id, id);
CREATE INDEX idx_sync_events_entity_lookup
  ON sync_events (entity_type, entity_id, id DESC);

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resource_type TEXT,
  resource_id UUID,
  status_code INTEGER,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_idempotency_workspace_scope_key_unique
  ON idempotency_keys (workspace_id, scope, idempotency_key);
CREATE INDEX idx_idempotency_workspace_created
  ON idempotency_keys (workspace_id, created_at DESC);

CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  source_file_name TEXT NOT NULL,
  source_object_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  stage TEXT NOT NULL CHECK (stage IN ('source-import', 'scan', 'import-structure', 'push', 'import-attachments', 'report')),
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_import_jobs_workspace_status_created
  ON import_jobs (workspace_id, status, created_at DESC);

CREATE TABLE attachment_upload_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL,
  knowledge_base_id UUID REFERENCES knowledge_bases(id) ON DELETE SET NULL,
  card_id UUID REFERENCES cards(id) ON DELETE SET NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  storage_key TEXT,
  upload_ticket_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending', 'uploading', 'uploaded', 'committing', 'done', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_attachment_upload_jobs_workspace_status_created
  ON attachment_upload_jobs (workspace_id, status, created_at DESC);
CREATE INDEX idx_attachment_upload_jobs_attachment
  ON attachment_upload_jobs (attachment_id, created_at DESC);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_workspace_created
  ON audit_logs (workspace_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity_created
  ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_refresh_tokens_updated_at
  BEFORE UPDATE ON refresh_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_workspace_members_updated_at
  BEFORE UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_workspace_configs_updated_at
  BEFORE UPDATE ON workspace_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_knowledge_bases_updated_at
  BEFORE UPDATE ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_cards_updated_at
  BEFORE UPDATE ON cards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_graph_layouts_updated_at
  BEFORE UPDATE ON graph_layouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_attachments_updated_at
  BEFORE UPDATE ON attachments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_idempotency_keys_updated_at
  BEFORE UPDATE ON idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_import_jobs_updated_at
  BEFORE UPDATE ON import_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_attachment_upload_jobs_updated_at
  BEFORE UPDATE ON attachment_upload_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_audit_logs_updated_at
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS attachment_upload_jobs;
DROP TABLE IF EXISTS import_jobs;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS sync_events;
ALTER TABLE IF EXISTS knowledge_bases
  DROP CONSTRAINT IF EXISTS fk_knowledge_bases_cover_attachment;
DROP TABLE IF EXISTS graph_layouts;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS cards;
DROP TABLE IF EXISTS knowledge_bases;
DROP TABLE IF EXISTS workspace_configs;
DROP TABLE IF EXISTS workspace_members;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;

DROP FUNCTION IF EXISTS set_updated_at();
