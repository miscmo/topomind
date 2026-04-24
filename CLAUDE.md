# TopoMind 开发指南

> AI 辅助开发参考文档。本文件帮助 AI 代理快速理解项目架构约束和关键实现细节。

## 项目概述

TopoMind 是一个可漫游拓扑知识大脑桌面应用，基于 Electron + React 18 + TypeScript 构建。
核心功能：知识卡片房间模型，支持无限嵌套层级、双击钻入/退出、拖拽编辑、Markdown 文档渲染。

**关键架构约束（must-follow）**：
- Electron 主进程（IPC、文件系统、Git）完全复用，不改动
- 数据结构和存储格式（`_graph.json`、`_config.json`）完全兼容
- 纯 CSS + CSS Modules 样式，不使用 Tailwind
- 保持原有视觉风格（配色、圆角、阴影、毛玻璃）
- 禁止使用 `window.prompt()` / `window.confirm()` / `window.alert()` — 使用 `usePromptStore` 替代

**禁止事项（prohibitions）**：
- 禁止引入新的状态管理库（已在用 Zustand v5）
- 禁止修改数据存储格式
- 禁止在渲染进程使用 `console.log` 调试输出（用 `logger.ts`）
- 禁止直接在渲染进程调用 Electron IPC（通过 `useStorage()` / `useGit()` hooks 封装）

## 核心模块参考

### 状态管理（Zustand stores）

| Store | 文件 | 职责 |
|-------|------|------|
| `appStore` | `src/stores/appStore.ts` | 视图状态、选中节点、边模式、网格显示、搜索 |
| `roomStore` | `src/stores/roomStore.ts` | 当前知识库、当前房间、房间历史栈 |
| `tabStore` | `src/stores/tabStore.ts` | 多知识库 Tab 管理（tabs 列表、活跃 Tab、脏状态、每 Tab 房间状态持久化） |
| `promptStore` | `src/stores/promptStore.ts` | Prompt 弹窗（Promise-based 替代 window.prompt） |
| `confirmStore` | `src/stores/confirmStore.ts` | Confirm 弹窗（Promise-based 替代 window.confirm，用于 Tab 关闭确认等） |
| `monitorStore` | `src/stores/monitorStore.ts` | 日志监控页面状态 |
| `gitStore` | `src/stores/gitStore.ts` | Git 状态（预留） |

### 核心 Hooks

| Hook | 文件 | 职责 |
|------|------|------|
| `useGraph` | `src/hooks/useGraph.ts` | 图谱核心逻辑（房间加载、节点/边 CRUD、ELK 布局），CRUD 委托给 graphOperations |
| `useGraph/graphOperations` | `src/hooks/useGraph/graphOperations.ts` | 节点/边 CRUD 操作实现（从 useGraph 提取，依赖注入模式） |
| `useLayout` | `src/hooks/useLayout.ts` | ELK.js 分层布局封装 |
| `useStorage` | `src/hooks/useStorage.ts` | 存储抽象层（Store 模块封装） |
| `useGit` | `src/hooks/useGit.ts` | Git 操作封装 |
| `useKeyboard` | `src/hooks/useKeyboard.ts` | 快捷键处理（Esc/Tab/Delete/Backspace） |
| `useContextMenu` | `src/hooks/useContextMenu.ts` | 右键菜单逻辑 |
| `useNodeActions` | `src/hooks/useNodeActions.ts` | 节点操作（增/删/重命名） |

### 核心上下文

| 上下文 | 文件 | 职责 |
|--------|------|------|
| `GraphContext` | `src/contexts/GraphContext.tsx` | 图谱单例（useGraph 实例共享） |

### 核心后端

| 模块 | 文件 | 职责 |
|------|------|------|
| `FSB` | `src/core/fs-backend.ts` | IPC 文件系统调用桥接 |
| `Store` | `src/core/storage.ts` | 统一存储适配器（debounce/flush 保存） |
| `gitBackend` | `src/core/git-backend.ts` | Git 操作封装 + 内存缓存（TTL 30s） |
| `logBackend` | `src/core/log-backend.ts` | 日志后端（IPC 广播到主进程） |
| `logger` | `src/core/logger.ts` | 日志工具（console.* 替换） |

