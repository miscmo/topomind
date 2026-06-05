# TopoMind 客户端 Repository 分层设计

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：客户端数据层设计 / Repository 分层方案 / 云同步实施草案  
**创建时间**：2026-06-05  
**当前状态**：初稿完成，待结合实际代码拆分节奏细化  
**依赖文档**：
- `spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md`
- `spec/cloud-storage-refactor/cloud-storage-schema-design.md`
- `spec/cloud-storage-refactor/cloud-sync-protocol-design.md`
- `spec/cloud-storage-refactor/local-cache-and-offline-strategy.md`
- `spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md`
- `spec/cloud-storage-refactor/backend-api-contract-draft.md`
- `spec/cloud-storage-refactor/data-migration-from-local-workdir-plan.md`
**维护规则**：当客户端存储抽象、同步协议、本地 SQLite 结构、桌面端 IPC 边界或旧工作目录兼容策略发生变化时，必须同步更新本文档中的分层职责、接口约束、迁移阶段与代码映射关系。

---

## 1. 文档目标

本文档用于把 TopoMind 云同步改造中的“客户端数据访问层”收口成一版可实施的 Repository 设计，重点回答以下问题：

- 当前 `useStorage() / StorageBackend` 架构还能复用多少
- 云同步之后客户端的数据层应该分成哪些模块
- 本地 `SQLite`、远端 API、附件文件缓存、桌面能力应如何解耦
- `SyncEngine` 应该放在哪一层，负责什么，不负责什么
- UI、Zustand、Repository、IPC、Electron main process 之间应如何分工
- 现有大量 `rootDir / kbPath / cardPath / roomPath` 语义应如何逐步迁移到稳定 ID

本文档默认适用范围为：

- Electron 桌面端为第一优先实现端
- React Renderer + Zustand 现有前端架构
- 服务端为唯一真相源
- 第一阶段支持离线可读与有限离线写
- 第一阶段不做 CRDT 和多人实时协作

---

## 2. 设计摘要

### 2.1 最终结论

TopoMind 客户端不应从“一个本地文件后端”直接跳到“UI 到处发 HTTP 请求”，而应演进为下面这套结构：

```text
Renderer UI
  -> Application Services / Use Cases
    -> Repository Facade
      -> Local Repository (SQLite mirror)
      -> Remote Repository (REST API)
      -> Attachment Transfer Service
      -> Desktop Capability Service
      -> Sync Engine
```

其中：

- `Repository Facade` 对 UI 暴露稳定的领域化读写接口
- `Local Repository` 负责本地结构化镜像与查询
- `Remote Repository` 负责远端 DTO 请求与响应映射
- `Attachment Transfer Service` 负责附件上传票据、下载 URL、传输任务
- `Desktop Capability Service` 负责打开文件、Finder 显示、导入目录等桌面能力
- `SyncEngine` 负责本地 outbox、远端 push/pull、冲突记录与游标推进

### 2.2 核心原则

客户端 Repository 层需要遵守以下纪律：

1. UI 不直接依赖远端 API DTO  
2. UI 不直接依赖 `SQLite` 表结构  
3. UI 不直接依赖本地路径作为实体身份  
4. 远端不是每次渲染都现查，核心数据优先读取本地镜像  
5. 所有同步副作用都收敛到 `SyncEngine`，不要散落到页面逻辑  
6. Electron 桌面能力通过受控服务暴露，不让 Renderer 自由读写本地文件系统  

### 2.3 第一阶段推荐模块

第一阶段建议最少拆出以下客户端数据模块：

- `AuthRepository`
- `WorkspaceRepository`
- `KnowledgeRepository`
- `AttachmentRepository`
- `LocalRepository`
- `SyncRepository`
- `SyncEngine`
- `DesktopBridge`
- `LegacyWorkdirAdapter`

### 2.4 为什么不继续沿用单一 `StorageBackend`

当前 `StorageBackend` 的价值在于统一入口，但它的问题同样明显：

