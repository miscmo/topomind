# TopoMind Electron 到 Web + Go 后端迁移设计方案

## 1. 背景与目标

当前 TopoMind 是基于 Electron 的桌面应用。渲染层使用 React + Vite，主进程承担了大量后端职责，包括本地文件系统读写、本地 SQLite 缓存、附件缓存与上传队列、导入任务、日志、窗口控制和系统文件操作。

项目中已经出现云端化雏形：

- `src/core/cloud-api.ts` 已经有认证、工作区、bootstrap、sync pull/push、附件上传 ticket 等 HTTP API 形态。
- `src/core/localdb-backend.ts` 通过 Electron IPC 调用本地 SQLite 镜像。
- `src/application/cloud/useCloudSyncEngine.ts` 已经实现本地 outbox 推送、云端事件拉取、冲突记录、周期同步和 wake 同步。
- `electron/services/localdb-service.js` 已经沉淀了本地镜像表、同步 cursor、outbox、conflict、附件上传 job、导入 job 等逻辑。
- `src/core/storage/service.ts` 已经通过 `StorageBackend` 隔离业务存储接口，利于后续替换底层实现。

迁移目标不是简单移除 Electron，而是将 Electron 主进程中的业务后端能力迁移到 Go 服务端，并最终删除 Electron 运行时依赖，让 TopoMind 成为纯 Web 应用。

目标形态：

```text
React/Vite Web 前端
        |
        | HTTP / SSE / WebSocket
        v
Go API 后端
        |
        +-- PostgreSQL
        +-- 对象存储 / 本地文件存储
        +-- 后台任务队列
```

最终目标：

```text
纯 Web 前端 + Go 后端 + PostgreSQL
Electron 仅作为待迁移的历史实现边界，不作为兜底方案
```

## 2. 可行性结论

迁移是可行的，但不能把 Electron IPC 原样搬成 HTTP。当前 Electron 主进程不仅是桌面壳，还承担了本地后端职责。迁移时应将 Go 后端设计为统一业务数据源，而不是继续依赖本地目录作为主存储。

适合迁移到 Web 的能力：

- 知识库、卡片、图谱、文档编辑。
- 云端账号、工作区、多设备访问。
- 附件上传、预览、下载。
- 后台导入任务。
- 同步事件、冲突记录、操作审计。
- 监控面板和同步调试面板。

不适合在纯 Web 中原样保留的能力：

- 任意读取用户本机目录。
- 打开本地文件夹或在系统文件管理器中定位文件。
- 以本地工作目录作为主存储。
- Electron 主进程中的长期本地后台任务。
- 不经用户选择的本地文件批处理。

因此产品定位应明确转向“云端知识工作台”。本地目录型桌面软件能力不再作为目标能力保留，必须通过 Web 可行的方式替代，例如上传 zip 导入、浏览器文件选择、后端任务和 Web 下载/预览。

## 3. 当前架构边界

### 3.1 Electron 主进程职责

当前 `electron/main.js` 注册了大量 IPC channel，主要分为：

- `fs:*`：知识库目录、卡片目录、图谱元数据、文档、附件、配置、学习统计、本地工作目录。
- `localdb:*`：本地 SQLite 镜像、bootstrap、sync pull、sync push result、本地实体 CRUD、outbox、conflict。
- `filecache:*`：云端附件缓存、本地 URL、打开附件。
- `attachment:*`：附件上传任务健康状态。
- `import:*`：导入任务。
- `sync-debug:*`：同步调试快照、outbox、conflict、附件 job、导入 job。
- `app:*`：窗口控制、打开路径、打开外部链接、选择目录、工作目录切换。
- `log:*`：日志写入、查询、订阅。

### 3.2 前端适配层

当前前端有较好的可迁移边界：

