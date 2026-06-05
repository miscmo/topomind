# TopoMind 云同步改造执行计划

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：执行计划 / 实施路线图 / 原子落地清单  
**创建时间**：2026-06-05  
**当前状态**：`EP-00 ~ EP-02` 已完成（运行态联调仍依赖本地 PostgreSQL 环境），`EP-03` 已完成代码落地（待数据库执行验收），`EP-04` 进行中（同步最小 API 已落地，待数据库联调验收）  
**依赖文档**：
- `spec/cloud-storage-refactor/README.md`
- `spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md`
- `spec/cloud-storage-refactor/cloud-storage-schema-design.md`
- `spec/cloud-storage-refactor/cloud-sync-protocol-design.md`
- `spec/cloud-storage-refactor/backend-api-contract-draft.md`
- `spec/cloud-storage-refactor/server-sync-service-implementation-plan.md`
- `spec/cloud-storage-refactor/client-repository-layer-design.md`
- `spec/cloud-storage-refactor/sqlite-schema-and-main-process-storage-plan.md`
- `spec/cloud-storage-refactor/client-state-store-refactor-plan.md`
- `spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md`
- `spec/cloud-storage-refactor/data-migration-from-local-workdir-plan.md`
- `spec/cloud-storage-refactor/legacy-workdir-importer-implementation-plan.md`
- `spec/cloud-storage-refactor/sync-observability-and-debug-panel-plan.md`

---

## 1. 计划目标

本计划不再重复解释架构原则，而是把现有架构文档收敛成一条可以真正开工的实施路线，并满足三个要求：

- 每一步都能独立提交和验收
- 每一步都尽量不跨多个大主题同时改
- 每一步完成后，仓库仍保持可运行、可继续演进

---

## 2. 执行前提

## 2.1 采用的目标路线

本计划默认采用当前文档中已经最稳定的长期路线：

- 服务端：`NestJS + PostgreSQL + 对象存储`
- 桌面端：当前 Electron + React 应用继续保留
- 本地缓存：`SQLite` 放 Electron main process
- 同步主线：`bootstrap + pull + push + outbox + change_events`

## 2.2 当前仓库现实

当前仓库仍是一个以桌面端为主的工程：

