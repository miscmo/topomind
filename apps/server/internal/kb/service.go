package kb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	syncapi "topomind/apps/server/internal/sync"
	"topomind/apps/server/internal/workspace"
)

type Service struct {
	pool        *pgxpool.Pool
	eventWriter *syncapi.EventWriter
}

type CreateInput struct {
	UserID          string
	WorkspaceID     string
	KnowledgeBaseID string
	Name            string
	SortOrder       int32
}

type UpdateInput struct {
	UserID      string
	WorkspaceID string
	KnowledgeBaseID string
	Name        *string
	SortOrder   *int32
}

type DeleteInput struct {
	UserID          string
	WorkspaceID     string
	KnowledgeBaseID string
}

type KnowledgeBase struct {
	ID                string         `json:"id"`
	WorkspaceID       string         `json:"workspaceId"`
	Name              string         `json:"name"`
	SortOrder         int32          `json:"sortOrder"`
	CoverAttachmentID *string        `json:"coverAttachmentId"`
	Description       *string        `json:"description"`
	SettingsJSON      map[string]any `json:"settingsJson"`
	Version           int64          `json:"version"`
	CreatedAt         string         `json:"createdAt"`
	UpdatedAt         string         `json:"updatedAt"`
	DeletedAt         *string        `json:"deletedAt"`
}

