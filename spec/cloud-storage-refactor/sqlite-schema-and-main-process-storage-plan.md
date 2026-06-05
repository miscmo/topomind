# TopoMind SQLite Schema 与 Main Process 存储方案

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：本地数据库设计 / 主进程存储服务方案 / IPC 实施草案  
**创建时间**：2026-06-05  
**当前状态**：初稿完成，待结合 Electron 依赖选型与 PoC 细化  
**依赖文档**：
- `spec/cloud-storage-refactor/cloud-storage-schema-design.md`
- `spec/cloud-storage-refactor/cloud-sync-protocol-design.md`
- `spec/cloud-storage-refactor/local-cache-and-offline-strategy.md`
- `spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md`
- `spec/cloud-storage-refactor/backend-api-contract-draft.md`
- `spec/cloud-storage-refactor/client-repository-layer-design.md`
**维护规则**：当本地镜像表、同步状态表、文件缓存目录、主进程服务拆分、IPC 白名单或 SQLite 选型发生变化时，必须同步更新本文档中的表结构、事务边界、服务职责、目录布局和迁移步骤。

---

## 1. 文档目标

本文档用于把 TopoMind 云同步改造中的“本地 SQLite 与 Electron 主进程存储层”进一步细化为可实施方案，重点回答以下问题：

- `SQLite` 具体应该存哪些表、字段和索引
- 本地镜像、同步状态和文件缓存如何一起组织
- 为什么本地数据库应由 Electron main process 管理
- `Renderer -> preload -> IPC -> main process` 之间的边界应该如何划分
- 当前大量 `fs:*` 通道如何渐进迁移到新的本地数据库与缓存服务
- 附件缓存、导入任务、冲突记录、数据库恢复和版本迁移应如何落地

本文档默认适用范围为：

- Electron 桌面端
- 单用户多设备同步优先
- 服务端为唯一真相源
- 第一阶段不做多人实时协作

---

## 2. 设计摘要

### 2.1 最终结论

TopoMind 第一阶段建议采用以下本地存储结构：

```text
Electron Main Process
  -> LocalDbService
    -> topo-cache.db
  -> FileCacheService
    -> attachments/
    -> previews/
    -> exports/
    -> temp/
  -> DesktopShellService
  -> ImportService
  -> IPC handlers
```

其中：

- `topo-cache.db` 保存结构化镜像和同步状态
- 文件缓存目录保存附件副本、预览物和临时导出物
- Renderer 不直接持有 SQLite 连接
- 所有数据库事务统一在 main process 中执行

### 2.2 第一阶段目标

第一阶段本地存储层要确保：

1. 本地结构化镜像可稳定承接 `bootstrap + sync pull/push`  
2. 本地写入与 outbox 入队可在同一事务内完成  
3. 文件缓存、桌面打开、Finder 显示、导入目录扫描可与结构化镜像解耦  
4. 数据库损坏或版本升级时可安全恢复  
5. IPC 通道边界清晰，不让 Renderer 直接依赖 SQL 和磁盘路径细节  

### 2.3 第一阶段不做

- 不做多窗口并发写数据库的复杂锁管理
- 不做对象级本地加密数据库
- 不做附件内容去重的复杂块存储
- 不做 SQLite 与旧工作目录的双主长期共存
- 不做让 Renderer 直接执行任意 SQL 的调试后门

---

## 3. 为什么数据库放主进程

## 3.1 推荐结论

TopoMind 的本地 `SQLite` 连接、事务、迁移和文件缓存管理都应放在 Electron main process，而不是 Renderer。

## 3.2 原因

主要原因包括：

- 主进程天然更适合承接文件系统和数据库 IO
- 更容易通过单入口管理事务和连接生命周期
- 与现有 preload + IPC 的安全边界一致
- 可以避免 Renderer 崩溃时留下不完整数据库句柄状态
- 便于与附件缓存、导入器、系统打开能力放在同一层

## 3.3 当前代码现实

当前项目已经是这种大方向：

- Renderer 通过 `window.electronAPI.invoke()` 调主进程
- preload 层用白名单控制可访问通道
- `electron/main.js` 已集中注册大量 `ipcMain.handle(...)`

但当前的问题是：

