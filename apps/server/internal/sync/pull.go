package syncapi

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"topomind/apps/server/internal/workspace"
)

const (
	defaultPullLimit = 200
	maxPullLimit     = 500
)

type Service struct {
	pool *pgxpool.Pool
}

type PullInput struct {
	UserID       string
	WorkspaceID  string
	AfterEventID int64
	Limit        int
}

type PullResponse struct {
	WorkspaceID string      `json:"workspaceId"`
	FromEventID int64       `json:"fromEventId"`
	ToEventID   int64       `json:"toEventId"`
	HasMore     bool        `json:"hasMore"`
	Events      []PullEvent `json:"events"`
}

type PullEvent struct {
	ID            int64          `json:"id"`
	EntityType    string         `json:"entityType"`
	EntityID      string         `json:"entityId"`
	EventType     string         `json:"eventType"`
	EntityVersion int64          `json:"entityVersion"`
	Payload       map[string]any `json:"payload"`
	CreatedAt     string         `json:"createdAt"`
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Pull(ctx context.Context, input PullInput) (PullResponse, error) {
	limit := normalizeLimit(input.Limit)

	if _, err := workspace.RequireMember(ctx, s.pool, input.WorkspaceID, input.UserID); err != nil {
		return PullResponse{}, err
	}

	rows, err := s.pool.Query(
		ctx,
		`SELECT id, entity_type, entity_id, event_type, entity_version, payload, created_at
		 FROM sync_events
		 WHERE workspace_id = $1
		   AND id > $2
		 ORDER BY id ASC
		 LIMIT $3`,
		input.WorkspaceID,
		input.AfterEventID,
		limit+1,
	)
	if err != nil {
		return PullResponse{}, fmt.Errorf("query sync events: %w", err)
	}
	defer rows.Close()

	events := make([]PullEvent, 0, limit)
	for rows.Next() {
		var (
			event     PullEvent
			payload   []byte
			createdAt time.Time
		)
		if err := rows.Scan(
			&event.ID,
			&event.EntityType,
			&event.EntityID,
			&event.EventType,
			&event.EntityVersion,
			&payload,
			&createdAt,
		); err != nil {
			return PullResponse{}, fmt.Errorf("scan sync event: %w", err)
		}
		if err := json.Unmarshal(payload, &event.Payload); err != nil {
			return PullResponse{}, fmt.Errorf("decode sync event payload: %w", err)
		}
		if event.Payload == nil {
			event.Payload = map[string]any{}
		}
		event.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return PullResponse{}, fmt.Errorf("iterate sync events: %w", err)
	}

	hasMore := len(events) > limit
	if hasMore {
		events = events[:limit]
	}

	toEventID := input.AfterEventID
	if len(events) > 0 {
		toEventID = events[len(events)-1].ID
	}

	return PullResponse{
		WorkspaceID: input.WorkspaceID,
		FromEventID: input.AfterEventID,
		ToEventID:   toEventID,
		HasMore:     hasMore,
		Events:      events,
	}, nil
}

func normalizeLimit(limit int) int {
	if limit <= 0 {
		return defaultPullLimit
	}
	if limit > maxPullLimit {
		return maxPullLimit
	}
	return limit
}
