# TopoMind 旧工作目录导入器实施方案

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：导入器实现设计 / 旧工作目录迁移实施方案 / 桌面端导入链路草案  
**创建时间**：2026-06-05  
**当前状态**：初稿完成，待结合 Electron 主进程实现细化  
**依赖文档**：
- `spec/SPEC.md`
- `spec/cloud-storage-refactor/data-migration-from-local-workdir-plan.md`
- `spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md`
- `spec/cloud-storage-refactor/client-repository-layer-design.md`
- `spec/cloud-storage-refactor/sqlite-schema-and-main-process-storage-plan.md`
- `spec/cloud-storage-refactor/server-sync-service-implementation-plan.md`
**维护规则**：当旧工作目录结构、导入中间模型、主进程 IPC、Markdown 转换策略、附件迁移规则或断点恢复方案发生变化时，必须同步更新本文档中的扫描流程、阶段划分、状态机、失败恢复和报告模型。

---

## 1. 文档目标

本文档用于把 TopoMind 的“旧本地工作目录导入”从总体迁移方案继续细化为可实施导入器设计，重点回答以下问题：

- 导入器应放在客户端哪一层，如何和 `LocalRepository + SyncEngine` 配合
- 扫描器、解析器、预览模型、导入执行器应如何拆分
- 当前 Electron 里的 `importKB` 本地复制能力如何演进成真正的云端导入器
- 路径到稳定 ID 的映射如何保存
- 导入任务如何支持分阶段、可恢复、可报告
- Markdown、布局、边、附件在实现层分别怎么处理

本文档默认适用范围为：

- Electron 桌面端
- 单用户导入自己的旧工作目录
- 第一阶段目标是导入到云端工作区模型
- 第一阶段不做旧目录与云端的长期双向同步

---

## 2. 设计摘要

### 2.1 最终结论

TopoMind 的旧工作目录导入器不应实现成“选一个目录然后直接上传”，而应拆成以下链路：

```text
选择旧工作目录
  -> WorkdirScanner
  -> ParsedWorkspace / ImportPreview
  -> ImportJobPlanner
  -> ImportExecutor
    -> LocalRepository
    -> AttachmentTransfer
    -> SyncEngine
  -> ImportReport
```

### 2.2 核心原则

导入器实现建议坚持以下纪律：

1. 先扫描和建模，再写入目标工作区  
2. 先导入结构化实体，再导入附件  
3. 路径只作为兼容与审计信息保留  
4. 导入状态必须可持久化、可恢复、可重试  
5. 导入器应优先复用 `LocalRepository + SyncEngine`，不要旁路写入一套独立缓存  
6. 原始旧目录默认只读，不在导入过程中原地改写  

### 2.3 第一阶段目标

第一阶段导入器要确保：

1. 用户可以选择旧工作目录并看到结构化导入预览  
2. 导入过程可以分阶段执行，并显示当前阶段与进度  
3. 结构化实体导入失败时容易定位和恢复  
4. 附件导入失败不阻断整个知识结构落地  
5. 导入完成后可直接进入正常同步模式  

### 2.4 第一阶段不做

- 不做旧目录文件监听增量同步
- 不做导入期间对原 Markdown 的激进重写
- 不做跨多个旧工作目录的合并导入
- 不做云端导入和本地目录双主并存
- 不做复杂自动冲突合并

---

## 3. 当前基线与差距

## 3.1 旧工作目录的真实结构

