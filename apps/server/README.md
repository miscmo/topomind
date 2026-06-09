# TopoMind Go Server

This directory is the main backend workspace for the pure Web migration.

PostgreSQL is the primary business data store. Empty package directories are kept as migration targets for the next implementation phases.

## Migrations

TopoMind uses `goose` for PostgreSQL schema migrations.

Run from `apps/server`:

```powershell
$env:GOPROXY="https://goproxy.cn,direct"
go run github.com/pressly/goose/v3/cmd/goose -dir migrations postgres "$env:DATABASE_URL" up
go run github.com/pressly/goose/v3/cmd/goose -dir migrations postgres "$env:DATABASE_URL" down
go run github.com/pressly/goose/v3/cmd/goose -dir migrations postgres "$env:DATABASE_URL" status
```

The initial schema lives in `migrations/0001_init.sql`.