- IPC 几乎全部围绕 `fs:*` 和路径模型组织
- 主进程服务主要是文件系统目录读写，不是结构化镜像服务
- `ElectronAPI` 类型仍然过于泛化，只暴露通用 `invoke(channel, ...args)`

因此接下来的改造重点不是重做 IPC 机制，而是升级通道语义和主进程服务形态。

---

## 4. 本地存储总体结构

## 4.1 推荐目录布局

建议将桌面端本地持久化目录组织为：

```text
<appData>/topomind/
  storage/
    topo-cache.db
    topo-cache.db-shm
    topo-cache.db-wal
    migrations/
  cache/
    attachments/
    previews/
    exports/
    temp/
  logs/
  sessions/
```

### 说明

- `storage/` 保存数据库及其迁移元信息
- `cache/attachments/` 保存附件本地副本
- `cache/previews/` 保存缩略图和预览派生文件
- `cache/exports/` 保存短期导出产物
- `cache/temp/` 保存临时下载和转换文件

## 4.2 为什么不继续用工作目录承载缓存

原因与前文保持一致：

- 会把旧路径模型继续带入新架构
- 工作目录不应再兼任缓存容器
- 用户切换账号或工作区时很难隔离生命周期
- SQLite、附件副本和导出临时文件应当有自己的系统级目录

## 4.3 工作区与设备边界

建议数据库采用“一个设备一个数据库”的模式，在表内用 `workspace_id` 做隔离。  
原因是：

- 便于跨工作区共享数据库连接与迁移逻辑
- 便于统一管理 outbox、cursor、冲突和缓存元数据
- 不需要为每个工作区单独建立数据库文件

第一阶段不建议“每个工作区一个 SQLite 文件”。

---

## 5. SQLite 选型建议

## 5.1 推荐方向

第一阶段建议优先选择：

- 同步事务能力强
- Electron 主进程兼容稳定
- 支持 WAL
- 支持显式 migration

的 SQLite 方案。

## 5.2 候选方向

可评估的实现路线包括：

- `better-sqlite3`
- `node:sqlite` 或等价稳定运行时能力
- 封装在主进程服务内部的轻 ORM / query builder

## 5.3 当前建议

若以落地优先，建议偏向：

- `better-sqlite3 + 手写 migration + 手写 repository SQL`

### 原因

- 事务边界清晰
- 同步 API 适合主进程串行写
- 对本地嵌入式缓存层来说足够可控
- 不必过早引入重量级 ORM

### 注意

如果后续要共用类型生成、schema 校验或迁移 DSL，再考虑加薄层封装。  
第一阶段不建议为了“优雅”引入过重抽象。

---

## 6. 数据分层与表分组

## 6.1 三类表

本地数据库建议拆成三类表：

1. 镜像表  
2. 状态表  
3. 系统表  

## 6.2 镜像表

用于保存服务端实体最近已知状态：

- `local_workspaces`
- `local_knowledge_bases`
- `local_cards`
- `local_card_edges`
- `local_graph_layouts`
- `local_documents`
- `local_attachments`
- `local_workspace_configs`

## 6.3 状态表

用于保存同步和缓存派生状态：

- `sync_outbox`
- `sync_cursor`
- `sync_conflicts`
- `attachment_upload_jobs`
- `attachment_cache_entries`
- `import_jobs`

## 6.4 系统表

用于保存数据库自身状态：

- `db_meta`
- `migration_history`
- `cache_meta`

---

## 7. 镜像表设计

## 7.1 通用字段原则

几乎所有镜像表都建议包含以下字段组合：

- `id`
- `workspace_id`
- `version`
- `created_at`
- `updated_at`
- `deleted_at`
- `synced_at`
- `last_event_id`
- `dirty_state`

### 字段含义

- `version`：服务端实体版本
- `synced_at`：最近一次成功同步到本地的时间
- `last_event_id`：把该行更新到当前状态的服务端事件 ID
- `dirty_state`：本地是否存在尚未收敛的派生状态

### `dirty_state` 建议枚举

- `clean`
- `pending_push`
- `conflicted`

## 7.2 `local_workspaces`

### 作用

