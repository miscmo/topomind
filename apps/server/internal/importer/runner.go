package importer

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

type Runner struct {
	service *Service
	trigger chan struct{}
}

func NewRunner(service *Service) (*Runner, error) {
	if service == nil {
		return nil, errors.New("importer service is required")
	}
	runner := &Runner{
		service: service,
		trigger: make(chan struct{}, 1),
	}
	service.SetTrigger(runner.Trigger)
	return runner, nil
}

func (r *Runner) Start(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	r.Trigger()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-r.trigger:
		}
		r.processPending(ctx)
	}
}

func (r *Runner) Trigger() {
	select {
	case r.trigger <- struct{}{}:
	default:
	}
}

func (r *Runner) processPending(ctx context.Context) {
	for {
		job, ok, err := r.service.claimNextPendingJob(ctx)
		if err != nil || !ok {
			return
		}
		r.processJob(ctx, job)
	}
}

func (r *Runner) processJob(ctx context.Context, job ImportJob) {
	now := time.Now().UTC()
	startedAt := valueOrDefault(job.StartedAt, now.Format(time.RFC3339))
	sourceObjectKey := ""
	if job.SourceObjectKey != nil {
		sourceObjectKey = strings.TrimSpace(*job.SourceObjectKey)
	}
	if sourceObjectKey == "" {
		failure := "import source object key is missing"
		_ = r.service.failJob(ctx, job.ID, StageReport, map[string]any{
			"startedAt": startedAt,
			"failedAt":  now.Format(time.RFC3339),
		}, map[string]any{
			"status": "failed",
			"stage":  StageReport,
			"error":  failure,
		}, failure)
		return
	}

	reader, _, err := r.service.storage.Get(ctx, sourceObjectKey)
	if err != nil {
		failure := fmt.Sprintf("open import source file: %v", err)
		_ = r.service.failJob(ctx, job.ID, StageReport, map[string]any{
			"startedAt": startedAt,
			"failedAt":  now.Format(time.RFC3339),
		}, map[string]any{
			"status": "failed",
			"stage":  StageReport,
			"error":  failure,
		}, failure)
		return
	}
	defer reader.Close()

	report, summary, err := inspectZipArchive(reader)
	if err != nil {
		failure := fmt.Sprintf("scan import zip: %v", err)
		_ = r.service.failJob(ctx, job.ID, StageReport, map[string]any{
			"startedAt": startedAt,
			"failedAt":  now.Format(time.RFC3339),
		}, map[string]any{
			"status": "failed",
			"stage":  StageReport,
			"error":  failure,
		}, failure)
		return
	}

	failure := "zip import parser not implemented yet"
	mergedSummary := map[string]any{
		"startedAt":       startedAt,
		"scanCompletedAt": now.Format(time.RFC3339),
		"failedAt":        now.Format(time.RFC3339),
		"scanSummary":     summary,
	}
	report["status"] = "failed"
	report["stage"] = StageReport
	report["error"] = failure
	report["nextStep"] = "implement zip manifest parser and transactional entity import"
	_ = r.service.failJob(ctx, job.ID, StageReport, mergedSummary, report, failure)
}

func inspectZipArchive(reader io.Reader) (map[string]any, map[string]any, error) {
	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, nil, err
	}
	archive, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return nil, nil, err
	}
	if len(archive.File) == 0 {
		return nil, nil, errors.New("zip archive is empty")
	}

	fileCount := 0
	dirCount := 0
	var totalUncompressed int64
	topLevel := make(map[string]struct{})
	for _, item := range archive.File {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		if item.FileInfo().IsDir() {
			dirCount++
		} else {
			fileCount++
			totalUncompressed += int64(item.UncompressedSize64)
		}
		part := strings.Split(strings.ReplaceAll(name, "\\", "/"), "/")[0]
		if part != "" {
			topLevel[part] = struct{}{}
		}
	}

	if fileCount == 0 {
		return nil, nil, errors.New("zip archive has no files")
	}

	topLevelEntries := make([]string, 0, len(topLevel))
	for key := range topLevel {
		topLevelEntries = append(topLevelEntries, key)
	}
	report := map[string]any{
		"archive": map[string]any{
			"entryCount":             len(archive.File),
			"fileCount":              fileCount,
			"directoryCount":         dirCount,
			"totalUncompressedBytes": totalUncompressed,
			"topLevelEntries":        topLevelEntries,
		},
	}
	summary := map[string]any{
		"entryCount":             len(archive.File),
		"fileCount":              fileCount,
		"directoryCount":         dirCount,
		"totalUncompressedBytes": totalUncompressed,
	}
	return report, summary, nil
}

func valueOrDefault(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return strings.TrimSpace(*value)
}
