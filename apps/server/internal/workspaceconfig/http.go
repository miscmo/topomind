package workspaceconfig

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"topomind/apps/server/internal/auth"
	httpapi "topomind/apps/server/internal/http"
	syncapi "topomind/apps/server/internal/sync"
	"topomind/apps/server/internal/workspace"
)

var ErrVersionConflict = errors.New("workspace config version conflict")

type Handler struct {
	pool        *pgxpool.Pool
	eventWriter *syncapi.EventWriter
}

type updateRequest struct {
	BaseVersion int64          `json:"baseVersion"`
	ConfigJSON  map[string]any `json:"configJson"`
}

type configItem struct {
	WorkspaceID string         `json:"workspaceId"`
	Version     int64          `json:"version"`
	ConfigJSON  map[string]any `json:"configJson"`
	UpdatedAt   *string        `json:"updatedAt"`
}

type updateResponse struct {
	Config configItem    `json:"config"`
	Event  syncapi.Event `json:"event"`
}

func NewHandler(pool *pgxpool.Pool, eventWriter *syncapi.EventWriter) *Handler {
	return &Handler{
		pool:        pool,
		eventWriter: eventWriter,
	}
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		_ = httpapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "未登录或登录已过期", nil)
		return
	}

	workspaceID := chi.URLParam(r, "workspaceId")
	if workspaceID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_workspace_id", "缺少 workspaceId", nil)
		return
	}

	var req updateRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if req.BaseVersion < 0 {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_base_version", "baseVersion 必须是非负整数", nil)
		return
	}
	if req.ConfigJSON == nil {
		req.ConfigJSON = map[string]any{}
	}

	item, event, err := h.update(r.Context(), userID, workspaceID, req)
	if err != nil {
		switch {
		case errors.Is(err, workspace.ErrWorkspaceNotFound):
			_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
		case errors.Is(err, ErrVersionConflict):
			_ = httpapi.WriteError(w, http.StatusConflict, "workspace_config_version_conflict", "工作区配置版本冲突，请刷新后重试", nil)
		default:
			_ = httpapi.WriteError(w, http.StatusInternalServerError, "update_workspace_config_failed", "保存工作区配置失败", nil)
		}
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, updateResponse{
		Config: item,
		Event:  event,
	})
}

func (h *Handler) update(
	ctx context.Context,
	userID string,
	workspaceID string,
	req updateRequest,
) (configItem, syncapi.Event, error) {
	tx, err := h.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return configItem{}, syncapi.Event{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := workspace.RequireMember(ctx, tx, workspaceID, userID); err != nil {
		return configItem{}, syncapi.Event{}, err
	}

	var (
		currentVersion int64
		hasExisting    bool
	)
	err = tx.QueryRow(
		ctx,
		`SELECT version
		 FROM workspace_configs
		 WHERE workspace_id = $1
		 FOR UPDATE`,
		workspaceID,
	).Scan(&currentVersion)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return configItem{}, syncapi.Event{}, err
		}
		currentVersion = 1
	} else {
		hasExisting = true
	}

	if currentVersion != req.BaseVersion {
		return configItem{}, syncapi.Event{}, ErrVersionConflict
	}

	configJSON, err := json.Marshal(req.ConfigJSON)
	if err != nil {
		return configItem{}, syncapi.Event{}, err
	}

	var (
		item      configItem
		updatedAt time.Time
		rawJSON   []byte
	)
	if hasExisting {
		err = tx.QueryRow(
			ctx,
			`UPDATE workspace_configs
			 SET version = version + 1,
			     config_json = $2::jsonb,
			     updated_at = NOW()
			 WHERE workspace_id = $1
			 RETURNING workspace_id, version, config_json, updated_at`,
			workspaceID,
			string(configJSON),
		).Scan(&item.WorkspaceID, &item.Version, &rawJSON, &updatedAt)
	} else {
		err = tx.QueryRow(
			ctx,
			`INSERT INTO workspace_configs (
			   workspace_id,
			   version,
			   config_json
			 )
			 VALUES ($1, $2, $3::jsonb)
			 RETURNING workspace_id, version, config_json, updated_at`,
			workspaceID,
			currentVersion+1,
			string(configJSON),
		).Scan(&item.WorkspaceID, &item.Version, &rawJSON, &updatedAt)
	}
	if err != nil {
		return configItem{}, syncapi.Event{}, err
	}
	if err := json.Unmarshal(rawJSON, &item.ConfigJSON); err != nil || item.ConfigJSON == nil {
		item.ConfigJSON = map[string]any{}
	}
	formattedUpdatedAt := updatedAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = &formattedUpdatedAt

	event, err := h.eventWriter.WriteEntityEventTx(ctx, tx, syncapi.WriteEntityEventInput{
		WorkspaceID:   workspaceID,
		EntityType:    syncapi.EntityTypeWorkspaceConfig,
		EntityID:      workspaceID,
		EventType:     syncapi.EventTypeUpdated,
		EntityVersion: item.Version,
		Snapshot:      item,
		ActorUserID:   userID,
	})
	if err != nil {
		return configItem{}, syncapi.Event{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return configItem{}, syncapi.Event{}, err
	}
	return item, event, nil
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()

	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return errors.New("请求体不能为空")
		}
		return errors.New("请求体不是合法 JSON")
	}

	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("请求体只能包含一个 JSON 对象")
	}

	return nil
}
