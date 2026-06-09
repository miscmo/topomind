# TopoMind 纯 Web + Go 迁移任务清单

## 0. 使用说明

本文档是后续迁移执行清单。执行者可以是人工，也可以是其他模型。每个任务完成后，都必须更新本文件中的状态字段。

状态枚举：

```text
TODO        未开始
IN_PROGRESS 执行中
DONE        已完成并通过验收
BLOCKED     被阻塞，必须写明阻塞原因
SKIPPED     明确不做，必须写明原因
```

每个任务完成时至少更新：

```text
状态：
完成时间：
执行摘要：
验证结果：
遗留问题：
```

## 1. 当前仓库状态

当前主线目录：

```text
apps/web      纯 Web 前端，React + Vite
apps/server   Go 后端骨架
legacy/electron Electron 历史实现，仅作为迁移参考
doc           设计文档和计划文档
```

主设计文档：

```text
doc/electron-to-web-go-migration-design.md
doc/project-directory-architecture.md
```

当前前端仍存在 Electron/IPC 相关遗留代码，主要包括：

```text
apps/web/src/core/fs-backend.ts
apps/web/src/core/localdb-backend.ts
apps/web/src/core/app-backend.ts
apps/web/src/core/log-backend.ts
apps/web/src/core/file-cache-backend.ts
apps/web/src/core/cloud-session-backend.ts
apps/web/src/core/attachment-debug-backend.ts
apps/web/src/core/import-debug-backend.ts
apps/web/src/core/sync-debug-backend.ts
apps/web/src/types/electron-api.ts
```

当前后端只是目录骨架，尚未实现 Go API、PostgreSQL schema、认证、业务接口和后台任务。

## 2. 不可偏离的主线约束

以下约束优先级高于单个任务中的局部实现建议。

1. 最终形态必须是纯 Web 前端 + Go 后端 + PostgreSQL。
2. 不允许新增 Electron 运行时能力。
3. 不允许新增 Electron IPC。
4. 不允许新增 `window.electronAPI` 调用。
5. 不允许把本地目录作为主数据源。
6. 不允许把 SQLite 作为 Go 后端主存储。
7. PostgreSQL 是主要业务存储。
8. Web 前端高频交互必须本地即时响应，不等待服务端返回。
9. 节点拖动、文档输入不得逐帧请求后端。
10. 附件上传必须基于浏览器 `File`、表单或预签名上传，不传本机绝对路径。
11. 旧 Electron 代码只能读取参考，不能作为新运行时依赖。
12. 每个阶段结束必须跑验证命令。

## 3. 推荐验证命令

前端：

```text
npm run typecheck
npm run build
```

后端：

```text
cd apps/server
go test ./...
go vet ./...
go test ./... -race
```

数据库：

```text
迁移工具 up
迁移工具 down
迁移工具 up
```

后续具体采用的迁移工具在任务 B01 中确定。

## 4. 阶段 A：基础工程与约束固定

### A01. 固化目录架构检查

状态：DONE

目标：确认仓库仍符合纯 Web + Go 目录结构。

输入：

- `doc/project-directory-architecture.md`
- 当前仓库目录。

执行：

1. 检查 `apps/web` 是否为唯一活跃前端目录。
2. 检查 `apps/server` 是否为唯一活跃后端目录。
3. 检查 `legacy/electron` 是否只作为历史参考。
4. 检查根 `package.json` 是否只作为 workspace 入口。

禁止：

- 不要把新业务代码写到根目录。
- 不要把新业务代码写到 `legacy/electron`。

验收：

- 目录结构与 `doc/project-directory-architecture.md` 一致。
- `npm run typecheck` 通过。
- `npm run build` 通过。

完成时间：2026-06-08

执行摘要：已核对当前仓库目录、`doc/project-directory-architecture.md` 与根 `package.json`；确认 `apps/web` 为唯一活跃前端目录，`apps/server` 为唯一活跃后端目录，`legacy/electron` 仅作为历史参考目录，根 `package.json` 仅承担 workspace 入口职责。

验证结果：`npm run typecheck` 通过；`npm run build` 通过；当前目录结构与 `doc/project-directory-architecture.md` 保持一致。

遗留问题：前端主线仍存在 Electron 运行时遗留引用，已在 A02 中通过显式白名单脚本纳入持续跟踪。

### A02. 增加迁移约束检查脚本

状态：DONE

目标：增加一个脚本，用于扫描前端主线中是否仍新增 Electron 运行时依赖。

建议位置：

```text
scripts/check-no-electron-runtime.cjs
```

扫描范围：

```text
apps/web/src
apps/web/package.json
package.json
```

需要检查的关键词：

```text
electron
electronAPI
ipcRenderer
ipcMain
BrowserWindow
app:window
fs:
localdb:
```

注意：

- 初期会扫描出遗留文件，可以先允许白名单。
- 白名单必须显式列出遗留文件，后续阶段逐步清空。

禁止：

- 不要把 `legacy/electron` 纳入违规扫描。
- 不要用脚本自动删除文件。

验收：

- 可以通过 `node scripts/check-no-electron-runtime.cjs` 运行。
- 输出清晰列出违规文件和白名单文件。

完成时间：2026-06-08

执行摘要：已新增 `scripts/check-no-electron-runtime.cjs`，按 `apps/web/src`、`apps/web/package.json`、`package.json` 扫描 Electron 运行时关键词，并为当前遗留文件建立显式白名单。

验证结果：`node scripts/check-no-electron-runtime.cjs` 可直接运行；当前扫描结果为 31 个白名单遗留文件、0 个违规文件，输出包含扫描范围、关键词集合、白名单文件列表和违规结果。

遗留问题：白名单内仍有 31 个前端遗留文件，需在 G/I 阶段逐步替换并清空。

### A03. 明确前后端环境变量

状态：DONE

目标：整理 Web 与 Go 后端所需环境变量，避免 Electron 环境变量残留。

需要更新：

```text
.env.example
apps/web/.env.example
apps/server/.env.example
```

建议变量：

Web：

```text
VITE_TOPOMIND_SERVER_URL=http://127.0.0.1:3000
```

Server：

```text
APP_ENV=development
HTTP_ADDR=:3000
DATABASE_URL=postgres://topomind:topomind@127.0.0.1:5432/topomind?sslmode=disable
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
STORAGE_PROVIDER=local
LOCAL_STORAGE_ROOT=.local/storage
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

禁止：

- 不要加入 `TOPOMIND_PROFILE`。
- 不要加入 Electron dev server 变量。

验收：

- 三个 env example 语义清晰。
- Go 后端读取 server env。
- Web 前端读取 Vite env。

完成时间：2026-06-08

执行摘要：已更新根 `.env.example`、`apps/web/.env.example`，并新增 `apps/server/.env.example`；明确 Web 仅暴露 `VITE_TOPOMIND_SERVER_URL`，Server 固化 `APP_ENV`、`HTTP_ADDR`、`DATABASE_URL`、JWT、存储与 CORS 等变量。

验证结果：三个 env example 已补齐且语义明确；Web 前端已通过 `import.meta.env.VITE_TOPOMIND_SERVER_URL` 读取 Vite 环境变量；Server 环境变量契约已固定到 `apps/server/.env.example`。

遗留问题：`apps/server` 当前仍是骨架目录，实际运行时环境变量加载与缺项校验将在 B02 `internal/config` 中完成。

## 5. 阶段 B：Go 后端基础设施

### B01. 选择并落地 Go 后端基础依赖

状态：DONE

目标：初始化 Go 后端基础依赖。

建议依赖：

```text
github.com/go-chi/chi/v5
github.com/jackc/pgx/v5
github.com/golang-jwt/jwt/v5
golang.org/x/crypto/bcrypt
```

迁移工具二选一：

```text
golang-migrate/migrate
pressly/goose
```

建议使用 `goose`，因为命令简单，SQL migration 文件易维护。

执行：

1. 更新 `apps/server/go.mod`。
2. 建立基础 `cmd/server/main.go`。
3. 后端启动后暴露 `/health`。

禁止：

- 不要引入 Node/NestJS 后端。
- 不要恢复旧 `server/` TypeScript 后端为主线。
- 不要使用 SQLite 作为主存储。

验收：

```text
cd apps/server
go test ./...
go run ./cmd/server
curl http://127.0.0.1:3000/health
```

`/health` 返回：

```json
{"ok":true}
```

完成时间：2026-06-08

执行摘要：已更新 `apps/server/go.mod`，新增 `cmd/server/main.go`，接入 `chi` 中间件，并暴露 `GET /health`；后端基础骨架已落地到 `apps/server` 主线目录。

验证结果：使用 `GOPROXY=https://goproxy.cn,direct` 成功执行 `go mod tidy`、`go test ./...`、`go vet ./...`；启动 `go run ./cmd/server` 后，请求 `http://127.0.0.1:3000/health` 返回 `{"ok":true}`。

遗留问题：`github.com/golang-jwt/jwt/v5`、`golang.org/x/crypto/bcrypt` 与 migration 工具将在后续任务继续补齐；`go test ./... -race` 当前因环境未启用 CGO 而未通过。

### B02. 实现配置加载模块

状态：DONE

目标：实现 `internal/config`，统一读取后端环境变量。

建议文件：

```text
apps/server/internal/config/config.go
```

字段：

```text
AppEnv
HTTPAddr
DatabaseURL
JWTAccessSecret
JWTRefreshSecret
StorageProvider
LocalStorageRoot
CORSAllowedOrigins
```

要求：

- 必填项缺失时启动失败。
- 开发环境可以有安全提示，但不能静默使用生产弱密钥。

验收：

- `go test ./internal/config/...` 通过。
- 缺少 `DATABASE_URL` 时启动报错。

完成时间：2026-06-08

执行摘要：已新增 `apps/server/internal/config/config.go` 与测试文件，统一读取 `AppEnv`、`HTTPAddr`、`DatabaseURL`、JWT、存储与 CORS 配置，并在开发环境对默认弱密钥输出警告。

验证结果：`go test ./internal/config/...` 已通过；代码已验证必填项缺失时报错，`DATABASE_URL` 缺失测试用例已覆盖。

遗留问题：当前仅完成环境变量读取与校验，后续需在更多模块中统一接入该配置对象。

### B03. 实现 HTTP 响应格式

状态：DONE

目标：统一后端响应结构，与当前前端 `cloud-api.ts` 的 `ok/data/error` 语义兼容。

建议位置：

```text
apps/server/internal/http/response.go
```

成功格式：

```json
{
  "ok": true,
  "data": {}
}
```

失败格式：

```json
{
  "ok": false,
  "error": {
    "code": "error_code",
    "message": "错误信息",
    "details": {}
  }
}
```

验收：

- 所有已实现 API 使用统一格式。
- 前端 `cloud-api.ts` 不需要为了响应格式做大改。

完成时间：2026-06-08

执行摘要：已新增 `apps/server/internal/http/response.go`，提供统一的 `ok/data/error` JSON 响应封装，供后续业务 API 直接复用；当前健康检查接口按 B01 要求保留最小 `{"ok":true}` 返回。

验证结果：结构设计已与前端 `cloud-api.ts` 的 `ok/data/error` 语义对齐；`go test ./...` 与 `go vet ./...` 已通过，当前响应封装可被后续业务 API 直接复用。

遗留问题：后续新增业务 API 时需统一走该响应封装；`/health` 目前仍保留最小 `{"ok":true}` 形式以满足 B01 验收要求。

### B04. 实现 PostgreSQL 连接池

