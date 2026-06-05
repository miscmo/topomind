DROP INDEX IF EXISTS idx_idempotency_scope_key_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_workspace_scope_key_unique
  ON idempotency_records (workspace_id, scope, idempotency_key)
  WHERE workspace_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_global_scope_key_unique
  ON idempotency_records (scope, idempotency_key)
  WHERE workspace_id IS NULL;
