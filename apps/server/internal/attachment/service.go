package attachment

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	syncapi "topomind/apps/server/internal/sync"
	filestorage "topomind/apps/server/internal/storage"
	"topomind/apps/server/internal/workspace"
)

const defaultTicketTTL = 15 * time.Minute

type objectStorage interface {
	BuildKey(scope string, originalFileName string) (string, error)
	Put(ctx context.Context, key string, body io.Reader) (filestorage.ObjectInfo, error)
	Get(ctx context.Context, key string) (io.ReadCloser, filestorage.ObjectInfo, error)
	Delete(ctx context.Context, key string) error
}

type Service struct {
	pool            *pgxpool.Pool
	eventWriter     *syncapi.EventWriter
	storage         objectStorage
	storageProvider string
	ticketSecret    []byte
	ticketTTL       time.Duration
	now             func() time.Time
}

type CreateUploadTicketInput struct {
	UserID          string
	WorkspaceID     string
	KnowledgeBaseID string
	CardID          string
	DocumentID      *string
	FileName        string
	MimeType        string
	SizeBytes       int64
}

type UploadTicket struct {
	Token            string
	Method           string
	Headers          map[string]string
	StorageKey       string
	ExpiresAt        string
	MaxSizeBytes     int64
	AllowedMimeTypes []string
}

type UploadBinaryInput struct {
	WorkspaceID string
	Token       string
	Body        io.Reader
}

type CommitUploadInput struct {
	WorkspaceID string
	Token       string
	SHA256      string
}

type CommitResult struct {
	Attachment Attachment `json:"attachment"`
	Event      syncEvent  `json:"event"`
}

type GetContentInput struct {
	UserID      string
	WorkspaceID string
	AttachmentID string
}

type AttachmentContent struct {
	Attachment Attachment
	Reader     io.ReadCloser
}

type DeleteInput struct {
	UserID       string
	WorkspaceID  string
	AttachmentID string
}

type Attachment struct {
	ID              string         `json:"id"`
	WorkspaceID     string         `json:"workspaceId"`
	KnowledgeBaseID *string        `json:"knowledgeBaseId"`
	CardID          *string        `json:"cardId"`
	DocumentID      *string        `json:"documentId"`
	FileName        string         `json:"fileName"`
	MimeType        string         `json:"mimeType"`
	SizeBytes       int64          `json:"sizeBytes"`
	StorageProvider string         `json:"storageProvider"`
	StorageBucket   string         `json:"storageBucket"`
	StorageKey      string         `json:"storageKey"`
	SHA256          *string        `json:"sha256"`
	MetaJSON        map[string]any `json:"metaJson"`
	Version         int64          `json:"version"`
	CreatedAt       string         `json:"createdAt"`
	UpdatedAt       string         `json:"updatedAt"`
	DeletedAt       *string        `json:"deletedAt"`
}

type syncEvent struct {
	ID            int64          `json:"id"`
	EntityType    string         `json:"entityType"`
	EntityID      string         `json:"entityId"`
	EventType     string         `json:"eventType"`
	EntityVersion int64          `json:"entityVersion"`
	Payload       map[string]any `json:"payload"`
	CreatedAt     string         `json:"createdAt"`
}

type uploadTicketPayload struct {
	WorkspaceID     string  `json:"workspaceId"`
	AttachmentID    string  `json:"attachmentId"`
	KnowledgeBaseID *string `json:"knowledgeBaseId,omitempty"`
	CardID          *string `json:"cardId,omitempty"`
	DocumentID      *string `json:"documentId,omitempty"`
	FileName        string  `json:"fileName"`
	MimeType        string  `json:"mimeType"`
	SizeBytes       int64   `json:"sizeBytes"`
	StorageKey      string  `json:"storageKey"`
	StagingKey      string  `json:"stagingKey"`
	ExpiresAtUnix   int64   `json:"expiresAtUnix"`
}