保存当前用户设备上见过的工作区摘要。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | 工作区 ID |
| `name` | `text` | 工作区名称 |
| `role` | `text` | 当前用户角色 |
| `server_updated_at` | `text` | 服务端更新时间 |
| `last_bootstrap_at` | `text` | 最近 bootstrap 时间 |
| `last_opened_at` | `text` | 设备最近打开时间 |
| `bootstrap_version` | `integer` | 本地 bootstrap 版本 |
| `archived_at` | `text` | 可空 |

### 建议索引

- `index on local_workspaces(last_opened_at desc)`

## 7.3 `local_knowledge_bases`

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | KB ID |
| `workspace_id` | `text` | 所属工作区 |
| `name` | `text` | 名称 |
| `sort_order` | `integer` | 排序 |
| `version` | `integer` | 实体版本 |
| `updated_at` | `text` | 服务端更新时间 |
| `deleted_at` | `text` | 软删除时间 |
| `last_event_id` | `integer` | 最近应用事件 ID |
| `synced_at` | `text` | 最近同步到本地时间 |
| `dirty_state` | `text` | 干净/待推送/冲突 |

### 建议索引

- `index on local_knowledge_bases(workspace_id, sort_order)`
- `index on local_knowledge_bases(workspace_id, updated_at desc)`

## 7.4 `local_cards`

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | 卡片 ID |
| `workspace_id` | `text` | 所属工作区 |
| `kb_id` | `text` | 所属 KB |
| `parent_id` | `text` | 父卡片 ID，可空 |
| `name` | `text` | 名称 |
| `sort_order` | `integer` | 排序 |
| `meta_json` | `text` | 弱约束扩展信息 |
| `version` | `integer` | 实体版本 |
| `updated_at` | `text` | 服务端更新时间 |
| `deleted_at` | `text` | 软删除时间 |
| `last_event_id` | `integer` | 最近应用事件 ID |
| `synced_at` | `text` | 最近同步时间 |
| `dirty_state` | `text` | 本地状态 |

### 建议索引

- `index on local_cards(workspace_id, kb_id, parent_id, sort_order)`
- `index on local_cards(workspace_id, updated_at desc)`

## 7.5 `local_card_edges`

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | 边 ID |
| `workspace_id` | `text` | 所属工作区 |
| `source_card_id` | `text` | 起点卡片 |
| `target_card_id` | `text` | 终点卡片 |
| `relation` | `text` | 边关系 |
| `weight` | `text` | 边权重 |
| `style_json` | `text` | 线样式 |
| `version` | `integer` | 实体版本 |
| `updated_at` | `text` | 更新时间 |
| `deleted_at` | `text` | 可空 |
| `last_event_id` | `integer` | 最近事件 |
| `synced_at` | `text` | 最近同步时间 |
| `dirty_state` | `text` | 本地状态 |

### 建议索引

- `index on local_card_edges(workspace_id, source_card_id)`
- `index on local_card_edges(workspace_id, target_card_id)`

## 7.6 `local_graph_layouts`

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | 布局 ID |
| `workspace_id` | `text` | 所属工作区 |
| `card_id` | `text` | 对应房间/卡片 |
| `layout_json` | `text` | 布局 JSON |
| `schema_version` | `integer` | 布局 schema 版本 |
| `version` | `integer` | 实体版本 |
| `updated_at` | `text` | 更新时间 |
| `deleted_at` | `text` | 可空 |
| `last_event_id` | `integer` | 最近事件 |
| `synced_at` | `text` | 最近同步时间 |
| `dirty_state` | `text` | 本地状态 |

### 说明

- 图布局 JSON 不建议拆成大量本地子表
- 第一阶段以整块 JSON 镜像为主
- 高频局部编辑由应用层先整块保存，再交给 outbox

## 7.7 `local_documents`

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | 文档 ID |
| `workspace_id` | `text` | 所属工作区 |
| `card_id` | `text` | 所属卡片 |
| `type` | `text` | `smart/mindmap/flowchart` |
| `title` | `text` | 标题 |
| `parent_id` | `text` | 父文档，可空 |
| `sort_order` | `integer` | 排序 |
| `schema_version` | `integer` | 文档 schema 版本 |
| `content_json` | `text` | 文档内容 |
| `version` | `integer` | 实体版本 |
| `updated_at` | `text` | 更新时间 |
| `deleted_at` | `text` | 可空 |
| `last_event_id` | `integer` | 最近事件 |
| `synced_at` | `text` | 最近同步时间 |
| `dirty_state` | `text` | 本地状态 |