- `src/core/fs-backend.ts`：封装 Electron IPC 文件系统操作。
- `src/core/localdb-backend.ts`：封装本地 SQLite IPC。
- `src/core/cloud-api.ts`：已是 HTTP API client。
- `src/core/app-backend.ts`：封装打开本地路径等桌面能力。
- `src/core/storage/types.ts`：定义 `StorageBackend`。
- `src/core/storage/service.ts`：业务层通过统一 store 使用存储能力。

迁移优先级应围绕这些适配层展开，尽量避免在业务组件中直接处理迁移细节。

## 4. 目标架构

### 4.1 前端架构

前端继续使用当前 React + Vite 技术栈。迁移重点是替换底层 backend adapter。

建议新增：

```text
src/core/http-client.ts
src/core/web-app-backend.ts
src/core/remote-storage-backend.ts
src/core/remote-localdb-backend.ts
src/core/browser-platform.ts
```

建议保留：

```text
src/core/storage/types.ts
src/core/storage/service.ts
src/core/cloud-api.ts
src/application/cloud/*
```

后续演进方式：

- 第一阶段可以继续沿用 `cloudApi` 的接口语义。
- 第二阶段将 `localdb-backend.ts` 的调用改为纯 HTTP 或前端 IndexedDB。
- 第三阶段逐步废弃 `fs-backend.ts` 中与本地目录强绑定的接口。

### 4.2 Go 后端架构

建议目录结构：

```text
server-go/
  cmd/server/main.go
  internal/auth
  internal/user
  internal/workspace
  internal/kb
  internal/card
  internal/document
  internal/graph
  internal/attachment
  internal/importer
  internal/sync
  internal/job
  internal/storage
  internal/db
  internal/http
  internal/config
```

推荐技术选型：

- HTTP 框架：`chi`。
- 数据库：PostgreSQL 作为主要业务存储。
- SQL 访问：`sqlc` + migration。
- 认证：JWT access token + refresh token。
- 附件存储：先实现本地磁盘 storage adapter，再扩展 S3/MinIO/OSS。
- 后台任务：初期使用 DB job table + Go worker；复杂后再考虑 Redis/Asynq。
- 实时通知：先使用轮询，后续引入 SSE 或 WebSocket。

## 5. 数据模型设计

Go 后端应成为唯一权威数据源。不要继续把本地工作目录作为主数据源。

PostgreSQL 是后端主要业务存储。SQLite 只保留为当前 Electron 本地缓存的现状描述，不作为 Go 后端的目标主存储，也不作为纯 Web 化后的兜底存储方案。后续如果需要本地开发替代环境，可以使用 PostgreSQL 容器或开发库，不应影响主线 schema、migration 和查询设计。

核心表：

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

核心实体沿用当前云同步类型：

```text
knowledge_base
card
document
graph_layout
attachment
```

核心操作沿用：

```text
create
update
delete
restore
purge
```

实体建议字段：

```text
id
workspace_id
version
created_at
updated_at
deleted_at
```

`documents` 建议存：

```text
id
workspace_id
card_id
type
title
file_name
parent_document_id
sort_order
schema_version
content_json
meta_json
version
created_at
updated_at
deleted_at
```

`graph_layouts` 建议存：

```text
id
workspace_id
kb_id
room_card_id
layout_json
viewport_json
version
updated_by
created_at
updated_at
```

`attachments` 建议存：

```text
id
workspace_id
knowledge_base_id
card_id
document_id
file_name
mime_type
size_bytes
storage_provider
storage_bucket
storage_key
sha256
meta_json
version
created_at
updated_at
deleted_at
```

## 6. API 设计

