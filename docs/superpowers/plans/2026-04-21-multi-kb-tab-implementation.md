# TopoMind 多知识库 Tab 页管理实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现多知识库 Tab 页管理，主页为固定不可关闭 Tab，知识库以 Tab 页形式打开，支持脏状态检测。

**Architecture:** 使用 Zustand 独立管理 Tab 状态，每个知识库 Tab 拥有独立 GraphPage 实例 + GraphContextProvider + useGraph，数据完全隔离。

**Tech Stack:** Zustand v5、React 18、TypeScript、CSS Modules

---

## 文件总览

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/stores/tabStore.ts` | Tab 列表状态管理 |
| 新建 | `src/components/TabBar/TabBar.tsx` | Tab 栏组件 |
| 新建 | `src/components/TabBar/TabBar.module.css` | Tab 栏样式 |
| 修改 | `src/App.tsx` | 渲染 TabBar + 条件路由 |
| 修改 | `src/components/HomePage.tsx` | openKB 改为打开 Tab |
| 修改 | `src/components/GraphPage.tsx` | 注册脏状态同步 |
| 修改 | `src/components/GraphPage.module.css` | 移除 graphPanel flex:1 约束 |

---

## Task 1: 新建 tabStore.ts

**Files:**
- Create: `src/stores/tabStore.ts`

- [ ] **Step 1: 创建 Tab 接口和 Store**

```typescript
// src/stores/tabStore.ts
/**
 * Tab 页状态管理
 * 与 appStore/view 解耦，独立管理多 Tab 状态
 */
import { create } from 'zustand'

export interface Tab {
  id: string                    // 'home' | `kb:${path}`
  type: 'home' | 'kb'
  label: string                 // 显示名称
  kbPath?: string               // 仅 type='kb' 时存在
  isDirty: boolean              // 是否有未保存更改
}

interface TabState {
  tabs: Tab[]
  activeTabId: string          // 当前激活 Tab

  // Actions
  initHomeTab: () => void
  addTab: (tab: Tab) => void
  removeTab: (tabId: string) => void
  setActiveTab: (tabId: string) void
  setTabDirty: (tabId: string, isDirty: boolean) => void

  // Computed helpers
  getActiveTab: () => Tab | undefined
}

export const tabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: 'home',

  initHomeTab: () => {
    set({
      tabs: [{ id: 'home', type: 'home', label: '主页', isDirty: false }],
      activeTabId: 'home',
    })
  },

  addTab: (tab: Tab) => {
    set((state) => ({ tabs: [...state.tabs, tab] }))
  },

  removeTab: (tabId: string) => {
    set((state) => {
      if (tabId === 'home') return state                       // 主页不可关闭
      const newTabs = state.tabs.filter((t) => t.id !== tabId)
      let newActiveTabId = state.activeTabId
      if (state.activeTabId === tabId) {
        // 关闭当前 Tab 时，激活前一个 Tab
        const closedIdx = state.tabs.findIndex((t) => t.id === tabId)
        if (newTabs.length === 0 || closedIdx <= 0) {
          newActiveTabId = 'home'
        } else {
          newActiveTabId = newTabs[Math.min(closedIdx, newTabs.length - 1)].id
        }
      }
      return { tabs: newTabs, activeTabId: newActiveTabId }
    })
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId })
  },

  setTabDirty: (tabId: string, isDirty: boolean) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty } : t
      ),
    }))
  },

  getActiveTab: () => {
    const state = get()
    return state.tabs.find((t) => t.id === state.activeTabId)
  },
}))

// 在 React 组件中使用同一个 store 实例作为 hook
export const useTabStore = tabStore
```

- [ ] **Step 2: 验证文件创建成功**

命令：`dir "D:\Code\topomind_cc\src\stores\tabStore.ts"`
预期：文件存在

- [ ] **Step 3: 提交**

```bash
git add src/stores/tabStore.ts
git commit -m "feat: add tabStore for multi-KB tab management

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 新建 TabBar 组件

**Files:**
- Create: `src/components/TabBar/TabBar.tsx`
- Create: `src/components/TabBar/TabBar.module.css`

- [ ] **Step 1: 创建 TabBar.module.css**

```css
/* src/components/TabBar/TabBar.module.css */

.bar {
  display: flex;
  align-items: center;
  height: 38px;
  background: #f5f7fa;
  border-bottom: 1px solid #e0e4ea;
  padding: 0 8px;
  gap: 2px;
  flex-shrink: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  font-size: 12.5px;
  color: #5a6478;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  transition: background 150ms, color 150ms;
  position: relative;
  user-select: none;
  max-width: 180px;
}

.tab:hover {
  background: rgba(255, 255, 255, 0.6);
  color: #1a3a5c;
}

.tab.active {
  background: #fff;
  color: #1a3a5c;
  font-weight: 600;
  border-color: #e0e4ea;
  box-shadow: 0 -1px 4px rgba(16, 24, 40, 0.04);
}

.tabLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tabDirty {
  color: #3498db;
}

.closeBtn {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #8a95a5;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 100ms, background 100ms;
}

.tab:hover .closeBtn {
  opacity: 1;
}

.closeBtn:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #c0392b;
}

.tab.active .closeBtn {
  opacity: 1;
}

/* 主页 Tab 不显示关闭按钮 */
.tabHome .closeBtn {
  display: none;
}
```

