package importer

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"topomind/apps/server/internal/auth"
	httpapi "topomind/apps/server/internal/http"
	"topomind/apps/server/internal/workspace"
)

const maxImportUploadBytes = 256 << 20

type service interface {
	CreateImportJob(ctx context.Context, input CreateImportJobInput) (ImportJob, error)
	GetImportJob(ctx context.Context, input GetImportJobInput) (ImportJob, error)
	GetImportReport(ctx context.Context, input GetImportJobInput) (ImportReport, error)
}

type Handler struct {
	service service
}

func NewHandler(service service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, ok := parseWorkspaceRoute(w, r)
	if !ok {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxImportUploadBytes)
	if err := r.ParseMultipartForm(maxImportUploadBytes); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_multipart_form", "导入请求必须是 multipart/form-data，且文件大小需在限制内", nil)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_import_file", "缺少 zip 文件字段 file", map[string]any{
			"file": "multipart field file is required",
		})
		return
	}
	defer file.Close()

	job, err := h.service.CreateImportJob(r.Context(), CreateImportJobInput{
		UserID:         userID,
		WorkspaceID:    workspaceID,
		SourceFileName: header.Filename,
		SourceBody:     file,
	})
	if err != nil {
		h.writeServiceError(w, err, "create_import_job_failed", "创建导入任务失败")
		return
	}
	_ = httpapi.WriteOK(w, http.StatusAccepted, job)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, importJobID, ok := parseImportJobRoute(w, r)
	if !ok {
		return
	}
	job, err := h.service.GetImportJob(r.Context(), GetImportJobInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		ImportJobID: importJobID,
	})
	if err != nil {
		h.writeServiceError(w, err, "get_import_job_failed", "读取导入任务失败")
		return
	}
	_ = httpapi.WriteOK(w, http.StatusOK, job)
}

func (h *Handler) Report(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, importJobID, ok := parseImportJobRoute(w, r)
	if !ok {
		return
	}
	report, err := h.service.GetImportReport(r.Context(), GetImportJobInput{
		UserID:      userID,
		WorkspaceID: workspaceID,
		ImportJobID: importJobID,
	})
	if err != nil {
		h.writeServiceError(w, err, "get_import_report_failed", "读取导入报告失败")
		return
	}
	_ = httpapi.WriteOK(w, http.StatusOK, report)
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

func parseImportJobRoute(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	userID, workspaceID, ok := parseWorkspaceRoute(w, r)
	if !ok {
		return "", "", "", false
	}
	importJobID := chi.URLParam(r, "importJobId")
	if importJobID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_import_job_id", "缺少 importJobId", nil)
		return "", "", "", false
	}
	return userID, workspaceID, importJobID, true
}

func (h *Handler) writeServiceError(w http.ResponseWriter, err error, fallbackCode string, fallbackMessage string) {
	switch {
	case errors.Is(err, ErrInvalidImportJobID):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "缺少 importJobId", map[string]any{
			"importJobId": "importJobId is required",
		})
	case errors.Is(err, ErrInvalidSourceFileName):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "导入文件名不能为空", map[string]any{
			"file": "file name is required",
		})
	case errors.Is(err, ErrInvalidImportFile):
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "导入文件不能为空", map[string]any{
			"file": "file body is required",
		})
	case errors.Is(err, ErrImportJobNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "import_job_not_found", "导入任务不存在或不属于当前工作区", nil)
	case errors.Is(err, workspace.ErrWorkspaceNotFound):
		_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
	default:
		_ = httpapi.WriteError(w, http.StatusInternalServerError, fallbackCode, fallbackMessage, nil)
	}
}
