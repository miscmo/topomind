package workspace

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

var ErrWorkspaceNotFound = errors.New("workspace not found")

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func RequireMember(ctx context.Context, q queryRower, workspaceID string, userID string) (string, error) {
	var role string
	err := q.QueryRow(
		ctx,
		`SELECT wm.role
		 FROM workspace_members wm
		 JOIN workspaces w ON w.id = wm.workspace_id
		 WHERE wm.workspace_id = $1
		   AND wm.user_id = $2
		   AND w.deleted_at IS NULL`,
		workspaceID,
		userID,
	).Scan(&role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrWorkspaceNotFound
		}
		return "", err
	}
	return role, nil
}
