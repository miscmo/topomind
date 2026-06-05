# TopoMind 后端 API 契约草案

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：后端接口契约 / REST API 草案 / 错误码与响应模型设计  
**创建时间**：2026-06-05  
**当前状态**：初稿完成，待结合后端框架与认证方案细化  
**依赖文档**：
- `spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md`
- `spec/cloud-storage-refactor/cloud-storage-schema-design.md`
- `spec/cloud-storage-refactor/cloud-sync-protocol-design.md`
- `spec/cloud-storage-refactor/local-cache-and-offline-strategy.md`
- `spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md`
- `spec/cloud-storage-refactor/data-migration-from-local-workdir-plan.md`
**维护规则**：当同步协议、实体模型、附件策略、鉴权方案或客户端仓储实现发生变化时，必须同步更新本文档中的接口分组、请求响应字段、状态码、错误码、分页规则与幂等约定。

---

## 1. 文档目标

本文档用于把 TopoMind 云端重构中的核心能力收口为一版可落地的后端 API 契约草案，重点回答以下问题：

- 客户端和服务端之间应该暴露哪些核心接口
- 每个接口的请求和响应结构应如何统一
- 同步、冲突、附件上传下载、工作区 bootstrap 应如何表达
- 状态码、错误码、分页、幂等、鉴权应采用什么规则
- 第一阶段哪些接口必须做，哪些可以后补

本文档默认适用范围为：

- 单用户多设备同步优先
- REST API 为主
- WebSocket / Realtime 不作为第一阶段主链路
- 服务端为唯一真相源

---

## 2. 设计摘要

### 2.1 最终结论

TopoMind 第一阶段后端接口建议采用以下结构：

- `auth`：登录、刷新、登出、当前用户
- `workspaces`：工作区列表、创建、bootstrap、状态
- `sync`：增量拉取、写入推送、推送批处理、冲突与状态
- `attachments`：上传票据、提交确认、下载 URL、删除恢复
- `migration`：本地工作目录导入任务

### 2.2 第一阶段目标

第一阶段 API 契约要确保：

1. 核心业务实体可以通过同步接口稳定增量收敛  
2. 新设备可以通过 bootstrap 快速初始化本地缓存  
3. 附件可以通过对象存储双阶段流程上传和下载  
4. 客户端可以得到结构化错误和冲突信息  
5. 幂等、分页、权限和时间字段表达统一  

### 2.3 第一阶段不做

- 不做 GraphQL 主接口
- 不做操作流级实时协作接口
- 不做复杂服务端推送事件订阅 API
- 不做公开分享 API
- 不做团队 ACL 细粒度资源权限 API

---

## 3. 统一约定

## 3.1 URL 风格

建议统一采用：

- 资源名复数
- `kebab-case`
- 工作区作为一级隔离边界

例如：

- `GET /workspaces`
- `GET /workspaces/:workspaceId/bootstrap`
- `POST /workspaces/:workspaceId/sync/push`

## 3.2 JSON 命名风格

建议 HTTP JSON 字段统一使用 `camelCase`。

### 原因

- 与前端 TypeScript 更自然
- 便于客户端直接消费

### 数据库存储层仍然可以保持 `snake_case`，由服务端映射。

## 3.3 时间字段

所有响应中的时间统一返回：

- ISO 8601 UTC 字符串

例如：

```json
{
  "createdAt": "2026-06-05T10:00:00.000Z"
}
```

## 3.4 ID 字段

统一使用字符串表达：

- `userId`
- `workspaceId`
- `kbId`
- `cardId`
- `documentId`
- `attachmentId`

## 3.5 分页约定

列表接口默认采用 cursor 或游标分页，第一阶段推荐：

- `limit`
- `nextCursor`

对于同步事件流，使用：

- `afterEventId`

## 3.6 幂等约定

所有会创建或可能重复提交的写接口，建议支持：

- `Idempotency-Key` 请求头

或在 body 中带：

- `idempotencyKey`

### 当前推荐

同步和附件 `commit` 仍以 body 字段为主，普通 REST 创建接口可用 header。

---

## 4. 统一响应结构

## 4.1 成功响应

建议统一采用：

```json
{
  "ok": true,
  "data": {},
  "meta": {}
}
```

### 说明

