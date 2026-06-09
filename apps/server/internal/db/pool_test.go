package db

import (
	"context"
	"strings"
	"testing"
)

func TestNewPoolRequiresDatabaseURL(t *testing.T) {
	t.Parallel()

	_, err := NewPool(context.Background(), "")
	if err == nil {
		t.Fatal("expected empty database url error")
	}
	if got, want := err.Error(), "database url is required"; got != want {
		t.Fatalf("unexpected error: got %q want %q", got, want)
	}
}

func TestNewPoolRejectsInvalidDatabaseURL(t *testing.T) {
	t.Parallel()

	_, err := NewPool(context.Background(), "://not-a-valid-postgres-url")
	if err == nil {
		t.Fatal("expected invalid database url error")
	}
	if !strings.Contains(err.Error(), "parse postgres config") {
		t.Fatalf("expected parse config error, got %q", err.Error())
	}
}