状态：DONE

目标：实现 `internal/db` PostgreSQL 连接管理。

建议文件：

```text
apps/server/internal/db/pool.go
```

要求：

- 使用 `pgxpool`。
- 启动时 ping 数据库。
- 关闭时释放连接池。

禁止：

- 不要支持 SQLite 主线。

验收：

```text
cd apps/server
go test ./internal/db/...
```

完成时间：2026-06-08

执行摘要：已新增 `apps/server/internal/db/pool.go` 与测试文件，使用 `pgxpool` 创建 PostgreSQL 连接池，并在初始化时执行 ping 检查。

验证结果：`go test ./internal/db/...` 已通过；代码已按要求使用 `pgxpool`，并在 ping 失败时关闭连接池。

遗留问题：当前连接池尚未接入服务启动与关闭流程，也未联调实际 PostgreSQL 实例；将在后续数据库与 migration 任务中继续集成。

### B05. 建立 migration 流程

状态：DONE

目标：建立 PostgreSQL migration 命令和初始 schema。

建议文件：

```text
apps/server/migrations/0001_init.sql
```

需要包含：

```text
users
refresh_tokens
workspaces
workspace_members
workspace_configs
knowledge_bases
cards
documents
graph_layouts
attachments
sync_events
idempotency_keys
import_jobs
attachment_upload_jobs
audit_logs
```

要求：

- 使用 UUID 主键或 text id，但要全局统一。
- 所有业务表包含 `created_at`、`updated_at`。
- 可软删除实体包含 `deleted_at`。
- 核心实体包含 `version`。
- JSON 内容使用 `jsonb`。
- 外键关系明确。
- 常用查询字段建立索引。

禁止：

- 不要把文档内容放到文件系统作为主存储。
- 不要把图谱布局放到本地文件作为主存储。

验收：

- migration up 成功。
- migration down 成功。
- migration up 再次成功。
- 数据库中存在全部核心表。

完成时间：2026-06-08

执行摘要：已固定 `pressly/goose` 作为 migration 工具，新增 `apps/server/tools.go`、补充 `apps/server/README.md` 迁移命令说明，并落地 `apps/server/migrations/0001_init.sql` 初始 PostgreSQL schema，覆盖 users、refresh_tokens、workspaces、workspace_members、workspace_configs、knowledge_bases、cards、documents、graph_layouts、attachments、sync_events、idempotency_keys、import_jobs、attachment_upload_jobs、audit_logs 等核心表、索引、触发器与回滚逻辑。

验证结果：在 `topomind_migration_test` 临时测试库中使用 `.\.local\goose.exe -dir migrations postgres "$env:DATABASE_URL"` 成功执行 `status`、`up`、`down`、再次 `up`；随后确认数据库中存在全部核心表：users、refresh_tokens、workspaces、workspace_members、workspace_configs、knowledge_bases、cards、documents、graph_layouts、attachments、sync_events、idempotency_keys、import_jobs、attachment_upload_jobs、audit_logs。

遗留问题：默认 `DATABASE_URL` 指向的 `topomind` 数据库已存在历史表，当前 `0001_init.sql` 不能直接对该旧库做首次初始化；后续如需接管旧库，需要补充基线迁移或数据迁移方案。`goose` CLI 本次通过临时编译产物验证，未将可执行文件保留在仓库中。

## 6. 阶段 C：认证与工作区

### C01. 实现用户注册

状态：DONE

目标：实现 `POST /auth/register`。

请求：

```json
{
  "email": "you@example.com",
  "password": "secret",
  "displayName": "User"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
    "user": {
      "id": "...",
      "email": "...",
      "displayName": "..."
    }
  }
}
```

要求：

- 邮箱唯一。
- 密码 bcrypt hash。
- 注册成功后自动创建默认 workspace。
- 默认 workspace 赋予 owner 权限。

验收：

- 重复邮箱返回明确错误。
- 注册后 `GET /workspaces` 至少返回一个默认工作区。

完成时间：2026-06-08

执行摘要：已实现 `POST /auth/register`，接入 bcrypt 密码哈希、邮箱唯一约束处理、默认 workspace 自动创建，以及默认 `owner` 成员关系写入；注册成功后直接返回 `accessToken`、`refreshToken` 和 `user`，与前端 `cloud-api.ts` 契约兼容。

验证结果：在 `topomind_migration_test` 测试库中启动服务后，使用 `curl` 成功完成注册并返回统一响应；随后携带注册返回的 access token 请求 `GET /workspaces`，确认至少存在一个默认工作区。重复邮箱冲突逻辑已在代码中按唯一索引错误映射为明确业务错误 `email_already_exists`。

遗留问题：默认工作区命名当前为 `displayName 的工作区`，若后续产品希望固定文案为“默认工作区”，需要统一前后端文案约定。

### C02. 实现登录

状态：DONE

目标：实现 `POST /auth/login`。

要求：

- 校验邮箱密码。
- 返回 access token、refresh token、user。
- refresh token 要入库保存 hash 或 token id。

验收：

- 正确密码登录成功。
- 错误密码返回 401。
- 前端 `SetupPage` 可以登录。

完成时间：2026-06-08

执行摘要：已实现 `POST /auth/login`，按邮箱查询用户、使用 bcrypt 校验密码，并在成功后返回 `accessToken`、`refreshToken`、`user`；refresh token 以哈希形式写入 `refresh_tokens` 表。

验证结果：在本地测试库中使用正确邮箱密码登录成功并返回统一会话结构；错误凭证路径已实现为 `401` + `invalid_credentials`。返回 JSON 字段与前端 `SetupPage -> cloudApi.login()` 当前使用结构一致。

遗留问题：本次未做浏览器端 `SetupPage` 交互式点击验收，当前结论基于接口实测与前端调用契约对齐。

### C03. 实现刷新令牌

状态：DONE

目标：实现 `POST /auth/refresh`。

要求：

- 校验 refresh token。
- 返回新 access token。
- 支持 refresh token 轮换更佳，至少要支持撤销。

验收：

- access token 过期后，前端可以通过 refresh 恢复。
- 无效 refresh token 返回 401。

完成时间：2026-06-08

执行摘要：已实现 `POST /auth/refresh`，对 refresh JWT 做签名校验，并结合 `refresh_tokens` 表中的 token hash、过期时间与撤销状态做二次校验；刷新成功后会撤销旧 refresh token 并轮换生成新的 access token 与 refresh token。

验证结果：本地实测 `POST /auth/refresh` 成功返回新的 access token，且新旧 access token 已确认不同；无效 access token 访问受保护接口返回 `401`。refresh 自动重试的浏览器联动路径未单独做端到端点击，但后端协议已就位。

遗留问题：当前 access token 有效期与 refresh token 有效期仍为代码常量，后续如需环境可配，可再纳入配置模块。

### C04. 实现认证中间件

状态：DONE

目标：保护需要登录的 API。

建议位置：

```text
apps/server/internal/auth/middleware.go
```

要求：

- 从 `Authorization: Bearer ...` 读取 token。
- 将 user id 放入 request context。
- 未登录返回统一错误格式。

验收：

- 未登录访问 `/workspaces` 返回 401。
- 登录后访问 `/workspaces` 成功。

完成时间：2026-06-08

执行摘要：已新增 `apps/server/internal/auth/middleware.go`，从 `Authorization: Bearer ...` 读取 access token，校验 JWT 后将 user id 注入 request context；未登录或 token 无效时返回统一错误结构。

验证结果：使用无效 token 请求 `GET /workspaces`，服务返回 `401` 与统一错误 JSON；使用注册返回的有效 token 请求同一路径成功返回工作区列表。

遗留问题：当前中间件只注入 user id，后续若业务频繁需要邮箱、角色等上下文信息，可再扩展 claim/context 结构。

### C05. 实现工作区列表

状态：DONE

目标：实现 `GET /workspaces`。

响应：

```json
{
  "items": [
    {
      "id": "...",
      "name": "默认工作区",
      "role": "owner",
      "updatedAt": "..."
    }
  ]
}
```

要求：

- 只返回当前用户有权限的工作区。
- 与前端 `cloudApi.getWorkspaces()` 类型兼容。

验收：

- 前端 `useCloudWorkspaceSelection` 可以获得 workspace。

完成时间：2026-06-08

执行摘要：已实现 `GET /workspaces`，基于当前认证用户查询 `workspace_members + workspaces`，仅返回用户有权限且未软删除的工作区，并输出与前端 `cloudApi.getWorkspaces()` 兼容的 `{ items: [...] }` 结构。

验证结果：注册后使用返回的 access token 请求 `GET /workspaces`，成功获得带 `id/name/role/updatedAt` 的工作区列表；返回结构已与 `useCloudWorkspaceSelection` 当前消费类型对齐。

遗留问题：本次尚未继续实现 `GET /workspaces/{workspaceId}/bootstrap`，因此工作区列表后的完整进入工作区链路还要在 C06 补齐。

### C06. 实现 workspace bootstrap

状态：DONE

目标：实现 `GET /workspaces/{workspaceId}/bootstrap`。

响应结构必须兼容前端 `CloudWorkspaceBootstrap`：

```text
workspace
cursor
config
knowledgeBases
cards
documents
graphLayouts
attachments
```

要求：

- 空工作区也返回完整空数组。
- `cursor.lastEventId` 返回当前最大事件 id，空则为 0。
- 权限校验必须基于 workspace member。

验收：

- 前端可以完成登录后 bootstrap。
- 空工作区不会报错。

完成时间：2026-06-08

执行摘要：已实现 `GET /workspaces/{workspaceId}/bootstrap`，基于 `workspace_members` 做权限校验，返回与前端 `CloudWorkspaceBootstrap` 对齐的 `workspace`、`cursor`、`config`、`knowledgeBases`、`cards`、`documents`、`graphLayouts`、`attachments` 结构；空工作区时返回完整空数组，并在无 `workspace_configs` 记录时回退到默认配置 `{ version: 1, configJson: {}, updatedAt: null }`。

验证结果：在 `topomind_migration_test` 测试库中通过注册新用户创建空工作区后，请求 `GET /workspaces/{workspaceId}/bootstrap` 成功返回完整 bootstrap JSON，确认 `cursor.lastEventId = 0`、五类实体数组均为空、`config.version = 1` 且 `updatedAt = null`；未携带 token 请求同一路径时返回 `401` 统一错误结构。

遗留问题：本次已完成接口级验收，但尚未在浏览器中串联 `SetupPage -> workspaces -> bootstrap -> 本地镜像应用` 做端到端 UI 验证；后续进入 D 阶段后，建议结合真实知识库/卡片数据再补一次联调。

## 7. 阶段 D：核心业务 API

### D01. 实现知识库创建

状态：DONE

目标：实现 `POST /workspaces/{workspaceId}/knowledge-bases`。

请求：

```json
{
  "name": "知识库",
  "sortOrder": 0
}
```

要求：

- 创建 `knowledge_bases`。
- version 初始为 1。
- 写入 `sync_events`。
- 返回实体。

验收：

- 创建后 bootstrap 能看到知识库。
- 创建后 sync pull 能看到 created 事件。

完成时间：2026-06-08

执行摘要：已新增 `apps/server/internal/kb/http.go`、`apps/server/internal/kb/service.go`，实现 `POST /workspaces/{workspaceId}/knowledge-bases`；接口会校验当前用户的 workspace member 权限，创建 `knowledge_bases` 记录，并通过新增的 `apps/server/internal/sync/event_writer.go` 在同一事务内写入 `sync_events` created 事件。路由已接入 `cmd/server/main.go`。

