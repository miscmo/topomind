package graphlayout

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"topomind/apps/server/internal/auth"
	httpapi "topomind/apps/server/internal/http"
	"topomind/apps/server/internal/workspace"
)

type service interface {
	Get(ctx context.Context, input GetInput) (GraphLayout, error)
	Save(ctx context.Context, input SaveInput) (GraphLayout, error)
	Patch(ctx context.Context, input PatchInput) (GraphLayout, error)
}

type Handler struct {
	service service
}

type saveRequest struct {
	KBID         string  `json:"kbId"`
	RoomCardID   *string `json:"roomCardId"`
	BaseVersion  int64   `json:"baseVersion"`
	LayoutJSON   any     `json:"layoutJson"`
	ViewportJSON any     `json:"viewportJson"`
}

type patchRequest struct {
	KBID        string  `json:"kbId"`
	RoomCardID  *string `json:"roomCardId"`
	BaseVersion int64   `json:"baseVersion"`
	NodePatches any     `json:"nodePatches"`
	Viewport    any     `json:"viewport"`
}

func NewHandler(service service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, layoutID, ok := parseLayoutRoute(w, r)
	if !ok {
		return
	}
	item, err := h.service.Get(r.Context(), GetInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		LayoutID:    layoutID,
	})
	if err != nil {
		h.writeServiceError(w, err, "get_graph_layout_failed", "读取图谱布局失败")
		return
	}
	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Save(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, layoutID, ok := parseLayoutRoute(w, r)
	if !ok {
		return
	}

	var req saveRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	layoutJSON, ok := req.LayoutJSON.(map[string]any)
	if !ok {
		h.writeServiceError(w, ErrInvalidLayoutJSON, "save_graph_layout_failed", "保存图谱布局失败")
		return
	}
	viewportJSON, ok := req.ViewportJSON.(map[string]any)
	if !ok {
		h.writeServiceError(w, ErrInvalidViewportJSON, "save_graph_layout_failed", "保存图谱布局失败")
		return
	}

	item, err := h.service.Save(r.Context(), SaveInput{
		UserID:       userID,
		WorkspaceID:  workspaceID,
		LayoutID:     layoutID,
		KBID:         req.KBID,
		RoomCardID:   req.RoomCardID,
		BaseVersion:  req.BaseVersion,
		LayoutJSON:   layoutJSON,
		ViewportJSON: viewportJSON,
	})
	if err != nil {
		h.writeServiceError(w, err, "save_graph_layout_failed", "保存图谱布局失败")
		return
	}
	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, layoutID, ok := parseLayoutRoute(w, r)
	if !ok {
		return
	}

	var req patchRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	var nodePatches map[string]any
	if req.NodePatches != nil {
		castValue, ok := req.NodePatches.(map[string]any)
		if !ok {
			h.writeServiceError(w, ErrInvalidLayoutJSON, "patch_graph_layout_failed", "局部保存图谱布局失败")
			return
		}
		nodePatches = castValue
	}

	var viewport map[string]any
	if req.Viewport != nil {
		castValue, ok := req.Viewport.(map[string]any)
		if !ok {
			h.writeServiceError(w, ErrInvalidViewportJSON, "patch_graph_layout_failed", "局部保存图谱布局失败")
			return
		}
		viewport = castValue
	}

	item, err := h.service.Patch(r.Context(), PatchInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		LayoutID:    layoutID,
		KBID:        req.KBID,
		RoomCardID:  req.RoomCardID,
		BaseVersion: req.BaseVersion,
		NodePatches: nodePatches,
		Viewport:    viewport,
	})
	if err != nil {
		h.writeServiceError(w, err, "patch_graph_layout_failed", "局部保存图谱布局失败")
		return
	}
	_ = httpapi.WriteOK(w, http.StatusOK, item)
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

func parseLayoutRoute(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		_ = httpapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "未登录或登录已过期", nil)
		return "", "", "", false
	}
	workspaceID := chi.URLParam(r, "workspaceId")
	if workspaceID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_workspace_id", "缺少 workspaceId", nil)
		return "", "", "", false
	}
	layoutID := chi.URLParam(r, "layoutId")
	if layoutID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_graph_layout_id", "缺少 layoutId", nil)
		return "", "", "", false
	}
	return userID, workspaceID, layoutID, true
}

func (h *Handler) writeServiceError(w http.ResponseWriter, err error, fallbackCode string, fallbackMessage string) {
	var versionConflictErr *VersionConflictError
	switch {
	case errors.Is(err, ErrInvalidGraphLayoutID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "缺少 layoutId", map[string]any{
			"layoutId": "layoutId is required",
		})
	case errors.Is(err, ErrInvalidKnowledgeBaseID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "缺少 kbId", map[string]any{
			"kbId": "kbId is required",
		})
	case errors.Is(err, ErrInvalidRoomCardID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "roomCardId 不能为空字符串", map[string]any{
			"roomCardId": "roomCardId must not be empty when provided",
		})
	case errors.Is(err, ErrInvalidLayoutJSON):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "layoutJson 必须是对象", map[string]any{
			"layoutJson": "layoutJson must be an object",
		})
	case errors.Is(err, ErrInvalidViewportJSON):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "viewportJson 或 viewport 必须是对象", map[string]any{
			"viewport": "viewport must be an object",
		})
	case errors.Is(err, ErrInvalidBaseVersion):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "baseVersion 必须是非负整数", map[string]any{
			"baseVersion": "baseVersion must be a non-negative integer",
		})
	case errors.Is(err, ErrNoGraphLayoutChanges):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "至少提供一个局部变更字段", nil)
	case errors.Is(err, workspace.ErrWorkspaceNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
	case errors.Is(err, ErrKnowledgeBaseNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "knowledge_base_not_found", "知识库不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrKnowledgeBaseDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_deleted", "知识库已删除，无法保存布局", nil)
	case errors.Is(err, ErrRoomCardNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "room_card_not_found", "房间卡片不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrRoomCardDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "room_card_deleted", "房间卡片已删除，无法保存布局", nil)
	case errors.Is(err, ErrRoomCardKnowledgeBaseMismatch):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "roomCardId 不属于当前知识库", map[string]any{
			"roomCardId": "room card must belong to the same knowledge base",
		})
	case errors.Is(err, ErrGraphLayoutNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "graph_layout_not_found", "图谱布局不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrGraphLayoutScopeMismatch):
		_ = httpapi.WriteError(w, http.StatusConflict, "graph_layout_scope_conflict", "layoutId 与 kbId/roomCardId 不匹配", nil)
	case errors.As(err, &versionConflictErr):
		_ = httpapi.WriteError(w, http.StatusConflict, "graph_layout_version_conflict", "图谱布局版本冲突，请刷新后重试", map[string]any{
			"serverVersion": versionConflictErr.ServerVersion,
			"serverEntity":  versionConflictErr.ServerEntity,
		})
	default:
		_ = httpapi.WriteError(w, http.StatusInternalServerError, fallbackCode, fallbackMessage, nil)
	}
}
