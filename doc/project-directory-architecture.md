# TopoMind Project Directory Architecture

This repository is organized for the pure Web + Go backend migration.

## Root

```text
topomind_cc/
  apps/
    web/
    server/
  legacy/
    electron/
  doc/
  scripts/
  package.json
  package-lock.json
```

The root `package.json` is only the workspace entry point. Frontend dependencies and Vite scripts live in `apps/web/package.json`.

## `apps/web`

`apps/web` is the only active frontend application.

Use this directory for:

- React/Vite source code.
- Web-only adapters and API clients.
- Browser runtime configuration.
- Frontend assets under `public/`.
- Frontend package dependencies.

Key files:

```text
apps/web/src/
apps/web/public/
apps/web/index.html
apps/web/package.json
apps/web/vite.config.js
apps/web/tsconfig.json
apps/web/tailwind.config.js
apps/web/postcss.config.js
apps/web/components.json
```

Do not add new Electron IPC or `window.electronAPI` runtime dependencies here.

## `apps/server`

`apps/server` is the active Go backend workspace.

PostgreSQL is the primary business datastore. Backend code should be placed under the package boundary that owns the behavior.

```text
apps/server/
  cmd/server/
  internal/auth/
  internal/user/
  internal/workspace/
  internal/kb/
  internal/card/
  internal/document/
  internal/graph/
  internal/attachment/
  internal/importer/
  internal/sync/
  internal/job/
  internal/storage/
  internal/db/
  internal/http/
  internal/config/
  migrations/
```

## `legacy/electron`

`legacy/electron` contains the previous Electron implementation for migration reference only.

Use it to inspect:

- Former IPC channels.
- Local filesystem behavior.
- Local SQLite mirror behavior.
- Attachment and import job behavior.

Do not add new runtime functionality here. Any reusable behavior should be migrated into `apps/server` or replaced with a Web adapter in `apps/web`.

## Commands

Run frontend commands from the root:

```text
npm run dev
npm run typecheck
npm run build
npm run preview
```

Equivalent explicit commands:

```text
npm run dev:web
npm run typecheck:web
npm run build:web
npm run preview:web
```