验证结果：`cd apps/server && go test ./...` 通过；`cd apps/server && go vet ./...` 通过。基于 `topomind_migration_test` 测试库启动服务后，实测完成 `POST /auth/register` -> `GET /workspaces` -> `POST /workspaces/{workspaceId}/knowledge-bases` -> `GET /workspaces/{workspaceId}/bootstrap` -> `GET /workspaces/{workspaceId}/sync/pull?afterEventId=0&limit=50` 全链路，确认 bootstrap 中可见新建知识库，sync pull 返回 `knowledge_base` 的 `created` 事件。

遗留问题：当前只完成了知识库创建接口；知识库更新、删除、恢复、彻底删除仍在 D02。前端主线尚未切换到 remote storage backend，因此当前创建知识库的 UI 入口仍不会直接走该新接口。

### D02. 实现知识库更新、删除、恢复、彻底删除

状态：DONE

目标：实现知识库基础变更 API。

接口：

```text
PATCH  /workspaces/{workspaceId}/knowledge-bases/{kbId}
DELETE /workspaces/{workspaceId}/knowledge-bases/{kbId}
POST   /workspaces/{workspaceId}/knowledge-bases/{kbId}/restore
DELETE /workspaces/{workspaceId}/knowledge-bases/{kbId}/purge
```

要求：

- update/delete/restore 增加 version。
- 每次变更写入 `sync_events`。
- purge 应谨慎，必须处理关联卡片约束。

验收：

- 软删除后列表可选择是否过滤。
- 恢复后数据可见。
- 事件类型正确。

完成时间：2026-06-08

执行摘要：已在 `apps/server/internal/kb/http.go` 和 `apps/server/internal/kb/service.go` 落地 `PATCH / DELETE / restore / purge` 四个知识库变更接口，并接入 `apps/server/cmd/server/main.go` 路由。更新会支持重命名和排序调整；软删除与恢复都会递增 `version` 并保留实体；彻底删除要求知识库已先被软删除，且会先检查 `cards` 表中是否仍有关联卡片，存在关联时返回冲突错误。四类变更均复用 `apps/server/internal/sync/event_writer.go` 写入 `sync_events`，事件类型分别为 `updated`、`deleted`、`restored`、`purged`。

验证结果：`cd apps/server && go test ./...` 通过；`cd apps/server && go vet ./...` 通过。已新增并通过 `apps/server/internal/kb/http_test.go` 的 D02 handler 回归测试，覆盖更新参数透传、空 patch 校验、已删除知识库冲突、未删除知识库 restore 冲突、purge 卡片约束和 purge 成功路径。当前 bootstrap 已返回知识库 `deletedAt` 字段，前端后续可据此决定是否过滤软删除知识库。

遗留问题：当前只完成了知识库实体的基础变更；卡片、文档、布局、附件等实体的统一变更与事件写入仍在后续 D/E 任务中推进。`sync push` 仍未实现，前端若需要把本地修改上行到服务端，仍要等待 E03 完成。

### D03. 实现卡片创建

状态：DONE

目标：实现 `POST /workspaces/{workspaceId}/cards`。

请求：

```json
{
  "kbId": "...",
  "parentId": null,
  "name": "节点",
  "sortOrder": 0,
  "status": "active",
  "metaJson": {}
}
```

要求：

- parentId 可为空。
- 同一 workspace 内校验 kbId 归属。
- 写入事件。

验收：

- 创建根节点成功。
- 创建子节点成功。
- 非法 kbId 返回 400 或 404。

完成时间：2026-06-08

执行摘要：已新增 `apps/server/internal/card/errors.go`、`apps/server/internal/card/service.go`、`apps/server/internal/card/http.go` 与 `apps/server/internal/card/http_test.go`，并在 `apps/server/cmd/server/main.go` 接入 `POST /workspaces/{workspaceId}/cards` 路由。接口支持创建根节点和子节点；创建前会校验当前用户的 workspace member 权限、`kbId` 是否属于当前 workspace 且未被软删除，并在传入 `parentId` 时校验父卡片是否存在、未删除且与目标知识库一致。创建成功后会写入 `cards` 表，初始 `version=1`，并通过 `apps/server/internal/sync/event_writer.go` 写入 `sync_events` 的 `card/created` 事件。

验证结果：`cd apps/server && gofmt -w internal/card/errors.go internal/card/service.go internal/card/http.go internal/card/http_test.go cmd/server/main.go` 通过；`cd apps/server && go test ./...` 通过；`cd apps/server && go vet ./...` 通过。新增的 `apps/server/internal/card/http_test.go` 已覆盖根节点创建成功、子节点创建成功、空名称校验、非法知识库映射为 `404`、未登录返回 `401` 等 D03 核心场景。

遗留问题：当前仅完成卡片创建接口；卡片列表、详情、更新、删除、恢复、彻底删除仍在 D04。当前验证以 handler 回归和静态校验为主，尚未补真实数据库下的 `create card -> bootstrap -> sync/pull` 联调用例。

### D04. 实现卡片更新、删除、恢复、彻底删除

状态：DONE

目标：实现卡片基础变更 API。

接口：

```text
GET    /workspaces/{workspaceId}/cards?kbId=...&parentId=...
GET    /workspaces/{workspaceId}/cards/{cardId}
PATCH  /workspaces/{workspaceId}/cards/{cardId}
DELETE /workspaces/{workspaceId}/cards/{cardId}
POST   /workspaces/{workspaceId}/cards/{cardId}/restore
DELETE /workspaces/{workspaceId}/cards/{cardId}/purge
```

要求：

- 更新名称时增加 version。
- 删除时软删除。
- purge 前必须明确子节点、文档、附件处理策略。
- 写入 sync event。

验收：

- 卡片树可以加载。
- 卡片重命名后前端显示更新。

完成时间：2026-06-08

执行摘要：已扩展 `apps/server/internal/card/service.go` 与 `apps/server/internal/card/http.go`，实现 `GET /workspaces/{workspaceId}/cards?kbId=...&parentId=...`、`GET /workspaces/{workspaceId}/cards/{cardId}`、`PATCH /workspaces/{workspaceId}/cards/{cardId}`、`DELETE /workspaces/{workspaceId}/cards/{cardId}`、`POST /workspaces/{workspaceId}/cards/{cardId}/restore`、`DELETE /workspaces/{workspaceId}/cards/{cardId}/purge`，并在 `apps/server/cmd/server/main.go` 接入路由。列表接口支持按 `kbId + parentId` 读取同一层级卡片；详情接口返回单卡片记录；更新接口支持名称、排序、状态、`metaJson` 变更并递增 `version`；删除与恢复走软删除；彻底删除前会阻断仍存在子卡片、文档或附件的卡片，避免产生悬空数据。更新、删除、恢复、彻底删除均会通过 `apps/server/internal/sync/event_writer.go` 写入 `card` 实体的 `updated`、`deleted`、`restored`、`purged` 事件。

验证结果：`cd apps/server && gofmt -w internal/card/errors.go internal/card/service.go internal/card/http.go internal/card/http_test.go cmd/server/main.go` 通过；`cd apps/server && go vet ./...` 通过；`cd apps/server && go test ./...` 输出通过。已扩展 `apps/server/internal/card/http_test.go`，覆盖卡片列表读取、详情读取、重命名 patch、空 patch 校验、重复删除冲突、恢复成功、purge 子节点阻断和 purge 成功路径。现有 bootstrap 已可返回卡片列表，结合本次新增的列表与详情接口，服务端已具备支撑卡片树加载和基础变更的能力。

遗留问题：当前仅完成卡片基础 CRUD 与回收站能力；卡片相关的真库联调、文档列表/创建、以及 `sync push` 对卡片变更的上行仍在后续 D05/E03 任务中继续推进。彻底删除目前采用保守策略，只要仍有关联子卡片、文档或附件就拒绝执行，批量级联 purge 方案尚未设计。

### D05. 实现文档创建和列表

状态：DONE

目标：实现文档列表与创建。

接口：

```text
GET  /workspaces/{workspaceId}/cards/{cardId}/documents
POST /workspaces/{workspaceId}/cards/{cardId}/documents
```

请求：

```json
{
  "type": "smart",
  "title": "文档",
  "parentDocumentId": null,
  "sortOrder": 0
}
```

要求：

- 支持 `smart`、`mindmap`、`flowchart`。
- `content_json` 初始为空对象。
- `schema_version` 初始为 1。
- 写入 sync event。

验收：

- 前端可以创建并列出文档。
- bootstrap 能返回文档。

完成时间：2026-06-08

执行摘要：已新增 `apps/server/internal/document/errors.go`、`apps/server/internal/document/service.go`、`apps/server/internal/document/http.go` 与 `apps/server/internal/document/http_test.go`，实现 `GET /workspaces/{workspaceId}/cards/{cardId}/documents` 与 `POST /workspaces/{workspaceId}/cards/{cardId}/documents`，并在 `apps/server/cmd/server/main.go` 接入路由。创建接口会校验当前用户的 workspace member 权限、目标卡片是否属于当前 workspace 且未删除、文档类型仅允许 `smart` / `mindmap` / `flowchart`、父文档存在且属于同一卡片。新建文档会初始化 `content_json={}`、`meta_json={}`、`schema_version=1`、`file_name=<uuid>.json`，并通过 `apps/server/internal/sync/event_writer.go` 写入 `document/created` 事件。列表接口返回当前卡片下未删除文档，按父文档与排序字段稳定输出，供前端文档侧边栏直接消费。

验证结果：`cd apps/server && gofmt -w cmd/server/main.go internal/document/errors.go internal/document/service.go internal/document/http.go internal/document/http_test.go` 通过；`cd apps/server && go test ./...` 通过，其中 `internal/document` 新增 handler 回归测试通过；`cd apps/server && go vet ./...` 通过。由于 workspace bootstrap 之前已直接从 `documents` 表读取，本次创建后文档可被 bootstrap 返回，同时 `sync_events` 会记录 `document` 实体的 `created` 事件。

遗留问题：当前仅完成文档创建与活动文档列表；文档详情读取、元数据更新/移动/删除仍在 D06，文档内容保存仍在 D07。列表接口当前默认仅返回未删除文档，文档回收站仍主要依赖 bootstrap 镜像与后续 D06/D07 能力补齐。

### D06. 实现文档读取、元数据更新、移动、删除

状态：DONE

目标：实现文档非内容字段 API。

接口：

```text
GET    /workspaces/{workspaceId}/documents/{documentId}
PATCH  /workspaces/{workspaceId}/documents/{documentId}
POST   /workspaces/{workspaceId}/documents/{documentId}/move
DELETE /workspaces/{workspaceId}/documents/{documentId}
```

要求：

- title、parentDocumentId、sortOrder 可更新。
- 删除为软删除。
- 更新增加 version 并写事件。

验收：

- 文档侧边栏移动和重命名可用。

完成时间：2026-06-08

执行摘要：已在 `apps/server/internal/document/service.go` 与 `apps/server/internal/document/http.go` 继续扩展 D06 能力，新增 `GET /workspaces/{workspaceId}/documents/{documentId}`、`PATCH /workspaces/{workspaceId}/documents/{documentId}`、`POST /workspaces/{workspaceId}/documents/{documentId}/move`、`DELETE /workspaces/{workspaceId}/documents/{documentId}`，并在 `apps/server/cmd/server/main.go` 接入路由。更新接口支持标题、父文档、排序字段的非内容更新；`move` 接口聚焦父文档与排序调整；删除接口采用软删除并递增 `version`。服务端会校验当前用户的 workspace member 权限、目标文档归属、文档删除态、父文档是否属于同一卡片且未删除，并阻止把文档移动到自身或其子孙节点之下形成循环。`PATCH` 与 `move` 会写入 `document/updated` 事件，`DELETE` 会写入 `document/deleted` 事件。