### 建议索引

- `index on local_documents(workspace_id, card_id, sort_order)`
- `index on local_documents(workspace_id, updated_at desc)`

## 7.8 `local_attachments`

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | 附件 ID |
| `workspace_id` | `text` | 所属工作区 |
| `card_id` | `text` | 所属卡片 |
| `document_id` | `text` | 来源文档，可空 |
| `file_name` | `text` | 文件名 |
| `mime_type` | `text` | MIME |
| `size_bytes` | `integer` | 大小 |
| `sha256` | `text` | 内容摘要，可空 |
| `storage_provider` | `text` | 存储提供方 |
| `storage_bucket` | `text` | bucket |
| `storage_key` | `text` | 对象 key |
| `meta_json` | `text` | 尺寸、页数等信息 |
| `version` | `integer` | 实体版本 |
| `updated_at` | `text` | 更新时间 |
| `deleted_at` | `text` | 可空 |
| `last_event_id` | `integer` | 最近事件 |
| `synced_at` | `text` | 最近同步时间 |
| `dirty_state` | `text` | 本地状态 |

### 关键原则

- 数据库存的是元数据，不是附件本体
- 本地文件缓存状态单独放在 `attachment_cache_entries`

## 7.9 `local_workspace_configs`

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_id` | `text` | 主键 |
| `config_version` | `integer` | 配置版本 |
| `config_json` | `text` | 配置内容 |
| `updated_at` | `text` | 更新时间 |
| `last_event_id` | `integer` | 最近事件 |
| `synced_at` | `text` | 最近同步时间 |

---

## 8. 同步状态表设计

## 8.1 `sync_outbox`

### 作用

保存所有等待推送或待确认的本地写入项。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | outbox 主键 |
| `workspace_id` | `text` | 所属工作区 |
| `entity_type` | `text` | 实体类型 |
| `entity_id` | `text` | 实体 ID |
| `operation` | `text` | `create/update/delete/restore` |
| `base_version` | `integer` | 提交时基准版本 |
| `payload_json` | `text` | 写入 payload |
| `idempotency_key` | `text` | 幂等键 |
| `status` | `text` | `pending/sending/conflicted/done/failed` |
| `attempt_count` | `integer` | 重试次数 |
| `next_retry_at` | `text` | 下次重试时间 |
| `last_error_code` | `text` | 最近错误码 |
| `last_error_message` | `text` | 最近错误描述 |
| `created_at` | `text` | 创建时间 |
| `updated_at` | `text` | 更新时间 |
| `acked_event_id` | `integer` | 成功后对应事件 ID，可空 |

### 建议索引

- `unique index on sync_outbox(idempotency_key)`
- `index on sync_outbox(workspace_id, status, next_retry_at)`
- `index on sync_outbox(entity_type, entity_id, created_at desc)`

## 8.2 `sync_cursor`

### 作用

记录每个工作区的拉取游标。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_id` | `text` | 主键 |
| `last_event_id` | `integer` | 最近成功拉取到的事件 ID |
| `bootstrap_completed_at` | `text` | 最近 bootstrap 完成时间 |
| `last_pull_at` | `text` | 最近 pull 时间 |
| `last_push_at` | `text` | 最近 push 时间 |
| `server_time_at_last_pull` | `text` | 最近服务端时间 |

## 8.3 `sync_conflicts`

### 作用

保存待用户或应用层处理的冲突记录。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | 冲突记录 ID |
| `workspace_id` | `text` | 工作区 |
| `entity_type` | `text` | 实体类型 |
| `entity_id` | `text` | 实体 ID |
| `conflict_type` | `text` | `version_conflict` 等 |
| `client_base_version` | `integer` | 客户端基线版本 |
| `server_version` | `integer` | 服务端版本 |
| `local_payload_json` | `text` | 本地待提交内容 |
| `server_entity_json` | `text` | 服务端实体快照 |
| `status` | `text` | `open/resolved/ignored` |
| `created_at` | `text` | 创建时间 |
| `resolved_at` | `text` | 解决时间，可空 |

