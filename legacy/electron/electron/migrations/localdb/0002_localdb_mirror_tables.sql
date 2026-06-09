CREATE TABLE IF NOT EXISTS local_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  last_bootstrap_at TEXT,
  last_opened_at TEXT,
  bootstrap_version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS local_knowledge_bases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  cover_attachment_id TEXT,
  description TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  dirty_state TEXT NOT NULL DEFAULT 'clean'
);

CREATE TABLE IF NOT EXISTS local_cards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kb_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  meta_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  dirty_state TEXT NOT NULL DEFAULT 'clean'
);

CREATE TABLE IF NOT EXISTS local_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  parent_document_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL DEFAULT '{}',
  meta_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  dirty_state TEXT NOT NULL DEFAULT 'clean'
);

CREATE TABLE IF NOT EXISTS local_graph_layouts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kb_id TEXT NOT NULL,
  room_card_id TEXT,
  layout_json TEXT NOT NULL DEFAULT '{}',
  viewport_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  dirty_state TEXT NOT NULL DEFAULT 'clean'
);

CREATE TABLE IF NOT EXISTS sync_cursor (
  workspace_id TEXT PRIMARY KEY,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  bootstrap_completed_at TEXT,
  last_pull_at TEXT,
  last_push_at TEXT,
  server_time_at_last_pull TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_workspaces_last_opened_at
  ON local_workspaces(last_opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_local_knowledge_bases_workspace_sort
  ON local_knowledge_bases(workspace_id, sort_order, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_local_cards_workspace_parent_sort
  ON local_cards(workspace_id, kb_id, parent_id, sort_order, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_local_documents_workspace_card_sort
  ON local_documents(workspace_id, card_id, parent_document_id, sort_order, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_local_graph_layouts_workspace_scope
  ON local_graph_layouts(workspace_id, kb_id, room_card_id, updated_at DESC);