- `data` 放主体数据
- `meta` 放分页、游标、调试辅助信息

## 4.2 失败响应

建议统一采用：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request payload is invalid",
    "details": {}
  }
}
```

## 4.3 冲突响应

对于版本冲突，建议扩展返回：

```json
{
  "ok": false,
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Entity version is outdated",
    "details": {
      "entityType": "document",
      "entityId": "uuid",
      "clientBaseVersion": 7,
      "serverVersion": 8
    }
  },
  "data": {
    "serverEntity": {},
    "serverEventId": 2458
  }
}
```

---

## 5. 状态码约定

建议优先遵循 HTTP 语义：

- `200`：读取成功、普通写入成功
- `201`：资源创建成功
- `202`：异步任务已受理
- `204`：删除或空响应成功
- `400`：请求格式错误
- `401`：未认证
- `403`：无权限
- `404`：资源不存在
- `409`：版本冲突、重复冲突
- `413`：文件过大
- `422`：业务校验失败
- `429`：限流
- `500`：服务端异常

### 推荐原则

- 版本冲突统一返回 `409`
- 业务校验失败更推荐 `422`

---

## 6. 错误码建议

第一阶段建议统一维护一组稳定错误码：

- `UNAUTHORIZED`
- `FORBIDDEN`
- `WORKSPACE_NOT_FOUND`
- `ENTITY_NOT_FOUND`
- `VALIDATION_ERROR`
- `VERSION_CONFLICT`
- `IDEMPOTENCY_REPLAY`
- `ATTACHMENT_UPLOAD_EXPIRED`
- `ATTACHMENT_TOO_LARGE`
- `ATTACHMENT_INVALID_MIME`
- `RATE_LIMITED`
- `MIGRATION_INVALID_WORKDIR`
- `INTERNAL_ERROR`

## 6.1 `details` 使用建议

`details` 可放：

- 字段级校验信息
- 当前服务端版本
- 允许的 MIME
- 最大大小限制
- 失败实体列表

### 不建议

- 直接泄露数据库错误原文
- 泄露对象存储内部敏感配置

---

## 7. 鉴权约定

## 7.1 鉴权方式

第一阶段建议采用：

- Bearer Token

请求头：

```http
Authorization: Bearer <access-token>
```

## 7.2 工作区权限校验

所有工作区级接口都必须校验：

- 当前用户是否可访问该 `workspaceId`

## 7.3 设备标识

同步和上传相关接口建议支持：

- `X-Device-Id`

或 body 中：

- `client.deviceId`

### 价值

- 排障
- 游标跟踪
- 多设备同步诊断

---

## 8. 资源摘要结构建议

为保持接口统一，建议定义一组“摘要 DTO”。

## 8.1 `WorkspaceSummary`

```json
{
  "id": "uuid",
  "name": "我的工作区",
  "role": "owner",
  "updatedAt": "2026-06-05T10:00:00.000Z"
}
```

## 8.2 `KnowledgeBaseSummary`

```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "name": "知识库 A",
  "sortOrder": 0,
  "version": 3,
  "updatedAt": "2026-06-05T10:00:00.000Z",
  "deletedAt": null
}
```

## 8.3 `CardSummary`

```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "kbId": "uuid",
  "parentId": "uuid",
  "name": "卡片名称",
  "sortOrder": 0,
  "version": 4,
  "updatedAt": "2026-06-05T10:00:00.000Z",
  "deletedAt": null
}
```

## 8.4 `DocumentSummary`

```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "cardId": "uuid",
  "type": "smart",
  "title": "文档标题",
  "schemaVersion": 1,
  "version": 8,
  "updatedAt": "2026-06-05T10:00:00.000Z",
  "deletedAt": null
}
```

## 8.5 `AttachmentSummary`

```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "cardId": "uuid",
  "documentId": "uuid",
  "fileName": "image.png",
  "mimeType": "image/png",
  "sizeBytes": 128000,
  "sha256": "optional_hash",
  "version": 2,
  "updatedAt": "2026-06-05T10:00:00.000Z",
  "deletedAt": null
}
```

---

## 9. 认证接口

## 9.1 `POST /auth/login`

### 用途

- 用户登录
- 返回 Access Token、Refresh Token 和当前用户摘要

### 请求

```json
{
  "email": "user@example.com",
  "password": "secret"
}
```

### 响应

```json
{
  "ok": true,
  "data": {
    "accessToken": "jwt",
    "refreshToken": "token",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "displayName": "LHG"
    }
  }
}
```

## 9.2 `POST /auth/refresh`

### 请求

```json
{
  "refreshToken": "token"
}
```

### 响应

- 返回新的 `accessToken`
- 可选返回新的 `refreshToken`

## 9.3 `POST /auth/logout`

### 用途

- 使当前 refresh token 失效

### 第一阶段可选，但建议保留。

## 9.4 `GET /auth/me`

### 用途

- 获取当前用户摘要
- 用于应用启动后的会话校验

---

## 10. 工作区接口

## 10.1 `GET /workspaces`

### 用途

- 获取当前用户可访问的工作区列表

### 响应

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "我的工作区",
        "role": "owner",
        "updatedAt": "2026-06-05T10:00:00.000Z"
      }
    ]
  }
}
```

