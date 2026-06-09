package document

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	syncapi "topomind/apps/server/internal/sync"
	"topomind/apps/server/internal/workspace"
)

const (
	documentTypeSmart     = "smart"
	documentTypeMindMap   = "mindmap"
	documentTypeFlowchart = "flowchart"
)

type Service struct {
	pool        *pgxpool.Pool
	eventWriter *syncapi.EventWriter
}

type CreateInput struct {
	UserID           string
	WorkspaceID      string
	DocumentID       string
	CardID           string
	Type             string
	Title            string
	ParentDocumentID *string
	SortOrder        int32
}

type ListInput struct {
	UserID      string
	WorkspaceID string
	CardID      string
}

type GetInput struct {
	UserID      string
	WorkspaceID string
	DocumentID  string
}

type UpdateInput struct {
	UserID              string
	WorkspaceID         string
	DocumentID          string
	Title               *string
	ParentDocumentID    *string
	ParentDocumentIDSet bool
	SortOrder           *int32
}

type MoveInput struct {
	UserID           string
	WorkspaceID      string
	DocumentID       string
	ParentDocumentID *string
	SortOrder        int32
}

type DeleteInput struct {
	UserID      string
	WorkspaceID string
	DocumentID  string
}

type SaveContentInput struct {
	UserID        string
	WorkspaceID   string
	DocumentID    string
	BaseVersion   int64
	SchemaVersion int32
	ContentJSON   map[string]any
}

type Document struct {
	ID               string         `json:"id"`
	WorkspaceID      string         `json:"workspaceId"`
	CardID           string         `json:"cardId"`
	Type             string         `json:"type"`
	Title            string         `json:"title"`
	FileName         string         `json:"fileName"`
	ParentDocumentID *string        `json:"parentDocumentId"`
	SortOrder        int32          `json:"sortOrder"`
	SchemaVersion    int32          `json:"schemaVersion"`
	ContentJSON      map[string]any `json:"contentJson"`
	MetaJSON         map[string]any `json:"metaJson"`
	Version          int64          `json:"version"`
	CreatedAt        string         `json:"createdAt"`
	UpdatedAt        string         `json:"updatedAt"`
	DeletedAt        *string        `json:"deletedAt"`
}

