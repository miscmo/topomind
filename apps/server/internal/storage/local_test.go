package storage

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestLocalDiskRoundTrip(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	adapter, err := NewLocalDisk(tempDir)
	if err != nil {
		t.Fatalf("new local disk: %v", err)
	}

	key, err := adapter.BuildKey("workspace-1/attachments", "diagram.png")
	if err != nil {
		t.Fatalf("build key: %v", err)
	}
	if !strings.HasSuffix(key, ".png") {
		t.Fatalf("expected png suffix, got %s", key)
	}
	if strings.Contains(key, "diagram") {
		t.Fatalf("expected raw file name to be excluded from key, got %s", key)
	}

	stored, err := adapter.Put(context.Background(), key, strings.NewReader("hello storage"))
	if err != nil {
		t.Fatalf("put object: %v", err)
	}
	if stored.SizeBytes != int64(len("hello storage")) {
		t.Fatalf("unexpected stored size: %d", stored.SizeBytes)
	}

	stat, err := adapter.Stat(context.Background(), key)
	if err != nil {
		t.Fatalf("stat object: %v", err)
	}
	if stat.SizeBytes != stored.SizeBytes {
		t.Fatalf("unexpected stat size: %d", stat.SizeBytes)
	}

	reader, info, err := adapter.Get(context.Background(), key)
	if err != nil {
		t.Fatalf("get object: %v", err)
	}

	content, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read object: %v", err)
	}
	if err := reader.Close(); err != nil {
		t.Fatalf("close reader: %v", err)
	}
	if string(content) != "hello storage" {
		t.Fatalf("unexpected content: %q", string(content))
	}
	if info.SizeBytes != stored.SizeBytes {
		t.Fatalf("unexpected get size: %d", info.SizeBytes)
	}

	if err := adapter.Delete(context.Background(), key); err != nil {
		t.Fatalf("delete object: %v", err)
	}
	if _, err := adapter.Stat(context.Background(), key); err == nil {
		t.Fatal("expected missing file after delete")
	}
}

func TestLocalDiskRejectsTraversalKey(t *testing.T) {
	t.Parallel()

	adapter, err := NewLocalDisk(t.TempDir())
	if err != nil {
		t.Fatalf("new local disk: %v", err)
	}

	if _, err := adapter.Put(context.Background(), "../escape.txt", strings.NewReader("bad")); !errors.Is(err, ErrInvalidStorageKey) {
		t.Fatalf("expected invalid storage key, got %v", err)
	}
}

func TestLocalDiskRejectsTraversalScope(t *testing.T) {
	t.Parallel()

	adapter, err := NewLocalDisk(t.TempDir())
	if err != nil {
		t.Fatalf("new local disk: %v", err)
	}

	if _, err := adapter.BuildKey("../escape", "secret.txt"); !errors.Is(err, ErrInvalidStorageKey) {
		t.Fatalf("expected invalid storage key, got %v", err)
	}
}
