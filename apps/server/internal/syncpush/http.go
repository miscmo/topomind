package syncpush

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"topomind/apps/server/internal/auth"
	"topomind/apps/server/internal/card"
	"topomind/apps/server/internal/document"
	"topomind/apps/server/internal/graphlayout"
	httpapi "topomind/apps/server/internal/http"
	"topomind/apps/server/internal/kb"
	"topomind/apps/server/internal/workspace"
)

type pushService interface {
	Push(ctx context.Context, input PushInput) (PushResponse, error)
}

type Handler struct {
	service pushService
}

type pushRequest struct {
	EntityType     string         `json:"entityType"`
	Operation      string         `json:"operation"`
	EntityID       string         `json:"entityId"`
	BaseVersion    int64          `json:"baseVersion"`
	IdempotencyKey string         `json:"idempotencyKey"`
	Payload        map[string]any `json:"payload"`
	Client         PushClient     `json:"client"`
}

func NewHandler(service pushService) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Push(w http.ResponseWriter, r *http.Request) {
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

	var req pushRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	response, err := h.service.Push(r.Context(), PushInput{
		UserID:         userID,
		WorkspaceID:    workspaceID,
		EntityType:     req.EntityType,
		Operation:      req.Operation,
		EntityID:       req.EntityID,
		BaseVersion:    req.BaseVersion,
		IdempotencyKey: req.IdempotencyKey,
		Payload:        req.Payload,
		Client:         req.Client,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, response)
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

func (h *Handler) writeServiceError(w http.ResponseWriter, err error) {
	var pushConflict *conflictError
	if errors.As(err, &pushConflict) {
		details := map[string]any{
			"serverVersion": pushConflict.ServerVersion,
			"serverEntity":  pushConflict.ServerEntity,
		}
		if pushConflict.ServerEventID > 0 {
			details["serverEventId"] = pushConflict.ServerEventID
		}
		code := pushConflict.Code
		if code == "" {
			code = "version_conflict"
		}
		message := pushConflict.Message
		if message == "" {
			message = "版本冲突"
		}
		_ = httpapi.WriteError(w, http.StatusConflict, code, message, details)
		return
	}

	switch {
	case errors.Is(err, workspace.ErrWorkspaceNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
	case errors.Is(err, kb.ErrKnowledgeBaseNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "knowledge_base_not_found", "知识库不存在或不属于当前工作区", nil)
	case errors.Is(err, kb.ErrKnowledgeBaseAlreadyDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_deleted", "知识库已删除", nil)
	case errors.Is(err, kb.ErrKnowledgeBaseNotDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_not_deleted", "请先删除知识库后再执行该操作", nil)
	case errors.Is(err, kb.ErrKnowledgeBaseHasCards):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_has_cards", "知识库下仍有关联卡片，无法彻底删除", nil)
	case errors.Is(err, kb.ErrInvalidKnowledgeBaseName):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "知识库名称不能为空", map[string]any{"name": "name is required"})
	case errors.Is(err, kb.ErrNoKnowledgeBaseChanges):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "至少提供一个可更新字段", nil)
	case errors.Is(err, card.ErrCardNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "card_not_found", "卡片不存在或不属于当前工作区", nil)
	case errors.Is(err, card.ErrKnowledgeBaseNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "knowledge_base_not_found", "知识库不存在或不属于当前工作区", nil)
	case errors.Is(err, card.ErrParentCardNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "parent_card_not_found", "父卡片不存在或不属于当前工作区", nil)
	case errors.Is(err, card.ErrKnowledgeBaseDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_deleted", "知识库已删除，无法执行该操作", nil)
	case errors.Is(err, card.ErrCardAlreadyDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_deleted", "卡片已删除", nil)
	case errors.Is(err, card.ErrCardNotDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_not_deleted", "请先删除卡片后再执行该操作", nil)
	case errors.Is(err, card.ErrParentCardDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "parent_card_deleted", "父卡片已删除，无法作为目标父节点", nil)
	case errors.Is(err, card.ErrCardHasChildren):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_has_children", "卡片下仍有子节点，无法彻底删除", nil)
	case errors.Is(err, card.ErrCardHasDocuments):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_has_documents", "卡片下仍有关联文档，无法彻底删除", nil)
	case errors.Is(err, card.ErrCardHasAttachments):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_has_attachments", "卡片下仍有关联附件，无法彻底删除", nil)
	case errors.Is(err, card.ErrInvalidCardName):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "卡片名称不能为空", map[string]any{"name": "name is required"})
	case errors.Is(err, card.ErrInvalidCardStatus):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "卡片状态不能为空字符串", map[string]any{"status": "status must not be empty when provided"})
	case errors.Is(err, card.ErrInvalidParentCardID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "parentId 不能为空字符串", map[string]any{"parentId": "parentId must not be empty when provided"})
	case errors.Is(err, card.ErrParentCardKnowledgeBaseMismatch):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "父卡片不属于当前知识库", map[string]any{"parentId": "parent card must belong to the same knowledge base"})
	case errors.Is(err, card.ErrNoCardChanges):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "至少提供一个可更新字段", nil)
	case errors.Is(err, document.ErrDocumentNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "document_not_found", "文档不存在或不属于当前工作区", nil)
	case errors.Is(err, document.ErrCardNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "card_not_found", "卡片不存在或不属于当前工作区", nil)
	case errors.Is(err, document.ErrCardDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_deleted", "卡片已删除，无法执行该操作", nil)
	case errors.Is(err, document.ErrDocumentAlreadyDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "document_deleted", "文档已删除", nil)
	case errors.Is(err, document.ErrDocumentNotDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "document_not_deleted", "请先删除文档后再执行该操作", nil)
	case errors.Is(err, document.ErrParentDocumentNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "parent_document_not_found", "父文档不存在或不属于当前卡片", nil)
	case errors.Is(err, document.ErrParentDocumentDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "parent_document_deleted", "父文档已删除，无法作为目标父文档", nil)
	case errors.Is(err, document.ErrParentDocumentCardMismatch):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "父文档不属于当前卡片", map[string]any{"parentDocumentId": "parent document must belong to the same card"})
	case errors.Is(err, document.ErrDocumentCycleDetected):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "父文档形成循环引用", map[string]any{"parentDocumentId": "cycle detected"})
	case errors.Is(err, document.ErrInvalidDocumentTitle):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "文档标题不能为空", map[string]any{"title": "title is required"})
	case errors.Is(err, document.ErrInvalidDocumentType):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "文档类型不合法", map[string]any{"type": "unsupported document type"})
	case errors.Is(err, document.ErrInvalidDocumentContentJSON):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "contentJson 必须是对象", map[string]any{"contentJson": "contentJson must be an object"})
	case errors.Is(err, document.ErrInvalidBaseVersion), errors.Is(err, graphlayout.ErrInvalidBaseVersion):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "baseVersion 必须合法", map[string]any{"baseVersion": "baseVersion is invalid"})
	case errors.Is(err, document.ErrInvalidSchemaVersion):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "schemaVersion 必须是正整数", map[string]any{"schemaVersion": "schemaVersion must be a positive integer"})
	case errors.Is(err, document.ErrNoDocumentChanges):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "至少提供一个可更新字段", nil)
	case errors.Is(err, graphlayout.ErrGraphLayoutNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "graph_layout_not_found", "图谱布局不存在或不属于当前工作区", nil)
	case errors.Is(err, graphlayout.ErrKnowledgeBaseNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "knowledge_base_not_found", "知识库不存在或不属于当前工作区", nil)
	case errors.Is(err, graphlayout.ErrRoomCardNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "room_card_not_found", "房间卡片不存在或不属于当前工作区", nil)
	case errors.Is(err, graphlayout.ErrKnowledgeBaseDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_deleted", "知识库已删除，无法保存布局", nil)
	case errors.Is(err, graphlayout.ErrRoomCardDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "room_card_deleted", "房间卡片已删除，无法保存布局", nil)
	case errors.Is(err, graphlayout.ErrGraphLayoutScopeMismatch):
		_ = httpapi.WriteError(w, http.StatusConflict, "graph_layout_scope_conflict", "layoutId 与 kbId/roomCardId 不匹配", nil)
	case errors.Is(err, graphlayout.ErrNoGraphLayoutChanges):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "至少提供一个局部变更字段", nil)
	case errors.Is(err, graphlayout.ErrRoomCardKnowledgeBaseMismatch):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "roomCardId 不属于当前知识库", map[string]any{"roomCardId": "room card must belong to the same knowledge base"})
	case err.Error() == "invalid entity type":
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "entityType 不支持", map[string]any{"entityType": "unsupported entityType"})
	case err.Error() == "invalid operation":
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "operation 不支持", map[string]any{"operation": "unsupported operation"})
	case err.Error() == "invalid entity id":
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "entityId 不能为空", map[string]any{"entityId": "entityId is required"})
	case err.Error() == "invalid idempotency key":
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "idempotencyKey 不能为空", map[string]any{"idempotencyKey": "idempotencyKey is required"})
	case err.Error() == "attachment sync push is not supported yet":
		_ = httpapi.WriteError(w, http.StatusNotImplemented, "attachment_sync_push_not_ready", "附件 sync push 尚未实现", nil)
	case err.Error() == "create baseVersion must be 0":
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "create 操作的 baseVersion 必须为 0", map[string]any{"baseVersion": "baseVersion must be 0 for create"})
	case err.Error() == "unsupported operation":
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "当前实体暂不支持该 operation", nil)
	default:
		_ = httpapi.WriteError(w, http.StatusInternalServerError, "sync_push_failed", "写入同步变更失败", nil)
	}
}
