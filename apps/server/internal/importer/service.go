package importer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	filestorage "topomind/apps/server/internal/storage"
	"topomind/apps/server/internal/workspace"
)

const (
	StatusPending   = "pending"
	StatusRunning   = "running"
	StatusDone      = "done"
	StatusFailed    = "failed"
	StatusCancelled = "cancelled"

	StageSourceImport      = "source-import"
	StageScan              = "scan"
	StageImportStructure   = "import-structure"
	StagePush              = "push"
	StageImportAttachments = "import-attachments"
	StageReport            = "report"
)

type objectStorage interface {
	BuildKey(scope string, originalFileName string) (string, error)
	Put(ctx context.Context, key string, body io.Reader) (filestorage.ObjectInfo, error)
	Get(ctx context.Context, key string) (io.ReadCloser, filestorage.ObjectInfo, error)
	Delete(ctx context.Context, key string) error
}

type triggerFunc func()

type Service struct {
	pool    *pgxpool.Pool
	storage objectStorage
	now     func() time.Time
	trigger triggerFunc
}

type CreateImportJobInput struct {
	UserID         string
	WorkspaceID    string
	SourceFileName string
	SourceBody     io.Reader
}

type GetImportJobInput struct {
	UserID      string
	WorkspaceID string
	ImportJobID string
}

type ImportJob struct {
	ID              string         `json:"id"`
	WorkspaceID     string         `json:"workspaceId"`
	CreatedBy       *string        `json:"createdBy"`
	SourceFileName  string         `json:"sourceFileName"`
	SourceObjectKey *string        `json:"sourceObjectKey"`
	Status          string         `json:"status"`
	Stage           string         `json:"stage"`
	SummaryJSON     map[string]any `json:"summaryJson"`
	ReportJSON      map[string]any `json:"reportJson"`
	ErrorMessage    *string        `json:"errorMessage"`
	CreatedAt       string         `json:"createdAt"`
	UpdatedAt       string         `json:"updatedAt"`
	StartedAt       *string        `json:"startedAt"`
	CompletedAt     *string        `json:"completedAt"`
}

type ImportReport struct {
	ImportJobID string         `json:"importJobId"`
	Status      string         `json:"status"`
	Stage       string         `json:"stage"`
	ReportJSON  map[string]any `json:"reportJson"`
}

func NewService(pool *pgxpool.Pool, storage objectStorage) (*Service, error) {
	if pool == nil {
		return nil, errors.New("importer pool is required")
	}
	if storage == nil {
		return nil, errors.New("importer storage is required")
	}
	return &Service{
		pool:    pool,
		storage: storage,
		now:     time.Now,
	}, nil
}

func (s *Service) SetTrigger(trigger triggerFunc) {
	s.trigger = trigger
}

func (s *Service) CreateImportJob(ctx context.Context, input CreateImportJobInput) (ImportJob, error) {
	fileName := strings.TrimSpace(input.SourceFileName)
	if fileName == "" {
		return ImportJob{}, ErrInvalidSourceFileName
	}
	if input.SourceBody == nil {
		return ImportJob{}, ErrInvalidImportFile
	}

	if _, err := workspace.RequireMember(ctx, s.pool, input.WorkspaceID, input.UserID); err != nil {
		return ImportJob{}, err
	}

	storageKey, err := s.storage.BuildKey(path.Join("workspaces", input.WorkspaceID, "imports"), fileName)
	if err != nil {
		return ImportJob{}, fmt.Errorf("build import source object key: %w", err)
	}
	if _, err := s.storage.Put(ctx, storageKey, input.SourceBody); err != nil {
		return ImportJob{}, fmt.Errorf("store import source file: %w", err)
	}

	job, err := s.insertImportJob(ctx, input, storageKey)
	if err != nil {
		_ = s.storage.Delete(ctx, storageKey)
		return ImportJob{}, err
	}
	if s.trigger != nil {
		s.trigger()
	}
	return job, nil
}