- 接口天然面向本地文件系统
- 方法签名深度绑定 `kbPath / cardPath / roomPath`
- 附件、本地目录、图布局、文档内容都混在同一个后端接口里
- 不区分“领域数据访问”和“桌面能力调用”
- 无法自然承接本地镜像 + outbox + 远端 API 的三路协作

因此未来最合理的做法不是删除统一入口，而是把它升级为“面向领域的 Facade”，底下接多个 Repository 与服务。

---

## 3. 当前代码基线

## 3.1 已有可复用能力

当前项目已经具备几个很重要的基础：

- Renderer 通过 `StorageProvider` 注入统一存储上下文
- 业务层大量通过 `useStorage()` 调统一入口
- `createStore()` 已经把一部分业务校验和后端调用做了隔离
- 本地文件读写已通过 Electron preload / IPC / main process 完成

这意味着项目并不是从零开始做分层，而是可以在现有抽象上逐步替换底层实现。

## 3.2 当前主要问题

从现有代码看，当前存储抽象仍然深度基于“工作目录 + 路径”模型，例如：

- `StorageProvider` 默认从 `currentWorkDir` 创建文件后端
- `StorageBackend` 方法大量以 `kbPath / cardPath / roomPath` 为参数
- `createStore()` 里很多方法直接围绕路径进行读写、重命名和删除
- 部分业务状态和统计逻辑直接依赖 `currentWorkDir`

这些问题在单机文件模式下可以接受，但在云同步模型下会带来以下后果：

- 领域主键无法稳定脱离路径
- 同一个实体在本地缓存、远端实体、迁移报告中缺少统一身份
- 页面代码容易无意间把路径重新当成主键
- 同步冲突和版本管理很难围绕路径表达
- 附件、布局、文档内容和系统打开能力无法分层

## 3.3 当前代码中的典型症状

当前代码层面可以概括为以下几类症状：

- 存储方法把“数据访问”和“系统文件操作”混在一起
- Graph/Tab/Learning 等模块仍有大量 `kbPath / roomPath / rootDir` 依赖
- 本地工作目录是工作区选择、实体身份和文件缓存三种角色的叠加体
- Zustand 中的工作区状态仍然主要表达 `currentWorkDir`

这说明客户端仓储层设计不能只新增几个类名，而必须明确“身份模型”和“进程边界”。

---

## 4. 目标架构

## 4.1 推荐总体结构

推荐客户端数据层采用如下结构：

```text
React Components
  -> ViewModel / Zustand Stores
    -> Application Services / Commands / Queries
      -> Repository Facade
        -> AuthRepository
        -> WorkspaceRepository
        -> KnowledgeRepository
        -> AttachmentRepository
        -> LocalRepository
        -> SyncRepository
        -> DesktopBridge
        -> LegacyWorkdirAdapter
      -> SyncEngine

Electron Main Process
  -> LocalDbService (SQLite)
  -> FileCacheService
  -> DesktopShellService
  -> ImportService
  -> IPC handlers

Remote
  -> REST API
  -> Object Storage
```

## 4.2 分层原则

每一层都应有清晰边界：

- UI 层：展示状态、发起用户意图，不拼接远端请求
- Zustand / ViewModel：承接交互态，不直接实现同步协议
- Application Services：组织一次完整业务流程
- Repository：提供领域语义稳定的数据访问接口
- SyncEngine：独立处理同步循环，不附着于某个页面
- Electron Main：承接本地数据库、文件缓存和操作系统能力

## 4.3 最重要的架构纪律

未来任何新增代码都应满足：

- 不允许页面代码直接构造同步请求体
- 不允许页面代码直接知道 `change_events` 或 `sync_outbox` 表结构
- 不允许 UI 直接操作对象存储 URL
- 不允许路径重新成为领域实体的唯一身份
- 不允许同步逻辑散落到多个 hook 中各自重试

---

## 5. 领域身份模型

## 5.1 统一身份

