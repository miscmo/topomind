package card

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
)

type stubService struct {
	create  func(ctx context.Context, input CreateInput) (Card, error)
	list    func(ctx context.Context, input ListInput) ([]Card, error)
	get     func(ctx context.Context, input GetInput) (Card, error)
	update  func(ctx context.Context, input UpdateInput) (Card, error)
	delete  func(ctx context.Context, input DeleteInput) (Card, error)
	restore func(ctx context.Context, input DeleteInput) (Card, error)
	purge   func(ctx context.Context, input DeleteInput) (Card, error)
}

func (s stubService) Create(ctx context.Context, input CreateInput) (Card, error) {
	return s.create(ctx, input)
}

func (s stubService) List(ctx context.Context, input ListInput) ([]Card, error) {
	return s.list(ctx, input)
}

func (s stubService) Get(ctx context.Context, input GetInput) (Card, error) {
	return s.get(ctx, input)
}

func (s stubService) Update(ctx context.Context, input UpdateInput) (Card, error) {
	return s.update(ctx, input)
}

func (s stubService) Delete(ctx context.Context, input DeleteInput) (Card, error) {
	return s.delete(ctx, input)
}

func (s stubService) Restore(ctx context.Context, input DeleteInput) (Card, error) {
	return s.restore(ctx, input)
}

func (s stubService) Purge(ctx context.Context, input DeleteInput) (Card, error) {
	return s.purge(ctx, input)
}

func TestCreateRootCardSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (Card, error) {
			if input.UserID != "user-1" {
				t.Fatalf("unexpected user id: %s", input.UserID)
			}
			if input.WorkspaceID != "workspace-1" {
				t.Fatalf("unexpected workspace id: %s", input.WorkspaceID)
			}
			if input.KBID != "kb-1" {
				t.Fatalf("unexpected kb id: %s", input.KBID)
			}
			if input.ParentID != nil {
				t.Fatalf("unexpected parent id: %#v", input.ParentID)
			}
			if input.Name != "根节点" {
				t.Fatalf("unexpected name: %s", input.Name)
			}
			if input.SortOrder != 1 {
				t.Fatalf("unexpected sort order: %d", input.SortOrder)
			}
			if input.Status != "active" {
				t.Fatalf("unexpected status: %s", input.Status)
			}
			if input.MetaJSON["color"] != "blue" {
				t.Fatalf("unexpected meta json: %#v", input.MetaJSON)
			}
			return Card{
				ID:          "card-1",
				WorkspaceID: input.WorkspaceID,
				KBID:        input.KBID,
				ParentID:    nil,
				Name:        input.Name,
				SortOrder:   input.SortOrder,
				Status:      input.Status,
				MetaJSON:    input.MetaJSON,
				Version:     1,
				CreatedAt:   "2026-06-08T01:00:00Z",
				UpdatedAt:   "2026-06-08T01:00:00Z",
			}, nil
		},
		list:    unexpectedList,
		get:     unexpectedGet,
		update:  unexpectedUpdate,
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge:   unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards", bytes.NewBufferString(`{"kbId":"kb-1","parentId":null,"name":"根节点","sortOrder":1,"status":"active","metaJson":{"color":"blue"}}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}

	var payload httpapi.SuccessResponse[Card]
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK {
		t.Fatal("expected ok response")
	}
	if payload.Data.ID != "card-1" {
		t.Fatalf("unexpected card id: %s", payload.Data.ID)
	}
}

func TestCreateChildCardSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (Card, error) {
			if input.ParentID == nil || *input.ParentID != "parent-1" {
				t.Fatalf("unexpected parent id: %#v", input.ParentID)
			}
			return Card{
				ID:          "card-2",
				WorkspaceID: input.WorkspaceID,
				KBID:        input.KBID,
				ParentID:    input.ParentID,
				Name:        input.Name,
				SortOrder:   input.SortOrder,
				Status:      "active",
				MetaJSON:    map[string]any{},
				Version:     1,
				CreatedAt:   "2026-06-08T01:05:00Z",
				UpdatedAt:   "2026-06-08T01:05:00Z",
			}, nil
		},
		list:    unexpectedList,
		get:     unexpectedGet,
		update:  unexpectedUpdate,
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge:   unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards", bytes.NewBufferString(`{"kbId":"kb-1","parentId":"parent-1","name":"子节点","sortOrder":0,"status":"active","metaJson":{}}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestCreateCardRejectsEmptyName(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (Card, error) {
			return Card{}, ErrInvalidCardName
		},
		list:    unexpectedList,
		get:     unexpectedGet,
		update:  unexpectedUpdate,
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge:   unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards", bytes.NewBufferString(`{"kbId":"kb-1","name":"   "}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestCreateCardMapsKnowledgeBaseNotFound(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (Card, error) {
			return Card{}, ErrKnowledgeBaseNotFound
		},
		list:    unexpectedList,
		get:     unexpectedGet,
		update:  unexpectedUpdate,
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge:   unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards", bytes.NewBufferString(`{"kbId":"kb-missing","name":"节点"}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusNotFound)
	}
}

func TestCreateCardRequiresAuth(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (Card, error) {
			return Card{}, errors.New("should not be called")
		},
		list:    unexpectedList,
		get:     unexpectedGet,
		update:  unexpectedUpdate,
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge:   unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards", bytes.NewBufferString(`{"kbId":"kb-1","name":"节点"}`))
	req = withWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func TestListRootCardsSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list: func(ctx context.Context, input ListInput) ([]Card, error) {
			if input.UserID != "user-1" || input.WorkspaceID != "workspace-1" || input.KBID != "kb-1" {
				t.Fatalf("unexpected list input: %#v", input)
			}
			if input.ParentID != nil {
				t.Fatalf("expected nil parent id, got %#v", input.ParentID)
			}
			return []Card{{ID: "card-1", WorkspaceID: "workspace-1", KBID: "kb-1", Name: "根节点", Status: "active", MetaJSON: map[string]any{}, Version: 1, CreatedAt: "2026-06-08T01:00:00Z", UpdatedAt: "2026-06-08T01:00:00Z"}}, nil
		},
		get:     unexpectedGet,
		update:  unexpectedUpdate,
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge:   unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodGet, "/workspaces/workspace-1/cards?kbId=kb-1", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.List(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestGetCardSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get: func(ctx context.Context, input GetInput) (Card, error) {
			if input.CardID != "card-1" {
				t.Fatalf("unexpected card id: %s", input.CardID)
			}
			return Card{ID: "card-1", WorkspaceID: "workspace-1", KBID: "kb-1", Name: "节点", Status: "active", MetaJSON: map[string]any{}, Version: 1, CreatedAt: "2026-06-08T01:00:00Z", UpdatedAt: "2026-06-08T01:00:00Z"}, nil
		},
		update:  unexpectedUpdate,
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge:   unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodGet, "/workspaces/workspace-1/cards/card-1", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.Get(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestUpdateCardSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get:    unexpectedGet,
		update: func(ctx context.Context, input UpdateInput) (Card, error) {
			if input.CardID != "card-1" {
				t.Fatalf("unexpected card id: %s", input.CardID)
			}
			if input.Name == nil || *input.Name != "新节点名" {
				t.Fatalf("unexpected name: %#v", input.Name)
			}
			if input.SortOrder == nil || *input.SortOrder != 3 {
				t.Fatalf("unexpected sortOrder: %#v", input.SortOrder)
			}
			if input.Status == nil || *input.Status != "active" {
				t.Fatalf("unexpected status: %#v", input.Status)
			}
			if input.MetaJSON == nil || (*input.MetaJSON)["color"] != "green" {
				t.Fatalf("unexpected meta json: %#v", input.MetaJSON)
			}
			return Card{ID: "card-1", WorkspaceID: "workspace-1", KBID: "kb-1", Name: "新节点名", SortOrder: 3, Status: "active", MetaJSON: map[string]any{"color": "green"}, Version: 2, CreatedAt: "2026-06-08T01:00:00Z", UpdatedAt: "2026-06-08T01:20:00Z"}, nil
		},
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge:   unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodPatch, "/workspaces/workspace-1/cards/card-1", bytes.NewBufferString(`{"name":"新节点名","sortOrder":3,"status":"active","metaJson":{"color":"green"}}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.Update(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestUpdateCardRejectsEmptyPatch(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get:    unexpectedGet,
		update: func(ctx context.Context, input UpdateInput) (Card, error) {
			return Card{}, ErrNoCardChanges
		},
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge:   unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodPatch, "/workspaces/workspace-1/cards/card-1", bytes.NewBufferString(`{}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.Update(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestDeleteCardMapsAlreadyDeleted(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get:    unexpectedGet,
		update: unexpectedUpdate,
		delete: func(ctx context.Context, input DeleteInput) (Card, error) {
			return Card{}, ErrCardAlreadyDeleted
		},
		restore: unexpectedDelete,
		purge:   unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/workspace-1/cards/card-1", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.Delete(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusConflict)
	}
}

func TestRestoreCardSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get:    unexpectedGet,
		update: unexpectedUpdate,
		delete: unexpectedDelete,
		restore: func(ctx context.Context, input DeleteInput) (Card, error) {
			return Card{ID: "card-1", WorkspaceID: "workspace-1", KBID: "kb-1", Name: "节点", Status: "active", MetaJSON: map[string]any{}, Version: 3, CreatedAt: "2026-06-08T01:00:00Z", UpdatedAt: "2026-06-08T01:30:00Z"}, nil
		},
		purge: unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards/card-1/restore", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.Restore(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestPurgeCardBlocksWhenChildrenExist(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create:  unexpectedCreate,
		list:    unexpectedList,
		get:     unexpectedGet,
		update:  unexpectedUpdate,
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge: func(ctx context.Context, input DeleteInput) (Card, error) {
			return Card{}, ErrCardHasChildren
		},
	})

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/workspace-1/cards/card-1/purge", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.Purge(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusConflict)
	}
}

func TestPurgeCardSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create:  unexpectedCreate,
		list:    unexpectedList,
		get:     unexpectedGet,
		update:  unexpectedUpdate,
		delete:  unexpectedDelete,
		restore: unexpectedDelete,
		purge: func(ctx context.Context, input DeleteInput) (Card, error) {
			if input.CardID != "card-1" {
				t.Fatalf("unexpected card id: %s", input.CardID)
			}
			return Card{ID: "card-1", WorkspaceID: "workspace-1", KBID: "kb-1", Name: "节点", Status: "active", MetaJSON: map[string]any{}, Version: 4, CreatedAt: "2026-06-08T01:00:00Z", UpdatedAt: "2026-06-08T01:40:00Z", DeletedAt: ptr("2026-06-08T01:10:00Z")}, nil
		},
	})

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/workspace-1/cards/card-1/purge", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
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

func withCardID(req *http.Request, cardID string) *http.Request {
	routeCtx := chi.RouteContext(req.Context())
	if routeCtx == nil {
		routeCtx = chi.NewRouteContext()
	}
	routeCtx.URLParams.Add("cardId", cardID)
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx)
	return req.WithContext(ctx)
}

func unexpectedCreate(ctx context.Context, input CreateInput) (Card, error) {
	return Card{}, errors.New("unexpected create")
}

func unexpectedList(ctx context.Context, input ListInput) ([]Card, error) {
	return nil, errors.New("unexpected list")
}

func unexpectedGet(ctx context.Context, input GetInput) (Card, error) {
	return Card{}, errors.New("unexpected get")
}

func unexpectedUpdate(ctx context.Context, input UpdateInput) (Card, error) {
	return Card{}, errors.New("unexpected update")
}

func unexpectedDelete(ctx context.Context, input DeleteInput) (Card, error) {
	return Card{}, errors.New("unexpected delete")
}

func ptr[T any](value T) *T {
	return &value
}
