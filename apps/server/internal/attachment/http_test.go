package attachment

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"topomind/apps/server/internal/auth"
)

type stubService struct {
	createUploadTicket func(context.Context, CreateUploadTicketInput) (UploadTicket, error)
	uploadBinary       func(context.Context, UploadBinaryInput) error
	commitUpload       func(context.Context, CommitUploadInput) (CommitResult, error)
	getContent         func(context.Context, GetContentInput) (AttachmentContent, error)
	deleteAttachment   func(context.Context, DeleteInput) (Attachment, syncEvent, error)
	restoreAttachment  func(context.Context, DeleteInput) (Attachment, syncEvent, error)
	purgeAttachment    func(context.Context, DeleteInput) (Attachment, syncEvent, error)
}

func (s stubService) CreateUploadTicket(ctx context.Context, input CreateUploadTicketInput) (UploadTicket, error) {
	return s.createUploadTicket(ctx, input)
}

func (s stubService) UploadBinary(ctx context.Context, input UploadBinaryInput) error {
	return s.uploadBinary(ctx, input)
}

func (s stubService) CommitUpload(ctx context.Context, input CommitUploadInput) (CommitResult, error) {
	return s.commitUpload(ctx, input)
}

func (s stubService) GetContent(ctx context.Context, input GetContentInput) (AttachmentContent, error) {
	return s.getContent(ctx, input)
}

func (s stubService) Delete(ctx context.Context, input DeleteInput) (Attachment, syncEvent, error) {
	return s.deleteAttachment(ctx, input)
}

func (s stubService) Restore(ctx context.Context, input DeleteInput) (Attachment, syncEvent, error) {
	return s.restoreAttachment(ctx, input)
}

func (s stubService) Purge(ctx context.Context, input DeleteInput) (Attachment, syncEvent, error) {
	return s.purgeAttachment(ctx, input)
}