## 8.4 `attachment_upload_jobs`

### 作用

保存附件上传链路中的异步任务状态。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | 任务 ID |
| `workspace_id` | `text` | 工作区 |
| `local_file_path` | `text` | 本地源文件路径 |
| `card_id` | `text` | 所属卡片 |
| `document_id` | `text` | 来源文档，可空 |
| `file_name` | `text` | 文件名 |
| `mime_type` | `text` | MIME |
| `size_bytes` | `integer` | 大小 |
| `upload_ticket_json` | `text` | 上传票据 |
| `storage_key` | `text` | 对象 key |
| `sha256` | `text` | 摘要，可空 |
| `status` | `text` | `queued/uploading/committing/done/failed` |
| `attempt_count` | `integer` | 重试次数 |
| `last_error_code` | `text` | 最近错误码 |
| `created_at` | `text` | 创建时间 |
| `updated_at` | `text` | 更新时间 |

## 8.5 `attachment_cache_entries`

### 作用

管理附件元数据与本地缓存文件之间的映射。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `attachment_id` | `text` | 主键 |
| `workspace_id` | `text` | 工作区 |
| `cache_path` | `text` | 本地缓存绝对路径 |
| `cache_key` | `text` | 内部缓存 key |
| `status` | `text` | `ready/downloading/missing/stale` |
| `etag` | `text` | 可空 |
| `last_verified_at` | `text` | 最近校验时间 |
| `last_accessed_at` | `text` | 最近访问时间 |
| `size_bytes` | `integer` | 缓存文件大小 |
| `expires_at` | `text` | 可空 |

## 8.6 `import_jobs`

### 作用

记录旧工作目录导入或迁移任务状态。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `text` | 任务 ID |
| `workspace_id` | `text` | 目标工作区 |
| `source_path` | `text` | 源目录路径 |
| `stage` | `text` | `scan/preview/import/push/report` |
| `status` | `text` | `pending/running/done/failed/cancelled` |
| `summary_json` | `text` | 导入统计 |
| `report_path` | `text` | 报告文件路径 |
| `created_at` | `text` | 创建时间 |
| `updated_at` | `text` | 更新时间 |

---

## 9. 系统表设计

## 9.1 `db_meta`

### 作用

记录数据库本身的元数据。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | `text` | 主键 |
| `value` | `text` | 值 |

### 推荐键

- `schema_version`
- `app_version`
- `created_at`
- `last_opened_at`
- `last_integrity_check_at`

## 9.2 `migration_history`

### 作用

记录每次 schema migration 执行历史。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `integer` | 自增主键 |
| `migration_name` | `text` | 迁移名 |
| `applied_at` | `text` | 执行时间 |
| `success` | `integer` | 0/1 |
| `checksum` | `text` | 校验信息 |

## 9.3 `cache_meta`

### 作用

记录缓存系统级统计和清理基线。

### 推荐键

- `attachments_total_size_bytes`
- `previews_total_size_bytes`
- `last_cache_cleanup_at`
- `last_full_resync_at`

---

## 10. 事务边界设计

## 10.1 核心原则

所有影响同步一致性的关键写入都必须在事务中完成。

## 10.2 典型事务一：本地写入 + outbox 入队

适用于用户编辑文档、重命名卡片、调整布局等写操作。

```text
BEGIN
  update local mirror row
  insert sync_outbox
  update local dirty_state = pending_push
COMMIT
```

### 要点

- 任何一步失败都应整体回滚
- 不允许出现“本地镜像改了，但 outbox 没写进去”

## 10.3 典型事务二：push 成功回写

```text
BEGIN
  apply server accepted entity
  mark sync_outbox done
  update last_event_id / synced_at / dirty_state
COMMIT
```

## 10.4 典型事务三：pull 事件应用 + 游标推进

```text
BEGIN
  apply event rows
  update sync_cursor.last_event_id
  update synced_at / last_event_id
COMMIT
```

### 要点

- 事件应用和游标推进必须同事务
- 不允许“游标已推进但事件未完整落库”

## 10.5 典型事务四：冲突落库

