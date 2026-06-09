package syncapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"topomind/apps/server/internal/auth"
	httpapi "topomind/apps/server/internal/http"
	"topomind/apps/server/internal/workspace"
)

type Handler struct {
	service pullService
}

type pullService interface {
	Pull(ctx context.Context, input PullInput) (PullResponse, error)
}

func NewHandler(service pullService) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Pull(w http.ResponseWriter, r *http.Request) {
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

	afterEventID, err := parseInt64Query(r, "afterEventId", 0)
	if err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_after_event_id", "afterEventId 必须是非负整数", nil)
		return
	}
	limit, err := parseIntQuery(r, "limit", 0)
	if err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_limit", "limit 必须是正整数", nil)
		return
	}

	response, err := h.service.Pull(r.Context(), PullInput{
		UserID:       userID,
		WorkspaceID:  workspaceID,
		AfterEventID: afterEventID,
		Limit:        limit,
	})
	if err != nil {
		switch {
		case errors.Is(err, workspace.ErrWorkspaceNotFound):
			_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
		default:
			_ = httpapi.WriteError(w, http.StatusInternalServerError, "sync_pull_failed", "读取同步事件失败", nil)
		}
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, response)
}

func parseInt64Query(r *http.Request, key string, defaultValue int64) (int64, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return defaultValue, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, errors.New("invalid integer")
	}
	return value, nil
}

func parseIntQuery(r *http.Request, key string, defaultValue int) (int, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return defaultValue, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0, errors.New("invalid integer")
	}
	return value, nil
}