## 10.2 `POST /workspaces`

### 用途

- 创建新工作区

### 请求

```json
{
  "name": "新的工作区"
}
```

## 10.3 `GET /workspaces/:workspaceId`

### 用途

- 获取工作区基本信息

## 10.4 `GET /workspaces/:workspaceId/bootstrap`

### 用途

- 新设备首次进入工作区时获取启动快照

### 说明

该接口不追求返回整个工作区全量数据，而应返回：

- 工作区摘要
- 当前最新 `lastEventId`
- 推荐的首批 KB
- 推荐的首批卡片/文档/布局摘要
- 客户端初始化所需配置

### 响应建议

```json
{
  "ok": true,
  "data": {
    "workspace": {
      "id": "uuid",
      "name": "我的工作区"
    },
    "cursor": {
      "lastEventId": 2458
    },
    "config": {
      "version": 3,
      "configJson": {}
    },
    "knowledgeBases": [],
    "recentDocuments": [],
    "rootLayouts": []
  }
}
```

---

## 11. 同步接口

## 11.1 `GET /workspaces/:workspaceId/sync/pull`

### 用途

- 拉取工作区增量事件

### Query 参数

- `afterEventId`
- `limit`

### 示例

```http
GET /workspaces/:workspaceId/sync/pull?afterEventId=2451&limit=200
```

### 响应

```json
{
  "ok": true,
  "data": {
    "workspaceId": "uuid",
    "fromEventId": 2451,
    "toEventId": 2499,
    "hasMore": false,
    "events": [
      {
        "id": 2452,
        "entityType": "card",
        "entityId": "uuid",
        "eventType": "updated",
        "entityVersion": 4,
        "payload": {
          "id": "uuid",
          "name": "新的卡片名",
          "version": 4,
          "updatedAt": "2026-06-05T10:02:00.000Z",
          "deletedAt": null
        }
      }
    ]
  }
}
```

## 11.2 `POST /workspaces/:workspaceId/sync/push`

### 用途

- 提交单个实体写入

### 请求

```json
{
  "entityType": "document",
  "operation": "update",
  "entityId": "uuid",
  "baseVersion": 7,
  "idempotencyKey": "uuid",
  "payload": {
    "title": "新的标题",
    "schemaVersion": 1,
    "contentJson": {}
  },
  "client": {
    "deviceId": "macbook-air-01",
    "requestId": "uuid",
    "sentAt": "2026-06-05T10:00:00.000Z"
  }
}
```

### 成功响应

```json
{
  "ok": true,
  "data": {
    "entityType": "document",
    "operation": "update",
    "entity": {
      "id": "uuid",
      "version": 8,
      "updatedAt": "2026-06-05T10:00:01.000Z",
      "updatedBy": "uuid",
      "title": "新的标题",
      "schemaVersion": 1,
      "contentJson": {}
    },
    "event": {
      "id": 2451,
      "entityVersion": 8
    }
  }
}
```

## 11.3 `POST /workspaces/:workspaceId/sync/push-batch`

### 用途

- 批量提交多个 outbox 项

### 请求建议

```json
{
  "items": [
    {
      "entityType": "card",
      "operation": "update",
      "entityId": "uuid",
      "baseVersion": 2,
      "idempotencyKey": "uuid",
      "payload": {}
    }
  ],
  "client": {
    "deviceId": "macbook-air-01"
  }
}
```