func NewService(pool *pgxpool.Pool, eventWriter *syncapi.EventWriter, storage objectStorage, storageProvider string, ticketSecret string) (*Service, error) {
	if pool == nil {
		return nil, errors.New("attachment pool is required")
	}
	if eventWriter == nil {
		return nil, errors.New("attachment event writer is required")
	}
	if storage == nil {
		return nil, errors.New("attachment storage is required")
	}
	if strings.TrimSpace(storageProvider) == "" {
		return nil, errors.New("attachment storage provider is required")
	}
	if strings.TrimSpace(ticketSecret) == "" {
		return nil, errors.New("attachment ticket secret is required")
	}
	return &Service{
		pool:            pool,
		eventWriter:     eventWriter,
		storage:         storage,
		storageProvider: strings.TrimSpace(storageProvider),
		ticketSecret:    []byte(ticketSecret),
		ticketTTL:       defaultTicketTTL,
		now:             time.Now,
	}, nil
}

func (s *Service) CreateUploadTicket(ctx context.Context, input CreateUploadTicketInput) (UploadTicket, error) {
	fileName := strings.TrimSpace(input.FileName)
	if fileName == "" {
		return UploadTicket{}, ErrInvalidFileName
	}
	mimeType := strings.TrimSpace(input.MimeType)
	if mimeType == "" {
		return UploadTicket{}, ErrInvalidMimeType
	}
	if input.SizeBytes < 0 {
		return UploadTicket{}, ErrInvalidSizeBytes
	}

	target, err := normalizeTarget(input.KnowledgeBaseID, input.CardID, input.DocumentID)
	if err != nil {
		return UploadTicket{}, err
	}

	if _, err := workspace.RequireMember(ctx, s.pool, input.WorkspaceID, input.UserID); err != nil {
		return UploadTicket{}, err
	}
	if err := s.validateTarget(ctx, input.WorkspaceID, target); err != nil {
		return UploadTicket{}, err
	}

	attachmentID := uuid.NewString()
	storageKey, err := s.storage.BuildKey(buildFinalScope(input.WorkspaceID, target), fileName)
	if err != nil {
		return UploadTicket{}, fmt.Errorf("build attachment storage key: %w", err)
	}
	stagingKey, err := s.storage.BuildKey(path.Join("_staging", "workspaces", input.WorkspaceID, "attachments"), attachmentID+".upload")
	if err != nil {
		return UploadTicket{}, fmt.Errorf("build attachment staging key: %w", err)
	}

	expiresAt := s.now().UTC().Add(s.ticketTTL)
	payload := uploadTicketPayload{
		WorkspaceID:     input.WorkspaceID,
		AttachmentID:    attachmentID,
		KnowledgeBaseID: target.knowledgeBaseID,
		CardID:          target.cardID,
		DocumentID:      target.documentID,
		FileName:        fileName,
		MimeType:        mimeType,
		SizeBytes:       input.SizeBytes,
		StorageKey:      storageKey,
		StagingKey:      stagingKey,
		ExpiresAtUnix:   expiresAt.Unix(),
	}
	token, err := s.signTicket(payload)
	if err != nil {
		return UploadTicket{}, err
	}

	return UploadTicket{
		Token:            token,
		Method:           "PUT",
		Headers:          map[string]string{},
		StorageKey:       storageKey,
		ExpiresAt:        expiresAt.Format(time.RFC3339),
		MaxSizeBytes:     input.SizeBytes,
		AllowedMimeTypes: []string{mimeType},
	}, nil
}

func (s *Service) UploadBinary(ctx context.Context, input UploadBinaryInput) error {
	payload, err := s.verifyTicket(input.WorkspaceID, input.Token)
	if err != nil {
		return err
	}
	if input.Body == nil {
		return ErrAttachmentUploadNotFound
	}

	info, err := s.storage.Put(ctx, payload.StagingKey, input.Body)
	if err != nil {
		return fmt.Errorf("store attachment staging file: %w", err)
	}
	if info.SizeBytes != payload.SizeBytes {
		_ = s.storage.Delete(ctx, payload.StagingKey)
		return ErrAttachmentSizeMismatch
	}
	return nil
}

