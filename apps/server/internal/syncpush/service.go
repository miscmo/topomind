package syncpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"topomind/apps/server/internal/card"
	"topomind/apps/server/internal/document"
	"topomind/apps/server/internal/graphlayout"
	"topomind/apps/server/internal/kb"
	syncapi "topomind/apps/server/internal/sync"
)

const syncPushScope = "sync_push"

type Service struct {
	pool             *pgxpool.Pool
	knowledgeBaseSvc knowledgeBaseService
	cardSvc          cardService
	documentSvc      documentService
	graphLayoutSvc   graphLayoutService
}

type knowledgeBaseService interface {
	Create(ctx context.Context, input kb.CreateInput) (kb.KnowledgeBase, error)
	Update(ctx context.Context, input kb.UpdateInput) (kb.KnowledgeBase, error)
	Delete(ctx context.Context, input kb.DeleteInput) (kb.KnowledgeBase, error)
	Restore(ctx context.Context, input kb.DeleteInput) (kb.KnowledgeBase, error)
	Purge(ctx context.Context, input kb.DeleteInput) (kb.KnowledgeBase, error)
}

type cardService interface {
	Create(ctx context.Context, input card.CreateInput) (card.Card, error)
	Get(ctx context.Context, input card.GetInput) (card.Card, error)
	Update(ctx context.Context, input card.UpdateInput) (card.Card, error)
	Delete(ctx context.Context, input card.DeleteInput) (card.Card, error)
	Restore(ctx context.Context, input card.DeleteInput) (card.Card, error)
	Purge(ctx context.Context, input card.DeleteInput) (card.Card, error)
}

type documentService interface {
	Create(ctx context.Context, input document.CreateInput) (document.Document, error)
	Get(ctx context.Context, input document.GetInput) (document.Document, error)
	Update(ctx context.Context, input document.UpdateInput) (document.Document, error)
	Delete(ctx context.Context, input document.DeleteInput) (document.Document, error)
	Restore(ctx context.Context, input document.DeleteInput) (document.Document, error)
	Purge(ctx context.Context, input document.DeleteInput) (document.Document, error)
	SaveContent(ctx context.Context, input document.SaveContentInput) (document.Document, error)
}

type graphLayoutService interface {
	Get(ctx context.Context, input graphlayout.GetInput) (graphlayout.GraphLayout, error)
	Save(ctx context.Context, input graphlayout.SaveInput) (graphlayout.GraphLayout, error)
	Patch(ctx context.Context, input graphlayout.PatchInput) (graphlayout.GraphLayout, error)
}

type PushInput struct {
	UserID         string
	WorkspaceID    string
	EntityType     string
	Operation      string
	EntityID       string
	BaseVersion    int64
	IdempotencyKey string
	Payload        map[string]any
	Client         PushClient
}

type PushClient struct {
	DeviceID  string `json:"deviceId,omitempty"`
	RequestID string `json:"requestId,omitempty"`
	SentAt    string `json:"sentAt,omitempty"`
}

type PushResponse struct {
	EntityType string         `json:"entityType"`
	Operation  string         `json:"operation"`
	Entity     map[string]any `json:"entity"`
	Event      PushEvent      `json:"event"`
}

type PushEvent struct {
	ID            int64 `json:"id"`
	EntityVersion int64 `json:"entityVersion"`
}

type conflictError struct {
	Code          string
	Message       string
	ServerVersion int64
	ServerEventID int64
	ServerEntity  map[string]any
}

func (e *conflictError) Error() string {
	if strings.TrimSpace(e.Message) != "" {
		return e.Message
	}
	return "sync push conflict"
}

func NewService(
	pool *pgxpool.Pool,
	knowledgeBaseSvc knowledgeBaseService,
	cardSvc cardService,
	documentSvc documentService,
	graphLayoutSvc graphLayoutService,
) *Service {
	return &Service{
		pool:             pool,
		knowledgeBaseSvc: knowledgeBaseSvc,
		cardSvc:          cardSvc,
		documentSvc:      documentSvc,
		graphLayoutSvc:   graphLayoutSvc,
	}
}