### 6.1 认证

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
```

### 6.2 工作区

```text
GET  /workspaces
POST /workspaces
GET  /workspaces/{workspaceId}/bootstrap
GET  /workspaces/{workspaceId}/config
PUT  /workspaces/{workspaceId}/config
```

### 6.3 知识库和卡片

```text
GET    /workspaces/{workspaceId}/knowledge-bases
POST   /workspaces/{workspaceId}/knowledge-bases
PATCH  /workspaces/{workspaceId}/knowledge-bases/{kbId}
DELETE /workspaces/{workspaceId}/knowledge-bases/{kbId}
POST   /workspaces/{workspaceId}/knowledge-bases/{kbId}/restore
DELETE /workspaces/{workspaceId}/knowledge-bases/{kbId}/purge

GET    /workspaces/{workspaceId}/cards?kbId=...&parentId=...
POST   /workspaces/{workspaceId}/cards
GET    /workspaces/{workspaceId}/cards/{cardId}
PATCH  /workspaces/{workspaceId}/cards/{cardId}
DELETE /workspaces/{workspaceId}/cards/{cardId}
POST   /workspaces/{workspaceId}/cards/{cardId}/restore
DELETE /workspaces/{workspaceId}/cards/{cardId}/purge
```

### 6.4 文档

```text
GET   /workspaces/{workspaceId}/cards/{cardId}/documents
POST  /workspaces/{workspaceId}/cards/{cardId}/documents
GET   /workspaces/{workspaceId}/documents/{documentId}
PATCH /workspaces/{workspaceId}/documents/{documentId}
POST  /workspaces/{workspaceId}/documents/{documentId}/content
POST  /workspaces/{workspaceId}/documents/{documentId}/move
DELETE /workspaces/{workspaceId}/documents/{documentId}
```

文档内容保存请求应包含版本：

```json
{
  "baseVersion": 12,
  "schemaVersion": 1,
  "contentJson": {}
}
```

服务端成功后返回：

```json
{
  "documentId": "doc_...",
  "version": 13,
  "updatedAt": "2026-06-08T00:00:00Z"
}
```

### 6.5 图谱布局

```text
GET   /workspaces/{workspaceId}/graph-layouts/{layoutId}
PATCH /workspaces/{workspaceId}/graph-layouts/{layoutId}
POST  /workspaces/{workspaceId}/graph-layouts/{layoutId}/patch
```

节点移动应使用 patch，而不是每次拖动都提交完整图：

```json
{
  "baseVersion": 42,
  "nodePatches": {
    "card_a": { "x": 120, "y": 300 },
    "card_b": { "x": 500, "y": 180 }
  },
  "viewport": {
    "zoom": 0.8,
    "pan": { "x": 10, "y": 20 }
  }
}
```

### 6.6 附件

```text
POST /workspaces/{workspaceId}/attachments/upload-ticket
POST /workspaces/{workspaceId}/attachments/commit
GET  /workspaces/{workspaceId}/attachments/{attachmentId}
GET  /workspaces/{workspaceId}/attachments/{attachmentId}/content
DELETE /workspaces/{workspaceId}/attachments/{attachmentId}
```

Web 端不再传本地文件路径，应使用 `File` 对象上传。

### 6.7 导入

纯 Web 不能读取用户本机目录。导入能力改为：

```text
POST /workspaces/{workspaceId}/imports
GET  /workspaces/{workspaceId}/imports/{importJobId}
GET  /workspaces/{workspaceId}/imports/{importJobId}/report
```

支持形式：

- 上传 zip 导入旧知识库。
- 上传多个文件导入。
- 私有部署场景允许管理员配置服务器本地导入目录。

### 6.8 同步

沿用当前同步接口语义：

```text
GET  /workspaces/{workspaceId}/sync/pull?afterEventId=...&limit=...
POST /workspaces/{workspaceId}/sync/push
```

`sync/push` 请求：

```json
{
  "entityType": "document",
  "operation": "update",
  "entityId": "doc_...",
  "baseVersion": 12,
  "idempotencyKey": "document:doc_...:uuid",
  "payload": {},
  "client": {
    "deviceId": "web",
    "requestId": "uuid",
    "sentAt": "2026-06-08T00:00:00Z"
  }
}
```

冲突返回 `409`：

```json
{
  "ok": false,
  "error": {
    "code": "version_conflict",
    "message": "版本冲突",
    "details": {
      "serverVersion": 14,
      "serverEventId": 123,
      "serverEntity": {}
    }
  }
}
```

## 7. Web 流畅性设计

迁移到云端后，交互流畅性的核心原则是：

```text
用户操作立即更新本地 UI，网络请求只负责异步确认和同步。
```

禁止设计：

```text
拖动节点 -> 请求后端 -> 等待返回 -> 更新 UI
```

推荐设计：

```text
拖动节点
 -> 前端内存状态立即更新
 -> dirty map 记录变更
 -> 防抖/合并
 -> 后台异步提交
 -> 服务端返回版本
 -> 成功清理 dirty，失败保留并重试
