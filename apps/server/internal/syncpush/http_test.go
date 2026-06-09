package syncpush

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"topomind/apps/server/internal/auth"
	httpapi "topomind/apps/server/internal/http"
)

type stubPushService struct {
	push func(ctx context.Context, input PushInput) (PushResponse, error)
}

func (s stubPushService) Push(ctx context.Context, input PushInput) (PushResponse, error) {
	return s.push(ctx, input)
}

func TestPushSyncSuccess(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubPushService{
		push: func(ctx context.Context, input PushInput) (PushResponse, error) {
			if input.WorkspaceID != "workspace-1" {
				t.Fatalf("unexpected workspace: %s", input.WorkspaceID)
			}
			if input.UserID != "user-1" {
				t.Fatalf("unexpected user: %s", input.UserID)
			}
			if input.EntityType != "document" || input.Operation != "update" || input.EntityID != "doc-1" {
				t.Fatalf("unexpected push input: %#v", input)
			}
			return PushResponse{
				EntityType: input.EntityType,
				Operation:  input.Operation,
				Entity: map[string]any{
					"id":      "doc-1",
					"version": float64(3),
				},
				Event: PushEvent{
					ID:            42,
					EntityVersion: 3,
				},
			}, nil
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/sync/push", strings.NewReader(`{
		"entityType":"document",
		"operation":"update",
		"entityId":"doc-1",
		"baseVersion":2,
		"idempotencyKey":"k1",
		"payload":{"contentJson":{"blocks":[]}}
	}`))
	req = withPushUserID(req, "user-1")
	req = withPushWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Push(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusOK)
	}

	var payload httpapi.SuccessResponse[PushResponse]
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Data.Event.ID != 42 || payload.Data.Event.EntityVersion != 3 {
		t.Fatalf("unexpected event payload: %#v", payload.Data.Event)
	}
}

func TestPushSyncConflictIncludesServerDetails(t *testing.T) {
	t.Parallel()

	handler := NewHandler(stubPushService{
		push: func(ctx context.Context, input PushInput) (PushResponse, error) {
			return PushResponse{}, &conflictError{
				Code:          "version_conflict",
				Message:       "版本冲突",
				ServerVersion: 5,
				ServerEventID: 99,
				ServerEntity: map[string]any{
					"id":      "card-1",
					"version": float64(5),
				},
			}
		},
	})

	req := httptest.NewRequest(http.MethodPost, "/workspaces/workspace-1/sync/push", strings.NewReader(`{
		"entityType":"card",
		"operation":"update",
		"entityId":"card-1",
		"baseVersion":4,
		"idempotencyKey":"k2",
		"payload":{"name":"Card A"}
	}`))
	req = withPushUserID(req, "user-1")
	req = withPushWorkspaceID(req, "workspace-1")
	recorder := httptest.NewRecorder()

	handler.Push(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("unexpected status: got %d want %d", recorder.Code, http.StatusConflict)
	}

	var payload httpapi.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Error.Code != "version_conflict" {
		t.Fatalf("unexpected error code: %s", payload.Error.Code)
	}
	if payload.Error.Details["serverVersion"] != float64(5) {
		t.Fatalf("unexpected details: %#v", payload.Error.Details)
	}
	if payload.Error.Details["serverEventId"] != float64(99) {
		t.Fatalf("unexpected serverEventId: %#v", payload.Error.Details)
	}
}

func withPushUserID(req *http.Request, userID string) *http.Request {
	return req.WithContext(auth.WithUserID(req.Context(), userID))
}

func withPushWorkspaceID(req *http.Request, workspaceID string) *http.Request {
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("workspaceId", workspaceID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}
