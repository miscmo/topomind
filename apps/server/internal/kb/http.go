package kb

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

type createService interface {
	Create(ctx context.Context, input CreateInput) (KnowledgeBase, error)
	Update(ctx context.Context, input UpdateInput) (KnowledgeBase, error)
	Delete(ctx context.Context, input DeleteInput) (KnowledgeBase, error)
	Restore(ctx context.Context, input DeleteInput) (KnowledgeBase, error)
	Purge(ctx context.Context, input DeleteInput) (KnowledgeBase, error)
}

type Handler struct {
	service createService
}

type createRequest struct {
	Name      string `json:"name"`
	SortOrder int32  `json:"sortOrder"`
}

type updateRequest struct {
	Name      *string `json:"name"`
	SortOrder *int32  `json:"sortOrder"`
}

func NewHandler(service createService) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
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

	var req createRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	item, err := h.service.Create(r.Context(), CreateInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		Name:        req.Name,
		SortOrder:   req.SortOrder,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidKnowledgeBaseName):
			_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "知识库名称不能为空", map[string]any{
				"name": "name is required",
			})
		case errors.Is(err, workspace.ErrWorkspaceNotFound):
			_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
		default:
			_ = httpapi.WriteError(w, http.StatusInternalServerError, "create_knowledge_base_failed", "创建知识库失败", nil)
		}
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, knowledgeBaseID, ok := parseMutationRoute(w, r)
	if !ok {
		return
	}

	var req updateRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	item, err := h.service.Update(r.Context(), UpdateInput{
		UserID:          userID,
		WorkspaceID:     workspaceID,
		KnowledgeBaseID: knowledgeBaseID,
		Name:            req.Name,
		SortOrder:       req.SortOrder,
	})
	if err != nil {
		h.writeServiceError(w, err, "update_knowledge_base_failed", "更新知识库失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, knowledgeBaseID, ok := parseMutationRoute(w, r)
	if !ok {
		return
	}

	item, err := h.service.Delete(r.Context(), DeleteInput{
		UserID:          userID,
		WorkspaceID:     workspaceID,
		KnowledgeBaseID: knowledgeBaseID,
	})
	if err != nil {
		h.writeServiceError(w, err, "delete_knowledge_base_failed", "删除知识库失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Restore(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, knowledgeBaseID, ok := parseMutationRoute(w, r)
	if !ok {
		return
	}

	item, err := h.service.Restore(r.Context(), DeleteInput{
		UserID:          userID,
		WorkspaceID:     workspaceID,
		KnowledgeBaseID: knowledgeBaseID,
	})
	if err != nil {
		h.writeServiceError(w, err, "restore_knowledge_base_failed", "恢复知识库失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Purge(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, knowledgeBaseID, ok := parseMutationRoute(w, r)
	if !ok {
		return
	}

	item, err := h.service.Purge(r.Context(), DeleteInput{
		UserID:          userID,
		WorkspaceID:     workspaceID,
		KnowledgeBaseID: knowledgeBaseID,
	})
	if err != nil {
		h.writeServiceError(w, err, "purge_knowledge_base_failed", "彻底删除知识库失败")
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

func parseMutationRoute(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
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

	knowledgeBaseID := chi.URLParam(r, "kbId")
	if knowledgeBaseID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_knowledge_base_id", "缺少 kbId", nil)
		return "", "", "", false
	}

	return userID, workspaceID, knowledgeBaseID, true
}

func (h *Handler) writeServiceError(w http.ResponseWriter, err error, fallbackCode string, fallbackMessage string) {
	switch {
	case errors.Is(err, ErrInvalidKnowledgeBaseName):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "知识库名称不能为空", map[string]any{
			"name": "name is required",
		})
	case errors.Is(err, ErrNoKnowledgeBaseChanges):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "至少提供一个可更新字段", nil)
	case errors.Is(err, workspace.ErrWorkspaceNotFound), errors.Is(err, ErrKnowledgeBaseNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "knowledge_base_not_found", "知识库不存在或无权访问", nil)
	case errors.Is(err, ErrKnowledgeBaseAlreadyDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_deleted", "知识库已删除", nil)
	case errors.Is(err, ErrKnowledgeBaseNotDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_not_deleted", "请先删除知识库后再执行该操作", nil)
	case errors.Is(err, ErrKnowledgeBaseHasCards):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_has_cards", "知识库下仍有关联卡片，无法彻底删除", nil)
	default:
		_ = httpapi.WriteError(w, http.StatusInternalServerError, fallbackCode, fallbackMessage, nil)
	}
}