```text
BEGIN
  insert sync_conflicts
  update mirror dirty_state = conflicted
  update outbox.status = conflicted
COMMIT
```

---

## 11. Main Process 服务拆分

## 11.1 `LocalDbService`

### 职责

- 初始化数据库连接
- 执行 migration
- 提供事务 API
- 承载镜像表和状态表读写
- 暴露面向应用语义的方法，不暴露裸 SQL 给 Renderer

### 推荐接口方向

```ts
interface LocalDbService {
  init(): Promise<void>
  transaction<T>(fn: (db: LocalDbTx) => Promise<T>): Promise<T>
  getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot>
  applySyncEvents(input: ApplySyncEventsInput): Promise<void>
  enqueueOutboxItem(item: SyncOutboxItem): Promise<void>
  getPendingOutbox(workspaceId: string, limit: number): Promise<SyncOutboxItem[]>
}
```

## 11.2 `FileCacheService`

### 职责

- 管理附件缓存目录
- 下载附件到本地缓存
- 生成预览缓存路径
- 清理陈旧文件
- 维护 `attachment_cache_entries`

### 不负责

- 决定业务权限
- 维护附件元数据真相

## 11.3 `DesktopShellService`

### 职责

- 打开本地文件
- Finder 中显示文件
- 调起文件选择器
- 处理外部链接和导出目录选择

## 11.4 `ImportService`

### 职责

- 扫描旧工作目录
- 产出导入预览
- 分批写入本地镜像和 outbox
- 输出迁移报告

## 11.5 `DbMaintenanceService`

### 可选职责

- `VACUUM / ANALYZE / integrity_check`
- 数据库备份与恢复
- 清理孤儿缓存
- 周期性统计

第一阶段可以先不拆成独立服务，但职责最好明确存在。

---

## 12. IPC 设计方案

## 12.1 当前现状

当前 preload 白名单和主进程 handler 已经很集中，但存在三个问题：

- 通道几乎都按文件系统动作命名
- 参数几乎都以 `rootDir / cardPath / attachmentRef` 为核心
- `ElectronAPI` 类型过于通用，缺少按服务分组的语义约束

## 12.2 推荐通道分组

建议逐步引入以下 IPC 分组：

- `localdb:*`
- `filecache:*`
- `desktop:*`
- `import:*`
- `sync-debug:*`

### 示例

- `localdb:getWorkspaceSnapshot`
- `localdb:applySyncEvents`
- `localdb:enqueueOutboxItem`
- `filecache:ensureAttachmentLocalFile`
- `filecache:clearExpiredEntries`
- `desktop:openLocalFile`
- `desktop:revealInFinder`
- `import:scanLegacyWorkdir`
- `import:startImportJob`

## 12.3 不建议的做法

- 不要新增 `fs:syncPull`
- 不要新增 `fs:openCloudAttachment`
- 不要把数据库动作伪装成路径动作

## 12.4 preload 建议

`preload.js` 仍可保留统一 `invoke(channel, ...args)` 入口，但建议逐步增加：

- 更明确的通道白名单分组
- 类型化包装函数
- 对危险参数的基本校验

## 12.5 `ElectronAPI` 类型建议

当前 `ElectronAPI` 太通用，后续建议演进为：

```ts
interface ElectronAPI {
  localdb: {
    getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot>
    enqueueOutboxItem(input: SyncOutboxItem): Promise<void>
  }
  filecache: {
    ensureAttachmentLocalFile(input: EnsureAttachmentLocalFileInput): Promise<LocalAttachmentHandle>
  }
  desktop: {
    openLocalFile(path: string): Promise<boolean>
    revealInFinder(path: string): Promise<boolean>
  }
  import: {
    scanLegacyWorkdir(path: string): Promise<ImportPreview>
  }
}
```

### 说明

这不一定要一次性改完，但这是更健康的长期方向。

---

## 13. 与当前 `fs:*` 通道的迁移关系

## 13.1 当前 `fs:*` 的价值

当前 `fs:*` 通道并不是完全没价值，它至少已经提供了：

- Renderer 不直连 Node API
- preload 白名单控制
- 主进程集中注册 handler

这些机制都可以保留。

## 13.2 需要替换的部分

