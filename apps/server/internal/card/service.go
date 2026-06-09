package card

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

const defaultCardStatus = "active"

type Service struct {
	pool        *pgxpool.Pool
	eventWriter *syncapi.EventWriter
}

type CreateInput struct {
	UserID      string
	WorkspaceID string
	CardID      string
	KBID        string
	ParentID    *string
	Name        string
	SortOrder   int32
	Status      string
	MetaJSON    map[string]any
}

type ListInput struct {
	UserID      string
	WorkspaceID string
	KBID        string
	ParentID    *string
}

type GetInput struct {
	UserID      string
	WorkspaceID string
	CardID      string
}

type UpdateInput struct {
	UserID      string
	WorkspaceID string
	CardID      string
	Name        *string
	SortOrder   *int32
	Status      *string
	MetaJSON    *map[string]any
}

type DeleteInput struct {
	UserID      string
	WorkspaceID string
	CardID      string
}

type Card struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspaceId"`
	KBID        string         `json:"kbId"`
	ParentID    *string        `json:"parentId"`
	Name        string         `json:"name"`
	SortOrder   int32          `json:"sortOrder"`
	Status      string         `json:"status"`
	MetaJSON    map[string]any `json:"metaJson"`
	Version     int64          `json:"version"`
	CreatedAt   string         `json:"createdAt"`
	UpdatedAt   string         `json:"updatedAt"`
	DeletedAt   *string        `json:"deletedAt"`
}