云同步改造后，客户端所有核心实体都应以稳定 ID 识别：

- `workspaceId`
- `kbId`
- `cardId`
- `documentId`
- `graphLayoutId`
- `attachmentId`

## 5.2 路径的降级定位

路径信息仍然有价值，但只能作为以下几种用途：

- 旧工作目录迁移时的来源信息
- 本地导入报告与兼容显示信息
- 桌面端附件副本路径
- 调试和错误日志

路径不应继续承担：

- 主键语义
- 权限边界
- 同步版本边界
- UI 核心查询条件

## 5.3 客户端过渡期需要的兼容信息

在完全去路径化之前，客户端可以临时保留映射关系：

- `legacyPath -> entityId`
- `entityId -> legacyPath`
- `workspaceId -> lastImportedWorkDir`

但这些映射应明确归类为兼容层数据，而不是长期领域模型。

---

## 6. 核心模块设计

## 6.1 `AuthRepository`

### 职责

- 登录、刷新 token、登出、获取当前用户
- 暴露当前会话状态
- 管理访问令牌的持久化与失效处理

### 不负责

- 工作区实体查询
- 同步流程控制
- UI 路由决策

### 推荐接口草案

```ts
interface AuthRepository {
  login(input: { email: string; password: string }): Promise<UserSession>
  refresh(): Promise<UserSession>
  logout(): Promise<void>
  getCurrentSession(): Promise<UserSession | null>
}
```

## 6.2 `WorkspaceRepository`

### 职责

- 查询工作区列表
- 获取工作区 bootstrap 数据
- 选择当前工作区
- 提供工作区级配置和基础信息

### 推荐接口草案

```ts
interface WorkspaceRepository {
  listWorkspaces(): Promise<WorkspaceSummary[]>
  getWorkspace(workspaceId: string): Promise<Workspace>
  bootstrap(workspaceId: string): Promise<WorkspaceBootstrap>
  getCurrentWorkspace(): Promise<WorkspaceSession | null>
  setCurrentWorkspace(input: WorkspaceSession): Promise<void>
}
```

### 说明

这里的“当前工作区”不再等价于 `currentWorkDir`，而应表达：

- 当前登录用户
- 当前 `workspaceId`
- 可选的最近本地导入目录
- 最近一次同步游标
- 设备级 UI 偏好

## 6.3 `KnowledgeRepository`

### 职责

统一承接结构化知识实体的查询与写入：

- `knowledge_base`
- `card`
- `document`
- `graph_layout`

### 推荐做法

第一阶段建议按领域语义暴露接口，而不是完全按数据库表分 Repository。  
原因是 UI 当前更接近“知识对象操作”，不是“表级 CRUD”。

### 推荐接口草案

```ts
interface KnowledgeRepository {
  listKnowledgeBases(workspaceId: string): Promise<KnowledgeBase[]>
  listChildCards(input: { workspaceId: string; parentCardId: string | null }): Promise<CardSummary[]>
  getCard(cardId: string): Promise<Card | null>
  createCard(input: CreateCardInput): Promise<Card>
  renameCard(input: RenameCardInput): Promise<Card>
  moveCard(input: MoveCardInput): Promise<Card>
  deleteCard(input: DeleteCardInput): Promise<void>

  listDocuments(cardId: string): Promise<DocumentSummary[]>
  getDocument(documentId: string): Promise<TopoDocument | null>
  createDocument(input: CreateDocumentInput): Promise<TopoDocument>
  updateDocument(input: UpdateDocumentInput): Promise<TopoDocument>
  deleteDocument(input: DeleteDocumentInput): Promise<void>

  getGraphLayout(cardId: string): Promise<GraphLayout>
  saveGraphLayout(input: SaveGraphLayoutInput): Promise<GraphLayout>
}
```

### 第一阶段的关键约束

- 写操作默认先落本地，再进入 outbox
- 读操作优先从本地镜像读取
- Repository 返回领域模型，不直接返回 API DTO 或 SQLite row