### 响应建议

- 逐项返回成功、失败、冲突结果
- 不建议批内“一项失败全批回滚”

## 11.4 `GET /workspaces/:workspaceId/sync/status`

### 用途

- 获取服务端可见的工作区同步状态摘要

### 可返回

- `latestEventId`
- `serverTime`
- 可选的设备游标状态

---

## 12. 冲突接口

## 12.1 `GET /workspaces/:workspaceId/conflicts`

### 用途

- 获取当前工作区待处理冲突摘要

### 第一阶段可选

即使服务端不持久化冲突，也可以保留接口规划。

## 12.2 `POST /workspaces/:workspaceId/conflicts/:conflictId/resolve`

### 用途

- 解决服务端持久化冲突

### 第一阶段说明

如果冲突只保留在客户端本地，可暂不实现真实服务端逻辑。

## 12.3 `POST /workspaces/:workspaceId/entities/:entityType/:entityId/restore`

### 用途

- 恢复软删除实体

### 请求

```json
{
  "baseVersion": 5,
  "idempotencyKey": "uuid"
}
```

---

## 13. 附件接口

## 13.1 `POST /workspaces/:workspaceId/attachments/upload-ticket`

### 用途

- 申请附件上传票据

### 请求

```json
{
  "cardId": "uuid",
  "documentId": "uuid",
  "fileName": "image.png",
  "mimeType": "image/png",
  "sizeBytes": 128000
}
```

### 响应

```json
{
  "ok": true,
  "data": {
    "uploadUrl": "https://...",
    "method": "PUT",
    "headers": {
      "Content-Type": "image/png"
    },
    "storageKey": "attachments/ws_123/2026/06/att_456-image.png",
    "expiresAt": "2026-06-05T10:05:00.000Z",
    "maxSizeBytes": 10485760,
    "allowedMimeTypes": ["image/png", "image/jpeg"]
  }
}
```

## 13.2 `POST /workspaces/:workspaceId/attachments/commit`

### 用途

- 上传完成后提交附件元数据

### 请求

```json
{
  "cardId": "uuid",
  "documentId": "uuid",
  "fileName": "image.png",
  "mimeType": "image/png",
  "sizeBytes": 128000,
  "storageKey": "attachments/ws_123/2026/06/att_456-image.png",
  "sha256": "optional_hash",
  "idempotencyKey": "uuid"
}
```

### 响应

```json
{
  "ok": true,
  "data": {
    "attachment": {
      "id": "uuid",
      "workspaceId": "uuid",
      "cardId": "uuid",
      "documentId": "uuid",
      "fileName": "image.png",
      "mimeType": "image/png",
      "sizeBytes": 128000,
      "version": 1,
      "updatedAt": "2026-06-05T10:00:01.000Z",
      "deletedAt": null
    },
    "event": {
      "id": 2459,
      "entityVersion": 1
    }
  }
}
```

## 13.3 `GET /workspaces/:workspaceId/attachments/:attachmentId/download-url`

### 用途

- 获取短时有效下载地址

### 响应

```json
{
  "ok": true,
  "data": {
    "downloadUrl": "https://...",
    "expiresAt": "2026-06-05T10:10:00.000Z"
  }
}
```

## 13.4 `DELETE /workspaces/:workspaceId/attachments/:attachmentId`

### 用途

- 软删除附件元数据

### 说明

- 不代表立刻删除对象文件

## 13.5 `POST /workspaces/:workspaceId/attachments/:attachmentId/restore`

### 用途

- 恢复软删除附件

---

## 14. 迁移接口

## 14.1 `POST /workspaces/import-jobs`

### 用途

- 创建本地工作目录导入任务

### 说明

如果导入逻辑完全在桌面端完成并直接走普通写接口，该接口可以后补。  
但从长期看，建议为迁移任务保留独立接口。

## 14.2 `GET /workspaces/import-jobs/:jobId`

### 用途

- 查询迁移任务状态

### 可返回

- `status`
- `stage`
- `progress`
- `warnings`
- `errors`

---

## 15. 校验规则建议

## 15.1 同步写入校验

服务端应校验：

- `entityType` 是否允许
- `operation` 是否允许
- `baseVersion` 是否存在且合法
- `payload` 是否符合应用层 schema