func NewService(pool *pgxpool.Pool, eventWriter *syncapi.EventWriter) *Service {
	return &Service{
		pool:        pool,
		eventWriter: eventWriter,
	}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (KnowledgeBase, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return KnowledgeBase{}, ErrInvalidKnowledgeBaseName
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return KnowledgeBase{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return KnowledgeBase{}, err
	}

	var (
		item      KnowledgeBase
		settings  []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)

	query := `INSERT INTO knowledge_bases (
		   workspace_id,
		   name,
		   sort_order
		 )
		 VALUES ($1, $2, $3)
		 RETURNING id, workspace_id, name, sort_order, cover_attachment_id, description, settings_json, version, created_at, updated_at, deleted_at`
	args := []any{input.WorkspaceID, name, input.SortOrder}
	if knowledgeBaseID := strings.TrimSpace(input.KnowledgeBaseID); knowledgeBaseID != "" {
		query = `INSERT INTO knowledge_bases (
		   id,
		   workspace_id,
		   name,
		   sort_order
		 )
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, workspace_id, name, sort_order, cover_attachment_id, description, settings_json, version, created_at, updated_at, deleted_at`
		args = []any{knowledgeBaseID, input.WorkspaceID, name, input.SortOrder}
	}

	if err := tx.QueryRow(
		ctx,
		query,
		args...,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.Name,
		&item.SortOrder,
		&item.CoverAttachmentID,
		&item.Description,
		&settings,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	); err != nil {
		return KnowledgeBase{}, fmt.Errorf("insert knowledge base: %w", err)
	}

	item.SettingsJSON = decodeJSONObject(settings)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeKnowledgeBase,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeCreated,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return KnowledgeBase{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return KnowledgeBase{}, fmt.Errorf("commit create knowledge base: %w", err)
	}

	return item, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (KnowledgeBase, error) {
	if input.Name == nil && input.SortOrder == nil {
		return KnowledgeBase{}, ErrNoKnowledgeBaseChanges
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return KnowledgeBase{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return KnowledgeBase{}, err
	}

	current, err := s.getKnowledgeBaseTx(ctx, tx, input.WorkspaceID, input.KnowledgeBaseID)
	if err != nil {
		return KnowledgeBase{}, err
	}
	if current.DeletedAt != nil {
		return KnowledgeBase{}, ErrKnowledgeBaseAlreadyDeleted
	}

	nextName := current.Name
	if input.Name != nil {
		nextName = strings.TrimSpace(*input.Name)
		if nextName == "" {
			return KnowledgeBase{}, ErrInvalidKnowledgeBaseName
		}
	}

	nextSortOrder := current.SortOrder
	if input.SortOrder != nil {
		nextSortOrder = *input.SortOrder
	}

	item, err := s.updateKnowledgeBaseTx(ctx, tx, input.WorkspaceID, input.KnowledgeBaseID, nextName, nextSortOrder, current.DeletedAt)
	if err != nil {
		return KnowledgeBase{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeKnowledgeBase,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeUpdated,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return KnowledgeBase{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return KnowledgeBase{}, fmt.Errorf("commit update knowledge base: %w", err)
	}

	return item, nil
}

func (s *Service) Delete(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return KnowledgeBase{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return KnowledgeBase{}, err
	}

	current, err := s.getKnowledgeBaseTx(ctx, tx, input.WorkspaceID, input.KnowledgeBaseID)
	if err != nil {
		return KnowledgeBase{}, err
	}
	if current.DeletedAt != nil {
		return KnowledgeBase{}, ErrKnowledgeBaseAlreadyDeleted
	}

	item, err := s.updateKnowledgeBaseDeletedAtTx(ctx, tx, input.WorkspaceID, input.KnowledgeBaseID, true)
	if err != nil {
		return KnowledgeBase{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeKnowledgeBase,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeDeleted,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return KnowledgeBase{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return KnowledgeBase{}, fmt.Errorf("commit delete knowledge base: %w", err)
	}

	return item, nil
}

func (s *Service) Restore(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return KnowledgeBase{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return KnowledgeBase{}, err
	}

	current, err := s.getKnowledgeBaseTx(ctx, tx, input.WorkspaceID, input.KnowledgeBaseID)
	if err != nil {
		return KnowledgeBase{}, err
	}
	if current.DeletedAt == nil {
		return KnowledgeBase{}, ErrKnowledgeBaseNotDeleted
	}

	item, err := s.updateKnowledgeBaseDeletedAtTx(ctx, tx, input.WorkspaceID, input.KnowledgeBaseID, false)
	if err != nil {
		return KnowledgeBase{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeKnowledgeBase,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeRestored,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return KnowledgeBase{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return KnowledgeBase{}, fmt.Errorf("commit restore knowledge base: %w", err)
	}

	return item, nil
}

func (s *Service) Purge(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return KnowledgeBase{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return KnowledgeBase{}, err
	}

	current, err := s.getKnowledgeBaseTx(ctx, tx, input.WorkspaceID, input.KnowledgeBaseID)
	if err != nil {
		return KnowledgeBase{}, err
	}
	if current.DeletedAt == nil {
		return KnowledgeBase{}, ErrKnowledgeBaseNotDeleted
	}

	var cardCount int
	if err := tx.QueryRow(
		ctx,
		`SELECT COUNT(1)
		 FROM cards
		 WHERE workspace_id = $1
		   AND kb_id = $2`,
		input.WorkspaceID,
		input.KnowledgeBaseID,
	).Scan(&cardCount); err != nil {
		return KnowledgeBase{}, fmt.Errorf("count knowledge base cards: %w", err)
	}
	if cardCount > 0 {
		return KnowledgeBase{}, ErrKnowledgeBaseHasCards
	}

	purged := current
	purged.Version = current.Version + 1

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   purged.WorkspaceID,
		EntityType:    syncapi.EntityTypeKnowledgeBase,
		EntityID:      purged.ID,
		EventType:     syncapi.EventTypePurged,
		EntityVersion: purged.Version,
		Snapshot:      purged,
		ActorUserID:   input.UserID,
	}); err != nil {
		return KnowledgeBase{}, err
	}

	commandTag, err := tx.Exec(
		ctx,
		`DELETE FROM knowledge_bases
		 WHERE workspace_id = $1
		   AND id = $2`,
		input.WorkspaceID,
		input.KnowledgeBaseID,
	)
	if err != nil {
		return KnowledgeBase{}, fmt.Errorf("purge knowledge base: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return KnowledgeBase{}, ErrKnowledgeBaseNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return KnowledgeBase{}, fmt.Errorf("commit purge knowledge base: %w", err)
	}

	return purged, nil
}

func (s *Service) getKnowledgeBaseTx(ctx context.Context, tx pgx.Tx, workspaceID string, knowledgeBaseID string) (KnowledgeBase, error) {
	var (
		item      KnowledgeBase
		settings  []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)

	err := tx.QueryRow(
		ctx,
		`SELECT id, workspace_id, name, sort_order, cover_attachment_id, description, settings_json, version, created_at, updated_at, deleted_at
		 FROM knowledge_bases
		 WHERE workspace_id = $1
		   AND id = $2
		 FOR UPDATE`,
		workspaceID,
		knowledgeBaseID,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.Name,
		&item.SortOrder,
		&item.CoverAttachmentID,
		&item.Description,
		&settings,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return KnowledgeBase{}, ErrKnowledgeBaseNotFound
		}
		return KnowledgeBase{}, fmt.Errorf("select knowledge base: %w", err)
	}

	item.SettingsJSON = decodeJSONObject(settings)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, nil
}

func (s *Service) updateKnowledgeBaseTx(
	ctx context.Context,
	tx pgx.Tx,
	workspaceID string,
	knowledgeBaseID string,
	name string,
	sortOrder int32,
	deletedAt *string,
) (KnowledgeBase, error) {
	var (
		item          KnowledgeBase
		settings      []byte
		createdAtTime time.Time
		updatedAtTime time.Time
		deletedAtTime *time.Time
	)

	err := tx.QueryRow(
		ctx,
		`UPDATE knowledge_bases
		 SET name = $3,
		     sort_order = $4,
		     version = version + 1
		 WHERE workspace_id = $1
		   AND id = $2
		 RETURNING id, workspace_id, name, sort_order, cover_attachment_id, description, settings_json, version, created_at, updated_at, deleted_at`,
		workspaceID,
		knowledgeBaseID,
		name,
		sortOrder,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.Name,
		&item.SortOrder,
		&item.CoverAttachmentID,
		&item.Description,
		&settings,
		&item.Version,
		&createdAtTime,
		&updatedAtTime,
		&deletedAtTime,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return KnowledgeBase{}, ErrKnowledgeBaseNotFound
		}
		return KnowledgeBase{}, fmt.Errorf("update knowledge base: %w", err)
	}

	item.SettingsJSON = decodeJSONObject(settings)
	item.CreatedAt = createdAtTime.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAtTime.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAtTime)
	if deletedAt != nil {
		item.DeletedAt = deletedAt
	}
	return item, nil
}

func (s *Service) updateKnowledgeBaseDeletedAtTx(
	ctx context.Context,
	tx pgx.Tx,
	workspaceID string,
	knowledgeBaseID string,
	deleted bool,
) (KnowledgeBase, error) {
	var query string
	if deleted {
		query = `UPDATE knowledge_bases
		         SET deleted_at = NOW(),
		             version = version + 1
		         WHERE workspace_id = $1
		           AND id = $2
		         RETURNING id, workspace_id, name, sort_order, cover_attachment_id, description, settings_json, version, created_at, updated_at, deleted_at`
	} else {
		query = `UPDATE knowledge_bases
		         SET deleted_at = NULL,
		             version = version + 1
		         WHERE workspace_id = $1
		           AND id = $2
		         RETURNING id, workspace_id, name, sort_order, cover_attachment_id, description, settings_json, version, created_at, updated_at, deleted_at`
	}

	var (
		item      KnowledgeBase
		settings  []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)
	err := tx.QueryRow(ctx, query, workspaceID, knowledgeBaseID).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.Name,
		&item.SortOrder,
		&item.CoverAttachmentID,
		&item.Description,
		&settings,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return KnowledgeBase{}, ErrKnowledgeBaseNotFound
		}
		return KnowledgeBase{}, fmt.Errorf("update knowledge base deleted state: %w", err)
	}
	item.SettingsJSON = decodeJSONObject(settings)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, nil
}

func decodeJSONObject(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return map[string]any{
			"_decodeError": err.Error(),
		}
	}
	if value == nil {
		return map[string]any{}
	}
	return value
}

func formatTimePtr(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}
