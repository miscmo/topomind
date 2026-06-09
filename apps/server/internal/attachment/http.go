package attachment

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"topomind/apps/server/internal/auth"
	httpapi "topomind/apps/server/internal/http"
	"topomind/apps/server/internal/workspace"
)

type service interface {
	CreateUploadTicket(ctx context.Context, input CreateUploadTicketInput) (UploadTicket, error)
	UploadBinary(ctx context.Context, input UploadBinaryInput) error
	CommitUpload(ctx context.Context, input CommitUploadInput) (CommitResult, error)
	GetContent(ctx context.Context, input GetContentInput) (AttachmentContent, error)
	Delete(ctx context.Context, input DeleteInput) (Attachment, syncEvent, error)
	Restore(ctx context.Context, input DeleteInput) (Attachment, syncEvent, error)
	Purge(ctx context.Context, input DeleteInput) (Attachment, syncEvent, error)
}

type Handler struct {
	service service
}

type createUploadTicketRequest struct {
	KnowledgeBaseID string  `json:"knowledgeBaseId"`
	CardID          string  `json:"cardId"`
	DocumentID      *string `json:"documentId"`
	FileName        string  `json:"fileName"`
	MimeType        string  `json:"mimeType"`
	SizeBytes       int64   `json:"sizeBytes"`
}

type uploadTicketResponse struct {
	UploadURL        string            `json:"uploadUrl"`
	Method           string            `json:"method"`
	Headers          map[string]string `json:"headers"`
	StorageKey       string            `json:"storageKey"`
	ExpiresAt        string            `json:"expiresAt"`
	MaxSizeBytes     int64             `json:"maxSizeBytes"`
	AllowedMimeTypes []string          `json:"allowedMimeTypes"`
	CommitURL        string            `json:"commitUrl"`
	CommitToken      string            `json:"commitToken"`
}

type commitUploadRequest struct {
	SHA256 string `json:"sha256"`
}

type deleteResponse struct {
	Attachment Attachment `json:"attachment"`
	Event      syncEvent  `json:"event"`
}

