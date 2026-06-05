# TopoMind 服务端 Sync Service 实施方案

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：服务端同步服务设计 / 事务与幂等实施方案 / 后端实施草案  
**创建时间**：2026-06-05  
**当前状态**：初稿完成，待结合后端框架和鉴权方案细化  
**依赖文档**：
- `spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md`
- `spec/cloud-storage-refactor/cloud-storage-schema-design.md`
- `spec/cloud-storage-refactor/cloud-sync-protocol-design.md`
- `spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md`
- `spec/cloud-storage-refactor/backend-api-contract-draft.md`
- `spec/cloud-storage-refactor/client-repository-layer-design.md`
- `spec/cloud-storage-refactor/sqlite-schema-and-main-process-storage-plan.md`
**维护规则**：当服务端实体 schema、同步协议、附件提交流程、幂等策略、冲突模型或后端模块边界发生变化时，必须同步更新本文档中的事务链路、服务拆分、数据表使用方式、状态机和错误返回策略。

---

## 1. 文档目标

本文档用于把 TopoMind 云同步改造中的“服务端同步能力”从协议和 API 草案进一步细化为可实施方案，重点回答以下问题：

- `bootstrap / sync pull / sync push / attachments commit` 在服务端如何真正落地
- 服务端应该拆成哪些模块和服务
- 实体版本推进、`change_events` 写入、事务边界和幂等处理如何配合
- 服务端如何做版本冲突校验和结构化返回
- 附件 `commit` 为什么也应纳入统一事件流
- 后端如何在 `PostgreSQL + 对象存储` 组合上保持实现简单且可扩展

本文档默认适用范围为：

- 单用户多设备同步优先
- 服务端为唯一真相源
- REST API 为主
- 第一阶段不做 CRDT 和多人实时协作

---

## 2. 设计摘要

### 2.1 最终结论

TopoMind 第一阶段服务端同步能力建议收口为以下几类核心服务：

```text
HTTP Controller
  -> Auth Guard / Workspace Access Guard
  -> SyncApplicationService
    -> BootstrapService
    -> SyncPushService
    -> SyncPullService
    -> AttachmentCommitService
    -> IdempotencyService
    -> EventWriter
    -> EntityRepository
    -> TransactionManager
```

### 2.2 核心原则

服务端同步实现必须遵守以下纪律：

1. 服务端是唯一真相源  
2. 所有成功写入都必须推进实体 `version`  
3. 所有成功写入都必须写入 `change_events`  
4. 实体落库和事件写入必须在同一事务内完成  
5. 幂等命中必须返回与首次成功等价的响应  
6. 冲突必须返回结构化信息，不允许只丢一个通用错误  

### 2.3 第一阶段目标

第一阶段后端同步服务要确保：

1. 新设备能通过 `bootstrap` 快速建立本地镜像  
2. 客户端能通过 `sync pull` 稳定追增量  
3. 客户端能通过 `sync push` 和 `push-batch` 做可重试写入  
4. 附件元数据能通过 `upload-ticket + commit` 和事件流对齐  
5. 后端实现足够简单，不提前引入实时协作复杂度  

### 2.4 第一阶段不做

- 不做操作级补丁存储
- 不做字段级自动合并
- 不做服务端长期持久化复杂冲突工作流
- 不做实时 presence 和协作广播
- 不做把对象文件本体放入 `change_events`

---

## 3. 服务端技术定位

## 3.1 推荐长期路线

结合前文结论，长期推荐路线仍然是：

- `NestJS + PostgreSQL + 对象存储`

### 原因

- 同步服务本质上依赖清晰事务边界
- `change_events` 和版本推进天然适合 `PostgreSQL`
- 附件元数据与对象存储本体解耦清晰
- 后续更容易补监控、后台任务和权限系统

## 3.2 MVP 兼容路线

如果走快速 MVP，也可以先用：

- `Supabase`

但即使如此，也应尽量保持本文档里的逻辑边界：

- 统一的同步服务语义
- 版本推进规则
- `change_events` 事件流
- 幂等写入规则

不要因为底层平台不同就把协议语义做散。

## 3.3 服务端不应退化成纯 CRUD 控制器

同步服务不是“给每张表做几个增删改查接口”这么简单。  
它至少还要负责：

- 版本校验
- 事件写入
- 幂等回放
- 冲突建模
- bootstrap 组装
- pull 增量窗口控制

因此实现上必须有明确的 Application Service 层。

---

## 4. 服务边界与模块拆分

