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
| `promptStore` | `src/stores/promptStore.ts` | Prompt 弹窗（Promise-based 替代 window.prompt） |
| `monitorStore` | `src/stores/monitorStore.ts` | 日志监控页面状态 |
| `gitStore` | `src/stores/gitStore.ts` | Git 状态（预留） |

### 核心 Hooks

| Hook | 文件 | 职责 |
|------|------|------|
| `useGraph` | `src/hooks/useGraph.ts` | 图谱核心逻辑（房间加载、节点/边 CRUD、ELK 布局） |
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

通过 `window.electronAPI.invoke` 调用：

**文件系统**：fs:init-work-dir / fs:set-work-dir / fs:select-work-dir-candidate / fs:create-work-dir / fs:list-children / fs:mk-dir / fs:rm-dir / fs:read-graph-meta / fs:write-graph-meta / fs:read-file / fs:write-file / fs:write-blob-file / fs:read-blob-file

**Git**：git:check-available / git:init / git:get-status / git:commit / git:push / git:pull

**应用**：app:select-directory / app:open-in-finder / app:get-last-opened-kb

## 常用命令

```bash
pnpm install         # 安装依赖
pnpm dev            # 开发模式（带 DevTools）
pnpm run build:win  # 打包 Windows .exe
```

## 开发注意事项

1. **双击画布新建节点**：使用 `usePromptStore.open()` 替代被 Electron 禁用的 `window.prompt()`
2. **节点/边 CRUD**：通过 `useGraph()` hook 返回的方法操作，不直接操作 React Flow
3. **房间切换**：调用 `roomStore.getState().enterRoom(path)` 后 `GraphPage` 监听变化自动重新加载
4. **防抖保存**：修改节点后 debounce 300ms 自动保存，房间切换时 flush
5. **normalizeMeta**：已在 `saveLayout` 内部处理，调用方不要重复调用
6. **Git 缓存**：git-backend 内存缓存 TTL 固定 30 秒，无需手动清理
