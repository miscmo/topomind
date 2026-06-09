package workspace

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"topomind/apps/server/internal/auth"
	httpapi "topomind/apps/server/internal/http"
)

type Handler struct {
	pool *pgxpool.Pool
}

type listResponse struct {
	Items []workspaceItem `json:"items"`
}

type workspaceItem struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	UpdatedAt string `json:"updatedAt"`
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		_ = httpapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "未登录或登录已过期", nil)
		return
	}

	rows, err := h.pool.Query(
		r.Context(),
		`SELECT w.id, w.name, wm.role, w.updated_at
		 FROM workspace_members wm
		 JOIN workspaces w ON w.id = wm.workspace_id
		 WHERE wm.user_id = $1
		   AND w.deleted_at IS NULL
		 ORDER BY w.updated_at DESC`,
		userID,
	)
	if err != nil {
		_ = httpapi.WriteError(w, http.StatusInternalServerError, "list_workspaces_failed", "读取工作区列表失败", nil)
		return
	}
	defer rows.Close()

	items := make([]workspaceItem, 0)
	for rows.Next() {
		var item workspaceItem
		var updatedAt time.Time
		if err := rows.Scan(&item.ID, &item.Name, &item.Role, &updatedAt); err != nil {
			_ = httpapi.WriteError(w, http.StatusInternalServerError, "list_workspaces_failed", "读取工作区列表失败", nil)
			return
		}
		item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		items = append(items, item)
	}

	if err := rows.Err(); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		_ = httpapi.WriteError(w, http.StatusInternalServerError, "list_workspaces_failed", "读取工作区列表失败", nil)
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, listResponse{Items: items})
}
