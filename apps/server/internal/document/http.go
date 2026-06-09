package document

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
	Create(ctx context.Context, input CreateInput) (Document, error)
	List(ctx context.Context, input ListInput) ([]Document, error)
	Get(ctx context.Context, input GetInput) (Document, error)
	Update(ctx context.Context, input UpdateInput) (Document, error)
	Move(ctx context.Context, input MoveInput) (Document, error)
	Delete(ctx context.Context, input DeleteInput) (Document, error)
	SaveContent(ctx context.Context, input SaveContentInput) (Document, error)
}

type Handler struct {
	service service
}

type createRequest struct {
	Type             string  `json:"type"`
	Title            string  `json:"title"`
	ParentDocumentID *string `json:"parentDocumentId"`
	SortOrder        int32   `json:"sortOrder"`
}

type optionalStringField struct {
	Set   bool
	Value *string
}

func (f *optionalStringField) UnmarshalJSON(data []byte) error {
	f.Set = true
	if string(data) == "null" {
		f.Value = nil
		return nil
	}
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	f.Value = &value
	return nil
}

type updateRequest struct {
	Title            *string             `json:"title"`
	ParentDocumentID optionalStringField `json:"parentDocumentId"`
	SortOrder        *int32              `json:"sortOrder"`
}

type moveRequest struct {
	ParentDocumentID optionalStringField `json:"parentDocumentId"`
	SortOrder        int32               `json:"sortOrder"`
}

type saveContentRequest struct {
	BaseVersion   int64 `json:"baseVersion"`
	SchemaVersion int32 `json:"schemaVersion"`
	ContentJSON   any   `json:"contentJson"`
}