## 4.1 推荐模块

第一阶段建议最少拆出以下后端模块：

- `AuthModule`
- `WorkspaceModule`
- `SyncModule`
- `AttachmentModule`
- `MigrationModule`

其中本次重点在：

- `SyncModule`
- `AttachmentModule` 中与同步直接耦合的部分

## 4.2 `SyncModule` 推荐内部结构

建议内部拆为：

- `SyncController`
- `BootstrapService`
- `SyncPushService`
- `SyncPullService`
- `SyncStatusService`
- `EventWriter`
- `IdempotencyService`
- `ConflictMapper`

## 4.3 `AttachmentModule` 与同步的分工

`AttachmentModule` 自己负责：

- 上传票据
- 下载 URL
- 对象存储 key 和权限

但 `attachments/commit` 本质上仍是一次同步写入，因此它应：

- 推进附件元数据版本
- 写 `attachments`
- 写 `change_events`
- 支持幂等

换句话说，附件 commit 不应成为游离于同步体系之外的旁路。

---

## 5. 核心数据表的实现角色

## 5.1 核心实体表

第一阶段主要涉及：

- `knowledge_bases`
- `cards`
- `card_edges`
- `graph_layouts`
- `documents`
- `attachments`
- `workspace_configs`

这些表保存实体真相数据。

## 5.2 `change_events`

`change_events` 是同步服务最核心的支撑表之一，负责：

- 增量拉取
- 审计排障
- 事件窗口推进

### 服务侧纪律

- 每个成功写入必须追加一条事件
- 事件 `payload_json` 采用轻快照
- 事件 ID 作为工作区增量游标

## 5.3 `sync_cursors`

服务端是否持久化 `sync_cursors` 不是硬性要求，但建议保留接口级兼容能力。

### 第一阶段建议

- 客户端本地游标是主游标
- 服务端 `sync_cursors` 可选用于排障与设备健康检查

### 不建议

- 不要让服务端游标成为唯一同步基准
- 不要让客户端必须依赖服务端保存游标才能继续同步

## 5.4 幂等表

虽然前文 API 契约没有展开具体表设计，但服务端实际落地建议单独保留：

- `idempotency_records`

### 建议作用

- 保存成功处理过的幂等请求键
- 记录请求摘要与响应摘要
- 支持客户端安全重试

---

## 6. 额外建议表

## 6.1 `idempotency_records`

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `workspace_id` | `uuid` | 工作区，可空 |
| `scope` | `text` | `sync_push/attachment_commit/entity_restore` |
| `idempotency_key` | `text` | 幂等键 |
| `request_hash` | `text` | 规范化请求摘要 |
| `response_json` | `jsonb` | 首次成功响应 |
| `resource_type` | `text` | 实体类型 |
| `resource_id` | `uuid` | 资源 ID，可空 |
| `created_at` | `timestamptz` | 创建时间 |
| `expires_at` | `timestamptz` | 过期时间 |

### 建议索引

- `unique index on idempotency_records(scope, idempotency_key)`
- `index on idempotency_records(workspace_id, created_at desc)`

### 要点

- 同一 `scope + idempotency_key` 命中时，应校验 `request_hash`
- 若 hash 不同，不能把它当成正常重放

## 6.2 `attachment_pending_objects`

### 是否必须

不是绝对必须，但若要更稳妥管理上传票据和未 commit 对象，可考虑保留：

- `attachment_pending_objects`

### 用途

- 记录已签发 upload ticket 但尚未 commit 的对象
- 清理长时间未完成的脏对象
- 校验 `storageKey` 是否由系统签发

第一阶段若想简化，也可以把这层信息保存在短期缓存或 `meta_json` 中。

---

## 7. 服务对象与职责

## 7.1 `BootstrapService`

### 职责

- 校验用户对工作区的访问权限
- 组装工作区初始化快照
- 返回 `lastEventId`
- 返回核心摘要集合
- 返回当前工作区配置

### 不负责

- 做全量工作区归档导出
- 直接修改任何业务实体

### 输出要求

同一响应内必须自洽：

- `cursor.lastEventId` 不能落后于所返回实体快照版本
- bootstrap 返回的摘要集合应来自同一一致性读窗口

## 7.2 `SyncPullService`

### 职责

- 根据 `workspaceId + afterEventId + limit` 拉取增量事件
- 保证事件按 `id asc` 返回
- 返回 `fromEventId / toEventId / hasMore`

### 不负责