- 桌面端入口在 [package.json](file:///Users/lhg/Documents/topomind/package.json#L1-L112)
- 主进程入口在 [main.js](file:///Users/lhg/Documents/topomind/electron/main.js#L1-L862)
- 统一存储入口仍然是 [context.tsx](file:///Users/lhg/Documents/topomind/src/core/storage/context.tsx#L1-L22)
- 存储接口仍深度绑定路径 [types.ts](file:///Users/lhg/Documents/topomind/src/core/storage/types.ts#L85-L156)
- 当前已新增独立 `server/` 工程骨架，但后续业务模块仍需按 `EP-02+` 逐步补齐

因此本计划会把“服务端工程骨架”作为一个单独原子步骤，而不是假设后端已经存在。

## 2.3 原子落地规则

从现在开始建议所有实现都遵守以下规则：

1. 一个步骤只解决一个主问题  
2. 一个步骤只引入一层新抽象，不同时做大规模迁移  
3. 每步必须定义完成标准  
4. 未迁完的旧路径能力先保留兼容层，不硬删  
5. 任何时候都不允许把路径重新升级为长期主键  

---

## 3. 阶段总览

建议按下面顺序执行：

1. 基线冻结与工程骨架  
2. 服务端最小闭环  
3. 本地存储与 Repository 骨架  
4. 读链路切换到本地镜像  
5. 写链路切换到 outbox + sync  
6. 附件链路落地  
7. 旧工作目录导入落地  
8. 观测、调试和收尾清理  

---

## 4. 具体执行步骤

## EP-00 文档基线冻结

### 目标

把当前架构结论固化成唯一执行入口，避免边写边改方向。

### 本步产出

- 架构索引 [README.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/README.md)
- 执行计划 [implementation-execution-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/implementation-execution-plan.md)

### 完成标准

- 后续实现统一以这份执行计划为顺序
- 新增设计变更必须回写对应文档

### 状态

- 本步已完成

---

## EP-01 服务端工程骨架

### 状态

- 已完成
- 已落地 `server/` 工程、最小 Nest 启动入口、健康检查接口、环境变量模板与根目录脚本接入
- 已验证 `server` 的 `install / typecheck / build` 可通过

### 目标

在不影响现有桌面端运行的前提下，为云端能力建立独立服务端工程和本地开发环境。

### 变更范围

- 新增 `server/` 目录
- 新增服务端包管理、启动脚本、环境变量模板
- 新增本地 `PostgreSQL` 开发方式
- 根目录脚本补充服务端启动命令

### 建议内容

- `server/package.json`
- `server/src/main.ts`
- `server/src/app.module.ts`
- `server/.env.example`
- `docker-compose.yml` 或等价本地数据库方案
- 根 `package.json` 新增 `dev:server`、`dev:db`

### 本步不做

- 不做业务表
- 不做同步接口
- 不接桌面端

### 完成标准

- 服务端可独立启动
- 本地数据库可启动并连通
- 现有桌面端 `npm run dev` 不受影响

---

## EP-02 鉴权与工作区最小闭环

### 状态

- 已完成
- 已落地服务端最小鉴权与工作区接口闭环
- 已将 `users`、`workspaces`、`workspace_members` 收口为 migration 管理，而非启动时内联建表
- 已落地接口骨架：`POST /auth/login`、`POST /auth/refresh`、`GET /auth/me`、`GET /workspaces`、`GET /workspaces/:workspaceId`
- 已落地 Bearer Token 鉴权守卫与统一错误响应封装
- 已落地桌面端最小会话 store 与 `currentWorkspaceId` 状态字段，仍保留 `currentWorkDir` 兼容
- 已完成类型检查与构建校验
- 运行态联调仍待本地 PostgreSQL 环境可用后补最后验收

### 目标

先打通“用户会话 + 工作区归属”最小闭环，为后续所有同步接口提供身份边界。

### 变更范围

- 服务端用户、工作区、成员关系最小表
- 登录、刷新、当前用户、工作区列表接口
- 桌面端最小会话存储和当前工作区选择状态

### 建议内容

- 服务端表：`users`、`workspaces`、`workspace_members`
- 接口：`login`、`refresh`、`me`、`listWorkspaces`
- 桌面端新增 `currentWorkspaceId` 会话模型，但保留 `currentWorkDir` 兼容

### 代码落点

- 当前工作区状态起点 [workspaceStore.ts](file:///Users/lhg/Documents/topomind/src/stores/workspaceStore.ts#L4-L26)
- Electron API 类型起点 [electron-api.ts](file:///Users/lhg/Documents/topomind/src/types/electron-api.ts#L1-L22)

### 本步不做

- 不做同步
- 不做 SQLite
- 不做导入器

### 完成标准

- 用户可登录并获取工作区列表
- 桌面端能持有当前会话与当前工作区 ID
- 后续服务端接口已具备统一权限入口

---

## EP-03 云端核心 Schema 与迁移

### 状态

- 进行中
- 已落地 migration runner、`schema_migrations` 管理与 `server` 独立执行脚本
- 已落地 `knowledge_bases`、`cards`、`card_edges`、`graph_layouts`、`documents`、`attachments`、`workspace_configs`、`change_events`、`idempotency_records` 的首版 schema 与索引
- 已完成 `server` 侧类型检查与构建校验
- 待本地 PostgreSQL 环境可用后执行 `migrate` 做运行态验收

### 目标

把服务端核心实体表和同步基础表一次性建立好，形成稳定数据库底座。

### 变更范围

- 数据库 migration
- 核心实体表
- 同步基础表
- 最小索引与约束

### 建议内容

- `knowledge_bases`
- `cards`
- `card_edges`
- `graph_layouts`
- `documents`
- `attachments`
- `workspace_configs`
- `change_events`
- `idempotency_records`

### 依赖文档

- [cloud-storage-schema-design.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-storage-schema-design.md)
- [server-sync-service-implementation-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/server-sync-service-implementation-plan.md)

### 本步不做

- 不做完整业务 service
- 不做附件上传
- 不做桌面端接入

### 完成标准

- 本地数据库可执行 migration
- 所有核心表已可用于后续 API 开发
- 表结构与现有架构文档一致

---

## EP-04 服务端同步最小读写闭环

### 状态

- 进行中
- 已落地 `bootstrap`、`sync/pull`、`sync/push` 三个最小同步入口
- 已落地 `BootstrapService`、`SyncPullService`、`SyncPushService`、`EventWriter`、`IdempotencyService` 的首版服务实现
- 已覆盖 `knowledge_base`、`card`、`document`、`graph_layout` 四类核心实体的最小写链路
- 已完成 `server` 侧类型检查
- 待本地 PostgreSQL 环境可用后执行真实 `login -> bootstrap -> push -> pull` 联调验收

### 目标

先打通最小同步 API 闭环，让客户端后续可以围绕它构建本地镜像和同步引擎。

### 变更范围

- `bootstrap`
- `sync/pull`
- `sync/push`
- 服务端 `change_events` 写入
- 幂等基础

### 建议内容

- `BootstrapService`
- `SyncPullService`
- `SyncPushService`
- `EventWriter`
- `IdempotencyService`

### 范围控制

本步先覆盖核心结构化实体：

- `knowledge_base`
- `card`
- `document`
- `graph_layout`

### 本步不做

- 不做附件 `commit`
- 不做批量导入
- 不做复杂冲突 UI

### 完成标准

- 服务端能返回初版 bootstrap
- 服务端能接收单项 push 并写入 `change_events`
- 服务端能按游标 pull 事件

---

## EP-05 Electron 主进程存储骨架

### 目标

先把桌面端的本地持久化骨架搭起来，但不急着迁业务读写。

### 变更范围

- `localdb:* / filecache:* / import:* / sync-debug:*` IPC 分组骨架
- `LocalDbService` 骨架
- `FileCacheService` 骨架
- SQLite 初始化和 migration 机制

### 代码落点

- 主进程入口 [main.js](file:///Users/lhg/Documents/topomind/electron/main.js#L253-L582)
- preload 白名单 [preload.js](file:///Users/lhg/Documents/topomind/electron/preload.js#L7-L43)

### 建议内容

- 新增 `electron/services/localdb-service.*`
- 新增 `electron/services/file-cache-service.*`
- 新增 SQLite 文件目录初始化
- preload 增加新分组白名单，但旧 `fs:*` 继续保留

### 本步不做

- 不迁页面
- 不改现有 `useStorage()` 调用链

### 完成标准

- 本地数据库文件能初始化
- 新 IPC 通道已存在并可返回健康检查结果
- 旧桌面功能不受影响

---

## EP-06 本地镜像表与只读查询

### 目标

把本地 `SQLite` 的最小镜像能力落下来，先支持只读，不急着写入同步。

### 变更范围

- 本地 mirror 表
- `sync_cursor` 基础表
- `LocalRepository` 最小只读接口
- 主进程到 Renderer 的只读调用

### 建议内容

- 表：`local_workspaces`、`local_knowledge_bases`、`local_cards`、`local_documents`、`local_graph_layouts`、`sync_cursor`
- IPC：`localdb:getWorkspaceSnapshot`、`localdb:listKnowledgeBases`、`localdb:getCard`、`localdb:getDocument`

### 本步不做

- 不做 outbox
- 不做写操作
- 不切 UI 主路径

### 完成标准

- 本地 SQLite 可存储和查询镜像数据
- Renderer 可通过新通道读到结构化本地数据

---

## EP-07 Repository Facade 骨架与兼容入口

### 目标

保留现有 `useStorage()` 入口，但把内部重构成面向未来的 Facade 骨架。

### 变更范围

- 新增 `AppRepositoryFacade`
- 新增 `WorkspaceRepository / KnowledgeRepository / SyncRepository` 接口骨架
- 旧 `StorageBackend` 保留兼容

### 代码落点

- 统一入口 [context.tsx](file:///Users/lhg/Documents/topomind/src/core/storage/context.tsx#L1-L22)
- 旧外观 [service.ts](file:///Users/lhg/Documents/topomind/src/core/storage/service.ts#L44-L296)
- 旧接口 [types.ts](file:///Users/lhg/Documents/topomind/src/core/storage/types.ts#L85-L156)

### 本步策略

- 先引入新 Facade
- 旧页面继续调用 `useStorage()`
- 新能力从 Facade 新分组暴露

### 本步不做

- 不删旧路径接口
- 不做全面页面迁移

### 完成标准

- `useStorage()` 仍可正常工作
- 新 Facade 已能承接后续本地镜像与同步能力
- 新功能不再继续扩张巨型 `StorageBackend`

---

## EP-08 Bootstrap 到本地镜像的读链路

### 目标

先打通“服务端 bootstrap -> 本地 SQLite -> 页面读取”的只读闭环。

### 变更范围

- 客户端调用 `bootstrap`
- 主进程批量写入本地镜像
- 页面从本地镜像读 KB / card / document / layout

### 范围控制

本步优先只切读链路，不切写链路。

### 建议切入点

- 首页 KB 列表
- 卡片树读取
- 文档读取
- 根布局读取

### 本步不做

- 不做 outbox
- 不做离线编辑
- 不做附件

### 完成标准

- 指定工作区首次可完成 bootstrap
- 关键页面已优先读本地镜像
- 断网时已缓存内容可继续浏览

---

## EP-09 Outbox 与 `SyncEngine` MVP

### 目标

建立本地写入与远端同步的最小主链路。

### 变更范围

- `sync_outbox`
- `sync_conflicts`
- `SyncEngine`
- `push/pull` 调度
- 重试与错误记录最小逻辑

### 覆盖范围

优先覆盖：

- KB 重命名
- card 创建 / 重命名 / 删除
- document 保存
- layout 保存

### 代码落点

- 旧保存入口 [service.ts](file:///Users/lhg/Documents/topomind/src/core/storage/service.ts#L44-L296)
- 当前布局防抖 [service.ts](file:///Users/lhg/Documents/topomind/src/core/storage/service.ts#L44-L53)

### 本步不做

- 不做附件上传
- 不做导入器
- 不做复杂自动冲突合并

### 完成标准

- 写操作先落本地、再进 outbox
- `SyncEngine` 能触发 push 和 pull
- 冲突能落到本地表，不丢本地修改上下文

---

## EP-10 前端状态去路径化第一批

### 目标

在同步读写链路已存在后，开始把最关键的前端状态从路径切到稳定 ID。

### 变更范围

- `workspaceStore`
- `tabStore`
- 图谱会话状态
- 最小页面路由参数

### 建议优先改的状态

- `currentWorkDir -> currentWorkspaceId`
- `kbPath -> kbId`
- `roomPath / cardPath -> cardId`
- `documentId` 作为文档主定位

### 本步策略

- 只改第一批高价值入口
- 兼容层保留旧字段映射
- 不要求一次性清空所有路径引用

### 完成标准

- 当前工作区身份已可由 `workspaceId` 驱动
- Tab 和主要页面切换不再依赖路径作为主键
- 新代码不再新增路径主语义

---

## EP-11 附件端到端链路

### 目标

把附件从“本地目录文件”正式迁移为“对象存储本体 + 元数据同步 + 本地缓存副本”。

### 变更范围

- 服务端 upload ticket
- 服务端 `attachments/commit`
- 桌面端 `AttachmentRepository`
- `attachment_upload_jobs`
- 本地缓存与系统打开

### 代码落点

- 现有附件接口 [types.ts](file:///Users/lhg/Documents/topomind/src/core/storage/types.ts#L124-L137)
- 现有附件操作 [service.ts](file:///Users/lhg/Documents/topomind/src/core/storage/service.ts#L186-L220)

### 本步不做

- 不做复杂缩略图流水线
- 不做全局去重
- 不做多媒体高级处理

### 完成标准

- 附件可上传、提交元数据、同步到其他设备
- 附件可下载到本地缓存并系统打开
- 删除与恢复进入统一同步体系

---

## EP-12 旧工作目录导入器预览闭环

### 目标

先做只读扫描与导入预览，把迁移入口做出来，但先不写目标工作区。

### 变更范围

- `WorkdirScanner`
- `WorkdirParser`
- `ImportPreviewBuilder`
- `import:scanLegacyWorkdir`
- 导入预览 UI

### 代码落点

- 旧导入能力起点 [kb-service.js](file:///Users/lhg/Documents/topomind/electron/services/kb-service.js#L98-L150)

### 本步不做

- 不真正导入
- 不上传附件
- 不写 checkpoint

### 完成标准

- 用户能选择旧工作目录
- 系统能展示结构化预览与问题摘要
- 现有 `importKB` 仍可保留兼容

---

## EP-13 旧工作目录导入执行闭环

### 目标

把导入从预览推进到真正执行，并接入本地镜像与同步主链路。

### 变更范围

- `ImportPlanner`
- `ImportExecutor`
- `ImportCheckpointStore`
- `import_jobs`
- 结构化实体导入
- 附件导入与回填

### 本步策略

- 先导入结构化实体
- 再导入附件
- 导入完成后直接进入正常同步

### 本步不做

- 不做长期目录双向同步
- 不做高风险 Markdown 全量改写

### 完成标准

- 导入任务可执行、暂停、恢复
- 导入失败可从最近安全阶段重试
- 导入成功后工作区可直接进入正常同步模式

---

## EP-14 同步观测与调试面板

### 目标

把现有日志监控升级成真正可排障的同步调试面板。

### 变更范围

- `SyncEngineDebugState`
- `SyncDebugService`
- `sync-debug:*`
- Monitor 页面新增 `sync` / `import` 视图
- 顶部轻量同步状态条

### 代码落点

- 当前监控页 [MonitorPage.tsx](file:///Users/lhg/Documents/topomind/src/features/monitor/MonitorPage.tsx#L1-L80)
- 当前监控状态 [monitorStore.ts](file:///Users/lhg/Documents/topomind/src/features/monitor/model/monitorStore.ts#L27-L135)

### 本步不做

- 不开放危险写接口
- 不暴露任意 SQL 调试后门

### 完成标准

- 能看到 engine 状态、outbox、cursor、conflicts、导入任务
- 能手动触发有限同步动作
- 能导出调试报告

---

## EP-15 兼容层收口与旧 API 退场

### 目标

在主链路稳定后，系统性收缩旧路径式接口，避免技术债长期存在。

### 变更范围

- 标记并清理旧 `StorageBackend` 路径接口
- 缩退 `fs:*` 到兼容层
- 清理仍依赖 `currentWorkDir` 的页面
- 补齐回归测试与迁移文档

### 本步策略

- 只在新链路稳定后执行
- 一批一批删，不做一次性全删

### 完成标准

- 新功能已全部走 ID 驱动接口
- `fs:*` 仅保留少量兼容用途
- 旧路径主语义不再出现在核心业务链路

---

## 5. 建议的实施节奏

如果按最稳妥的顺序推进，建议节奏如下：

- 第一周：`EP-01 ~ EP-03`
- 第二周：`EP-04 ~ EP-06`
- 第三周：`EP-07 ~ EP-09`
- 第四周：`EP-10 ~ EP-11`
- 第五周：`EP-12 ~ EP-14`
- 第六周：`EP-15` 与收尾

如果你是单人推进，建议不要并行开太多线。  
最稳的方式是一次只做一个 `EP`，每完成一步就回到文档验收一次。

---

## 6. 每一步的统一验收模板

后续每个 `EP` 建议都按同一模板验收：

- 代码是否仍可启动
- 类型检查是否通过
- 新旧链路是否存在明确边界
- 文档是否已回写
- 是否定义了下一步的前置条件

---

## 7. 推荐从哪一步真正开工

建议你现在正式从：

- `EP-01 服务端工程骨架`

开始。

### 原因

- 当前仓库没有独立服务端实现
- 后续所有同步、鉴权、工作区和附件能力都依赖这个骨架
- 这是最小、最清晰、最不容易返工的第一步

---

## 8. 最终建议

从现在开始，不建议再按“哪里想到先改哪里”的方式推进，而建议严格按这份计划执行：

- 先建骨架
- 再建边界
- 先打读闭环
- 再打写闭环
- 最后补附件、迁移和观测

一句话概括：

> 先把服务端、本地存储和同步主链路按原子步骤搭起来，再逐步把现有路径式桌面应用替换为 ID 驱动的云同步应用，这是 TopoMind 当前这套文档体系下最稳、最少返工的落地顺序。
