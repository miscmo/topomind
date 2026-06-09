package graphlayout

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	syncapi "topomind/apps/server/internal/sync"
	"topomind/apps/server/internal/workspace"
)

type Service struct {
	pool        *pgxpool.Pool
	eventWriter *syncapi.EventWriter
}

type GetInput struct {
	UserID      string
	WorkspaceID string
	LayoutID    string
}

type SaveInput struct {
	UserID       string
	WorkspaceID  string
	LayoutID     string
	KBID         string
	RoomCardID   *string
	BaseVersion  int64
	LayoutJSON   map[string]any
	ViewportJSON map[string]any
}

type PatchInput struct {
	UserID      string
	WorkspaceID string
	LayoutID    string
	KBID        string
	RoomCardID  *string
	BaseVersion int64
	NodePatches map[string]any
	Viewport    map[string]any
}

type GraphLayout struct {
	ID           string         `json:"id"`
	WorkspaceID  string         `json:"workspaceId"`
	KBID         string         `json:"kbId"`
	RoomCardID   *string        `json:"roomCardId"`
	LayoutJSON   map[string]any `json:"layoutJson"`
	ViewportJSON map[string]any `json:"viewportJson"`
	Version      int64          `json:"version"`
	UpdatedBy    *string        `json:"updatedBy"`
	CreatedAt    string         `json:"createdAt"`
	UpdatedAt    string         `json:"updatedAt"`
}

func NewService(pool *pgxpool.Pool, eventWriter *syncapi.EventWriter) *Service {
	return &Service{
		pool:        pool,
		eventWriter: eventWriter,
	}
}

func (s *Service) Get(ctx context.Context, input GetInput) (GraphLayout, error) {
	layoutID := strings.TrimSpace(input.LayoutID)
	if layoutID == "" {
		return GraphLayout{}, ErrInvalidGraphLayoutID
	}
	if _, err := workspace.RequireMember(ctx, s.pool, input.WorkspaceID, input.UserID); err != nil {
		return GraphLayout{}, err
	}
	return s.getGraphLayout(ctx, input.WorkspaceID, layoutID)
}

