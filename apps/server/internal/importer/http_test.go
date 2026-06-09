package importer

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"topomind/apps/server/internal/auth"
)

type stubService struct {
	createImportJob func(context.Context, CreateImportJobInput) (ImportJob, error)
	getImportJob    func(context.Context, GetImportJobInput) (ImportJob, error)
	getImportReport func(context.Context, GetImportJobInput) (ImportReport, error)
}

func (s stubService) CreateImportJob(ctx context.Context, input CreateImportJobInput) (ImportJob, error) {
	return s.createImportJob(ctx, input)
}

func (s stubService) GetImportJob(ctx context.Context, input GetImportJobInput) (ImportJob, error) {
	return s.getImportJob(ctx, input)
}

func (s stubService) GetImportReport(ctx context.Context, input GetImportJobInput) (ImportReport, error) {
	return s.getImportReport(ctx, input)
}

func TestCreateParsesMultipartZipUpload(t *testing.T) {
	t.Parallel()

	var gotInput CreateImportJobInput
	handler := NewHandler(stubService{
		createImportJob: func(_ context.Context, input CreateImportJobInput) (ImportJob, error) {
			gotInput = input
			body, err := io.ReadAll(input.SourceBody)
			if err != nil {
				t.Fatalf("read source body: %v", err)
			}
			if got, want := string(body), "zip-bytes"; got != want {
				t.Fatalf("unexpected source body: got %q want %q", got, want)
			}
			return ImportJob{ID: "job-1", WorkspaceID: input.WorkspaceID, SourceFileName: input.SourceFileName, Status: StatusPending, Stage: StageSourceImport}, nil
		},
		getImportJob: func(context.Context, GetImportJobInput) (ImportJob, error) {
			return ImportJob{}, nil
		},
		getImportReport: func(context.Context, GetImportJobInput) (ImportReport, error) {
			return ImportReport{}, nil
		},
	})

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "workspace.zip")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write([]byte("zip-bytes")); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "http://api.example.test/workspaces/ws-1/imports", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req = req.WithContext(auth.WithUserID(req.Context(), "user-1"))
	rec := httptest.NewRecorder()

	handler.Create(rec, withRouteParams(req, map[string]string{"workspaceId": "ws-1"}))

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if gotInput.UserID != "user-1" || gotInput.WorkspaceID != "ws-1" || gotInput.SourceFileName != "workspace.zip" {
		t.Fatalf("unexpected input: %+v", gotInput)
	}
}

func TestReportReturnsJSONPayload(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		createImportJob: func(context.Context, CreateImportJobInput) (ImportJob, error) { return ImportJob{}, nil },
		getImportJob:    func(context.Context, GetImportJobInput) (ImportJob, error) { return ImportJob{}, nil },
		getImportReport: func(_ context.Context, input GetImportJobInput) (ImportReport, error) {
			if input.UserID != "user-1" || input.WorkspaceID != "ws-1" || input.ImportJobID != "job-1" {
				t.Fatalf("unexpected input: %+v", input)
			}
			return ImportReport{
				ImportJobID: "job-1",
				Status:      StatusFailed,
				Stage:       StageReport,
				ReportJSON: map[string]any{
					"error": "zip import parser not implemented yet",
				},
			}, nil
		},
	})

	req := httptest.NewRequest(http.MethodGet, "http://api.example.test/workspaces/ws-1/imports/job-1/report", nil)
	req = req.WithContext(auth.WithUserID(req.Context(), "user-1"))
	rec := httptest.NewRecorder()

	handler.Report(rec, withRouteParams(req, map[string]string{
		"workspaceId": "ws-1",
		"importJobId": "job-1",
	}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var payload struct {
		OK   bool         `json:"ok"`
		Data ImportReport `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK || payload.Data.ImportJobID != "job-1" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

func withRouteParams(r *http.Request, values map[string]string) *http.Request {
	routeCtx := chi.NewRouteContext()
	for key, value := range values {
		routeCtx.URLParams.Add(key, value)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, routeCtx))
}
