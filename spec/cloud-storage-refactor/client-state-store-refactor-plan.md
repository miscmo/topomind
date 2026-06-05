# TopoMind 客户端 State Store 重构方案

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：前端状态层设计 / Zustand 改造计划 / ViewModel 实施草案  
**创建时间**：2026-06-05  
**当前状态**：初稿完成，待结合页面改造顺序细化  
**依赖文档**：
- `spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md`
- `spec/cloud-storage-refactor/client-repository-layer-design.md`
- `spec/cloud-storage-refactor/sqlite-schema-and-main-process-storage-plan.md`
- `spec/cloud-storage-refactor/server-sync-service-implementation-plan.md`
- `spec/cloud-storage-refactor/local-cache-and-offline-strategy.md`
**维护规则**：当前端状态模型、Repository Facade、同步状态表达、工作区身份模型或页面导航结构发生变化时，必须同步更新本文档中的 store 拆分原则、迁移批次、状态归属和兼容策略。

---

## 1. 文档目标

本文档用于把 TopoMind 云同步改造中的“前端状态层”从现有 Zustand 结构继续细化为可实施重构方案，重点回答以下问题：

- 现有哪些 store 仍可保留，哪些必须重构
- `currentWorkDir / kbPath / roomPath` 这类路径状态应如何逐步退出主模型
- UI 状态、查询结果、同步状态、设备状态应如何分层
- Repository Facade、SyncEngine 和 Zustand 之间应如何配合
- 哪些页面适合继续用 store，哪些应改为 query + view model
- 如何在不一次性推翻现有前端的前提下完成迁移

本文档默认适用范围为：

- React Renderer
- Zustand 为主状态层
- Electron 桌面端优先
- 第一阶段不做多人实时协作

---

## 2. 设计摘要

### 2.1 最终结论

TopoMind 前端状态层不应继续让 Zustand 同时承担：

- 业务真相源
- 路径身份模型
- 页面导航
- 同步状态机
- 本地文件语义

更合理的结构应改为：

```text
Repository Facade / SyncEngine
  -> Queries / Commands / ViewModel Hooks
    -> Zustand UI Stores
      -> React Components
```

其中：

- 核心业务数据真相来自 `Repository Facade`
- Zustand 主要承接 UI 交互态、页面会话态和轻量派生态
- 同步状态来自 `SyncEngine`
- 工作区和实体身份统一切到稳定 ID

### 2.2 核心原则

前端状态层重构建议遵守以下纪律：

1. Zustand 不再作为核心业务实体真相源  
2. 页面不直接长期保存 `kbPath / cardPath / roomPath` 作为主身份  
3. 查询结果应来自 Repository，不应由页面手工拼装缓存  
4. 同步状态应来自统一 `SyncEngine`，不要散落在多个 store  
5. 设备级状态、工作区级状态、实体级状态要明确分开  
6. 新增功能不得继续扩张旧路径驱动 store  

### 2.3 第一阶段目标

第一阶段状态层改造要确保：

1. 可以从 `currentWorkDir` 平滑过渡到 `currentWorkspaceId`  
2. tab / graph / detail / learning 等核心 UI 流程仍能正常工作  
3. 旧页面能逐步接入 Repository Facade，而不是一次性重写  
4. 同步状态、离线状态和冲突状态可稳定在 UI 中表达  

---

## 3. 当前状态层基线

## 3.1 当前主要 store

从当前代码看，前端状态主要分布在以下几类 store：

- `workspaceStore`
- `tabStore`
- `graphStore`
- `graphUiStore`
- `themeStore`
- 右侧面板相关 store
- 学习统计相关 store
- 监控页相关 store

## 3.2 当前已有优点

当前 Zustand 体系并不是完全不可复用，它已经具备：

- UI 状态集中存放
- tab 导航模型较清晰
- graph 局部编辑态独立于全局 store
- 一些 store 已只承担页面交互，不直接做 IO

这些优点意味着重构可以走“重划边界”而不是“全部推翻”。

## 3.3 当前最大问题

当前最大问题不是 Zustand 本身，而是状态语义混杂：

- 工作区身份仍主要表达为 `currentWorkDir`
- tab 与 graph session 深度绑定 `kbPath / roomPath`
- 学习统计上下文直接从 tab 和路径状态推导业务语义
- 页面状态和领域身份状态混在一起
- 一些逻辑默认“本地目录存在且路径稳定”

