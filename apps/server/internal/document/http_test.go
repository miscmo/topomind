package document

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
	create      func(ctx context.Context, input CreateInput) (Document, error)
	list        func(ctx context.Context, input ListInput) ([]Document, error)
	get         func(ctx context.Context, input GetInput) (Document, error)
	update      func(ctx context.Context, input UpdateInput) (Document, error)
	move        func(ctx context.Context, input MoveInput) (Document, error)
	delete      func(ctx context.Context, input DeleteInput) (Document, error)
	saveContent func(ctx context.Context, input SaveContentInput) (Document, error)
}

func (s stubService) Create(ctx context.Context, input CreateInput) (Document, error) {
	return s.create(ctx, input)
}

func (s stubService) List(ctx context.Context, input ListInput) ([]Document, error) {
	return s.list(ctx, input)
}

func (s stubService) Get(ctx context.Context, input GetInput) (Document, error) {
	return s.get(ctx, input)
}

func (s stubService) Update(ctx context.Context, input UpdateInput) (Document, error) {
	return s.update(ctx, input)
}

func (s stubService) Move(ctx context.Context, input MoveInput) (Document, error) {
	return s.move(ctx, input)
}

func (s stubService) Delete(ctx context.Context, input DeleteInput) (Document, error) {
	return s.delete(ctx, input)
}

func (s stubService) SaveContent(ctx context.Context, input SaveContentInput) (Document, error) {
	return s.saveContent(ctx, input)
}

func TestCreateDocumentSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (Document, error) {
			if input.UserID != "user-1" || input.WorkspaceID != "workspace-1" || input.CardID != "card-1" {
				t.Fatalf("unexpected create input: %#v", input)
			}
			if input.Type != documentTypeSmart {
				t.Fatalf("unexpected type: %s", input.Type)
			}
			if input.Title != "文档A" {
				t.Fatalf("unexpected title: %s", input.Title)
			}
			if input.ParentDocumentID != nil {
				t.Fatalf("unexpected parent document id: %#v", input.ParentDocumentID)
			}
			return Document{
				ID:            "doc-1",
				WorkspaceID:   input.WorkspaceID,
				CardID:        input.CardID,
				Type:          input.Type,
				Title:         input.Title,
				FileName:      "doc-1.json",
				SortOrder:     input.SortOrder,
				SchemaVersion: 1,
				ContentJSON:   map[string]any{},
				MetaJSON:      map[string]any{},
				Version:       1,
				CreatedAt:     "2026-06-08T02:00:00Z",
				UpdatedAt:     "2026-06-08T02:00:00Z",
			}, nil
		},
		list:        unexpectedList,
		get:         unexpectedGet,
		update:      unexpectedUpdate,
		move:        unexpectedMove,
		delete:      unexpectedDelete,
		saveContent: unexpectedSaveContent,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards/card-1/documents", bytes.NewBufferString(`{"type":"smart","title":"文档A","parentDocumentId":null,"sortOrder":2}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}

	var payload httpapi.SuccessResponse[Document]
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK || payload.Data.ID != "doc-1" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestCreateNestedDocumentSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (Document, error) {
			if input.ParentDocumentID == nil || *input.ParentDocumentID != "doc-parent" {
				t.Fatalf("unexpected parent document id: %#v", input.ParentDocumentID)
			}
			return Document{
				ID:               "doc-child",
				WorkspaceID:      input.WorkspaceID,
				CardID:           input.CardID,
				Type:             documentTypeMindMap,
				Title:            input.Title,
				FileName:         "doc-child.json",
				ParentDocumentID: input.ParentDocumentID,
				SchemaVersion:    1,
				ContentJSON:      map[string]any{},
				MetaJSON:         map[string]any{},
				Version:          1,
				CreatedAt:        "2026-06-08T02:05:00Z",
				UpdatedAt:        "2026-06-08T02:05:00Z",
			}, nil
		},
		list:        unexpectedList,
		get:         unexpectedGet,
		update:      unexpectedUpdate,
		move:        unexpectedMove,
		delete:      unexpectedDelete,
		saveContent: unexpectedSaveContent,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards/card-1/documents", bytes.NewBufferString(`{"type":"mindmap","title":"子文档","parentDocumentId":"doc-parent","sortOrder":0}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestCreateDocumentRejectsInvalidType(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (Document, error) {
			return Document{}, ErrInvalidDocumentType
		},
		list:        unexpectedList,
		get:         unexpectedGet,
		update:      unexpectedUpdate,
		move:        unexpectedMove,
		delete:      unexpectedDelete,
		saveContent: unexpectedSaveContent,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards/card-1/documents", bytes.NewBufferString(`{"type":"markdown","title":"文档"}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestCreateDocumentMapsCardNotFound(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (Document, error) {
			return Document{}, ErrCardNotFound
		},
		list:        unexpectedList,
		get:         unexpectedGet,
		update:      unexpectedUpdate,
		move:        unexpectedMove,
		delete:      unexpectedDelete,
		saveContent: unexpectedSaveContent,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards/card-missing/documents", bytes.NewBufferString(`{"type":"smart","title":"文档"}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-missing")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusNotFound)
	}
}