func (s *Service) Save(ctx context.Context, input SaveInput) (GraphLayout, error) {
	layoutID, kbID, roomCardID, err := normalizeScope(input.LayoutID, input.KBID, input.RoomCardID)
	if err != nil {
		return GraphLayout{}, err
	}
	if input.BaseVersion < 0 {
		return GraphLayout{}, ErrInvalidBaseVersion
	}
	if input.LayoutJSON == nil {
		return GraphLayout{}, ErrInvalidLayoutJSON
	}
	if input.ViewportJSON == nil {
		return GraphLayout{}, ErrInvalidViewportJSON
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return GraphLayout{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return GraphLayout{}, err
	}
	if err := s.requireKnowledgeBaseTx(ctx, tx, input.WorkspaceID, kbID); err != nil {
		return GraphLayout{}, err
	}
	if err := s.requireRoomCardTx(ctx, tx, input.WorkspaceID, kbID, roomCardID); err != nil {
		return GraphLayout{}, err
	}

	current, exists, err := s.resolveCurrentTx(ctx, tx, input.WorkspaceID, layoutID, kbID, roomCardID)
	if err != nil {
		return GraphLayout{}, err
	}
	if exists {
		if current.KBID != kbID || stringPtrValue(current.RoomCardID) != stringPtrValue(roomCardID) {
			return GraphLayout{}, ErrGraphLayoutScopeMismatch
		}
		if current.Version != input.BaseVersion {
			return GraphLayout{}, &VersionConflictError{
				ServerVersion: current.Version,
				ServerEntity:  current,
			}
		}
		item, err := s.updateGraphLayoutTx(ctx, tx, input.WorkspaceID, current.ID, input.UserID, input.LayoutJSON, input.ViewportJSON)
		if err != nil {
			return GraphLayout{}, err
		}
		if err := s.writeEventTx(ctx, tx, item, syncapi.EventTypeUpdated, input.UserID); err != nil {
			return GraphLayout{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return GraphLayout{}, fmt.Errorf("commit save graph layout: %w", err)
		}
		return item, nil
	}

	if input.BaseVersion != 0 {
		return GraphLayout{}, ErrGraphLayoutNotFound
	}

	item, err := s.insertGraphLayoutTx(ctx, tx, layoutID, input.WorkspaceID, kbID, roomCardID, input.UserID, input.LayoutJSON, input.ViewportJSON)
	if err != nil {
		return GraphLayout{}, err
	}
	if err := s.writeEventTx(ctx, tx, item, syncapi.EventTypeCreated, input.UserID); err != nil {
		return GraphLayout{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return GraphLayout{}, fmt.Errorf("commit create graph layout: %w", err)
	}
	return item, nil
}

func (s *Service) Patch(ctx context.Context, input PatchInput) (GraphLayout, error) {
	layoutID, kbID, roomCardID, err := normalizeScope(input.LayoutID, input.KBID, input.RoomCardID)
	if err != nil {
		return GraphLayout{}, err
	}
	if input.BaseVersion < 0 {
		return GraphLayout{}, ErrInvalidBaseVersion
	}
	if input.NodePatches == nil && input.Viewport == nil {
		return GraphLayout{}, ErrNoGraphLayoutChanges
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return GraphLayout{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return GraphLayout{}, err
	}
	if err := s.requireKnowledgeBaseTx(ctx, tx, input.WorkspaceID, kbID); err != nil {
		return GraphLayout{}, err
	}
	if err := s.requireRoomCardTx(ctx, tx, input.WorkspaceID, kbID, roomCardID); err != nil {
		return GraphLayout{}, err
	}

	current, exists, err := s.resolveCurrentTx(ctx, tx, input.WorkspaceID, layoutID, kbID, roomCardID)
	if err != nil {
		return GraphLayout{}, err
	}

	baseLayout := map[string]any{}
	baseViewport := map[string]any{}
	eventType := syncapi.EventTypeCreated
	targetID := layoutID
	if exists {
		if current.KBID != kbID || stringPtrValue(current.RoomCardID) != stringPtrValue(roomCardID) {
			return GraphLayout{}, ErrGraphLayoutScopeMismatch
		}
		if current.Version != input.BaseVersion {
			return GraphLayout{}, &VersionConflictError{
				ServerVersion: current.Version,
				ServerEntity:  current,
			}
		}
		baseLayout = cloneJSONObject(current.LayoutJSON)
		baseViewport = cloneJSONObject(current.ViewportJSON)
		targetID = current.ID
		eventType = syncapi.EventTypeUpdated
	} else if input.BaseVersion != 0 {
		return GraphLayout{}, ErrGraphLayoutNotFound
	}

	nextLayout, err := applyNodePatches(baseLayout, input.NodePatches)
	if err != nil {
		return GraphLayout{}, err
	}
	nextViewport, err := applyViewportPatch(baseViewport, input.Viewport)
	if err != nil {
		return GraphLayout{}, err
	}

	var item GraphLayout
	if exists {
		item, err = s.updateGraphLayoutTx(ctx, tx, input.WorkspaceID, targetID, input.UserID, nextLayout, nextViewport)
	} else {
		item, err = s.insertGraphLayoutTx(ctx, tx, targetID, input.WorkspaceID, kbID, roomCardID, input.UserID, nextLayout, nextViewport)
	}
	if err != nil {
		return GraphLayout{}, err
	}
	if err := s.writeEventTx(ctx, tx, item, eventType, input.UserID); err != nil {
		return GraphLayout{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return GraphLayout{}, fmt.Errorf("commit patch graph layout: %w", err)
	}
	return item, nil
}

func (s *Service) writeEventTx(ctx context.Context, tx pgx.Tx, item GraphLayout, eventType syncapi.EventType, userID string) error {
	_, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeGraphLayout,
		EntityID:      item.ID,
		EventType:     eventType,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   userID,
	})
	return err
}

func normalizeScope(layoutID string, kbID string, roomCardID *string) (string, string, *string, error) {
	trimmedLayoutID := strings.TrimSpace(layoutID)
	if trimmedLayoutID == "" {
		return "", "", nil, ErrInvalidGraphLayoutID
	}
	trimmedKBID := strings.TrimSpace(kbID)
	if trimmedKBID == "" {
		return "", "", nil, ErrInvalidKnowledgeBaseID
	}
	normalizedRoomCardID, err := normalizeOptionalID(roomCardID, ErrInvalidRoomCardID)
	if err != nil {
		return "", "", nil, err
	}
	return trimmedLayoutID, trimmedKBID, normalizedRoomCardID, nil
}

func normalizeOptionalID(value *string, invalidErr error) (*string, error) {
	if value == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil, invalidErr
	}
	return &trimmed, nil
}

func (s *Service) resolveCurrentTx(ctx context.Context, tx pgx.Tx, workspaceID string, layoutID string, kbID string, roomCardID *string) (GraphLayout, bool, error) {
	current, err := s.getGraphLayoutTx(ctx, tx, workspaceID, layoutID, true)
	if err == nil {
		return current, true, nil
	}
	if !errors.Is(err, ErrGraphLayoutNotFound) {
		return GraphLayout{}, false, err
	}

	current, err = s.getGraphLayoutByScopeTx(ctx, tx, workspaceID, kbID, roomCardID, true)
	if err == nil {
		return current, true, nil
	}
	if errors.Is(err, ErrGraphLayoutNotFound) {
		return GraphLayout{}, false, nil
	}
	return GraphLayout{}, false, err
}

func (s *Service) getGraphLayout(ctx context.Context, workspaceID string, layoutID string) (GraphLayout, error) {
	return s.getGraphLayoutTx(ctx, s.pool, workspaceID, layoutID, false)
}

func (s *Service) getGraphLayoutTx(ctx context.Context, q queryRower, workspaceID string, layoutID string, forUpdate bool) (GraphLayout, error) {
	query := `SELECT id, workspace_id, kb_id, room_card_id, layout_json, viewport_json, version, updated_by, created_at, updated_at
		  FROM graph_layouts
		  WHERE workspace_id = $1
		    AND id = $2`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	item, err := scanGraphLayout(q.QueryRow(ctx, query, workspaceID, layoutID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return GraphLayout{}, ErrGraphLayoutNotFound
		}
		return GraphLayout{}, fmt.Errorf("select graph layout: %w", err)
	}
	return item, nil
}

func (s *Service) getGraphLayoutByScopeTx(ctx context.Context, q queryRower, workspaceID string, kbID string, roomCardID *string, forUpdate bool) (GraphLayout, error) {
	query := `SELECT id, workspace_id, kb_id, room_card_id, layout_json, viewport_json, version, updated_by, created_at, updated_at
		  FROM graph_layouts
		  WHERE workspace_id = $1
		    AND kb_id = $2
		    AND (
		      ($3::uuid IS NULL AND room_card_id IS NULL)
		      OR room_card_id = $3::uuid
		    )`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	item, err := scanGraphLayout(q.QueryRow(ctx, query, workspaceID, kbID, stringPtrValueOrNil(roomCardID)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return GraphLayout{}, ErrGraphLayoutNotFound
		}
		return GraphLayout{}, fmt.Errorf("select graph layout by scope: %w", err)
	}
	return item, nil
}

func (s *Service) insertGraphLayoutTx(ctx context.Context, tx pgx.Tx, layoutID string, workspaceID string, kbID string, roomCardID *string, userID string, layoutJSON map[string]any, viewportJSON map[string]any) (GraphLayout, error) {
	layoutPayload, err := json.Marshal(layoutJSON)
	if err != nil {
		return GraphLayout{}, fmt.Errorf("marshal graph layout json: %w", err)
	}
	viewportPayload, err := json.Marshal(viewportJSON)
	if err != nil {
		return GraphLayout{}, fmt.Errorf("marshal graph viewport json: %w", err)
	}

	item, err := scanGraphLayout(tx.QueryRow(
		ctx,
		`INSERT INTO graph_layouts (
		   id,
		   workspace_id,
		   kb_id,
		   room_card_id,
		   layout_json,
		   viewport_json,
		   updated_by
		 )
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NULLIF($7, '')::uuid)
		 RETURNING id, workspace_id, kb_id, room_card_id, layout_json, viewport_json, version, updated_by, created_at, updated_at`,
		layoutID,
		workspaceID,
		kbID,
		stringPtrValueOrNil(roomCardID),
		string(layoutPayload),
		string(viewportPayload),
		userID,
	))
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return GraphLayout{}, ErrGraphLayoutScopeMismatch
		}
		return GraphLayout{}, fmt.Errorf("insert graph layout: %w", err)
	}
	return item, nil
}