## 6.4 `AttachmentRepository`

### 职责

- 查询附件元数据
- 发起上传票据申请与提交确认
- 拉取下载 URL
- 维护本地附件缓存状态
- 协调桌面打开、Finder 显示和下载行为

### 推荐接口草案

```ts
interface AttachmentRepository {
  listAttachments(cardId: string): Promise<AttachmentSummary[]>
  queueImport(input: ImportAttachmentInput): Promise<AttachmentJob>
  getDownloadUrl(attachmentId: string): Promise<SignedDownload>
  ensureLocalFile(attachmentId: string): Promise<LocalAttachmentHandle>
  deleteAttachment(input: { attachmentId: string; baseVersion: number }): Promise<void>
  restoreAttachment(input: { attachmentId: string; baseVersion: number }): Promise<void>
}
```

### 说明

附件 Repository 不应亲自实现字节传输细节，可以把上传和下载委托给：

- `AttachmentTransferService`
- `FileCacheService`
- `DesktopBridge`

## 6.5 `LocalRepository`

### 职责

`LocalRepository` 是客户端最关键的本地结构化镜像接口，负责：

- 读写 `SQLite` 镜像表
- 读写 `sync_outbox`
- 读写 `sync_cursor`
- 读写 `sync_conflicts`
- 提供面向应用层的查询，而不是暴露 SQL 细节

### 推荐接口草案

```ts
interface LocalRepository {
  transaction<T>(fn: (tx: LocalRepositoryTx) => Promise<T>): Promise<T>

  getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot>
  getKnowledgeBaseList(workspaceId: string): Promise<KnowledgeBase[]>
  getCard(cardId: string): Promise<Card | null>
  getDocument(documentId: string): Promise<TopoDocument | null>
  getGraphLayout(cardId: string): Promise<GraphLayout | null>

  upsertEntities(events: SyncAppliedEvent[]): Promise<void>
  enqueueOutboxItem(item: SyncOutboxItem): Promise<void>
  markOutboxItemSynced(outboxId: string, eventId: number): Promise<void>
  recordConflict(conflict: SyncConflictRecord): Promise<void>
  getPendingOutbox(workspaceId: string, limit: number): Promise<SyncOutboxItem[]>
  getSyncCursor(workspaceId: string): Promise<number | null>
  setSyncCursor(workspaceId: string, eventId: number): Promise<void>
}
```

### 重要要求

- `LocalRepository` 必须支持事务
- `pull` 应用结果与游标推进必须同事务提交
- `push` 成功回写本地镜像和 outbox 状态也应同事务提交

## 6.6 `SyncRepository`

### 职责

`SyncRepository` 不是“本地仓储”，而是远端同步接口包装层，主要负责：

- `bootstrap`
- `sync pull`
- `sync push`
- `sync push-batch`
- `sync status`
- 同步相关错误码映射

### 推荐接口草案

```ts
interface SyncRepository {
  bootstrap(workspaceId: string): Promise<WorkspaceBootstrap>
  pull(input: PullRequest): Promise<PullResponse>
  push(input: PushRequest): Promise<PushResponse>
  pushBatch(input: PushBatchRequest): Promise<PushBatchResponse>
  getStatus(workspaceId: string): Promise<RemoteSyncStatus>
}
```

### 不负责

- 本地出队顺序
- 重试调度
- UI 提示文案
- 本地冲突持久化

这些职责属于 `SyncEngine` 和应用层。

## 6.7 `SyncEngine`

### 核心定位

`SyncEngine` 是编排器，不是数据库层，也不是 UI hook。

### 职责

- 监听网络状态、应用前后台和工作区切换
- 拉取本地待同步 outbox
- 调用远端 `push/pull`
- 应用服务端事件到本地镜像
- 处理重试、退避、游标推进和冲突记录
- 暴露同步状态给状态层

### 不负责

- 登录表单逻辑
- 组件级加载态
- 直接渲染冲突弹窗
- 直接执行 Finder/系统打开

