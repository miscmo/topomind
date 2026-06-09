package graphlayout

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
	get   func(ctx context.Context, input GetInput) (GraphLayout, error)
	save  func(ctx context.Context, input SaveInput) (GraphLayout, error)
	patch func(ctx context.Context, input PatchInput) (GraphLayout, error)
}

func (s stubService) Get(ctx context.Context, input GetInput) (GraphLayout, error) {
	return s.get(ctx, input)
}

func (s stubService) Save(ctx context.Context, input SaveInput) (GraphLayout, error) {
	return s.save(ctx, input)
}

func (s stubService) Patch(ctx context.Context, input PatchInput) (GraphLayout, error) {
	return s.patch(ctx, input)
}

func TestGetGraphLayoutSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		get: func(ctx context.Context, input GetInput) (GraphLayout, error) {
			if input.LayoutID != "layout-1" {
				t.Fatalf("unexpected layout id: %s", input.LayoutID)
			}
			return GraphLayout{
				ID:           "layout-1",
				WorkspaceID:  input.WorkspaceID,
				KBID:         "kb-1",
				RoomCardID:   nil,
				LayoutJSON:   map[string]any{"nodes": map[string]any{}},
				ViewportJSON: map[string]any{"zoom": 1},
				Version:      1,
				CreatedAt:    "2026-06-08T03:00:00Z",
				UpdatedAt:    "2026-06-08T03:00:00Z",
			}, nil
		},
		save:  unexpectedSave,
		patch: unexpectedPatch,
	})

	req := httptest.NewRequest(http.MethodGet, "/workspaces/workspace-1/graph-layouts/layout-1", nil)
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withLayoutID(req, "layout-1")
	recorder := httptest.NewRecorder()

	handler.Get(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestSaveGraphLayoutSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		get: unexpectedGet,
		save: func(ctx context.Context, input SaveInput) (GraphLayout, error) {
			if input.LayoutID != "layout-1" || input.KBID != "kb-1" {
				t.Fatalf("unexpected save input: %#v", input)
			}
			if input.BaseVersion != 0 {
				t.Fatalf("unexpected base version: %d", input.BaseVersion)
			}
			if input.RoomCardID == nil || *input.RoomCardID != "card-1" {
				t.Fatalf("unexpected room card id: %#v", input.RoomCardID)
			}
			if input.ViewportJSON["zoom"] != float64(1.25) {
				t.Fatalf("unexpected viewport: %#v", input.ViewportJSON)
			}
			return GraphLayout{
				ID:          "layout-1",
				WorkspaceID: input.WorkspaceID,
				KBID:        input.KBID,
				RoomCardID:  input.RoomCardID,
				LayoutJSON: map[string]any{
					"nodes": map[string]any{"card-1": map[string]any{"x": float64(12)}},
					"edges": []any{},
				},
				ViewportJSON: map[string]any{
					"zoom": 1.25,
					"pan":  map[string]any{"x": float64(10), "y": float64(20)},
				},
				Version:   1,
				CreatedAt: "2026-06-08T03:05:00Z",
				UpdatedAt: "2026-06-08T03:05:00Z",
			}, nil
		},
		patch: unexpectedPatch,
	})

	req := httptest.NewRequest(http.MethodPatch, "/workspaces/workspace-1/graph-layouts/layout-1", bytes.NewBufferString(`{"kbId":"kb-1","roomCardId":"card-1","baseVersion":0,"layoutJson":{"nodes":{"card-1":{"x":12}},"edges":[]},"viewportJson":{"zoom":1.25,"pan":{"x":10,"y":20}}}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withLayoutID(req, "layout-1")
	recorder := httptest.NewRecorder()

	handler.Save(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestPatchGraphLayoutSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		get:  unexpectedGet,
		save: unexpectedSave,
		patch: func(ctx context.Context, input PatchInput) (GraphLayout, error) {
			if input.LayoutID != "layout-1" || input.KBID != "kb-1" {
				t.Fatalf("unexpected patch input: %#v", input)
			}
			if input.BaseVersion != 3 {
				t.Fatalf("unexpected base version: %d", input.BaseVersion)
			}
			nodePatch, ok := input.NodePatches["card-1"].(map[string]any)
			if !ok || nodePatch["x"] != float64(20) {
				t.Fatalf("unexpected node patches: %#v", input.NodePatches)
			}
			if input.Viewport["zoom"] != float64(1.5) {
				t.Fatalf("unexpected viewport patch: %#v", input.Viewport)
			}
			return GraphLayout{
				ID:          "layout-1",
				WorkspaceID: input.WorkspaceID,
				KBID:        input.KBID,
				RoomCardID:  input.RoomCardID,
				LayoutJSON: map[string]any{
					"nodes": map[string]any{"card-1": map[string]any{"x": float64(20)}},
				},
				ViewportJSON: map[string]any{
					"zoom": 1.5,
					"pan":  map[string]any{"x": float64(0), "y": float64(0)},
				},
				Version:   4,
				CreatedAt: "2026-06-08T03:10:00Z",
				UpdatedAt: "2026-06-08T03:12:00Z",
			}, nil
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/graph-layouts/layout-1/patch", bytes.NewBufferString(`{"kbId":"kb-1","roomCardId":null,"baseVersion":3,"nodePatches":{"card-1":{"x":20}},"viewport":{"zoom":1.5}}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withLayoutID(req, "layout-1")
	recorder := httptest.NewRecorder()

	handler.Patch(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}
}

func TestPatchGraphLayoutMapsVersionConflict(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubService{
		get:  unexpectedGet,
		save: unexpectedSave,
		patch: func(ctx context.Context, input PatchInput) (GraphLayout, error) {
			return GraphLayout{}, &VersionConflictError{
				ServerVersion: 5,
				ServerEntity: GraphLayout{
					ID:          "layout-1",
					WorkspaceID: input.WorkspaceID,
					KBID:        "kb-1",
					LayoutJSON:  map[string]any{"nodes": map[string]any{}},
					ViewportJSON: map[string]any{
						"zoom": 1.2,
					},
					Version:   5,
					CreatedAt: "2026-06-08T03:10:00Z",
					UpdatedAt: "2026-06-08T03:13:00Z",
				},
			}
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/graph-layouts/layout-1/patch", bytes.NewBufferString(`{"kbId":"kb-1","roomCardId":null,"baseVersion":3,"nodePatches":{"card-1":{"x":20}}}`))
	req = withUserID(req, "user-1")
	req = withWorkspaceID(req, "workspace-1")
	req = withLayoutID(req, "layout-1")
	recorder := httptest.NewRecorder()

	handler.Patch(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusConflict)
	}

	var payload httpapi.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Error.Code != "graph_layout_version_conflict" {
		t.Fatalf("unexpected error code: %s", payload.Error.Code)
	}
	if payload.Error.Details["serverVersion"] != float64(5) {
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

func withLayoutID(req *http.Request, layoutID string) *http.Request {
	routeCtx := chi.RouteContext(req.Context())
	if routeCtx == nil {
		routeCtx = chi.NewRouteContext()
	}
	routeCtx.URLParams.Add("layoutId", layoutID)
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx)
	return req.WithContext(ctx)
}

func unexpectedGet(ctx context.Context, input GetInput) (GraphLayout, error) {
	return GraphLayout{}, errors.New("unexpected get")
}

func unexpectedSave(ctx context.Context, input SaveInput) (GraphLayout, error) {
	return GraphLayout{}, errors.New("unexpected save")
}

func unexpectedPatch(ctx context.Context, input PatchInput) (GraphLayout, error) {
	return GraphLayout{}, errors.New("unexpected patch")
}