---

## 4. 当前关键耦合点

## 4.1 `workspaceStore`

当前 [workspaceStore.ts](file:///Users/lhg/Documents/topomind/src/stores/workspaceStore.ts) 的核心字段非常简单：

- `view`
- `currentWorkDir`
- `skipAutoLoad`

### 问题

- `currentWorkDir` 同时承担工作区选择和本地目录身份
- 不足以表达当前用户、当前工作区 ID、登录状态、同步状态
- 未来一旦进入云同步，多设备同一工作区不应再由目录路径定义

## 4.2 `tabStore`

当前 [tabTypes.ts](file:///Users/lhg/Documents/topomind/src/stores/tabs/tabTypes.ts) 中多个核心类型直接把路径作为会话身份：

- `RoomTarget.path`
- `RoomTarget.kbPath`
- `GraphSession.kbPath`
- `GraphSession.roomPath`
- `KBTab.kbPath`
- `KBTab.currentRoomPath`

### 问题

- tab 的“打开哪个知识库 / 房间”语义仍是路径驱动
- room history 也天然依赖路径稳定
- 一旦 KB 重命名、迁移导入、或服务端分配稳定 ID，就很难保持一致

## 4.3 `graphStore`

当前 [graphStore.tsx](file:///Users/lhg/Documents/topomind/src/stores/graphStore.tsx) 主要保存：

- `nodes`
- `edges`
- `viewport`
- undo/redo 历史

### 评价

这是现有状态层里相对健康的一块：

- 它主要表达编辑会话态
- 不直接持有路径身份
- 适合继续作为局部 UI/editing store 保留

### 仍需注意

- 图谱数据来源应逐步改为 `KnowledgeRepository + LocalRepository`
- `graphStore` 不应自己演变成长期业务真相源

## 4.4 学习统计上下文

当前 [learningTrackerContextStore.ts](file:///Users/lhg/Documents/topomind/src/features/learning-tracker/model/learningTrackerContextStore.ts) 里明显存在路径耦合：

- `LearningSessionContext.kbPath`
- `LearningSessionContext.roomPath`
- 通过 `graphSession.kbPath / roomPath` 推导页面上下文

### 问题

- 学习统计语义被绑定在旧路径模型上
- 同一实体跨设备或迁移后难以稳定聚合
- 后续若统计要部分同步到账户级，路径标签会变得脆弱

## 4.5 右侧详情面板与文档会话

当前 detail / right-panel 相关逻辑和 tab、node、document path 有较强联动。  
它们未必是最先重构的，但要注意：

- 文档身份应逐步切到 `documentId`
- “当前打开的详情面板”属于 UI 态
- “文档正文和附件列表”属于 Repository 查询结果

---

## 5. 目标状态分层

## 5.1 建议分成四类状态

未来前端状态建议分为四类：

1. 会话与身份状态  
2. UI 导航与交互状态  
3. 查询结果与 ViewModel 状态  
4. 同步与系统状态  

## 5.2 会话与身份状态

这类状态应表达：

- 当前用户
- 当前工作区
- 当前设备会话
- 当前登录与初始化阶段

### 推荐字段示例

- `currentUserId`
- `currentWorkspaceId`
- `currentWorkspaceLocalHint`
- `appView`
- `skipAutoLoad`

## 5.3 UI 导航与交互状态

这类状态包括：

- 当前 tab
- 面板开关
- 当前选中节点
- 局部编辑器展开态
- 页面级筛选条件

### 原则

- 属于用户界面的临时或半持久状态
- 不应混入服务端真相字段

## 5.4 查询结果与 ViewModel 状态

这类状态不建议由手写 store 长期做真相缓存，而应来自：

- Repository 查询
- Hook 层映射
- 轻量 memo / derived selectors

### 示例

- 当前知识库列表
- 当前卡片子节点列表
- 当前文档摘要列表
- 当前附件列表

## 5.5 同步与系统状态

这类状态应主要来自 `SyncEngine` 和平台层：

- 是否离线
- 当前同步阶段
- 待推送数量
- 冲突数量
- 最近错误码

### 原则

- 应统一来源
- 不要每个页面自己维护一套同步 loading

---

## 6. 推荐 store 重构结构

## 6.1 保留并重构的 store

建议保留但重构语义的 store：

- `workspaceStore`
- `tabStore`
- 学习统计上下文 store
- 右侧面板相关 store

## 6.2 基本可保留的 store

以下 store 基本可以保留现有角色，只需要调整数据来源：

- `graphStore`
- `graphUiStore`
- `themeStore`
- 监控页轻量 UI store

## 6.3 建议新增的 store

建议新增更清晰的状态入口：

- `sessionStore`
- `syncStatusStore`
- `workspaceNavigationStore` 或作为新 `workspaceStore` 的扩展

### 说明

是否新增文件名可按实际代码风格定，但语义上这些状态需要被拆出来。

---

## 7. `workspaceStore` 重构方案

## 7.1 当前问题

当前 `workspaceStore` 过于轻量，且关键字段是 `currentWorkDir`。

## 7.2 目标模型

建议演进为：

```ts
interface WorkspaceSessionStore {
  appView: AppView
  currentUserId: string | null
  currentWorkspaceId: string | null
  currentWorkspaceLocalHint: string | null
  skipAutoLoad: boolean
  bootstrapStatus: 'idle' | 'loading' | 'ready' | 'error'
}
```

## 7.3 字段说明

- `currentWorkspaceId`：真正的工作区身份
- `currentWorkspaceLocalHint`：仅用于迁移或导入兼容的本地目录提示
- `bootstrapStatus`：表达当前工作区是否已完成初始化

## 7.4 迁移策略

第一阶段可以短期双存：

- `currentWorkDir`
- `currentWorkspaceId`

但要明确：

- `currentWorkspaceId` 才是未来主身份
- 新代码优先消费 `currentWorkspaceId`

---

## 8. `tabStore` 重构方案

## 8.1 当前问题

当前 tab 模型把知识库和房间理解为路径：

- `kbPath`
- `currentRoomPath`
- `roomHistory.path`

## 8.2 目标模型

未来建议切为 ID 驱动：

```ts
interface WorkspaceTab {
  id: string
  type: 'workspace'
  label: string
  workspaceId: string
  kbId: string | null
  currentCardId: string | null
  roomHistory: Array<{
    cardId: string
    cardName: string
  }>
}
```

### 说明

- “房间”本质上是当前聚焦的 card/graph context
- tab 需要记的是实体身份，不是目录路径

## 8.3 过渡期兼容

过渡期可以临时双存：

- `kbPath` 与 `kbId`
- `roomPath` 与 `cardId`

但应作为兼容层存在，不作为新 API 主语义。

## 8.4 推荐拆分

当前 `tabStore` 可以继续保留，但建议分离两层职责：

- tab 生命周期与导航
- 当前 graph/document 上下文选择

### 原因

- 避免一个 store 同时承载太多领域语义
- 方便独立迁移 room history 和 document session

## 8.5 事件来源

tab 的 label、当前房间名称等显示信息，不应成为主身份。  
它们应来自：

- Repository 查询结果
- 或 tab 打开时缓存的一份展示快照

---

## 9. 图谱与编辑会话状态

## 9.1 `graphStore` 的长期定位

`graphStore` 适合作为：

- 图编辑器当前会话态
- undo/redo 缓冲
- 视口状态
- 局部选择态

## 9.2 不应承担的职责

`graphStore` 不应承担：

- 持久化真相源
- 同步队列状态
- 工作区导航身份

## 9.3 推荐调用链

建议图页采用：

```text
GraphPage
  -> useGraphPageQuery(cardId)
    -> KnowledgeRepository.getGraphLayout(cardId)
  -> hydrate graphStore
  -> user edit
  -> command -> KnowledgeRepository.saveGraphLayout(...)
```

### 关键点

- `graphStore` 只保存当前打开图页的编辑会话
- 真正保存时仍走 Repository

## 9.4 多 tab 图会话

若未来一个 tab 对应一个独立 graph store 实例，这个方向仍然成立。  
关键不在“是否多实例”，而在：

- 不要让 store 自己成为业务真相

---

## 10. 学习统计与上下文状态

## 10.1 当前问题

学习统计上下文目前明显依赖：

- `currentWorkDir`
- `kbPath`
- `roomPath`

这会让统计语义继续被旧目录模型污染。

## 10.2 推荐目标

学习上下文应逐步改为：

- `workspaceId`
- `kbId`
- `cardId`
- `documentId`
- `tabId`
- `pageType`

## 10.3 兼容策略

第一阶段允许 analytics 层保留“显示名称”维度，但底层 identity 应改成 ID。  
例如：

- 聚合键：`kbId`
- 展示标签：`kbName`

## 10.4 学习统计 store 的角色

学习统计 store 更适合保存：

- 当前会话临时累积
- 本地 flush 节奏
- 当前上下文快照

而不应自己解析复杂业务路径模型。

---

## 11. 右侧面板与文档相关状态

## 11.1 建议保留为 UI store

右侧面板开关、当前 tab、当前详情页选择等，仍适合用 Zustand 保存。  
因为它们是典型 UI 状态。

## 11.2 建议去路径化的部分

以下身份字段应逐步切换：

- `activeDocumentPath` -> `activeDocumentId`
- `nodeId + path` 组合 -> `cardId/documentId`

## 11.3 数据来源重构

面板展示的正文、附件、摘要、冲突提示应来自：

- Repository 查询
- Sync status store

而不是靠 UI store 自己缓存一份完整业务数据。

---

## 12. `SyncEngine` 与状态层的关系

## 12.1 为什么需要单独同步状态入口

如果每个页面自己维护：

- 是否同步中
- 是否离线
- 是否冲突
- 是否有待推送

最终会导致状态分裂。

## 12.2 推荐 `syncStatusStore`

建议新增一层统一同步状态 store，例如：

```ts
interface SyncStatusStore {
  status: 'idle' | 'bootstrapping' | 'pulling' | 'pushing' | 'offline' | 'error'
  pendingOutboxCount: number
  conflictCount: number
  lastSyncAt: string | null
  lastErrorCode: string | null
}
```

## 12.3 数据来源

这个 store 不自己发请求，而是订阅：

- `SyncEngine.subscribe()`
- 网络状态变化
- Repository 侧冲突统计

## 12.4 UI 使用方式

适合用于：

- 顶部同步状态条
- 设置页同步诊断
- 冲突入口徽标
- 离线提示

---

## 13. 查询与 ViewModel 层建议

## 13.1 为什么不能全靠 store

若所有列表、详情、布局、附件都继续靠 Zustand 手工维护，会出现：

- 缓存失效困难
- 与 Repository 边界不清
- 同步更新时页面刷新逻辑混乱

## 13.2 推荐模式

建议逐步改为：

- Repository 提供 query/command
- Hook 负责调用和映射 ViewModel
- Zustand 只保存必要 UI 会话态

### 示例

```text
useWorkspaceSummary()
useKnowledgeBaseList(workspaceId)
useCardChildren(parentCardId)
useDocumentList(cardId)
useAttachmentList(cardId)
```

## 13.3 查询缓存策略

第一阶段不一定必须引入专门 query 库，但至少要遵守语义分层：

- Repository 是数据源
- Hook 是消费入口
- store 不是任意业务列表的长期真相

---

## 14. 持久化策略

## 14.1 哪些状态适合持久化

适合本地持久化的 UI 状态包括：

- 最近激活 tab
- 面板折叠状态
- 主题
- 最近打开工作区
- 一些页面筛选条件

## 14.2 哪些状态不应持久化

不建议持久化：

- 大型业务实体快照
- 同步 outbox 结果副本
- 短生命请求 loading
- 签名 URL

## 14.3 当前项目的原则

若继续使用 Zustand `persist`，应更严格地区分：

- UI 偏好可持久化
- 业务真相不放进去

---

## 15. 推荐迁移批次

## 15.1 批次一：建立新身份模型

优先完成：

- `workspaceStore` 增加 `currentWorkspaceId`
- tab 模型引入 `kbId / cardId`
- 学习上下文模型引入 `workspaceId / kbId / cardId / documentId`

### 目标

让新旧状态可以双存，但新代码优先消费 ID。

## 15.2 批次二：引入同步状态入口

新增：

- `syncStatusStore`
- `bootstrapStatus`
- 冲突和待推送聚合状态

### 目标

让页面不再各自维护同步 loading 语义。

## 15.3 批次三：查询结果从 Repository 化

逐步把：

- KB 列表
- 卡片列表
- 文档列表
- 附件列表

改为 Repository 驱动查询。

## 15.4 批次四：tab 与 graph 深度去路径化

重点改：

- room history
- graph session
- detail panel document identity

## 15.5 批次五：学习统计与分析层改造

最后改：

- 学习上下文聚合键
- analytics 标签来源
- 本地 flush 与工作区身份的关系

### 原因

这块跨页面多，改得过早容易牵一发而动全身。

---

## 16. 对现有 store 的具体建议

## 16.1 `workspaceStore`

建议：

- 保留文件名
- 重构字段
- 让 `currentWorkDir` 降级为兼容字段

## 16.2 `tabStore`

建议：

- 保留 store 外观
- 引入 ID 模型
- 把 `kbPath / roomPath` 变成兼容字段或映射字段

## 16.3 `graphStore`

建议：

- 基本保留
- 将数据 hydrate/save 入口切到 Repository

## 16.4 学习统计 context store

建议：

- 优先改上下文 identity
- 先不急着改所有报表 UI

## 16.5 `themeStore`

建议：

- 原样保留

### 原因

- 它是纯 UI 偏好
- 和云同步主链路耦合低

---

## 17. 推荐类型演进方向

## 17.1 当前路径类型的问题

像当前这些类型未来都应逐步退出主接口：

- `kbPath`
- `roomPath`
- `RoomTarget.path`
- `GraphSession.kbPath`

## 17.2 推荐领域身份类型

建议逐步建立：

```ts
type WorkspaceId = string
type KnowledgeBaseId = string
type CardId = string
type DocumentId = string
type AttachmentId = string
```

## 17.3 推荐导航上下文类型

```ts
interface NavigationContext {
  workspaceId: WorkspaceId
  kbId?: KnowledgeBaseId | null
  cardId?: CardId | null
  documentId?: DocumentId | null
  tabId?: string
}
```

### 价值

- 页面间传递上下文更稳定
- 不再依赖路径字符串拼接

---

## 18. 风险与权衡

## 18.1 当前方案的优点

- 可以复用现有 Zustand 体系，而不是完全换栈
- 能与 Repository Facade、SyncEngine 和本地 SQLite 设计自然接上
- 可以按 store 分批迁移，风险相对可控
- 能逐步把路径模型从 UI 状态里清出去

## 18.2 代价

- 过渡期会同时存在路径字段和 ID 字段
- 需要写一段时间映射层和兼容逻辑
- 某些页面 hook 会先变复杂一些

## 18.3 最大风险

- 只在文档里说去路径化，代码里继续新增 `kbPath` 字段
- 把 Repository 查询结果又原样塞回大型 store 里
- 同步状态继续被拆散到多个页面各自维护
- tab 和学习统计长期停留在路径语义上

---

## 19. 未决问题

正式进入实现前，仍需确认以下问题：

1. 是否引入专门 query 层库，还是先保留手写 hook  
2. tab 是否继续按现有结构保留单 store，还是拆成 navigation + session 两层  
3. graph store 是否要做到每 tab 一实例  
4. 学习统计最终是否同步到账户级  
5. detail panel 的文档选择是否先从 path 改为 `documentId`  
6. 旧工作目录兼容期预计持续多久  
7. 是否需要单独的 `sessionStore` 文件而不是继续扩展 `workspaceStore`  

---

## 20. 最终建议

TopoMind 前端状态层重构最重要的不是“多写几个 store”，而是：

- 让 Zustand 回到 UI 状态与会话状态本职
- 让 Repository 成为业务数据入口
- 让 `SyncEngine` 成为同步状态唯一来源
- 让 ID 取代路径成为导航和上下文主身份

一句话概括：

> 保留现有 Zustand 作为前端交互骨架，但把 `workspaceStore / tabStore / learning context` 等关键状态逐步改造成以 `workspaceId + kbId + cardId + documentId` 为核心的 ViewModel 层，TopoMind 才能真正把云同步数据层接进现有 UI。

---

## 21. 后续文档建议

在本文档基础上，建议继续拆出以下实施文档：

- `spec/cloud-storage-refactor/legacy-workdir-importer-implementation-plan.md`
- `spec/cloud-storage-refactor/sync-observability-and-debug-panel-plan.md`
- `spec/cloud-storage-refactor/auth-and-workspace-membership-plan.md`
- `spec/cloud-storage-refactor/query-hook-and-viewmodel-guidelines.md`

这些文档可继续细化：

- 旧工作目录导入器
- 同步调试与状态面板
- 鉴权和工作区访问控制
- Repository query hook 编写规范
