# TopoMind 同步可观测性与调试面板方案

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：同步观测设计 / 调试面板方案 / 运维与排障实施草案  
**创建时间**：2026-06-05  
**当前状态**：初稿完成，待结合 `SyncEngine` 实现与 Monitor 页面改造细化  
**依赖文档**：
- `spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md`
- `spec/cloud-storage-refactor/cloud-sync-protocol-design.md`
- `spec/cloud-storage-refactor/local-cache-and-offline-strategy.md`
- `spec/cloud-storage-refactor/client-repository-layer-design.md`
- `spec/cloud-storage-refactor/sqlite-schema-and-main-process-storage-plan.md`
- `spec/cloud-storage-refactor/server-sync-service-implementation-plan.md`
- `spec/cloud-storage-refactor/legacy-workdir-importer-implementation-plan.md`
**维护规则**：当 `SyncEngine` 状态机、本地 SQLite 状态表、主进程 IPC 分组、导入任务模型、日志字段或现有 Monitor 页面结构发生变化时，必须同步更新本文档中的观测模型、面板模块、事件流和实施顺序。

---

## 1. 文档目标

本文档用于把 TopoMind 云同步改造中的“同步可观测性与调试能力”收口成可实施方案，重点回答以下问题：

- 同步系统最少应暴露哪些状态，才能让开发、测试和用户定位问题
- 现有“日志性能监控”页面如何演进为同步调试面板
- `SyncEngine`、本地 `SQLite`、附件任务、导入器和服务端错误应如何被统一观测
- 哪些信息适合展示给普通用户，哪些只应放开发者调试页
- 调试面板应走哪些 IPC 通道，如何避免泄露危险能力
- 同步日志、状态快照、历史事件和手动操作应如何分层

本文档默认适用范围为：

- Electron 桌面端
- 单用户多设备同步优先
- 第一阶段不做复杂运维后台
- 第一阶段以本地调试面板和日志文件为主

---

## 2. 设计摘要

### 2.1 最终结论

TopoMind 不应只靠“看控制台”和“猜是不是网络问题”来排同步故障，而应建立下面这套观测链路：

```text
SyncEngine / Repository / ImportService
  -> structured sync logs
  -> sync state snapshot
  -> localdb debug queries
  -> sync-debug IPC
  -> MonitorPage / Sync Debug Panel
```

### 2.2 第一阶段目标

第一阶段建议至少做到以下五件事：

1. 能看见当前工作区同步状态，而不是只看“有没有报错”  
2. 能查看 outbox、cursor、conflicts、attachment jobs、import jobs 的摘要  
3. 能把一次失败关联到错误码、实体 ID、版本、幂等键和时间点  
4. 能从现有日志监控页进入同步专用调试面板  
5. 能在不暴露危险写能力的前提下提供有限手动操作  

### 2.3 第一阶段不做

- 不做完整云端运维后台
- 不做让 Renderer 任意执行 SQL
- 不做可修改任意同步表的调试后门
- 不做把完整文档正文、token、签名 URL 直接显示到日志里
- 不做自动远程收集所有设备调试数据

### 2.4 最重要的设计原则

同步观测层必须遵守以下纪律：

1. 观测能力默认只读  
2. 关键状态优先来自结构化快照，不只依赖文本日志  
3. 日志负责还原过程，快照负责展示当前状态  
4. 用户提示与开发者排障信息分层展示  
5. 危险手动操作必须少、明确、可审计  

---

## 3. 为什么必须单独设计同步观测

如果没有专门的同步观测层，TopoMind 在云同步阶段会很快遇到以下问题：

- 无法区分“离线未同步”“服务端冲突”“本地 outbox 卡住”
- 只能从零散日志猜状态，无法看到工作区级全貌
- 导入任务失败后很难知道停在扫描、结构化导入、附件还是 push
- 开发者难以验证 `bootstrap / pull / push / commit` 是否按预期推进
- 用户只能看到“同步失败”，但不知道是否可以重试、是否已有本地保留

