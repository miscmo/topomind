# TopoMind 云端数据库 Schema 设计文档

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：数据库设计文档 / Schema 方案 / 表结构实施草案  
**创建时间**：2026-06-05  
**当前状态**：初稿完成，待结合后端实现方案细化  
**依赖文档**：`spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md`  
**维护规则**：当实体边界、同步策略、附件归属、权限模型或搜索方案发生变化时，必须同步更新本文档中的表结构、字段职责、约束、索引、版本策略与迁移说明。

---

## 1. 文档目标

本文档用于将 [cloud-storage-sync-architecture-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md) 中的总体架构结论，进一步细化为可实施的数据库 schema 设计方案，重点回答以下问题：

- 云端版 TopoMind 的核心实体有哪些
- 这些实体之间的归属关系和约束应该如何表达
- 哪些字段应该结构化，哪些字段应该使用 `JSONB`
- 哪些表需要版本字段、软删除字段和索引
- 多设备同步场景下，数据库层应该为哪些能力预留结构
- 第一阶段 schema 应如何控制复杂度，避免过度设计

本文档默认主数据库为 `PostgreSQL 16+`。

---

## 2. 设计摘要

### 2.1 最终结论

TopoMind 云端数据库建议采用以下思路：

- 使用 **关系型表** 存储核心业务实体与归属关系
- 使用 **`JSONB`** 存储结构化文档正文与画布布局
- 使用 **软删除字段** 而非物理删除承载回收站语义
- 使用 **版本字段** 承载多端同步和乐观并发控制
- 使用 **事件表** 和 **同步游标模型** 为后续增量同步提供基础

### 2.2 第一阶段不做

为控制复杂度，第一阶段数据库层明确不做以下设计：

- 不做 CRDT 级别的操作日志表
- 不做过细粒度的 block / cell / node 拆表
- 不做图数据库式多跳查询建模
- 不做复杂 ACL 策略引擎
- 不做附件去重系统的完整引用计数网络
- 不做实时协作 presence 的细粒度持久化

### 2.3 第一阶段目标

第一阶段 schema 的核心目标只有四个：

1. 支持账号、工作区、知识库、卡片、文档、附件的稳定实体模型  
2. 支持图布局、图关系和多类型文档内容存储  
3. 支持软删除、版本控制、同步和基础审计  
4. 为后续搜索、分享、协作预留合理扩展位  

---

## 3. 统一约定

## 3.1 主键约定

所有核心表统一使用 `uuid` 作为主键：

- 优点：跨端生成方便、合并简单、不暴露连续 ID
- 推荐：服务端生成，客户端如需离线创建可预生成 UUID

字段统一命名为：

- `id uuid primary key`

外键统一命名为：

- `xxx_id uuid not null references ...`

## 3.2 时间字段约定

除少数特殊表外，所有核心实体默认包含：

- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

软删除实体还应包含：

- `deleted_at timestamptz null`

## 3.3 版本字段约定

所有会被多端编辑的核心实体默认包含：

- `version bigint not null default 1`

### 作用

- 用于乐观并发控制
- 用于客户端增量同步
- 用于判断是否存在冲突覆盖风险

## 3.4 JSONB 字段约定

涉及编辑器内容和布局时，优先使用：

- `content_json jsonb not null default '{}'::jsonb`
- `layout_json jsonb not null default '{}'::jsonb`
- `style_json jsonb not null default '{}'::jsonb`
- `payload_json jsonb not null default '{}'::jsonb`

### 原则

- 业务查询高频字段不要埋进 `JSONB`
- 编辑器原始结构、临时扩展字段、弱约束配置适合放进 `JSONB`

## 3.5 软删除约定

以下实体建议采用软删除：

- `knowledge_bases`
- `cards`
- `documents`
- `attachments`
- `card_edges`

### 原因

- 符合当前产品回收站语义
- 便于恢复
- 便于同步时处理“已删除但未同步”的状态

---

## 4. 核心实体关系图

推荐的顶层实体关系如下：

