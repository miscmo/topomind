## 本轮高优先级修复计划

### 目标
在不改变结构化文档公开格式的前提下，修复右侧详情编辑器中的快捷键抢占、MindMap/Flowchart 外部值不同步，以及非法结构化数据导致编辑器异常或数据被回写覆盖的问题。

### 1. 修复编辑器内全局快捷键抢占（P0）
- 文件：`src/features/graph/GraphPage/GraphPage.tsx`
- 移除右侧面板折叠快捷键的 `enableInInput: true`。
- 保留全局快捷键和非编辑区域的行为；复用 `useShortcut` 现有的 input、textarea、select、contenteditable 保护，使 BlockNote、标题输入框和结构化编辑器内的按键不被 capture 阶段拦截。

### 2. 规范化 MindMap 外部数据（P1）
- 文件：`src/features/documents/MindMapDocumentEditor/mindMapDocumentTypes.ts`
- 修正节点 `data` 合并顺序，确保规范化后的 `text` 和 `expandState` 不会被原始脏字段覆盖。
- 为主题和布局建立编辑器已支持的白名单与归一化函数；非法值回退至当前默认主题/逻辑结构布局。
- 保持原有 schema/version/metadata 格式。

### 3. MindMap 编辑器受控外部同步（P0）
- 文件：`src/features/documents/MindMapDocumentEditor/MindMapDocumentEditor.tsx`
- 记录最近已应用到实例的 root/layout/document theme 签名，并在外部 `value` 真正改变时才调用 `setData`、`setLayout`、`setTheme`。
- 通过 `isApplyingExternalValueRef` 抑制 `data_change`、主题和布局事件的反向 `onChange`，避免父层回传或文档切换被误当成本地编辑。
- 外部 root 替换完成后清理 simple-mind-map 历史，使旧文档操作不能撤销到新外部内容。
- 保持全局主题派生逻辑，但不把派生的暗色主题写回文档显式 theme。

### 4. 强化 Flowchart 数据迁移与规范化（P1）
- 文件：`src/features/documents/FlowchartDocumentEditor/flowchartDocumentTypes.ts`
- 将 `cells` 由无约束透传调整为安全规范化：过滤非对象/空 ID/重复 ID，限制节点 shape、有限坐标和尺寸；仅保留源/目标均存在的边。
- 修复 V1 ReactFlow 迁移中未验证的 node/edge、非有限坐标及不符合 X6 格式的 label。
- 规范化 viewport，确保 zoom 为有限且合理的正数，pan 为有限坐标。
- 不引入新的运行时 schema 库，避免扩大依赖面。

### 5. Flowchart 编辑器外部同步与历史交互（P0/P1）
- 文件：`src/features/documents/FlowchartDocumentEditor/FlowchartDocumentEditor.tsx`
- 初始化后为 cells/viewport 增加签名比对的外部同步 effect：仅在外部内容真实变更时 `fromJSON`、恢复 viewport 并清空 X6 History。
- 为回灌过程设置抑制标记，避免 `fromJSON` 和 viewport 恢复触发监听后立即反写父层。
- 将 viewport 保存也统一走 `withFlowchartUpdatedAt`。
- 增加明确的撤销/重做快捷键（Ctrl/Meta+Z、Ctrl+Y/Ctrl/Meta+Shift+Z），并在撤销重做事件后同步持久化内容；补充适当的可用性反馈，避免依赖未显式绑定的插件默认行为。
- 调整 graph ref 赋值时机，确保初始化期间创建边回调可访问实例。

### 6. 验证
- 执行 `npx tsc --noEmit`、`git diff --check`、`npm run build`。
- 手工回归：
  1. 在 BlockNote、标题和结构化编辑器输入区按 Ctrl/Meta+Tab，不折叠右侧栏；非编辑区仍可折叠。
  2. 父层替换 MindMap/Flowchart 内容、布局、主题和 viewport，编辑器显示更新且不产生反向保存。
  3. 外部替换后旧撤销栈不可影响新内容。
  4. 对非法 nodes/cells/viewport 输入稳定回退，不使编辑器抛错。
  5. Flowchart 节点、连线、标签、缩放、撤销与重做均能正确回写。