func (s *Service) updateGraphLayoutTx(ctx context.Context, tx pgx.Tx, workspaceID string, layoutID string, userID string, layoutJSON map[string]any, viewportJSON map[string]any) (GraphLayout, error) {
	layoutPayload, err := json.Marshal(layoutJSON)
	if err != nil {
		return GraphLayout{}, fmt.Errorf("marshal graph layout json: %w", err)
	}
	viewportPayload, err := json.Marshal(viewportJSON)
	if err != nil {
		return GraphLayout{}, fmt.Errorf("marshal graph viewport json: %w", err)
	}

	item, err := scanGraphLayout(tx.QueryRow(
		ctx,
		`UPDATE graph_layouts
		 SET layout_json = $3::jsonb,
		     viewport_json = $4::jsonb,
		     updated_by = NULLIF($5, '')::uuid,
		     version = version + 1
		 WHERE workspace_id = $1
		   AND id = $2
		 RETURNING id, workspace_id, kb_id, room_card_id, layout_json, viewport_json, version, updated_by, created_at, updated_at`,
		workspaceID,
		layoutID,
		string(layoutPayload),
		string(viewportPayload),
		userID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return GraphLayout{}, ErrGraphLayoutNotFound
		}
		return GraphLayout{}, fmt.Errorf("update graph layout: %w", err)
	}
	return item, nil
}