## 15.2 附件校验

服务端应校验：

- 文件大小上限
- MIME 白名单或黑名单
- `storageKey` 是否属于当前工作区合法前缀

## 15.3 Bootstrap 校验

服务端应保证 bootstrap 返回的：

- `lastEventId`
- `config`
- 初始摘要集合

在同一响应内自洽，不应出现明显版本倒挂。

---

## 16. 幂等与重试建议

## 16.1 哪些接口必须幂等

第一阶段建议至少以下接口必须支持幂等：

- `POST /workspaces/:workspaceId/sync/push`
- `POST /workspaces/:workspaceId/sync/push-batch`
- `POST /workspaces/:workspaceId/attachments/commit`
- `POST /workspaces/:workspaceId/entities/:entityType/:entityId/restore`

## 16.2 哪些接口天然可重试

- `GET /workspaces`
- `GET /workspaces/:workspaceId/bootstrap`
- `GET /workspaces/:workspaceId/sync/pull`
- `GET /workspaces/:workspaceId/attachments/:attachmentId/download-url`

## 16.3 幂等冲突返回建议

若同一幂等请求已成功处理过，可：

- 返回 `200`
- 返回与首次成功等价的响应体

不建议返回一个让客户端难以处理的特殊半成功状态。

---

## 17. 客户端对接建议

## 17.1 Repository 分层对应

这些接口建议由：

- `AuthRepository`
- `WorkspaceRepository`
- `SyncRepository`
- `AttachmentRepository`

分别消费。

## 17.2 UI 层不应直接使用原始接口响应

建议在客户端增加一层 DTO 到领域模型的映射：

- API DTO
- Repository Model
- UI View Model

## 17.3 最容易出问题的接口

第一阶段最需要严格测试的接口：

- `bootstrap`
- `sync/pull`
- `sync/push`
- `attachments/commit`

---

## 18. 风险与权衡

## 18.1 当前方案的优点

- 契约边界清晰
- 能直接承接同步协议设计
- 能把附件系统从普通实体写入中拆出来
- 与 PostgreSQL + 对象存储 + SQLite 组合自然匹配

## 18.2 当前方案的代价

- 接口数量比纯 CRUD 更多
- `bootstrap` 和 `sync` 语义需要认真维护
- 批量推送和附件提交都需要幂等设计

## 18.3 当前最重要的纪律

- 不要让路径重新进入 API 主键语义
- 不要把签名 URL 写进长期实体数据
- 不要把附件本体混进同步事件流
- 不要用模糊错误码替代结构化冲突信息

---

## 19. 未决问题

正式进入实现前，仍需确认以下问题：

1. 认证最终采用 `Supabase Auth` 还是自建 JWT  
2. `bootstrap` 是否要按 KB 或模块分段返回  
3. `push-batch` 是否允许部分成功部分失败  
4. 服务端是否持久化 `sync_cursor`  
5. 迁移任务是否真的下沉到服务端任务系统  
6. 附件下载采用签名 URL 还是受控转发  
7. 第一阶段是否暴露显式的 `conflicts` 服务端接口  

---

## 20. 最终建议

TopoMind 第一阶段后端 API 最重要的不是“接口越多越细”，而是：

- 认证边界清晰
- 工作区隔离清晰
- bootstrap 和 sync 语义稳定
- 冲突响应结构化
- 附件上传下载独立建模

一句话概括：

> 用一套围绕 `workspace + sync + attachment` 组织的稳定 REST 契约，把云端主存储、本地缓存和对象存储真正接起来，TopoMind 的云同步架构才算从设计走到可实施。

---

## 21. 后续文档建议

在本文档基础上，建议继续拆出以下实施文档：

- `spec/cloud-storage-refactor/client-repository-layer-design.md`
- `spec/cloud-storage-refactor/legacy-workdir-importer-implementation-plan.md`
- `spec/cloud-storage-refactor/attachment-preview-and-media-pipeline-plan.md`
- `spec/cloud-storage-refactor/server-sync-service-implementation-plan.md`

这些文档可继续细化：

- 前端仓储层与 DTO 映射
- 本地工作目录导入器实现
- 附件预览与缩略图增强
- 服务端同步服务、幂等和事件表写入实现
