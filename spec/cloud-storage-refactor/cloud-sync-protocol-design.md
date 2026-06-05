# TopoMind 云同步协议设计文档

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：同步协议设计 / 客户端与服务端交互约定 / 实施草案  
**创建时间**：2026-06-05  
**当前状态**：初稿完成，待结合 API 方案和本地缓存实现细化  
**依赖文档**：
- `spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md`
- `spec/cloud-storage-refactor/cloud-storage-schema-design.md`
**维护规则**：当实体版本策略、同步粒度、冲突处理策略、本地缓存职责或附件上传流程发生变化时，必须同步回写本文档中的协议约定、状态机、错误码、事件模型与迁移判断。

---

## 1. 文档目标

本文档用于把 TopoMind 云端重构中的“多端同步”从架构结论继续细化为可实施协议，重点回答以下问题：

- 客户端和服务端各自承担什么职责
- 哪些实体参与同步，哪些不参与
- 增量拉取和写入上报应该如何组织
- 版本号、事件流、乐观并发控制如何配合
- 冲突返回什么信息，客户端如何处理
- 本地 `SQLite` 缓存和同步队列应承担哪些职责
- 附件上传与元数据同步如何和普通实体区分

本文档默认第一阶段目标为：

- 单用户多设备同步优先
- 服务端为唯一真相源
- 桌面端支持本地缓存
- 弱冲突、非实时协作
- 不做 CRDT

---

## 2. 设计摘要

### 2.1 最终结论

TopoMind 第一阶段最合适的同步协议应采用以下组合：

- **实体级版本号** 作为乐观并发控制基础
- **工作区级递增事件流** 作为增量拉取基础
- **客户端本地 Outbox 队列** 作为离线写入缓冲
- **服务端幂等写入接口** 作为重试基础
- **按实体类型区分冲突策略** 作为体验折中

### 2.2 第一阶段不做

- 不做多人实时协作协议
- 不做操作级同步日志回放
- 不做字段级细粒度自动合并
- 不做文档 block 级 diff
- 不做布局拖拽事件流同步

### 2.3 第一阶段目标

第一阶段同步协议要确保四件事：

1. 多设备可稳定拉取同一工作区的增量变化  
2. 断网或弱网下客户端写入不会立刻丢失  
3. 常见冲突可被明确识别并提示  
4. 协议足够简单，能支撑 TopoMind 先上线云同步能力  

---

## 3. 同步边界

## 3.1 参与同步的核心实体

第一阶段建议纳入统一同步协议的实体：

- `knowledge_base`
- `card`
- `card_edge`
- `graph_layout`
- `document`
- `attachment_metadata`
- `workspace_config`

### 说明

- 这些实体都应具备稳定 `id`
- 这些实体都应具备 `version`
- 这些实体的增删改都应写入 `change_events`

## 3.2 暂不纳入统一同步的内容

第一阶段建议先不纳入或按弱同步处理：

- UI 面板展开状态
- 临时草稿
- 最近打开标签页
- 本地窗口布局
- 正在上传中的附件二进制临时文件

### 原因

- 这些信息更偏设备级状态
- 同步价值有限，但会显著增加复杂度
- 很多状态不适合成为服务端真相源

## 3.3 特殊处理对象

以下对象需要独立策略：

- `learning_stats`
- `attachment_binary`
- `auth/session`

### 建议

- `learning_stats` 先按产品决策决定是否只保留本地或部分同步
- `attachment_binary` 通过对象存储直传协议处理，不走普通 JSON 实体写接口
- `auth/session` 由认证系统单独管理，不纳入工作区同步事件流

---

## 4. 核心原则

第一阶段同步协议建议坚持以下原则：

- **服务端唯一真相源**：最终以服务端已提交版本为准
- **客户端本地先落地**：用户写操作先进入本地缓存与待同步队列
- **所有变更都有版本**：每次成功写入都推进实体版本
- **所有增量都有游标**：客户端以 `last_event_id` 作为增量拉取基准
- **所有写入可重试**：客户端写入请求必须带幂等标识
- **所有冲突可识别**：服务端返回结构化冲突信息，而不是只返回通用失败

---

## 5. 同步模型

## 5.1 整体流程

推荐的同步链路如下：