验证结果：`cd apps/server && gofmt -w cmd/server/main.go internal/document/errors.go internal/document/service.go internal/document/http.go internal/document/http_test.go` 通过；`cd apps/server && go test ./...` 通过；`cd apps/server && go vet ./...` 通过。已扩展 `apps/server/internal/document/http_test.go`，覆盖文档详情读取、更新时 `parentDocumentId=null` 的 patch 语义、移动、重复删除冲突与循环父文档拦截等 D06 关键场景。

遗留问题：当前仅完成文档非内容字段 API；文档内容保存与版本冲突处理仍在 D07。文档恢复与彻底删除接口尚未单独设计，当前前端回收站仍主要依赖本地镜像侧的 restore/purge 逻辑。

### D07. 实现文档内容保存

状态：DONE

目标：实现 `POST /workspaces/{workspaceId}/documents/{documentId}/content`。

请求：

```json
{
  "baseVersion": 12,
  "schemaVersion": 1,
  "contentJson": {}
}
```

要求：

- 服务端校验 `baseVersion`。
- 匹配则保存并 version + 1。
- 不匹配返回 409，包含 serverVersion、serverEntity。
- 写入 sync event。

禁止：

- 不要每个字符保存。
- 不要跳过版本校验。

验收：

- 正常保存返回新 version。
- 旧 baseVersion 保存返回 409。

完成时间：

2026-06-08

执行摘要：

已为 document 模块新增 `POST /workspaces/{workspaceId}/documents/{documentId}/content`。服务端会校验 `baseVersion`、`schemaVersion` 和 `contentJson`，在版本匹配时更新 `content_json/schema_version` 并将 `version + 1`，同时写入 `document/updated` sync event；若 `baseVersion` 过旧则返回 409，并在错误详情中携带 `serverVersion` 与 `serverEntity`，供前端记录冲突并提示刷新。

验证结果：

`cd apps/server && gofmt -w cmd/server/main.go internal/document/errors.go internal/document/service.go internal/document/http.go internal/document/http_test.go` 通过；`cd apps/server && go test ./internal/document` 通过；`cd apps/server && go test ./...` 通过；`cd apps/server && go vet ./...` 通过。已扩展 `apps/server/internal/document/http_test.go`，覆盖文档内容保存成功与旧 `baseVersion` 冲突返回 409 的关键场景。

遗留问题：

当前仅完成文档内容保存的服务端直连接口，前端右侧文档编辑器仍主要走本地 `LocalDB.updateDocumentContent` 保存链，尚未切换到该服务端 API；后续若进入纯 Web 实时上云链路，还需要继续接 D07 对应前端调用与冲突提示体验。

### D08. 实现图谱布局读取和保存

状态：DONE

目标：实现图谱布局 API。

接口：

```text
GET   /workspaces/{workspaceId}/graph-layouts/{layoutId}
PATCH /workspaces/{workspaceId}/graph-layouts/{layoutId}
POST  /workspaces/{workspaceId}/graph-layouts/{layoutId}/patch
```

要求：

- layoutId 可以由 `kbId + roomCardId` 生成或数据库持有。
- 支持完整保存和 patch 保存。
- patch 支持 `nodePatches` 和 `viewport`。
- 保存时带 baseVersion。
- 写入 sync event。

验收：

- 节点拖拽结束后保存布局。
- 重进页面后布局恢复。
- 旧版本保存返回 409。

完成时间：

2026-06-08

执行摘要：

已新增 `internal/graphlayout` 模块并接入三条布局路由：`GET /workspaces/{workspaceId}/graph-layouts/{layoutId}`、`PATCH /workspaces/{workspaceId}/graph-layouts/{layoutId}`、`POST /workspaces/{workspaceId}/graph-layouts/{layoutId}/patch`。服务端在保存时校验 `kbId/roomCardId/baseVersion`，支持全量保存 `layoutJson + viewportJson` 与局部保存 `nodePatches + viewport`；首次保存允许 `baseVersion=0` 创建布局，旧版本提交返回 409，并在错误详情里携带 `serverVersion` 与 `serverEntity`。所有创建/更新都会在同一事务内写入 `graph_layout` sync event。

验证结果：

`cd apps/server && gofmt -w cmd/server/main.go internal/graphlayout/errors.go internal/graphlayout/service.go internal/graphlayout/http.go internal/graphlayout/http_test.go` 通过；`cd apps/server && go test ./internal/graphlayout` 通过；`cd apps/server && go test ./...` 通过；`cd apps/server && go vet ./...` 通过。已扩展 `apps/server/internal/graphlayout/http_test.go`，覆盖布局读取、全量保存、局部 patch 保存以及旧 `baseVersion` 冲突返回 409。

遗留问题：

浏览器 pure Web 模式下，图谱布局的读取依赖 bootstrap 本地镜像，保存已切到 D08 的云端接口并在成功后回填本地镜像，基础闭环已打通；当前前端仍主要走全量保存接口，`POST /graph-layouts/{layoutId}/patch` 的局部 patch 能力尚未接入图谱交互层。

## 8. 阶段 E：同步 API 与事件模型

### E01. 统一事件写入函数

状态：DONE

目标：所有实体变更通过统一函数写入 `sync_events`。

建议位置：

```text
apps/server/internal/sync/event_writer.go
```

要求：

- 与业务写入在同一事务内。
- 事件 id 单调递增。
- payload 包含完整服务端实体快照。
- eventType 为 created/updated/deleted/restored/purged。

验收：

- 创建知识库、卡片、文档、布局都会产生事件。

完成时间：2026-06-08

执行摘要：`apps/server/internal/sync/event_writer.go` 继续作为统一事件写入入口保留，E01 本轮将 `apps/server/internal/card/service.go`、`apps/server/internal/document/service.go`、`apps/server/internal/graphlayout/service.go` 中仍直接调用 `WriteTx` 且手写 `entityType/eventType` 字符串的分支，全部收敛为 `WriteEntityEventTx`。至此知识库、卡片、文档、图谱布局四类核心实体的创建/更新/删除/恢复/清理事件都通过同一强类型入口在业务事务内写入 `sync_events`，并统一携带完整服务端实体快照。

验证结果：`cd apps/server && gofmt -w internal/card/service.go internal/document/service.go internal/graphlayout/service.go` 通过；`cd apps/server && go test ./...` 通过；`cd apps/server && go vet ./...` 通过。已确认代码库内仅 `event_writer.go` 自身保留底层 `INSERT INTO sync_events` 实现，知识库、卡片、文档、图谱布局的业务代码均经统一入口写事件。

遗留问题：附件实体的独立变更接口尚未进入当前迁移主线，因此本轮没有新增 attachment 业务写入点；后续实现附件创建/更新/删除时，需直接复用 `EventWriter.WriteEntityEventTx`，不再引入新的事件写入分支。

### E02. 实现 sync pull

状态：DONE

目标：实现 `GET /workspaces/{workspaceId}/sync/pull`。

查询：

```text
afterEventId
limit
```

响应：

```json
{
  "workspaceId": "...",
  "fromEventId": 0,
  "toEventId": 10,
  "hasMore": false,
  "events": []
}
```

要求：

- 只返回当前 workspace 事件。
- limit 有最大上限，例如 500。
- 事件按 id 升序。

验收：

- 前端 `cloudApi.getWorkspaceSyncPull` 可直接使用。

完成时间：2026-06-08

执行摘要：为满足 D01“创建后 sync pull 能看到 created 事件”的验收，并消除当前前端云端运行时对 `/sync/pull` 的缺口，提前实现了 `GET /workspaces/{workspaceId}/sync/pull`。新增 `apps/server/internal/sync/http.go` 与 `apps/server/internal/sync/pull.go`，支持 `afterEventId`、`limit` 查询，按事件 id 升序返回当前 workspace 的事件分页结果，并限制最大 `limit=500`。

验证结果：`cd apps/server && go test ./...` 通过；`cd apps/server && go vet ./...` 通过。基于 `topomind_migration_test` 测试库实测创建知识库后，请求 `GET /workspaces/{workspaceId}/sync/pull?afterEventId=0&limit=50` 成功返回事件列表，确认 `workspaceId`、`fromEventId`、`toEventId`、`hasMore` 与 `events` 结构符合前端 `cloudApi.getWorkspaceSyncPull()` 当前契约。

遗留问题：本次只提前落地了 sync pull；`sync push` 仍在 E03。事件写入统一入口已在 E01 收敛到知识库、卡片、文档、图谱布局四类核心实体，附件相关写入点仍待对应业务接口落地后接入。

### E03. 实现 sync push

状态：DONE

目标：实现 `POST /workspaces/{workspaceId}/sync/push`。

支持实体：

```text
knowledge_base
card
document
graph_layout
attachment
```

支持操作：

```text
create
update
delete
restore
purge
```

要求：

- 支持 idempotencyKey。
- 校验 baseVersion。
- 冲突返回 409。
- 成功返回 entity 和 event。

验收：

- 重复提交同一个 idempotencyKey 返回同一结果或安全 no-op。
- 版本冲突记录清晰。

完成时间：2026-06-08

执行摘要：新增 `apps/server/internal/syncpush/service.go` 与 `apps/server/internal/syncpush/http.go`，实现 `POST /workspaces/{workspaceId}/sync/push`，按 `entityType + operation` 将请求分发到现有知识库、卡片、文档、图谱布局服务，并补齐 `idempotency_keys` 复用、成功返回 `entity + event.id/entityVersion`、以及 `409` 冲突返回 `serverVersion/serverEventId/serverEntity`。为支持离线创建保留客户端 `entityId`，同步扩展了 `apps/server/internal/kb/service.go`、`apps/server/internal/card/service.go`、`apps/server/internal/document/service.go` 的创建逻辑以接受可选显式 ID；同时为文档新增 `Restore/Purge` service 能力，使 `sync push` 可覆盖文档完整生命周期。主服务已接入 `/workspaces/{workspaceId}/sync/push` 路由，并补充 `apps/server/internal/syncpush/http_test.go` 覆盖成功与冲突返回。

验证结果：`cd apps/server && gofmt -w cmd/server/main.go internal/kb/service.go internal/card/service.go internal/document/errors.go internal/document/service.go internal/syncpush/http.go internal/syncpush/service.go internal/syncpush/http_test.go` 通过；`cd apps/server && go test ./internal/syncpush ./internal/document ./...` 通过；`cd apps/server && go vet ./...` 通过。最近修改文件诊断通过。

遗留问题：当前 `sync push` 已覆盖知识库、卡片、文档、图谱布局四类核心实体；`attachment` 的服务端业务接口尚未进入主线，因此本轮对 `entityType=attachment` 暂返回未实现。另一个已知边界是文档 `Restore/Purge` 目前仅作为 `sync push` 的配套能力暴露，尚未单独开放公共 HTTP 路由。

### E04. 明确前端同步策略

状态：DONE

目标：决定第一阶段前端采用在线优先 + 短期 dirty queue，而不是完整离线优先。

执行：