func (s *Service) Push(ctx context.Context, input PushInput) (PushResponse, error) {
	normalized, err := normalizePushInput(input)
	if err != nil {
		return PushResponse{}, err
	}

	hash, err := hashPushRequest(normalized)
	if err != nil {
		return PushResponse{}, fmt.Errorf("hash sync push request: %w", err)
	}

	return s.withIdempotencyLock(ctx, normalized.WorkspaceID, normalized.IdempotencyKey, func(lockTx pgx.Tx) (PushResponse, error) {
		if existing, ok, err := s.loadIdempotentResponseTx(ctx, lockTx, normalized.WorkspaceID, normalized.IdempotencyKey, hash); err != nil {
			return PushResponse{}, err
		} else if ok {
			return existing, nil
		}

		response, err := s.dispatch(ctx, normalized)
		if err != nil {
			return PushResponse{}, err
		}

		if err := s.storeIdempotentResponseTx(ctx, lockTx, normalized.WorkspaceID, normalized.IdempotencyKey, hash, normalized.EntityType, normalized.EntityID, response); err != nil {
			return PushResponse{}, err
		}

		return response, nil
	})
}

func normalizePushInput(input PushInput) (PushInput, error) {
	input.EntityType = strings.TrimSpace(input.EntityType)
	input.Operation = strings.TrimSpace(input.Operation)
	input.EntityID = strings.TrimSpace(input.EntityID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.Payload == nil {
		input.Payload = map[string]any{}
	}

	switch input.EntityType {
	case "knowledge_base", "card", "document", "graph_layout", "attachment":
	default:
		return PushInput{}, errors.New("invalid entity type")
	}
	switch input.Operation {
	case "create", "update", "delete", "restore", "purge":
	default:
		return PushInput{}, errors.New("invalid operation")
	}
	if input.EntityID == "" {
		return PushInput{}, errors.New("invalid entity id")
	}
	if input.IdempotencyKey == "" {
		return PushInput{}, errors.New("invalid idempotency key")
	}
	if input.BaseVersion < 0 {
		return PushInput{}, errors.New("invalid base version")
	}
	return input, nil
}

func hashPushRequest(input PushInput) (string, error) {
	payload, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func (s *Service) withIdempotencyLock(ctx context.Context, workspaceID string, idempotencyKey string, fn func(lockTx pgx.Tx) (PushResponse, error)) (PushResponse, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return PushResponse{}, fmt.Errorf("begin idempotency tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(
		ctx,
		`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
		workspaceID,
		idempotencyKey,
	); err != nil {
		return PushResponse{}, fmt.Errorf("lock idempotency key: %w", err)
	}

	response, err := fn(tx)
	if err != nil {
		return PushResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PushResponse{}, fmt.Errorf("commit idempotency tx: %w", err)
	}
	return response, nil
}

func (s *Service) loadIdempotentResponseTx(ctx context.Context, tx pgx.Tx, workspaceID string, idempotencyKey string, requestHash string) (PushResponse, bool, error) {
	var (
		storedHash   *string
		statusCode   *int32
		responseJSON []byte
	)
	err := tx.QueryRow(
		ctx,
		`SELECT request_hash, status_code, response_json
		 FROM idempotency_keys
		 WHERE workspace_id = $1
		   AND scope = $2
		   AND idempotency_key = $3
		 FOR UPDATE`,
		workspaceID,
		syncPushScope,
		idempotencyKey,
	).Scan(&storedHash, &statusCode, &responseJSON)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PushResponse{}, false, nil
		}
		return PushResponse{}, false, fmt.Errorf("select idempotency key: %w", err)
	}
	if storedHash != nil && *storedHash != "" && *storedHash != requestHash {
		return PushResponse{}, false, &conflictError{
			Code:    "idempotency_key_conflict",
			Message: "相同 idempotencyKey 对应的请求内容不一致",
		}
	}
	if statusCode == nil || *statusCode < 200 || *statusCode >= 300 {
		return PushResponse{}, false, nil
	}

	var response PushResponse
	if err := json.Unmarshal(responseJSON, &response); err != nil {
		return PushResponse{}, false, fmt.Errorf("decode idempotency response: %w", err)
	}
	return response, true, nil
}

func (s *Service) storeIdempotentResponseTx(ctx context.Context, tx pgx.Tx, workspaceID string, idempotencyKey string, requestHash string, resourceType string, resourceID string, response PushResponse) error {
	responseJSON, err := json.Marshal(response)
	if err != nil {
		return fmt.Errorf("encode idempotency response: %w", err)
	}
	_, err = tx.Exec(
		ctx,
		`INSERT INTO idempotency_keys (
		   workspace_id,
		   scope,
		   idempotency_key,
		   request_hash,
		   response_json,
		   resource_type,
		   resource_id,
		   status_code,
		   expires_at
		 )
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6, NULLIF($7, '')::uuid, 200, $8)
		 ON CONFLICT (workspace_id, scope, idempotency_key)
		 DO UPDATE SET
		   request_hash = EXCLUDED.request_hash,
		   response_json = EXCLUDED.response_json,
		   resource_type = EXCLUDED.resource_type,
		   resource_id = EXCLUDED.resource_id,
		   status_code = EXCLUDED.status_code,
		   expires_at = EXCLUDED.expires_at`,
		workspaceID,
		syncPushScope,
		idempotencyKey,
		requestHash,
		string(responseJSON),
		resourceType,
		resourceID,
		time.Now().Add(24*time.Hour),
	)
	if err != nil {
		return fmt.Errorf("upsert idempotency key: %w", err)
	}
	return nil
}

func (s *Service) dispatch(ctx context.Context, input PushInput) (PushResponse, error) {
	switch input.EntityType {
	case "knowledge_base":
		return s.dispatchKnowledgeBase(ctx, input)
	case "card":
		return s.dispatchCard(ctx, input)
	case "document":
		return s.dispatchDocument(ctx, input)
	case "graph_layout":
		return s.dispatchGraphLayout(ctx, input)
	case "attachment":
		return PushResponse{}, errors.New("attachment sync push is not supported yet")
	default:
		return PushResponse{}, errors.New("invalid entity type")
	}
}

func (s *Service) dispatchKnowledgeBase(ctx context.Context, input PushInput) (PushResponse, error) {
	current, found, err := s.getKnowledgeBase(ctx, input.WorkspaceID, input.EntityID)
	if err != nil {
		return PushResponse{}, err
	}

	switch input.Operation {
	case "create":
		if input.BaseVersion != 0 {
			return PushResponse{}, errors.New("create baseVersion must be 0")
		}
		if found {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		item, err := s.knowledgeBaseSvc.Create(ctx, kb.CreateInput{
			UserID:          input.UserID,
			WorkspaceID:     input.WorkspaceID,
			KnowledgeBaseID: input.EntityID,
			Name:            stringValue(input.Payload, "name"),
			SortOrder:       int32Value(input.Payload, "sortOrder", 0),
		})
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeKnowledgeBase)
	case "update":
		if !found {
			return PushResponse{}, kb.ErrKnowledgeBaseNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		updateInput := kb.UpdateInput{
			UserID:          input.UserID,
			WorkspaceID:     input.WorkspaceID,
			KnowledgeBaseID: input.EntityID,
		}
		if value, ok := optionalString(input.Payload, "name"); ok {
			updateInput.Name = &value
		}
		if value, ok := optionalInt32(input.Payload, "sortOrder"); ok {
			updateInput.SortOrder = &value
		}
		item, err := s.knowledgeBaseSvc.Update(ctx, updateInput)
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeKnowledgeBase)
	case "delete":
		if !found {
			return PushResponse{}, kb.ErrKnowledgeBaseNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		item, err := s.knowledgeBaseSvc.Delete(ctx, kb.DeleteInput{
			UserID:          input.UserID,
			WorkspaceID:     input.WorkspaceID,
			KnowledgeBaseID: input.EntityID,
		})
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeKnowledgeBase)
	case "restore":
		if !found {
			return PushResponse{}, kb.ErrKnowledgeBaseNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		item, err := s.knowledgeBaseSvc.Restore(ctx, kb.DeleteInput{
			UserID:          input.UserID,
			WorkspaceID:     input.WorkspaceID,
			KnowledgeBaseID: input.EntityID,
		})
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeKnowledgeBase)
	case "purge":
		if !found {
			return PushResponse{}, kb.ErrKnowledgeBaseNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		item, err := s.knowledgeBaseSvc.Purge(ctx, kb.DeleteInput{
			UserID:          input.UserID,
			WorkspaceID:     input.WorkspaceID,
			KnowledgeBaseID: input.EntityID,
		})
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeKnowledgeBase)
	default:
		return PushResponse{}, errors.New("unsupported operation")
	}
}

func (s *Service) dispatchCard(ctx context.Context, input PushInput) (PushResponse, error) {
	current, found, err := s.getCard(ctx, input)
	if err != nil {
		return PushResponse{}, err
	}

	switch input.Operation {
	case "create":
		if input.BaseVersion != 0 {
			return PushResponse{}, errors.New("create baseVersion must be 0")
		}
		if found {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		createInput := card.CreateInput{
			UserID:      input.UserID,
			WorkspaceID: input.WorkspaceID,
			CardID:      input.EntityID,
			KBID:        stringValue(input.Payload, "kbId"),
			Name:        stringValue(input.Payload, "name"),
			SortOrder:   int32Value(input.Payload, "sortOrder", 0),
			Status:      stringValue(input.Payload, "status"),
			MetaJSON:    objectValue(input.Payload, "metaJson"),
		}
		if value, ok := optionalString(input.Payload, "parentId"); ok {
			createInput.ParentID = &value
		}
		item, err := s.cardSvc.Create(ctx, createInput)
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeCard)
	case "update":
		if !found {
			return PushResponse{}, card.ErrCardNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		updateInput := card.UpdateInput{
			UserID:      input.UserID,
			WorkspaceID: input.WorkspaceID,
			CardID:      input.EntityID,
		}
		if value, ok := optionalString(input.Payload, "name"); ok {
			updateInput.Name = &value
		}
		if value, ok := optionalString(input.Payload, "status"); ok {
			updateInput.Status = &value
		}
		if value, ok := optionalInt32(input.Payload, "sortOrder"); ok {
			updateInput.SortOrder = &value
		}
		if value, ok := optionalObject(input.Payload, "metaJson"); ok {
			updateInput.MetaJSON = &value
		}
		item, err := s.cardSvc.Update(ctx, updateInput)
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeCard)
	case "delete":
		if !found {
			return PushResponse{}, card.ErrCardNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		item, err := s.cardSvc.Delete(ctx, card.DeleteInput{UserID: input.UserID, WorkspaceID: input.WorkspaceID, CardID: input.EntityID})
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeCard)
	case "restore":
		if !found {
			return PushResponse{}, card.ErrCardNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		item, err := s.cardSvc.Restore(ctx, card.DeleteInput{UserID: input.UserID, WorkspaceID: input.WorkspaceID, CardID: input.EntityID})
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeCard)
	case "purge":
		if !found {
			return PushResponse{}, card.ErrCardNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		item, err := s.cardSvc.Purge(ctx, card.DeleteInput{UserID: input.UserID, WorkspaceID: input.WorkspaceID, CardID: input.EntityID})
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeCard)
	default:
		return PushResponse{}, errors.New("unsupported operation")
	}
}

func (s *Service) dispatchDocument(ctx context.Context, input PushInput) (PushResponse, error) {
	current, found, err := s.getDocument(ctx, input)
	if err != nil {
		return PushResponse{}, err
	}

	switch input.Operation {
	case "create":
		if input.BaseVersion != 0 {
			return PushResponse{}, errors.New("create baseVersion must be 0")
		}
		if found {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		createInput := document.CreateInput{
			UserID:           input.UserID,
			WorkspaceID:      input.WorkspaceID,
			DocumentID:       input.EntityID,
			CardID:           stringValue(input.Payload, "cardId"),
			Type:             stringValue(input.Payload, "type"),
			Title:            stringValue(input.Payload, "title"),
			SortOrder:        int32Value(input.Payload, "sortOrder", 0),
			ParentDocumentID: nil,
		}
		if value, ok := optionalString(input.Payload, "parentDocumentId"); ok {
			createInput.ParentDocumentID = &value
		}
		item, err := s.documentSvc.Create(ctx, createInput)
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeDocument)
	case "update":
		if !found {
			return PushResponse{}, document.ErrDocumentNotFound
		}
		if hasContentUpdate(input.Payload) {
			contentJSON, err := requireObjectField(input.Payload, "contentJson", document.ErrInvalidDocumentContentJSON)
			if err != nil {
				return PushResponse{}, err
			}
			item, err := s.documentSvc.SaveContent(ctx, document.SaveContentInput{
				UserID:        input.UserID,
				WorkspaceID:   input.WorkspaceID,
				DocumentID:    input.EntityID,
				BaseVersion:   input.BaseVersion,
				SchemaVersion: int32Value(input.Payload, "schemaVersion", current.SchemaVersion),
				ContentJSON:   contentJSON,
			})
			if err != nil {
				return PushResponse{}, s.wrapDocumentError(ctx, input, err)
			}
			return s.buildResponse(ctx, input, item, syncapi.EntityTypeDocument)
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		updateInput := document.UpdateInput{
			UserID:      input.UserID,
			WorkspaceID: input.WorkspaceID,
			DocumentID:  input.EntityID,
		}
		if value, ok := optionalString(input.Payload, "title"); ok {
			updateInput.Title = &value
		}
		if value, ok := optionalString(input.Payload, "parentDocumentId"); ok {
			updateInput.ParentDocumentID = &value
			updateInput.ParentDocumentIDSet = true
		}
		if hasNull(input.Payload, "parentDocumentId") {
			updateInput.ParentDocumentID = nil
			updateInput.ParentDocumentIDSet = true
		}
		if value, ok := optionalInt32(input.Payload, "sortOrder"); ok {
			updateInput.SortOrder = &value
		}
		item, err := s.documentSvc.Update(ctx, updateInput)
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeDocument)
	case "delete":
		if !found {
			return PushResponse{}, document.ErrDocumentNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		item, err := s.documentSvc.Delete(ctx, document.DeleteInput{UserID: input.UserID, WorkspaceID: input.WorkspaceID, DocumentID: input.EntityID})
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeDocument)
	case "restore":
		if !found {
			return PushResponse{}, document.ErrDocumentNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		item, err := s.documentSvc.Restore(ctx, document.DeleteInput{UserID: input.UserID, WorkspaceID: input.WorkspaceID, DocumentID: input.EntityID})
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeDocument)
	case "purge":
		if !found {
			return PushResponse{}, document.ErrDocumentNotFound
		}
		if current.Version != input.BaseVersion {
			return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
		}
		item, err := s.documentSvc.Purge(ctx, document.DeleteInput{UserID: input.UserID, WorkspaceID: input.WorkspaceID, DocumentID: input.EntityID})
		if err != nil {
			return PushResponse{}, err
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeDocument)
	default:
		return PushResponse{}, errors.New("unsupported operation")
	}
}

func (s *Service) dispatchGraphLayout(ctx context.Context, input PushInput) (PushResponse, error) {
	current, found, err := s.getGraphLayout(ctx, input)
	if err != nil {
		return PushResponse{}, err
	}

	if input.Operation != "create" && input.Operation != "update" {
		return PushResponse{}, errors.New("unsupported operation")
	}
	if input.Operation == "create" && input.BaseVersion != 0 {
		return PushResponse{}, errors.New("create baseVersion must be 0")
	}
	if input.Operation == "create" && found {
		return PushResponse{}, s.newConflict(ctx, input.WorkspaceID, input.EntityType, input.EntityID, current.Version, current)
	}

	if hasLayoutSavePayload(input.Payload) {
		layoutJSON, err := requireObjectField(input.Payload, "layoutJson", graphlayout.ErrInvalidLayoutJSON)
		if err != nil {
			return PushResponse{}, err
		}
		viewportJSON, err := requireObjectFieldWithFallback(input.Payload, "viewportJson", "viewport", graphlayout.ErrInvalidViewportJSON)
		if err != nil {
			return PushResponse{}, err
		}
		item, err := s.graphLayoutSvc.Save(ctx, graphlayout.SaveInput{
			UserID:       input.UserID,
			WorkspaceID:  input.WorkspaceID,
			LayoutID:     input.EntityID,
			KBID:         stringValue(input.Payload, "kbId"),
			RoomCardID:   optionalStringPointer(input.Payload, "roomCardId"),
			BaseVersion:  input.BaseVersion,
			LayoutJSON:   layoutJSON,
			ViewportJSON: viewportJSON,
		})
		if err != nil {
			return PushResponse{}, s.wrapGraphLayoutError(ctx, input, err)
		}
		return s.buildResponse(ctx, input, item, syncapi.EntityTypeGraphLayout)
	}

	nodePatches, _, err := optionalObjectStrict(input.Payload, "nodePatches", graphlayout.ErrInvalidLayoutJSON)
	if err != nil {
		return PushResponse{}, err
	}
	viewport, _, err := optionalObjectStrict(input.Payload, "viewport", graphlayout.ErrInvalidViewportJSON)
	if err != nil {
		return PushResponse{}, err
	}
	item, err := s.graphLayoutSvc.Patch(ctx, graphlayout.PatchInput{
		UserID:      input.UserID,
		WorkspaceID: input.WorkspaceID,
		LayoutID:    input.EntityID,
		KBID:        stringValue(input.Payload, "kbId"),
		RoomCardID:  optionalStringPointer(input.Payload, "roomCardId"),
		BaseVersion: input.BaseVersion,
		NodePatches: nodePatches,
		Viewport:    viewport,
	})
	if err != nil {
		return PushResponse{}, s.wrapGraphLayoutError(ctx, input, err)
	}
	return s.buildResponse(ctx, input, item, syncapi.EntityTypeGraphLayout)
}

func (s *Service) wrapDocumentError(ctx context.Context, input PushInput, err error) error {
	var versionErr *document.VersionConflictError
	if errors.As(err, &versionErr) {
		serverEntity, mapErr := toMap(versionErr.ServerEntity)
		if mapErr != nil {
			return mapErr
		}
		return &conflictError{
			Code:          "version_conflict",
			Message:       "版本冲突",
			ServerVersion: versionErr.ServerVersion,
			ServerEventID: s.lookupEventID(ctx, input.WorkspaceID, input.EntityType, input.EntityID, versionErr.ServerVersion),
			ServerEntity:  serverEntity,
		}
	}
	return err
}

func (s *Service) wrapGraphLayoutError(ctx context.Context, input PushInput, err error) error {
	var versionErr *graphlayout.VersionConflictError
	if errors.As(err, &versionErr) {
		serverEntity, mapErr := toMap(versionErr.ServerEntity)
		if mapErr != nil {
			return mapErr
		}
		return &conflictError{
			Code:          "version_conflict",
			Message:       "版本冲突",
			ServerVersion: versionErr.ServerVersion,
			ServerEventID: s.lookupEventID(ctx, input.WorkspaceID, input.EntityType, input.EntityID, versionErr.ServerVersion),
			ServerEntity:  serverEntity,
		}
	}
	return err
}

func (s *Service) buildResponse(ctx context.Context, input PushInput, entity any, entityType syncapi.EntityType) (PushResponse, error) {
	entityMap, err := toMap(entity)
	if err != nil {
		return PushResponse{}, err
	}
	entityVersion, err := extractVersion(entityMap)
	if err != nil {
		return PushResponse{}, err
	}
	eventID := s.lookupEventID(ctx, input.WorkspaceID, string(entityType), input.EntityID, entityVersion)
	return PushResponse{
		EntityType: input.EntityType,
		Operation:  input.Operation,
		Entity:     entityMap,
		Event: PushEvent{
			ID:            eventID,
			EntityVersion: entityVersion,
		},
	}, nil
}

func (s *Service) newConflict(ctx context.Context, workspaceID string, entityType string, entityID string, version int64, entity any) error {
	entityMap, err := toMap(entity)
	if err != nil {
		return err
	}
	return &conflictError{
		Code:          "version_conflict",
		Message:       "版本冲突",
		ServerVersion: version,
		ServerEventID: s.lookupEventID(ctx, workspaceID, entityType, entityID, version),
		ServerEntity:  entityMap,
	}
}

func (s *Service) lookupEventID(ctx context.Context, workspaceID string, entityType string, entityID string, entityVersion int64) int64 {
	var eventID int64
	err := s.pool.QueryRow(
		ctx,
		`SELECT id
		 FROM sync_events
		 WHERE workspace_id = $1
		   AND entity_type = $2
		   AND entity_id = $3
		   AND entity_version = $4
		 ORDER BY id DESC
		 LIMIT 1`,
		workspaceID,
		entityType,
		entityID,
		entityVersion,
	).Scan(&eventID)
	if err != nil {
		return 0
	}
	return eventID
}

func (s *Service) getKnowledgeBase(ctx context.Context, workspaceID string, knowledgeBaseID string) (kb.KnowledgeBase, bool, error) {
	var (
		item      kb.KnowledgeBase
		settings  []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)
	err := s.pool.QueryRow(
		ctx,
		`SELECT id, workspace_id, name, sort_order, cover_attachment_id, description, settings_json, version, created_at, updated_at, deleted_at
		 FROM knowledge_bases
		 WHERE workspace_id = $1
		   AND id = $2`,
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
			return kb.KnowledgeBase{}, false, nil
		}
		return kb.KnowledgeBase{}, false, fmt.Errorf("select knowledge base: %w", err)
	}
	item.SettingsJSON = decodeJSONObject(settings)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, true, nil
}

func (s *Service) getCard(ctx context.Context, input PushInput) (card.Card, bool, error) {
	item, err := s.cardSvc.Get(ctx, card.GetInput{
		UserID:      input.UserID,
		WorkspaceID: input.WorkspaceID,
		CardID:      input.EntityID,
	})
	if err != nil {
		if errors.Is(err, card.ErrCardNotFound) {
			return card.Card{}, false, nil
		}
		return card.Card{}, false, err
	}
	return item, true, nil
}

func (s *Service) getDocument(ctx context.Context, input PushInput) (document.Document, bool, error) {
	item, err := s.documentSvc.Get(ctx, document.GetInput{
		UserID:      input.UserID,
		WorkspaceID: input.WorkspaceID,
		DocumentID:  input.EntityID,
	})
	if err != nil {
		if errors.Is(err, document.ErrDocumentNotFound) {
			return document.Document{}, false, nil
		}
		return document.Document{}, false, err
	}
	return item, true, nil
}

func (s *Service) getGraphLayout(ctx context.Context, input PushInput) (graphlayout.GraphLayout, bool, error) {
	item, err := s.graphLayoutSvc.Get(ctx, graphlayout.GetInput{
		UserID:      input.UserID,
		WorkspaceID: input.WorkspaceID,
		LayoutID:    input.EntityID,
	})
	if err != nil {
		if errors.Is(err, graphlayout.ErrGraphLayoutNotFound) {
			return graphlayout.GraphLayout{}, false, nil
		}
		return graphlayout.GraphLayout{}, false, err
	}
	return item, true, nil
}

func stringValue(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

func int32Value(payload map[string]any, key string, defaultValue int32) int32 {
	value, ok := optionalInt32(payload, key)
	if !ok {
		return defaultValue
	}
	return value
}

func optionalInt32(payload map[string]any, key string) (int32, bool) {
	value, ok := payload[key]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case float64:
		return int32(typed), true
	case int32:
		return typed, true
	case int:
		return int32(typed), true
	default:
		return 0, false
	}
}

func optionalString(payload map[string]any, key string) (string, bool) {
	value, ok := payload[key]
	if !ok {
		return "", false
	}
	if value == nil {
		return "", false
	}
	typed, ok := value.(string)
	return typed, ok
}

func optionalStringPointer(payload map[string]any, key string) *string {
	value, ok := optionalString(payload, key)
	if !ok {
		return nil
	}
	return &value
}

func hasNull(payload map[string]any, key string) bool {
	value, ok := payload[key]
	return ok && value == nil
}

func objectValue(payload map[string]any, key string) map[string]any {
	value, ok := optionalObject(payload, key)
	if !ok {
		return map[string]any{}
	}
	return value
}

func objectValueWithFallback(payload map[string]any, key string, fallback string) map[string]any {
	if value, ok := optionalObject(payload, key); ok {
		return value
	}
	return objectValue(payload, fallback)
}

func requireObjectField(payload map[string]any, key string, invalidErr error) (map[string]any, error) {
	value, ok := payload[key]
	if !ok || value == nil {
		return nil, invalidErr
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, invalidErr
	}
	return object, nil
}

func requireObjectFieldWithFallback(payload map[string]any, key string, fallback string, invalidErr error) (map[string]any, error) {
	if value, ok := payload[key]; ok {
		if value == nil {
			return nil, invalidErr
		}
		object, ok := value.(map[string]any)
		if !ok {
			return nil, invalidErr
		}
		return object, nil
	}
	return requireObjectField(payload, fallback, invalidErr)
}

func optionalObject(payload map[string]any, key string) (map[string]any, bool) {
	value, ok := payload[key]
	if !ok || value == nil {
		return map[string]any{}, false
	}
	object, ok := value.(map[string]any)
	return object, ok
}

func optionalObjectStrict(payload map[string]any, key string, invalidErr error) (map[string]any, bool, error) {
	value, ok := payload[key]
	if !ok {
		return nil, false, nil
	}
	if value == nil {
		return nil, false, nil
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, false, invalidErr
	}
	return object, true, nil
}

func hasContentUpdate(payload map[string]any) bool {
	_, hasContent := payload["contentJson"]
	_, hasSchema := payload["schemaVersion"]
	return hasContent || hasSchema
}

func hasLayoutSavePayload(payload map[string]any) bool {
	_, hasLayout := payload["layoutJson"]
	_, hasViewportJSON := payload["viewportJson"]
	return hasLayout || hasViewportJSON
}

func toMap(value any) (map[string]any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("marshal entity map: %w", err)
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("decode entity map: %w", err)
	}
	if result == nil {
		result = map[string]any{}
	}
	return result, nil
}

func extractVersion(entity map[string]any) (int64, error) {
	value, ok := entity["version"]
	if !ok {
		return 0, errors.New("entity version is missing")
	}
	number, ok := value.(float64)
	if !ok {
		return 0, errors.New("entity version is invalid")
	}
	return int64(number), nil
}

func decodeJSONObject(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return map[string]any{"_decodeError": err.Error()}
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