```text
User
  -> Workspace
    -> KnowledgeBase
      -> Card (tree)
        -> Document (tree)
        -> Attachment

Workspace
  -> WorkspaceMember
  -> CardEdge
  -> GraphLayout
  -> ChangeEvent
```

其中：

- `KnowledgeBase` 是产品级知识容器
- `Card` 是核心知识实体
- `Document` 是挂载在卡片上的多类型结构化内容
- `GraphLayout` 是房间级视图状态
- `CardEdge` 是卡片之间的语义关系

---

## 5. 账号与工作区层

## 5.1 `users`

### 作用

表示平台用户。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `email` | `citext` | 登录邮箱，唯一 |
| `display_name` | `text` | 显示名称 |
| `avatar_url` | `text` | 头像地址，可空 |
| `status` | `text` | 用户状态，建议枚举 |
| `created_at` | `timestamptz` | 创建时间 |
| `updated_at` | `timestamptz` | 更新时间 |

### 建议约束

- `unique(email)`
- `check (char_length(display_name) between 1 and 80)`

---

## 5.2 `workspaces`

### 作用

表示用户的数据空间，是云端数据隔离的一级边界。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `owner_user_id` | `uuid` | 创建者 |
| `name` | `text` | 工作区名称 |
| `slug` | `text` | 对外稳定标识，可选 |
| `plan_type` | `text` | 套餐类型，可选 |
| `settings_json` | `jsonb` | 工作区级设置 |
| `created_at` | `timestamptz` | 创建时间 |
| `updated_at` | `timestamptz` | 更新时间 |
| `deleted_at` | `timestamptz` | 软删除时间 |

### 建议索引

- `index on workspaces(owner_user_id)`
- `unique(slug) where deleted_at is null`

---

## 5.3 `workspace_members`

### 作用

