# TopoMind 事件目录逐项覆盖率核对表

> 生成产物，**请勿手工编辑**。执行 `npm run gen:coverage` 重建；`verify:logging` 的 C12 会逐字比对本文件与生成器输出。
> 数据来源：`src/shared/observability/eventCatalog.ts`（单一真源）。

## 口径（务必先读）

1. 「已接入」= 业务源码里出现了该事件 id 或其 `LOG_ACTIONS` / `PERFORMANCE_METRICS` / `PERFORMANCE_ACTION` 常量引用。**静态引用 ≠ 运行时必然产生**：条件分支、已下线入口、仅注释引用都可能计入，因此这张表是核对清单，不是运行时覆盖率证明。
2. 「保留未启用」= 设计上决定不产生该事件，并在下表写明原因；这是唯一允许「零引用」的情形。
3. 「仅登记待核对」= 事件目录已登记，却找不到任何产生点，也没有保留说明。这些是**真实缺口**，必须补埋点或从目录移除，不允许用「会被拦截层动态产生」含糊带过。
4. 扫描范围：`src/**/*.{ts,tsx}` 与 `electron/*.js`，排除 `shared/observability/`、`scripts/`、生成产物与文档自身，避免把注册表本身当成产生点。
5. P7 新增「事实类型 / 基数 / 产生点」三列：`kind` 由事件目录声明（不再靠 action 前缀猜分类）；产生点统计剥掉整行注释后的非注释调用次数。`per-interaction` 事件有多个产生点时标注「多入口需核对」——不同入口/分支是合理的，但**同一次执行路径被写多次是缺陷**，由 C15 的运行时代重与 `dedupeKey` 兜底兜住。

## 汇总

| 指标 | 数值 |
| ---- | ---- |
| 事件总数 | 106 |
| 已接入（静态引用） | 103 |
| 保留未启用（有书面理由） | 3 |
| 仅登记待核对（缺口） | 0 |
| 多产生点事件（需核对） | 51 |

## error