func (s *Service) requireKnowledgeBaseTx(ctx context.Context, q queryRower, workspaceID string, kbID string) error {
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
	if deletedAt != nil {
		return ErrKnowledgeBaseDeleted
	}
	return nil
}

func (s *Service) requireRoomCardTx(ctx context.Context, q queryRower, workspaceID string, kbID string, roomCardID *string) error {
	if roomCardID == nil {
		return nil
	}
	var (
		cardKBID  string
		deletedAt *time.Time
	)
	err := q.QueryRow(
		ctx,
		`SELECT kb_id, deleted_at
		 FROM cards
		 WHERE workspace_id = $1
		   AND id = $2`,
		workspaceID,
		*roomCardID,
	).Scan(&cardKBID, &deletedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrRoomCardNotFound
		}
		return fmt.Errorf("select room card: %w", err)
	}
	if deletedAt != nil {
		return ErrRoomCardDeleted
	}
	if cardKBID != kbID {
		return ErrRoomCardKnowledgeBaseMismatch
	}
	return nil
}

func applyNodePatches(layoutJSON map[string]any, nodePatches map[string]any) (map[string]any, error) {
	nextLayout := cloneJSONObject(layoutJSON)
	if nodePatches == nil {
		return nextLayout, nil
	}

	rawNodes, ok := nextLayout["nodes"]
	if !ok || rawNodes == nil {
		nextLayout["nodes"] = map[string]any{}
		rawNodes = nextLayout["nodes"]
	}
	nodes, ok := rawNodes.(map[string]any)
	if !ok {
		return nil, ErrInvalidLayoutJSON
	}
	nodes = cloneJSONObject(nodes)

	for nodeID, patchValue := range nodePatches {
		trimmedNodeID := strings.TrimSpace(nodeID)
		if trimmedNodeID == "" {
			return nil, ErrInvalidLayoutJSON
		}
		if patchValue == nil {
			delete(nodes, trimmedNodeID)
			continue
		}
		patchMap, ok := patchValue.(map[string]any)
		if !ok {
			return nil, ErrInvalidLayoutJSON
		}
		existing, _ := nodes[trimmedNodeID].(map[string]any)
		nodes[trimmedNodeID] = mergeJSONObject(existing, patchMap)
	}

	nextLayout["nodes"] = nodes
	return nextLayout, nil
}

func applyViewportPatch(current map[string]any, patch map[string]any) (map[string]any, error) {
	nextViewport := cloneJSONObject(current)
	if patch == nil {
		return nextViewport, nil
	}
	panPatchValue, hasPan := patch["pan"]
	for key, value := range patch {
		if key == "pan" {
			continue
		}
		nextViewport[key] = value
	}
	if hasPan {
		if panPatchValue == nil {
			delete(nextViewport, "pan")
			return nextViewport, nil
		}
		panPatch, ok := panPatchValue.(map[string]any)
		if !ok {
			return nil, ErrInvalidViewportJSON
		}
		existingPan, _ := nextViewport["pan"].(map[string]any)
		nextViewport["pan"] = mergeJSONObject(existingPan, panPatch)
	}
	return nextViewport, nil
}

func cloneJSONObject(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(value))
	for key, item := range value {
		cloned[key] = cloneJSONValue(item)
	}
	return cloned
}

func mergeJSONObject(base map[string]any, patch map[string]any) map[string]any {
	result := cloneJSONObject(base)
	for key, value := range patch {
		result[key] = cloneJSONValue(value)
	}
	return result
}

func cloneJSONValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneJSONObject(typed)
	case []any:
		result := make([]any, len(typed))
		for i := range typed {
			result[i] = cloneJSONValue(typed[i])
		}
		return result
	default:
		return typed
	}
}

type scanner interface {
	Scan(dest ...any) error
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func scanGraphLayout(row scanner) (GraphLayout, error) {
	var (
		item         GraphLayout
		layoutJSON   []byte
		viewportJSON []byte
		createdAt    time.Time
		updatedAt    time.Time
	)
	if err := row.Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.KBID,
		&item.RoomCardID,
		&layoutJSON,
		&viewportJSON,
		&item.Version,
		&item.UpdatedBy,
		&createdAt,
		&updatedAt,
	); err != nil {
		return GraphLayout{}, err
	}
	item.LayoutJSON = decodeJSONObject(layoutJSON)
	item.ViewportJSON = decodeJSONObject(viewportJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
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

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func stringPtrValueOrNil(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