```text
User Action
  -> Application Service
    -> Local SQLite write
    -> Outbox enqueue
    -> Sync Engine push
      -> Remote API
      -> Remote commit success
      -> Local ack + apply server snapshot

Background Sync
  -> Pull changes by last_event_id
  -> Apply remote changes to local SQLite
  -> Update local sync cursor
```

## 5.2 两条主通道

同步协议由两条主通道组成：

### 写通道

- 客户端将本地变更提交到服务端
- 服务端做版本校验、落库、写 `change_events`
- 成功后返回服务端最新实体快照和新版本

### 拉通道

- 客户端以 `last_event_id` 拉取工作区增量事件
- 服务端返回事件列表和最新游标
- 客户端按顺序回放到本地缓存

## 5.3 为什么不用“全量覆盖同步”

因为全量同步会导致：

- 数据量随工作区变大而恶化
- 断点续传不自然
- 冲突定位粗糙
- 附件和大文档体验差

所以第一阶段也应明确采用增量同步。

---

## 6. 版本与事件模型

## 6.1 实体版本号

所有参与同步的核心实体都必须带：

- `id`
- `version`
- `updated_at`
- `updated_by`

### 规则

- 新建实体默认 `version = 1`
- 每次成功修改实体，服务端 `version + 1`
- 软删除和恢复都算版本推进
- 客户端提交修改时必须带上“我认知的基线版本”

## 6.2 工作区事件流

每个工作区维护单调递增事件流，对应 `change_events.id`。

### 事件字段建议

- `id`
- `workspace_id`
- `entity_type`
- `entity_id`
- `event_type`
- `entity_version`
- `payload_json`
- `created_by_user_id`
- `created_at`

### `event_type` 建议值

- `created`
- `updated`
- `deleted`
- `restored`

## 6.3 事件载荷策略

第一阶段建议 `payload_json` 采用“轻快照”而不是“操作补丁”：

- 返回实体关键字段
- 必须包含 `id`、`version`、`updated_at`
- 对于软删除事件必须包含删除状态

### 原因

- 客户端实现简单
- 本地回放直接 upsert 即可
- 不需要先建立复杂 patch 语义

### 不足

- 事件体会比纯 diff 更大
- 对大文档不够极致高效

第一阶段这个权衡是值得的。

---

## 7. 客户端本地模型

## 7.1 本地 `SQLite` 职责

本地 `SQLite` 不只是缓存，还要承担：

- 核心实体镜像
- 待同步写队列
- 同步游标
- 冲突记录
- 附件上传任务状态

## 7.2 推荐本地表

建议最少包含以下本地表：

- `local_knowledge_bases`
- `local_cards`
- `local_card_edges`
- `local_graph_layouts`
- `local_documents`
- `local_attachments`
- `sync_outbox`
- `sync_cursor`
- `sync_conflicts`
- `attachment_upload_jobs`

## 7.3 `sync_outbox` 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 本地队列项 ID |
| `workspace_id` | `text` | 工作区 |
| `entity_type` | `text` | 实体类型 |
| `entity_id` | `text` | 实体 ID |
| `operation` | `text` | `create/update/delete/restore` |
| `base_version` | `integer` | 提交时客户端认知版本 |
| `payload_json` | `text/json` | 待提交快照 |
| `idempotency_key` | `text` | 幂等请求键 |
| `status` | `text` | `pending/syncing/conflict/failed/done` |
| `retry_count` | `integer` | 重试次数 |
| `last_error_code` | `text` | 最近错误码 |
| `created_at` | `text` | 创建时间 |
| `updated_at` | `text` | 更新时间 |

## 7.4 `sync_cursor` 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_id` | `text` | 工作区 |
| `last_event_id` | `integer` | 已消费到的远端事件 |
| `last_full_sync_at` | `text` | 最近完整校准时间 |
| `last_pull_at` | `text` | 最近拉取时间 |
| `last_push_at` | `text` | 最近推送时间 |

## 7.5 本地实体状态建议

为便于 UI 表达，建议本地镜像表增加派生状态字段：

- `sync_status`
- `dirty`
- `pending_delete`
- `has_conflict`

### 说明

这些字段是本地缓存层字段，不应原样同步到服务端实体表。

---

## 8. 写通道协议

## 8.1 通用写入策略

客户端在本地有两种常见写法：

1. 用户创建或修改实体  
2. 用户删除或恢复实体  