func TestCreateUploadTicketReturnsSignedURLs(t *testing.T) {
	t.Parallel()

	var gotInput CreateUploadTicketInput
	handler := NewHandler(stubService{
		createUploadTicket: func(_ context.Context, input CreateUploadTicketInput) (UploadTicket, error) {
			gotInput = input
			return UploadTicket{
				Token:            "signed-token",
				Method:           "PUT",
				Headers:          map[string]string{"X-Test": "1"},
				StorageKey:       "workspaces/ws-1/attachments/file.png",
				ExpiresAt:        "2026-06-09T12:00:00Z",
				MaxSizeBytes:     123,
				AllowedMimeTypes: []string{"image/png"},
			}, nil
		},
		uploadBinary: func(context.Context, UploadBinaryInput) error { return nil },
		commitUpload: func(context.Context, CommitUploadInput) (CommitResult, error) { return CommitResult{}, nil },
		getContent:   func(context.Context, GetContentInput) (AttachmentContent, error) { return AttachmentContent{}, nil },
		deleteAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
		restoreAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
		purgeAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
	})

	body := bytes.NewBufferString(`{"knowledgeBaseId":"kb-1","fileName":"cover.png","mimeType":"image/png","sizeBytes":123}`)
	req := httptest.NewRequest(http.MethodPost, "http://api.example.test/workspaces/ws-1/attachments/upload-ticket", body)
	req = req.WithContext(auth.WithUserID(req.Context(), "user-1"))
	rec := httptest.NewRecorder()

	handler.CreateUploadTicket(rec, withRouteParams(req, map[string]string{
		"workspaceId": "ws-1",
	}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if gotInput.UserID != "user-1" || gotInput.WorkspaceID != "ws-1" || gotInput.KnowledgeBaseID != "kb-1" {
		t.Fatalf("unexpected input: %+v", gotInput)
	}

	var payload struct {
		OK   bool                 `json:"ok"`
		Data uploadTicketResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK {
		t.Fatal("expected ok response")
	}
	if got, want := payload.Data.UploadURL, "http://api.example.test/workspaces/ws-1/attachments/upload?token=signed-token"; got != want {
		t.Fatalf("unexpected upload url: got %q want %q", got, want)
	}
	if got, want := payload.Data.CommitURL, "http://api.example.test/workspaces/ws-1/attachments/commit?token=signed-token"; got != want {
		t.Fatalf("unexpected commit url: got %q want %q", got, want)
	}
	if got, want := payload.Data.CommitToken, "signed-token"; got != want {
		t.Fatalf("unexpected commit token: got %q want %q", got, want)
	}
}

func TestCommitUploadUsesQueryToken(t *testing.T) {
	t.Parallel()

	var gotInput CommitUploadInput
	handler := NewHandler(stubService{
		createUploadTicket: func(context.Context, CreateUploadTicketInput) (UploadTicket, error) { return UploadTicket{}, nil },
		uploadBinary:       func(context.Context, UploadBinaryInput) error { return nil },
		commitUpload: func(_ context.Context, input CommitUploadInput) (CommitResult, error) {
			gotInput = input
			return CommitResult{
				Attachment: Attachment{ID: "att-1"},
				Event:      syncEvent{ID: 7},
			}, nil
		},
		getContent: func(context.Context, GetContentInput) (AttachmentContent, error) { return AttachmentContent{}, nil },
		deleteAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
		restoreAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
		purgeAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
	})

	req := httptest.NewRequest(http.MethodPost, "http://api.example.test/workspaces/ws-1/attachments/commit?token=signed-token", bytes.NewBufferString(`{"sha256":"abc123"}`))
	rec := httptest.NewRecorder()

	handler.CommitUpload(rec, withRouteParams(req, map[string]string{
		"workspaceId": "ws-1",
	}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if got, want := gotInput.WorkspaceID, "ws-1"; got != want {
		t.Fatalf("unexpected workspace id: got %q want %q", got, want)
	}
	if got, want := gotInput.Token, "signed-token"; got != want {
		t.Fatalf("unexpected token: got %q want %q", got, want)
	}
	if got, want := gotInput.SHA256, "abc123"; got != want {
		t.Fatalf("unexpected sha256: got %q want %q", got, want)
	}
}

func TestGetContentWritesBinaryPayload(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		createUploadTicket: func(context.Context, CreateUploadTicketInput) (UploadTicket, error) { return UploadTicket{}, nil },
		uploadBinary:       func(context.Context, UploadBinaryInput) error { return nil },
		commitUpload:       func(context.Context, CommitUploadInput) (CommitResult, error) { return CommitResult{}, nil },
		getContent: func(_ context.Context, input GetContentInput) (AttachmentContent, error) {
			if input.UserID != "user-1" || input.WorkspaceID != "ws-1" || input.AttachmentID != "att-1" {
				t.Fatalf("unexpected get content input: %+v", input)
			}
			return AttachmentContent{
				Attachment: Attachment{
					ID:        "att-1",
					FileName:  "cover.png",
					MimeType:  "image/png",
					SizeBytes: 3,
				},
				Reader: io.NopCloser(bytes.NewReader([]byte("abc"))),
			}, nil
		},
		deleteAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
		restoreAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
		purgeAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
	})

	req := httptest.NewRequest(http.MethodGet, "http://api.example.test/workspaces/ws-1/attachments/att-1/content", nil)
	req = req.WithContext(auth.WithUserID(req.Context(), "user-1"))
	rec := httptest.NewRecorder()

	handler.GetContent(rec, withRouteParams(req, map[string]string{
		"workspaceId":  "ws-1",
		"attachmentId": "att-1",
	}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if got, want := rec.Header().Get("Content-Type"), "image/png"; got != want {
		t.Fatalf("unexpected content type: got %q want %q", got, want)
	}
	if got, want := rec.Body.String(), "abc"; got != want {
		t.Fatalf("unexpected body: got %q want %q", got, want)
	}
}

func TestRestoreUsesAttachmentRoute(t *testing.T) {
	t.Parallel()

	var gotInput DeleteInput
	handler := NewHandler(stubService{
		createUploadTicket: func(context.Context, CreateUploadTicketInput) (UploadTicket, error) { return UploadTicket{}, nil },
		uploadBinary:       func(context.Context, UploadBinaryInput) error { return nil },
		commitUpload:       func(context.Context, CommitUploadInput) (CommitResult, error) { return CommitResult{}, nil },
		getContent:         func(context.Context, GetContentInput) (AttachmentContent, error) { return AttachmentContent{}, nil },
		deleteAttachment:   func(context.Context, DeleteInput) (Attachment, syncEvent, error) { return Attachment{}, syncEvent{}, nil },
		restoreAttachment: func(_ context.Context, input DeleteInput) (Attachment, syncEvent, error) {
			gotInput = input
			return Attachment{ID: input.AttachmentID}, syncEvent{ID: 9}, nil
		},
		purgeAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
	})

	req := httptest.NewRequest(http.MethodPost, "http://api.example.test/workspaces/ws-1/attachments/att-1/restore", nil)
	req = req.WithContext(auth.WithUserID(req.Context(), "user-1"))
	rec := httptest.NewRecorder()

	handler.Restore(rec, withRouteParams(req, map[string]string{
		"workspaceId":  "ws-1",
		"attachmentId": "att-1",
	}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if gotInput.UserID != "user-1" || gotInput.WorkspaceID != "ws-1" || gotInput.AttachmentID != "att-1" {
		t.Fatalf("unexpected restore input: %+v", gotInput)
	}
}

func TestPurgeUsesAttachmentRoute(t *testing.T) {
	t.Parallel()

	var gotInput DeleteInput
	handler := NewHandler(stubService{
		createUploadTicket: func(context.Context, CreateUploadTicketInput) (UploadTicket, error) { return UploadTicket{}, nil },
		uploadBinary:       func(context.Context, UploadBinaryInput) error { return nil },
		commitUpload:       func(context.Context, CommitUploadInput) (CommitResult, error) { return CommitResult{}, nil },
		getContent:         func(context.Context, GetContentInput) (AttachmentContent, error) { return AttachmentContent{}, nil },
		deleteAttachment:   func(context.Context, DeleteInput) (Attachment, syncEvent, error) { return Attachment{}, syncEvent{}, nil },
		restoreAttachment: func(context.Context, DeleteInput) (Attachment, syncEvent, error) {
			return Attachment{}, syncEvent{}, nil
		},
		purgeAttachment: func(_ context.Context, input DeleteInput) (Attachment, syncEvent, error) {
			gotInput = input
			return Attachment{ID: input.AttachmentID}, syncEvent{ID: 10}, nil
		},
	})

	req := httptest.NewRequest(http.MethodDelete, "http://api.example.test/workspaces/ws-1/attachments/att-1/purge", nil)
	req = req.WithContext(auth.WithUserID(req.Context(), "user-1"))
	rec := httptest.NewRecorder()

	handler.Purge(rec, withRouteParams(req, map[string]string{
		"workspaceId":  "ws-1",
		"attachmentId": "att-1",
	}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if gotInput.UserID != "user-1" || gotInput.WorkspaceID != "ws-1" || gotInput.AttachmentID != "att-1" {
		t.Fatalf("unexpected purge input: %+v", gotInput)
	}
}

func withRouteParams(r *http.Request, values map[string]string) *http.Request {
	routeCtx := chi.NewRouteContext()
	for key, value := range values {
		routeCtx.URLParams.Add(key, value)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, routeCtx))
}
