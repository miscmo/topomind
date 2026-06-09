package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"topomind/apps/server/internal/auth"
	httpapi "topomind/apps/server/internal/http"
)

type bootstrapResponse struct {
	Workspace      bootstrapWorkspace       `json:"workspace"`
	Cursor         bootstrapCursor          `json:"cursor"`
	Config         bootstrapConfig          `json:"config"`
	KnowledgeBases []bootstrapKnowledgeBase `json:"knowledgeBases"`
	Cards          []bootstrapCard          `json:"cards"`
	Documents      []bootstrapDocument      `json:"documents"`
	GraphLayouts   []bootstrapGraphLayout   `json:"graphLayouts"`
	Attachments    []bootstrapAttachment    `json:"attachments"`
}

type bootstrapWorkspace struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	UpdatedAt string `json:"updatedAt"`
}

type bootstrapCursor struct {
	LastEventID int64 `json:"lastEventId"`
}

type bootstrapConfig struct {
	Version    int64          `json:"version"`
	ConfigJSON map[string]any `json:"configJson"`
	UpdatedAt  *string        `json:"updatedAt"`
}

type bootstrapKnowledgeBase struct {
	ID                string         `json:"id"`
	WorkspaceID       string         `json:"workspaceId"`
	Name              string         `json:"name"`
	SortOrder         int32          `json:"sortOrder"`
	CoverAttachmentID *string        `json:"coverAttachmentId"`
	Description       *string        `json:"description"`
	SettingsJSON      map[string]any `json:"settingsJson"`
	Version           int64          `json:"version"`
	CreatedAt         string         `json:"createdAt"`
	UpdatedAt         string         `json:"updatedAt"`
	DeletedAt         *string        `json:"deletedAt"`
}

type bootstrapCard struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspaceId"`
	KBID        string         `json:"kbId"`
	ParentID    *string        `json:"parentId"`
	Name        string         `json:"name"`
	SortOrder   int32          `json:"sortOrder"`
	Status      string         `json:"status"`
	MetaJSON    map[string]any `json:"metaJson"`
	Version     int64          `json:"version"`
	CreatedAt   string         `json:"createdAt"`
	UpdatedAt   string         `json:"updatedAt"`
	DeletedAt   *string        `json:"deletedAt"`
}

type bootstrapDocument struct {
	ID               string         `json:"id"`
	WorkspaceID      string         `json:"workspaceId"`
	CardID           string         `json:"cardId"`
	Type             string         `json:"type"`
	Title            string         `json:"title"`
	FileName         string         `json:"fileName"`
	ParentDocumentID *string        `json:"parentDocumentId"`
	SortOrder        int32          `json:"sortOrder"`
	SchemaVersion    int32          `json:"schemaVersion"`
	ContentJSON      map[string]any `json:"contentJson"`
	MetaJSON         map[string]any `json:"metaJson"`
	Version          int64          `json:"version"`
	CreatedAt        string         `json:"createdAt"`
	UpdatedAt        string         `json:"updatedAt"`
	DeletedAt        *string        `json:"deletedAt"`
}

type bootstrapGraphLayout struct {
	ID           string         `json:"id"`
	WorkspaceID  string         `json:"workspaceId"`
	KBID         string         `json:"kbId"`
	RoomCardID   *string        `json:"roomCardId"`
	LayoutJSON   map[string]any `json:"layoutJson"`
	ViewportJSON map[string]any `json:"viewportJson"`
	Version      int64          `json:"version"`
	UpdatedBy    *string        `json:"updatedBy"`
	CreatedAt    string         `json:"createdAt"`
	UpdatedAt    string         `json:"updatedAt"`
}

