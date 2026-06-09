package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrInvalidStorageRoot = errors.New("invalid storage root")
var ErrInvalidStorageKey = errors.New("invalid storage key")

type ObjectInfo struct {
	Key          string
	SizeBytes    int64
	LastModified time.Time
}

type LocalDisk struct {
	rootDir string
}

func NewLocalDisk(rootDir string) (*LocalDisk, error) {
	trimmed := strings.TrimSpace(rootDir)
	if trimmed == "" {
		return nil, ErrInvalidStorageRoot
	}
	absoluteRoot, err := filepath.Abs(trimmed)
	if err != nil {
		return nil, fmt.Errorf("resolve storage root: %w", err)
	}
	return &LocalDisk{rootDir: absoluteRoot}, nil
}

func (s *LocalDisk) RootDir() string {
	return s.rootDir
}

func (s *LocalDisk) BuildKey(scope string, originalFileName string) (string, error) {
	normalizedScope, err := normalizeScope(scope)
	if err != nil {
		return "", err
	}
	return path.Join(normalizedScope, uuid.NewString()+safeExtension(originalFileName)), nil
}

func (s *LocalDisk) Put(ctx context.Context, key string, body io.Reader) (ObjectInfo, error) {
	if err := ctx.Err(); err != nil {
		return ObjectInfo{}, err
	}
	if body == nil {
		return ObjectInfo{}, errors.New("storage body is required")
	}

	targetPath, err := s.resolvePath(key)
	if err != nil {
		return ObjectInfo{}, err
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return ObjectInfo{}, fmt.Errorf("create storage directory: %w", err)
	}

	tempFile, err := os.CreateTemp(filepath.Dir(targetPath), ".tmp-*")
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("create temp file: %w", err)
	}
	tempPath := tempFile.Name()
	defer func() {
		_ = tempFile.Close()
		_ = os.Remove(tempPath)
	}()

	size, err := io.Copy(tempFile, body)
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("write object: %w", err)
	}
	if err := tempFile.Close(); err != nil {
		return ObjectInfo{}, fmt.Errorf("close temp file: %w", err)
	}
	if err := os.Rename(tempPath, targetPath); err != nil {
		return ObjectInfo{}, fmt.Errorf("move temp file: %w", err)
	}

	stat, err := os.Stat(targetPath)
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("stat stored object: %w", err)
	}
	return ObjectInfo{
		Key:          key,
		SizeBytes:    size,
		LastModified: stat.ModTime().UTC(),
	}, nil
}

func (s *LocalDisk) Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	if err := ctx.Err(); err != nil {
		return nil, ObjectInfo{}, err
	}
	targetPath, err := s.resolvePath(key)
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	file, err := os.Open(targetPath)
	if err != nil {
		return nil, ObjectInfo{}, fmt.Errorf("open object: %w", err)
	}
	stat, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, ObjectInfo{}, fmt.Errorf("stat object: %w", err)
	}
	return file, ObjectInfo{
		Key:          key,
		SizeBytes:    stat.Size(),
		LastModified: stat.ModTime().UTC(),
	}, nil
}

func (s *LocalDisk) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	targetPath, err := s.resolvePath(key)
	if err != nil {
		return err
	}
	if err := os.Remove(targetPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("delete object: %w", err)
	}
	return nil
}

func (s *LocalDisk) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	if err := ctx.Err(); err != nil {
		return ObjectInfo{}, err
	}
	targetPath, err := s.resolvePath(key)
	if err != nil {
		return ObjectInfo{}, err
	}
	stat, err := os.Stat(targetPath)
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("stat object: %w", err)
	}
	return ObjectInfo{
		Key:          key,
		SizeBytes:    stat.Size(),
		LastModified: stat.ModTime().UTC(),
	}, nil
}

func (s *LocalDisk) resolvePath(key string) (string, error) {
	normalizedKey, err := normalizeKey(key)
	if err != nil {
		return "", err
	}
	targetPath := filepath.Join(s.rootDir, filepath.FromSlash(normalizedKey))
	relativePath, err := filepath.Rel(s.rootDir, targetPath)
	if err != nil {
		return "", fmt.Errorf("resolve storage path: %w", err)
	}
	if relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		return "", ErrInvalidStorageKey
	}
	return targetPath, nil
}

func normalizeScope(scope string) (string, error) {
	trimmed := strings.TrimSpace(scope)
	if trimmed == "" {
		return "", ErrInvalidStorageKey
	}
	normalized := path.Clean(strings.ReplaceAll(trimmed, "\\", "/"))
	if normalized == "." || normalized == "/" || strings.HasPrefix(normalized, "../") || normalized == ".." || path.IsAbs(normalized) {
		return "", ErrInvalidStorageKey
	}
	parts := strings.Split(normalized, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", ErrInvalidStorageKey
		}
	}
	return normalized, nil
}

func normalizeKey(key string) (string, error) {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return "", ErrInvalidStorageKey
	}
	normalized := path.Clean(strings.ReplaceAll(trimmed, "\\", "/"))
	if normalized == "." || normalized == "/" || strings.HasPrefix(normalized, "../") || normalized == ".." || path.IsAbs(normalized) {
		return "", ErrInvalidStorageKey
	}
	return normalized, nil
}

func safeExtension(originalFileName string) string {
	ext := strings.ToLower(path.Ext(strings.TrimSpace(originalFileName)))
	if ext == "" || len(ext) > 16 {
		return ""
	}
	for _, char := range ext {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '.' {
			continue
		}
		return ""
	}
	return ext
}