func (s *Service) CommitUpload(ctx context.Context, input CommitUploadInput) (CommitResult, error) {
	payload, err := s.verifyTicket(input.WorkspaceID, input.Token)
	if err != nil {
		return CommitResult{}, err
	}
	expectedSHA256, err := normalizeSHA256Hex(input.SHA256)
	if err != nil {
		return CommitResult{}, err
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return CommitResult{}, fmt.Errorf("begin attachment commit tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(
		ctx,
		`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
		payload.WorkspaceID,
		payload.AttachmentID,
	); err != nil {
		return CommitResult{}, fmt.Errorf("lock attachment commit: %w", err)
	}

	if existing, ok, err := s.getAttachmentTx(ctx, tx, payload.WorkspaceID, payload.AttachmentID); err != nil {
		return CommitResult{}, err
	} else if ok {
		event, err := s.lookupEventTx(ctx, tx, payload.WorkspaceID, existing.ID, existing.Version, syncapi.EntityTypeAttachment)
		if err != nil {
			return CommitResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return CommitResult{}, fmt.Errorf("commit attachment idempotent tx: %w", err)
		}
		return CommitResult{Attachment: existing, Event: event}, nil
	}

	reader, info, err := s.storage.Get(ctx, payload.StagingKey)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return CommitResult{}, ErrAttachmentUploadNotFound
		}
		return CommitResult{}, fmt.Errorf("open attachment staging file: %w", err)
	}
	actualSHA256, err := computeSHA256Hex(reader)
	_ = reader.Close()
	if err != nil {
		return CommitResult{}, fmt.Errorf("hash attachment staging file: %w", err)
	}
	if info.SizeBytes != payload.SizeBytes {
		return CommitResult{}, ErrAttachmentSizeMismatch
	}
	if expectedSHA256 != "" && actualSHA256 != expectedSHA256 {
		return CommitResult{}, ErrAttachmentChecksumMismatch
	}

	copyReader, _, err := s.storage.Get(ctx, payload.StagingKey)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return CommitResult{}, ErrAttachmentUploadNotFound
		}
		return CommitResult{}, fmt.Errorf("reopen attachment staging file: %w", err)
	}
	finalStored := false
	defer func() {
		_ = copyReader.Close()
		if !finalStored {
			_ = s.storage.Delete(ctx, payload.StorageKey)
		}
	}()
	if _, err := s.storage.Put(ctx, payload.StorageKey, copyReader); err != nil {
		return CommitResult{}, fmt.Errorf("store attachment file: %w", err)
	}

	item, err := s.insertAttachmentTx(ctx, tx, payload, actualSHA256)
	if err != nil {
		return CommitResult{}, err
	}
	eventRecord, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeAttachment,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeCreated,
		EntityVersion: item.Version,
		Snapshot:      item,
	})
	if err != nil {
		return CommitResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return CommitResult{}, fmt.Errorf("commit attachment create: %w", err)
	}
	finalStored = true
	_ = s.storage.Delete(ctx, payload.StagingKey)

	return CommitResult{
		Attachment: item,
		Event:      toSyncEvent(eventRecord),
	}, nil
}

func (s *Service) GetContent(ctx context.Context, input GetContentInput) (AttachmentContent, error) {
	if strings.TrimSpace(input.AttachmentID) == "" {
		return AttachmentContent{}, ErrInvalidAttachmentID
	}
	if _, err := workspace.RequireMember(ctx, s.pool, input.WorkspaceID, input.UserID); err != nil {
		return AttachmentContent{}, err
	}

	item, ok, err := s.getAttachment(ctx, input.WorkspaceID, input.AttachmentID)
	if err != nil {
		return AttachmentContent{}, err
	}
	if !ok || item.DeletedAt != nil {
		return AttachmentContent{}, ErrAttachmentNotFound
	}
	reader, _, err := s.storage.Get(ctx, item.StorageKey)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return AttachmentContent{}, ErrAttachmentNotFound
		}
		return AttachmentContent{}, fmt.Errorf("open attachment content: %w", err)
	}
	return AttachmentContent{
		Attachment: item,
		Reader:     reader,
	}, nil
}

func (s *Service) Delete(ctx context.Context, input DeleteInput) (Attachment, syncEvent, error) {
	if strings.TrimSpace(input.AttachmentID) == "" {
		return Attachment{}, syncEvent{}, ErrInvalidAttachmentID
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Attachment{}, syncEvent{}, fmt.Errorf("begin attachment delete tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Attachment{}, syncEvent{}, err
	}
	current, ok, err := s.getAttachmentTx(ctx, tx, input.WorkspaceID, input.AttachmentID)
	if err != nil {
		return Attachment{}, syncEvent{}, err
	}
	if !ok {
		return Attachment{}, syncEvent{}, ErrAttachmentNotFound
	}
	if current.DeletedAt != nil {
		return Attachment{}, syncEvent{}, ErrAttachmentAlreadyDeleted
	}

	item, err := s.deleteAttachmentTx(ctx, tx, input.WorkspaceID, input.AttachmentID)
	if err != nil {
		return Attachment{}, syncEvent{}, err
	}
	eventRecord, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeAttachment,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeDeleted,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	})
	if err != nil {
		return Attachment{}, syncEvent{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Attachment{}, syncEvent{}, fmt.Errorf("commit attachment delete: %w", err)
	}
	return item, toSyncEvent(eventRecord), nil
}

func (s *Service) Restore(ctx context.Context, input DeleteInput) (Attachment, syncEvent, error) {
	if strings.TrimSpace(input.AttachmentID) == "" {
		return Attachment{}, syncEvent{}, ErrInvalidAttachmentID
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Attachment{}, syncEvent{}, fmt.Errorf("begin attachment restore tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Attachment{}, syncEvent{}, err
	}
	current, ok, err := s.getAttachmentTx(ctx, tx, input.WorkspaceID, input.AttachmentID)
	if err != nil {
		return Attachment{}, syncEvent{}, err
	}
	if !ok {
		return Attachment{}, syncEvent{}, ErrAttachmentNotFound
	}
	if current.DeletedAt == nil {
		return Attachment{}, syncEvent{}, ErrAttachmentAlreadyActive
	}

	item, err := s.restoreAttachmentTx(ctx, tx, input.WorkspaceID, input.AttachmentID)
	if err != nil {
		return Attachment{}, syncEvent{}, err
	}
	eventRecord, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeAttachment,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypeRestored,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	})
	if err != nil {
		return Attachment{}, syncEvent{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Attachment{}, syncEvent{}, fmt.Errorf("commit attachment restore: %w", err)
	}
	return item, toSyncEvent(eventRecord), nil
}

func (s *Service) Purge(ctx context.Context, input DeleteInput) (Attachment, syncEvent, error) {
	if strings.TrimSpace(input.AttachmentID) == "" {
		return Attachment{}, syncEvent{}, ErrInvalidAttachmentID
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Attachment{}, syncEvent{}, fmt.Errorf("begin attachment purge tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, input.WorkspaceID, input.UserID); err != nil {
		return Attachment{}, syncEvent{}, err
	}
	current, ok, err := s.getAttachmentTx(ctx, tx, input.WorkspaceID, input.AttachmentID)
	if err != nil {
		return Attachment{}, syncEvent{}, err
	}
	if !ok {
		return Attachment{}, syncEvent{}, ErrAttachmentNotFound
	}
	if current.DeletedAt == nil {
		return Attachment{}, syncEvent{}, ErrAttachmentNotDeleted
	}

	item, err := s.purgeAttachmentTx(ctx, tx, input.WorkspaceID, input.AttachmentID)
	if err != nil {
		return Attachment{}, syncEvent{}, err
	}
	eventRecord, err := s.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   item.WorkspaceID,
		EntityType:    syncapi.EntityTypeAttachment,
		EntityID:      item.ID,
		EventType:     syncapi.EventTypePurged,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   input.UserID,
	})
	if err != nil {
		return Attachment{}, syncEvent{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Attachment{}, syncEvent{}, fmt.Errorf("commit attachment purge: %w", err)
	}
	_ = s.storage.Delete(ctx, item.StorageKey)
	return item, toSyncEvent(eventRecord), nil
}

type attachmentTarget struct {
	knowledgeBaseID *string
	cardID          *string
	documentID      *string
}

func normalizeTarget(knowledgeBaseID string, cardID string, documentID *string) (attachmentTarget, error) {
	trimmedKBID := strings.TrimSpace(knowledgeBaseID)
	trimmedCardID := strings.TrimSpace(cardID)
	var normalizedDocumentID *string
	if documentID != nil {
		trimmedDocumentID := strings.TrimSpace(*documentID)
		if trimmedDocumentID == "" {
			return attachmentTarget{}, ErrInvalidDocumentID
		}
		normalizedDocumentID = &trimmedDocumentID
	}

	switch {
	case trimmedKBID != "" && trimmedCardID == "" && normalizedDocumentID == nil:
		return attachmentTarget{knowledgeBaseID: &trimmedKBID}, nil
	case trimmedKBID == "" && trimmedCardID != "":
		return attachmentTarget{cardID: &trimmedCardID, documentID: normalizedDocumentID}, nil
	default:
		return attachmentTarget{}, ErrInvalidAttachmentTarget
	}
}

func buildFinalScope(workspaceID string, target attachmentTarget) string {
	switch {
	case target.knowledgeBaseID != nil:
		return path.Join("workspaces", workspaceID, "attachments", "knowledge-bases", *target.knowledgeBaseID)
	case target.cardID != nil:
		scope := path.Join("workspaces", workspaceID, "attachments", "cards", *target.cardID)
		if target.documentID != nil {
			return path.Join(scope, "documents", *target.documentID)
		}
		return scope
	default:
		return path.Join("workspaces", workspaceID, "attachments")
	}
}

func (s *Service) validateTarget(ctx context.Context, workspaceID string, target attachmentTarget) error {
	switch {
	case target.knowledgeBaseID != nil:
		return s.validateKnowledgeBase(ctx, workspaceID, *target.knowledgeBaseID)
	case target.cardID != nil:
		if err := s.validateCard(ctx, workspaceID, *target.cardID); err != nil {
			return err
		}
		if target.documentID != nil {
			return s.validateDocument(ctx, workspaceID, *target.cardID, *target.documentID)
		}
		return nil
	default:
		return ErrInvalidAttachmentTarget
	}
}

func (s *Service) validateKnowledgeBase(ctx context.Context, workspaceID string, knowledgeBaseID string) error {
	if knowledgeBaseID == "" {
		return ErrInvalidKnowledgeBaseID
	}
	var deletedAt *time.Time
	err := s.pool.QueryRow(
		ctx,
		`SELECT deleted_at
		 FROM knowledge_bases
		 WHERE workspace_id = $1
		   AND id = $2`,
		workspaceID,
		knowledgeBaseID,
	).Scan(&deletedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrKnowledgeBaseNotFound
		}
		return fmt.Errorf("query knowledge base attachment target: %w", err)
	}
	if deletedAt != nil {
		return ErrKnowledgeBaseDeleted
	}
	return nil
}

func (s *Service) validateCard(ctx context.Context, workspaceID string, cardID string) error {
	if cardID == "" {
		return ErrInvalidCardID
	}
	var deletedAt *time.Time
	err := s.pool.QueryRow(
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
		return fmt.Errorf("query card attachment target: %w", err)
	}
	if deletedAt != nil {
		return ErrCardDeleted
	}
	return nil
}

func (s *Service) validateDocument(ctx context.Context, workspaceID string, cardID string, documentID string) error {
	if documentID == "" {
		return ErrInvalidDocumentID
	}
	var (
		documentCardID string
		deletedAt      *time.Time
	)
	err := s.pool.QueryRow(
		ctx,
		`SELECT card_id, deleted_at
		 FROM documents
		 WHERE workspace_id = $1
		   AND id = $2`,
		workspaceID,
		documentID,
	).Scan(&documentCardID, &deletedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDocumentNotFound
		}
		return fmt.Errorf("query document attachment target: %w", err)
	}
	if deletedAt != nil {
		return ErrDocumentDeleted
	}
	if documentCardID != cardID {
		return ErrDocumentCardMismatch
	}
	return nil
}

func (s *Service) insertAttachmentTx(ctx context.Context, tx pgx.Tx, payload uploadTicketPayload, sha256Hex string) (Attachment, error) {
	var (
		item      Attachment
		metaJSON  []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)
	err := tx.QueryRow(
		ctx,
		`INSERT INTO attachments (
		   id,
		   workspace_id,
		   knowledge_base_id,
		   card_id,
		   document_id,
		   file_name,
		   mime_type,
		   size_bytes,
		   storage_provider,
		   storage_bucket,
		   storage_key,
		   sha256,
		   meta_json
		 )
		 VALUES (
		   $1,
		   $2,
		   NULLIF($3, '')::uuid,
		   NULLIF($4, '')::uuid,
		   NULLIF($5, '')::uuid,
		   $6,
		   $7,
		   $8,
		   $9,
		   '',
		   $10,
		   NULLIF($11, ''),
		   '{}'::jsonb
		 )
		 RETURNING id, workspace_id, knowledge_base_id, card_id, document_id, file_name, mime_type, size_bytes, storage_provider, COALESCE(storage_bucket, ''), storage_key, sha256, meta_json, version, created_at, updated_at, deleted_at`,
		payload.AttachmentID,
		payload.WorkspaceID,
		stringValue(payload.KnowledgeBaseID),
		stringValue(payload.CardID),
		stringValue(payload.DocumentID),
		payload.FileName,
		payload.MimeType,
		payload.SizeBytes,
		s.storageProvider,
		payload.StorageKey,
		sha256Hex,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.KnowledgeBaseID,
		&item.CardID,
		&item.DocumentID,
		&item.FileName,
		&item.MimeType,
		&item.SizeBytes,
		&item.StorageProvider,
		&item.StorageBucket,
		&item.StorageKey,
		&item.SHA256,
		&metaJSON,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	)
	if err != nil {
		return Attachment{}, fmt.Errorf("insert attachment: %w", err)
	}
	item.MetaJSON = decodeJSONObject(metaJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, nil
}

func (s *Service) deleteAttachmentTx(ctx context.Context, tx pgx.Tx, workspaceID string, attachmentID string) (Attachment, error) {
	var (
		item      Attachment
		metaJSON  []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)
	err := tx.QueryRow(
		ctx,
		`UPDATE attachments
		 SET version = version + 1,
		     deleted_at = NOW(),
		     updated_at = NOW()
		 WHERE workspace_id = $1
		   AND id = $2
		 RETURNING id, workspace_id, knowledge_base_id, card_id, document_id, file_name, mime_type, size_bytes, storage_provider, COALESCE(storage_bucket, ''), storage_key, sha256, meta_json, version, created_at, updated_at, deleted_at`,
		workspaceID,
		attachmentID,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.KnowledgeBaseID,
		&item.CardID,
		&item.DocumentID,
		&item.FileName,
		&item.MimeType,
		&item.SizeBytes,
		&item.StorageProvider,
		&item.StorageBucket,
		&item.StorageKey,
		&item.SHA256,
		&metaJSON,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	)
	if err != nil {
		return Attachment{}, fmt.Errorf("delete attachment: %w", err)
	}
	item.MetaJSON = decodeJSONObject(metaJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, nil
}

func (s *Service) restoreAttachmentTx(ctx context.Context, tx pgx.Tx, workspaceID string, attachmentID string) (Attachment, error) {
	var (
		item      Attachment
		metaJSON  []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)
	err := tx.QueryRow(
		ctx,
		`UPDATE attachments
		 SET version = version + 1,
		     deleted_at = NULL,
		     updated_at = NOW()
		 WHERE workspace_id = $1
		   AND id = $2
		 RETURNING id, workspace_id, knowledge_base_id, card_id, document_id, file_name, mime_type, size_bytes, storage_provider, COALESCE(storage_bucket, ''), storage_key, sha256, meta_json, version, created_at, updated_at, deleted_at`,
		workspaceID,
		attachmentID,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.KnowledgeBaseID,
		&item.CardID,
		&item.DocumentID,
		&item.FileName,
		&item.MimeType,
		&item.SizeBytes,
		&item.StorageProvider,
		&item.StorageBucket,
		&item.StorageKey,
		&item.SHA256,
		&metaJSON,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	)
	if err != nil {
		return Attachment{}, fmt.Errorf("restore attachment: %w", err)
	}
	item.MetaJSON = decodeJSONObject(metaJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, nil
}

func (s *Service) purgeAttachmentTx(ctx context.Context, tx pgx.Tx, workspaceID string, attachmentID string) (Attachment, error) {
	var (
		item      Attachment
		metaJSON  []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)
	err := tx.QueryRow(
		ctx,
		`UPDATE attachments
		 SET version = version + 1,
		     updated_at = NOW()
		 WHERE workspace_id = $1
		   AND id = $2
		 RETURNING id, workspace_id, knowledge_base_id, card_id, document_id, file_name, mime_type, size_bytes, storage_provider, COALESCE(storage_bucket, ''), storage_key, sha256, meta_json, version, created_at, updated_at, deleted_at`,
		workspaceID,
		attachmentID,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.KnowledgeBaseID,
		&item.CardID,
		&item.DocumentID,
		&item.FileName,
		&item.MimeType,
		&item.SizeBytes,
		&item.StorageProvider,
		&item.StorageBucket,
		&item.StorageKey,
		&item.SHA256,
		&metaJSON,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	)
	if err != nil {
		return Attachment{}, fmt.Errorf("mark attachment purge version: %w", err)
	}
	if _, err := tx.Exec(
		ctx,
		`DELETE FROM attachments
		 WHERE workspace_id = $1
		   AND id = $2`,
		workspaceID,
		attachmentID,
	); err != nil {
		return Attachment{}, fmt.Errorf("purge attachment: %w", err)
	}
	item.MetaJSON = decodeJSONObject(metaJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, nil
}

func (s *Service) getAttachment(ctx context.Context, workspaceID string, attachmentID string) (Attachment, bool, error) {
	var item Attachment
	var (
		metaJSON  []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)
	err := s.pool.QueryRow(
		ctx,
		`SELECT id, workspace_id, knowledge_base_id, card_id, document_id, file_name, mime_type, size_bytes, storage_provider, COALESCE(storage_bucket, ''), storage_key, sha256, meta_json, version, created_at, updated_at, deleted_at
		 FROM attachments
		 WHERE workspace_id = $1
		   AND id = $2`,
		workspaceID,
		attachmentID,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.KnowledgeBaseID,
		&item.CardID,
		&item.DocumentID,
		&item.FileName,
		&item.MimeType,
		&item.SizeBytes,
		&item.StorageProvider,
		&item.StorageBucket,
		&item.StorageKey,
		&item.SHA256,
		&metaJSON,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Attachment{}, false, nil
		}
		return Attachment{}, false, fmt.Errorf("query attachment: %w", err)
	}
	item.MetaJSON = decodeJSONObject(metaJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, true, nil
}

func (s *Service) getAttachmentTx(ctx context.Context, tx pgx.Tx, workspaceID string, attachmentID string) (Attachment, bool, error) {
	var item Attachment
	var (
		metaJSON  []byte
		createdAt time.Time
		updatedAt time.Time
		deletedAt *time.Time
	)
	err := tx.QueryRow(
		ctx,
		`SELECT id, workspace_id, knowledge_base_id, card_id, document_id, file_name, mime_type, size_bytes, storage_provider, COALESCE(storage_bucket, ''), storage_key, sha256, meta_json, version, created_at, updated_at, deleted_at
		 FROM attachments
		 WHERE workspace_id = $1
		   AND id = $2
		 FOR UPDATE`,
		workspaceID,
		attachmentID,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.KnowledgeBaseID,
		&item.CardID,
		&item.DocumentID,
		&item.FileName,
		&item.MimeType,
		&item.SizeBytes,
		&item.StorageProvider,
		&item.StorageBucket,
		&item.StorageKey,
		&item.SHA256,
		&metaJSON,
		&item.Version,
		&createdAt,
		&updatedAt,
		&deletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Attachment{}, false, nil
		}
		return Attachment{}, false, fmt.Errorf("query attachment tx: %w", err)
	}
	item.MetaJSON = decodeJSONObject(metaJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.DeletedAt = formatTimePtr(deletedAt)
	return item, true, nil
}

func (s *Service) lookupEventTx(ctx context.Context, tx pgx.Tx, workspaceID string, entityID string, entityVersion int64, entityType syncapi.EntityType) (syncEvent, error) {
	var (
		item      syncEvent
		payload   []byte
		createdAt time.Time
	)
	err := tx.QueryRow(
		ctx,
		`SELECT id, entity_type, entity_id, event_type, entity_version, payload_json, created_at
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
	).Scan(
		&item.ID,
		&item.EntityType,
		&item.EntityID,
		&item.EventType,
		&item.EntityVersion,
		&payload,
		&createdAt,
	)
	if err != nil {
		return syncEvent{}, fmt.Errorf("query attachment sync event: %w", err)
	}
	item.Payload = decodeJSONObject(payload)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	return item, nil
}

func (s *Service) signTicket(payload uploadTicketPayload) (string, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode attachment ticket: %w", err)
	}
	bodyPart := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, s.ticketSecret)
	_, _ = mac.Write([]byte(bodyPart))
	signaturePart := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return bodyPart + "." + signaturePart, nil
}