```

### 7.1 节点移动

节点拖动期间：

- 只更新前端图谱内存状态。
- 不请求后端。
- 不写全局大对象。
- 不触发全图重渲染。

保存时机：

- `onDragEnd`。
- 停止操作 300-800ms 后防抖保存。
- 切换页面或关闭页面前 flush。
- 每 5-10 秒批量保存一次未提交 dirty layout。

保存内容：

- 优先提交 `layoutPatch`。
- 多个节点移动合并为一次请求。
- 同一节点多次移动只保留最后位置。

### 7.2 文档编辑

文档编辑器必须本地即时更新。保存策略：

- 编辑器输入只更新本地 editor state。
- 1-2 秒防抖自动保存。
- 失焦、切换文档、关闭页面前 flush。
- 失败后显示未保存状态，继续保留本地草稿。

单用户或弱协作阶段使用：

```text
baseVersion + serverVersion
```

多人实时协作阶段再考虑：

- Yjs + WebSocket。
- Automerge。
- OT/CRDT 服务。

不要在第一阶段直接引入 CRDT，除非产品明确要求多人同时编辑同一文档。

### 7.3 大图性能

节点增多后的主要瓶颈通常不是网络，而是前端渲染和状态更新。

规避策略：

- 图谱按视口裁剪，只渲染可见节点和附近连线。
- 节点详情、文档内容按需加载。
- 图谱布局数据与文档内容分接口加载。
- 拖动时只更新被拖节点。
- 避免每次位置变化写入全局 Zustand 大对象。
- 重布局、路径计算、搜索索引放入 Web Worker。
- 大量节点操作使用批处理。
- 尽量避免 React 组件树在每一帧大面积重渲染。

### 7.4 前端本地队列

建议设计前端 mutation queue：

```text
UI State
  -> Dirty Map
  -> Mutation Queue
  -> Batch Sync Worker
  -> Go API
```

示例流程：

```text
moveNode(nodeId, position)
  -> updateCanvasImmediately(nodeId, position)
  -> markLayoutDirty(nodeId, position)
  -> scheduleLayoutSave()