## 关键类型引用

```typescript
// 节点标识：通过路径（如 `transformer/multi-head`），非 UUID
// 节点显示名称：存储在父目录 _graph.json 中

interface GraphChild {
  name: string        // 显示名称
  hasChildren?: boolean
}

interface GraphEdge {
  id: string
  source: string     // 源节点路径
  target: string     // 目标节点路径
}

interface GraphMeta {
  children: Record<string, GraphChild>
  edges: GraphEdge[]
  zoom?: number
  pan?: { x: number; y: number }
}
```

## IPC 通道白名单

通过 `window.electronAPI.invoke` 调用。

**文件系统**：`fs:init` / `fs:listChildren` / `fs:mkDir` / `fs:rmDir` / `fs:saveKBOrder` / `fs:getKBCover` / `fs:saveKBCover` / `fs:renameKB` / `fs:readGraphMeta` / `fs:writeGraphMeta` / `fs:getDir` / `fs:updateCardMeta` / `fs:readFile` / `fs:writeFile` / `fs:deleteFile` / `fs:writeBlobFile` / `fs:readBlobFile` / `fs:clearAll` / `fs:openInFinder` / `fs:countChildren` / `fs:ensureCardDir` / `fs:getRootDir` / `fs:getLastOpenedKB` / `fs:setLastOpenedKB` / `fs:setWorkDir` / `fs:selectWorkDirCandidate` / `fs:createWorkDir` / `fs:importKB`

**Git**：`git:checkAvailable` / `git:init` / `git:status` / `git:statusBatch` / `git:isDirty` / `git:commit` / `git:log` / `git:diff` / `git:diffFiles` / `git:commitDiffFiles` / `git:commitFileDiff` / `git:push` / `git:pull` / `git:fetch` / `git:remote:get` / `git:remote:set` / `git:conflict:list` / `git:conflict:show` / `git:conflict:resolve` / `git:conflict:complete` / `git:auth:setToken` / `git:auth:getSSHKey` / `git:auth:setAuthType` / `git:auth:getAuthType`

**应用**：`app:openExternal`

**日志**：`log:write` / `log:getBuffer` / `log:query` / `log:setLevel` / `log:clear` / `log:getAvailableDates` / `log:getLogDir`

## 常用命令

```bash
pnpm install         # 安装依赖
pnpm dev             # 开发模式
pnpm build           # 构建渲染进程
pnpm preview         # 预览构建结果
pnpm run build:win   # 打包 Windows .exe
pnpm run build:mac   # 打包 macOS
pnpm run build:linux # 打包 Linux
```

## 开发注意事项

1. **双击画布新建节点**：使用 `usePromptStore.open()` 替代被 Electron 禁用的 `window.prompt()`
2. **节点/边 CRUD**：优先通过 `useGraphContext()` 暴露的方法操作，不直接在组件内拼装 React Flow 状态
3. **图谱实例共享**：`GraphPage` 只创建一次 `useGraph()`，再通过 `GraphContextProvider` 下发；不要在子组件中重复直接调用 `useGraph()`
4. **房间切换**：调用 `roomStore.getState().enterRoom(...)` / `goBack()` / `navigateToHistoryIndex()` 后，需要依赖页面监听去触发重新加载
5. **防抖保存**：修改节点或边后 debounce 300ms 自动保存，房间切换前需要 flush
6. **避免 stale closure**：异步回调、事件回调、Promise 链中优先通过 `roomStore.getState()` / `useAppStore.getState()` 或 ref 读取最新值
7. **normalizeMeta**：已在 `saveLayout` 内部处理，调用方不要重复调用
8. **Git 缓存**：`git-backend` 内存缓存 TTL 固定 30 秒，`useGit()` 挂载时会启动清理定时器
9. **日志规范并不完全统一**：渲染层应优先走 `logger` / `logAction`，但 preload 中仍存在少量 `console.warn/error`，如需统一要同时改动 Electron 层