- 帮客户端应用事件
- 维护客户端 outbox

### 实现建议

- 先做工作区权限校验
- 再查 `change_events where workspace_id = ? and id > ? order by id asc limit ?`
- 若无结果，返回空数组和最新边界信息

## 7.3 `SyncPushService`

### 职责

- 处理单实体写入
- 统一版本校验
- 统一事务提交
- 统一事件写入
- 统一幂等回放

### 实现原则

- 不把全部逻辑堆在 controller
- 用 `entityType + operation` 路由到对应 handler

## 7.4 `SyncPushBatchService`

### 职责

- 批量处理多个 outbox 项
- 逐项返回成功、失败、冲突结果
- 不做整批硬回滚

### 推荐策略

- 每项独立事务
- 整批共享鉴权与基础上下文
- 响应中给出每项状态和错误码

## 7.5 `AttachmentCommitService`

### 职责

- 校验 `storageKey`
- 校验用户权限、大小、MIME
- 写入 `attachments` 元数据
- 推进 `version`
- 写入 `change_events`
- 返回附件快照与事件 ID

### 关键结论

实现上它可以复用同步写入基建，但语义上仍保留独立服务最清晰。

## 7.6 `EventWriter`

### 职责

- 接收规范化实体快照
- 统一写入 `change_events`
- 生成标准事件 payload

### 价值

- 避免各实体 handler 自己拼事件 JSON
- 保证事件结构稳定

## 7.7 `IdempotencyService`

### 职责

- 命中已有幂等记录时返回缓存响应
- 首次成功提交后写入幂等记录
- 检测同 key 不同 payload 的非法复用

### 注意

- 幂等记录只应缓存成功结果或明确定义可回放结果
- 不建议把临时 5xx 失败结果永久记作幂等结果

---

## 8. `bootstrap` 实施方案

## 8.1 推荐语义

`GET /workspaces/:workspaceId/bootstrap` 应视为“新设备初始化快照接口”，不是“全量导出接口”。

## 8.2 推荐输出内容

建议包含：

- `workspace`
- `cursor.lastEventId`
- `config`
- `knowledgeBases`
- `recentDocuments`
- `rootLayouts`

必要时可再补：

- `recentCards`
- `attachmentCapabilities`

## 8.3 实现建议

推荐执行步骤：

1. 校验鉴权与工作区权限  
2. 读取工作区摘要  
3. 读取当前工作区最新 `change_events.id` 作为 `lastEventId`  
4. 读取首批 KB、文档、布局、配置摘要  
5. 在统一 DTO mapper 中组装响应  

## 8.4 一致性要求

若使用 `PostgreSQL`，建议在同一一致性读事务中完成 bootstrap 所需查询。  
这样可避免：

- `lastEventId` 已推进
- 但返回的实体摘要仍停留在旧状态

## 8.5 不建议

- 不要在 bootstrap 里返回整个工作区所有文档正文
- 不要把 bootstrap 设计成替代增量 pull 的全量同步主链路

---

## 9. `sync pull` 实施方案

## 9.1 标准流程

推荐流程如下：

1. 校验用户和工作区访问权限  
2. 解析 `afterEventId` 和 `limit`  
3. 查询 `change_events`  
4. 映射为 API 事件 DTO  
5. 返回 `fromEventId / toEventId / hasMore / events`  

## 9.2 查询建议

典型 SQL 方向：

```sql
select *
from change_events
where workspace_id = $1
  and id > $2
order by id asc
limit $3;
```

## 9.3 `limit` 建议

第一阶段建议设置保守上限，例如：

- 默认 `200`
- 最大 `1000`

### 原因

- 避免单次响应过大
- 降低客户端回放峰值成本
- 保持 API 时延更稳定

## 9.4 空拉取

当没有新事件时，建议仍返回：

- `workspaceId`
- `fromEventId`
- `toEventId`
- `hasMore = false`
- `events = []`

以便客户端状态机保持简单。

## 9.5 历史窗口问题

第一阶段若 `change_events` 不做裁剪，客户端理论上可从任意旧游标追上。  
后续若要裁剪旧事件，则必须配套：

- bootstrap 重建策略
- `CURSOR_TOO_OLD` 一类错误

第一阶段建议先不裁剪过激。

---

## 10. `sync push` 实施方案

## 10.1 标准流程

单实体写入建议遵循以下固定流程：