```

## 8. 同步与冲突策略

第一阶段建议在线优先，不做完整离线优先。

推荐策略：

- 前端本地保留短期 dirty 状态。
- Go 后端维护权威版本。
- 写请求带 `baseVersion`。
- 服务端版本不匹配返回 `409`。
- 前端记录冲突并提示用户处理。

当前 `useCloudSyncEngine.ts` 的 outbox/pull/push 思路可以保留，但在纯 Web 下需要重新评估本地存储：

可选方案：

1. 在线优先：不保留复杂 localdb，只保留草稿和 dirty queue。
2. 轻量离线：IndexedDB 保存 snapshot、dirty queue、草稿。
3. 完整离线优先：IndexedDB 实现本地镜像、outbox、conflict，接近当前 Electron localdb。

建议先选择方案 1 或 2。完整离线优先复杂度高，应在 Web 核心功能稳定后再做。

## 9. Electron 能力替换表

| 当前 Electron 能力 | Web + Go 替换方案 |
|---|---|
| `fs:listKBs` | `GET /workspaces/{id}/knowledge-bases` |
| `fs:createCardDir` | `POST /workspaces/{id}/cards` |
| `fs:readGraphMeta` | `GET /workspaces/{id}/graph-layouts/{layoutId}` |
| `fs:writeGraphMeta` | `PATCH /workspaces/{id}/graph-layouts/{layoutId}` |
| `fs:listTopoDocuments` | `GET /workspaces/{id}/cards/{cardId}/documents` |
| `fs:writeTopoDocument` | `POST /workspaces/{id}/documents/{documentId}/content` |
| `fs:importAttachment` | 浏览器选择文件后上传 |
| `fs:openAttachment` | Web 预览或下载 |
| `fs:showAttachmentInFolder` | 删除或替换为复制链接/下载 |
| `fs:selectDirectory` | 删除；导入改成上传 zip/文件 |
| `localdb:*` | Go 后端 API 或 IndexedDB |
| `import:*` | Go 后台导入 job |
| `attachment:*` | Go 后台附件 job |
| `sync-debug:*` | Go 后端调试 API |
| `log:*` | 后端结构化日志 + 前端监控 API |
| `app:window:*` | 删除；浏览器不处理窗口控制 |

## 10. 迁移阶段

### 阶段 0：契约冻结与清单整理

目标：

- 梳理所有 IPC channel。
- 标注保留、替换、删除。
- 确定 API response 格式。
- 确定核心实体字段和版本规则。

交付物：

- API 契约草案。
- 数据库 schema 草案。
- IPC 到 HTTP 映射表。

### 阶段 1：Go 后端最小闭环

目标：

- 实现认证。
- 实现工作区。
- 实现知识库、卡片、文档、图布局基础 CRUD。
- 实现附件元数据和简单上传。
- 实现 bootstrap。

验收：

- Web 前端可以登录。
- 可以进入工作区。
- 可以创建知识库、节点、文档。
- 可以保存文档内容和图谱布局。

### 阶段 2：前端 adapter 替换

目标：

- 新增 `remote-storage-backend`。
- 将 `StorageBackend` 底层从 Electron fs 改为 HTTP。
- 将 `localdb-backend` 中必要能力改为 HTTP 或 IndexedDB。
- 移除页面对本地工作目录的强依赖。

验收：

- 不启动 Electron，只运行 Vite dev server，也能完成核心知识库、图谱、文档流程。
- 节点移动和文档编辑不因网络延迟阻塞 UI。

### 阶段 3：同步和性能优化

目标：

- 实现 `sync/pull` 和 `sync/push`。
- 支持版本冲突。
- 支持批量 layout patch。
- 支持文档 autosave。
- 支持大图增量加载和局部渲染优化。

验收：

- 1000 节点规模下拖拽、缩放、选择保持可用。
- 后端延迟 100-300ms 时，节点移动和文档输入无明显卡顿。
- 断网短时间恢复后，未保存操作可以继续提交或提示冲突。

### 阶段 4：附件与导入

目标：

- 附件上传 ticket。
- 附件 commit。
- 附件预览和下载。
- zip 导入旧工作区。
- 导入 job 进度查询。

验收：

- 旧本地知识库可导入云端工作区。
- 附件可以上传、预览、下载、删除。
- 导入失败有报告和可追踪日志。

### 阶段 5：删除 Electron 运行时

目标：

- 删除 Electron 主进程、preload、IPC 和打包配置。
- 删除 `window.electronAPI` 类型和运行时依赖。
- 删除窗口控制、本地路径打开、系统文件夹定位等桌面专属 UI。
- 确认纯 Vite Web 构建是唯一前端交付形态。

需要完成：

- 将 `electron/` 目录中的可复用业务逻辑迁移到 Go 后端或前端 Web adapter。
- 移除 `package.json` 中 Electron、electron-builder、vite-plugin-electron 相关依赖和脚本。
- 将 `src/types/electron-api.ts` 替换为 Web API 类型或删除。
- 将 `app:window:*`、`app:openPath`、`app:showItemInFolder` 等能力从 UI 中移除或改成 Web 下载/预览。
- 确保 `npm run build` 只输出 Web 静态资源。

## 11. 风险与规避

### 11.1 本地文件能力缺失

风险：

纯 Web 不能任意访问本地目录。

规避：

- 工作区主存储迁移到后端数据库。
- 导入旧数据通过 zip 上传。
- 附件和文档通过浏览器文件选择、拖拽上传、下载和在线预览完成。
- 不再提供“选择本地工作目录作为主存储”的产品入口。

### 11.2 云端延迟导致交互卡顿

风险：

节点拖动和文档输入如果等待服务端，会明显卡顿。

规避：

- 本地即时更新。
- 防抖保存。
- 批量 patch。
- 后台队列。
- dirty 状态和失败重试。

### 11.3 大图渲染性能

风险：

节点多时 React 重渲染、连线计算、布局计算导致卡顿。

规避：

- 视口裁剪。
- 局部状态更新。
- Web Worker。
- 按需加载。
- 图布局和文档内容分离。

### 11.4 同步复杂度过高

风险：

完整离线优先会引入大量冲突处理和本地镜像复杂度。

规避：

- 第一阶段在线优先。
- 只保留草稿和短期 dirty queue。
- 后续再演进 IndexedDB 本地镜像。

### 11.5 旧数据迁移

风险：

旧文件目录格式、文档 manifest、附件引用和图谱元数据可能不一致。

规避：

- 单独实现 import job。
- 导入过程生成报告。
- 导入失败不影响已有云端工作区。
- 对旧格式做 schema 检测和修复。

## 12. 关键验收标准

功能验收：

- Web 模式下无需 Electron 可以登录、选择工作区、创建知识库、创建节点、编辑文档、移动节点、上传附件。
- 旧工作区可以通过导入任务迁移到云端。
- 图谱布局、文档内容、附件数据均由 Go 后端持久化。
- Electron 主进程不再承担核心业务数据写入。

性能验收：

- 文档输入不等待网络请求。
- 节点拖拽过程中不发送保存请求。
- 图谱保存使用防抖和批量 patch。
- 1000 节点规模下基本操作可用。
- 网络延迟 100-300ms 不影响拖拽、缩放、输入。

可靠性验收：

- 写请求带版本。
- 版本冲突返回 409。
- 自动保存失败时前端保留 dirty 状态。
- 附件上传失败可重试。
- 导入任务失败有报告。

## 13. 推荐实施顺序

建议从低风险、强边界处开始：

1. 在仓库中新增 Go 后端骨架和数据库 migration。
2. 实现认证、工作区、bootstrap。
3. 实现知识库、卡片、文档、图布局 CRUD。
4. 新增前端 HTTP adapter，替换 `StorageBackend`。
5. 先跑通 Web 核心流程。
6. 做节点移动批量 patch 和文档 autosave。
7. 接入附件上传和下载。
8. 实现旧工作区 zip 导入。
9. 实现 sync pull/push 和冲突处理。
10. 删除 Electron 运行时、IPC 适配器和桌面专属 UI，完成纯 Web 化验收。

## 14. 设计原则

迁移过程中应坚持以下原则：

- Go 后端是权威数据源。
- Web 前端只负责 UI、本地临时状态和轻量缓存。
- 高频交互不等待网络。
- 保存操作异步、批量、防抖。
- 大数据按需加载，避免 bootstrap 拉取所有重内容。
- 文档内容、图谱布局、附件分开存储和加载。
- 第一阶段避免完整离线优先，优先完成在线核心体验。
- Electron 能力全部迁移、替代或删除，不作为兜底方案。