| 事件 id | 标签 | 事实类型 | 基数 | 采样率 | 状态 | 产生点 | 静态引用点 / 保留理由 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| `app.crash` | 进程崩溃 | failure | per-event | 1 | 已接入 | 3 | 1 处：`electron/main.js` |
| `app.error` | 未处理异常 | failure | per-event | 1 | 已接入 | 6 | 3 处：`src/features/layout/ErrorBoundary.tsx`、`src/main.tsx`、`electron/main.js` |
| `app.crash_recovered` | 异常退出恢复报告 | failure | per-event | 1 | 已接入 | 1 | 1 处：`electron/log-service.js` |
| `workspace.create_failed` | 创建工作目录失败 | failure | per-event | 1 | 已接入 | 3 | 2 处：`src/features/setup/SetupPage.tsx`、`electron/main.js` |
| `workspace.open_failed` | 打开工作目录失败 | failure | per-event | 1 | 已接入 | 3 | 2 处：`src/features/setup/SetupPage.tsx`、`electron/main.js` |
| `kb.list_load_failed` | 知识库列表加载失败 | failure | per-event | 1 | 已接入 | 2 | 1 处：`src/features/kb/model/useHomeKnowledgeBases.ts` |
| `kb.settings_save_failed` | 保存知识库设置失败 | failure | per-event | 1 | 已接入 | 1 | 1 处：`src/features/kb/components/KBSettingsDialog/model/useKBSettingsDialogModel.ts` |
| `kb.delete_failed` | 删除知识库失败 | failure | per-event | 1 | 已接入 | 1 | 1 处：`src/features/kb/components/KBSettingsDialog/model/useKBSettingsDialogModel.ts` |
| `node.create_failed` | 创建节点失败 | failure | per-event | 1 | 已接入 | 4 | 1 处：`src/hooks/useGraph/nodeCrudOperations.ts` |
| `container.create_failed` | 创建容器失败 | failure | per-event | 1 | 已接入 | 1 | 1 处：`src/features/graph/GraphPage/model/useNodeActions.ts` |
| `edge.validation_reject` | 连线校验拒绝 | failure | per-event | 1 | 已接入 | 3 | 1 处：`src/hooks/useGraph/edgeOperations.ts` |
| `document.save_failed` | 保存文档失败 | failure | per-event | 1 | 已接入 | 2 | 2 处：`src/domain/persistence/saveCoordinator.ts`、`src/features/documents/components/Layout/DocumentWorkspaceLayout.tsx` |
| `ai.chat_failed` | AI 会话失败 | failure | per-event | 1 | 已接入 | 1 | 1 处：`electron/main.js` |
| `ai.patch_reject` | AI 变更放弃 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/ai-agent/components/PatchPreview.tsx` |

## internal

| 事件 id | 标签 | 事实类型 | 基数 | 采样率 | 状态 | 产生点 | 静态引用点 / 保留理由 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| `app.startup` | 应用启动 | periodic | per-event | 1 | 已接入 | 2 | 1 处：`electron/log-service.js` |
| `app.diagnostic_export` | 导出诊断包 | periodic | per-event | 1 | 已接入 | 1 | 1 处：`electron/log-service.js` |
| `workspace.select` | 选择工作目录 | intent | per-interaction | 1 | 已接入 | 6（多入口需核对） | 2 处：`src/features/setup/SetupPage.tsx`、`electron/main.js` |
| `workspace.enter` | 进入工作目录 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`electron/log-service.js` |
| `workspace.leave` | 离开工作目录 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`electron/log-service.js` |
| `room.load` | 加载房间 | state | per-state-change | 1 | 已接入 | 1 | 1 处：`src/hooks/useGraph/useGraphRoomLoader.ts` |
| `room.load_discard` | 房间加载丢弃 | state | per-state-change | 1 | 已接入 | 1 | 1 处：`src/hooks/useGraph/useGraphRoomLoader.ts` |
| `plugin.log` | 插件日志 | periodic | per-event | 1 | 已接入 | 3 | 1 处：`src/plugins/bootstrap.ts` |
| `ipc.invoke` | IPC 调用明细 | periodic | per-event | 1 | 已接入 | 3 | 1 处：`electron/preload.js` |
| `ipc.audit` | IPC 调用汇总 | periodic | per-event | 1 | 已接入 | 1 | 1 处：`electron/preload.js` |
| `store.call` | 存储层调用 | process | per-event | 1 | 保留未启用 | 0 | P2 决定不单独包装 `fs-backend._call`：它最终也走 `preload.invoke`，两处都包会把同一次 IPC 记两遍 |
| `plugin.state` | 插件状态迁移 | periodic | per-event | 1 | 已接入 | 1 | 1 处：`src/plugins/host/pluginLifecycle.ts` |
| `plugin.activate` | 插件激活 | periodic | per-event | 1 | 已接入 | 1 | 1 处：`src/plugins/host/pluginLifecycle.ts` |
| `plugin.deactivate` | 插件停用 | periodic | per-event | 1 | 已接入 | 1 | 1 处：`src/plugins/host/pluginLifecycle.ts` |
| `app.lifecycle` | 应用生命周期 | periodic | per-event | 1 | 已接入 | 1 | 1 处：`electron/main-log.js` |
| `app.quit` | 应用退出 | periodic | per-event | 1 | 已接入 | 3 | 2 处：`electron/main-log.js`、`electron/main.js` |
| `timer.aggregate` | 定时任务汇总 | periodic | per-event | 1 | 已接入 | 1 | 1 处：`src/core/observe.ts` |
| `ai.chat` | AI 会话 | periodic | per-event | 1 | 已接入 | 1 | 1 处：`electron/main.js` |
| `ai.config_save` | AI 配置保存 | periodic | per-event | 1 | 已接入 | 1 | 1 处：`electron/main.js` |
| `ai.agent_save` | AI 智能体配置保存 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`electron/main.js` |
| `ai.agent_select` | AI 智能体切换 | state | per-state-change | 1 | 已接入 | 1 | 1 处：`src/features/ai-agent/model/agentDefinitionStore.ts` |
| `ai.patch_preview` | AI 变更预览 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/ai-agent/components/PatchPreview.tsx` |
| `ai.patch_commit` | AI 变更提交 | state | per-state-change | 1 | 已接入 | 1 | 1 处：`src/features/ai-agent/patch/commitAgentPatch.ts` |
| `ai.tool` | AI 工具调用摘要 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/ai-agent/model/agentToolLoop.ts` |

## performance

| 事件 id | 标签 | 事实类型 | 基数 | 采样率 | 状态 | 产生点 | 静态引用点 / 保留理由 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| `性能:记录` | 性能记录 | metric | per-event | 1 | 已接入 | 6 | 2 处：`src/core/performance-log.ts`、`electron/log-service.js` |
| `perf.room_load` | 性能 · 房间加载 | metric | per-event | 1 | 已接入 | 2 | 1 处：`src/hooks/useGraph/useGraphRoomLoader.ts` |
| `perf.kb_list_load` | 性能 · 知识库列表加载 | metric | per-event | 1 | 已接入 | 1 | 1 处：`src/features/kb/model/useHomeKnowledgeBases.ts` |
| `perf.app_startup` | 性能 · 应用启动 | metric | per-event | 1 | 已接入 | 1 | 1 处：`src/core/performance-runtime.ts` |
| `perf.node_select` | 性能 · 节点选中响应 | metric | per-event | 1 | 已接入 | 6 | 2 处：`src/features/right-panel/model/useDetailDocumentSession.ts`、`src/hooks/useGraph/graphEventHandlers.ts` |
| `perf.node_create` | 性能 · 新建节点 | metric | per-event | 1 | 已接入 | 2 | 1 处：`src/hooks/useGraph/nodeCrudOperations.ts` |
| `perf.node_delete` | 性能 · 删除节点 | metric | per-event | 1 | 已接入 | 1 | 1 处：`src/hooks/useGraph/nodeCrudOperations.ts` |
| `perf.edge_create` | 性能 · 新建连线 | metric | per-event | 1 | 已接入 | 1 | 1 处：`src/hooks/useGraph/edgeOperations.ts` |
| `perf.detail_read` | 性能 · 详情文档读取 | metric | per-event | 1 | 已接入 | 2 | 1 处：`src/features/right-panel/model/useDetailDocumentSession.ts` |
| `perf.detail_save` | 性能 · 详情文档保存 | metric | per-event | 0.2 | 已接入 | 2 | 1 处：`src/features/right-panel/model/useDetailDocumentSession.ts` |
| `perf.document_export` | 性能 · 导出文档 | metric | per-event | 1 | 已接入 | 2 | 2 处：`src/core/performance-log.ts`、`src/features/right-panel/model/useDetailDocuments.ts` |
| `perf.attachment_upload` | 性能 · 上传附件 | metric | per-event | 1 | 已接入 | 2 | 2 处：`src/core/performance-log.ts`、`src/features/documents/components/Layout/AttachmentsTab.tsx` |
| `perf.kb_import` | 性能 · 导入知识库 | metric | per-event | 1 | 已接入 | 2 | 2 处：`src/core/performance-log.ts`、`src/features/kb/model/useHomeImportKB.ts` |
| `perf.document_search` | 性能 · 文档检索 | metric | per-event | 1 | 已接入 | 1 | 1 处：`src/features/documents/unifiedTree/useUnifiedTreeSearch.ts` |
| `perf.document_relations` | 性能 · 引用关系查询 | metric | per-event | 1 | 已接入 | 1 | 1 处：`src/features/right-panel/model/useDocumentRelations.ts` |
| `perf.long_task` | 性能 · 主线程长任务 | metric | per-event | 1 | 已接入 | 2 | 2 处：`src/core/performance-log.ts`、`src/core/performance-runtime.ts` |
| `perf.canvas_edit` | 性能 · 画布编辑操作 | metric | per-event | 1 | 已接入 | 2 | 2 处：`src/hooks/useGraph/canvasPerformanceContext.ts`、`src/hooks/useGraph/nodeChangeOperations.ts` |
| `perf.canvas_gesture` | 性能 · 画布连续手势 | metric | per-event | 1 | 已接入 | 2 | 2 处：`src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts`、`src/hooks/useGraph/nodeChangeOperations.ts` |
| `perf.graph_meta_build` | 性能 · 图数据全量构建 | metric | per-event | 1 | 已接入 | 2 | 2 处：`src/hooks/useGraph/graphOperations.ts`、`src/plugins/builtin/monitor/performance/TraceWaterfallPanel.tsx` |
| `perf.graph_meta_flush` | 性能 · 图数据写盘 | metric | per-event | 0.5 | 已接入 | 2 | 2 处：`src/core/storage/service.ts`、`src/plugins/builtin/monitor/performance/TraceWaterfallPanel.tsx` |
| `perf.canvas_query` | 性能 · 画布查询与定位 | metric | per-event | 1 | 已接入 | 4 | 4 处：`src/features/graph/GraphCanvas/components/NodeSearchBox.tsx`、`src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts`、`src/features/graph/GraphPage/components/NodeTreePanel.tsx` … |
| `perf.canvas_lod` | 性能 · LOD 可见集合重算 | metric | per-event | 1 | 已接入 | 1 | 1 处：`src/features/graph/GraphCanvas/model/useSemanticLod.ts` |

## user

| 事件 id | 标签 | 事实类型 | 基数 | 采样率 | 状态 | 产生点 | 静态引用点 / 保留理由 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| `kb.list_load` | 知识库列表加载 | state | per-state-change | 1 | 已接入 | 1 | 1 处：`src/features/kb/model/useHomeKnowledgeBases.ts` |
| `kb.node_count_load` | 子节点数量加载 | state | per-state-change | 1 | 已接入 | 1 | 1 处：`src/features/kb/model/useHomeKnowledgeBases.ts` |
| `kb.open` | 打开知识库 | intent | per-interaction | 1 | 已接入 | 4（多入口需核对） | 3 处：`src/features/kb/components/KnowledgeBaseGrid.tsx`、`src/features/kb/model/useHomeKnowledgeBases.ts`、`src/features/layout/TabBar/KnowledgeBasePicker.tsx` |
| `kb.create` | 创建知识库 | intent | per-interaction | 1 | 已接入 | 2（多入口需核对） | 1 处：`src/features/kb/model/useHomeCreateKB.ts` |
| `kb.create_dialog` | 新建知识库弹窗 | process | per-event | 1 | 已接入 | 2 | 1 处：`src/features/kb/model/useHomeCreateKB.ts` |
| `kb.import` | 导入知识库 | intent | per-interaction | 1 | 已接入 | 2（多入口需核对） | 2 处：`src/features/kb/model/useHomeImportKB.ts`、`electron/main.js` |
| `kb.import_dialog` | 导入知识库弹窗 | process | per-event | 1 | 已接入 | 2 | 1 处：`src/features/kb/model/useHomeImportKB.ts` |
| `kb.sort` | 知识库排序 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/kb/model/useHomeKnowledgeBases.ts` |
| `kb.settings_save` | 保存知识库设置 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/kb/components/KBSettingsDialog/model/useKBSettingsDialogModel.ts` |
| `kb.delete` | 删除知识库 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/kb/components/KBSettingsDialog/model/useKBSettingsDialogModel.ts` |
| `kb.trash_restore` | 回收站恢复 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/kb/components/TrashDialog/model/useTrashDialogModel.ts` |
| `kb.trash_clear` | 回收站清空 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/kb/components/TrashDialog/model/useTrashDialogModel.ts` |
| `node.create` | 创建节点 | intent | per-interaction | 1 | 已接入 | 17（多入口需核对） | 13 处：`src/core/log-backend.ts`、`src/core/logger.ts`、`src/features/ai-agent/config/agentTemplates.ts` … |
| `node.delete` | 删除节点 | intent | per-interaction | 1 | 已接入 | 4（多入口需核对） | 4 处：`src/features/ai-agent/config/toolCatalog.ts`、`src/features/ai-agent/patch/agentPatchTypes.ts`、`src/hooks/useGraph/nodeCrudOperations.ts` … |
| `node.rename` | 重命名节点 | intent | per-interaction | 1 | 已接入 | 15（多入口需核对） | 8 处：`src/features/ai-agent/config/toolCatalog.ts`、`src/features/ai-agent/patch/agentPatchTypes.ts`、`src/features/ai-agent/patch/dryRunAgentPatch.ts` … |
| `node.select` | 选中节点 | state | per-state-change | 1 | 已接入 | 2 | 2 处：`src/hooks/useGraph/selectionOperations.ts`、`src/hooks/useGraph/selectionSubtreeOperations.ts` |
| `node.enter` | 进入节点 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/graph/GraphPage/model/useNodeActions.ts` |
| `node.move` | 跨房间移动节点 | intent | per-interaction | 1 | 已接入 | 3（多入口需核对） | 1 处：`src/features/graph/GraphPage/model/useNodeMoveToRoom.ts` |
| `node.style_update` | 更新节点样式 | intent | per-interaction | 1 | 已接入 | 4（多入口需核对） | 1 处：`src/hooks/useGraph/nodeCrudOperations.ts` |
| `container.create` | 创建容器 | intent | per-interaction | 1 | 已接入 | 4（多入口需核对） | 2 处：`src/features/documents/services/documentTypeRegistry.ts`、`src/features/graph/GraphPage/model/useNodeActions.ts` |
| `edge.create` | 创建连线 | intent | per-interaction | 1 | 已接入 | 7（多入口需核对） | 5 处：`src/features/ai-agent/patch/agentPatchTypes.ts`、`src/features/ai-agent/patch/dryRunAgentPatch.ts`、`src/features/ai-agent/patch/normalizeAgentPatch.ts` … |
| `edge.delete` | 删除连线 | intent | per-interaction | 1 | 已接入 | 8（多入口需核对） | 5 处：`src/features/ai-agent/patch/agentPatchTypes.ts`、`src/features/ai-agent/patch/dryRunAgentPatch.ts`、`src/features/ai-agent/patch/normalizeAgentPatch.ts` … |
| `edge.update` | 更新连线 | intent | per-interaction | 1 | 已接入 | 5（多入口需核对） | 2 处：`src/features/graph/GraphPage/model/useEdgeActions.ts`、`src/hooks/useGraph/edgeOperations.ts` |
| `room.navigate` | 房间导航 | intent | per-interaction | 1 | 已接入 | 2（多入口需核对） | 2 处：`src/features/layout/Breadcrumb/Breadcrumb.tsx`、`src/hooks/useGraph/graphEventHandlers.ts` |
| `graph.page_enter` | 进入图谱页 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/graph/GraphPage/model/useGraphPageController.ts` |
| `ui.context_menu` | 右键菜单 | intent | per-interaction | 1 | 已接入 | 5（多入口需核对） | 1 处：`src/features/graph/GraphPage/model/useGraphPageActions.ts` |
| `ui.shortcut` | 快捷键 | intent | per-interaction | 1 | 已接入 | 3（多入口需核对） | 1 处：`src/features/graph/GraphCanvas/model/useGraphCanvasModel.ts` |
| `ui.view` | 视图操作 | intent | per-interaction | 1 | 保留未启用 | 0 | 唯一的产生点是画布左下角缩略图（显隐 / 尺寸 / 点击定位）；2026-11-24 缩略图与左下角缩放控件整体下线后，视图交互改由中间只读提示条与 `user.*` 语义事件承接，不再单独落盘 `ui.view`。事件 id 保留仅为归一化历史日志 |
| `ui.tab` | 标签页切换 | intent | per-interaction | 1 | 保留未启用 | 0 | P7 决定由语义事件 `user.tab_close` / `user.tab_switch` 独家承接 tab 交互：关闭与切换各只写 1 条 user 记录，领域侧的 `ui.tab` 降级为内存步骤，不再落盘 |
| `document.create` | 创建文档 | intent | per-interaction | 1 | 已接入 | 3（多入口需核对） | 1 处：`src/features/documents/services/documentTypeRegistry.ts` |
| `document.save` | 保存文档 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/right-panel/model/useDetailDocumentSession.ts` |
| `document.rename` | 重命名文档 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/right-panel/model/useDetailDocuments.ts` |
| `document.delete` | 删除文档 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/right-panel/model/useDetailDocuments.ts` |
| `document.move` | 移动文档 | intent | per-interaction | 1 | 已接入 | 3（多入口需核对） | 1 处：`src/features/right-panel/model/useDetailDocuments.ts` |
| `document.style_update` | 修改文档样式 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/right-panel/model/useDetailDocuments.ts` |
| `document.export` | 导出文档 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/right-panel/model/useDetailDocuments.ts` |
| `attachment.upload` | 上传附件 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/documents/components/Layout/AttachmentsTab.tsx` |
| `attachment.delete` | 删除附件 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/documents/components/Layout/AttachmentsTab.tsx` |
| `attachment.open` | 打开附件 | intent | per-interaction | 1 | 已接入 | 2（多入口需核对） | 1 处：`src/features/documents/components/Layout/AttachmentsTab.tsx` |
| `user.command` | 执行命令 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/application/commands/commandRegistry.ts` |
| `user.document_open` | 打开文档 | intent | per-interaction | 1 | 已接入 | 2（多入口需核对） | 1 处：`src/features/right-panel/components/DetailTab/DetailPanel.tsx` |
| `user.node_click` | 点击节点 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/hooks/useGraph/graphEventHandlers.ts` |
| `user.tab_close` | 关闭标签页 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/layout/TabBar/TabBar.tsx` |
| `user.tab_switch` | 切换标签页 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/layout/TabBar/TabBar.tsx` |
| `user.view_open` | 打开视图 | intent | per-interaction | 1 | 已接入 | 4（多入口需核对） | 1 处：`src/stores/tabs/tabActions.ts` |
| `user.room_enter` | 进入房间 | intent | per-interaction | 1 | 已接入 | 1 | 1 处：`src/features/layout/Breadcrumb/Breadcrumb.tsx` |

## 结论

- 「关键用户动作覆盖率」在本表中**按静态引用逐项核对**：106 个事件中 103 个有产生点、3 个书面保留、0 个待核对。
- 当前没有「仅登记待核对」项；目录中的每个事件要么有产生点，要么有明文的保留理由。
- 运行时是否真的每条事件都会产生，仍需 P2 的拦截行为用例（C10）与人工按上表逐项走查共同证明；本表不冒充运行时覆盖率。
- 新增事件只需登记到 `LOG_ACTIONS` / `PERFORMANCE_METRIC_SPECS`，重新运行 `npm run gen:events && npm run gen:coverage` 即可同步类型、分类产物与本表。