需要逐步替换的是：

- 路径驱动的领域身份
- 目录结构即数据结构
- 文件服务同时承担镜像真相和桌面能力

## 13.3 推荐迁移步骤

### 阶段 A：新增不替换

- 保留原有 `fs:*`
- 新增 `localdb:* / filecache:* / desktop:* / import:*`
- 新功能优先走新通道

### 阶段 B：Facade 内部切换

- `useStorage()` 背后的 Facade 优先调用新通道
- 少量旧页面仍保留 `fs:*` 兼容调用

### 阶段 C：路径 API 缩退

- 将 `fs:*` 限制在导入器和少量兼容层
- 页面层不再直接消费路径式方法

### 阶段 D：最终收口

- 删除绝大多数依赖 `rootDir / cardPath / roomPath` 的通道
- `fs:*` 只保留明确属于旧工作目录兼容的少量能力

---

## 14. 启动与生命周期

## 14.1 应用启动

建议桌面应用启动后按以下顺序初始化：

1. 初始化日志系统  
2. 初始化 `LocalDbService`  
3. 执行 migration  
4. 检查数据库完整性  
5. 初始化 `FileCacheService`  
6. 恢复最近会话与当前工作区  

## 14.2 工作区切换

切换工作区时不需要重建数据库文件，但需要：

- 刷新当前 `workspace_id` 上下文
- 切换 `SyncEngine`
- 加载对应工作区镜像数据
- 更新最近打开时间

## 14.3 应用退出

退出前建议：

- 尝试 flush 待提交本地状态
- 停止同步循环
- 安全关闭数据库连接

第一阶段不要求退出前必须把所有 outbox 推送完，但必须保证本地事务已落盘。

---

## 15. 数据库迁移与恢复

## 15.1 Migration 原则

建议每次 schema 变更都使用显式 migration 文件，并记录到 `migration_history`。

### 要求

- migration 必须可重复检测，不可重复执行
- 每次升级都记录版本号和时间
- 高风险 migration 前可做数据库副本备份

## 15.2 数据库损坏恢复

若检测到数据库损坏，建议流程为：

1. 记录错误日志  
2. 备份损坏文件  
3. 重建空数据库  
4. 重新执行 bootstrap 和增量拉取  
5. 尝试恢复本地未推送 outbox 备份  

### 关键原则

- 服务端是真相源，镜像可重建
- outbox 若无法安全恢复，宁可显式提示，也不要静默吞掉

## 15.3 完整性检查

建议在以下时机执行轻量检查：

- 应用启动后
- 升级完成后
- 崩溃恢复后

可选命令包括：

- `PRAGMA integrity_check`
- `PRAGMA quick_check`

---

## 16. 文件缓存策略

## 16.1 附件缓存命名建议

建议本地附件缓存不要直接复用原文件名作为唯一标识，推荐组合：

- `workspaceId`
- `attachmentId`
- `version`
- 原始扩展名

### 示例

```text
cache/attachments/ws_<workspaceId>/att_<attachmentId>_v<version>.png
```

## 16.2 预览缓存

建议按派生结果单独存放：

```text
cache/previews/ws_<workspaceId>/att_<attachmentId>/thumb.webp
cache/previews/ws_<workspaceId>/att_<attachmentId>/page-1.png
```

## 16.3 清理原则

- 已软删除且超过保留期的附件缓存可清理
- 长期未访问且可重新下载的缓存可清理
- 临时导出与下载半成品应优先清理

## 16.4 不建议

- 不要把签名 URL 长期缓存到数据库
- 不要把 cache path 直接当作附件真相字段
- 不要让 UI 自己拼接缓存路径

---

## 17. 与同步协议的结合点

## 17.1 `pull`

`pull` 的结果应由主进程统一应用到镜像表，并同时推进 `sync_cursor`。

## 17.2 `push`

本地用户写入不会直接改远端，而是：

- 先更新本地镜像
- 再入队 `sync_outbox`
- 再由 `SyncEngine` 触发远端推送

## 17.3 冲突

冲突不建议只留在内存中，必须落表：

- 便于重启后恢复
- 便于 UI 查询待处理冲突
- 便于调试和日志回溯

## 17.4 Bootstrap