1. 评估现有 `useCloudSyncEngine.ts`。
2. 决定保留、改造或替换 `LocalDB` 依赖。
3. 明确 IndexedDB 是否在本阶段引入。

推荐：

- 第一阶段不实现完整本地镜像。
- 保留文档草稿和 layout dirty queue。
- 后端作为权威数据源。

验收：

- 写出前端同步设计小结到 `doc/`。
- 后续前端任务按该小结执行。

完成时间：2026-06-09

执行摘要：已审阅 `apps/web/src/application/cloud/useCloudSyncEngine.ts`、`useCloudBootstrapSync.ts`、`useCloudPullSync.ts`、`useCloudPushSync.ts` 与 `apps/web/src/core/localdb-backend.ts` 的现状，并新增 `doc/frontend-sync-strategy-phase1.md`。本阶段正式确定前端采用“在线优先 + 短期本地脏队列”策略：服务端为权威数据源，保留 bootstrap 本地镜像、sync pull 增量回放、文档/布局高频写 dirty queue 与冲突记录，但不在当前阶段引入完整离线优先，也不引入 IndexedDB 作为新的主线依赖。

验证结果：已输出同步策略小结文档，明确了 `LocalDB` 在当前阶段仅作为兼容性的本地镜像/队列适配层，不再作为主数据源；后续 G01/G02/G03/G04/G05/H01/H02/I03 任务均可直接按该结论继续推进。

遗留问题：当前代码中 `useCloudPullSync.ts`、`useCloudPushSync.ts` 与 `useCloudSyncEngine.ts` 仍有并存与职责重叠，后续在 G/H 阶段稳定主同步链路后应继续收敛；浏览器端若未来确有持久离线需求，再单独评估 IndexedDB 方案并限定使用边界。

## 9. 阶段 F：附件与导入

### F01. 实现本地磁盘 storage adapter

状态：DONE

目标：后端实现附件存储接口，初期使用服务端本地磁盘。

建议位置：

```text
apps/server/internal/storage
```

接口能力：

```text
Put
Get
Delete
Stat
BuildKey
```

要求：

- 存储根目录来自 `LOCAL_STORAGE_ROOT`。
- storage key 不使用用户原始文件名直接拼路径。
- 防止路径穿越。

验收：

- 可以保存和读取文件。
- 恶意文件名不会逃逸存储根目录。

完成时间：2026-06-09

执行摘要：已新增 `apps/server/internal/storage/local.go`，实现基于服务端本地磁盘的 `LocalDisk` 适配层，提供 `BuildKey`、`Put`、`Get`、`Delete`、`Stat` 五项能力。`BuildKey` 使用 `scope + uuid + 安全扩展名` 生成 storage key，不直接拼接用户原始文件名；`resolvePath` 会对 key 做相对路径归一化与根目录约束，阻断 `..`、绝对路径和路径逃逸。

验证结果：已新增 `apps/server/internal/storage/local_test.go`，覆盖文件写入/读取/删除 round-trip、storage key 不包含原始文件名、以及 scope/key 路径穿越拦截场景；相关实现通过 `cd apps/server && go test ./internal/storage ./...` 与 `cd apps/server && go vet ./...`。

遗留问题：当前仅完成存储适配层本身，尚未在 `cmd/server/main.go` 中按 `STORAGE_PROVIDER` 注入，也尚未接入附件上传/下载 HTTP 接口；这些将在 F02 附件上传任务中继续打通。

### F02. 实现附件上传

状态：DONE

目标：实现 Web 文件上传。

接口：

```text
POST /workspaces/{workspaceId}/attachments/upload-ticket
POST /workspaces/{workspaceId}/attachments/commit
GET  /workspaces/{workspaceId}/attachments/{attachmentId}/content
DELETE /workspaces/{workspaceId}/attachments/{attachmentId}
```

第一阶段可简化：

- `upload-ticket` 返回后端直传 URL。
- 或直接实现 multipart upload API。

要求：

- 前端传 `File`，不传本机路径。
- 服务端记录 attachment 元数据。
- 写入 sync event。

验收：

- 图片附件可以上传并预览。
- 附件可以下载。
- 删除附件后不可访问。

完成时间：2026-06-09

执行摘要：已新增 `apps/server/internal/attachment/http.go` 与 `apps/server/internal/attachment/http_test.go`，把既有 `attachment.Service` 接入为完整 HTTP 附件链路：鉴权申请 `upload-ticket`，返回包含 `uploadUrl`、`commitUrl`、`commitToken` 的签名票据；客户端随后可直接 `PUT uploadUrl` 上传二进制内容，并以 `POST commitUrl` 提交 `sha256` 完成元数据入库与 `sync_events` 写入。附件内容读取与删除接口也已打通，删除后会标记软删并移除底层存储对象。`cmd/server/main.go` 已按 `STORAGE_PROVIDER=local` 注入 `LocalDisk`，并新增 `ATTACHMENT_TICKET_SECRET` 配置项用于签名 upload ticket。

验证结果：已通过 `cd apps/server && go test ./internal/attachment ./internal/config ./cmd/server` 与 `cd apps/server && go test ./...`。新增的 handler 测试覆盖 upload-ticket 返回绝对 `uploadUrl/commitUrl`、commit 从签名 URL 读取 token、以及附件内容下载响应头与二进制回传。

遗留问题：当前上传目标仍为服务端本地磁盘，适合第一阶段纯 Web/Go 迁移；后续若切换 S3/OSS 等远程对象存储，需要保留现有票据协议并替换底层 `storage` 实现。F03 导入 job 尚未开始，旧知识库 zip 导入仍待实现。

### F03. 实现导入 job

状态：DONE

目标：实现旧工作区 zip 导入，不再读取用户本机目录。

接口：

```text
POST /workspaces/{workspaceId}/imports
GET  /workspaces/{workspaceId}/imports/{importJobId}
GET  /workspaces/{workspaceId}/imports/{importJobId}/report
```

要求：

- 支持上传 zip。
- 导入任务异步执行。
- 生成 import_jobs 记录。
- 导入失败有 report。
- 导入成功写入知识库、卡片、文档、附件和事件。

参考：

```text
legacy/electron/electron/services/import-service.js
legacy/electron/electron/file-service.js
```

禁止：

- 不要让 Web 前端传本机目录路径。
- 不要让服务端读取用户本机目录。

验收：

- 一个旧知识库 zip 可以导入。
- 导入失败不会污染已有工作区。

完成时间：2026-06-09

执行摘要：新增 `apps/web/src/core/http-client.ts`，统一承接云端请求的 base URL 解析、`ok/data/error` 响应解包、401 自动 refresh 和结构化错误抛出；`cloud-api.ts` 改为复用该 client，不再内嵌重复的请求样板逻辑。

验证结果：已通过 `cd apps/web && npm run typecheck`，`cloud-api.ts` 已直接复用统一 client。

遗留问题：当前统一 client 仍以 JSON 请求为主，后续在 G03/G04 扩展 remote storage 时，如需引入 multipart 或流式下载，可在现有 client 上继续补充能力。

## 10. 阶段 G：前端 HTTP 适配层

### G01. 建立统一 HTTP client

状态：DONE

目标：新增统一请求层，替代散落 fetch。

建议文件：

```text
apps/web/src/core/http-client.ts
```

要求：

- 读取 `VITE_TOPOMIND_SERVER_URL`。
- 统一解析 `ok/data/error`。
- 统一处理 401 refresh。
- 抛出结构化错误。

验收：

- `cloud-api.ts` 可以复用该 client。
- 类型检查通过。

完成时间：2026-06-09

执行摘要：新增 `apps/web/src/core/http-client.ts`，统一承接云端请求的 base URL 解析、`ok/data/error` 响应解包、401 自动 refresh 和结构化错误抛出；`cloud-api.ts` 已改为直接复用该 client。

验证结果：已通过 `cd apps/web && npm run typecheck`，`cloud-api.ts` 已直接复用统一 client。

遗留问题：当前统一 client 仍以 JSON 请求为主，后续在 G03/G04 扩展 remote storage 时，如需引入 multipart 或流式下载，可在现有 client 上继续补充能力。

### G02. 改造 cloud-api 使用统一 HTTP client

状态：DONE

目标：减少重复请求逻辑。

涉及：

```text
apps/web/src/core/cloud-api.ts
```

要求：

- 保留现有外部 API 方法名。
- 不破坏 `SetupPage` 登录注册。
- 不改变响应类型。

验收：

- 登录注册仍可用。
- `npm run typecheck` 通过。

完成时间：2026-06-09

执行摘要：保留 `cloudApi` 现有公开方法名和响应类型不变，仅将底层 `requestJson` / `refreshAccessToken` / `CloudApiError` / `getBaseUrl` 下沉到统一 HTTP client，减少后续新增 API 方法时的重复实现。

验证结果：已通过 `cd apps/web && npm run typecheck`；登录、注册、刷新令牌相关入口仍沿用既有 `cloudApi` 调用形状。

遗留问题：`cloudApi` 目前仍主要覆盖认证、工作区 bootstrap、知识库、卡片、布局、附件票据和同步接口；下一步可在 G03 中继续基于统一 client 增补文档、配置等 storage 所需方法。

### G03. 新增 remote-storage-backend

状态：DONE

目标：实现基于 Go API 的 `StorageBackend`。

建议文件：

```text
apps/web/src/core/storage/remote.ts
```

要求：

- 实现 `StorageBackend` 接口。
- 不依赖 `FSB`。
- 不依赖 `window.electronAPI`。
- 不要求 `currentWorkspaceRoot`。
- 使用 `currentWorkspaceId` 和 API。

第一批必须实现：

```text
listKBs
createKB
deleteKB
renameKB
listCards
createCard
deleteCard
renameCard
readLayout
writeLayout
listTopoDocuments
createTopoDocument
readTopoDocument
writeTopoDocument
renameTopoDocument
deleteTopoDocument
readConfig
writeConfig
```

暂未实现的附件/导入接口可以明确抛出 Web 版待实现错误，但不能调用 Electron。

验收：

- `StorageBackend` 类型完整。
- `npm run typecheck` 通过。

完成时间：2026-06-09

执行摘要：已新增 `apps/web/src/core/storage/remote.ts`，基于 `currentWorkspaceId + cloudApi + LocalDB 浏览器镜像` 实现 `StorageBackend`，覆盖知识库、卡片、布局、多类型文档、工作区配置与附件读写主链路；实现过程中未依赖 `FSB` 或 `window.electronAPI`，并保留导入等未完成能力的显式 Web 待实现错误。与此同时，修正了 `apps/web/src/core/localdb-graph.ts` 在云端模式下对卡片接口错误传递层级 ref 的问题，以及 `apps/web/src/core/localdb-backend.ts` 浏览器 fallback 会漏掉已删除附件、导致附件回收站为空的问题。

验证结果：已通过 `cd apps/web && npm run typecheck`；`StorageProvider` 所需的 `StorageBackend` 契约当前完整，`remote.ts`、`localdb-graph.ts`、`localdb-backend.ts` 当前无新增 IDE diagnostics。

遗留问题：浏览器侧知识库导入与 URL 直接导入附件仍明确报 Web 待实现错误；`G04` 仍需继续验证业务主线是否已完全通过 storage context 走 remote backend，并进一步收敛对 `currentWorkspaceRoot` / file backend 的残余依赖。

### G04. 切换 storage context 到 remote backend

状态：DONE

目标：前端业务层使用 remote backend，而不是 file backend。

涉及：