func NewHandler(service service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CreateUploadTicket(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, ok := parseWorkspaceRoute(w, r)
	if !ok {
		return
	}

	var req createUploadTicketRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	ticket, err := h.service.CreateUploadTicket(r.Context(), CreateUploadTicketInput{
		UserID:          userID,
		WorkspaceID:     workspaceID,
		KnowledgeBaseID: req.KnowledgeBaseID,
		CardID:          req.CardID,
		DocumentID:      req.DocumentID,
		FileName:        req.FileName,
		MimeType:        req.MimeType,
		SizeBytes:       req.SizeBytes,
	})
	if err != nil {
		h.writeServiceError(w, err, "create_attachment_upload_ticket_failed", "创建附件上传票据失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, uploadTicketResponse{
		UploadURL:        buildAbsoluteURL(r, "/workspaces/"+workspaceID+"/attachments/upload", ticket.Token),
		Method:           ticket.Method,
		Headers:          ticket.Headers,
		StorageKey:       ticket.StorageKey,
		ExpiresAt:        ticket.ExpiresAt,
		MaxSizeBytes:     ticket.MaxSizeBytes,
		AllowedMimeTypes: ticket.AllowedMimeTypes,
		CommitURL:        buildAbsoluteURL(r, "/workspaces/"+workspaceID+"/attachments/commit", ticket.Token),
		CommitToken:      ticket.Token,
	})
}

func (h *Handler) UploadBinary(w http.ResponseWriter, r *http.Request) {
	workspaceID, token, ok := parseUnsignedRoute(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()

	if err := h.service.UploadBinary(r.Context(), UploadBinaryInput{
		WorkspaceID: workspaceID,
		Token:       token,
		Body:        r.Body,
	}); err != nil {
		h.writeServiceError(w, err, "upload_attachment_failed", "上传附件内容失败")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) CommitUpload(w http.ResponseWriter, r *http.Request) {
	workspaceID, token, ok := parseUnsignedRoute(w, r)
	if !ok {
		return
	}

	var req commitUploadRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	result, err := h.service.CommitUpload(r.Context(), CommitUploadInput{
		WorkspaceID: workspaceID,
		Token:       token,
		SHA256:      req.SHA256,
	})
	if err != nil {
		h.writeServiceError(w, err, "commit_attachment_failed", "提交附件元数据失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, result)
}

func (h *Handler) GetContent(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, attachmentID, ok := parseAttachmentRoute(w, r)
	if !ok {
		return
	}

	content, err := h.service.GetContent(r.Context(), GetContentInput{
		UserID:       userID,
		WorkspaceID:  workspaceID,
		AttachmentID: attachmentID,
	})
	if err != nil {
		h.writeServiceError(w, err, "get_attachment_content_failed", "读取附件内容失败")
		return
	}
	defer content.Reader.Close()

	contentType := strings.TrimSpace(content.Attachment.MimeType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(content.Attachment.SizeBytes, 10))
	if disposition := mime.FormatMediaType("inline", map[string]string{"filename": content.Attachment.FileName}); disposition != "" {
		w.Header().Set("Content-Disposition", disposition)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, content.Reader)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, attachmentID, ok := parseAttachmentRoute(w, r)
	if !ok {
		return
	}

	item, event, err := h.service.Delete(r.Context(), DeleteInput{
		UserID:       userID,
		WorkspaceID:  workspaceID,
		AttachmentID: attachmentID,
	})
	if err != nil {
		h.writeServiceError(w, err, "delete_attachment_failed", "删除附件失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, deleteResponse{
		Attachment: item,
		Event:      event,
	})
}

func (h *Handler) Restore(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, attachmentID, ok := parseAttachmentRoute(w, r)
	if !ok {
		return
	}

	item, event, err := h.service.Restore(r.Context(), DeleteInput{
		UserID:       userID,
		WorkspaceID:  workspaceID,
		AttachmentID: attachmentID,
	})
	if err != nil {
		h.writeServiceError(w, err, "restore_attachment_failed", "恢复附件失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, deleteResponse{
		Attachment: item,
		Event:      event,
	})
}

func (h *Handler) Purge(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, attachmentID, ok := parseAttachmentRoute(w, r)
	if !ok {
		return
	}

	item, event, err := h.service.Purge(r.Context(), DeleteInput{
		UserID:       userID,
		WorkspaceID:  workspaceID,
		AttachmentID: attachmentID,
	})
	if err != nil {
		h.writeServiceError(w, err, "purge_attachment_failed", "彻底删除附件失败")
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, deleteResponse{
		Attachment: item,
		Event:      event,
	})
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

func parseAttachmentRoute(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	userID, workspaceID, ok := parseWorkspaceRoute(w, r)
	if !ok {
		return "", "", "", false
	}

	attachmentID := chi.URLParam(r, "attachmentId")
	if attachmentID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_attachment_id", "缺少 attachmentId", nil)
		return "", "", "", false
	}
	return userID, workspaceID, attachmentID, true
}

func parseUnsignedRoute(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	workspaceID := chi.URLParam(r, "workspaceId")
	if workspaceID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_workspace_id", "缺少 workspaceId", nil)
		return "", "", false
	}

	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_upload_ticket", "缺少附件上传票据", nil)
		return "", "", false
	}
	return workspaceID, token, true
}

func buildAbsoluteURL(r *http.Request, routePath string, token string) string {
	scheme := "http"
	if forwardedProto := firstForwardedValue(r.Header.Get("X-Forwarded-Proto")); forwardedProto != "" {
		scheme = forwardedProto
	} else if r.TLS != nil {
		scheme = "https"
	}

	host := firstForwardedValue(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}

	values := url.Values{}
	values.Set("token", token)
	return scheme + "://" + host + routePath + "?" + values.Encode()
}

func firstForwardedValue(value string) string {
	parts := strings.Split(value, ",")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func (h *Handler) writeServiceError(w http.ResponseWriter, err error, fallbackCode string, fallbackMessage string) {
	switch {
	case errors.Is(err, ErrInvalidAttachmentTarget):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "必须且只能指定 knowledgeBaseId 或 cardId；documentId 仅可与 cardId 一起使用", map[string]any{
			"knowledgeBaseId": "provide knowledgeBaseId or cardId",
			"cardId":          "provide knowledgeBaseId or cardId",
			"documentId":      "documentId is only allowed when cardId is set",
		})
	case errors.Is(err, ErrInvalidKnowledgeBaseID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "knowledgeBaseId 不能为空字符串", map[string]any{
			"knowledgeBaseId": "knowledgeBaseId must not be empty when provided",
		})
	case errors.Is(err, ErrInvalidCardID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "cardId 不能为空字符串", map[string]any{
			"cardId": "cardId must not be empty when provided",
		})
	case errors.Is(err, ErrInvalidDocumentID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "documentId 不能为空字符串", map[string]any{
			"documentId": "documentId must not be empty when provided",
		})
	case errors.Is(err, ErrInvalidAttachmentID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "缺少 attachmentId", map[string]any{
			"attachmentId": "attachmentId is required",
		})
	case errors.Is(err, ErrInvalidFileName):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "fileName 不能为空", map[string]any{
			"fileName": "fileName is required",
		})
	case errors.Is(err, ErrInvalidMimeType):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "mimeType 不能为空", map[string]any{
			"mimeType": "mimeType is required",
		})
	case errors.Is(err, ErrInvalidSizeBytes):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "sizeBytes 必须是非负整数", map[string]any{
			"sizeBytes": "sizeBytes must be a non-negative integer",
		})
	case errors.Is(err, ErrInvalidCommitToken):
		_ = httpapi.WriteError(w, http.StatusUnauthorized, "invalid_upload_ticket", "附件上传票据无效或已过期", nil)
	case errors.Is(err, ErrAttachmentUploadNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "attachment_upload_not_found", "未找到待提交的附件上传内容", nil)
	case errors.Is(err, ErrAttachmentSizeMismatch):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "attachment_size_mismatch", "附件大小与 upload ticket 不一致", nil)
	case errors.Is(err, ErrAttachmentChecksumMismatch):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "attachment_checksum_mismatch", "附件校验和不匹配", nil)
	case errors.Is(err, ErrAttachmentNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "attachment_not_found", "附件不存在或已不可访问", nil)
	case errors.Is(err, ErrAttachmentAlreadyDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "attachment_deleted", "附件已删除", nil)
	case errors.Is(err, ErrAttachmentAlreadyActive):
		_ = httpapi.WriteError(w, http.StatusConflict, "attachment_active", "附件未被删除，无需恢复", nil)
	case errors.Is(err, ErrAttachmentNotDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "attachment_not_deleted", "附件未进入回收站，无法彻底删除", nil)
	case errors.Is(err, workspace.ErrWorkspaceNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
	case errors.Is(err, ErrKnowledgeBaseNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "knowledge_base_not_found", "知识库不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrKnowledgeBaseDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "knowledge_base_deleted", "知识库已删除，无法挂载附件", nil)
	case errors.Is(err, ErrCardNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "card_not_found", "卡片不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrCardDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "card_deleted", "卡片已删除，无法挂载附件", nil)
	case errors.Is(err, ErrDocumentNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "document_not_found", "文档不存在或不属于当前工作区", nil)
	case errors.Is(err, ErrDocumentDeleted):
		_ = httpapi.WriteError(w, http.StatusConflict, "document_deleted", "文档已删除，无法挂载附件", nil)
	case errors.Is(err, ErrDocumentCardMismatch):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "documentId 不属于当前 cardId", map[string]any{
			"documentId": "document must belong to the provided cardId",
		})
	default:
		_ = httpapi.WriteError(w, http.StatusInternalServerError, fallbackCode, fallbackMessage, nil)
	}
}