func NewHandler(service service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, cardID, ok := parseCardRoute(w, r)
	if !ok {
		return
	}

	var req createRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	item, err := h.service.Create(r.Context(), CreateInput{
		UserID:           userID,
		WorkspaceID:      workspaceID,
		CardID:           cardID,
		Type:             req.Type,
		Title:            req.Title,
		ParentDocumentID: req.ParentDocumentID,
		SortOrder:        req.SortOrder,
	})
	if err != nil {
		h.writeServiceError(w, err, "create_document_failed", "创建文档失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, cardID, ok := parseCardRoute(w, r)
	if !ok {
		return
	}

	items, err := h.service.List(r.Context(), ListInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		CardID:      cardID,
	})
	if err != nil {
		h.writeServiceError(w, err, "list_documents_failed", "读取文档列表失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, items)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, documentID, ok := parseDocumentRoute(w, r)
	if !ok {
		return
	}

	item, err := h.service.Get(r.Context(), GetInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		DocumentID:  documentID,
	})
	if err != nil {
		h.writeServiceError(w, err, "get_document_failed", "读取文档失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, documentID, ok := parseDocumentRoute(w, r)
	if !ok {
		return
	}

	var req updateRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	item, err := h.service.Update(r.Context(), UpdateInput{
		UserID:              userID,
		WorkspaceID:         workspaceID,
		DocumentID:          documentID,
		Title:               req.Title,
		ParentDocumentID:    req.ParentDocumentID.Value,
		ParentDocumentIDSet: req.ParentDocumentID.Set,
		SortOrder:           req.SortOrder,
	})
	if err != nil {
		h.writeServiceError(w, err, "update_document_failed", "更新文档失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Move(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, documentID, ok := parseDocumentRoute(w, r)
	if !ok {
		return
	}

	var req moveRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	item, err := h.service.Move(r.Context(), MoveInput{
		UserID:           userID,
		WorkspaceID:      workspaceID,
		DocumentID:       documentID,
		ParentDocumentID: req.ParentDocumentID.Value,
		SortOrder:        req.SortOrder,
	})
	if err != nil {
		h.writeServiceError(w, err, "move_document_failed", "移动文档失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, documentID, ok := parseDocumentRoute(w, r)
	if !ok {
		return
	}

	item, err := h.service.Delete(r.Context(), DeleteInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		DocumentID:  documentID,
	})
	if err != nil {
		h.writeServiceError(w, err, "delete_document_failed", "删除文档失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, item)
}

func (h *Handler) SaveContent(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, documentID, ok := parseDocumentRoute(w, r)
	if !ok {
		return
	}

	var req saveContentRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	contentJSON, ok := req.ContentJSON.(map[string]any)
	if !ok {
		h.writeServiceError(w, ErrInvalidDocumentContentJSON, "save_document_content_failed", "保存文档内容失败")
		return
	}

	item, err := h.service.SaveContent(r.Context(), SaveContentInput{
		UserID:        userID,
		WorkspaceID:   workspaceID,
		DocumentID:    documentID,
		BaseVersion:   req.BaseVersion,
		SchemaVersion: req.SchemaVersion,
		ContentJSON:   contentJSON,
	})
	if err != nil {
		h.writeServiceError(w, err, "save_document_content_failed", "保存文档内容失败")
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

func parseCardRoute(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
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

	cardID := chi.URLParam(r, "cardId")
	if cardID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_card_id", "缺少 cardId", nil)
		return "", "", "", false
	}

	return userID, workspaceID, cardID, true
}

func parseDocumentRoute(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	userID, workspaceID, ok := parseWorkspaceRoute(w, r)
	if !ok {
		return "", "", "", false
	}

	documentID := chi.URLParam(r, "documentId")
	if documentID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_document_id", "缺少 documentId", nil)
		return "", "", "", false
	}
	return userID, workspaceID, documentID, true
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

func (h *Handler) writeServiceError(w http.ResponseWriter, err error, fallbackCode string, fallbackMessage string) {
	var versionConflictErr *VersionConflictError
	switch {
	case errors.Is(err, ErrInvalidCardID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "缺少 cardId", map[string]any{
			"cardId": "cardId is required",
		})
	case errors.Is(err, ErrInvalidDocumentType):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "文档类型不合法", map[string]any{
			"type": "type must be one of smart, mindmap, flowchart",
		})
	case errors.Is(err, ErrInvalidDocumentTitle):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "文档标题不能为空", map[string]any{
			"title": "title is required",
		})
	case errors.Is(err, ErrInvalidDocumentContentJSON):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "contentJson 必须是对象", map[string]any{
			"contentJson": "contentJson must be an object",
		})
	case errors.Is(err, ErrInvalidDocumentID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "缺少 documentId", map[string]any{
			"documentId": "documentId is required",
		})
	case errors.Is(err, ErrInvalidBaseVersion):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "baseVersion 必须是正整数", map[string]any{
			"baseVersion": "baseVersion must be a positive integer",
		})
	case errors.Is(err, ErrInvalidSchemaVersion):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "schemaVersion 必须是正整数", map[string]any{
			"schemaVersion": "schemaVersion must be a positive integer",
		})
	case errors.Is(err, ErrInvalidParentDocumentID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "parentDocumentId 不能为空字符串", map[string]any{
			"parentDocumentId": "parentDocumentId must not be empty when provided",
		})
	case errors.Is(err, ErrNoDocumentChanges):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "至少提供一个可更新字段", nil)
	case errors.Is(err, workspace.ErrWorkspaceNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
	case errors.Is(err, ErrCardNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "card_not_found", "卡片不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrCardDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_deleted", "卡片已删除，无法执行该操作", nil)
	case errors.Is(err, ErrDocumentNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "document_not_found", "文档不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrDocumentAlreadyDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "document_deleted", "文档已删除", nil)
	case errors.As(err, &versionConflictErr):
		_ = httpapi.WriteError(w, http.StatusConflict, "document_version_conflict", "文档版本冲突，请刷新后重试", map[string]any{
			"serverVersion": versionConflictErr.ServerVersion,
			"serverEntity":  versionConflictErr.ServerEntity,
		})
	case errors.Is(err, ErrDocumentCycleDetected):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "父文档形成循环引用", map[string]any{
			"parentDocumentId": "parent document must not create a cycle",
		})
	case errors.Is(err, ErrParentDocumentNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "parent_document_not_found", "父文档不存在或不属于当前卡片", nil)
	case errors.Is(err, ErrParentDocumentDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "parent_document_deleted", "父文档已删除，无法作为目标父文档", nil)
	case errors.Is(err, ErrParentDocumentCardMismatch):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "父文档不属于当前卡片", map[string]any{
			"parentDocumentId": "parent document must belong to the same card",
		})
	default:
		_ = httpapi.WriteError(w, http.StatusInternalServerError, fallbackCode, fallbackMessage, nil)
	}
}