### 推荐状态机

第一阶段建议将 `SyncEngine` 状态至少分为：

- `idle`
- `bootstrapping`
- `pulling`
- `pushing`
- `reconciling`
- `offline`
- `error`

### 推荐接口草案

```ts
interface SyncEngine {
  start(workspaceId: string): Promise<void>
  stop(): Promise<void>
  triggerPull(reason: SyncTriggerReason): Promise<void>
  triggerPush(reason: SyncTriggerReason): Promise<void>
  forceFullResync(workspaceId: string): Promise<void>
  getState(): SyncEngineState
  subscribe(listener: (state: SyncEngineState) => void): () => void
}
```

## 6.8 `DesktopBridge`

### 职责

- 打开附件
- Finder 中显示文件
- 导入旧工作目录
- 访问本地缓存文件路径
- 调用系统级文件选择器

### 设计原则

`DesktopBridge` 只暴露“受控能力”，不要让 Renderer 拿到任意路径读写权。

### 推荐接口草案

```ts
interface DesktopBridge {
  openLocalFile(path: string): Promise<boolean>
  revealInFinder(path: string): Promise<boolean>
  selectImportDirectory(): Promise<string | null>
  importLegacyWorkdir(path: string): Promise<ImportPreview>
}
```

## 6.9 `LegacyWorkdirAdapter`

### 职责

为过渡期提供旧路径模型到新 ID 模型的适配：

- 读取旧目录结构
- 产出迁移预览
- 维护兼容映射
- 为少量尚未去路径化的 UI 提供临时桥接信息

### 原则

它只能是迁移期组件，不能成为长期主路径。

---

## 7. Repository Facade 设计

## 7.1 为什么仍然需要统一入口

虽然底层要拆分为多个 Repository，但 UI 层依旧适合保留一个统一入口。  
原因包括：

- 现有项目已习惯通过 `useStorage()` 访问数据能力
- 可以降低大规模重构时的页面改动成本
- 有利于逐步替换底层实现

## 7.2 推荐做法

保留 `StorageProvider/useStorage()` 这组入口，但把内部实现从“文件后端商店”升级为“Repository Facade”。

推荐结构：

```ts
interface AppRepositoryFacade {
  auth: AuthRepository
  workspaces: WorkspaceRepository
  knowledge: KnowledgeRepository
  attachments: AttachmentRepository
  sync: {
    getState(): SyncEngineState
    triggerPull(reason: SyncTriggerReason): Promise<void>
    triggerPush(reason: SyncTriggerReason): Promise<void>
  }

  // 过渡期兼容能力
  legacy?: LegacyCompatibleStorageApi
}
```

## 7.3 不建议继续扩张旧 `StorageBackend`

不建议在现有 `StorageBackend` 上继续叠加更多方法，例如：

- `syncPull()`
- `syncPush()`
- `login()`
- `openCloudAttachment()`

因为这会让接口继续朝“巨型后端对象”演化，长期只会更难拆。

---

## 8. 本地优先读写策略

## 8.1 读路径

客户端核心实体读流程建议固定为：

```text
UI / Query
  -> KnowledgeRepository
    -> LocalRepository
      -> SQLite
```

若本地缺失且场景允许：

```text
KnowledgeRepository
  -> SyncEngine.triggerPull()
  -> LocalRepository re-query
```

### 原因

- 减少 UI 受网络波动影响
- 与离线策略一致
- 保持查询性能稳定

## 8.2 写路径

写流程建议固定为：

```text
UI / Command
  -> KnowledgeRepository
    -> LocalRepository.transaction()
      -> 更新本地镜像
      -> 写入 sync_outbox
    -> SyncEngine.triggerPush()
```

### 原则

- 页面提交成功的定义，是本地已提交并进入待同步状态
- 远端确认成功后再把 outbox 置为已同步
- 冲突时保留本地草稿和服务端版本引用

## 8.3 什么时候允许直接远端读取