1. 校验鉴权与工作区权限  
2. 校验 `entityType / operation / payload`  
3. 校验 `idempotencyKey` 是否已命中  
4. 读取目标实体当前版本  
5. 校验 `baseVersion`  
6. 在事务内写实体  
7. 推进实体版本  
8. 写入 `change_events`  
9. 写入幂等记录  
10. 返回最新实体快照和事件信息  

## 10.2 为什么幂等检查放在事务前

原因是：

- 快速返回重复请求
- 降低无意义锁竞争
- 减少重复写事件风险

但真正写入幂等结果时，仍应放进成功事务路径中。

## 10.3 事务边界

以下动作必须视为一个原子操作：

- 更新实体
- 推进版本
- 更新时间和更新人
- 写 `change_events`
- 写 `idempotency_records`

### 不允许

- 实体已更新，但事件未写入
- 事件已写入，但实体版本未推进
- 实体和事件都成功了，但幂等结果没留下

## 10.4 成功响应组成

建议统一返回：

- `entityType`
- `operation`
- `entity`
- `event.id`
- `event.entityVersion`

### 原因

- 客户端可以直接更新本地镜像
- 客户端可以同步确认 outbox

---

## 11. 实体写入 Handler 设计

## 11.1 推荐模式

不要把所有实体写入规则堆进一个超大 `switch`。  
建议采用：

- `SyncPushService`
  - `KnowledgeBaseWriteHandler`
  - `CardWriteHandler`
  - `CardEdgeWriteHandler`
  - `GraphLayoutWriteHandler`
  - `DocumentWriteHandler`
  - `WorkspaceConfigWriteHandler`

## 11.2 统一接口草案

```ts
interface EntityWriteHandler {
  supports(entityType: string, operation: string): boolean
  validate(input: SyncWriteInput): Promise<void>
  execute(tx: DbTx, input: SyncWriteInput, context: WriteContext): Promise<WriteResult>
}
```

## 11.3 `WriteResult` 建议内容

```ts
interface WriteResult {
  entityType: string
  entityId: string
  eventType: 'created' | 'updated' | 'deleted' | 'restored'
  entityVersion: number
  entitySnapshot: Record<string, unknown>
}
```

### 价值

统一 `WriteResult` 后，`EventWriter` 和响应组装就容易保持一致。

---

## 12. 版本校验与冲突处理

## 12.1 通用规则

服务端处理写入时应使用乐观并发控制：

- 客户端提供 `baseVersion`
- 服务端读取当前版本
- 不一致则拒绝写入

## 12.2 典型冲突判定

### 更新已存在实体

- 若 `baseVersion !== currentVersion`
- 返回 `409 VERSION_CONFLICT`

### 删除或恢复实体

- 也必须检查版本
- 避免覆盖更晚的服务端状态

### 新建实体

- 若客户端指定新 ID 且服务端已存在
- 需区分“幂等重放”还是“非法冲突”

## 12.3 冲突返回结构

建议包含：

- `entityType`
- `entityId`
- `clientBaseVersion`
- `serverVersion`
- `serverEntity`
- `serverEventId`

### 原因

- 客户端能直接记录冲突并保留上下文
- 不需要再额外查一次服务端实体

## 12.4 第一阶段服务端是否持久化冲突

第一阶段建议：

- 结构化返回冲突
- 客户端本地持久化冲突
- 服务端不强制持久化复杂冲突工作流

这样实现更轻，且足以支撑多设备同步。

---

## 13. 幂等实施方案

## 13.1 哪些接口必须幂等

至少包括：

- `sync/push`
- `sync/push-batch`
- `attachments/commit`
- `entities/:entityType/:entityId/restore`

## 13.2 幂等命中流程

推荐流程：

1. 读取 `scope + idempotencyKey`
2. 若存在，比较 `request_hash`
3. 完全一致则返回缓存响应
4. 不一致则返回 `409 IDEMPOTENCY_REPLAY` 或等价错误

## 13.3 首次成功写入流程

在业务事务成功后：

- 记录幂等键
- 保存规范化响应 JSON

## 13.4 过期策略

第一阶段建议幂等记录保留一个相对保守的窗口，例如：

- `24h - 7d`

具体时长可按成本和请求规模调整。  
但不要短到正常网络重试都覆盖不到。

## 13.5 `push-batch` 的幂等

推荐做法：

- 整批请求有批级 `idempotencyKey`
- 每项也保留项级 `idempotencyKey`

### 原因

- 整批重放可快速命中
- 单项故障时仍便于精细恢复

第一阶段若实现压力大，也可先保证项级幂等。

---