根据 [SPEC.md](file:///Users/lhg/Documents/topomind/spec/SPEC.md)，当前旧模型的关键结构包括：

- 根 `_config.json`
- `kbs/`
- 每个 KB 或卡片目录的 `_graph.json`
- 每个卡片目录的 `README.md`
- 每个卡片目录下的 `_attach/`

### 关键事实

- `children` key 已有稳定 ID 倾向
- 目录结构强绑定层级语义
- `_graph.json` 同时承载层级、布局、边
- 文档和附件仍偏文件系统模型

## 3.2 当前代码已有导入能力

当前 Electron 中已经存在一个 [importKB](file:///Users/lhg/Documents/topomind/electron/services/kb-service.js#L98-L150) 能力，但它的本质是：

- 校验源目录是否有 `_graph.json`
- 把目录递归复制到当前工作目录下的 `kbs/`

### 这意味着它目前只解决了

- 从一个目录复制知识库目录
- 保留旧本地文件结构

### 它没有解决

- 建立云端实体模型
- 结构化预览
- 路径到 ID 映射
- 分阶段导入
- 导入恢复与报告
- 与本地 `SQLite` 和远端同步的衔接

## 3.3 目标差距

因此未来的 `LegacyWorkdirImporter` 不是升级版 `copyDirRecursive`，而是一个真正的导入流水线。

---

## 4. 导入器在整体架构中的位置

## 4.1 推荐位置

导入器建议放在桌面端主进程能力层，归类为：

- `LegacyWorkdirAdapter`
- `ImportService`
- `import:*` IPC

## 4.2 为什么不放页面层

原因包括：

- 扫描目录和读取大量文件更适合主进程
- 需要访问文件系统和可能的大文件附件
- 需要与 `LocalDbService`、`FileCacheService` 协调
- 更容易持久化导入任务状态

## 4.3 为什么不直接只放服务端

第一阶段导入源就在用户本机目录，若完全下沉服务端会导致：

- 服务端无法直接访问本地文件
- 大量文件必须先打包上传
- 本地预览与校验变差

更合理的路线是：

- 解析和预览在桌面端
- 结构化导入优先通过本地镜像与同步体系进入云端

---

## 5. 模块拆分建议

## 5.1 推荐模块

第一阶段建议拆出以下导入器模块：

- `WorkdirScanner`
- `WorkdirParser`
- `ImportPreviewBuilder`
- `ImportPlanner`
- `ImportExecutor`
- `ImportCheckpointStore`
- `ImportReportWriter`
- `MarkdownImportAdapter`
- `AttachmentImportCoordinator`

## 5.2 `WorkdirScanner`

### 职责

- 校验工作目录是否合法
- 枚举 KB、卡片目录、文档文件、附件文件
- 收集原始路径、文件大小、mtime、基础结构错误

### 不负责

- 生成最终云端实体
- 直接写入数据库

## 5.3 `WorkdirParser`

### 职责

- 读取 `_config.json`
- 读取 `_graph.json`
- 解析 `README.md`
- 解析 `_attach/`
- 产出 `ParsedWorkspace` 中间模型

## 5.4 `ImportPreviewBuilder`

### 职责

- 基于中间模型产出用户可见导入预览
- 汇总数量、警告、致命错误、可恢复错误
- 呈现路径映射与 ID 复用情况摘要

## 5.5 `ImportPlanner`

### 职责

- 把 `ParsedWorkspace` 转成分阶段执行计划
- 排定导入阶段、批次和依赖顺序
- 生成 checkpoint 粒度

## 5.6 `ImportExecutor`

### 职责

- 真正执行结构化实体导入
- 驱动附件导入
- 写入导入任务状态
- 失败时写 checkpoint 和报告

## 5.7 `ImportCheckpointStore`

### 职责

- 持久化当前导入阶段
- 持久化已完成批次
- 保存路径到 ID 映射
- 支持恢复和跳过已成功步骤

建议落在 `import_jobs` 及对应的本地报告文件中。

---

## 6. 中间模型设计

## 6.1 为什么必须有中间模型

若扫描一个目录就直接导入一次，会带来：

- 校验无法全局完成
- ID 映射难以统一
- 预览无法完整展示
- 恢复点难以定义

因此导入器必须先产出结构化中间模型。

## 6.2 推荐根模型

```ts
interface ParsedWorkspace {
  legacyRootPath: string
  fingerprint: string
  config: ParsedWorkspaceConfig | null
  kbs: ParsedKnowledgeBase[]
  cardsById: Record<string, ParsedCard>
  attachments: ParsedAttachment[]
  warnings: ImportWarning[]
  fatalErrors: ImportError[]
}
```

## 6.3 `ParsedKnowledgeBase`

```ts
interface ParsedKnowledgeBase {
  legacyPath: string
  kbTempId: string
  kbName: string
  sortOrder: number
  rootCardIds: string[]
  coverCandidatePath?: string | null
}
```

## 6.4 `ParsedCard`

```ts
interface ParsedCard {
  legacyPath: string
  legacyParentPath: string | null
  cardId: string
  kbTempId: string
  parentCardId: string | null
  displayName: string
  childCardIds: string[]
  readmePath: string | null
  graphPath: string | null
  meta: {
    hasGraph: boolean
    hasReadme: boolean
    hasAttachDir: boolean
  }
}
```

## 6.5 `ParsedGraphRoom`

```ts
interface ParsedGraphRoom {
  ownerCardId: string | null
  ownerLegacyPath: string
  graphPath: string
  children: ParsedGraphChild[]
  edges: ParsedGraphEdge[]
  viewport: {
    zoom: number | null
    panX: number | null
    panY: number | null
  }
}
```

## 6.6 `ParsedDocument`

```ts
interface ParsedDocument {
  ownerCardId: string
  legacyPath: string
  documentTempId: string
  title: string
  sourceType: 'readme'
  rawMarkdown: string
  extractedAttachmentRefs: ParsedAttachmentRef[]
}
```

## 6.7 `ParsedAttachment`

```ts
interface ParsedAttachment {
  ownerCardId: string
  legacyPath: string
  fileName: string
  sizeBytes: number
  mimeType: string | null
  sha256?: string | null
  referencedByDocumentTempIds: string[]
}
```

## 6.8 为什么很多字段叫 `TempId`

因为在导入前：

- 有些最终云端 ID 尚未真正创建
- 但执行计划仍需要稳定引用

临时 ID 只在导入流水线内部使用，不应泄露为长期业务主键。

---

## 7. 路径与 ID 映射策略

## 7.1 基本原则

导入器必须同时维护两套信息：

- 目标实体稳定 ID
- 原始旧路径映射

## 7.2 推荐映射表

建议在导入任务上下文中保存：

- `legacyPath -> cardId`
- `legacyPath -> documentTempId`
- `legacyPath -> attachmentTempId`
- `cardId -> legacyPath`

## 7.3 卡片 ID 复用策略

若 `_graph.json.children` key 合法且稳定，建议优先复用为：

- `card.id`

### 不复用的情况

- key 缺失
- key 重复
- key 非法或与其他卡片冲突

此时应：

- 生成新 ID
- 在报告里记录“旧 key 未复用”

## 7.4 路径字段保留位置

建议保留在：

- 导入任务报告
- 实体 `meta_json` 的兼容字段
- 附件迁移来源字段

### 不建议

- 不要把路径放进主键
- 不要让后续同步逻辑继续依赖这些路径

---

## 8. 扫描与解析流程

## 8.1 推荐流程

```text
select workdir
  -> validate workdir
  -> scan root config
  -> scan kbs/
  -> DFS/BFS scan all card dirs
  -> parse _graph.json
  -> parse README.md
  -> scan _attach/
  -> build ParsedWorkspace
```

## 8.2 根目录校验

至少校验：

- `_config.json` 是否存在并可解析
- `kbs/` 是否存在
- 根目录是否不是当前新缓存目录
- 是否不是空目录或明显错误目录

## 8.3 KB 扫描

每个 `kbs/{kb}` 目录至少检查：

- `_graph.json`
- 目录名
- 封面候选文件

## 8.4 卡片扫描策略

建议按目录 DFS 扫描，原因是：

- 更符合现有目录树结构
- 容易同步构建父子关系
- 易于记录 `legacyParentPath`

## 8.5 `_graph.json` 解析策略

建议把 `_graph.json` 解析拆成三步：

1. 解析原始 JSON  
2. 校验 `children / edges / zoom / pan`  
3. 产出 `ParsedGraphRoom`  

### 解析时的注意点

- `children` key 与真实子目录的对位关系可能不完整
- `name` 缺失时要回退目录名
- `source/target` 若指向缺失 child，要记录 warning 或 error

## 8.6 `README.md` 解析策略

建议先读取原始 Markdown，不在扫描阶段做重转换。  
扫描阶段只做：

- 文件存在性检查
- 文本读取
- 基础附件引用提取

## 8.7 `_attach/` 扫描策略

建议对每个卡片目录的 `_attach/` 扫描：

- 文件名
- 大小
- MIME 推断
- 可选哈希
- 与文档引用的关联

---

## 9. 导入预览模型

## 9.1 预览的目标

预览不是把原目录树原样展示，而是告诉用户：

- 将生成多少工作区对象
- 哪些 ID 可复用
- 哪些问题会导致导入不完整
- 附件和文档会如何处理

## 9.2 推荐预览结构

```ts
interface ImportPreview {
  sourcePath: string
  fingerprint: string
  summary: {
    kbCount: number
    cardCount: number
    edgeCount: number
    documentCount: number
    attachmentCount: number
  }
  idReuse: {
    reusedCardIds: number
    regeneratedCardIds: number
  }
  warnings: ImportWarning[]
  fatalErrors: ImportError[]
}
```

## 9.3 预览页建议展示

建议至少展示：

- 源目录路径
- 预估导入出的 KB、卡片、文档、附件数量
- 可恢复问题和致命问题
- 预计将创建的新工作区名称
- 是否建议用户先清理异常后再导入

---

## 10. 导入执行阶段

## 10.1 推荐阶段

建议把导入拆成以下阶段：

1. `scan`
2. `preview`
3. `prepare`
4. `import-structure`
5. `import-documents`
6. `import-attachments`
7. `reconcile`
8. `push`
9. `report`

## 10.2 `prepare`

该阶段主要做：

- 生成导入任务 ID
- 建立目标 `workspaceId`
- 初始化 checkpoint
- 保存映射上下文

## 10.3 `import-structure`

按依赖顺序导入：

- `workspace_config`
- `knowledge_bases`
- `cards`
- `card_edges`
- `graph_layouts`

### 推荐策略

- 写入本地 `LocalRepository`
- 同时写入 outbox
- 不直接由导入器自己拼 HTTP 请求

## 10.4 `import-documents`

该阶段导入：

- 由 `README.md` 转换得到的主文档

### 推荐策略

- 先保存结构化文档记录
- Markdown 保守转换，必要时保留原文块

## 10.5 `import-attachments`

该阶段导入：

- `_attach/` 目录文件
- 封面候选文件
- 文档中的引用附件

### 推荐策略

- 独立于结构化阶段
- 支持部分失败与单项重试

## 10.6 `reconcile`

该阶段主要做：

- 回填 `coverAttachmentId`
- 回填文档中的附件逻辑引用映射
- 汇总实际导入数量

## 10.7 `push`

若目标架构是“本地先落镜像，再同步到云端”，该阶段应：

- 启动或唤醒 `SyncEngine`
- 等待 outbox 逐步推送
- 记录最终远端确认情况

---

## 11. 与 `LocalRepository + SyncEngine` 的衔接

## 11.1 推荐主链路

导入器不应绕过本地镜像层直接构造大量远端请求。  
更合理的路径是：

```text
LegacyWorkdirImporter
  -> LocalRepository.transaction()
  -> 写本地镜像
  -> enqueue sync_outbox
  -> SyncEngine.push()
```

## 11.2 好处

- 复用正常同步主链路
- 失败恢复逻辑统一
- 导入完成后本地缓存天然已经可读
- 更容易与冲突和重试体系对齐

## 11.3 什么时候允许直连远端

第一阶段只有少数能力可考虑直接远端：

- 创建工作区骨架
- 申请附件上传票据
- 特殊服务端迁移任务登记

核心结构化实体导入，仍建议优先走本地镜像和 outbox。

---

## 12. Markdown 导入实现建议

## 12.1 第一阶段策略

第一阶段建议采用保守 Markdown 导入策略：

- 标题、段落、列表做基础结构化
- 无法稳定解析的内容保留原文块
- 图片引用先提取，不急着改写原文本

## 12.2 `MarkdownImportAdapter`

### 职责

- 读取 Markdown 原文
- 提取附件相对引用
- 产出初版 `document.content_json`
- 生成 warning 列表

## 12.3 不建议

- 不要在导入期做高风险富文本归一化
- 不要一次性重写所有 Markdown 引用为下载 URL

---

## 13. 附件导入实现建议

## 13.1 附件分组

建议将附件来源分成：

- `_attach/` 显式附件
- `images/cover_*.png` 一类封面候选
- Markdown 引用发现的相对路径文件

## 13.2 `AttachmentImportCoordinator`

### 职责

- 归并附件来源
- 去重同一路径的重复引用
- 生成附件上传任务
- 记录附件与 card/document 的关联

## 13.3 上传流程

推荐流程：

1. 读取本地文件  
2. 计算基本元信息  
3. 申请 upload ticket  
4. 上传对象本体  
5. `attachments/commit`  
6. 更新本地附件镜像与导入报告  

## 13.4 部分失败策略

附件失败时建议：

- 结构化导入继续完成
- 将失败项记录为 warning 或 failed item
- 支持单独重试附件阶段

---

## 14. Checkpoint 与恢复

## 14.1 为什么必须有 checkpoint

导入可能耗时很长，尤其在：

- 卡片很多
- Markdown 很多
- 附件很多
- 网络不稳定

若没有 checkpoint，任何中断都只能重头开始。

## 14.2 推荐 checkpoint 粒度

建议至少按以下粒度持久化：

- 当前阶段
- 当前批次编号
- 已完成 KB 列表
- 已完成 card/document/attachment 数量
- 路径到 ID 映射
- 失败项列表

## 14.3 恢复策略

恢复时建议：

1. 读取 `import_job`
2. 校验源目录 fingerprint 是否未变化
3. 跳过已确认完成批次
4. 从最近安全阶段继续

## 14.4 什么是“最近安全阶段”

建议以下阶段视为安全断点：

- `prepare`
- `import-structure`
- `import-documents`
- `import-attachments`
- `reconcile`

每个阶段内部再按批次 checkpoint。

---

## 15. 导入任务状态机

## 15.1 推荐状态

建议 `import_jobs.status` 至少包含：

- `pending`
- `running`
- `paused`
- `done`
- `failed`
- `cancelled`

## 15.2 推荐阶段字段

建议 `stage` 至少包含：

- `scan`
- `preview`
- `prepare`
- `import-structure`
- `import-documents`
- `import-attachments`
- `reconcile`
- `push`
- `report`

## 15.3 状态迁移

典型迁移如下：

```text
pending -> running -> done
pending -> running -> failed
running -> paused -> running
running -> cancelled
```

## 15.4 取消语义

第一阶段建议：

- 可取消“未开始的后续批次”
- 已提交批次不强做全局硬回滚

### 原因

- 结构化和附件导入跨多个子流程
- 全局回滚代价高且容易不稳定

---

## 16. UI 与 IPC 设计建议

## 16.1 推荐 IPC

建议基于前文的 `import:*` 分组，至少提供：

- `import:scanLegacyWorkdir`
- `import:createPreview`
- `import:startImportJob`
- `import:getImportJob`
- `import:resumeImportJob`
- `import:cancelImportJob`
- `import:getImportReport`

## 16.2 UI 流程

推荐用户流程：

1. 选择旧工作目录  
2. 查看导入预览  
3. 选择目标工作区或创建新工作区  
4. 确认开始导入  
5. 查看阶段进度与 warning  
6. 导入完成后进入新工作区  

## 16.3 进度展示建议

建议至少展示：

- 当前阶段
- 已扫描/已导入数量
- 当前文件或当前批次
- warning 数量
- 失败项数量

---

## 17. 报告与审计

## 17.1 `ImportReport`

导入完成后建议生成结构化报告，至少包括：

- 源目录路径
- 目录 fingerprint
- 导入开始/结束时间
- 目标 `workspaceId`
- KB / card / edge / document / attachment 数量
- 复用 card ID 数量
- 重新生成 ID 数量
- warning 列表
- failed item 列表

## 17.2 报告保存位置

建议保存两份：

- `import_jobs.summary_json`
- 本地可读报告文件

### 原因

- 便于 UI 快速展示
- 便于用户导出或提交排障信息

## 17.3 审计价值

导入报告应能回答：

- 我导入了多少数据
- 哪些旧路径映射到哪些实体
- 哪些文件没成功导入
- 是否需要手工补救

---

## 18. 与现有 `importKB` 的迁移关系

## 18.1 当前 `importKB` 的定位

当前 [kb-service.js](file:///Users/lhg/Documents/topomind/electron/services/kb-service.js#L98-L150) 里的 `importKB` 更像：

- 本地目录复制工具

而不是：

- 云端工作区导入器

## 18.2 不建议继续扩张它

不建议在原 `importKB` 上继续叠加：

- 结构化解析
- 上传逻辑
- 导入 checkpoint
- 云端实体映射

### 原因

- 它当前语义太偏“拷贝目录”
- 会把旧本地模式和新导入器强行绑在一起

## 18.3 推荐做法

保留 `importKB` 作为旧模式兼容工具。  
新增真正的：

- `LegacyWorkdirImporter`
- `ImportService`

用于云端导入链路。

---

## 19. 推荐实施顺序

## 19.1 第一步

先做只读扫描与预览：

- `WorkdirScanner`
- `WorkdirParser`
- `ImportPreviewBuilder`

## 19.2 第二步

再做结构化导入：

- `workspace_config`
- `knowledge_bases`
- `cards`
- `card_edges`
- `graph_layouts`
- `documents`

## 19.3 第三步

补附件导入与回填：

- `AttachmentImportCoordinator`
- upload ticket
- commit
- 封面回填

## 19.4 第四步

补 checkpoint、恢复和报告：

- `import_jobs`
- `ImportCheckpointStore`
- `ImportReportWriter`

## 19.5 第五步

再补 UI 增强：

- 预览差异展示
- 附件失败单独重试
- 失败项跳转定位

---

## 20. 风险与权衡

## 20.1 当前方案的优点

- 与前面的迁移总方案、本地 SQLite、客户端 repository 和服务端同步文档自然对齐
- 能把导入真正纳入现有同步主链路，而不是旁路
- 更利于做预览、恢复、报告和排障
- 避免把旧路径模型重新升级为新架构主语义

## 20.2 代价

- 实现复杂度明显高于单纯拷贝目录
- 需要维护中间模型、checkpoint 和报告
- 过渡期会同时存在 `importKB` 和新导入器两种能力

## 20.3 最大风险

- 直接边扫描边写远端，导致无法恢复
- 把附件和结构化导入强耦合成单一大事务
- 导入完成后仍让路径继续污染实体身份
- 试图在导入阶段一次性完成高风险 Markdown 重写

---

## 21. 未决问题

正式进入实现前，仍需确认以下问题：

1. 第一阶段是否允许导入到“已存在但空的工作区”  
2. `README.md` 导入采用保守包裹原文还是基础结构化转换  
3. 附件哈希是否在导入时强制计算  
4. `images/cover_*.png` 是否视为普通附件还是独立封面来源  
5. 导入过程中是否允许用户暂停后退出应用  
6. `import_jobs` 只保存在本地还是同步一份到服务端  
7. 旧目录 fingerprint 的具体算法采用什么  

---

## 22. 最终建议

TopoMind 的旧工作目录导入器最重要的不是“能把目录复制过去”，而是：

- 能读懂旧结构
- 能产出可审计的中间模型
- 能通过本地镜像和同步体系稳定落入新架构
- 能在长流程失败时恢复
- 能把路径降级为兼容信息而不是继续当主键

一句话概括：

> 把旧工作目录导入实现成一条 `scan -> preview -> plan -> execute -> checkpoint -> report` 的结构化流水线，并通过 `LocalRepository + SyncEngine` 接入云端模型，TopoMind 才能安全地把现有本地用户迁移到新架构。

---

## 23. 后续文档建议

在本文档基础上，建议继续拆出以下实施文档：

- `spec/cloud-storage-refactor/sync-observability-and-debug-panel-plan.md`
- `spec/cloud-storage-refactor/auth-and-workspace-membership-plan.md`
- `spec/cloud-storage-refactor/query-hook-and-viewmodel-guidelines.md`
- `spec/cloud-storage-refactor/markdown-import-and-attachment-reference-plan.md`

这些文档可继续细化：

- 同步与导入调试面板
- 鉴权和工作区访问控制
- 前端查询 hook 与 view model 规范
- Markdown 转换与附件引用迁移细节