表示工作区成员关系，为后续分享和团队能力预留。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_id` | `uuid` | 工作区 |
| `user_id` | `uuid` | 用户 |
| `role` | `text` | `owner/editor/viewer` |
| `invited_at` | `timestamptz` | 邀请时间 |
| `joined_at` | `timestamptz` | 加入时间 |
| `created_at` | `timestamptz` | 创建时间 |

### 主键建议

- `primary key (workspace_id, user_id)`

---

## 6. 知识库与卡片层

## 6.1 `knowledge_bases`

### 作用

表示工作区下的顶层知识库。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `workspace_id` | `uuid` | 所属工作区 |
| `name` | `text` | 显示名称 |
| `sort_order` | `integer` | 首页排序 |
| `cover_attachment_id` | `uuid` | 封面附件，可空 |
| `description` | `text` | 简介，可空 |
| `settings_json` | `jsonb` | KB 级设置 |
| `version` | `bigint` | 实体版本 |
| `created_at` | `timestamptz` | 创建时间 |
| `updated_at` | `timestamptz` | 更新时间 |
| `deleted_at` | `timestamptz` | 软删除时间 |

### 建议索引

- `index on knowledge_bases(workspace_id, sort_order)`
- `index on knowledge_bases(workspace_id, updated_at desc)`
- `index on knowledge_bases(workspace_id) where deleted_at is null`

### 说明

- 目前不建议把 KB 名称作为稳定主键
- 前端 tab 和路径显示应逐步改为基于 `kb_id`

---

## 6.2 `cards`

### 作用

表示核心知识卡片实体。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `workspace_id` | `uuid` | 所属工作区 |
| `kb_id` | `uuid` | 所属知识库 |
| `parent_id` | `uuid` | 父卡片，可空 |
| `name` | `text` | 显示名称 |
| `sort_order` | `integer` | 同级顺序 |
| `status` | `text` | `active/archived` 等 |
| `meta_json` | `jsonb` | 轻量元数据 |
| `version` | `bigint` | 实体版本 |
| `created_at` | `timestamptz` | 创建时间 |
| `updated_at` | `timestamptz` | 更新时间 |
| `deleted_at` | `timestamptz` | 软删除时间 |

### 建议约束

- `check (sort_order >= 0)`
- `check (name <> '')`
- `foreign key (parent_id) references cards(id)`

### 建议索引

- `index on cards(kb_id, parent_id, sort_order)`
- `index on cards(workspace_id, kb_id)`
- `index on cards(parent_id)`
- `index on cards(workspace_id, updated_at desc)`
- `index on cards(kb_id) where deleted_at is null`

### 是否需要路径字段

第一阶段**不建议**在主表中存储规范化路径字段作为主业务字段。  
如果确有需要，可增加：

- `materialized_path text`

但仅作为：

- 加速某些层级查询
- 调试或迁移辅助字段

不应作为业务主键。

### 关于卡片唯一性

建议只要求“同一父节点下排序明确”，而不是强制“同一父节点下名称唯一”。  
是否限制重名，应由产品策略决定，而不是数据库过早写死。

---

## 7. 图关系与视图层

## 7.1 `card_edges`

### 作用

表示卡片之间的语义连接。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `workspace_id` | `uuid` | 所属工作区 |
| `kb_id` | `uuid` | 所属知识库 |
| `source_card_id` | `uuid` | 源卡片 |
| `target_card_id` | `uuid` | 目标卡片 |
| `relation` | `text` | 关系类型 |
| `weight` | `text` | 重要度 |
| `style_json` | `jsonb` | 样式扩展 |
| `version` | `bigint` | 实体版本 |
| `created_at` | `timestamptz` | 创建时间 |
| `updated_at` | `timestamptz` | 更新时间 |
| `deleted_at` | `timestamptz` | 软删除时间 |

### 建议约束

- `check (source_card_id <> target_card_id)`

### 建议索引

- `index on card_edges(kb_id, source_card_id)`
- `index on card_edges(kb_id, target_card_id)`
- `index on card_edges(workspace_id, updated_at desc)`

### 是否需要唯一约束

第一阶段不建议强制 `source + target + relation` 唯一。  
原因：

- 用户可能允许同一对卡片存在多种关系
- 未来可能有不同语义层或视图层的边

如果后续产品明确不允许重复边，再增加约束更稳妥。

---

## 7.2 `graph_layouts`

### 作用

表示某个房间的图谱视图状态。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `workspace_id` | `uuid` | 所属工作区 |
| `kb_id` | `uuid` | 所属知识库 |
| `room_card_id` | `uuid` | 房间卡片，可空；KB 根视图可为空 |
| `layout_json` | `jsonb` | 节点坐标、展开状态等 |
| `viewport_json` | `jsonb` | 视图缩放和平移 |
| `version` | `bigint` | 版本号 |
| `updated_by_user_id` | `uuid` | 最近更新用户 |
| `created_at` | `timestamptz` | 创建时间 |
| `updated_at` | `timestamptz` | 更新时间 |

### 推荐唯一约束

- `unique (kb_id, room_card_id)`

### 说明

- `room_card_id is null` 表示 KB 根房间布局
- 该表是“展示层状态”，不宜和 `cards` 表混合

---

## 8. 文档层

## 8.1 `documents`

### 作用

表示挂载在卡片上的多类型结构化文档。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `workspace_id` | `uuid` | 所属工作区 |
| `card_id` | `uuid` | 所属卡片 |
| `type` | `text` | `smart/mindmap/flowchart` |
| `title` | `text` | 文档标题 |
| `parent_document_id` | `uuid` | 父文档，可空 |
| `sort_order` | `integer` | 同级顺序 |
| `schema_version` | `integer` | 内容 schema 版本 |
| `content_json` | `jsonb` | 文档内容 |
| `meta_json` | `jsonb` | 附加元数据 |
| `version` | `bigint` | 实体版本 |
| `created_at` | `timestamptz` | 创建时间 |
| `updated_at` | `timestamptz` | 更新时间 |
| `deleted_at` | `timestamptz` | 软删除时间 |

### 建议约束

- `check (title <> '')`
- `check (sort_order >= 0)`
- `check (schema_version > 0)`

### 建议索引

- `index on documents(card_id, parent_document_id, sort_order)`
- `index on documents(card_id, type)`
- `index on documents(workspace_id, updated_at desc)`
- `index on documents(card_id) where deleted_at is null`

### 为什么不拆分成多张文档内容表

第一阶段不建议拆成：

- `smart_documents`
- `mindmap_documents`
- `flowchart_documents`

原因：

- 会让演进和迁移复杂度上升
- 未来新增文档类型时会持续扩表
- 内容主体验证更多依赖应用层 schema，而不是数据库结构本身

### 推荐的应用层策略

- 数据库只保证 `type + schema_version + content_json` 的基本边界
- 具体内容合法性由应用层 schema 校验

---

## 9. 附件层

## 9.1 `attachments`

### 作用

表示附件元数据。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `workspace_id` | `uuid` | 所属工作区 |
| `card_id` | `uuid` | 所属卡片 |
| `document_id` | `uuid` | 来源文档，可空 |
| `file_name` | `text` | 原始文件名 |
| `mime_type` | `text` | MIME 类型 |
| `size_bytes` | `bigint` | 文件大小 |
| `storage_provider` | `text` | `s3/r2/supabase/minio` |
| `storage_bucket` | `text` | bucket 名称 |
| `storage_key` | `text` | 对象存储 key |
| `sha256` | `text` | 内容摘要，可空 |
| `meta_json` | `jsonb` | 图片尺寸等扩展信息 |
| `version` | `bigint` | 实体版本 |
| `created_at` | `timestamptz` | 创建时间 |
| `updated_at` | `timestamptz` | 更新时间 |
| `deleted_at` | `timestamptz` | 软删除时间 |

### 建议约束

- `check (size_bytes >= 0)`
- `check (file_name <> '')`
- `check (storage_key <> '')`

### 建议索引

- `index on attachments(card_id, created_at desc)`
- `index on attachments(document_id)`
- `index on attachments(workspace_id, updated_at desc)`
- `index on attachments(sha256)`

### 关于附件归属

第一阶段推荐：

- 主归属为 `card_id`
- `document_id` 仅表示来源或最近挂载上下文

原因：

- 当前产品中附件更多是卡片级资源
- 避免未来移动文档时附件归属过于复杂

---

## 10. 配置与偏好层

## 10.1 `workspace_configs`

### 作用

承载工作区级设置，例如：

- 默认边样式
- 默认节点样式
- KB 排序
- 封面偏移
- 编辑器默认样式

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_id` | `uuid` | 主键，同工作区一对一 |
| `config_json` | `jsonb` | 配置正文 |
| `version` | `bigint` | 配置版本 |
| `created_at` | `timestamptz` | 创建时间 |
| `updated_at` | `timestamptz` | 更新时间 |

