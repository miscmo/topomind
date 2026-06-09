package syncapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"topomind/apps/server/internal/auth"
	httpapi "topomind/apps/server/internal/http"
	"topomind/apps/server/internal/workspace"
)

type stubPullService struct {
	pull func(ctx context.Context, input PullInput) (PullResponse, error)
}

func (s stubPullService) Pull(ctx context.Context, input PullInput) (PullResponse, error) {
	return s.pull(ctx, input)
}

func TestPullSyncSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubPullService{
		pull: func(ctx context.Context, input PullInput) (PullResponse, error) {
			if input.UserID != "user-1" {
				t.Fatalf("unexpected user id: %s", input.UserID)
			}
			if input.WorkspaceID != "workspace-1" {
				t.Fatalf("unexpected workspace id: %s", input.WorkspaceID)
			}
			if input.AfterEventID != 10 {
				t.Fatalf("unexpected afterEventId: %d", input.AfterEventID)
			}
			if input.Limit != 100 {
				t.Fatalf("unexpected limit: %d", input.Limit)
			}
			return PullResponse{
				WorkspaceID: input.WorkspaceID,
				FromEventID: input.AfterEventID,
				ToEventID:   11,
				HasMore:     false,
				Events: []PullEvent{{
					ID:            11,
					EntityType:    "knowledge_base",
					EntityID:      "kb-1",
					EventType:     "created",
					EntityVersion: 1,
					Payload: map[string]any{
						"id":   "kb-1",
						"name": "知识库 A",
					},
					CreatedAt: "2026-06-08T00:00:00Z",
				}},
			}, nil
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/workspaces/workspace-1/sync/pull?afterEventId=10&limit=100", nil)
	req = withSyncUserID(req, "user-1")
	req = withSyncWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Pull(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}

	var payload httpapi.SuccessResponse[PullResponse]
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Data.Events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(payload.Data.Events))
	}
}

func TestPullSyncRejectsInvalidLimit(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubPullService{
		pull: func(ctx context.Context, input PullInput) (PullResponse, error) {
			t.Fatal("service should not be called")
			return PullResponse{}, nil
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/workspaces/workspace-1/sync/pull?limit=0", nil)
	req = withSyncUserID(req, "user-1")
	req = withSyncWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Pull(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestPullSyncMapsWorkspaceNotFound(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubPullService{
		pull: func(ctx context.Context, input PullInput) (PullResponse, error) {
			return PullResponse{}, workspace.ErrWorkspaceNotFound
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/workspaces/workspace-1/sync/pull", nil)
	req = withSyncUserID(req, "user-1")
	req = withSyncWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Pull(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusNotFound)
	}
}

func withSyncUserID(req *http.Request, userID string) *http.Request {
	return req.WithContext(auth.WithUserID(req.Context(), userID))
}

func withSyncWorkspaceID(req *http.Request, workspaceID string) *http.Request {
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("workspaceId", workspaceID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}
