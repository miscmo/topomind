package syncpush

import (
	"errors"
	"testing"

	"topomind/apps/server/internal/document"
	"topomind/apps/server/internal/graphlayout"
)

func TestRequireObjectFieldRejectsMissingDocumentContent(t *testing.T) {
	t.Parallel()

	_, err := requireObjectField(map[string]any{
		"schemaVersion": float64(2),
	}, "contentJson", document.ErrInvalidDocumentContentJSON)
	if !errors.Is(err, document.ErrInvalidDocumentContentJSON) {
		t.Fatalf("expected invalid document content error, got %v", err)
	}
}

func TestRequireObjectFieldRejectsInvalidDocumentContentType(t *testing.T) {
	t.Parallel()

	_, err := requireObjectField(map[string]any{
		"contentJson": []any{},
	}, "contentJson", document.ErrInvalidDocumentContentJSON)
	if !errors.Is(err, document.ErrInvalidDocumentContentJSON) {
		t.Fatalf("expected invalid document content error, got %v", err)
	}
}

func TestRequireObjectFieldWithFallbackRejectsMissingGraphViewport(t *testing.T) {
	t.Parallel()

	_, err := requireObjectFieldWithFallback(map[string]any{
		"layoutJson": map[string]any{"nodes": map[string]any{}},
	}, "viewportJson", "viewport", graphlayout.ErrInvalidViewportJSON)
	if !errors.Is(err, graphlayout.ErrInvalidViewportJSON) {
		t.Fatalf("expected invalid viewport error, got %v", err)
	}
}

func TestOptionalObjectStrictRejectsInvalidNodePatchesType(t *testing.T) {
	t.Parallel()

	_, _, err := optionalObjectStrict(map[string]any{
		"nodePatches": []any{},
	}, "nodePatches", graphlayout.ErrInvalidLayoutJSON)
	if !errors.Is(err, graphlayout.ErrInvalidLayoutJSON) {
		t.Fatalf("expected invalid layout error, got %v", err)
	}
}