### 说明

- 若后续发现配置体积持续增大，再拆分类别表
- 第一阶段保持单表单 JSON 即可

---

## 11. 学习统计层

## 11.1 设计判断

学习统计不应继续保持“纯本地文件”旁路模型。  
建议在云端保留结构化统计表，但要明确区分：

- 用户级统计
- 工作区级上下文
- 设备级临时状态

## 11.2 `learning_daily_stats`

### 作用

按用户和日期聚合学习时长。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `user_id` | `uuid` | 用户 |
| `date` | `date` | 日期 |
| `total_duration_seconds` | `integer` | 当天总时长 |
| `summary_json` | `jsonb` | 聚合摘要 |
| `updated_at` | `timestamptz` | 更新时间 |

### 主键建议

- `primary key (user_id, date)`

## 11.3 `learning_sessions`

### 作用

记录学习会话，用于统计和上下文分析。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `user_id` | `uuid` | 用户 |
| `workspace_id` | `uuid` | 工作区，可空 |
| `kb_id` | `uuid` | 知识库，可空 |
| `card_id` | `uuid` | 卡片，可空 |
| `document_id` | `uuid` | 文档，可空 |
| `page_type` | `text` | 页面类型 |
| `started_at` | `timestamptz` | 开始时间 |
| `ended_at` | `timestamptz` | 结束时间 |
| `duration_seconds` | `integer` | 会话时长 |
| `meta_json` | `jsonb` | 扩展上下文 |

### 说明

- 若你后续决定“学习统计只保留本地，不同步”，这一节可以整体降级为本地缓存层设计
- 当前建议先保留云端结构，后续再按产品决策裁剪