type bootstrapAttachment struct {
	ID              string         `json:"id"`
	WorkspaceID     string         `json:"workspaceId"`
	KnowledgeBaseID *string        `json:"knowledgeBaseId"`
	CardID          *string        `json:"cardId"`
	DocumentID      *string        `json:"documentId"`
	FileName        string         `json:"fileName"`
	MimeType        string         `json:"mimeType"`
	SizeBytes       int64          `json:"sizeBytes"`
	StorageProvider string         `json:"storageProvider"`
	StorageBucket   string         `json:"storageBucket"`
	StorageKey      string         `json:"storageKey"`
	SHA256          *string        `json:"sha256"`
	MetaJSON        map[string]any `json:"metaJson"`
	Version         int64          `json:"version"`
	CreatedAt       string         `json:"createdAt"`
	UpdatedAt       string         `json:"updatedAt"`
	DeletedAt       *string        `json:"deletedAt"`
}

func (h *Handler) Bootstrap(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		_ = httpapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "未登录或登录已过期", nil)
		return
	}

	workspaceID := chi.URLParam(r, "workspaceId")
	if workspaceID == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_workspace_id", "缺少 workspaceId", nil)
		return
	}

	snapshot, err := h.loadBootstrap(r.Context(), userID, workspaceID)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			_ = httpapi.WriteError(w, http.StatusNotFound, "workspace_not_found", "工作区不存在或无权访问", nil)
		default:
			_ = httpapi.WriteError(w, http.StatusInternalServerError, "bootstrap_failed", "读取工作区 bootstrap 失败", nil)
		}
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, snapshot)
}

func (h *Handler) loadBootstrap(ctx context.Context, userID string, workspaceID string) (bootstrapResponse, error) {
	workspace, err := h.loadBootstrapWorkspace(ctx, userID, workspaceID)
	if err != nil {
		return bootstrapResponse{}, err
	}

	lastEventID, err := h.loadLastEventID(ctx, workspaceID)
	if err != nil {
		return bootstrapResponse{}, err
	}

	config, err := h.loadBootstrapConfig(ctx, workspaceID)
	if err != nil {
		return bootstrapResponse{}, err
	}

	knowledgeBases, err := h.loadBootstrapKnowledgeBases(ctx, workspaceID)
	if err != nil {
		return bootstrapResponse{}, err
	}

	cards, err := h.loadBootstrapCards(ctx, workspaceID)
	if err != nil {
		return bootstrapResponse{}, err
	}

	documents, err := h.loadBootstrapDocuments(ctx, workspaceID)
	if err != nil {
		return bootstrapResponse{}, err
	}

	graphLayouts, err := h.loadBootstrapGraphLayouts(ctx, workspaceID)
	if err != nil {
		return bootstrapResponse{}, err
	}

	attachments, err := h.loadBootstrapAttachments(ctx, workspaceID)
	if err != nil {
		return bootstrapResponse{}, err
	}

	return bootstrapResponse{
		Workspace:      workspace,
		Cursor:         bootstrapCursor{LastEventID: lastEventID},
		Config:         config,
		KnowledgeBases: knowledgeBases,
		Cards:          cards,
		Documents:      documents,
		GraphLayouts:   graphLayouts,
		Attachments:    attachments,
	}, nil
}

func (h *Handler) loadBootstrapWorkspace(ctx context.Context, userID string, workspaceID string) (bootstrapWorkspace, error) {
	var item bootstrapWorkspace
	var updatedAt time.Time
	err := h.pool.QueryRow(
		ctx,
		`SELECT w.id, w.name, wm.role, w.updated_at
		 FROM workspace_members wm
		 JOIN workspaces w ON w.id = wm.workspace_id
		 WHERE wm.user_id = $1
		   AND wm.workspace_id = $2
		   AND w.deleted_at IS NULL`,
		userID,
		workspaceID,
	).Scan(&item.ID, &item.Name, &item.Role, &updatedAt)
	if err != nil {
		return bootstrapWorkspace{}, err
	}
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return item, nil
}

func (h *Handler) loadLastEventID(ctx context.Context, workspaceID string) (int64, error) {
	var lastEventID int64
	err := h.pool.QueryRow(
		ctx,
		`SELECT COALESCE(MAX(id), 0)
		 FROM sync_events
		 WHERE workspace_id = $1`,
		workspaceID,
	).Scan(&lastEventID)
	return lastEventID, err
}