首次 bootstrap 建议由主进程侧执行“批量镜像落库”，避免 Renderer 承担大体量映射和写入。

---

## 18. 与客户端 Repository 的结合点

## 18.1 `LocalRepository` 的实现落点

上一份文档中的 `LocalRepository` 在实现上应主要落到：

- `LocalDbService`
- `FileCacheService`
- 对应的 `localdb:* / filecache:*` IPC 通道

## 18.2 Repository 不应知道什么

客户端 Repository 不应知道：

- 真实数据库文件路径
- SQLite PRAGMA 细节
- 缓存目录内部布局

它只消费语义化服务能力。

## 18.3 典型调用链

```text
Renderer Query
  -> KnowledgeRepository
    -> preload typed API
      -> ipcMain handler
        -> LocalDbService
          -> SQLite
```

---

## 19. 推荐实施顺序

## 19.1 第一步

先建立最小数据库骨架：

- `db_meta`
- `migration_history`
- `local_workspaces`
- `local_knowledge_bases`
- `local_cards`
- `local_documents`
- `sync_outbox`
- `sync_cursor`

## 19.2 第二步

补充同步必需能力：

- `sync_conflicts`
- `local_graph_layouts`
- `local_attachments`
- `attachment_upload_jobs`

## 19.3 第三步

补充文件缓存和导入能力：

- `attachment_cache_entries`
- `import_jobs`
- `filecache:*`
- `import:*`

## 19.4 第四步

逐步下线路径式主接口：

- Facade 改走 ID 模型
- 页面不再依赖 `rootDir / cardPath`
- `fs:*` 缩退为兼容层

---

## 20. 风险与权衡

## 20.1 当前方案的优点

- 能与前面的本地缓存、同步协议、客户端 repository 设计自然对齐
- 能保持 Electron 安全边界，不把 SQLite 暴露给 Renderer
- 能支持事务化 outbox 与事件应用
- 能把附件缓存、导入器和桌面能力收口到主进程

## 20.2 代价

- 主进程职责会增加
- 需要设计 migration、恢复和缓存清理机制
- 过渡期会同时存在旧 `fs:*` 和新 `localdb:*` 两套通道

## 20.3 最大风险

- 只加 SQLite，不拆路径身份
- 让新数据库继续保存旧工作目录路径主语义
- 没有事务边界，导致镜像和 outbox 脱节
- preload 白名单跟着临时需求无限膨胀

---

## 21. 未决问题

正式进入实现前，仍需确认以下问题：

1. `SQLite` 最终采用 `better-sqlite3` 还是其他主进程方案  
2. `SyncEngine` 是驻留 Renderer 调 IPC，还是部分下沉主进程  
3. 附件上传字节流是否全部在主进程完成  
4. 是否需要为数据库文件增加备份轮转  
5. 学习统计是否并入同一数据库还是保留独立本地文件  
6. 多窗口场景是否需要额外串行调度层  
7. 是否要为调试面板暴露只读 `sync-debug:*` 通道  

---

## 22. 最终建议

TopoMind 的本地持久化层不应只是“在 Electron 里塞一个 SQLite 文件”，而应同时建立：

- 明确的镜像表与状态表
- 严格的事务边界
- 主进程统一存储服务
- 分组清晰的 IPC 通道
- 与附件缓存和导入器配套的目录体系

一句话概括：

> 把 `SQLite`、文件缓存和桌面能力统一收口到 Electron main process，并以 `localdb + filecache + desktop + import` 这组服务替代当前单一 `fs:*` 路径式接口，TopoMind 的本地数据层才真正具备承接云同步的工程基础。

---

## 23. 后续文档建议

在本文档基础上，建议继续拆出以下实施文档：

- `spec/cloud-storage-refactor/server-sync-service-implementation-plan.md`
- `spec/cloud-storage-refactor/client-state-store-refactor-plan.md`
- `spec/cloud-storage-refactor/legacy-workdir-importer-implementation-plan.md`
- `spec/cloud-storage-refactor/sync-observability-and-debug-panel-plan.md`

这些文档可继续细化：

- 服务端事件写入与幂等实现
- Zustand 与页面层改造顺序
- 导入器落地细节
- 同步状态观测与调试工具