- [ ] **Step 2: 创建 TabBar.tsx**

```tsx
// src/components/TabBar/TabBar.tsx
/**
 * Tab 栏组件 — 渲染所有 Tab，仅 tabs.length > 1 时显示
 */
import { memo } from 'react'
import { useTabStore, type Tab } from '../../stores/tabStore'
import styles from './TabBar.module.css'

interface TabBarProps {
  onCloseTab: (tabId: string) => void
}

const TabItem = memo(function TabItem({ tab, isActive, onClick, onClose }: {
  tab: Tab
  isActive: boolean
  onClick: () => void
  onClose: () => void
}) {
  return (
    <div
      className={`${styles.tab} ${isActive ? styles.active : ''} ${tab.id === 'home' ? styles.tabHome : ''}`}
      onClick={onClick}
      role="tab"
      aria-selected={isActive}
      title={tab.label}
    >
      <span className={styles.tabLabel}>
        {tab.label}
        {tab.isDirty && <span className={styles.tabDirty}> •</span>}
      </span>
      {tab.id !== 'home' && (
        <button
          className={styles.closeBtn}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label={`关闭 ${tab.label}`}
        >
          ×
        </button>
      )}
    </div>
  )
})

export default memo(function TabBar({ onCloseTab }: TabBarProps) {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)

  // 仅有一个 Tab（主页）时不渲染
  if (tabs.length <= 1) return null

  return (
    <div className={styles.bar} role="tablist">
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => setActiveTab(tab.id)}
          onClose={() => onCloseTab(tab.id)}
        />
      ))}
    </div>
  )
})
```

- [ ] **Step 3: 验证文件创建成功**

命令：`dir "D:\Code\topomind_cc\src\components\TabBar\TabBar.tsx"`
预期：文件存在

- [ ] **Step 4: 提交**

```bash
git add src/components/TabBar/TabBar.tsx src/components/TabBar/TabBar.module.css
git commit -m "feat: add TabBar component with tab list and close buttons

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 修改 App.tsx

**Files:**
- Modify: `src/App.tsx:1-47`

- [ ] **Step 1: 重写 App.tsx**

```tsx
// src/App.tsx
/**
 * TopoMind React 根组件
 * 根据 Tab 状态路由到不同页面
 * 监控窗口通过 hash (#/monitor) 独立渲染 MonitorPage
 */
import { memo, useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useTabStore, tabStore } from './stores/tabStore'
import SetupPage from './components/SetupPage'
import HomePage from './components/HomePage'
import GraphPage from './components/GraphPage'
import MonitorPage from './components/MonitorPage/MonitorPage'
import PromptModal from './components/PromptModal/PromptModal'
import TabBar from './components/TabBar/TabBar'
import { usePromptStore } from './stores/promptStore'
import styles from './App.module.css'

export default memo(function App() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTab = useTabStore((s) => {
    const state = tabStore.getState()
    return state.tabs.find((t) => t.id === state.activeTabId)
  })
  const prompt = usePromptStore((s) => s.open)

  // 初始化主页 Tab
  useEffect(() => {
    const state = tabStore.getState()
    if (state.tabs.length === 0) {
      tabStore.getState().initHomeTab()
    }
  }, [])

  // 监控窗口通过 hash 路由，独立于 Tab 状态
  const isMonitorWindow = typeof window !== 'undefined' && window.location.hash === '#/monitor'

  // 关闭 Tab 逻辑
  const handleCloseTab = async (tabId: string) => {
    const tab = tabStore.getState().tabs.find((t) => t.id === tabId)
    if (!tab || tab.id === 'home') return                       // 主页不可关闭

    if (tab.isDirty) {
      const answer = await prompt({
        title: `知识库 "${tab.label}" 有未保存的更改，关闭前是否保存？`,
        message: '关闭后未保存的更改将丢失。',
        buttons: [
          { label: '保存', value: 'save' },
          { label: '不保存', value: 'discard' },
          { label: '取消', value: 'cancel' },
        ],
      })

      if (answer === 'save') {
        // TODO: flush 当前 Tab 的数据
        // 先移除 Tab（flush 由 GraphPage 组件在卸载时处理）
        tabStore.getState().removeTab(tabId)
      } else if (answer === 'discard') {
        tabStore.getState().removeTab(tabId)
      }
      // answer === 'cancel' 时不做任何操作
    } else {
      tabStore.getState().removeTab(tabId)
    }
  }

  // 渲染监控窗口
  if (isMonitorWindow) {
    return <MonitorPage />
  }

  // 获取当前 Tab 类型
  const currentTab = tabStore.getState().tabs.find((t) => t.id === tabStore.getState().activeTabId)
  const tabType = currentTab?.type ?? 'home'

  return (
    <>
      <PromptModal />
      <ReactFlowProvider>
        <div className={styles.appRoot}>
          {/* Tab 栏 — 仅 tabs.length > 1 时显示 */}
          <TabBar onCloseTab={handleCloseTab} />

          {/* 内容区 */}
          <div className={styles.content}>
            {tabType === 'home' && <HomePage />}
            {tabType === 'kb' && <GraphPage />}
          </div>
        </div>
      </ReactFlowProvider>
    </>
  )
})
```

- [ ] **Step 2: 创建 App.module.css**

```css
/* src/App.module.css */