## 14. `push-batch` 实施方案

## 14.1 为什么不建议整批大事务

如果批内一项失败就全批回滚，会带来：

- 实现复杂度上升
- 错误恢复体验更差
- 客户端更难定位哪项冲突

因此第一阶段更推荐：

- 批内逐项事务
- 响应中逐项报告结果

## 14.2 推荐流程

1. 校验用户与工作区权限  
2. 遍历 items  
3. 每项独立走 `SyncPushService` 主流程  
4. 收集 `success/conflict/failed` 结果  
5. 返回批处理结果  

## 14.3 响应建议

建议至少返回：

- `total`
- `successCount`
- `conflictCount`
- `failedCount`
- `items[]`

每个 `item` 应包含：

- `entityType`
- `entityId`
- `status`
- `event`
- `error`

---

## 15. 附件链路在服务端的实现

## 15.1 `upload-ticket`

### 职责

- 校验权限
- 校验 MIME、大小、工作区范围
- 生成受控 `storageKey`
- 签发短期上传票据

### 不负责

- 写 `attachments` 元数据
- 写 `change_events`

## 15.2 `attachments/commit`

### 标准流程

1. 校验鉴权与工作区权限  
2. 校验 `idempotencyKey`  
3. 校验 `storageKey` 合法性和归属  
4. 可选校验对象是否已存在于存储中  
5. 在事务内写入或更新 `attachments`  
6. 推进附件版本  
7. 写入 `change_events`  
8. 写入幂等记录  
9. 返回附件快照与事件 ID  

## 15.3 为什么 `commit` 也要写事件

因为客户端其他设备要知道：

- 新增了哪个附件
- 它挂在哪个 card/document 上
- 它的版本和元数据是什么

这些都属于结构化同步的一部分。

## 15.4 删除与恢复

附件删除和恢复应遵守与普通实体同样的同步纪律：

- 修改 `deleted_at`
- 推进 `version`
- 写 `change_events`

但对象文件本体是否立刻删除，由后台清理任务决定。

---

## 16. `change_events` 写入策略

## 16.1 事件载荷原则

第一阶段建议 `payload_json` 保存轻快照，而不是 diff：

- 必须含 `id`
- 必须含 `version`
- 必须含 `updatedAt`
- 软删除事件必须含 `deletedAt`

## 16.2 统一 payload 规范

建议每个 handler 都先产出规范化 `entitySnapshot`，再由 `EventWriter` 转为事件。

### 好处

- 不同实体响应结构和事件结构更一致
- 减少遗漏字段

## 16.3 事件生成时机

事件应在实体写入成功、版本已确定后生成。  
不要先造事件再猜版本。

## 16.4 谁来决定 `eventType`

建议由对应写入 handler 决定：

- `create -> created`
- `update -> updated`
- `delete -> deleted`
- `restore -> restored`

`EventWriter` 不应自己猜业务语义。

---

## 17. `bootstrap` 与 `pull` 的一致性关系

## 17.1 推荐关系

新设备首次进入工作区时：

1. 先拿 `bootstrap`
2. 初始化本地镜像和本地 `lastEventId`
3. 后续再走 `pull`

## 17.2 为什么两者不能打架

若 bootstrap 返回的快照比 `lastEventId` 更旧，会导致：

- 客户端落地旧镜像
- 随后的 pull 逻辑难以推理

所以服务端必须保证：

- bootstrap 摘要和 `lastEventId` 来自同一一致性读窗口

## 17.3 第一阶段是否需要分段 bootstrap

第一阶段可以先不做复杂分段，但实现上要保留演进空间。  
例如未来可按：

- KB
- 最近使用实体
- 模块类型

做分块初始化。

---

## 18. 安全、权限与校验

## 18.1 工作区权限

所有同步接口都必须先校验：

- 当前用户是否可访问该 `workspaceId`

## 18.2 实体归属校验

写入时还必须校验：

- `entityId` 是否真的属于该工作区
- 相关 `cardId/documentId/kbId` 是否关系合法

### 原因

- 防止跨工作区写污染
- 防止仅凭伪造 ID 越权更新资源

## 18.3 应用层 schema 校验

第一阶段建议对写入 payload 做应用层 schema 校验，而不是完全依赖数据库约束。

### 特别是

- `documents.contentJson`
- `graph_layouts.layout_json`
- `attachments.meta_json`

## 18.4 日志安全

服务端日志中不应直接输出：

- 完整 access token
- 完整签名 URL
- 超大 `content_json`

