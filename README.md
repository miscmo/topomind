# TopoMind

纯 Web 前端 + Go 后端的 TopoMind 项目。

本文档说明如何在本地启动前后端开发环境。

## 运行环境

- Node.js 20+
- npm 10+
- Go 1.25.7+
- PostgreSQL 15+ 或兼容版本

## 目录说明

- `apps/web`: Vite + React 前端
- `apps/server`: Go 后端
- `.env.example`: 从仓库根目录启动前端时使用的环境变量示例
- `apps/server/.env.example`: 后端环境变量示例

## 1. 安装依赖

在仓库根目录安装前端依赖：

```powershell
npm install
```

在后端目录下载 Go 依赖：

```powershell
cd apps/server
go mod download
```

## 2. 配置前端环境变量

如果你准备从仓库根目录启动前端，先在根目录创建 `.env`：

```powershell
cd D:\Code\topomind_cc
Copy-Item .env.example .env
```

默认内容如下：

```env
VITE_TOPOMIND_SERVER_URL=http://127.0.0.1:3000
```

如果你以后改成在 `apps/web` 目录单独运行前端，也可以同步创建 `apps/web/.env`：

```powershell
Copy-Item apps\web\.env.example apps\web\.env
```

## 3. 配置 PostgreSQL

先确保本机 PostgreSQL 已启动。

`apps/server/.env.example` 中默认使用下面这条连接串：

```env
DATABASE_URL=postgres://topomind:topomind@127.0.0.1:5432/topomind?sslmode=disable
```

如果你本地还没有对应的用户和数据库，可以执行一份最小初始化 SQL：

```sql
CREATE USER topomind WITH PASSWORD 'topomind';
CREATE DATABASE topomind OWNER topomind;
```

## 4. 配置后端环境变量

后端当前直接读取进程环境变量，不会自动加载 `.env` 文件。

建议先复制一份示例文件：

```powershell
cd apps/server
Copy-Item .env.example .env
```

默认示例：

```env
APP_ENV=development
HTTP_ADDR=:3000
DATABASE_URL=postgres://topomind:topomind@127.0.0.1:5432/topomind?sslmode=disable
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
ATTACHMENT_TICKET_SECRET=change-me-attachment-ticket
STORAGE_PROVIDER=local
LOCAL_STORAGE_ROOT=.local/storage
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

在 PowerShell 中可用下面这段命令把 `apps/server/.env` 导入当前终端会话：

```powershell
cd D:\Code\topomind_cc\apps\server
Get-Content .env.dev | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $name, $value = $_ -split '=', 2
  Set-Item -Path "Env:$name" -Value $value
}
```

如果你使用 IDE 的 Run/Debug 配置，也可以直接把这些变量配置到启动项里。

## 5. 执行数据库迁移

在 `apps/server` 目录执行：

```powershell
$env:GOPROXY="https://goproxy.cn,direct"
go run github.com/pressly/goose/v3/cmd/goose -dir migrations postgres "$env:DATABASE_URL" up
```

首次启动后端前必须先执行这一步。否则 `users`、`refresh_tokens` 等鉴权相关表不会创建，注册和登录接口会返回 `500 Internal Server Error`。

可选命令：

```powershell
go run github.com/pressly/goose/v3/cmd/goose -dir migrations postgres "$env:DATABASE_URL" status
go run github.com/pressly/goose/v3/cmd/goose -dir migrations postgres "$env:DATABASE_URL" down
```

## 6. 启动后端

在已经导入环境变量的终端中执行：

```powershell
cd D:\Code\topomind_cc\apps\server
go run ./cmd/server
```

默认监听地址：

```text
http://127.0.0.1:3000
```

健康检查：

```text
http://127.0.0.1:3000/health
```

如果启动成功，访问健康检查会返回：

```json
{"ok":true}
```

## 7. 启动前端

新开一个终端，在仓库根目录执行：

```powershell
cd D:\Code\topomind_cc
npm run dev
```

前端默认地址：

```text
http://localhost:5173
```

## 8. 本地开发启动顺序

推荐顺序如下：

1. 启动 PostgreSQL
2. 导入 `apps/server/.env`
3. 执行后端数据库迁移
4. 启动 Go 后端
5. 启动前端 `npm run dev`
6. 打开 `http://localhost:5173`

## 9. 常用检查命令

前端类型检查：

```powershell
cd D:\Code\topomind_cc
npm run typecheck --workspace @topomind/web
```

后端测试：

```powershell
cd D:\Code\topomind_cc\apps\server
go test ./...
```

## 10. 常见问题

### 前端请求不到后端

检查以下几项：

- 后端是否真的启动在 `http://127.0.0.1:3000`
- 根目录 `.env` 里的 `VITE_TOPOMIND_SERVER_URL` 是否正确
- `apps/server/.env` 中的 `CORS_ALLOWED_ORIGINS` 是否包含 `http://localhost:5173`

### 后端启动时报缺少环境变量

说明当前终端还没有导入 `apps/server/.env`，重新执行“配置后端环境变量”里的 PowerShell 导入命令即可。

### 迁移执行失败

优先检查：

- `DATABASE_URL` 是否正确
- PostgreSQL 用户、密码、数据库是否存在
- 当前终端是否已经导入了后端环境变量

### 注册或登录返回 500

如果前端调用 `/auth/register` 或 `/auth/login` 返回 `500 Internal Server Error`，先检查是否已经执行过“执行数据库迁移”中的 `goose up`。未执行迁移时，后端所需的数据表还不存在，鉴权接口会直接报错。