.appRoot {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content {
  flex: 1;
  overflow: hidden;
  position: relative;
}
```

- [ ] **Step 3: 验证构建**

命令：`cd "D:\Code\topomind_cc" && pnpm tsc --noEmit`
预期：无错误

- [ ] **Step 4: 提交**

```bash
git add src/App.tsx src/App.module.css
git commit -m "refactor: replace view-based routing with tab-based routing

- App renders TabBar + conditional HomePage/GraphPage
- tabStore manages tabs independently from appStore.view
- onCloseTab checks isDirty and prompts before removal

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 修改 HomePage.tsx — 点击知识库时打开 Tab

**Files:**
- Modify: `src/components/HomePage.tsx:114-118`

- [ ] **Step 1: 修改 openKB 函数**

找到 `HomePage.tsx` 中的 `openKB` 函数（约第114行），将：

```tsx
function openKB(kb: KBItem) {
  roomStore.getState().enterRoom({ path: kb.path, kbPath: kb.path, name: kb.name })
  showGraph()
  logAction('知识库:打开', 'HomePage', { kbPath: kb.path, kbName: kb.name, nodeCount: kb.nodeCount })
}
```

替换为：

```tsx
import { tabStore } from '../stores/tabStore'
import { useAppStore } from '../stores/appStore'

function openKB(kb: KBItem) {
  const tabId = `kb:${kb.path}`

  // 检查是否已有对应 Tab
  const existingTab = tabStore.getState().tabs.find((t) => t.id === tabId)
  if (existingTab) {
    tabStore.getState().setActiveTab(tabId)
  } else {
    tabStore.getState().addTab({
      id: tabId,
      type: 'kb',
      label: kb.name,
      kbPath: kb.path,
      isDirty: false,
    })
    tabStore.getState().setActiveTab(tabId)
    // 同时设置 roomStore（GraphPage 依赖此状态加载房间）
    roomStore.getState().enterRoom({ path: kb.path, kbPath: kb.path, name: kb.name })
  }
  logAction('知识库:打开', 'HomePage', { kbPath: kb.path, kbName: kb.name, nodeCount: kb.nodeCount })
}
```

**注意**：`import { tabStore } from '../stores/tabStore'` 需要添加到文件顶部的 import 区。

- [ ] **Step 2: 验证构建**

命令：`cd "D:\Code\topomind_cc" && pnpm tsc --noEmit`
预期：无错误

- [ ] **Step 3: 提交**

```bash
git add src/components/HomePage.tsx
git commit -m "feat: openKB creates or switches to a tab instead of changing view

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 修改 GraphPage.tsx — 脏状态同步

**Files:**
- Modify: `src/components/GraphPage.tsx:136-246`

- [ ] **Step 1: 在 GraphPage 内添加脏状态同步**

在 `GraphPage` 组件的 `useEffect` 区域（在 `graphLoadRoomRef` 相关代码之后）添加：

```tsx
import { tabStore } from '../stores/tabStore'

// ... existing code ...

// 脏状态同步 — 定期检查 isModified 并上报到 tabStore
useEffect(() => {
  const activeTab = tabStore.getState().tabs.find(
    (t) => t.id === tabStore.getState().activeTabId
  )
  if (!activeTab || activeTab.type !== 'kb') return

  const intervalId = setInterval(() => {
    // graph.isModified 由 useGraph 内部维护
    // 需要在 GraphContext 中暴露此属性
    if (graph.isModified) {
      tabStore.getState().setTabDirty(activeTab.id, true)
    }
  }, 1000)

  return () => clearInterval(intervalId)
}, [])
```

- [ ] **Step 2: 在 GraphContext 中暴露 isModified**

在 `GraphContext.tsx` 的 `GraphContextValue` 接口中添加：

```typescript
// 脏状态（用于 Tab 页脏标记）
isModified: boolean
```

在 `GraphContextProvider` 的 `value useMemo` 中添加：

```typescript
isModified: graph.isModified,
```

同时在 `emptyContext` 中添加：

```typescript
isModified: false,
```

- [ ] **Step 3: 在 useGraph 返回值中添加 isModified**

在 `useGraph.ts` 的 `return` 对象中添加：

```typescript
// Dirty state
isModified: savePendingRef.current,
```

（savePendingRef.current 为 true 时表示有待保存的更改。另一种方式是添加专门的 `isModified` ref 在节点/边变更时设置为 true，flush 完成后设置为 false。推荐后者以保持语义清晰。）

在 useGraph 中添加：

```typescript
// 在 state 附近添加
const [isModified, setIsModified] = useState(false)

// 在 onNodesChange / onEdgesChange / onConnect / renameNode 中
// 每次变更后设置 setIsModified(true)

// 在 debounced save 的 success callback 中
// 设置 setIsModified(false)
```

详细修改：

1. 在 `useGraph.ts` 的 `state` 声明附近添加：
```typescript
const [isModified, setIsModified] = useState(false)
```

2. 在 `onNodesChange` 的 position change / remove 后添加 `setIsModified(true)`
3. 在 `onEdgesChange` 的 remove 后添加 `setIsModified(true)`
4. 在 `onConnect` 中添加 `setIsModified(true)`
5. 在 `deleteChildNode` 成功后添加 `setIsModified(true)`
6. 在 `renameNode` 成功后添加 `setIsModified(true)`
7. 在 `scheduleDebouncedSave` 的 success callback（`savePendingRef.current = false` 后）中添加 `setIsModified(false)`
8. 在 `layoutNodes` 成功后添加 `setIsModified(false)`
9. 返回值中添加 `isModified`

- [ ] **Step 4: 验证构建**

命令：`cd "D:\Code\topomind_cc" && pnpm tsc --noEmit`
预期：无错误

- [ ] **Step 5: 提交**

```bash
git add src/components/GraphPage.tsx src/contexts/GraphContext.tsx src/hooks/useGraph.ts
git commit -m "feat: sync dirty state from GraphPage to tabStore

- useGraph exposes isModified state
- GraphPage polls isModified every 1s and updates tabStore
- GraphContext exposes isModified to consumers

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 样式调整 — 内容区贴顶

**Files:**
- Modify: `src/components/GraphPage.module.css`

- [ ] **Step 1: 调整 GraphPage 样式**

在 `.page` 中添加 `padding-top: 0`（TabBar 显示时内容无需额外 padding）：

```css
.page {
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding-top: 0;
}
```

- [ ] **Step 2: 验证文件**

命令：`type "D:\Code\topomind_cc\src\components\GraphPage.module.css"`
预期：文件存在且内容正确

- [ ] **Step 3: 提交**

```bash
git add src/components/GraphPage.module.css
git commit -m "style: adjust GraphPage padding for tab bar layout

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 端到端验证

**Files:**
- Test: `src/App.tsx` / `src/components/GraphPage.tsx`

- [ ] **Step 1: 启动开发服务器并测试**

命令：`cd "D:\Code\topomind_cc" && pnpm dev`
验证项：
1. 打开应用后 TabBar 不显示（仅主页存在）
2. 在 HomePage 点击知识库卡片 → 创建新 Tab，TabBar 出现
3. 点击 Tab 标题 → 切换到对应知识库 Tab
4. 点击 Tab 关闭按钮（知识库 Tab 右侧 ×）→ 关闭 Tab，TabBar 隐藏（只剩主页）
5. 修改节点位置后 Tab 标题出现脏标记 " •"
6. 只剩主页 Tab 时刷新页面，Tab 状态恢复为仅有主页（预期行为）

---

## 实现顺序

1. Task 1 — tabStore（基础依赖）
2. Task 2 — TabBar 组件（UI 框架）
3. Task 3 — App.tsx（集成骨架）
4. Task 4 — HomePage（打开 Tab）
5. Task 5 — GraphPage 脏状态同步（核心功能）
6. Task 6 — 样式调整
7. Task 7 — 端到端验证

---

## 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 关闭当前激活的 KB Tab | 激活前一个 Tab（Math.max(closedIdx - 1, 0)） |
| 主页 Tab 关闭按钮 | 隐藏（`tab.id === 'home'` 时不渲染） |
| 关闭脏状态 Tab 用户选择"取消" | 不做任何操作 |
| 已打开的知识库再次点击 | 复用已有 Tab，切换到该 Tab |
| 刷新页面 | Tab 状态丢失，恢复为仅有主页（可接受） |