func (s *Service) verifyTicket(workspaceID string, token string) (uploadTicketPayload, error) {
	trimmedToken := strings.TrimSpace(token)
	if trimmedToken == "" {
		return uploadTicketPayload{}, ErrInvalidCommitToken
	}
	parts := strings.Split(trimmedToken, ".")
	if len(parts) != 2 {
		return uploadTicketPayload{}, ErrInvalidCommitToken
	}
	mac := hmac.New(sha256.New, s.ticketSecret)
	_, _ = mac.Write([]byte(parts[0]))
	expected := mac.Sum(nil)
	actual, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(expected, actual) {
		return uploadTicketPayload{}, ErrInvalidCommitToken
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return uploadTicketPayload{}, ErrInvalidCommitToken
	}
	var payload uploadTicketPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return uploadTicketPayload{}, ErrInvalidCommitToken
	}
	if payload.WorkspaceID != workspaceID {
		return uploadTicketPayload{}, ErrInvalidCommitToken
	}
	if s.now().UTC().Unix() > payload.ExpiresAtUnix {
		return uploadTicketPayload{}, ErrInvalidCommitToken
	}
	return payload, nil
}

func computeSHA256Hex(reader io.Reader) (string, error) {
	hasher := sha256.New()
	if _, err := io.Copy(hasher, reader); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func normalizeSHA256Hex(value string) (string, error) {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "" {
		return "", nil
	}
	if len(trimmed) != 64 {
		return "", ErrAttachmentChecksumMismatch
	}
	for _, char := range trimmed {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') {
			continue
		}
		return "", ErrAttachmentChecksumMismatch
	}
	return trimmed, nil
}

func decodeJSONObject(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
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

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func toSyncEvent(record syncapi.Event) syncEvent {
	return syncEvent{
		ID:            record.ID,
		EntityType:    string(record.EntityType),
		EntityID:      record.EntityID,
		EventType:     string(record.EventType),
		EntityVersion: record.EntityVersion,
		Payload:       record.Payload,
		CreatedAt:     record.CreatedAt,
	}
}
