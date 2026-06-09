package syncapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type EntityType string
type EventType string

const (
	EntityTypeKnowledgeBase EntityType = "knowledge_base"
	EntityTypeCard          EntityType = "card"
	EntityTypeDocument      EntityType = "document"
	EntityTypeGraphLayout   EntityType = "graph_layout"
	EntityTypeAttachment    EntityType = "attachment"
	EntityTypeWorkspaceConfig EntityType = "workspace_config"
)

const (
	EventTypeCreated  EventType = "created"
	EventTypeUpdated  EventType = "updated"
	EventTypeDeleted  EventType = "deleted"
	EventTypeRestored EventType = "restored"
	EventTypePurged   EventType = "purged"
)

var ErrInvalidEntityType = errors.New("invalid sync entity type")
var ErrInvalidEventType = errors.New("invalid sync event type")

type EventWriter struct{}

type WriteEventInput struct {
	WorkspaceID   string
	EntityType    string
	EntityID      string
	EventType     string
	EntityVersion int64
	Payload       any
	ActorUserID   string
}

type WriteEntityEventInput struct {
	WorkspaceID   string
	EntityType    EntityType
	EntityID      string
	EventType     EventType
	EntityVersion int64
	Snapshot      any
	ActorUserID   string
}

type Event struct {
	ID            int64          `json:"id"`
	WorkspaceID   string         `json:"workspaceId"`
	EntityType    string         `json:"entityType"`
	EntityID      string         `json:"entityId"`
	EventType     string         `json:"eventType"`
	EntityVersion int64          `json:"entityVersion"`
	Payload       map[string]any `json:"payload"`
	CreatedAt     string         `json:"createdAt"`
}

func NewEventWriter() *EventWriter {
	return &EventWriter{}
}

func (w *EventWriter) WriteEntityEventTx(ctx context.Context, tx pgx.Tx, input WriteEntityEventInput) (Event, error) {
	if !isSupportedEntityType(input.EntityType) {
		return Event{}, ErrInvalidEntityType
	}
	if !isSupportedEventType(input.EventType) {
		return Event{}, ErrInvalidEventType
	}
	return w.WriteTx(ctx, tx, WriteEventInput{
		WorkspaceID:   input.WorkspaceID,
		EntityType:    string(input.EntityType),
		EntityID:      input.EntityID,
		EventType:     string(input.EventType),
		EntityVersion: input.EntityVersion,
		Payload:       input.Snapshot,
		ActorUserID:   input.ActorUserID,
	})
}

func (w *EventWriter) WriteTx(ctx context.Context, tx pgx.Tx, input WriteEventInput) (Event, error) {
	payloadJSON, err := json.Marshal(input.Payload)
	if err != nil {
		return Event{}, fmt.Errorf("marshal sync event payload: %w", err)
	}

	var (
		event     Event
		createdAt time.Time
		rawJSON   []byte
	)

	if err := tx.QueryRow(
		ctx,
		`INSERT INTO sync_events (
		   workspace_id,
		   entity_type,
		   entity_id,
		   event_type,
		   entity_version,
		   payload,
		   actor_user_id
		 )
		 VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULLIF($7, '')::uuid)
		 RETURNING id, workspace_id, entity_type, entity_id, event_type, entity_version, payload, created_at`,
		input.WorkspaceID,
		input.EntityType,
		input.EntityID,
		input.EventType,
		input.EntityVersion,
		string(payloadJSON),
		input.ActorUserID,
	).Scan(
		&event.ID,
		&event.WorkspaceID,
		&event.EntityType,
		&event.EntityID,
		&event.EventType,
		&event.EntityVersion,
		&rawJSON,
		&createdAt,
	); err != nil {
		return Event{}, fmt.Errorf("insert sync event: %w", err)
	}

	if err := json.Unmarshal(rawJSON, &event.Payload); err != nil {
		return Event{}, fmt.Errorf("decode sync event payload: %w", err)
	}
	if event.Payload == nil {
		event.Payload = map[string]any{}
	}
	event.CreatedAt = createdAt.UTC().Format(time.RFC3339)

	return event, nil
}

func isSupportedEntityType(value EntityType) bool {
	switch value {
	case EntityTypeKnowledgeBase, EntityTypeCard, EntityTypeDocument, EntityTypeGraphLayout, EntityTypeAttachment, EntityTypeWorkspaceConfig:
		return true
	default:
		return false
	}
}

func isSupportedEventType(value EventType) bool {
	switch value {
	case EventTypeCreated, EventTypeUpdated, EventTypeDeleted, EventTypeRestored, EventTypePurged:
		return true
	default:
		return false
	}
}