可以输出：

- `workspaceId`
- `entityType`
- `entityId`
- `idempotencyKey`
- 错误码

---

## 19. 观测与运维建议

## 19.1 最少监控项

建议至少监控：

- `sync/pull` QPS 和时延
- `sync/push` QPS、时延和错误率
- `VERSION_CONFLICT` 次数
- `IDEMPOTENCY_REPLAY` 次数
- `change_events` 写入速率
- `attachments/commit` 成功率

## 19.2 关键日志字段

建议日志统一带上：

- `requestId`
- `userId`
- `workspaceId`
- `deviceId`
- `entityType`
- `entityId`
- `idempotencyKey`
- `eventId`

## 19.3 排障接口

第一阶段可先不暴露复杂后台，但建议预留：

- `sync/status`
- 可选的设备游标摘要

以便后续补调试面板。

---

## 20. 后台任务建议

## 20.1 第一阶段可选后台任务

建议保留以下后台任务能力的设计空间：

- 清理过期幂等记录
- 清理长期未 commit 的对象
- 清理长期已删除的对象文件
- 生成同步统计

## 20.2 为什么先保持简单

第一阶段这些任务即使实现得很朴素，也比把主链路混乱地塞进请求处理更好。  
主链路先清晰，后台任务后补，风险更低。

---

## 21. 推荐实现顺序

## 21.1 第一步

先完成最小同步写链路：

1. `change_events`
2. 单实体 `sync/push`
3. `VERSION_CONFLICT`
4. `sync/pull`

## 21.2 第二步

补幂等与批处理：

1. `idempotency_records`
2. `sync/push-batch`
3. `restore`

## 21.3 第三步

补附件同步主链路：

1. `upload-ticket`
2. `attachments/commit`
3. `download-url`
4. 删除与恢复

## 21.4 第四步

补 bootstrap 与运维增强：

1. `bootstrap`
2. `sync/status`
3. 可选 `sync_cursors`
4. 清理任务和监控

---

## 22. 风险与权衡

## 22.1 当前方案的优点

- 与前面的协议、schema、API 契约天然一致
- `PostgreSQL` 事务模型很适合同步事件和版本推进
- 能把附件 commit 纳入统一同步主链路
- 幂等、冲突和事件写入边界清晰

## 22.2 代价

- 服务端实现不再是简单 CRUD
- 需要额外维护幂等记录与事件写入逻辑
- bootstrap 和 sync 语义需要长期维持稳定

## 22.3 最大风险

- 实体落库与事件写入不在同一事务
- 把附件 commit 做成同步旁路
- 冲突响应信息不足，导致客户端无法恢复
- 只设计 API，不真正收口到服务层边界

---

## 23. 未决问题

正式进入实现前，仍需确认以下问题：

1. 认证最终采用 `Supabase Auth` 还是自建 JWT  
2. `sync_cursors` 是否第一阶段就持久化  
3. `push-batch` 是否先只支持项级幂等  
4. 幂等记录保留窗口具体多久  
5. `bootstrap` 是否按最近活跃实体裁剪内容  
6. 附件 upload ticket 是否需要服务端登记 `pending object`  
7. 学习统计是否进入服务端同步体系  

---

## 24. 最终建议

TopoMind 服务端同步实现最重要的不是“把接口先挂出来”，而是：

- 用事务把实体、版本、事件和幂等绑在一起
- 用统一写入服务收口不同实体的同步规则
- 用稳定的 pull 事件流承接多设备增量同步
- 用结构化冲突响应支撑客户端恢复
- 用附件 commit 把对象存储和元数据同步真正接起来

一句话概括：

> 把 `bootstrap / sync pull / sync push / attachments commit` 四条链路统一收口到一个以 `PostgreSQL 事务 + change_events + idempotency` 为核心的 Sync Service，TopoMind 的服务端才真正具备承接云同步桌面客户端的能力。

---

## 25. 后续文档建议

在本文档基础上，建议继续拆出以下实施文档：

- `spec/cloud-storage-refactor/client-state-store-refactor-plan.md`
- `spec/cloud-storage-refactor/legacy-workdir-importer-implementation-plan.md`
- `spec/cloud-storage-refactor/sync-observability-and-debug-panel-plan.md`
- `spec/cloud-storage-refactor/auth-and-workspace-membership-plan.md`

这些文档可继续细化：

- Zustand 与页面状态改造顺序
- 导入器实现细节
- 同步调试与观测面板
- 鉴权和工作区访问控制