因此同步系统必须从一开始就具备基本可观测性，而不是等实现完成后再补。

---

## 4. 当前基线与现实约束

## 4.1 当前已有能力

现有代码已经有几个可以直接复用的观测基础：

- Renderer 侧已有统一日志桥接 [log-backend.ts](file:///Users/lhg/Documents/topomind/src/core/log-backend.ts#L1-L156)
- 前端已有统一日志器 [logger.ts](file:///Users/lhg/Documents/topomind/src/core/logger.ts#L1-L108)
- preload 已有日志相关白名单与订阅通道 [preload.js](file:///Users/lhg/Documents/topomind/electron/preload.js#L7-L43)
- 主进程已提供 `log:*` handler，并能通过菜单打开监控页 [main.js](file:///Users/lhg/Documents/topomind/electron/main.js#L569-L582)
- 前端已存在 Monitor 页面与 store [MonitorPage.tsx](file:///Users/lhg/Documents/topomind/src/features/monitor/MonitorPage.tsx#L1-L80) [monitorStore.ts](file:///Users/lhg/Documents/topomind/src/features/monitor/model/monitorStore.ts#L1-L135)

## 4.2 当前明显缺口

但当前能力仍然主要停留在“日志监控”，还不是“同步调试”：

- 没有 `SyncEngine` 的结构化状态快照
- 没有 outbox、cursor、conflict、attachment job、import job 的只读查询面板
- 没有“当前工作区同步健康度”概念
- 没有把服务端错误码和本地队列状态关联起来
- 现有 Monitor 页签仍以通用日志和性能视图为主，不含同步专用模块

## 4.3 当前代码约束

从现有代码可见，第一阶段观测方案必须接受以下现实：

- 工作区状态仍以 `currentWorkDir` 为中心 [workspaceStore.ts](file:///Users/lhg/Documents/topomind/src/stores/workspaceStore.ts#L4-L26)
- preload 暂时还是统一 `invoke/send/on/off` 风格 [electron-api.ts](file:///Users/lhg/Documents/topomind/src/types/electron-api.ts#L1-L22)
- 主进程当前通道仍主要围绕 `fs:*` 与 `log:*` 展开 [main.js](file:///Users/lhg/Documents/topomind/electron/main.js#L253-L582)
- Monitor 页签已存在入口，优先做扩展比另起一套调试窗口更自然 [tabActions.ts](file:///Users/lhg/Documents/topomind/src/stores/tabs/tabActions.ts#L87-L98)

这意味着第一阶段最合理的路线是：

- 保留现有 Monitor 页签
- 在其上新增同步调试 tab 或二级视图
- 通过新的只读 `sync-debug:*` IPC 输送同步状态

---

## 5. 观测对象分层

## 5.1 建议分成四层

同步观测信息建议拆成四层：

1. 用户可见状态层  
2. 开发调试快照层  
3. 结构化日志层  
4. 手动控制层  

## 5.2 用户可见状态层

这层主要服务普通用户和测试同学，建议只展示：

- 当前是否在线
- 当前工作区同步状态
- 最近成功同步时间
- 是否存在待同步项
- 是否存在冲突
- 是否有导入任务正在运行

### 目标

- 回答“现在有没有同步上”
- 回答“需不需要我处理”
- 避免暴露技术噪音过多的内部细节

## 5.3 开发调试快照层

这层主要服务开发排障，建议展示：

- `SyncEngineState`
- `sync_cursor`
- `sync_outbox` 摘要与详情
- `sync_conflicts`
- `attachment_upload_jobs`
- `import_jobs`
- 当前工作区最近 `pull/push/bootstrap` 结果

## 5.4 结构化日志层

这层负责还原时间线，建议记录：

- 状态切换
- 远端请求开始/成功/失败
- 重试与退避
- 冲突落库
- 导入阶段推进
- 手动操作触发记录

## 5.5 手动控制层

这层只允许非常有限的调试动作：

- 触发一次 `pull`
- 触发一次 `push`
- 触发一次 `bootstrap`
- 重试单个附件任务
- 恢复或重跑导入任务
- 导出调试报告

### 不应提供

- 任意修改同步表
- 任意删库
- 任意执行 SQL
- 任意写文件

---

## 6. 需要观测的核心状态模型

## 6.1 `SyncEngine` 运行状态

第一阶段建议 `SyncEngine` 至少持续暴露以下字段：

```ts
interface SyncEngineDebugState {
  workspaceId: string | null
  status: 'idle' | 'bootstrapping' | 'pulling' | 'pushing' | 'reconciling' | 'offline' | 'error'
  networkStatus: 'online' | 'offline'
  startedAt: string | null
  lastStateChangedAt: string | null
  lastBootstrapAt: string | null
  lastPullAt: string | null
  lastPushAt: string | null
  lastSuccessAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  lastConflictAt: string | null
  pendingOutboxCount: number
  openConflictCount: number
  pendingAttachmentJobCount: number
  pendingImportJobCount: number
}
```

### 为什么必须结构化

如果只写日志而没有这类快照，UI 很难稳定回答：

- 当前到底卡在哪一步
- 这是历史错误还是当前错误
- 错误是否已经恢复

## 6.2 `sync_cursor`

调试面板建议至少展示：

- `workspaceId`
- `lastEventId`
- `bootstrapCompletedAt`
- `lastPullAt`
- `lastPushAt`
- `serverTimeAtLastPull`

### 价值

- 快速判断是否长期没有拉到新事件
- 对照服务端日志排查游标跳跃或滞后

## 6.3 `sync_outbox`

调试面板不需要默认展示所有 payload，但至少要有以下摘要：

- 待处理数量
- 最近 20 或 50 条项
- 每项的 `entityType / entityId / operation`
- `baseVersion`
- `status`
- `attemptCount`
- `nextRetryAt`
- `lastErrorCode`
- `idempotencyKey`
- `createdAt / updatedAt`

### 展开详情时再显示

- `payloadJson`
- `ackedEventId`
- 关联冲突记录

## 6.4 `sync_conflicts`

建议展示：

- `entityType`
- `entityId`
- `conflictType`
- `clientBaseVersion`
- `serverVersion`
- `status`
- `createdAt`

### 展开详情时可显示

- `localPayloadJson`
- `serverEntityJson`

### 但必须脱敏

- 超大正文截断
- 不展示敏感凭据

## 6.5 附件任务

调试面板建议展示 `attachment_upload_jobs` 的：

- `id`
- `workspaceId`
- `cardId`
- `documentId`
- `fileName`
- `sizeBytes`
- `status`
- `attemptCount`
- `lastErrorCode`
- `updatedAt`

## 6.6 导入任务

调试面板建议展示 `import_jobs` 的：

- `id`
- `workspaceId`
- `sourcePath`
- `stage`
- `status`
- `summaryJson`
- `reportPath`
- `updatedAt`

### 价值

这样导入失败时不必只看文本日志，可以直接知道：

- 停在哪个阶段
- 是否可恢复
- 是否已经生成报告

---

## 7. 结构化日志建议

## 7.1 为什么还需要日志

状态快照只能回答“现在是什么样”，回答不了“是怎么走到这里的”。  
因此同步系统仍然必须保留结构化日志。

## 7.2 推荐日志分类

建议至少增加以下模块分类：

- `SyncEngine`
- `SyncRepository`
- `LocalRepository`
- `AttachmentTransfer`
- `ImportService`
- `SyncDebugPanel`

## 7.3 推荐 action 分类

建议至少记录以下动作：

- `sync:start`
- `sync:stop`
- `sync:bootstrap:start`
- `sync:bootstrap:success`
- `sync:bootstrap:failed`
- `sync:pull:start`
- `sync:pull:success`
- `sync:pull:failed`
- `sync:push:start`
- `sync:push:item-success`
- `sync:push:item-conflict`
- `sync:push:item-failed`
- `sync:state-change`
- `sync:retry-scheduled`
- `sync:conflict-recorded`
- `import:stage-change`
- `attachment:upload-state-change`
- `sync-debug:manual-action`

## 7.4 推荐日志字段

每条同步日志建议尽量带上：

- `workspaceId`
- `entityType`
- `entityId`
- `outboxId`
- `attachmentJobId`
- `importJobId`
- `idempotencyKey`
- `eventId`
- `baseVersion`
- `serverVersion`
- `errorCode`
- `durationMs`

## 7.5 不建议写进日志的内容

- access token
- refresh token
- 完整签名 URL
- 完整文档正文
- 超大附件元数据

---

## 8. 面板信息架构

## 8.1 推荐总体结构

第一阶段建议直接扩展现有 Monitor 页面，而不是新增独立窗口协议。  
推荐信息结构如下：

```text
MonitorPage
  -> Logs
  -> Performance
  -> Sync
  -> Import
```

## 8.2 `Sync` 页签

建议拆成以下区块：

- `Overview`
- `Outbox`
- `Conflicts`
- `Cursor`
- `Attachments`
- `Actions`

### `Overview`

展示：

- 当前工作区
- 当前同步状态
- 最近成功时间
- 当前错误
- 在线状态
- 待同步数量
- 冲突数量

### `Outbox`

展示：

- 待处理项列表
- 最近失败项
- 重试计划

### `Conflicts`

展示：

- 冲突记录列表
- 版本对比摘要
- 跳转相关实体入口

### `Cursor`

展示：

- 本地游标
- 最近拉取边界
- 最近事件号

### `Attachments`

展示：

- 附件上传任务状态
- 最近失败项
- 缓存是否命中

### `Actions`

展示：

- 手动 `pull`
- 手动 `push`
- 手动 `bootstrap`
- 导出调试报告

## 8.3 `Import` 页签

虽然导入是独立流程，但它与同步排障强关联，建议在同一 Monitor 内展示：

- 最近导入任务
- 当前阶段
- 失败项数量
- 报告文件路径
- 恢复入口

## 8.4 顶层状态条

除调试面板外，普通工作区界面也建议补一个轻量状态条，只展示：

- `已同步`
- `同步中`
- `离线`
- `待处理 N 项`
- `存在冲突`

这层不需要展开到完整调试细节。

---

## 9. `sync-debug:*` IPC 方案

## 9.1 推荐通道分组

结合前文主进程方案，建议新增只读为主的 `sync-debug:*` 分组：

- `sync-debug:getEngineState`
- `sync-debug:getWorkspaceSummary`
- `sync-debug:listOutboxItems`
- `sync-debug:getOutboxItem`
- `sync-debug:listConflicts`
- `sync-debug:getCursor`
- `sync-debug:listAttachmentJobs`
- `sync-debug:listImportJobs`
- `sync-debug:getImportReport`
- `sync-debug:exportBundle`

## 9.2 受控手动操作

若要支持有限手动操作，建议单独列出：

- `sync-debug:triggerPull`
- `sync-debug:triggerPush`
- `sync-debug:triggerBootstrap`
- `sync-debug:retryAttachmentJob`
- `sync-debug:resumeImportJob`

### 原则

- 与只读查询分开命名
- 在日志中明确记录是谁、何时触发
- 后续可按环境开关限制仅开发模式可见

## 9.3 不建议的 IPC

- `sync-debug:runSql`
- `sync-debug:deleteOutboxItem`
- `sync-debug:setCursor`
- `sync-debug:forceWriteMirror`

这些接口太容易破坏排障现场，不适合作为常规调试能力。

## 9.4 响应结构建议

建议所有 `sync-debug:*` 通道统一返回：

```ts
interface DebugResponse<T> {
  ok: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}
```

### 价值

- 前端调试面板实现简单
- 和正常业务 API 的错误形态更一致

---

## 10. 主进程服务落点

## 10.1 `SyncDebugService`

第一阶段建议在 Electron main process 增加一个只读聚合服务：

```text
SyncDebugService
  -> SyncEngineStateSource
  -> LocalDbService
  -> FileCacheService
  -> ImportService
  -> LogService
```

### 职责

- 聚合同步快照
- 查询本地状态表摘要
- 对外提供只读调试 DTO
- 导出调试报告包

### 不负责

- 直接改业务数据
- 取代正常 Repository

## 10.2 为什么不让面板直接查各服务

如果 Monitor 页面对多个服务逐个调 IPC，会导致：

- 页面组装逻辑过重
- 多次请求时间点不一致
- 后续字段演进困难

更合理的是让 `SyncDebugService` 先在主进程聚合，再统一返回。

## 10.3 推荐聚合摘要

建议提供一个总览接口：

```ts
interface WorkspaceSyncDebugSummary {
  engine: SyncEngineDebugState
  cursor: SyncCursorSummary | null
  outbox: {
    pending: number
    sending: number
    conflicted: number
    failed: number
  }
  conflicts: {
    open: number
  }
  attachments: {
    queued: number
    failed: number
  }
  imports: {
    running: number
    failed: number
  }
}
```

这样 `Overview` 区块可一次请求完成。

---

## 11. 与现有 Monitor 页的衔接

## 11.1 推荐演进方向

当前 Monitor 页已有：

- 日志列表
- 筛选
- 详情面板
- 性能 tab

因此最自然的做法是：

- 保留 `log`
- 保留 `performance`
- 新增 `sync`
- 新增 `import`

## 11.2 为什么不单独再做一个“同步窗口”

第一阶段不建议另做独立同步调试窗口，原因包括：

- 入口分散
- 状态重复
- 维护成本更高
- 当前菜单和 tab 体系已能承载扩展

## 11.3 Monitor store 的演进建议

当前 [monitorStore.ts](file:///Users/lhg/Documents/topomind/src/features/monitor/model/monitorStore.ts#L27-L135) 只承接日志与性能。  
后续建议新增：

- `activeTab: 'log' | 'performance' | 'sync' | 'import'`
- `syncSummary`
- `outboxItems`
- `conflicts`
- `attachmentJobs`
- `importJobs`
- `selectedWorkspaceId`
- `lastRefreshAt`

## 11.4 菜单与页签文案

当前菜单文案还是“日志性能监控” [main.js](file:///Users/lhg/Documents/topomind/electron/main.js#L802-L808)。  
后续建议逐步升级为更贴切的文案，例如：

- `系统监控与同步调试`

这样能更准确表达页面职责。

---

## 12. 手动调试动作设计

## 12.1 第一阶段允许的动作

建议仅保留少量高价值动作：

1. 手动触发 `pull`  
2. 手动触发 `push`  
3. 手动触发 `bootstrap`  
4. 重试单个附件任务  
5. 恢复导入任务  
6. 导出调试包  

## 12.2 动作前后的日志要求

每次手动动作都建议写结构化日志：

- `module = SyncDebugPanel`
- `action = sync-debug:manual-action`
- `params.actionType`
- `params.workspaceId`
- `params.targetId`
- `params.result`

## 12.3 高风险动作的限制

若未来需要更强动作，例如“清空本地镜像再重建”，也应满足：

- 明确二次确认
- 默认仅开发模式可用
- 写日志
- 不能静默执行

第一阶段建议先不开放。

---

## 13. 调试报告导出

## 13.1 为什么需要导出包

很多同步问题无法在用户口头描述里还原，因此建议支持一键导出调试包。

## 13.2 推荐包含内容

第一阶段调试包建议包含：

- 当前 `SyncEngineDebugState`
- 当前工作区摘要
- 最近 N 条同步相关日志
- 最近 outbox 摘要
- 最近 conflicts 摘要
- 最近 attachment jobs 摘要
- 最近 import jobs 摘要
- 应用版本
- 平台信息

## 13.3 不建议包含

- token
- 完整文档正文
- 完整附件内容
- 完整签名 URL

## 13.4 建议格式

推荐导出：

- 一个 JSON 汇总文件
- 一个日志文本文件

必要时再打成 zip。

---

## 14. 用户态与开发态分层

## 14.1 用户态信息

普通用户更适合看到：

- 当前同步是否正常
- 最近同步时间
- 是否有待处理项
- 是否需要手动重试
- 是否有冲突待处理

## 14.2 开发态信息

开发者页面才适合看到：

- `baseVersion`
- `serverVersion`
- `idempotencyKey`
- `ackedEventId`
- 原始 payload 摘要
- 状态机切换历史

## 14.3 为什么必须分层

如果把开发字段全部直接暴露给普通用户，会导致：

- 信息噪音过大
- 用户不知道该看什么
- 容易误触危险操作

---

## 15. 推荐实施顺序

## 15.1 第一步

先补结构化状态源：

- `SyncEngineDebugState`
- `SyncDebugService`
- `sync-debug:getEngineState`
- `sync-debug:getWorkspaceSummary`

## 15.2 第二步

再补本地状态表只读查询：

- `listOutboxItems`
- `listConflicts`
- `getCursor`
- `listAttachmentJobs`
- `listImportJobs`

## 15.3 第三步

扩展现有 Monitor 页：

- 新增 `sync` tab
- 新增 `import` tab
- 新增总览卡片

## 15.4 第四步

补有限手动操作：

- `triggerPull`
- `triggerPush`
- `retryAttachmentJob`
- `resumeImportJob`

## 15.5 第五步

补调试报告导出：

- `exportBundle`
- 日志筛选打包
- 状态快照打包

---

## 16. 风险与权衡

## 16.1 当前方案的优点

- 与现有日志监控页自然衔接
- 和 `LocalRepository / SyncEngine / ImportService` 的设计边界一致
- 优先读结构化快照，比只看日志更稳定
- 调试能力以只读为主，安全性更高

## 16.2 代价

- 需要额外维护一套 debug DTO
- 需要为同步状态定义更稳定的内部模型
- Monitor 页面复杂度会上升

## 16.3 最大风险

- 只有日志，没有结构化状态
- 为了方便调试开放危险写接口
- 把 payload 和敏感信息无节制打进日志
- UI 直接耦合底层表结构，后续难演进

---

## 17. 未决问题

正式进入实现前，仍需确认以下问题：

1. `SyncEngine` 状态源最终驻留 Renderer 还是部分下沉主进程  
2. `sync-debug:*` 手动动作是否默认仅开发模式可见  
3. 调试报告是否允许用户一键复制到剪贴板或仅导出文件  
4. 冲突详情是否展示完整 `serverEntityJson` 还是只展示摘要  
5. 多工作区并存时，Monitor 页默认看当前工作区还是支持切换  
6. 是否需要把服务端 `requestId` 回写到本地同步日志中  
7. 是否要在普通界面顶部补一个常驻同步状态条  

---

## 18. 最终建议

TopoMind 的同步调试能力最重要的不是“再做一个日志页”，而是：

- 让 `SyncEngine` 有稳定可读的状态快照
- 让 outbox、cursor、conflicts、attachment jobs、import jobs 可被查询
- 让现有 Monitor 页面升级成真正的同步排障入口
- 让手动动作保持少量、受控、可审计
- 让日志与快照共同组成可还原的问题现场

一句话概括：

> 以现有 Monitor 页面为入口，新增 `sync-debug:*` 只读调试通道、`SyncEngine` 结构化状态快照和导入/附件/冲突查询能力，把“日志监控”升级成“同步可观测性与调试面板”，TopoMind 才能在云同步改造落地后真正具备可排障性。

---

## 19. 后续文档建议

在本文档基础上，建议继续拆出以下实施文档：

- `spec/cloud-storage-refactor/auth-and-workspace-membership-plan.md`
- `spec/cloud-storage-refactor/query-hook-and-viewmodel-guidelines.md`
- `spec/cloud-storage-refactor/markdown-import-and-attachment-reference-plan.md`

这些文档可继续细化：

- 鉴权、设备身份和工作区访问控制
- 前端 query/view-model 如何消费同步状态
- Markdown 与附件引用迁移时的调试与报告细节