func (s *Service) GetImportJob(ctx context.Context, input GetImportJobInput) (ImportJob, error) {
	if strings.TrimSpace(input.ImportJobID) == "" {
		return ImportJob{}, ErrInvalidImportJobID
	}
	if _, err := workspace.RequireMember(ctx, s.pool, input.WorkspaceID, input.UserID); err != nil {
		return ImportJob{}, err
	}
	job, ok, err := s.getImportJob(ctx, input.WorkspaceID, input.ImportJobID)
	if err != nil {
		return ImportJob{}, err
	}
	if !ok {
		return ImportJob{}, ErrImportJobNotFound
	}
	return job, nil
}

func (s *Service) GetImportReport(ctx context.Context, input GetImportJobInput) (ImportReport, error) {
	job, err := s.GetImportJob(ctx, input)
	if err != nil {
		return ImportReport{}, err
	}
	return ImportReport{
		ImportJobID: job.ID,
		Status:      job.Status,
		Stage:       job.Stage,
		ReportJSON:  job.ReportJSON,
	}, nil
}

func (s *Service) insertImportJob(ctx context.Context, input CreateImportJobInput, storageKey string) (ImportJob, error) {
	requestedAt := s.now().UTC().Format(time.RFC3339)
	summary := map[string]any{
		"requestedAt":    requestedAt,
		"sourceFileName": input.SourceFileName,
	}
	report := map[string]any{
		"status":      StageSourceImport,
		"message":     "import job queued",
		"requestedAt": requestedAt,
	}
	summaryJSON, err := json.Marshal(summary)
	if err != nil {
		return ImportJob{}, fmt.Errorf("encode import summary: %w", err)
	}
	reportJSON, err := json.Marshal(report)
	if err != nil {
		return ImportJob{}, fmt.Errorf("encode import report: %w", err)
	}

	var (
		item        ImportJob
		createdAt   time.Time
		updatedAt   time.Time
		startedAt   *time.Time
		completedAt *time.Time
	)
	err = s.pool.QueryRow(
		ctx,
		`INSERT INTO import_jobs (
		   workspace_id,
		   created_by,
		   source_file_name,
		   source_object_key,
		   status,
		   stage,
		   summary_json,
		   report_json
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
		 RETURNING id, workspace_id, created_by, source_file_name, source_object_key, status, stage, summary_json, report_json, error_message, created_at, updated_at, started_at, completed_at`,
		input.WorkspaceID,
		input.UserID,
		input.SourceFileName,
		storageKey,
		StatusPending,
		StageSourceImport,
		summaryJSON,
		reportJSON,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.CreatedBy,
		&item.SourceFileName,
		&item.SourceObjectKey,
		&item.Status,
		&item.Stage,
		&summaryJSON,
		&reportJSON,
		&item.ErrorMessage,
		&createdAt,
		&updatedAt,
		&startedAt,
		&completedAt,
	)
	if err != nil {
		return ImportJob{}, fmt.Errorf("insert import job: %w", err)
	}
	item.SummaryJSON = decodeJSONObject(summaryJSON)
	item.ReportJSON = decodeJSONObject(reportJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.StartedAt = formatTimePtr(startedAt)
	item.CompletedAt = formatTimePtr(completedAt)
	return item, nil
}

func (s *Service) getImportJob(ctx context.Context, workspaceID string, importJobID string) (ImportJob, bool, error) {
	var (
		item        ImportJob
		summaryJSON []byte
		reportJSON  []byte
		createdAt   time.Time
		updatedAt   time.Time
		startedAt   *time.Time
		completedAt *time.Time
	)
	err := s.pool.QueryRow(
		ctx,
		`SELECT id, workspace_id, created_by, source_file_name, source_object_key, status, stage, summary_json, report_json, error_message, created_at, updated_at, started_at, completed_at
		 FROM import_jobs
		 WHERE workspace_id = $1
		   AND id = $2`,
		workspaceID,
		importJobID,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.CreatedBy,
		&item.SourceFileName,
		&item.SourceObjectKey,
		&item.Status,
		&item.Stage,
		&summaryJSON,
		&reportJSON,
		&item.ErrorMessage,
		&createdAt,
		&updatedAt,
		&startedAt,
		&completedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ImportJob{}, false, nil
		}
		return ImportJob{}, false, fmt.Errorf("query import job: %w", err)
	}
	item.SummaryJSON = decodeJSONObject(summaryJSON)
	item.ReportJSON = decodeJSONObject(reportJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.StartedAt = formatTimePtr(startedAt)
	item.CompletedAt = formatTimePtr(completedAt)
	return item, true, nil
}

func (s *Service) claimNextPendingJob(ctx context.Context) (ImportJob, bool, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ImportJob{}, false, fmt.Errorf("begin import claim tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var nextID string
	err = tx.QueryRow(
		ctx,
		`SELECT id
		 FROM import_jobs
		 WHERE status = $1
		 ORDER BY created_at ASC, id ASC
		 LIMIT 1
		 FOR UPDATE SKIP LOCKED`,
		StatusPending,
	).Scan(&nextID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ImportJob{}, false, nil
		}
		return ImportJob{}, false, fmt.Errorf("select next import job: %w", err)
	}

	job, err := s.updateClaimedJobTx(ctx, tx, nextID)
	if err != nil {
		return ImportJob{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ImportJob{}, false, fmt.Errorf("commit import claim tx: %w", err)
	}
	return job, true, nil
}

func (s *Service) updateClaimedJobTx(ctx context.Context, tx pgx.Tx, importJobID string) (ImportJob, error) {
	var (
		item        ImportJob
		summaryJSON []byte
		reportJSON  []byte
		createdAt   time.Time
		updatedAt   time.Time
		startedAt   *time.Time
		completedAt *time.Time
	)
	err := tx.QueryRow(
		ctx,
		`UPDATE import_jobs
		 SET status = $2,
		     stage = $3,
		     started_at = COALESCE(started_at, NOW()),
		     updated_at = NOW(),
		     error_message = NULL
		 WHERE id = $1
		 RETURNING id, workspace_id, created_by, source_file_name, source_object_key, status, stage, summary_json, report_json, error_message, created_at, updated_at, started_at, completed_at`,
		importJobID,
		StatusRunning,
		StageScan,
	).Scan(
		&item.ID,
		&item.WorkspaceID,
		&item.CreatedBy,
		&item.SourceFileName,
		&item.SourceObjectKey,
		&item.Status,
		&item.Stage,
		&summaryJSON,
		&reportJSON,
		&item.ErrorMessage,
		&createdAt,
		&updatedAt,
		&startedAt,
		&completedAt,
	)
	if err != nil {
		return ImportJob{}, fmt.Errorf("claim import job: %w", err)
	}
	item.SummaryJSON = decodeJSONObject(summaryJSON)
	item.ReportJSON = decodeJSONObject(reportJSON)
	item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	item.StartedAt = formatTimePtr(startedAt)
	item.CompletedAt = formatTimePtr(completedAt)
	return item, nil
}

func (s *Service) failJob(ctx context.Context, importJobID string, stage string, summary map[string]any, report map[string]any, errMessage string) error {
	summaryJSON, err := json.Marshal(summary)
	if err != nil {
		return fmt.Errorf("encode import failure summary: %w", err)
	}
	reportJSON, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("encode import failure report: %w", err)
	}
	_, err = s.pool.Exec(
		ctx,
		`UPDATE import_jobs
		 SET status = $2,
		     stage = $3,
		     summary_json = $4::jsonb,
		     report_json = $5::jsonb,
		     error_message = $6,
		     completed_at = NOW(),
		     updated_at = NOW()
		 WHERE id = $1`,
		importJobID,
		StatusFailed,
		stage,
		summaryJSON,
		reportJSON,
		errMessage,
	)
	if err != nil {
		return fmt.Errorf("fail import job: %w", err)
	}
	return nil
}

func decodeJSONObject(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return map[string]any{}
	}
	return value
}

func formatTimePtr(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}