第一阶段仅以下数据可考虑直接远端读取：

- 登录会话校验
- 工作区列表
- 附件下载 URL
- 明确不需要本地长期缓存的临时资源

核心知识实体不建议每次直接远端读取。

---

## 9. DTO 与领域模型映射

## 9.1 必须分三层模型

客户端建议始终明确区分：

- `API DTO`
- `Local DB Row`
- `Domain Model`

### 原因

- 服务端字段可能使用 `camelCase`
- 本地 `SQLite` 可保持更适合索引和事务的结构
- UI 需要的是稳定、可演进的领域对象

## 9.2 推荐映射路径

```text
Remote API JSON
  -> DTO Mapper
    -> Domain Model
      -> Local Row Mapper
        -> SQLite
```

或反向：

```text
SQLite Row
  -> Domain Mapper
    -> UI ViewModel
```

## 9.3 不建议的做法

- 不要把 HTTP 响应直接存进 Zustand
- 不要把 SQLite row 直接返回给页面
- 不要把路径兼容字段渗透进所有领域类型

---

## 10. Electron 进程边界

## 10.1 推荐分工

### Renderer 负责

- 交互
- ViewModel
- Application Services
- Repository Facade 组合
- 同步状态展示

### Main Process 负责

- `SQLite` 连接和事务
- 文件缓存目录管理
- 附件副本读写
- 系统文件打开与 Finder 显示
- 迁移导入扫描

## 10.2 为什么 SQLite 更适合放主进程

原因包括：

- 减少 Renderer 直接持有数据库句柄
- 更容易复用现有 IPC 安全边界
- 便于串行化事务和文件 IO
- 更符合 Electron 权限分离原则

## 10.3 推荐的 IPC 服务

建议在主进程拆出几组明确的 handler：

- `localdb:*`
- `filecache:*`
- `desktop:*`
- `import:*`
- `sync-debug:*`

其中 Renderer 不应直接看到裸 SQL，只消费服务方法。

---

## 11. 与 Zustand 的关系

## 11.1 Zustand 不应变成主数据源

未来 Zustand 主要承接：

- 当前选中的工作区、卡片、文档
- 当前同步状态展示
- 视图级排序、筛选和面板开关
- 临时编辑态和乐观 UI 状态

不应把 Zustand 用作：

- 核心实体真相源
- 同步队列存储
- 冲突持久化存储

## 11.2 推荐模式

建议采用：

- Repository 提供查询和命令
- Zustand 存查询结果与 UI 派生态
- `SyncEngine` 事件驱动刷新相关 query

## 11.3 当前 `workspaceStore` 的演进建议

当前 `workspaceStore` 的核心字段是：

- `view`
- `currentWorkDir`
- `skipAutoLoad`

后续建议演进为：

- `currentWorkspaceId`
- `currentWorkspaceLocalHint`
- `currentUserId`
- `view`
- `skipAutoLoad`

其中 `currentWorkDir` 不应继续作为主工作区身份。

---

## 12. 与现有 `useStorage()` 的过渡方案

## 12.1 过渡目标

尽量减少页面层一次性大改，建议分三步走：

### 阶段 A：保留旧入口，改内部结构

- `useStorage()` 继续存在
- 内部从 `createFileStorageBackend()` 迁移到 `createAppRepositoryFacade()`
- 旧页面仍可通过兼容 API 工作

### 阶段 B：新增领域化 API

- 新页面优先调用 `storage.knowledge.*`
- 旧的 `storage.createCard(cardPath, ...)` 逐步废弃
- 引入 ID 模型

### 阶段 C：删除路径主语义

- 删除大部分 `kbPath / cardPath / roomPath` 型公开方法
- 仅迁移/导入模块保留 `LegacyWorkdirAdapter`

## 12.2 推荐兼容层

过渡期可以增加一层：