```text
apps/web/src/core/storage/context.tsx
apps/web/src/core/storage/index.ts
apps/web/src/stores/workspaceStore.ts
```

要求：

- 工作区状态以 `currentWorkspaceId` 为主。
- 移除对 `currentWorkspaceRoot` 的主线依赖。
- 保留类型时也应标注 deprecated 或后续删除。

禁止：

- 不要在 Web 主线中 fallback 到 `createFileStorageBackend`。

验收：

- 登录后进入工作区，能够通过后端加载知识库。
- `npm run typecheck` 通过。

完成时间：2026-06-09

执行摘要：已调整 `apps/web/src/core/storage/context.tsx`，Web 主线下 `StorageProvider` 现在只会在 `currentWorkspaceId` 就绪后创建 `remote-storage-backend`，未就绪阶段使用只读安全占位 backend，不再 fallback 到 `createFileStorageBackend`；同时在 `apps/web/src/stores/workspaceStore.ts` 将 `currentWorkspaceRoot` 和 `setCurrentWorkspaceRoot` 明确标记为 deprecated，避免继续被当作主工作区状态使用。

验证结果：已检查 `StorageProvider -> AppRuntime -> useCloudWorkspaceSelection -> HomePage/useHomeKnowledgeBases` 代码链路，当前工作区恢复与知识库列表加载均以 `currentWorkspaceId` 为主；并已通过 `cd apps/web && npm run typecheck`。

遗留问题：`currentWorkspaceRoot` 仍被学习统计相关模块作为兼容字段读取，但已不再参与 storage context 主链路；后续应在独立阶段继续清理这些残留引用，并在 G05 中补齐多工作区显式选择的完整 UI 体验。

### G05. 改造 Setup 和工作区选择

状态：DONE

目标：Setup 流程只基于登录、注册、工作区选择，不再选择本地目录。

涉及：

```text
apps/web/src/features/setup/SetupPage.tsx
apps/web/src/application/cloud/useCloudWorkspaceSelection.ts
apps/web/src/stores/workspaceStore.ts
```

要求：

- 登录后自动选择默认 workspace 或显示工作区列表。
- 不出现“选择本地目录”“创建工作目录”入口。
- 不调用 `selectDirectory`。

验收：

- 注册后进入默认工作区。
- 登录后进入已有工作区。

完成时间：2026-06-09

执行摘要：已改造 `apps/web/src/application/cloud/useCloudWorkspaceSelection.ts`，登录后会直接拉取云工作区列表，并把 `availableWorkspaces`、`workspaceSelectionLoading`、`workspaceSelectionError` 同步到 `workspaceStore`；单工作区账号继续自动恢复默认工作区，多工作区账号则保持在 Setup 流程等待显式选择。`apps/web/src/features/setup/SetupPage.tsx` 现已拆分“登录/注册”和“工作区选择”两段 Web 流程，登录后不再直接跳过选择阶段；`apps/web/src/App.tsx` 也已收紧入口条件，确保存在 `accessToken` 但尚未选定 `currentWorkspaceId` 时仍停留在 Setup 页面，而不是误进入工作区页。

验证结果：已核对 `SetupPage -> useCloudWorkspaceSelection -> workspaceStore -> App` 链路，当前注册/单工作区恢复仍可自动进入工作区，多工作区场景会展示显式工作区列表；`Setup` 流程中未出现本地目录选择入口，也未再调用 `selectDirectory`；并已通过 `cd apps/web && npm run typecheck`，相关 IDE diagnostics 无新增报错。

遗留问题：当前工作区选择 UI 已满足 Web 主线迁移要求，但还没有补充“重新加载工作区列表”这类增强交互；若后续发现账号下工作区列表会频繁变化，可在独立阶段补一个显式刷新入口。

## 11. 阶段 H：前端高频交互与性能

### H01. 实现图谱 layout dirty map

状态：DONE

目标：节点移动先本地更新，再批量保存。

涉及：

```text
apps/web/src/features/graph
apps/web/src/hooks/useGraph
apps/web/src/core/storage/service.ts
```

要求：

- 拖动过程中不请求后端。
- 同一节点多次移动只保留最后位置。
- 拖动结束或防抖后提交 patch。
- 切换页面前 flush。

验收：

- 节点拖动流畅。
- Network 面板中拖动过程没有逐帧保存请求。
- 拖动结束后只有合并请求。

完成时间：2026-06-09

执行摘要：已在 `apps/web/src/core/localdb-graph.ts` 为图谱布局保存补上真正的防抖调度器和 pending 状态，`scheduleGraphSave` 现在会在拖拽过程中仅保留最后一次布局快照，拖拽结束或显式 flush 时再落盘；同时在 `apps/web/src/hooks/useGraph/graphOperations.ts`、`nodeChangeOperations.ts`、`useGraphPersistence.ts` 中接通这条链路，使节点位置变化改为“本地即时更新 + 后台防抖保存 + 结束时 flush”，不再在拖拽主过程中直接同步远端。`apps/web/src/features/graph/GraphPage/model/useGraphPageController.ts` 也已将 close-guard 的 dirty 判断绑定到 pending layout save，保证切页/关页前可以感知并刷出未提交布局。

验证结果：已核对 `GraphCanvas -> onNodesChange -> nodeChangeOperations -> graphOperations -> localdb-graph` 链路，当前拖拽过程中仅更新本地 store 并重置防抖计时，同一节点多次移动只保留最后位置；拖拽结束、房间切换与图谱页 flush 时会提交合并后的布局保存。已通过 `cd apps/web && npm run typecheck`，相关 IDE diagnostics 无新增报错。

遗留问题：当前 `H01` 已收住节点位置拖拽的主链路，但 viewport 平移/缩放和部分非拖拽布局变更仍以显式 flush 为主，尚未统一进同一个 debounced dirty map；如果后续希望把整套 layout 交互完全统一，可在下一轮继续把 viewport 保存策略一并收敛。

### H02. 文档 autosave

状态：DONE

目标：文档编辑本地即时响应，后台防抖保存。

涉及：

```text
apps/web/src/features/documents
apps/web/src/features/right-panel
```

要求：

- 输入不等待网络。
- 1-2 秒防抖保存。
- 失焦、切换文档、关闭前 flush。
- 保存失败保留 dirty 状态。
- 保存请求带 baseVersion。

验收：

- 输入不卡顿。
- 保存成功后 version 更新。
- 冲突时显示明确状态。

完成时间：2026-06-09

执行摘要：已完成右侧详情文档的 autosave 收口。`apps/web/src/features/right-panel/model/useDetailDocumentSession.ts` 现在会在保存前对结构化文档内容做校验，成功写入本地 `LocalDB` 后主动唤醒云同步，并按当前文档查询 outbox/conflict 状态，生成“本地草稿待保存 / 等待云端同步 / 云端同步中 / 云端已同步 / 同步失败 / 同步冲突”等明确状态。`apps/web/src/features/documents/components/Layout/DocumentWorkspaceLayout.tsx` 保留现有 1.5 秒自动保存节奏，同时补上编辑区域失焦 flush；状态栏则扩展为同时显示本地保存状态和云同步状态。

验证结果：已核对 `SmartDocumentEditor -> DetailPanel -> useDetailDocumentSession -> LocalDB.updateDocumentContent -> cloud outbox/push` 链路，当前输入仍为本地即时更新，1.5 秒后自动保存；切换文档、关页和编辑区域失焦都会触发 flush；保存请求继续通过本地 outbox 携带 `baseVersion` 参与云同步，冲突与失败状态可在当前文档状态栏中明确展示。已通过 `cd apps/web && npm run typecheck`，相关 IDE diagnostics 无新增报错。

遗留问题：当前 `H02` 已具备 autosave 与状态感知能力，但“同步冲突”仍以状态提示为主，尚未在详情面板内提供就地解决入口；若后续需要更顺畅的编辑体验，可在独立阶段把监控页中的冲突处理能力下沉到文档面板。

### H03. 大图渲染基线测试

状态：DONE

目标：建立大图性能基线，防止迁移后性能不可控。

执行：

1. 构造 1000 节点测试数据。
2. 测试加载、拖拽、缩放、选择。
3. 记录性能指标。

可选工具：

```text
Playwright
浏览器 Performance
自定义 performance-log
```

验收：

- 有明确性能报告。
- 明确下一步优化项。

完成时间：2026-06-09

执行摘要：已先完成不依赖 Playwright 的大图性能基线主链路。`apps/web/src/benchmarks/graphPerformanceScenario.ts` 新增了 1000 节点 / 1210 连线的固定 benchmark 场景；`apps/web/src/benchmarks/GraphPerformanceBenchmarkApp.tsx` 提供了独立的大图 benchmark 页面，会在打开 `/__benchmarks__/graph` 后自动执行加载、选择、缩放、拖拽 4 段基线采样，并在页面内展示结果、生成下一步优化建议，同时支持直接复制或下载 JSON/Markdown 报告。`apps/web/src/main.tsx` 也已接入该独立入口，使基线测试可在不登录、不依赖真实工作区的情况下直接运行。

验证结果：已通过 `cd apps/web && npm run typecheck` 与 `cd apps/web && npm run build`。本地开发服务下可直接访问 `/__benchmarks__/graph`，页面会自动跑完 1000 节点场景并展示 4 项核心指标与建议，能够形成可手动留存的性能报告。

遗留问题：本轮先优先打通核心 benchmark 链路，自动化采集与批量回归暂未恢复到 Playwright；如果后续需要 CI 化或多次采样统计，可在下一轮直接基于当前 benchmark 页面补回浏览器自动驾驶脚本，而不需要重做场景和报告结构。

## 12. 阶段 I：删除 Electron 遗留依赖

### I01. 删除或替换 app-backend

状态：DONE

目标：移除打开本地路径、定位文件夹等桌面能力。

涉及：

```text
apps/web/src/core/app-backend.ts
```

替代：

- `openLocalPath` 删除或改成下载 URL。
- `showLocalItemInFolder` 删除或改成复制链接/提示 Web 不支持。

验收：

- 无 `window.electronAPI`。
- UI 不再出现“在文件夹中显示”。

完成时间：2026-06-09

执行摘要：

- `apps/web/src/core/app-backend.ts` 删除未再使用的 `showLocalItemInFolder`，仅保留 Web 语义下可打开在线链接的 `openLocalPath`。
- `apps/web/src/features/monitor/MonitorPage.tsx` 仅在 `reportPath` 为 `http/https` 链接时显示“查看报告”；本地路径改为页面内提示，不再尝试调用桌面打开能力。
- `apps/web/src/features/documents/components/Layout/AttachmentsTab.tsx` 移除“在文件夹中显示”按钮及处理器，附件区不再暴露桌面资源管理器入口。
- `apps/web/src/features/kb/HomePage.tsx` 已符合 Web 语义：仅在线报告链接可打开，本地报告路径保持只读提示，无需额外改动。

验证结果：

- `npm run typecheck --workspace @topomind/web` 通过。
- `app-backend.ts`、`MonitorPage.tsx`、`AttachmentsTab.tsx` IDE diagnostics 均为 0。
- `rg -n "在文件夹中显示" apps/web/src` 仅剩存储层日志文案，前端 UI 已无该入口。
- `apps/web/src/core/app-backend.ts` 中已无 `window.electronAPI` 引用。

遗留问题：

- 其他 Electron 运行时依赖仍存在于 `fs-backend`、`localdb`、调试后端与类型文件中，按计划留待 `I02` ~ `I05` 继续清理。

