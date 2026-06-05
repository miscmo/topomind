CREATE TABLE IF NOT EXISTS knowledge_bases (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  cover_attachment_id UUID NULL,
  description TEXT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  CHECK (btrim(name) <> ''),
  CHECK (sort_order >= 0),
  CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_workspace_sort
  ON knowledge_bases (workspace_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_workspace_updated
  ON knowledge_bases (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_workspace_active
  ON knowledge_bases (workspace_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  parent_id UUID NULL REFERENCES cards(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  CHECK (btrim(name) <> ''),
  CHECK (sort_order >= 0),
  CHECK (status IN ('active', 'archived')),
  CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS idx_cards_kb_parent_sort
  ON cards (kb_id, parent_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_cards_workspace_kb
  ON cards (workspace_id, kb_id);

CREATE INDEX IF NOT EXISTS idx_cards_parent_id
  ON cards (parent_id);

CREATE INDEX IF NOT EXISTS idx_cards_workspace_updated
  ON cards (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cards_kb_active
  ON cards (kb_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS card_edges (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  target_card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'related',
  weight TEXT NOT NULL DEFAULT 'normal',
  style_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  CHECK (source_card_id <> target_card_id),
  CHECK (btrim(relation) <> ''),
  CHECK (weight IN ('low', 'normal', 'high')),
  CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS idx_card_edges_kb_source
  ON card_edges (kb_id, source_card_id);

CREATE INDEX IF NOT EXISTS idx_card_edges_kb_target
  ON card_edges (kb_id, target_card_id);

CREATE INDEX IF NOT EXISTS idx_card_edges_workspace_updated
  ON card_edges (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS graph_layouts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  room_card_id UUID NULL REFERENCES cards(id) ON DELETE SET NULL,
  layout_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  viewport_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  updated_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_layouts_kb_room_unique
  ON graph_layouts (kb_id, room_card_id)
  WHERE room_card_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_layouts_kb_root_unique
  ON graph_layouts (kb_id)
  WHERE room_card_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_graph_layouts_workspace_updated
  ON graph_layouts (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  parent_document_id UUID NULL REFERENCES documents(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  CHECK (btrim(title) <> ''),
  CHECK (sort_order >= 0),
  CHECK (schema_version > 0),
  CHECK (type IN ('smart', 'mindmap', 'flowchart')),
  CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS idx_documents_card_parent_sort
  ON documents (card_id, parent_document_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_documents_card_type
  ON documents (card_id, type);

CREATE INDEX IF NOT EXISTS idx_documents_workspace_updated
  ON documents (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_card_active
  ON documents (card_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  document_id UUID NULL REFERENCES documents(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT NULL,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  CHECK (btrim(file_name) <> ''),
  CHECK (btrim(mime_type) <> ''),
  CHECK (btrim(storage_key) <> ''),
  CHECK (size_bytes >= 0),
  CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_storage_location_unique
  ON attachments (storage_provider, storage_bucket, storage_key);

CREATE INDEX IF NOT EXISTS idx_attachments_card_created
  ON attachments (card_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_document_id
  ON attachments (document_id);

CREATE INDEX IF NOT EXISTS idx_attachments_workspace_updated
  ON attachments (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_sha256
  ON attachments (sha256);

ALTER TABLE knowledge_bases
  ADD CONSTRAINT fk_knowledge_bases_cover_attachment
  FOREIGN KEY (cover_attachment_id)
  REFERENCES attachments(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS workspace_configs (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS change_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  entity_version BIGINT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (btrim(entity_type) <> ''),
  CHECK (event_type IN ('created', 'updated', 'deleted', 'restored')),
  CHECK (entity_version > 0)
);

CREATE INDEX IF NOT EXISTS idx_change_events_workspace_id
  ON change_events (workspace_id, id);

CREATE INDEX IF NOT EXISTS idx_change_events_entity_history
  ON change_events (entity_type, entity_id, id DESC);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id UUID PRIMARY KEY,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resource_type TEXT NOT NULL,
  resource_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (btrim(scope) <> ''),
  CHECK (btrim(idempotency_key) <> ''),
  CHECK (btrim(request_hash) <> ''),
  CHECK (btrim(resource_type) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_scope_key_unique
  ON idempotency_records (scope, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_idempotency_workspace_created
  ON idempotency_records (workspace_id, created_at DESC);
