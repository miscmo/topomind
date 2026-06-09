package kb

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"topomind/apps/server/internal/auth"
	httpapi "topomind/apps/server/internal/http"
	"topomind/apps/server/internal/workspace"
)

type stubService struct {
	create  func(ctx context.Context, input CreateInput) (KnowledgeBase, error)
	update  func(ctx context.Context, input UpdateInput) (KnowledgeBase, error)
	delete  func(ctx context.Context, input DeleteInput) (KnowledgeBase, error)
	restore func(ctx context.Context, input DeleteInput) (KnowledgeBase, error)
	purge   func(ctx context.Context, input DeleteInput) (KnowledgeBase, error)
}

func (s stubService) Create(ctx context.Context, input CreateInput) (KnowledgeBase, error) {
	return s.create(ctx, input)
}

func (s stubService) Update(ctx context.Context, input UpdateInput) (KnowledgeBase, error) {
	return s.update(ctx, input)
}

func (s stubService) Delete(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
	return s.delete(ctx, input)
}

func (s stubService) Restore(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
	return s.restore(ctx, input)
}

func (s stubService) Purge(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
	return s.purge(ctx, input)
}

func TestCreateKnowledgeBaseSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (KnowledgeBase, error) {
			if input.UserID != "user-1" {
				t.Fatalf("unexpected user id: %s", input.UserID)
			}
			if input.WorkspaceID != "workspace-1" {
				t.Fatalf("unexpected workspace id: %s", input.WorkspaceID)
			}
			if input.Name != "知识库 A" {
				t.Fatalf("unexpected name: %s", input.Name)
			}
			if input.SortOrder != 3 {
				t.Fatalf("unexpected sort order: %d", input.SortOrder)
			}
			return KnowledgeBase{
				ID:           "kb-1",
				WorkspaceID:  input.WorkspaceID,
				Name:         input.Name,
				SortOrder:    input.SortOrder,
				SettingsJSON: map[string]any{},
				Version:      1,
				CreatedAt:    "2026-06-08T00:00:00Z",
				UpdatedAt:    "2026-06-08T00:00:00Z",
			}, nil
		},
		update:  func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected update") },
		delete:  func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected delete") },
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected restore") },
		purge:   func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected purge") },
	})

	body := bytes.NewBufferString(`{"name":"知识库 A","sortOrder":3}`)
	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/knowledge-bases", body)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}

	var payload httpapi.SuccessResponse[KnowledgeBase]
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK {
		t.Fatal("expected ok response")
	}
	if payload.Data.ID != "kb-1" {
		t.Fatalf("unexpected knowledge base id: %s", payload.Data.ID)
	}
}

func TestCreateKnowledgeBaseRejectsEmptyName(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, ErrInvalidKnowledgeBaseName
		},
		update:  func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected update") },
		delete:  func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected delete") },
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected restore") },
		purge:   func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected purge") },
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/knowledge-bases", bytes.NewBufferString(`{"name":"   "}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestCreateKnowledgeBaseMapsWorkspaceNotFound(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, workspace.ErrWorkspaceNotFound
		},
		update:  func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected update") },
		delete:  func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected delete") },
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected restore") },
		purge:   func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected purge") },
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/knowledge-bases", bytes.NewBufferString(`{"name":"知识库"}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusNotFound)
	}
}

func TestCreateKnowledgeBaseRequiresAuth(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("should not be called")
		},
		update:  func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected update") },
		delete:  func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected delete") },
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected restore") },
		purge:   func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected purge") },
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/knowledge-bases", bytes.NewBufferString(`{"name":"知识库"}`))
	req = withWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func TestUpdateKnowledgeBaseRejectsEmptyPatch(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create:  func(ctx context.Context, input CreateInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected create") },
		update:  func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) { return KnowledgeBase{}, ErrNoKnowledgeBaseChanges },
		delete:  func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected delete") },
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected restore") },
		purge:   func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected purge") },
	})

	req := httptest.NewRequest(http.MethodPatch, "/workspaces/workspace-1/knowledge-bases/kb-1", bytes.NewBufferString(`{}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withKnowledgeBaseID(req, "kb-1")
	recorder := httptest.NewRecorder()

	handler.Update(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestUpdateKnowledgeBaseSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected create")
		},
		update: func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) {
			if input.UserID != "user-1" {
				t.Fatalf("unexpected user id: %s", input.UserID)
			}
			if input.WorkspaceID != "workspace-1" {
				t.Fatalf("unexpected workspace id: %s", input.WorkspaceID)
			}
			if input.KnowledgeBaseID != "kb-1" {
				t.Fatalf("unexpected kb id: %s", input.KnowledgeBaseID)
			}
			if input.Name == nil || *input.Name != "知识库 B" {
				t.Fatalf("unexpected name input: %#v", input.Name)
			}
			if input.SortOrder == nil || *input.SortOrder != 2 {
				t.Fatalf("unexpected sort order input: %#v", input.SortOrder)
			}
			return KnowledgeBase{
				ID:           "kb-1",
				WorkspaceID:  "workspace-1",
				Name:         "知识库 B",
				SortOrder:    2,
				SettingsJSON: map[string]any{},
				Version:      2,
				CreatedAt:    "2026-06-08T00:00:00Z",
				UpdatedAt:    "2026-06-08T00:10:00Z",
			}, nil
		},
		delete:  func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected delete") },
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected restore") },
		purge:   func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected purge") },
	})

	req := httptest.NewRequest(http.MethodPatch, "/workspaces/workspace-1/knowledge-bases/kb-1", bytes.NewBufferString(`{"name":"知识库 B","sortOrder":2}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withKnowledgeBaseID(req, "kb-1")
	recorder := httptest.NewRecorder()

	handler.Update(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestDeleteKnowledgeBaseMapsAlreadyDeleted(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create:  func(ctx context.Context, input CreateInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected create") },
		update:  func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected update") },
		delete:  func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, ErrKnowledgeBaseAlreadyDeleted },
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected restore") },
		purge:   func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected purge") },
	})

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/workspace-1/knowledge-bases/kb-1", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withKnowledgeBaseID(req, "kb-1")
	recorder := httptest.NewRecorder()

	handler.Delete(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusConflict)
	}
}

func TestRestoreKnowledgeBaseSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected create")
		},
		update: func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected update")
		},
		delete: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected delete")
		},
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
			return KnowledgeBase{
				ID:           "kb-1",
				WorkspaceID:  "workspace-1",
				Name:         "知识库 A",
				SortOrder:    0,
				SettingsJSON: map[string]any{},
				Version:      3,
				CreatedAt:    "2026-06-08T00:00:00Z",
				UpdatedAt:    "2026-06-08T00:20:00Z",
			}, nil
		},
		purge: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected purge")
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/knowledge-bases/kb-1/restore", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withKnowledgeBaseID(req, "kb-1")
	recorder := httptest.NewRecorder()

	handler.Restore(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestRestoreKnowledgeBaseMapsNotDeleted(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected create")
		},
		update: func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected update")
		},
		delete: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected delete")
		},
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, ErrKnowledgeBaseNotDeleted
		},
		purge: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected purge")
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/knowledge-bases/kb-1/restore", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withKnowledgeBaseID(req, "kb-1")
	recorder := httptest.NewRecorder()

	handler.Restore(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusConflict)
	}
}

func TestPurgeKnowledgeBaseBlocksWhenCardsExist(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create:  func(ctx context.Context, input CreateInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected create") },
		update:  func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected update") },
		delete:  func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected delete") },
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, errors.New("unexpected restore") },
		purge:   func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) { return KnowledgeBase{}, ErrKnowledgeBaseHasCards },
	})

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/workspace-1/knowledge-bases/kb-1/purge", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withKnowledgeBaseID(req, "kb-1")
	recorder := httptest.NewRecorder()

	handler.Purge(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusConflict)
	}
}

func TestPurgeKnowledgeBaseSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected create")
		},
		update: func(ctx context.Context, input UpdateInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected update")
		},
		delete: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected delete")
		},
		restore: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
			return KnowledgeBase{}, errors.New("unexpected restore")
		},
		purge: func(ctx context.Context, input DeleteInput) (KnowledgeBase, error) {
			if input.UserID != "user-1" {
				t.Fatalf("unexpected user id: %s", input.UserID)
			}
			if input.WorkspaceID != "workspace-1" {
				t.Fatalf("unexpected workspace id: %s", input.WorkspaceID)
			}
			if input.KnowledgeBaseID != "kb-1" {
				t.Fatalf("unexpected kb id: %s", input.KnowledgeBaseID)
			}
			return KnowledgeBase{
				ID:           "kb-1",
				WorkspaceID:  "workspace-1",
				Name:         "知识库 A",
				SortOrder:    0,
				SettingsJSON: map[string]any{},
				Version:      4,
				CreatedAt:    "2026-06-08T00:00:00Z",
				UpdatedAt:    "2026-06-08T00:30:00Z",
				DeletedAt:    ptr("2026-06-08T00:15:00Z"),
			}, nil
		},
	})

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/workspace-1/knowledge-bases/kb-1/purge", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withKnowledgeBaseID(req, "kb-1")
	recorder := httptest.NewRecorder()

	handler.Purge(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func withUserID(req *http.Request, userID string) *http.Request {
	ctx := auth.WithUserID(req.Context(), userID)
	return req.WithContext(ctx)
}

func withWorkspaceID(req *http.Request, workspaceID string) *http.Request {
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("workspaceId", workspaceID)
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx)
	return req.WithContext(ctx)
}

func withKnowledgeBaseID(req *http.Request, kbID string) *http.Request {
	routeCtx := chi.RouteContext(req.Context())
	if routeCtx == nil {
		routeCtx = chi.NewRouteContext()
	}
	routeCtx.URLParams.Add("kbId", kbID)
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx)
	return req.WithContext(ctx)
}

func ptr[T any](value T) *T {
	return &value
}
