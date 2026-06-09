package card

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
	Create(ctx context.Context, input CreateInput) (Card, error)
	List(ctx context.Context, input ListInput) ([]Card, error)
	Get(ctx context.Context, input GetInput) (Card, error)
	Update(ctx context.Context, input UpdateInput) (Card, error)
	Delete(ctx context.Context, input DeleteInput) (Card, error)
	Restore(ctx context.Context, input DeleteInput) (Card, error)
	Purge(ctx context.Context, input DeleteInput) (Card, error)
}

type Handler struct {
	service service
}

type createRequest struct {
	KBID      string         `json:"kbId"`
	ParentID  *string        `json:"parentId"`
	Name      string         `json:"name"`
	SortOrder int32          `json:"sortOrder"`
	Status    string         `json:"status"`
	MetaJSON  map[string]any `json:"metaJson"`
}

type updateRequest struct {
	Name      *string         `json:"name"`
	SortOrder *int32          `json:"sortOrder"`
	Status    *string         `json:"status"`
	MetaJSON  *map[string]any `json:"metaJson"`
}

func NewHandler(service service) *Handler {
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
		KBID:        req.KBID,
		ParentID:    req.ParentID,
		Name:        req.Name,
		SortOrder:   req.SortOrder,
		Status:      req.Status,
		MetaJSON:    req.MetaJSON,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidCardName):
			_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "卡片名称不能为空", map[string]any{
				"name": "name is required",
			})
		case errors.Is(err, ErrInvalidParentCardID):
			_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "parentId 不能为空字符串", map[string]any{
				"parentId": "parentId must not be empty when provided",
			})
		case errors.Is(err, workspace.ErrWorkspaceNotFound):
			_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
		case errors.Is(err, ErrKnowledgeBaseNotFound):
			_ = httpapi.WriteError(w, http.StatusNotFound, "knowledge_base_not_found", "知识库不存在或不属于当前工作区", nil)
		case errors.Is(err, ErrKnowledgeBaseDeleted):
			_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_deleted", "知识库已删除，无法创建卡片", nil)
		case errors.Is(err, ErrParentCardNotFound):
			_ = httpapi.WriteError(w, http.StatusNotFound, "parent_card_not_found", "父卡片不存在或不属于当前工作区", nil)
		case errors.Is(err, ErrParentCardDeleted):
			_ = httpapi.WriteError(w, http.StatusConflict, "parent_card_deleted", "父卡片已删除，无法作为新卡片的父节点", nil)
		case errors.Is(err, ErrParentCardKnowledgeBaseMismatch):
			_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "父卡片不属于当前知识库", map[string]any{
				"parentId": "parent card must belong to the same knowledge base",
			})
		default:
			_ = httpapi.WriteError(w, http.StatusInternalServerError, "create_card_failed", "创建卡片失败", nil)
		}
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, ok := parseWorkspaceRoute(w, r)
	if !ok {
		return
	}

	kbID := r.URL.Query().Get("kbId")
	parentID := queryStringPointer(r, "parentId")

	items, err := h.service.List(r.Context(), ListInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		KBID:        kbID,
		ParentID:    parentID,
	})
	if err != nil {
		h.writeServiceError(w, err, "list_cards_failed", "读取卡片列表失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, items)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, cardID, ok := parseCardRoute(w, r)
	if !ok {
		return
	}

	item, err := h.service.Get(r.Context(), GetInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		CardID:      cardID,
	})
	if err != nil {
		h.writeServiceError(w, err, "get_card_failed", "读取卡片失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, cardID, ok := parseCardRoute(w, r)
	if !ok {
		return
	}

	var req updateRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	item, err := h.service.Update(r.Context(), UpdateInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		CardID:      cardID,
		Name:        req.Name,
		SortOrder:   req.SortOrder,
		Status:      req.Status,
		MetaJSON:    req.MetaJSON,
	})
	if err != nil {
		h.writeServiceError(w, err, "update_card_failed", "更新卡片失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, cardID, ok := parseCardRoute(w, r)
	if !ok {
		return
	}

	item, err := h.service.Delete(r.Context(), DeleteInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		CardID:      cardID,
	})
	if err != nil {
		h.writeServiceError(w, err, "delete_card_failed", "删除卡片失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Restore(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, cardID, ok := parseCardRoute(w, r)
	if !ok {
		return
	}

	item, err := h.service.Restore(r.Context(), DeleteInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		CardID:      cardID,
	})
	if err != nil {
		h.writeServiceError(w, err, "restore_card_failed", "恢复卡片失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Purge(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, cardID, ok := parseCardRoute(w, r)
	if !ok {
		return
	}

	item, err := h.service.Purge(r.Context(), DeleteInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		CardID:      cardID,
	})
	if err != nil {
		h.writeServiceError(w, err, "purge_card_failed", "彻底删除卡片失败")
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

func parseWorkspaceRoute(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		_ = httpapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "未登录或登录已过期", nil)
		return "", "", false
	}

	workspaceID := chi.URLParam(r, "workspaceId")
	if workspaceID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_workspace_id", "缺少 workspaceId", nil)
		return "", "", false
	}
	return userID, workspaceID, true
}

func parseCardRoute(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	userID, workspaceID, ok := parseWorkspaceRoute(w, r)
	if !ok {
		return "", "", "", false
	}

	cardID := chi.URLParam(r, "cardId")
	if cardID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_card_id", "缺少 cardId", nil)
		return "", "", "", false
	}
	return userID, workspaceID, cardID, true
}

func queryStringPointer(r *http.Request, key string) *string {
	values := r.URL.Query()
	if _, ok := values[key]; !ok {
		return nil
	}
	value := values.Get(key)
	return &value
}

func (h *Handler) writeServiceError(w http.ResponseWriter, err error, fallbackCode string, fallbackMessage string) {
	switch {
	case errors.Is(err, ErrInvalidKnowledgeBaseID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "缺少 kbId", map[string]any{
			"kbId": "kbId is required",
		})
	case errors.Is(err, ErrInvalidCardID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "缺少 cardId", map[string]any{
			"cardId": "cardId is required",
		})
	case errors.Is(err, ErrInvalidCardName):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "卡片名称不能为空", map[string]any{
			"name": "name is required",
		})
	case errors.Is(err, ErrInvalidCardStatus):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "卡片状态不能为空字符串", map[string]any{
			"status": "status must not be empty when provided",
		})
	case errors.Is(err, ErrInvalidParentCardID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "parentId 不能为空字符串", map[string]any{
			"parentId": "parentId must not be empty when provided",
		})
	case errors.Is(err, ErrNoCardChanges):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "至少提供一个可更新字段", nil)
	case errors.Is(err, workspace.ErrWorkspaceNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
	case errors.Is(err, ErrKnowledgeBaseNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "knowledge_base_not_found", "知识库不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrCardNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "card_not_found", "卡片不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrParentCardNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "parent_card_not_found", "父卡片不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrKnowledgeBaseDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_deleted", "知识库已删除，无法执行该操作", nil)
	case errors.Is(err, ErrCardAlreadyDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_deleted", "卡片已删除", nil)
	case errors.Is(err, ErrCardNotDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_not_deleted", "请先删除卡片后再执行该操作", nil)
	case errors.Is(err, ErrParentCardDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "parent_card_deleted", "父卡片已删除，无法作为目标父节点", nil)
	case errors.Is(err, ErrParentCardKnowledgeBaseMismatch):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "父卡片不属于当前知识库", map[string]any{
			"parentId": "parent card must belong to the same knowledge base",
		})
	case errors.Is(err, ErrCardHasChildren):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_has_children", "卡片下仍有子节点，无法彻底删除", nil)
	case errors.Is(err, ErrCardHasDocuments):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_has_documents", "卡片下仍有关联文档，无法彻底删除", nil)
	case errors.Is(err, ErrCardHasAttachments):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_has_attachments", "卡片下仍有关联附件，无法彻底删除", nil)
	default:
		_ = httpapi.WriteError(w, http.StatusInternalServerError, fallbackCode, fallbackMessage, nil)
	}
}