func NewService(pool *pgxpool.Pool, eventWriter *syncapi.EventWriter) *Service {
	return &Service{
		pool:        pool,
		eventWriter: eventWriter,
	}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Card, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Card{}, ErrInvalidCardName
	}

	kbID := strings.TrimSpace(input.KBID)
	if kbID == "" {
		return Card{}, ErrInvalidKnowledgeBaseID
	}

	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = defaultCardStatus
	}

	parentID, err := normalizeParentID(input.ParentID)
	if err != nil {
		return Card{}, err
	}

	metaJSON, err := json.Marshal(normalizeJSONObject(input.MetaJSON))
	if err != nil {
		return Card{}, fmt.Errorf("marshal card meta json: %w", err)
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Card{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Card{}, err
	}

	if err := s.requireKnowledgeBaseTx(ctx, tx, input.WorkspaceID, kbID, true); err != nil {
		return Card{}, err
	}

	if parentID != nil {
		if err := s.requireParentCardTx(ctx, tx, input.WorkspaceID, kbID, *parentID, false); err != nil {
			return Card{}, err
		}
	}

	item, err := s.insertCardTx(ctx, tx, input.WorkspaceID, input.CardID, kbID, parentID, name, input.SortOrder, status, string(metaJSON))
	if err != nil {
		return Card{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeCard,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeCreated,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Card{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Card{}, fmt.Errorf("commit create card: %w", err)
	}

	return item, nil
}

func (s *Service) List(ctx context.Context, input ListInput) ([]Card, error) {
	kbID := strings.TrimSpace(input.KBID)
	if kbID == "" {
		return nil, ErrInvalidKnowledgeBaseID
	}

	parentID, err := normalizeListParentID(input.ParentID)
	if err != nil {
		return nil, err
	}

	if _, err := workspace.RequireMember(ctx, s.pool, input.WorkspaceID, input.UserID); err != nil {
		return nil, err
	}
	if err := s.requireKnowledgeBase(ctx, input.WorkspaceID, kbID); err != nil {
		return nil, err
	}

	var (
		rows pgx.Rows
	)
	if parentID == nil {
		rows, err = s.pool.Query(
			ctx,
			`SELECT id, workspace_id, kb_id, parent_id, name, sort_order, status, meta_json, version, created_at, updated_at, deleted_at
			 FROM cards
			 WHERE workspace_id = $1
			   AND kb_id = $2
			   AND parent_id IS NULL
			 ORDER BY sort_order ASC, updated_at DESC, id ASC`,
			input.WorkspaceID,
			kbID,
		)
	} else {
		rows, err = s.pool.Query(
			ctx,
			`SELECT id, workspace_id, kb_id, parent_id, name, sort_order, status, meta_json, version, created_at, updated_at, deleted_at
			 FROM cards
			 WHERE workspace_id = $1
			   AND kb_id = $2
			   AND parent_id = $3
			 ORDER BY sort_order ASC, updated_at DESC, id ASC`,
			input.WorkspaceID,
			kbID,
			*parentID,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("list cards: %w", err)
	}
	defer rows.Close()

	items := make([]Card, 0)
	for rows.Next() {
		item, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Get(ctx context.Context, input GetInput) (Card, error) {
	cardID := strings.TrimSpace(input.CardID)
	if cardID == "" {
		return Card{}, ErrInvalidCardID
	}

	if _, err := workspace.RequireMember(ctx, s.pool, input.WorkspaceID, input.UserID); err != nil {
		return Card{}, err
	}

	return s.getCard(ctx, input.WorkspaceID, cardID)
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Card, error) {
	cardID := strings.TrimSpace(input.CardID)
	if cardID == "" {
		return Card{}, ErrInvalidCardID
	}
	if input.Name == nil && input.SortOrder == nil && input.Status == nil && input.MetaJSON == nil {
		return Card{}, ErrNoCardChanges
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Card{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Card{}, err
	}

	current, err := s.getCardTx(ctx, tx, input.WorkspaceID, cardID, true)
	if err != nil {
		return Card{}, err
	}
	if current.DeletedAt != nil {
		return Card{}, ErrCardAlreadyDeleted
	}

	nextName := current.Name
	if input.Name != nil {
		nextName = strings.TrimSpace(*input.Name)
		if nextName == "" {
			return Card{}, ErrInvalidCardName
		}
	}

	nextSortOrder := current.SortOrder
	if input.SortOrder != nil {
		nextSortOrder = *input.SortOrder
	}

	nextStatus := current.Status
	if input.Status != nil {
		nextStatus = strings.TrimSpace(*input.Status)
		if nextStatus == "" {
			return Card{}, ErrInvalidCardStatus
		}
	}

	nextMeta := current.MetaJSON
	if input.MetaJSON != nil {
		nextMeta = normalizeJSONObject(*input.MetaJSON)
	}
	metaJSON, err := json.Marshal(normalizeJSONObject(nextMeta))
	if err != nil {
		return Card{}, fmt.Errorf("marshal updated card meta json: %w", err)
	}

	item, err := s.updateCardTx(ctx, tx, input.WorkspaceID, cardID, nextName, nextSortOrder, nextStatus, string(metaJSON), current.ParentID, current.KBID, current.DeletedAt)
	if err != nil {
		return Card{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeCard,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeUpdated,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Card{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Card{}, fmt.Errorf("commit update card: %w", err)
	}

	return item, nil
}

func (s *Service) Delete(ctx context.Context, input DeleteInput) (Card, error) {
	cardID := strings.TrimSpace(input.CardID)
	if cardID == "" {
		return Card{}, ErrInvalidCardID
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Card{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Card{}, err
	}

	current, err := s.getCardTx(ctx, tx, input.WorkspaceID, cardID, true)
	if err != nil {
		return Card{}, err
	}
	if current.DeletedAt != nil {
		return Card{}, ErrCardAlreadyDeleted
	}

	item, err := s.updateCardDeletedAtTx(ctx, tx, input.WorkspaceID, cardID, true)
	if err != nil {
		return Card{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeCard,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeDeleted,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Card{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Card{}, fmt.Errorf("commit delete card: %w", err)
	}

	return item, nil
}

func (s *Service) Restore(ctx context.Context, input DeleteInput) (Card, error) {
	cardID := strings.TrimSpace(input.CardID)
	if cardID == "" {
		return Card{}, ErrInvalidCardID
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Card{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Card{}, err
	}

	current, err := s.getCardTx(ctx, tx, input.WorkspaceID, cardID, true)
	if err != nil {
		return Card{}, err
	}
	if current.DeletedAt == nil {
		return Card{}, ErrCardNotDeleted
	}

	if err := s.requireKnowledgeBaseTx(ctx, tx, input.WorkspaceID, current.KBID, true); err != nil {
		return Card{}, err
	}
	if current.ParentID != nil {
		if err := s.requireParentCardTx(ctx, tx, input.WorkspaceID, current.KBID, *current.ParentID, false); err != nil {
			return Card{}, err
		}
	}

	item, err := s.updateCardDeletedAtTx(ctx, tx, input.WorkspaceID, cardID, false)
	if err != nil {
		return Card{}, err
	}

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeCard,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeRestored,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Card{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Card{}, fmt.Errorf("commit restore card: %w", err)
	}

	return item, nil
}

func (s *Service) Purge(ctx context.Context, input DeleteInput) (Card, error) {
	cardID := strings.TrimSpace(input.CardID)
	if cardID == "" {
		return Card{}, ErrInvalidCardID
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Card{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Card{}, err
	}

	current, err := s.getCardTx(ctx, tx, input.WorkspaceID, cardID, true)
	if err != nil {
		return Card{}, err
	}
	if current.DeletedAt == nil {
		return Card{}, ErrCardNotDeleted
	}

	if err := s.ensureCardCanPurgeTx(ctx, tx, input.WorkspaceID, cardID); err != nil {
		return Card{}, err
	}

	purged := current
	purged.Version = current.Version + 1

	if _, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   purged.WorkspaceID,
		EntityType:    syncapi.EntityTypeCard,
		EntityID:      purged.ID,
		EventType:     syncapi.EventTypePurged,
		EntityVersion: purged.Version,
		Snapshot:      purged,
		ActorUserID:   input.UserID,
	}); err != nil {
		return Card{}, err
	}

	commandTag, err := tx.Exec(
		ctx,
		`DELETE FROM cards
		 WHERE workspace_id = $1
		   AND id = $2`,
		input.WorkspaceID,
		cardID,
	)
	if err != nil {
		return Card{}, fmt.Errorf("purge card: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return Card{}, ErrCardNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return Card{}, fmt.Errorf("commit purge card: %w", err)
	}

	return purged, nil
}

func (s *Service) requireKnowledgeBase(ctx context.Context, workspaceID string, kbID string) error {
	return s.requireKnowledgeBaseTx(ctx, s.pool, workspaceID, kbID, false)
}

func (s *Service) requireKnowledgeBaseTx(ctx context.Context, q queryRower, workspaceID string, kbID string, allowDeleted bool) error {
	var deletedAt *time.Time
	err := q.QueryRow(
		ctx,
		`SELECT deleted_at
		 FROM knowledge_bases
		 WHERE workspace_id = $1
		   AND id = $2`,
		workspaceID,
		kbID,
	).Scan(&deletedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrKnowledgeBaseNotFound
		}
		return fmt.Errorf("select knowledge base: %w", err)
	}
	if deletedAt != nil && !allowDeleted {
		return ErrKnowledgeBaseDeleted
	}
	return nil
}

func (s *Service) requireParentCardTx(ctx context.Context, q queryRower, workspaceID string, kbID string, parentID string, allowDeleted bool) error {
	var (
		parentKBID string
		deletedAt  *time.Time
	)

	err := q.QueryRow(
		ctx,
		`SELECT kb_id, deleted_at
		 FROM cards
		 WHERE workspace_id = $1
		   AND id = $2`,
		workspaceID,
		parentID,
	).Scan(&parentKBID, &deletedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrParentCardNotFound
		}
		return fmt.Errorf("select parent card: %w", err)
	}
	if deletedAt != nil && !allowDeleted {
		return ErrParentCardDeleted
	}
	if parentKBID != kbID {
		return ErrParentCardKnowledgeBaseMismatch
	}
	return nil
}

func (s *Service) ensureCardCanPurgeTx(ctx context.Context, tx pgx.Tx, workspaceID string, cardID string) error {
	var childCount int
	if err := tx.QueryRow(
		ctx,
		`SELECT COUNT(1)
		 FROM cards
		 WHERE workspace_id = $1
		   AND parent_id = $2`,
		workspaceID,
		cardID,
	).Scan(&childCount); err != nil {
		return fmt.Errorf("count child cards: %w", err)
	}
	if childCount > 0 {
		return ErrCardHasChildren
	}

	var documentCount int
	if err := tx.QueryRow(
		ctx,
		`SELECT COUNT(1)
		 FROM documents
		 WHERE workspace_id = $1
		   AND card_id = $2`,
		workspaceID,
		cardID,
	).Scan(&documentCount); err != nil {
		return fmt.Errorf("count card documents: %w", err)
	}
	if documentCount > 0 {
		return ErrCardHasDocuments
	}

	var attachmentCount int
	if err := tx.QueryRow(
		ctx,
		`SELECT COUNT(1)
		 FROM attachments
		 WHERE workspace_id = $1
		   AND card_id = $2`,
		workspaceID,
		cardID,
	).Scan(&attachmentCount); err != nil {
		return fmt.Errorf("count card attachments: %w", err)
	}
	if attachmentCount > 0 {
		return ErrCardHasAttachments
	}

	return nil
}

func (s *Service) getCard(ctx context.Context, workspaceID string, cardID string) (Card, error) {
	return s.getCardTx(ctx, s.pool, workspaceID, cardID, false)
}

func (s *Service) getCardTx(ctx context.Context, q queryRower, workspaceID string, cardID string, forUpdate bool) (Card, error) {
	query := `SELECT id, workspace_id, kb_id, parent_id, name, sort_order, status, meta_json, version, created_at, updated_at, deleted_at
		  FROM cards
		  WHERE workspace_id = $1
		    AND id = $2`
	if forUpdate {
		query += ` FOR UPDATE`
	}

	item, err := scanCard(q.QueryRow(ctx, query, workspaceID, cardID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Card{}, ErrCardNotFound
		}
		return Card{}, fmt.Errorf("select card: %w", err)
	}
	return item, nil
}

func (s *Service) insertCardTx(ctx context.Context, tx pgx.Tx, workspaceID string, cardID string, kbID string, parentID *string, name string, sortOrder int32, status string, metaJSON string) (Card, error) {
	query := `INSERT INTO cards (
		   workspace_id,
		   kb_id,
		   parent_id,
		   name,
		   sort_order,
		   status,
		   meta_json
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
		 RETURNING id, workspace_id, kb_id, parent_id, name, sort_order, status, meta_json, version, created_at, updated_at, deleted_at`
	args := []any{workspaceID, kbID, parentID, name, sortOrder, status, metaJSON}
	if trimmedCardID := strings.TrimSpace(cardID); trimmedCardID != "" {
		query = `INSERT INTO cards (
		   id,
		   workspace_id,
		   kb_id,
		   parent_id,
		   name,
		   sort_order,
		   status,
		   meta_json
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
		 RETURNING id, workspace_id, kb_id, parent_id, name, sort_order, status, meta_json, version, created_at, updated_at, deleted_at`
		args = []any{trimmedCardID, workspaceID, kbID, parentID, name, sortOrder, status, metaJSON}
	}

	item, err := scanCard(tx.QueryRow(ctx, query, args...))
	if err != nil {
		return Card{}, fmt.Errorf("insert card: %w", err)
	}
	return item, nil
}

func (s *Service) updateCardTx(ctx context.Context, tx pgx.Tx, workspaceID string, cardID string, name string, sortOrder int32, status string, metaJSON string, parentID *string, kbID string, deletedAt *string) (Card, error) {
	item, err := scanCard(tx.QueryRow(
		ctx,
		`UPDATE cards
		 SET name = $3,
		     sort_order = $4,
		     status = $5,
		     meta_json = $6::jsonb,
		     version = version + 1
		 WHERE workspace_id = $1
		   AND id = $2
		 RETURNING id, workspace_id, kb_id, parent_id, name, sort_order, status, meta_json, version, created_at, updated_at, deleted_at`,
		workspaceID,
		cardID,
		name,
		sortOrder,
		status,
		metaJSON,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Card{}, ErrCardNotFound
		}
		return Card{}, fmt.Errorf("update card: %w", err)
	}
	item.ParentID = parentID
	item.KBID = kbID
	item.DeletedAt = deletedAt
	return item, nil
}

func (s *Service) updateCardDeletedAtTx(ctx context.Context, tx pgx.Tx, workspaceID string, cardID string, deleted bool) (Card, error) {
	query := `UPDATE cards
	          SET deleted_at = NULL,
	              version = version + 1
	          WHERE workspace_id = $1
	            AND id = $2
	          RETURNING id, workspace_id, kb_id, parent_id, name, sort_order, status, meta_json, version, created_at, updated_at, deleted_at`
	if deleted {
		query = `UPDATE cards
		         SET deleted_at = NOW(),
		             version = version + 1
		         WHERE workspace_id = $1
		           AND id = $2
		         RETURNING id, workspace_id, kb_id, parent_id, name, sort_order, status, meta_json, version, created_at, updated_at, deleted_at`
	}

	item, err := scanCard(tx.QueryRow(ctx, query, workspaceID, cardID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Card{}, ErrCardNotFound
		}
		return Card{}, fmt.Errorf("update card deleted state: %w", err)
	}
	return item, nil
}

type scanner interface {
	Scan(dest ...any) error
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func scanCard(row scanner) (Card, error) {
	var (
		item      Card
		rawMeta   []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)
	if err := row.Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.KBID,
		&item.ParentID,
		&item.Name,
		&item.SortOrder,
		&item.Status,
		&rawMeta,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	); err != nil {
		return Card{}, err
	}
	item.MetaJSON = decodeJSONObject(rawMeta)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, nil
}

func normalizeParentID(parentID *string) (*string, error) {
	if parentID == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*parentID)
	if trimmed == "" {
		return nil, ErrInvalidParentCardID
	}
	return &trimmed, nil
}

func normalizeListParentID(parentID *string) (*string, error) {
	if parentID == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*parentID)
	if trimmed == "" {
		return nil, nil
	}
	return &trimmed, nil
}

func normalizeJSONObject(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
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