---

## 12. 同步与审计层

## 12.1 `change_events`

### 作用

作为增量同步与审计的基础事件流。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `bigserial` | 递增事件 ID |
| `workspace_id` | `uuid` | 工作区 |
| `entity_type` | `text` | 实体类型 |
| `entity_id` | `uuid` | 实体 ID |
| `event_type` | `text` | `created/updated/deleted/restored` |
| `entity_version` | `bigint` | 对应实体版本 |
| `payload_json` | `jsonb` | 变更快照或差异 |
| `created_by_user_id` | `uuid` | 操作人 |
| `created_at` | `timestamptz` | 创建时间 |

### 建议索引

- `index on change_events(workspace_id, id)`
- `index on change_events(entity_type, entity_id, id desc)`

### 用途

- 客户端按 `last_event_id` 拉取增量
- 服务端可用于审计和问题排查
- 后续可扩展为 webhook 事件源

## 12.2 `sync_cursors`

### 作用

记录某个客户端或设备的同步游标。

### 建议字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` | 主键 |
| `user_id` | `uuid` | 用户 |
| `workspace_id` | `uuid` | 工作区 |
| `device_id` | `text` | 设备标识 |
| `last_event_id` | `bigint` | 已消费到的事件 ID |
| `last_synced_at` | `timestamptz` | 最近同步时间 |
| `meta_json` | `jsonb` | 扩展信息 |

### 是否必须持久化

不是绝对必须。  
如果客户端自行持久化游标，也可以不建此表。  
但若要支持：

- 设备级同步监控
- 服务端排障
- 多设备健康检查

保留此表更有价值。

---

## 13. 搜索与衍生索引层

## 13.1 第一阶段建议

第一阶段建议尽量少建“搜索专用表”，优先依赖：

- `knowledge_bases.name`
- `cards.name`
- `documents.title`
- `documents.content_json`

结合 PostgreSQL 的：

- `GIN`
- `to_tsvector`
- JSONB 路径查询

即可支撑基础搜索。

## 13.2 是否需要 `search_documents`

第一阶段**不必须**。  
如果后续发现：

- 文档体量持续变大
- 搜索字段提取逻辑复杂
- 需要单独做搜索更新管道

再增加：

- `search_documents`

作为冗余搜索索引表更合适。

---

## 14. 枚举与字典建议

第一阶段建议不要过度依赖数据库原生 `enum type`，更推荐：

- 使用 `text + check constraint`
- 或在应用层做 schema 校验

### 原因

- 枚举扩展更灵活
- 迁移成本更低
- 更适合产品快速演进期

### 推荐候选枚举字段

- `workspace_members.role`
- `documents.type`
- `card_edges.weight`
- `change_events.event_type`
- `users.status`

---

## 15. 关键索引策略

以下是第一阶段最值得优先建立的索引：

### 层级访问

- `cards(kb_id, parent_id, sort_order)`
- `documents(card_id, parent_document_id, sort_order)`

### 列表与最近更新

- `knowledge_bases(workspace_id, updated_at desc)`
- `cards(workspace_id, updated_at desc)`
- `documents(workspace_id, updated_at desc)`
- `attachments(workspace_id, updated_at desc)`

### 同步

- `change_events(workspace_id, id)`
- `graph_layouts(kb_id, room_card_id)` 唯一索引

### 软删除过滤

- 各核心表建议增加 `where deleted_at is null` 的部分索引

---

## 16. 示例 SQL 草案

以下 SQL 仅作为方向性草案，不代表最终 migration 文件。

## 16.1 `knowledge_bases`

```sql
create table knowledge_bases (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  name text not null,
  sort_order integer not null default 0,
  cover_attachment_id uuid null,
  description text null,
  settings_json jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  check (name <> ''),
  check (sort_order >= 0)
);

create index idx_kbs_workspace_sort
  on knowledge_bases(workspace_id, sort_order);

create index idx_kbs_workspace_updated
  on knowledge_bases(workspace_id, updated_at desc);
```

## 16.2 `cards`