func NewService(pool *pgxpool.Pool, eventWriter *syncapi.EventWriter) *Service {
	return &Service{
		pool:        pool,
		eventWriter: eventWriter,
	}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Document, error) {
	cardID := strings.TrimSpace(input.CardID)
	if cardID == "" {
		return Document{}, ErrInvalidCardID
	}

	documentType := strings.TrimSpace(input.Type)
	if !isSupportedDocumentType(documentType) {
		return Document{}, ErrInvalidDocumentType
	}

	title := strings.TrimSpace(input.Title)
	if title == "" {
		return Document{}, ErrInvalidDocumentTitle
	}

	parentDocumentID, err := normalizeParentDocumentID(input.ParentDocumentID)
	if err != nil {
		return Document{}, err
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Document{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Document{}, err
	}

	if err := s.requireCardTx(ctx, tx, input.WorkspaceID, cardID, false); err != nil {
		return Document{}, err
	}

	if parentDocumentID != nil {
		if err := s.requireParentDocumentTx(ctx, tx, input.WorkspaceID, cardID, *parentDocumentID, false); err != nil {
			return Document{}, err
		}
	}

	item, err := s.insertDocumentTx(ctx, tx, input.WorkspaceID, input.DocumentID, cardID, documentType, title, parentDocumentID, input.SortOrder)
	if err != nil {
		return Document{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeDocument,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeCreated,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Document{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Document{}, fmt.Errorf("commit create document: %w", err)
	}

	return item, nil
}

func (s *Service) List(ctx context.Context, input ListInput) ([]Document, error) {
	cardID := strings.TrimSpace(input.CardID)
	if cardID == "" {
		return nil, ErrInvalidCardID
	}

	if _, err := workspace.RequireMember(ctx, s.pool, input.WorkspaceID, input.UserID); err != nil {
		return nil, err
	}
	if err := s.requireCard(ctx, input.WorkspaceID, cardID); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(
		ctx,
		`SELECT id, workspace_id, card_id, type, title, file_name, parent_document_id, sort_order, schema_version, content_json, meta_json, version, created_at, updated_at, deleted_at
		 FROM documents
		 WHERE workspace_id = $1
		   AND card_id = $2
		   AND deleted_at IS NULL
		 ORDER BY COALESCE(parent_document_id::text, ''), sort_order ASC, updated_at DESC, id ASC`,
		input.WorkspaceID,
		cardID,
	)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	defer rows.Close()

	items := make([]Document, 0)
	for rows.Next() {
		item, err := scanDocument(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (s *Service) Get(ctx context.Context, input GetInput) (Document, error) {
	documentID := strings.TrimSpace(input.DocumentID)
	if documentID == "" {
		return Document{}, ErrInvalidDocumentID
	}

	if _, err := workspace.RequireMember(ctx, s.pool, input.WorkspaceID, input.UserID); err != nil {
		return Document{}, err
	}

	return s.getDocument(ctx, input.WorkspaceID, documentID)
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Document, error) {
	documentID := strings.TrimSpace(input.DocumentID)
	if documentID == "" {
		return Document{}, ErrInvalidDocumentID
	}
	if input.Title == nil && !input.ParentDocumentIDSet && input.SortOrder == nil {
		return Document{}, ErrNoDocumentChanges
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Document{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Document{}, err
	}

	current, err := s.getDocumentTx(ctx, tx, input.WorkspaceID, documentID, true)
	if err != nil {
		return Document{}, err
	}
	if current.DeletedAt != nil {
		return Document{}, ErrDocumentAlreadyDeleted
	}

	nextTitle := current.Title
	if input.Title != nil {
		nextTitle = strings.TrimSpace(*input.Title)
		if nextTitle == "" {
			return Document{}, ErrInvalidDocumentTitle
		}
	}

	nextParentDocumentID := current.ParentDocumentID
	if input.ParentDocumentIDSet {
		normalizedParentDocumentID, err := normalizeParentDocumentID(input.ParentDocumentID)
		if err != nil {
			return Document{}, err
		}
		nextParentDocumentID = normalizedParentDocumentID
		if err := s.validateParentDocumentChangeTx(ctx, tx, input.WorkspaceID, current.CardID, current.ID, nextParentDocumentID); err != nil {
			return Document{}, err
		}
	}

	nextSortOrder := current.SortOrder
	if input.SortOrder != nil {
		nextSortOrder = *input.SortOrder
	}

	item, err := s.updateDocumentTx(ctx, tx, input.WorkspaceID, documentID, nextTitle, nextParentDocumentID, nextSortOrder)
	if err != nil {
		return Document{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeDocument,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeUpdated,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Document{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Document{}, fmt.Errorf("commit update document: %w", err)
	}

	return item, nil
}

func (s *Service) Move(ctx context.Context, input MoveInput) (Document, error) {
	documentID := strings.TrimSpace(input.DocumentID)
	if documentID == "" {
		return Document{}, ErrInvalidDocumentID
	}

	normalizedParentDocumentID, err := normalizeParentDocumentID(input.ParentDocumentID)
	if err != nil {
		return Document{}, err
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Document{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Document{}, err
	}

	current, err := s.getDocumentTx(ctx, tx, input.WorkspaceID, documentID, true)
	if err != nil {
		return Document{}, err
	}
	if current.DeletedAt != nil {
		return Document{}, ErrDocumentAlreadyDeleted
	}

	if err := s.validateParentDocumentChangeTx(ctx, tx, input.WorkspaceID, current.CardID, current.ID, normalizedParentDocumentID); err != nil {
		return Document{}, err
	}

	item, err := s.updateDocumentTx(ctx, tx, input.WorkspaceID, documentID, current.Title, normalizedParentDocumentID, input.SortOrder)
	if err != nil {
		return Document{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeDocument,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeUpdated,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Document{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Document{}, fmt.Errorf("commit move document: %w", err)
	}

	return item, nil
}

func (s *Service) Delete(ctx context.Context, input DeleteInput) (Document, error) {
	documentID := strings.TrimSpace(input.DocumentID)
	if documentID == "" {
		return Document{}, ErrInvalidDocumentID
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Document{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Document{}, err
	}

	current, err := s.getDocumentTx(ctx, tx, input.WorkspaceID, documentID, true)
	if err != nil {
		return Document{}, err
	}
	if current.DeletedAt != nil {
		return Document{}, ErrDocumentAlreadyDeleted
	}

	item, err := s.updateDocumentDeletedAtTx(ctx, tx, input.WorkspaceID, documentID, true)
	if err != nil {
		return Document{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeDocument,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeDeleted,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Document{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Document{}, fmt.Errorf("commit delete document: %w", err)
	}

	return item, nil
}

func (s *Service) Restore(ctx context.Context, input DeleteInput) (Document, error) {
	documentID := strings.TrimSpace(input.DocumentID)
	if documentID == "" {
		return Document{}, ErrInvalidDocumentID
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Document{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Document{}, err
	}

	current, err := s.getDocumentTx(ctx, tx, input.WorkspaceID, documentID, true)
	if err != nil {
		return Document{}, err
	}
	if current.DeletedAt == nil {
		return Document{}, ErrDocumentNotDeleted
	}
	if err := s.requireCardTx(ctx, tx, input.WorkspaceID, current.CardID, false); err != nil {
		return Document{}, err
	}
	if current.ParentDocumentID != nil {
		if err := s.requireParentDocumentTx(ctx, tx, input.WorkspaceID, current.CardID, *current.ParentDocumentID, false); err != nil {
			return Document{}, err
		}
	}

	item, err := s.updateDocumentDeletedAtTx(ctx, tx, input.WorkspaceID, documentID, false)
	if err != nil {
		return Document{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeDocument,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeRestored,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Document{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Document{}, fmt.Errorf("commit restore document: %w", err)
	}

	return item, nil
}

func (s *Service) Purge(ctx context.Context, input DeleteInput) (Document, error) {
	documentID := strings.TrimSpace(input.DocumentID)
	if documentID == "" {
		return Document{}, ErrInvalidDocumentID
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Document{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Document{}, err
	}

	current, err := s.getDocumentTx(ctx, tx, input.WorkspaceID, documentID, true)
	if err != nil {
		return Document{}, err
	}
	if current.DeletedAt == nil {
		return Document{}, ErrDocumentNotDeleted
	}

	purged := current
	purged.Version = current.Version + 1

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   purged.WorkspaceID,
		EntityType:    syncapi.EntityTypeDocument,
		EntityID:      purged.ID,
		EventType:     syncapi.EventTypePurged,
		EntityVersion: purged.Version,
		Snapshot:      purged,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Document{}, err
	}

	commandTag, err := tx.Exec(
		ctx,
		`DELETE FROM documents
		 WHERE workspace_id = $1
		   AND id = $2`,
		input.WorkspaceID,
		documentID,
	)
	if err != nil {
		return Document{}, fmt.Errorf("purge document: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return Document{}, ErrDocumentNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return Document{}, fmt.Errorf("commit purge document: %w", err)
	}

	return purged, nil
}

func (s *Service) SaveContent(ctx context.Context, input SaveContentInput) (Document, error) {
	documentID := strings.TrimSpace(input.DocumentID)
	if documentID == "" {
		return Document{}, ErrInvalidDocumentID
	}
	if input.BaseVersion <= 0 {
		return Document{}, ErrInvalidBaseVersion
	}
	if input.SchemaVersion <= 0 {
		return Document{}, ErrInvalidSchemaVersion
	}
	if input.ContentJSON == nil {
		return Document{}, ErrInvalidDocumentContentJSON
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Document{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Document{}, err
	}

	current, err := s.getDocumentTx(ctx, tx, input.WorkspaceID, documentID, true)
	if err != nil {
		return Document{}, err
	}
	if current.DeletedAt != nil {
		return Document{}, ErrDocumentAlreadyDeleted
	}
	if current.Version != input.BaseVersion {
		return Document{}, &VersionConflictError{
			ServerVersion: current.Version,
			ServerEntity:  current,
		}
	}

	item, err := s.updateDocumentContentTx(ctx, tx, input.WorkspaceID, documentID, input.SchemaVersion, input.ContentJSON)
	if err != nil {
		return Document{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeDocument,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeUpdated,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Document{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Document{}, fmt.Errorf("commit save document content: %w", err)
	}

	return item, nil
}

func (s *Service) requireCard(ctx context.Context, workspaceID string, cardID string) error {
	return s.requireCardTx(ctx, s.pool, workspaceID, cardID, false)
}

func (s *Service) requireCardTx(ctx context.Context, q queryRower, workspaceID string, cardID string, allowDeleted bool) error {
	var deletedAt *time.Time
	err := q.QueryRow(
		ctx,
		`SELECT deleted_at
		 FROM cards
		 WHERE workspace_id = $1
		   AND id = $2`,
		workspaceID,
		cardID,
	).Scan(&deletedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCardNotFound
		}
		return fmt.Errorf("select card: %w", err)
	}
	if deletedAt != nil && !allowDeleted {
		return ErrCardDeleted
	}
	return nil
}

func (s *Service) requireParentDocumentTx(ctx context.Context, q queryRower, workspaceID string, cardID string, documentID string, allowDeleted bool) error {
	var (
		parentCardID string
		deletedAt    *time.Time
	)

	err := q.QueryRow(
		ctx,
		`SELECT card_id, deleted_at
		 FROM documents
		 WHERE workspace_id = $1
		   AND id = $2`,
		workspaceID,
		documentID,
	).Scan(&parentCardID, &deletedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrParentDocumentNotFound
		}
		return fmt.Errorf("select parent document: %w", err)
	}
	if deletedAt != nil && !allowDeleted {
		return ErrParentDocumentDeleted
	}
	if parentCardID != cardID {
		return ErrParentDocumentCardMismatch
	}
	return nil
}

func (s *Service) validateParentDocumentChangeTx(ctx context.Context, tx pgx.Tx, workspaceID string, cardID string, documentID string, parentDocumentID *string) error {
	if parentDocumentID == nil {
		return nil
	}
	if *parentDocumentID == documentID {
		return ErrDocumentCycleDetected
	}
	if err := s.requireParentDocumentTx(ctx, tx, workspaceID, cardID, *parentDocumentID, false); err != nil {
		return err
	}
	return s.ensureDocumentNoCycleTx(ctx, tx, workspaceID, documentID, *parentDocumentID)
}

func (s *Service) ensureDocumentNoCycleTx(ctx context.Context, tx pgx.Tx, workspaceID string, documentID string, parentDocumentID string) error {
	currentParentID := &parentDocumentID
	for currentParentID != nil {
		if *currentParentID == documentID {
			return ErrDocumentCycleDetected
		}

		var nextParentID *string
		err := tx.QueryRow(
			ctx,
			`SELECT parent_document_id
			 FROM documents
			 WHERE workspace_id = $1
			   AND id = $2`,
			workspaceID,
			*currentParentID,
		).Scan(&nextParentID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrParentDocumentNotFound
			}
			return fmt.Errorf("select parent document chain: %w", err)
		}
		currentParentID = nextParentID
	}
	return nil
}

func (s *Service) insertDocumentTx(ctx context.Context, tx pgx.Tx, workspaceID string, documentID string, cardID string, documentType string, title string, parentDocumentID *string, sortOrder int32) (Document, error) {
	trimmedDocumentID := strings.TrimSpace(documentID)
	if trimmedDocumentID == "" {
		trimmedDocumentID = uuid.NewString()
	}
	fileName := trimmedDocumentID + ".json"
	item, err := scanDocument(tx.QueryRow(
		ctx,
		`INSERT INTO documents (
		   id,
		   workspace_id,
		   card_id,
		   type,
		   title,
		   file_name,
		   parent_document_id,
		   sort_order,
		   schema_version,
		   content_json,
		   meta_json
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, '{}'::jsonb, '{}'::jsonb)
		 RETURNING id, workspace_id, card_id, type, title, file_name, parent_document_id, sort_order, schema_version, content_json, meta_json, version, created_at, updated_at, deleted_at`,
		trimmedDocumentID,
		workspaceID,
		cardID,
		documentType,
		title,
		fileName,
		parentDocumentID,
		sortOrder,
	))
	if err != nil {
		return Document{}, fmt.Errorf("insert document: %w", err)
	}
	return item, nil
}

func (s *Service) getDocument(ctx context.Context, workspaceID string, documentID string) (Document, error) {
	return s.getDocumentTx(ctx, s.pool, workspaceID, documentID, false)
}

func (s *Service) getDocumentTx(ctx context.Context, q queryRower, workspaceID string, documentID string, forUpdate bool) (Document, error) {
	query := `SELECT id, workspace_id, card_id, type, title, file_name, parent_document_id, sort_order, schema_version, content_json, meta_json, version, created_at, updated_at, deleted_at
		  FROM documents
		  WHERE workspace_id = $1
		    AND id = $2`
	if forUpdate {
		query += ` FOR UPDATE`
	}

	item, err := scanDocument(q.QueryRow(ctx, query, workspaceID, documentID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Document{}, ErrDocumentNotFound
		}
		return Document{}, fmt.Errorf("select document: %w", err)
	}
	return item, nil
}

func (s *Service) updateDocumentTx(ctx context.Context, tx pgx.Tx, workspaceID string, documentID string, title string, parentDocumentID *string, sortOrder int32) (Document, error) {
	item, err := scanDocument(tx.QueryRow(
		ctx,
		`UPDATE documents
		 SET title = $3,
		     parent_document_id = $4,
		     sort_order = $5,
		     version = version + 1
		 WHERE workspace_id = $1
		   AND id = $2
		 RETURNING id, workspace_id, card_id, type, title, file_name, parent_document_id, sort_order, schema_version, content_json, meta_json, version, created_at, updated_at, deleted_at`,
		workspaceID,
		documentID,
		title,
		parentDocumentID,
		sortOrder,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Document{}, ErrDocumentNotFound
		}
		return Document{}, fmt.Errorf("update document: %w", err)
	}
	return item, nil
}

func (s *Service) updateDocumentDeletedAtTx(ctx context.Context, tx pgx.Tx, workspaceID string, documentID string, deleted bool) (Document, error) {
	query := `UPDATE documents
	          SET deleted_at = NULL,
	              version = version + 1
	          WHERE workspace_id = $1
	            AND id = $2
	          RETURNING id, workspace_id, card_id, type, title, file_name, parent_document_id, sort_order, schema_version, content_json, meta_json, version, created_at, updated_at, deleted_at`
	if deleted {
		query = `UPDATE documents
		         SET deleted_at = NOW(),
		             version = version + 1
		         WHERE workspace_id = $1
		           AND id = $2
		         RETURNING id, workspace_id, card_id, type, title, file_name, parent_document_id, sort_order, schema_version, content_json, meta_json, version, created_at, updated_at, deleted_at`
	}

	item, err := scanDocument(tx.QueryRow(ctx, query, workspaceID, documentID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Document{}, ErrDocumentNotFound
		}
		return Document{}, fmt.Errorf("update document deleted state: %w", err)
	}
	return item, nil
}

func (s *Service) updateDocumentContentTx(ctx context.Context, tx pgx.Tx, workspaceID string, documentID string, schemaVersion int32, contentJSON map[string]any) (Document, error) {
	payloadJSON, err := json.Marshal(contentJSON)
	if err != nil {
		return Document{}, fmt.Errorf("marshal document content: %w", err)
	}

	item, err := scanDocument(tx.QueryRow(
		ctx,
		`UPDATE documents
		 SET schema_version = $3,
		     content_json = $4::jsonb,
		     version = version + 1
		 WHERE workspace_id = $1
		   AND id = $2
		 RETURNING id, workspace_id, card_id, type, title, file_name, parent_document_id, sort_order, schema_version, content_json, meta_json, version, created_at, updated_at, deleted_at`,
		workspaceID,
		documentID,
		schemaVersion,
		string(payloadJSON),
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Document{}, ErrDocumentNotFound
		}
		return Document{}, fmt.Errorf("update document content: %w", err)
	}
	return item, nil
}

type scanner interface {
	Scan(dest ...any) error
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func scanDocument(row scanner) (Document, error) {
	var (
		item        Document
		contentJSON []byte
		metaJSON    []byte
		createdAt   time.Time
		updatedAt   time.Time
		deletedAt   *time.Time
	)

	if err := row.Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.CardID,
		&item.Type,
		&item.Title,
		&item.FileName,
		&item.ParentDocumentID,
		&item.SortOrder,
		&item.SchemaVersion,
		&contentJSON,
		&metaJSON,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	); err != nil {
		return Document{}, err
	}

	item.ContentJSON = decodeJSONObject(contentJSON)
	item.MetaJSON = decodeJSONObject(metaJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, nil
}

func normalizeParentDocumentID(parentDocumentID *string) (*string, error) {
	if parentDocumentID == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*parentDocumentID)
	if trimmed == "" {
		return nil, ErrInvalidParentDocumentID
	}
	return &trimmed, nil
}

func isSupportedDocumentType(value string) bool {
	switch value {
	case documentTypeSmart, documentTypeMindMap, documentTypeFlowchart:
		return true
	default:
		return false
	}
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