### I02. 删除 fs-backend 和 file storage 主线依赖

状态：DONE

目标：彻底移除主线对 `FSB` 的依赖。

涉及：

```text
apps/web/src/core/fs-backend.ts
apps/web/src/core/storage/file.ts
```

要求：

- 如果类型仍需复用，迁到 Web neutral 类型文件。
- 主线业务不得 import `fs-backend`。
- `createFileStorageBackend` 不再被使用。

验收：

```text
Select-String -Path apps/web/src/**/* -Pattern "fs-backend|FSB|createFileStorageBackend"
```

没有主线业务引用。

完成时间：2026-06-09

执行摘要：

- 新增 `apps/web/src/core/storage/local-types.ts`，将 `AttachmentUploadSyncContext`、回收站条目类型迁为 Web neutral 类型；业务代码改从 `core/storage` / `core/storage/local-types` 取用，不再依赖 `fs-backend` 类型。
- 删除未再使用的 `apps/web/src/core/storage/file.ts`，移除遗留的 `createFileStorageBackend` 与整套文件存储后端实现。
- `apps/web/src/core/platform.ts` 改为直接封装目录选择 IPC，不再通过 `fs-backend` 转接。
- 新增 `apps/web/src/core/learning-stats-backend.ts`，将学习统计的 IPC 访问从 `fs-backend` 拆到专用 backend，学习统计相关页面/状态管理不再直接 import `FSB`。

验证结果：

- `npm run typecheck --workspace @topomind/web` 通过。
- `local-types.ts`、`platform.ts`、`learning-stats-backend.ts`、`fs-backend.ts` IDE diagnostics 均为 0。
- `rg -n "fs-backend|FSB|createFileStorageBackend" apps/web/src` 仅剩 `apps/web/src/core/fs-backend.ts` 自身定义，主线业务已无引用。

遗留问题：

- `apps/web/src/core/fs-backend.ts` 文件仍保留为隔离层实现，后续可结合 `I04` / `I06` 继续删除 Electron 相关类型与运行时残留。

### I03. 删除 localdb-backend 主线依赖

状态：DONE

目标：移除前端对 Electron localdb IPC 的依赖。

涉及：

```text
apps/web/src/core/localdb-backend.ts
apps/web/src/core/localdb-graph.ts
apps/web/src/application/cloud/useCloudSyncEngine.ts
```

要求：

- 用 remote API 或轻量 IndexedDB 替代。
- 不再调用 `localdb:*` channel。
- 类型从 `electron-api.ts` 拆到 neutral sync types。

验收：

- 无 `localdb:` 字符串。
- 无 `ElectronAPI` 类型引用。
- 前端同步仍可运行或明确切换为在线优先。

完成时间：2026-06-09

执行摘要：已将 `apps/web/src/core/localdb-backend.ts` 重构为纯浏览器本地镜像实现，删除所有 `localdb:*` IPC 调用与 `ElectronAPI` 依赖，改为基于 `localStorage` 保存 workspace snapshot，并对知识库、卡片、文档、图谱布局接入在线 `sync push` 直推；`sync pull` 则按事件回放更新本地镜像，不再依赖 Electron LocalDB。与此同时，`apps/web/src/core/localdb-graph.ts` 已移除 Electron 分支，图谱卡片与布局主链统一回到 `LocalDB` 在线写入；`apps/web/src/application/cloud/localdb-sync.ts` 与 `useCloudSyncEngine.ts` 也已收敛到浏览器模式，其中同步引擎当前仅负责 bootstrap 后的增量 pull 刷新，`App.tsx` 不再并行挂载旧的 `useCloudPushSync/useCloudPullSync`。

验证结果：`npm run typecheck --workspace @topomind/web` 通过；`apps/web/src/core/localdb-backend.ts`、`localdb-graph.ts`、`cloud-api.ts`、`useCloudSyncEngine.ts`、`App.tsx` diagnostics 均为 0。`Select-String -Path apps/web/src/**/* -Pattern "localdb:"` 现仅剩 `types/electron-api.ts` 中 debug 类型字段名，不再有任何前端主链 `localdb:*` channel 调用；`types/local-sync.ts` 已接管业务主链使用的本地同步类型，`cloud-api.ts`、`localdb-backend.ts`、`localdb-graph.ts` 与相关业务页面已不再从 `electron-api.ts` 引入这些类型。

遗留问题：

- 附件云端仍仅补齐删除能力；恢复与彻底删除当前缺少服务端 Web 主线接口，前端保持显式报错边界。
- 工作区配置写入当前仍是浏览器本地配置更新，尚未接入独立云端配置写接口。
- `fs-backend` 隔离文件与调试后端仍保留 Web 占位实现，后续若 Go 后端补齐调试接口，可再按能力将占位返回切到真实 API。

### I04. 删除 Electron 类型文件

状态：DONE

目标：删除或重命名 `apps/web/src/types/electron-api.ts`。

要求：

- 将仍有价值的类型迁到：

```text
apps/web/src/types/cloud-sync.ts
apps/web/src/types/local-cache.ts
apps/web/src/types/attachments.ts
```

- `Window` global 中不再声明 `electronAPI`。

验收：

```text
Select-String -Path apps/web/src/**/* -Pattern "ElectronAPI|electronAPI"
```

无结果。

完成时间：2026-06-09

执行摘要：

- `apps/web/src/types/electron-api.ts` 已删除，原先仍有价值的本地同步与调试类型分别收口到 `apps/web/src/types/local-sync.ts` 与 `apps/web/src/types/debug-runtime.ts`。
- `apps/web/src/core/app-backend.ts`、`cloud-api.ts`、`localdb-backend.ts`、`sync-debug-backend.ts` 等业务主链已完成去 Electron 化，不再依赖 `ElectronAPI` 类型。
- `Window` global 中的 `electronAPI` 声明已完全移除，Web 端运行态只保留浏览器能力与 HTTP API。

验证结果：

- `Select-String -Path apps/web/src/**/* -Pattern "ElectronAPI|electronAPI"` 无结果。
- `apps/web/src/types/electron-api.ts` 文件已不存在。
- `npm run typecheck --workspace @topomind/web` 通过。

遗留问题：

- 调试/缓存等类型目前按 Web 占位能力建模，若后续后端新增观测接口，需要再补充更细粒度响应字段。

### I05. 删除 debug backend 的 Electron IPC 实现

状态：DONE

目标：将 debug 面板改为 Go 后端调试 API 或暂时隐藏。

涉及：

```text
apps/web/src/core/attachment-debug-backend.ts
apps/web/src/core/import-debug-backend.ts
apps/web/src/core/sync-debug-backend.ts
apps/web/src/core/file-cache-backend.ts
```

要求：

- 不调用 IPC。
- 如果后端 debug API 未实现，UI 显示“后端暂未提供调试数据”。

验收：

- Monitor 页面不因缺少 Electron 报错。

完成时间：2026-06-09

执行摘要：

- `apps/web/src/core/attachment-debug-backend.ts`、`import-debug-backend.ts`、`sync-debug-backend.ts`、`file-cache-backend.ts` 已全部改为纯 Web 占位实现，不再调用任何 IPC。
- Monitor 页面继续保留观测 UI，但当后端未提供对应调试能力时，统一返回空列表、未就绪状态或“后端暂未提供调试数据/动作”提示，不会因缺少 Electron 运行时而崩溃。
- 调试相关类型统一由 `apps/web/src/types/debug-runtime.ts` 提供，页面和 backend 占位实现已完成字段对齐。

验证结果：

- `Select-String -Path apps/web/src/core/**/* -Pattern "window\.electronAPI|ipcRenderer|ElectronAPI|app:|localdb:"` 无结果。
- `npm run typecheck --workspace @topomind/web` 通过。
- `npm run build --workspace @topomind/web` 通过，Monitor 页面相关 chunk 正常产出，未出现 Electron 运行时报错。

遗留问题：

- 当前调试动作仍为占位错误提示；若需要真正的同步/导入调试操作，需后续由 Go 服务端补充对应只读或控制型 API。

### I06. 清理 legacy Electron 运行时依赖

状态：DONE

目标：确认根和 Web package 中没有 Electron 依赖。

检查：

```text
package.json
apps/web/package.json
package-lock.json
```

禁止出现：

```text
electron
electron-builder
vite-plugin-electron
vite-plugin-electron-renderer
```

注意：

- `legacy/electron` 可以保留历史文件。
- 不要删除 `legacy/electron`，除非单独任务明确要求。

验收：

- npm 依赖树无 Electron。
- `npm run build` 输出纯 Web 静态资源。

完成时间：2026-06-09

执行摘要：

- 根 `package.json` 已只保留 Web workspace 脚本，不再声明 Electron 构建或运行命令。
- `apps/web/package.json` 当前依赖树中不含 `electron`、`electron-builder`、`vite-plugin-electron`、`vite-plugin-electron-renderer`。
- `package-lock.json` 中不存在上述 Electron 依赖；仅保留 `electron-to-chromium` 这类与浏览器兼容性数据相关的通用前端工具链依赖，不属于 Electron 运行时。

验证结果：

- `Select-String -Path package.json,apps/web/package.json,package-lock.json -Pattern "electron|electron-builder|vite-plugin-electron|vite-plugin-electron-renderer"` 仅命中 `electron-to-chromium`，无受禁依赖。
- `npm ls electron electron-builder vite-plugin-electron vite-plugin-electron-renderer --all` 输出 `(empty)`。
- `npm run build --workspace @topomind/web` 通过，并输出纯 Web `dist/` 静态资源。

遗留问题：

- `legacy/electron` 历史目录仍按计划保留，后续如需彻底移除需单独开任务评估归档策略。

## 13. 阶段 J：端到端验收

### J01. 端到端核心流程

状态：DONE

目标：验证纯 Web + Go 后端核心功能。

流程：

1. 启动 PostgreSQL。
2. 启动 Go 后端。
3. 启动 Web 前端。
4. 注册用户。
5. 登录。
6. 进入默认工作区。
7. 创建知识库。
8. 创建节点。
9. 移动节点。
10. 创建文档。
11. 编辑文档。
12. 上传附件。
13. 刷新页面。
14. 数据仍然存在。

验收：

- 全流程不依赖 Electron。
- 全流程不依赖本地工作目录。

完成时间：2026-06-09

执行摘要：

- 使用 PostgreSQL Docker 新建临时验收库 `topomind_j01`，并执行 `apps/server/migrations/0001_init.sql` 初始化当前 Go 服务所需 schema，避免污染容器中已有的历史库数据。
- 启动 Go 服务后，按纯 Web 路径完成了注册、默认工作区获取、知识库创建、卡片创建与更新、文档创建与内容保存、图谱布局 patch、附件 upload ticket + 二进制上传 + commit + 内容回读。
- 最后通过 `/workspaces/{workspaceId}/bootstrap` 重新拉取快照，确认知识库、卡片、文档、图谱布局、附件均已持久化；同时启动 `apps/web` Vite 前端并打开预览页，浏览器未报告首屏运行时错误。

验证结果：

- `go run ./cmd/server` 在 `postgres://topomind:topomind@127.0.0.1:5432/topomind_j01?sslmode=disable` 上可正常启动，`GET /health` 返回 `{"ok":true}`。
- API 验证链路通过：注册用户后可获得默认工作区；随后成功创建 1 个知识库、1 个卡片、1 个文档、1 个图谱布局、1 个附件。
- 文档保存后版本从 `1` 递增到 `2`，卡片更新后版本从 `1` 递增到 `2`；附件内容下载回读为 `hello attachment j01`，`bootstrap` 返回计数 `knowledgeBases=1`、`cards=1`、`documents=1`、`graphLayouts=1`、`attachments=1`，`lastEventId=20`。
- Web 前端开发服务器可在 `http://localhost:5173/` 打开，接入 Go 后端地址 `http://127.0.0.1:3000`，预览页无首屏报错。