```sql
create table cards (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  kb_id uuid not null references knowledge_bases(id),
  parent_id uuid null references cards(id),
  name text not null,
  sort_order integer not null default 0,
  status text not null default 'active',
  meta_json jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  check (name <> ''),
  check (sort_order >= 0)
);

create index idx_cards_kb_parent_sort
  on cards(kb_id, parent_id, sort_order);

create index idx_cards_workspace_updated
  on cards(workspace_id, updated_at desc);
```

## 16.3 `documents`

```sql
create table documents (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  card_id uuid not null references cards(id),
  type text not null,
  title text not null,
  parent_document_id uuid null references documents(id),
  sort_order integer not null default 0,
  schema_version integer not null default 1,
  content_json jsonb not null default '{}'::jsonb,
  meta_json jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  check (title <> ''),
  check (sort_order >= 0),
  check (schema_version > 0)
);

create index idx_documents_card_parent_sort
  on documents(card_id, parent_document_id, sort_order);

create index idx_documents_workspace_updated
  on documents(workspace_id, updated_at desc);
```

## 16.4 `graph_layouts`

```sql
create table graph_layouts (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  kb_id uuid not null references knowledge_bases(id),
  room_card_id uuid null references cards(id),
  layout_json jsonb not null default '{}'::jsonb,
  viewport_json jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  updated_by_user_id uuid null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kb_id, room_card_id)
);
```

## 16.5 `change_events`

```sql
create table change_events (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id),
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  entity_version bigint not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_by_user_id uuid null references users(id),
  created_at timestamptz not null default now()
);

create index idx_change_events_workspace_id
  on change_events(workspace_id, id);
```

---

## 17. 迁移与演进建议

## 17.1 从当前本地模型迁移时的实体映射

建议映射关系如下：

- 工作目录 -> `workspace`
- 顶层 KB 目录 -> `knowledge_base`
- 卡片目录 -> `card`
- `_graph.json edges` -> `card_edges`
- `_graph.json children + 布局信息` -> `graph_layouts`
- `_docs/tree.json + 文档文件` -> `documents`
- `_attach/*` -> `attachments + object storage`
- `_config.json` -> `workspace_configs`
- `learning_stats/*` -> `learning_daily_stats` / `learning_sessions`

## 17.2 迁移优先级

建议顺序如下：

1. 先建立云端 schema  
2. 先完成实体 ID 模型  
3. 再做本地目录导入器  
4. 再做增量同步器  

不要反过来从“同步文件目录”开始做，否则后面仍会回到路径耦合问题。

---

## 18. 未决问题

以下问题需要在正式落表前进一步确认：

1. 是否要求同一父卡片下名称唯一
2. 文档树是否需要跨卡片移动
3. 学习统计是否默认同步到账户
4. 附件是否允许多个卡片共享引用
5. 图布局是否支持同一房间多个视图版本
6. 是否需要 `workspace_members` 之外更细粒度的资源权限
7. 是否要为 AI 能力单独设计语料与 embedding 索引表

---

## 19. 最终建议

TopoMind 第一阶段云端数据库最应该坚持的不是“表越多越完整”，而是：

- 核心实体关系清晰
- 文档与布局用 `JSONB` 控制复杂度
- 所有可编辑实体都有版本号
- 所有核心删除都可恢复
- 所有同步都围绕稳定 ID 展开

一句话概括：

> 用 PostgreSQL 建好知识对象的骨架，用 JSONB 承载复杂编辑器内容，用版本号和事件表托住多端同步，这就是 TopoMind 云端 schema 的最优起点。

---

## 20. 后续文档建议

在本文档基础上，建议继续拆出以下实施文档：

- `spec/cloud-storage-refactor/cloud-sync-protocol-design.md`
- `spec/cloud-storage-refactor/data-migration-from-local-workdir-plan.md`
- `spec/cloud-storage-refactor/local-cache-and-offline-strategy.md`
- `spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md`

这些文档可分别继续细化：

- 增量同步协议
- 本地数据导入云端
- SQLite 缓存结构
- 附件上传、下载、缓存、签名 URL 策略