```ts
interface LegacyCompatibleStorageApi {
  listKBs(): Promise<LegacyKBListItem[]>
  listCards(kbPath: string): Promise<LegacyCardInfo[]>
  readLayout(roomPath: string): Promise<LegacyGraphMeta>
}
```

但必须明确：

- 只给未改造模块使用
- 新功能不得继续建立在这层之上
- 每个方法都要有淘汰时间表

---

## 13. `SyncEngine` 详细职责

## 13.1 启动时机

建议 `SyncEngine` 在以下条件满足后启动：

- 用户已登录
- 已选定 `workspaceId`
- 本地数据库可用
- 已完成必要的 bootstrap 或缓存检查

## 13.2 典型循环

推荐同步循环如下：

1. 读取本地 `sync_cursor` 与待同步 outbox  
2. 如有待发项，先执行 `push` 或 `push-batch`  
3. 将成功写入结果回写本地镜像与 outbox 状态  
4. 再执行 `pull` 拉取服务端新增事件  
5. 把事件应用到本地镜像并推进游标  
6. 更新同步状态  

## 13.3 冲突处理

`SyncEngine` 检测到冲突时应：

- 记录 `sync_conflicts`
- 保留本地未合并草稿或原始 payload
- 标记相关实体有冲突
- 让应用层决定是否弹出冲突 UI

不建议 `SyncEngine` 自己直接弹窗。

## 13.4 重试与退避

第一阶段建议：

- 网络错误可自动重试
- `429/5xx` 使用指数退避
- `401` 先触发鉴权刷新
- `409 VERSION_CONFLICT` 不自动暴力重试

## 13.5 可观测性

建议 `SyncEngine` 暴露：

- 当前状态
- 最近成功 `pull/push` 时间
- outbox 待处理数
- 最近错误码
- 最近冲突数

这些状态适合用于顶部状态条、调试面板和日志上报。

---

## 14. 附件链路在 Repository 层的落点

## 14.1 为什么附件必须单独建模

附件横跨：

- 元数据实体
- 对象存储传输
- 本地文件缓存
- 桌面端打开能力

如果把附件继续当成普通 `StorageBackend` 方法集合的一部分，后期会非常混乱。

## 14.2 推荐链路

```text
UI
  -> AttachmentRepository.queueImport()
    -> DesktopBridge.select/open local file
    -> AttachmentTransferService.requestUploadTicket()
    -> upload bytes to object storage
    -> AttachmentTransferService.commit()
    -> LocalRepository.upsert attachment metadata
    -> SyncEngine / or direct event apply
```

## 14.3 本地打开流程

```text
UI
  -> AttachmentRepository.ensureLocalFile()
    -> FileCacheService.check cache
    -> if miss: request download url
    -> download to local cache
    -> DesktopBridge.openLocalFile()
```

---

## 15. 导入与迁移链路

## 15.1 导入器放在哪

旧本地工作目录导入器不建议塞进 `KnowledgeRepository`。  
更合适的归属是：

- `LegacyWorkdirAdapter`
- `ImportService`
- `DesktopBridge`

### 原因

- 导入器本质上是特殊数据源，不是日常读写接口
- 它需要目录扫描、预览、映射和批量提交
- 生命周期是阶段性而非长期在线

## 15.2 推荐导入流程

```text
选择旧工作目录
  -> LegacyWorkdirAdapter.scan()
  -> 生成 ImportPreview
  -> 用户确认
  -> ImportService 分批写入 LocalRepository / Sync outbox
  -> SyncEngine 逐步推送远端
```

## 15.3 为什么不建议导入器直接写远端

- 无法自然复用本地 outbox 与失败恢复
- 大目录导入时断网恢复体验差
- 难以复用统一冲突和幂等逻辑

---

## 16. 推荐目录结构

第一阶段可以考虑整理为如下结构：

```text
src/
  application/
    auth/
    workspace/
    knowledge/
    attachments/
    sync/
  domain/
    entities/
    repositories/
    sync/
  infrastructure/
    api/
    localdb/
    file-cache/
    desktop/
    legacy-import/
    mappers/
  core/
    storage/
```