统一流程建议为：

1. 先写本地镜像  
2. 生成 outbox 项  
3. 将实体标为 `dirty`  
4. 后台同步引擎推送  
5. 服务端成功后回写服务端快照  

## 8.2 通用写入请求结构

建议每次写入采用显式 envelope：

```json
{
  "workspaceId": "uuid",
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

## 8.3 服务端写入处理步骤

服务端建议按如下步骤处理：

1. 校验身份和工作区权限  
2. 校验 `idempotencyKey` 是否已处理  
3. 读取当前实体版本  
4. 比对 `baseVersion`  
5. 若一致则写入数据库并递增 `version`  
6. 追加 `change_events`  
7. 返回新快照和对应事件 ID  

## 8.4 写入成功响应

建议返回：

```json
{
  "ok": true,
  "workspaceId": "uuid",
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
```

## 8.5 幂等要求

客户端重试时必须重用同一 `idempotencyKey`。

### 服务端要求

- 若已成功处理过同一请求，应返回相同语义结果
- 不应因为网络抖动重复创建实体或重复推进版本

---

## 9. 拉通道协议

## 9.1 增量拉取请求

建议接口按工作区拉取：

```json
{
  "workspaceId": "uuid",
  "afterEventId": 2451,
  "limit": 200,
  "client": {
    "deviceId": "macbook-air-01"
  }
}
```

## 9.2 增量拉取响应

```json
{
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
        "kbId": "uuid",
        "parentId": "uuid",
        "name": "新的卡片名",
        "version": 4,
        "updatedAt": "2026-06-05T10:02:00.000Z",
        "deletedAt": null
      }
    }
  ]
}
```

## 9.3 客户端拉取应用规则

客户端收到事件后应按顺序处理：

1. 如果本地无该实体，则直接 upsert  
2. 如果本地实体未脏且远端版本更新，则覆盖  
3. 如果本地实体脏且远端版本更高，则进入冲突判定  
4. 全部应用完成后再推进 `last_event_id`  

## 9.4 为什么必须“应用成功后再推进游标”

否则一旦中途失败，会出现：

- 事件已被视为消费
- 本地状态却未真正落地
- 下次拉取无法自动修复

所以游标推进必须晚于本地落库。

---

## 10. 冲突处理协议

## 10.1 冲突定义

当以下条件成立时，应视为冲突：

- 客户端提交 `baseVersion = 7`
- 服务端当前实体已是 `version = 8`
- 且该变更不是同一幂等请求的重复提交

## 10.2 冲突响应结构

建议服务端返回结构化响应：

```json
{
  "ok": false,
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Entity version is outdated",
    "entityType": "document",
    "entityId": "uuid",
    "clientBaseVersion": 7,
    "serverVersion": 8
  },
  "serverEntity": {
    "id": "uuid",
    "version": 8,
    "updatedAt": "2026-06-05T10:03:00.000Z",
    "updatedBy": "uuid",
    "title": "别的设备改过的标题",
    "contentJson": {}
  },
  "serverEventId": 2458
}
```

## 10.3 第一阶段按实体类型的处理建议

### `knowledge_base`

- 冲突较少
- 默认以“提示后重试”为主

### `card`

- 名称、父节点、排序可能发生冲突
- 第一阶段建议以服务端版本为准，客户端弹出“重新应用”提示

### `card_edge`

- 冲突通常可简单刷新后重试
- 同一边重复创建时可结合业务去重

### `graph_layout`

- 房间布局天然更适合整份覆盖
- 第一阶段建议提示“该房间布局已在其他设备更新”
- 可提供“覆盖远端”按钮，但需显式二次确认

### `document`

- 文档是冲突敏感区
- 第一阶段不做自动 merge
- 建议保留本地未提交副本，并提示用户：
  - 使用服务端版本
  - 覆盖服务端
  - 复制为新文档

### `attachment_metadata`

- 元数据冲突较少
- 二进制不建议覆盖；重复上传优先生成新附件记录

## 10.4 冲突落地建议

客户端检测到冲突后：

- 将对应 outbox 项状态改为 `conflict`
- 写入 `sync_conflicts`
- 不自动丢弃本地修改
- UI 展示待处理冲突数量

---

## 11. 删除与恢复

## 11.1 删除策略

第一阶段统一采用软删除。

### 删除请求

- `operation = delete`
- 提交当前 `baseVersion`

### 删除成功后

- 服务端写 `deleted_at`
- 服务端推进 `version`
- 服务端追加 `deleted` 事件

## 11.2 恢复策略

恢复本质上是一次特殊更新：

- 清空 `deleted_at`
- 推进 `version`
- 追加 `restored` 事件

## 11.3 为什么删除也必须走版本控制

因为多端同步下最容易出问题的就是：

- A 设备修改文档
- B 设备删除文档
- 两边都认为自己是正确的最新状态

把删除纳入统一版本控制后，冲突模型才能一致。

---

## 12. 附件同步协议

## 12.1 附件与普通实体的区别

附件同步分成两段：

1. 二进制上传  
2. 元数据入库  

普通实体只需一步 JSON 写入，附件不一样。

## 12.2 推荐流程

建议采用以下流程：

1. 客户端向业务服务申请上传凭证  
2. 服务端返回预签名 URL 或上传凭证  
3. 客户端直传对象存储  
4. 上传成功后，客户端调用“确认附件元数据”接口  
5. 服务端创建 `attachments` 记录并追加事件  

## 12.3 附件元数据确认请求

```json
{
  "workspaceId": "uuid",
  "cardId": "uuid",
  "documentId": "uuid",
  "fileName": "image.png",
  "mimeType": "image/png",
  "sizeBytes": 128000,
  "storageKey": "attachments/2026/06/uuid-image.png",
  "sha256": "optional_hash",
  "idempotencyKey": "uuid"
}
```

## 12.4 上传失败处理

### 二进制上传失败

- 不创建附件实体
- 保留本地上传任务，允许继续重试

### 元数据确认失败

- 对象已上传但实体未入库
- 客户端应保留“待确认”状态
- 服务端可提供清理未确认对象的后台任务

## 12.5 下载与缓存

附件下载不应通过 `change_events` 传输内容本体。

### 事件流只负责

- 附件元数据变化
- 可预览地址失效提示
- 删除状态

### 内容获取方式

- 通过签名 URL 下载
- 下载到本地缓存目录
- 桌面端再执行系统打开或预览

---

## 13. 首次同步与重建策略

## 13.1 首次同步

新设备登录工作区时，建议：

1. 拉取工作区快照摘要  
2. 以分页方式拉取核心实体  
3. 初始化本地镜像  
4. 记录当前 `last_event_id`  
5. 再进入增量同步模式  

## 13.2 为什么首次同步不完全依赖事件流

如果工作区已很大，只靠从 `event_id = 0` 回放会导致：

- 首次同步慢
- 服务端压力大
- 历史事件冗余

所以应区分：

- **冷启动快照同步**
- **后续增量事件同步**

## 13.3 本地重建

当客户端检测到本地缓存明显损坏或游标失真时，应允许：

- 清空本地镜像
- 重新拉取快照
- 重新对齐游标

这是必要的兜底能力。

---

## 14. 失败重试与幂等

## 14.1 可重试错误

以下错误应自动重试：

- 网络超时
- 5xx 服务异常
- 限流
- 临时鉴权刷新失败后恢复

## 14.2 不应自动重试的错误

- `VERSION_CONFLICT`
- `VALIDATION_ERROR`
- `PERMISSION_DENIED`
- `WORKSPACE_NOT_FOUND`

## 14.3 重试策略建议

客户端建议采用指数退避：

- 第 1 次：1 秒
- 第 2 次：3 秒
- 第 3 次：10 秒
- 第 4 次及以上：30 秒到 5 分钟区间

### 附加规则

- 应区分前台用户触发和后台批量同步
- 前台操作失败应更早提示
- 后台同步可更保守重试

---

## 15. 同步状态机建议

## 15.1 Outbox 状态

建议 `sync_outbox.status` 使用：

- `pending`
- `syncing`
- `done`
- `failed`
- `conflict`
- `cancelled`

## 15.2 客户端全局同步状态

建议 UI 层暴露：

- `idle`
- `pushing`
- `pulling`
- `offline`
- `error`
- `conflict`

## 15.3 典型状态流转

```text
pending -> syncing -> done
pending -> syncing -> failed -> pending
pending -> syncing -> conflict
```

---

## 16. 推荐接口分组

以下是第一阶段建议的接口分组，不要求完全按此 URL 实现，但语义建议保持稳定。

## 16.1 认证与工作区

- `POST /auth/login`
- `POST /auth/refresh`
- `GET /workspaces`
- `GET /workspaces/:workspaceId/bootstrap`

## 16.2 同步

- `GET /workspaces/:workspaceId/sync/pull?afterEventId=...`
- `POST /workspaces/:workspaceId/sync/push`
- `POST /workspaces/:workspaceId/sync/push-batch`
- `GET /workspaces/:workspaceId/sync/status`

## 16.3 附件

- `POST /workspaces/:workspaceId/attachments/upload-ticket`
- `POST /workspaces/:workspaceId/attachments/commit`
- `GET /workspaces/:workspaceId/attachments/:attachmentId/download-url`

## 16.4 冲突与恢复

- `GET /workspaces/:workspaceId/conflicts`
- `POST /workspaces/:workspaceId/conflicts/:conflictId/resolve`
- `POST /workspaces/:workspaceId/entities/:entityType/:entityId/restore`

---

## 17. 与当前 TopoMind 本地模型的衔接

## 17.1 当前本地模型的现实约束

现有 TopoMind 业务代码大量使用：

- `kbPath`
- `cardPath`
- `roomPath`
- `documentId`

这意味着同步协议设计必须支持一个过渡阶段：

- UI 层暂时还会携带路径上下文
- 但协议层必须只认稳定 ID

## 17.2 过渡期建议

过渡期可以在客户端本地保留映射：

- `path -> entityId`
- `entityId -> derived display path`

### 但必须避免

- 把路径直接作为远端主键
- 用路径比较代替版本比较
- 用目录名推断实体是否同一对象

## 17.3 学习统计的衔接建议

学习统计目前更像旁路系统。

### 第一阶段建议

- 不阻塞主同步协议落地
- 先从文件旁路收口为统一服务入口
- 再决定它是账号同步、工作区同步还是仅设备本地

---

## 18. 风险与权衡

## 18.1 当前方案的优点

- 协议容易理解和实现
- 客户端与服务端边界清晰
- 足以支撑多设备自动同步
- 与 PostgreSQL + SQLite 组合天然匹配

## 18.2 当前方案的代价

- 文档冲突体验不如 CRDT
- 事件载荷比纯 diff 更大
- 本地缓存层需要维护额外状态
- 仍需认真设计首次同步和缓存修复

## 18.3 当前最重要的实现纪律

- 所有写入都必须走统一同步服务
- 不能绕开版本控制直接写核心表
- 不能让本地缓存成为第二真相源
- 不能把设备级临时状态混进工作区实体同步

---

## 19. 未决问题

正式进入实现前，仍需确认以下问题：

1. 第一阶段是否允许离线创建 KB、卡片、文档  
2. `graph_layout` 是否允许“强制覆盖远端”  
3. 文档冲突时默认方案是“保留本地副本”还是“复制新文档”  
4. 学习统计是否进入主同步通道  
5. 首次同步是否需要按 KB 分批下载  
6. 是否需要服务端保留设备级 `sync_cursor` 记录  
7. 附件是否支持断点续传和秒传去重  

---

## 20. 最终建议

TopoMind 第一阶段最务实、最稳的同步协议不是追求“最先进”，而是：

- 用 `version` 解决并发判断
- 用 `change_events` 解决增量拉取
- 用本地 `outbox` 解决离线写入和重试
- 用结构化冲突响应解决可恢复性
- 用附件双阶段上传解决大文件问题

一句话概括：

> 先把 TopoMind 做成一个“服务端真相源 + 客户端本地镜像 + 版本化事件同步”的系统，再去谈实时协作和细粒度合并，成功率最高。

---

## 21. 后续文档建议

在本文档基础上，建议继续拆出以下实施文档：

- `spec/cloud-storage-refactor/local-cache-and-offline-strategy.md`
- `spec/cloud-storage-refactor/data-migration-from-local-workdir-plan.md`
- `spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md`
- `spec/cloud-storage-refactor/backend-api-contract-draft.md`

这些文档可分别继续细化：

- SQLite 本地表设计与清理策略
- 本地工作目录导入云端流程
- 附件上传票据、签名 URL、缓存目录与预览能力
- REST API / WebSocket 具体字段与错误码