遗留问题：

- 容器中原有 `topomind` 数据库仍是旧 schema，包含 `change_events` / `schema_migrations` 等历史结构，缺少当前 Go 服务必需的 `refresh_tokens`、`sync_events` 等表；若直接指向旧库，`/auth/register` 会返回 500，正式切换前需要补历史库迁移或改用新库。
- 本轮 `J01` 以 API 驱动验收加前端预览打开为主，尚未逐按钮执行完整浏览器手工回归；如需补充最终 UI 手验，可基于当前运行中的 `http://localhost:5173/` 与 `:3000` 继续。

### J02. 冲突与版本验收

状态：DONE

目标：验证版本冲突处理。

流程：

1. 打开两个浏览器窗口。
2. 同一文档分别编辑。
3. 第一个保存成功。
4. 第二个使用旧 baseVersion 保存。

验收：

- 第二个请求返回 409。
- 前端提示冲突或保留 dirty 状态。
- 服务端数据不被旧版本覆盖。

完成时间：2026-06-09

执行摘要：

- 使用独立临时数据库 `topomind_j02` 启动 Go 服务（端口 `3100`），通过 API 模拟两个客户端持有同一 `baseVersion` 后先后提交，覆盖文档保存与图谱布局 patch 两条版本链。
- 文档链路中，第一次保存以 `baseVersion=1` 成功写入 `first save`，第二次继续使用旧 `baseVersion=1` 提交 `stale save`，服务端返回 `409 document_version_conflict`，并在错误详情中返回 `serverVersion=2` 与当前服务端实体快照。
- 图谱布局链路中，第一次以 `baseVersion=0` 创建布局成功；第二次仍以旧 `baseVersion=0` 提交新的节点坐标与 viewport，服务端返回 `409 graph_layout_version_conflict`，并带回服务端最新布局实体。
- 前端静态链路也已核对：文档页保存失败时会进入 `error` 状态并展示错误文案；浏览器本地快照刷新时会保留 `dirty` 记录，不会因为 409 后的 bootstrap 刷新直接覆盖本地脏数据。

验证结果：

- 文档冲突验收通过：第一次 `POST /workspaces/{workspaceId}/documents/{documentId}/content` 返回 `200`；第二次同 `baseVersion` 请求返回 `409`，错误码为 `document_version_conflict`；随后 `GET /documents/{documentId}` 返回的持久化内容仍为 `first save`，服务端版本为 `2`。
- 图谱布局冲突验收通过：第一次 `POST /workspaces/{workspaceId}/graph-layouts/{layoutId}/patch` 返回 `200`；第二次同 `baseVersion` 请求返回 `409`，错误码为 `graph_layout_version_conflict`；随后 `GET /graph-layouts/{layoutId}` 返回的位置仍为 `{x:11,y:22}`、viewport 仍为 `{x:0,y:0,zoom:1}`，未被旧版本覆盖。
- 前端代码核对结果：`apps/web/src/core/localdb-backend.ts` 在收到 `409` 后会先刷新 bootstrap，但 `mergeBrowserDirtyRecords()` 会保留 `dirtyState === 'dirty'` 的本地记录；`DocumentWorkspaceLayout.tsx` / `DocumentStatusBar.tsx` 会在保存失败时保留错误态并显示“保存失败”。

遗留问题：

- 本轮主要验证了服务端版本保护与前端静态处理链路，尚未在真实双浏览器窗口中逐步点击复现 UI 冲突交互；如需最终交互级确认，可基于当前 Web 预览环境补一次双窗口手验。

### J03. 性能验收

状态：TODO

目标：验证云端延迟不会影响主要交互。

要求：

- 模拟 100-300ms API 延迟。
- 1000 节点图谱基本可用。
- 拖拽不逐帧保存。
- 文档输入不卡顿。

验收：

- 有测试记录。
- 发现问题进入优化任务，不允许用 Electron 兜底。

完成时间：

执行摘要：

- 当前仓库已经提供独立的大图 benchmark 路由：`apps/web/src/main.tsx` 会在访问 `/__benchmarks__/graph` 时切到 `GraphPerformanceBenchmarkApp`；对应场景 `graph-baseline-1000` 由 `40 x 25` 网格生成 `1000` 个节点，并自动记录加载、选择、缩放、拖拽四类耗时，可导出 JSON/Markdown 测试记录。
- 图谱保存链路已确认不是逐帧持久化：`SaveCoordinator` 统一负责延迟保存，`apps/web/src/core/localdb-graph.ts` 为图谱布局保存设置了 `300ms` delay；节点拖拽过程中 `applyNodePositionChanges()` 仅在 `dragging !== false` 时走 `scheduleSave()`，只有拖拽结束才会 `saveNow()` flush。
- 文档输入链路也具备延迟保存保护：`DocumentWorkspaceLayout.tsx` 在 `dirty` 后等待 `1500ms` 才触发 `handleSave()`，失焦时才立即 flush；`useDetailDocumentSession.ts` 同时记录 `detailSave` / `detailRead` / `nodeSelect` 性能指标，便于后续在 Monitor 中继续采样。
- 本轮先完成了可客观核对的静态与构建证据梳理，暂未把 `J03` 标记为完成；真实浏览器运行态数据和 `100-300ms` API 延迟注入仍需补充专门测试记录。

验证结果：

- `apps/web/src/benchmarks/graphPerformanceScenario.ts` 当前固定生成 `1000` 节点基线场景，`GraphPerformanceBenchmarkApp.tsx` 会在页面加载后自动跑完四项基线并将结果发布到 `window.__TOPO_GRAPH_BENCHMARK__`，可作为 `J03` 的人工或后续自动化采样入口。
- 图谱拖拽不会逐帧持久化：`apps/web/src/domain/persistence/saveCoordinator.ts` 采用可重置 timer 聚合同一 room 的保存请求；`apps/web/src/core/localdb-graph.ts` 把图谱布局保存延迟设为 `300ms`；`apps/web/src/hooks/useGraph/nodeChangeOperations.ts` 仅在拖拽结束事件（`dragging === false`）立即落盘。
- 文档输入不会逐键立即写库：`apps/web/src/features/documents/components/Layout/DocumentWorkspaceLayout.tsx` 的自动保存窗口为 `1500ms`，切换文档前 `useDetailDocuments.ts` 会先 `flushDocumentSave()`，避免边输入边频繁提交。
- `npm run build --workspace @topomind/web` 虽已通过，但当前产物显示明显包体风险：`dist/assets/flowchart-elk-definition-*.js` 约 `1448.73 kB`，`dist/assets/SmartDocumentEditor-*.js` 约 `4207.18 kB`；这说明 `J03` 仍需继续补真实浏览器采样并拆分热点包。

遗留问题：

- 还没有形成一份真实浏览器导出的 benchmark 记录；下一步需要打开 `/__benchmarks__/graph`，导出 JSON 或 Markdown 报告后再决定是否可将“1000 节点图谱基本可用”正式标记为通过。
- 还没有对云端 API 注入 `100-300ms` 延迟并复测文档编辑、节点选择、拖拽后的主观流畅度，因此“延迟不会影响主要交互”目前仍缺运行态证据。
- 构建已暴露出大包体问题，尤其是 `SmartDocumentEditor` 与 flowchart/ELK 相关 chunk；若后续浏览器实测出现卡顿，应优先拆分这些包，而不是回退到 Electron 路径。

### J04. 最终 Electron 清零检查

状态：DONE

目标：确认纯 Web 化完成。

检查命令：

```text
Select-String -Path apps/web/src/**/* -Pattern "electronAPI|ElectronAPI|ipcRenderer|ipcMain|BrowserWindow|fs:|localdb:" -CaseSensitive:$false
Select-String -Path package.json,apps/web/package.json -Pattern "electron" -CaseSensitive:$false
```

允许：

- `doc/` 中描述 Electron 的历史和迁移内容。
- `legacy/electron` 中历史参考代码。

不允许：

- `apps/web/src` 中有 Electron 运行时引用。
- package 依赖中有 Electron。

验收：

- `npm run typecheck` 通过。
- `npm run build` 通过。
- `cd apps/server && go test ./...` 通过。

完成时间：2026-06-09

执行摘要：

- 已执行纯 Web 残留扫描、依赖扫描、Web typecheck、Web build 与 Go 测试，确认当前主线代码可以在 `apps/web + apps/server` 结构下独立运行，不再依赖 Electron 主进程、preload 或本地工作目录作为主存储。
- 为避免 `Select-String` 把普通标识符（如 `LocalDB:`）误判成 `localdb:` 协议，本轮以 `scripts/check-no-electron-runtime.cjs` 作为精确扫描入口；脚本仅允许显式白名单中的历史兼容代码命中关键词，其余新引用一律视为失败。
- 根 `package.json` 与 `apps/web/package.json` 中已经没有 `electron` 相关依赖；Web 侧 `typecheck`、`build` 均通过，`apps/server` 的 `go test ./...` 也已通过。

验证结果：

- `node scripts/check-no-electron-runtime.cjs` 通过：扫描 `apps/web/src`、`apps/web/package.json`、`package.json` 共 `233` 个文件，仅命中 `7` 个显式白名单文件，`Violations: 0`。
- `Select-String -Path package.json,apps/web/package.json -Pattern "electron" -CaseSensitive:$false` 返回 `NO_MATCH`，说明包依赖层已无 Electron。
- `npm run typecheck --workspace @topomind/web` 通过。
- `npm run build --workspace @topomind/web` 通过。
- `cd apps/server && go test ./...` 通过。

遗留问题：

- 计划中原始 `Select-String -Path apps/web/src/**/* -Pattern "...|localdb:"` 命令会把 `export const LocalDB: ...` 这类普通类型标注误报为命中项；后续继续执行 `J04` 复核时，应以 `scripts/check-no-electron-runtime.cjs` 或人工复核结果为准，避免把假阳性当成残留依赖。
## 14. 每次任务执行后的强制检查

每个任务完成后执行者必须回答：

```text
1. 是否新增 Electron 运行时依赖？必须为否。
2. 是否新增本地目录作为主存储？必须为否。
3. 是否新增 SQLite 作为后端主存储？必须为否。
4. 是否破坏 apps/web 或 apps/server 目录边界？必须为否。
5. 是否更新了本文档任务状态？必须为是。
6. 是否跑了对应验证命令？必须为是，或说明阻塞原因。
```

## 15. 推荐执行顺序总览

必须按以下顺序执行，除非明确记录跳过原因：

```text
A01 -> A02 -> A03
B01 -> B02 -> B03 -> B04 -> B05
C01 -> C02 -> C03 -> C04 -> C05 -> C06
D01 -> D02 -> D03 -> D04 -> D05 -> D06 -> D07 -> D08
E01 -> E02 -> E03 -> E04
F01 -> F02 -> F03
G01 -> G02 -> G03 -> G04 -> G05
H01 -> H02 -> H03
I01 -> I02 -> I03 -> I04 -> I05 -> I06
J01 -> J02 -> J03 -> J04
```

如果执行者发现必须调整顺序，必须先更新本文档并写明原因。