func (h *Handler) loadBootstrapConfig(ctx context.Context, workspaceID string) (bootstrapConfig, error) {
	var (
		version    int64
		configJSON []byte
		updatedAt  *time.Time
	)

	err := h.pool.QueryRow(
		ctx,
		`SELECT version, config_json, updated_at
		 FROM workspace_configs
		 WHERE workspace_id = $1`,
		workspaceID,
	).Scan(&version, &configJSON, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return bootstrapConfig{
				Version:    1,
				ConfigJSON: map[string]any{},
				UpdatedAt:  nil,
			}, nil
		}
		return bootstrapConfig{}, err
	}

	return bootstrapConfig{
		Version:    version,
		ConfigJSON: decodeJSONObject(configJSON),
		UpdatedAt:  formatTimePtr(updatedAt),
	}, nil
}

func (h *Handler) loadBootstrapKnowledgeBases(ctx context.Context, workspaceID string) ([]bootstrapKnowledgeBase, error) {
	rows, err := h.pool.Query(
		ctx,
		`SELECT id, workspace_id, name, sort_order, cover_attachment_id, description, settings_json, version, created_at, updated_at, deleted_at
		 FROM knowledge_bases
		 WHERE workspace_id = $1
		 ORDER BY sort_order ASC, updated_at DESC, id ASC`,
		workspaceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]bootstrapKnowledgeBase, 0)
	for rows.Next() {
		var (
			item      bootstrapKnowledgeBase
			settings  []byte
			createdAt time.Time
			updatedAt time.Time
			deletedAt *time.Time
		)
		if err := rows.Scan(
			&item.ID,
			&item.WorkspaceID,
			&item.Name,
			&item.SortOrder,
			&item.CoverAttachmentID,
			&item.Description,
			&settings,
			&item.Version,
			&createdAt,
			&updatedAt,
			&deletedAt,
		); err != nil {
			return nil, err
		}
		item.SettingsJSON = decodeJSONObject(settings)
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		item.DeletedAt = formatTimePtr(deletedAt)
		items = append(items, item)
	}

	return items, rows.Err()
}

func (h *Handler) loadBootstrapCards(ctx context.Context, workspaceID string) ([]bootstrapCard, error) {
	rows, err := h.pool.Query(
		ctx,
		`SELECT id, workspace_id, kb_id, parent_id, name, sort_order, status, meta_json, version, created_at, updated_at, deleted_at
		 FROM cards
		 WHERE workspace_id = $1
		 ORDER BY kb_id ASC, COALESCE(parent_id::text, ''), sort_order ASC, updated_at DESC, id ASC`,
		workspaceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]bootstrapCard, 0)
	for rows.Next() {
		var (
			item      bootstrapCard
			metaJSON  []byte
			createdAt time.Time
			updatedAt time.Time
			deletedAt *time.Time
		)
		if err := rows.Scan(
			&item.ID,
			&item.WorkspaceID,
			&item.KBID,
			&item.ParentID,
			&item.Name,
			&item.SortOrder,
			&item.Status,
			&metaJSON,
			&item.Version,
			&createdAt,
			&updatedAt,
			&deletedAt,
		); err != nil {
			return nil, err
		}
		item.MetaJSON = decodeJSONObject(metaJSON)
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		item.DeletedAt = formatTimePtr(deletedAt)
		items = append(items, item)
	}

	return items, rows.Err()
}

