# TopoMind 云同步架构文档索引

**项目**：TopoMind — 可漫游拓扑知识大脑  
**文档类型**：架构文档目录索引 / 阅读导航 / 执行基线总览  
**创建时间**：2026-06-05  
**当前状态**：已按主题重整，适合作为后续实施入口  

---

## 1. 目录目的

本索引用于把 `spec/cloud-storage-refactor` 目录下的现有架构文档整理成一套可执行的阅读与落地地图，解决三个问题：

- 这些文档分别回答什么问题
- 文档之间的依赖顺序是什么
- 真正开始落地时，应该优先看哪几份

---

## 2. 当前架构结论

当前整套文档已经收敛出一条比较稳定的主线：

- 云端主存储采用 `PostgreSQL`
- 复杂文档和布局采用 `JSONB`
- 附件本体采用对象存储
- 桌面端本地镜像采用 `SQLite`
- 多端收敛采用 `version + change_events + outbox + pull/push`
- 旧工作目录不再作为未来真相源，只作为导入来源和兼容形态

一句话概括：

> TopoMind 要从“路径驱动的本地文件应用”演进为“稳定 ID 驱动的云同步桌面应用”。

---

## 3. 文档分组

## 3.1 总体架构层

- [cloud-storage-sync-architecture-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md)
  - 总体技术路线、核心原则、阶段划分
  - 是整套文档的总纲

## 3.2 服务端与协议层

- [cloud-storage-schema-design.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-storage-schema-design.md)
  - 云端核心数据表、约束、索引、版本字段
- [cloud-sync-protocol-design.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-sync-protocol-design.md)
  - 多端同步协议、事件流、冲突与幂等主线
- [backend-api-contract-draft.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/backend-api-contract-draft.md)
  - API 分组、请求响应、错误码、幂等约定
- [server-sync-service-implementation-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/server-sync-service-implementation-plan.md)
  - `bootstrap / pull / push / attachments commit` 的服务端落地方式

## 3.3 客户端与本地数据层

- [local-cache-and-offline-strategy.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/local-cache-and-offline-strategy.md)
  - 本地缓存层次、离线边界、冲突保留和恢复策略
- [client-repository-layer-design.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/client-repository-layer-design.md)
  - `Repository Facade + LocalRepository + SyncEngine + DesktopBridge`
- [sqlite-schema-and-main-process-storage-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/sqlite-schema-and-main-process-storage-plan.md)
  - Electron main process 下的 `SQLite + filecache + import + IPC`
- [client-state-store-refactor-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/client-state-store-refactor-plan.md)
  - React + Zustand 去路径化、状态归属和迁移批次

## 3.4 附件与迁移层

- [object-storage-and-attachment-strategy.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md)
  - 附件元数据、对象存储、签名 URL、本地缓存与桌面打开
- [data-migration-from-local-workdir-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/data-migration-from-local-workdir-plan.md)
  - 旧工作目录到云端实体模型的映射和迁移原则
- [legacy-workdir-importer-implementation-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/legacy-workdir-importer-implementation-plan.md)
  - 导入器扫描、预览、执行、checkpoint、报告

## 3.5 观测与排障层

- [sync-observability-and-debug-panel-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/sync-observability-and-debug-panel-plan.md)
  - 同步状态快照、`sync-debug:*`、Monitor 页面升级、调试报告

---

## 4. 推荐阅读顺序

如果你要快速建立整体理解，建议按下面顺序看：

1. [cloud-storage-sync-architecture-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md)
2. [cloud-storage-schema-design.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-storage-schema-design.md)
3. [cloud-sync-protocol-design.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-sync-protocol-design.md)
4. [backend-api-contract-draft.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/backend-api-contract-draft.md)
5. [server-sync-service-implementation-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/server-sync-service-implementation-plan.md)
6. [local-cache-and-offline-strategy.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/local-cache-and-offline-strategy.md)
7. [client-repository-layer-design.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/client-repository-layer-design.md)
8. [sqlite-schema-and-main-process-storage-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/sqlite-schema-and-main-process-storage-plan.md)
9. [client-state-store-refactor-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/client-state-store-refactor-plan.md)
10. [object-storage-and-attachment-strategy.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md)
11. [data-migration-from-local-workdir-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/data-migration-from-local-workdir-plan.md)
12. [legacy-workdir-importer-implementation-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/legacy-workdir-importer-implementation-plan.md)
13. [sync-observability-and-debug-panel-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/sync-observability-and-debug-panel-plan.md)

---

## 5. 真正开始编码时的最小必读集

如果你现在就要开始落地，最小必读集建议是：

- 总纲：[cloud-storage-sync-architecture-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-storage-sync-architecture-plan.md)
- 服务端落地基线：[cloud-storage-schema-design.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-storage-schema-design.md)、[cloud-sync-protocol-design.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/cloud-sync-protocol-design.md)、[server-sync-service-implementation-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/server-sync-service-implementation-plan.md)
- 客户端落地基线：[client-repository-layer-design.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/client-repository-layer-design.md)、[sqlite-schema-and-main-process-storage-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/sqlite-schema-and-main-process-storage-plan.md)
- 迁移与附件基线：[object-storage-and-attachment-strategy.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/object-storage-and-attachment-strategy.md)、[legacy-workdir-importer-implementation-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/legacy-workdir-importer-implementation-plan.md)

---

## 6. 与当前代码的主要对应关系

当前代码里最需要和新架构对齐的入口主要有：

- 统一存储入口 [context.tsx](file:///Users/lhg/Documents/topomind/src/core/storage/context.tsx#L1-L22)
- 路径驱动存储外观 [service.ts](file:///Users/lhg/Documents/topomind/src/core/storage/service.ts#L44-L296)
- 巨型路径接口 [types.ts](file:///Users/lhg/Documents/topomind/src/core/storage/types.ts#L85-L156)
- 工作区状态 [workspaceStore.ts](file:///Users/lhg/Documents/topomind/src/stores/workspaceStore.ts#L4-L26)
- Electron 主进程 IPC [main.js](file:///Users/lhg/Documents/topomind/electron/main.js#L253-L582)
- preload 白名单 [preload.js](file:///Users/lhg/Documents/topomind/electron/preload.js#L7-L43)
- 旧导入能力 [kb-service.js](file:///Users/lhg/Documents/topomind/electron/services/kb-service.js#L98-L150)
- 现有监控页 [MonitorPage.tsx](file:///Users/lhg/Documents/topomind/src/features/monitor/MonitorPage.tsx#L1-L80)

---

## 7. 当前缺口

当前文档体系已经能支撑开始编码，但仍有三个建议后补的专题：

- `auth-and-workspace-membership-plan.md`
- `query-hook-and-viewmodel-guidelines.md`
- `markdown-import-and-attachment-reference-plan.md`

其中最优先补的是：

- 鉴权与工作区访问控制

因为多份文档都依赖它来最终确定：

- 登录方案
- `workspaceId` 归属校验
- 设备身份
- 权限边界

---

## 8. 建议执行入口

如果你准备正式进入落地，不建议再按文档文件名逐份推进，而建议直接转到：

- [implementation-execution-plan.md](file:///Users/lhg/Documents/topomind/spec/cloud-storage-refactor/implementation-execution-plan.md)

这份文档会把当前整套架构结论重新组织成：

- 一条明确的实施主线
- 一组可原子提交的步骤
- 每步对应的代码范围、输出和完成标准