### 说明

- `application/` 放 use case 和组合流程
- `domain/` 放领域类型和 repository interface
- `infrastructure/` 放具体实现
- `core/storage/` 可作为过渡外观层保留

---

## 17. 第一阶段实现建议

## 17.1 优先级排序

建议按下面顺序落地：

1. 先定义领域 ID 和 Repository 接口  
2. 再引入 `LocalRepository + SQLite`  
3. 再做 `SyncRepository + SyncEngine`  
4. 再接入 `AttachmentRepository`  
5. 最后逐步下线旧 `StorageBackend` 路径 API  

## 17.2 最先值得改的代码点

结合当前代码现状，优先建议从以下位置开始：

- `src/core/storage/types.ts`
- `src/core/storage/service.ts`
- `src/core/storage/context.tsx`
- `src/stores/workspaceStore.ts`
- 仍然深度依赖 `kbPath / roomPath` 的 tab 与 graph 状态模块

## 17.3 第一批可以接受的折中

第一阶段可以接受：

- Facade 外层仍保留旧命名
- 路径到 ID 映射暂时双存
- 少量页面仍消费兼容接口

但不能接受：

- 新功能继续新增 `cardPath` 型 API
- 同步逻辑散落在组件里临时实现
- 让 SQLite row 直接冒泡到 UI

---

## 18. 风险与权衡

## 18.1 当前方案的优点

- 能复用现有统一入口，降低改造成本
- 能把本地镜像、远端 API 和桌面能力清晰拆层
- 与前面的同步协议、本地缓存、附件策略文档一致
- 便于渐进式替换而不是重写整个前端

## 18.2 代价

- 需要额外维护 DTO、Row、Domain 三层映射
- 代码模块数会明显增加
- 过渡期同时存在新旧两套接口会有学习成本

## 18.3 最大风险

- 只改类名不改身份模型
- Repository 名义上拆分，实际上页面继续直连实现细节
- `SyncEngine` 被写成若干页面 hook 的拼接物
- 过渡兼容层长期不删除

---

## 19. 未决问题

正式进入实现前，仍需确认以下问题：

1. `SQLite` 具体采用哪套 Electron 侧库与事务封装  
2. Repository 接口放在 `domain/` 还是 `application/`  
3. `SyncEngine` 驻留 Renderer 还是通过主进程托管  
4. 附件大文件上传是否完全放主进程执行  
5. 旧 tab / graph 状态从路径切到 ID 的切换顺序  
6. 学习统计最终归类为账号级、工作区级还是设备级  
7. 是否需要单独的 `DocumentRepository` 与 `GraphRepository` 进一步细分  

---

## 20. 最终建议

TopoMind 客户端仓储层重构最重要的不是“把 `StorageBackend` 改名成 Repository”，而是：

- 用稳定 ID 替代路径身份
- 用本地镜像承接离线与查询
- 用同步引擎承接远端收敛
- 用桌面桥接承接受控系统能力
- 用统一 Facade 平滑过渡现有页面

一句话概括：

> 保留 `useStorage()` 作为表层入口，但把它背后真正替换成 `Repository Facade + LocalRepository + SyncRepository + AttachmentRepository + SyncEngine + DesktopBridge`，TopoMind 的客户端才算真正从“本地文件应用”走向“云同步桌面应用”。

---

## 21. 后续文档建议

在本文档基础上，建议继续拆出以下实施文档：

- `spec/cloud-storage-refactor/server-sync-service-implementation-plan.md`
- `spec/cloud-storage-refactor/sqlite-schema-and-main-process-storage-plan.md`
- `spec/cloud-storage-refactor/legacy-workdir-importer-implementation-plan.md`
- `spec/cloud-storage-refactor/client-state-store-refactor-plan.md`

这些文档可继续细化：

- 同步引擎执行细节
- 本地数据库与主进程服务
- 导入器实现
- Zustand 状态和页面层改造顺序