func (h *Handler) loadBootstrapDocuments(ctx context.Context, workspaceID string) ([]bootstrapDocument, error) {
	rows, err := h.pool.Query(
		ctx,
		`SELECT id, workspace_id, card_id, type, title, file_name, parent_document_id, sort_order, schema_version, content_json, meta_json, version, created_at, updated_at, deleted_at
		 FROM documents
		 WHERE workspace_id = $1
		 ORDER BY card_id ASC, COALESCE(parent_document_id::text, ''), sort_order ASC, updated_at DESC, id ASC`,
		workspaceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]bootstrapDocument, 0)
	for rows.Next() {
		var (
			item        bootstrapDocument
			contentJSON []byte
			metaJSON    []byte
			createdAt   time.Time
			updatedAt   time.Time
			deletedAt   *time.Time
		)
		if err := rows.Scan(
			&item.ID,
			&item.WorkspaceID,
			&item.CardID,
			&item.Type,
			&item.Title,
			&item.FileName,
			&item.ParentDocumentID,
			&item.SortOrder,
			&item.SchemaVersion,
			&contentJSON,
			&metaJSON,
			&item.Version,
			&createdAt,
			&updatedAt,
			&deletedAt,
		); err != nil {
			return nil, err
		}
		item.ContentJSON = decodeJSONObject(contentJSON)
		item.MetaJSON = decodeJSONObject(metaJSON)
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		item.DeletedAt = formatTimePtr(deletedAt)
		items = append(items, item)
	}

	return items, rows.Err()
}

func (h *Handler) loadBootstrapGraphLayouts(ctx context.Context, workspaceID string) ([]bootstrapGraphLayout, error) {
	rows, err := h.pool.Query(
		ctx,
		`SELECT id, workspace_id, kb_id, room_card_id, layout_json, viewport_json, version, updated_by, created_at, updated_at
		 FROM graph_layouts
		 WHERE workspace_id = $1
		 ORDER BY kb_id ASC, updated_at DESC, id ASC`,
		workspaceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]bootstrapGraphLayout, 0)
	for rows.Next() {
		var (
			item         bootstrapGraphLayout
			layoutJSON   []byte
			viewportJSON []byte
			createdAt    time.Time
			updatedAt    time.Time
		)
		if err := rows.Scan(
			&item.ID,
			&item.WorkspaceID,
			&item.KBID,
			&item.RoomCardID,
			&layoutJSON,
			&viewportJSON,
			&item.Version,
			&item.UpdatedBy,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, err
		}
		item.LayoutJSON = decodeJSONObject(layoutJSON)
		item.ViewportJSON = decodeJSONObject(viewportJSON)
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		items = append(items, item)
	}

	return items, rows.Err()
}

func (h *Handler) loadBootstrapAttachments(ctx context.Context, workspaceID string) ([]bootstrapAttachment, error) {
	rows, err := h.pool.Query(
		ctx,
		`SELECT id, workspace_id, knowledge_base_id, card_id, document_id, file_name, mime_type, size_bytes, storage_provider, COALESCE(storage_bucket, ''), storage_key, sha256, meta_json, version, created_at, updated_at, deleted_at
		 FROM attachments
		 WHERE workspace_id = $1
		 ORDER BY created_at DESC, id ASC`,
		workspaceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]bootstrapAttachment, 0)
	for rows.Next() {
		var (
			item      bootstrapAttachment
			metaJSON  []byte
			createdAt time.Time
			updatedAt time.Time
			deletedAt *time.Time
		)
		if err := rows.Scan(
			&item.ID,
			&item.WorkspaceID,
			&item.KnowledgeBaseID,
			&item.CardID,
			&item.DocumentID,
			&item.FileName,
			&item.MimeType,
			&item.SizeBytes,
			&item.StorageProvider,
			&item.StorageBucket,
			&item.StorageKey,
			&item.SHA256,
			&metaJSON,
			&item.Version,
			&createdAt,
			&updatedAt,
			&deletedAt,
		); err != nil {
			return nil, err
		}
		item.MetaJSON = decodeJSONObject(metaJSON)
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		item.DeletedAt = formatTimePtr(deletedAt)
		items = append(items, item)
	}

	return items, rows.Err()
}

func decodeJSONObject(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}

	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return map[string]any{
			"_decodeError": err.Error(),
		}
	}
	if value == nil {
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