func TestCreateDocumentRequiresAuth(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: func(ctx context.Context, input CreateInput) (Document, error) {
			return Document{}, errors.New("should not be called")
		},
		list:        unexpectedList,
		get:         unexpectedGet,
		update:      unexpectedUpdate,
		move:        unexpectedMove,
		delete:      unexpectedDelete,
		saveContent: unexpectedSaveContent,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/cards/card-1/documents", bytes.NewBufferString(`{"type":"smart","title":"文档"}`))
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func TestListDocumentsSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list: func(ctx context.Context, input ListInput) ([]Document, error) {
			if input.UserID != "user-1" || input.WorkspaceID != "workspace-1" || input.CardID != "card-1" {
				t.Fatalf("unexpected list input: %#v", input)
			}
			return []Document{
				{
					ID:            "doc-1",
					WorkspaceID:   input.WorkspaceID,
					CardID:        input.CardID,
					Type:          documentTypeFlowchart,
					Title:         "流程图",
					FileName:      "doc-1.json",
					SchemaVersion: 1,
					ContentJSON:   map[string]any{},
					MetaJSON:      map[string]any{},
					Version:       1,
					CreatedAt:     "2026-06-08T02:10:00Z",
					UpdatedAt:     "2026-06-08T02:10:00Z",
				},
			}, nil
		},
		get:         unexpectedGet,
		update:      unexpectedUpdate,
		move:        unexpectedMove,
		delete:      unexpectedDelete,
		saveContent: unexpectedSaveContent,
	})

	req := httptest.NewRequest(http.MethodGet, "/workspaces/workspace-1/cards/card-1/documents", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withCardID(req, "card-1")
	recorder := httptest.NewRecorder()

	handler.List(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestGetDocumentSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get: func(ctx context.Context, input GetInput) (Document, error) {
			if input.DocumentID != "doc-1" {
				t.Fatalf("unexpected document id: %s", input.DocumentID)
			}
			return Document{
				ID:            "doc-1",
				WorkspaceID:   input.WorkspaceID,
				CardID:        "card-1",
				Type:          documentTypeSmart,
				Title:         "文档A",
				FileName:      "doc-1.json",
				SchemaVersion: 1,
				ContentJSON:   map[string]any{},
				MetaJSON:      map[string]any{},
				Version:       1,
				CreatedAt:     "2026-06-08T02:00:00Z",
				UpdatedAt:     "2026-06-08T02:00:00Z",
			}, nil
		},
		update: unexpectedUpdate,
		move:   unexpectedMove,
		delete: unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodGet, "/workspaces/workspace-1/documents/doc-1", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withDocumentID(req, "doc-1")
	recorder := httptest.NewRecorder()

	handler.Get(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestUpdateDocumentSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get:    unexpectedGet,
		update: func(ctx context.Context, input UpdateInput) (Document, error) {
			if input.DocumentID != "doc-1" {
				t.Fatalf("unexpected document id: %s", input.DocumentID)
			}
			if input.Title == nil || *input.Title != "新标题" {
				t.Fatalf("unexpected title: %#v", input.Title)
			}
			if !input.ParentDocumentIDSet || input.ParentDocumentID != nil {
				t.Fatalf("unexpected parent document payload: set=%v value=%#v", input.ParentDocumentIDSet, input.ParentDocumentID)
			}
			if input.SortOrder == nil || *input.SortOrder != 3 {
				t.Fatalf("unexpected sort order: %#v", input.SortOrder)
			}
			return Document{
				ID:            "doc-1",
				WorkspaceID:   input.WorkspaceID,
				CardID:        "card-1",
				Type:          documentTypeSmart,
				Title:         "新标题",
				FileName:      "doc-1.json",
				SortOrder:     3,
				SchemaVersion: 1,
				ContentJSON:   map[string]any{},
				MetaJSON:      map[string]any{},
				Version:       2,
				CreatedAt:     "2026-06-08T02:00:00Z",
				UpdatedAt:     "2026-06-08T02:20:00Z",
			}, nil
		},
		move:   unexpectedMove,
		delete: unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodPatch, "/workspaces/workspace-1/documents/doc-1", bytes.NewBufferString(`{"title":"新标题","parentDocumentId":null,"sortOrder":3}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withDocumentID(req, "doc-1")
	recorder := httptest.NewRecorder()

	handler.Update(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestMoveDocumentSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get:    unexpectedGet,
		update: unexpectedUpdate,
		move: func(ctx context.Context, input MoveInput) (Document, error) {
			if input.DocumentID != "doc-1" {
				t.Fatalf("unexpected document id: %s", input.DocumentID)
			}
			if input.ParentDocumentID == nil || *input.ParentDocumentID != "doc-parent" {
				t.Fatalf("unexpected parent document id: %#v", input.ParentDocumentID)
			}
			if input.SortOrder != 5 {
				t.Fatalf("unexpected sort order: %d", input.SortOrder)
			}
			return Document{
				ID:               "doc-1",
				WorkspaceID:      input.WorkspaceID,
				CardID:           "card-1",
				Type:             documentTypeMindMap,
				Title:            "脑图",
				FileName:         "doc-1.json",
				ParentDocumentID: input.ParentDocumentID,
				SortOrder:        5,
				SchemaVersion:    1,
				ContentJSON:      map[string]any{},
				MetaJSON:         map[string]any{},
				Version:          2,
				CreatedAt:        "2026-06-08T02:00:00Z",
				UpdatedAt:        "2026-06-08T02:25:00Z",
			}, nil
		},
		delete: unexpectedDelete,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/documents/doc-1/move", bytes.NewBufferString(`{"parentDocumentId":"doc-parent","sortOrder":5}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withDocumentID(req, "doc-1")
	recorder := httptest.NewRecorder()

	handler.Move(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestDeleteDocumentMapsAlreadyDeleted(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get:    unexpectedGet,
		update: unexpectedUpdate,
		move:   unexpectedMove,
		delete: func(ctx context.Context, input DeleteInput) (Document, error) {
			return Document{}, ErrDocumentAlreadyDeleted
		},
		saveContent: unexpectedSaveContent,
	})

	req := httptest.NewRequest(http.MethodDelete, "/workspaces/workspace-1/documents/doc-1", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withDocumentID(req, "doc-1")
	recorder := httptest.NewRecorder()

	handler.Delete(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusConflict)
	}
}

func TestMoveDocumentRejectsCycle(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get:    unexpectedGet,
		update: unexpectedUpdate,
		move: func(ctx context.Context, input MoveInput) (Document, error) {
			return Document{}, ErrDocumentCycleDetected
		},
		delete:      unexpectedDelete,
		saveContent: unexpectedSaveContent,
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/documents/doc-1/move", bytes.NewBufferString(`{"parentDocumentId":"doc-1","sortOrder":1}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withDocumentID(req, "doc-1")
	recorder := httptest.NewRecorder()

	handler.Move(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestSaveDocumentContentSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get:    unexpectedGet,
		update: unexpectedUpdate,
		move:   unexpectedMove,
		delete: unexpectedDelete,
		saveContent: func(ctx context.Context, input SaveContentInput) (Document, error) {
			if input.DocumentID != "doc-1" {
				t.Fatalf("unexpected document id: %s", input.DocumentID)
			}
			if input.BaseVersion != 1 {
				t.Fatalf("unexpected base version: %d", input.BaseVersion)
			}
			if input.SchemaVersion != 2 {
				t.Fatalf("unexpected schema version: %d", input.SchemaVersion)
			}
			if input.ContentJSON["type"] != "doc" {
				t.Fatalf("unexpected content json: %#v", input.ContentJSON)
			}
			return Document{
				ID:            "doc-1",
				WorkspaceID:   input.WorkspaceID,
				CardID:        "card-1",
				Type:          documentTypeSmart,
				Title:         "文档A",
				FileName:      "doc-1.json",
				SchemaVersion: 2,
				ContentJSON: map[string]any{
					"type": "doc",
					"text": "hello",
				},
				MetaJSON:  map[string]any{},
				Version:   2,
				CreatedAt: "2026-06-08T02:00:00Z",
				UpdatedAt: "2026-06-08T02:30:00Z",
			}, nil
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/documents/doc-1/content", bytes.NewBufferString(`{"baseVersion":1,"schemaVersion":2,"contentJson":{"type":"doc","text":"hello"}}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withDocumentID(req, "doc-1")
	recorder := httptest.NewRecorder()

	handler.SaveContent(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestSaveDocumentContentMapsVersionConflict(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		create: unexpectedCreate,
		list:   unexpectedList,
		get:    unexpectedGet,
		update: unexpectedUpdate,
		move:   unexpectedMove,
		delete: unexpectedDelete,
		saveContent: func(ctx context.Context, input SaveContentInput) (Document, error) {
			return Document{}, &VersionConflictError{
				ServerVersion: 3,
				ServerEntity: Document{
					ID:            "doc-1",
					WorkspaceID:   input.WorkspaceID,
					CardID:        "card-1",
					Type:          documentTypeSmart,
					Title:         "文档A",
					FileName:      "doc-1.json",
					SchemaVersion: 2,
					ContentJSON: map[string]any{
						"type": "doc",
						"text": "server",
					},
					MetaJSON:  map[string]any{},
					Version:   3,
					CreatedAt: "2026-06-08T02:00:00Z",
					UpdatedAt: "2026-06-08T02:35:00Z",
				},
			}
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/documents/doc-1/content", bytes.NewBufferString(`{"baseVersion":1,"schemaVersion":2,"contentJson":{"type":"doc","text":"client"}}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withDocumentID(req, "doc-1")
	recorder := httptest.NewRecorder()

	handler.SaveContent(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusConflict)
	}

	var payload httpapi.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Error.Code != "document_version_conflict" {
		t.Fatalf("unexpected error code: %s", payload.Error.Code)
	}
	if payload.Error.Details["serverVersion"] != float64(3) {
		t.Fatalf("unexpected serverVersion details: %#v", payload.Error.Details)
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

func withDocumentID(req *http.Request, documentID string) *http.Request {
	routeCtx := chi.RouteContext(req.Context())
	if routeCtx == nil {
		routeCtx = chi.NewRouteContext()
	}
	routeCtx.URLParams.Add("documentId", documentID)
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx)
	return req.WithContext(ctx)
}

func unexpectedCreate(ctx context.Context, input CreateInput) (Document, error) {
	return Document{}, errors.New("unexpected create")
}

func unexpectedList(ctx context.Context, input ListInput) ([]Document, error) {
	return nil, errors.New("unexpected list")
}

func unexpectedGet(ctx context.Context, input GetInput) (Document, error) {
	return Document{}, errors.New("unexpected get")
}

func unexpectedUpdate(ctx context.Context, input UpdateInput) (Document, error) {
	return Document{}, errors.New("unexpected update")
}

func unexpectedMove(ctx context.Context, input MoveInput) (Document, error) {
	return Document{}, errors.New("unexpected move")
}

func unexpectedDelete(ctx context.Context, input DeleteInput) (Document, error) {
	return Document{}, errors.New("unexpected delete")
}

func unexpectedSaveContent(ctx context.Context, input SaveContentInput) (Document, error) {
	return Document{}, errors.New("unexpected save content")
}
