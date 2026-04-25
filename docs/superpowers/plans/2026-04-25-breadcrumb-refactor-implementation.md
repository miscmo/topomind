# 面包屑导航重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将面包屑组件重构为"状态适配 + 领域计算 + UI 渲染"三层架构，消除双 store 条件判断、导航逻辑耦合、测试困难等问题。

**Architecture:** 新增 `breadcrumb.types.ts`（类型定义）、`useBreadcrumbModel.ts`（数据适配+领域计算 hook）、`breadcrumb.actions.ts`（导航动作封装），重写 `Breadcrumb.tsx` 为纯渲染组件，修复 `useGraph` 中 tab 模式下 `navigateToRoom` 不触发 `loadRoom` 的 bug。

**Tech Stack:** React 18 + TypeScript + Zustand v5 + Vitest

---

## 文件结构

### 新增文件
- `src/components/Breadcrumb/breadcrumb.types.ts` — 面包屑标准类型定义
- `src/components/Breadcrumb/useBreadcrumbModel.ts` — 数据适配层 + 领域计算层
- `src/components/Breadcrumb/breadcrumb.actions.ts` — 导航动作封装 + 日志埋点
- `src/test/breadcrumb.test.ts` — 面包屑组件/模型单元测试

### 修改文件
- `src/components/Breadcrumb/Breadcrumb.tsx` — 重写为纯渲染组件
- `src/components/Breadcrumb/Breadcrumb.module.css` — 修复样式（无 .rootLink 样式问题）
- `src/hooks/useGraph.ts` — 修复 `navigateToRoom` 在 tab 模式下不调用 `loadRoom` 的 bug

---

## Task 1: 创建 breadcrumb.types.ts

**Files:**
- Create: `src/components/Breadcrumb/breadcrumb.types.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
/**
 * 面包屑导航类型定义
 * 标准化面包屑数据模型，与 roomStore / tabStore 原始字段解耦。
 */

/** 面包屑条目类型 */
export type BreadcrumbKind = 'root' | 'history' | 'current'

/**
 * 面包屑条目
 * - root: 知识库根节点
 * - history: 可跳转的历史祖先节点
 * - current: 当前房间，不可点击
 */
export interface BreadcrumbItem {
  /** 唯一标识：root 用 'root'，history/current 用房间路径 */
  id: string
  /** 显示名称 */
  label: string
  /** 完整路径（用于调试/右键菜单/复制路径） */
  path: string
  /** 条目类型 */
  kind: BreadcrumbKind
  /** 是否可点击 */
  clickable: boolean
}

/** 面包屑状态（useBreadcrumbModel 产出） */
export interface BreadcrumbState {
  /** 知识库根路径 */
  kbPath: string | null
  /** 当前房间路径 */
  roomPath: string | null
  /** 当前房间名称 */
  roomName: string
  /** 知识库显示名称 */
  rootLabel: string
  /** 计算后的面包屑条目列表 */
  items: BreadcrumbItem[]
  /** 是否处于根级（当前路径 == 根路径） */
  isAtRoot: boolean
  /** 是否应渲染面包屑 */
  visible: boolean
}
```

- [ ] **Step 2: 提交**

```bash
git add src/components/Breadcrumb/breadcrumb.types.ts
git commit -m "feat(breadcrumb): add standard breadcrumb types"
```

---

## Task 2: 创建 breadcrumb.utils.ts

**Files:**
- Create: `src/components/Breadcrumb/breadcrumb.utils.ts`

- [ ] **Step 1: 创建纯函数工具**

```typescript
/**
 * 面包屑纯函数工具
 * 所有函数均为纯函数，无副作用，便于单元测试。
 */
import type { RoomHistoryItem, BreadcrumbItem, BreadcrumbKind } from './breadcrumb.types'

/**
 * 计算单个面包屑条目
 */
function makeItem(
  roomPath: string,
  roomName: string,
  kind: BreadcrumbKind,
  clickable: boolean
): BreadcrumbItem {
  return { id: roomPath, label: roomName, path: roomPath, kind, clickable }
}

/**
 * 计算根级面包屑条目
 */
export function computeRootItem(rootPath: string, rootLabel: string, isAtRoot: boolean): BreadcrumbItem {
  return makeItem(rootPath, rootLabel, 'root', !isAtRoot)
}

/**
 * 从房间历史列表计算历史面包屑条目
 */
export function computeHistoryItems(history: RoomHistoryItem[]): BreadcrumbItem[] {
  return history.map((item) =>
    makeItem(item.room.path, item.room.name, 'history', true)
  )
}

/**
 * 计算当前房间面包屑条目（不可点击）
 */
export function computeCurrentItem(roomPath: string, roomName: string): BreadcrumbItem {
  return makeItem(roomPath, roomName, 'current', false)
}

/**
 * 判断是否处于根级
 */
export function computeIsAtRoot(roomPath: string | null, rootPath: string | null): boolean {
  if (!roomPath || !rootPath) return false
  return roomPath === rootPath
}

/**
 * 判断是否应渲染面包屑
 * 条件：有根路径 且 有当前房间路径
 */
export function computeVisible(rootPath: string | null, roomPath: string | null): boolean {
  return Boolean(rootPath && roomPath)
}

/**
 * 根据导航状态计算完整面包屑状态
 * 这是领域计算的核心函数
 */
export function computeBreadcrumbState(params: {
  kbPath: string | null
  roomPath: string | null
  roomName: string
  history: RoomHistoryItem[]
  rootLabel: string
}) {
  const { kbPath, roomPath, roomName, history, rootLabel } = params

  const isAtRoot = computeIsAtRoot(roomPath, kbPath)
  const visible = computeVisible(kbPath, roomPath)

  if (!visible) {
    return { items: [], isAtRoot, visible: false, kbPath, roomPath, roomName, rootLabel }
  }

  const items: BreadcrumbItem[] = []

  // 1. 根节点
  items.push(computeRootItem(kbPath!, rootLabel, isAtRoot))

  // 2. 历史节点
  items.push(...computeHistoryItems(history))

  // 3. 当前节点（不在根级时）
  if (!isAtRoot) {
    items.push(computeCurrentItem(roomPath!, roomName))
  }

  return { items, isAtRoot, visible, kbPath, roomPath, roomName, rootLabel }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/components/Breadcrumb/breadcrumb.utils.ts
git commit -m "feat(breadcrumb): add pure utility functions for breadcrumb computation"
```

---

## Task 3: 创建 useBreadcrumbModel.ts

**Files:**
- Create: `src/components/Breadcrumb/useBreadcrumbModel.ts`

- [ ] **Step 1: 创建数据适配 + 领域计算 hook**

```typescript
/**
 * useBreadcrumbModel — 面包屑数据适配层 + 领域计算层
 *
 * 职责：
 * 1. 从 roomStore 或 tabStore 读取原始导航状态
 * 2. 统一转换为标准化 BreadcrumbState
 * 3. 对外只暴露标准化数据，UI 组件无需关心 store 差异
 *
 * 使用方式：
 *   const model = useBreadcrumbModel(tabId)
 *   const { items, isAtRoot, visible } = model
 */
import { useMemo } from 'react'
import { useRoomStore } from '../../stores/roomStore'
import { useTabStore } from '../../stores/tabStore'
import type { BreadcrumbState } from './breadcrumb.types'
import { computeBreadcrumbState } from './breadcrumb.utils'

interface UseBreadcrumbModelOptions {
  /** 当前 KB tab 的 id（来自 GraphPage tabId prop） */
  tabId?: string
}

/**
 * 读取并标准化面包屑状态
 * - Tab 模式：读取 tabStore 中对应 tab 的状态
 * - 非 Tab 模式：读取 roomStore 全局状态
 */
export function useBreadcrumbModel({ tabId }: UseBreadcrumbModelOptions): BreadcrumbState {
  // Tab 模式：从 tabStore 读取
  const tab = useTabStore((s) => (tabId ? s.getTabById(tabId) : undefined))

  // 非 Tab 模式：从 roomStore 读取
  const globalRoomHistory = useRoomStore((s) => s.roomHistory)
  const globalRoomPath = useRoomStore((s) => s.currentRoomPath)
  const globalRoomName = useRoomStore((s) => s.currentRoomName)
  const globalKBPath = useRoomStore((s) => s.currentKBPath)

  const state = useMemo((): BreadcrumbState => {
    if (tabId && tab) {
      // Tab 模式
      const kbPath = tab.kbPath ?? null
      const roomPath = tab.currentRoomPath ?? null
      const roomName = tab.currentRoomName ?? tab.label ?? '知识库'
      const history = tab.roomHistory ?? []
      const rootLabel = tab.label ?? '知识库'

      return computeBreadcrumbState({ kbPath, roomPath, roomName, history, rootLabel })
    }

    // 非 Tab 模式
    const kbPath = globalKBPath
    const roomPath = globalRoomPath
    const roomName = globalRoomName || '全局'
    const history = globalRoomHistory
    const rootLabel = kbPath ? '知识库' : ''

    return computeBreadcrumbState({ kbPath, roomPath, roomName, history, rootLabel })
  }, [
    tabId,
    tab,
    globalRoomHistory,
    globalRoomPath,
    globalRoomName,
    globalKBPath,
  ])

  return state
}
```

- [ ] **Step 2: 提交**

```bash
git add src/components/Breadcrumb/useBreadcrumbModel.ts
git commit -m "feat(breadcrumb): add useBreadcrumbModel hook as data adapter layer"
```

---

## Task 4: 创建 breadcrumb.actions.ts

**Files:**
- Create: `src/components/Breadcrumb/breadcrumb.actions.ts`

- [ ] **Step 1: 创建导航动作封装**

```typescript
/**
 * breadcrumb.actions — 面包屑导航动作封装
 *
 * 职责：
 * 1. 统一封装导航行为（返回根级、跳转历史）
 * 2. 统一日志埋点
 * 3. 对外暴露简单接口，内部处理 Tab/非 Tab 分流
 *
 * 使用方式：
 *   const { navigateToRoot, navigateToHistory } = useBreadcrumbActions({ tabId, graph })
 */
import { useCallback } from 'react'
import type { UseGraphReturn } from '../../hooks/useGraph'
import { logAction } from '../../core/log-backend'

interface UseBreadcrumbActionsOptions {
  tabId?: string
  graph: UseGraphReturn
}

/**
 * 面包屑导航动作 hooks
 * 封装点击后的行为与日志，内部调用 graph.navigateToRoot / graph.navigateToRoom
 */
export function useBreadcrumbActions({ tabId, graph }: UseBreadcrumbActionsOptions) {
  /** 返回根级 */
  const navigateToRoot = useCallback(async () => {
    logAction('房间:返回根级', 'Breadcrumb', {
      source: 'breadcrumb-root',
      tabId: tabId || '',
    })
    await graph.navigateToRoot()
  }, [tabId, graph])

  /** 跳转至历史节点 */
  const navigateToHistory = useCallback(
    async (index: number, roomName: string, roomPath: string) => {
      logAction('房间:导航', 'Breadcrumb', {
        historyIndex: index,
        roomName,
        roomPath,
        source: 'breadcrumb-history',
        tabId: tabId || '',
      })
      await graph.navigateToRoom(index)
    },
    [tabId, graph]
  )

  return { navigateToRoot, navigateToHistory }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/components/Breadcrumb/breadcrumb.actions.ts
git commit -m "feat(breadcrumb): add useBreadcrumbActions hook for navigation encapsulation"
```

---

## Task 5: 重写 Breadcrumb.tsx

**Files:**
- Modify: `src/components/Breadcrumb/Breadcrumb.tsx`

- [ ] **Step 1: 重写为纯渲染组件**

替换整个文件内容：

```typescript
/**
 * 面包屑导航组件
 * 显示完整房间路径：知识库根 > 父房间 > ... > 当前房间
 * 历史房间可点击跳转，当前房间不可点击。
 *
 * 架构：纯渲染组件，数据来源于 useBreadcrumbModel，行为来源于 useBreadcrumbActions
 */
import { memo } from 'react'
import { useGraphContext } from '../../contexts/GraphContext'
import { useBreadcrumbModel } from './useBreadcrumbModel'
import { useBreadcrumbActions } from './breadcrumb.actions'
import styles from './Breadcrumb.module.css'

interface BreadcrumbProps {
  /** 当前 KB tab 的 id（来自 GraphPage tabId prop） */
  tabId?: string
}

export default memo(function Breadcrumb({ tabId }: BreadcrumbProps) {
  const graph = useGraphContext()
  const { items, visible } = useBreadcrumbModel({ tabId })
  const { navigateToRoot, navigateToHistory } = useBreadcrumbActions({ tabId, graph })

  if (!visible) return null

  return (
    <div id="breadcrumb" className={styles.breadcrumb}>
      {items.map((item, index) => {
        if (item.kind === 'root') {
          return (
            <button
              key={item.id}
              data-testid="breadcrumb-root"
              className={styles.link}
              onClick={navigateToRoot}
              disabled={!item.clickable}
              aria-current={!item.clickable ? 'page' : undefined}
            >
              {item.label}
            </button>
          )
        }

        const isLast = index === items.length - 1

        return (
          <span key={item.id} className={styles.chain}>
            <span className={styles.sep}>&gt;</span>
            {isLast ? (
              <span className={styles.current}>{item.label}</span>
            ) : (
              <button
                className={styles.link}
                onClick={() => navigateToHistory(index - 1, item.label, item.path)}
              >
                {item.label}
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
})
```

> **注意：** `navigateToHistory` 的 index 参数是 `index - 1`，因为 `items[0]` 是 root，`items[1]` 对应 history index 0。

- [ ] **Step 2: 提交**

```bash
git add src/components/Breadcrumb/Breadcrumb.tsx
git commit -m "refactor(breadcrumb): rewrite as pure UI component using model + actions"
```

---

## Task 6: 修复 useGraph.ts 中 navigateToRoom 在 tab 模式下的 bug

**Files:**
- Modify: `src/hooks/useGraph.ts:467-469`

- [ ] **Step 1: 在 tab 模式下 navigateToRoom 后调用 loadRoom**

找到 `navigateToRoom` 函数中 tab 模式的分支（第 467-469 行）：

```typescript
// 原代码：
if (tabId) {
  tabStore.getState().navigateToHistoryIndexInTab(tabId, index)
  return  // <-- 缺少 loadRoom，bug
}
```

替换为：

```typescript
if (tabId) {
  const target = tabStore.getState().navigateToHistoryIndexInTab(tabId, index)
  if (target) {
    // 解析目标房间的绝对路径
    const navState = getActiveNavState()
    const absolutePath = navState.kbPath && !target.path.startsWith(navState.kbPath)
      ? `${navState.kbPath}/${target.path}`
      : target.path
    await loadRoom(absolutePath)
  }
  return
}
```

> **说明：** `navigateToHistoryIndexInTab` 返回跳转后的目标房间信息，包含 path/kbPath/name。在 tab 模式下，跳转到历史索引后需要手动调用 `loadRoom` 重新加载图谱数据。GraphPage 的 useEffect 依赖 `effectiveRoomPath`，但 `navigateToHistoryIndexInTab` 只更新 tabStore 不更新 roomStore，所以图谱页面无法感知到 roomPath 变化。直接在此调用 `loadRoom` 可以解决这个问题。

- [ ] **Step 2: 验证改动不破坏其他调用点**

确认 `navigateToHistoryIndexInTab` 的返回类型为 `{ path: string; kbPath: string; name: string } | null`，在 `navigateToRoom` 调用处已处理 null 情况。

- [ ] **Step 3: 提交**

```bash
git add src/hooks/useGraph.ts
git commit -m "fix: loadRoom after navigateToHistoryIndexInTab in tab mode"
```

---

## Task 7: 修复 Breadcrumb.module.css 样式问题

**Files:**
- Modify: `src/components/Breadcrumb/Breadcrumb.module.css`

- [ ] **Step 1: 添加 .link 样式**

当前 CSS 文件中定义了 `.rootLink` 但 Breadcrumb.tsx 使用的是 `.link`。需要修正：

```css
.link {
  color: #3498db;
  cursor: pointer;
  font-weight: 500;
  background: none;
  border: none;
  font-size: 12px;
  padding: 0;
  transition: text-decoration 0.15s;
}

.link:hover:not(:disabled) {
  text-decoration: underline;
}

.link:disabled {
  color: #1a3a5c;
  font-weight: 600;
  cursor: default;
}
```

删除已废弃的 `.rootLink` 和 `.rootLink:hover` 样式（如果有的话）。

- [ ] **Step 2: 提交**

```bash
git add src/components/Breadcrumb/Breadcrumb.module.css
git commit -m "fix(breadcrumb): add .link styles, remove unused .rootLink"
```

---

## Task 8: 编写单元测试

**Files:**
- Create: `src/test/breadcrumb.test.ts`

- [ ] **Step 1: 测试 breadcrumb.utils 纯函数**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import {
  computeRootItem,
  computeHistoryItems,
  computeCurrentItem,
  computeIsAtRoot,
  computeVisible,
  computeBreadcrumbState,
} from '../components/Breadcrumb/breadcrumb.utils'
import type { RoomHistoryItem } from '../types'

describe('breadcrumb.utils', () => {
  describe('computeIsAtRoot', () => {
    it('returns true when roomPath equals rootPath', () => {
      expect(computeIsAtRoot('/kb/notes', '/kb/notes')).toBe(true)
    })
    it('returns false when roomPath differs from rootPath', () => {
      expect(computeIsAtRoot('/kb/notes/machine-learning', '/kb/notes')).toBe(false)
    })
    it('returns false when roomPath is null', () => {
      expect(computeIsAtRoot(null, '/kb/notes')).toBe(false)
    })
    it('returns false when rootPath is null', () => {
      expect(computeIsAtRoot('/kb/notes', null)).toBe(false)
    })
  })

  describe('computeVisible', () => {
    it('returns true when both kbPath and roomPath are present', () => {
      expect(computeVisible('/kb/notes', '/kb/notes')).toBe(true)
    })
    it('returns false when kbPath is missing', () => {
      expect(computeVisible(null, '/kb/notes')).toBe(false)
    })
    it('returns false when roomPath is missing', () => {
      expect(computeVisible('/kb/notes', null)).toBe(false)
    })
  })

  describe('computeRootItem', () => {
    it('root is clickable when not at root', () => {
      const item = computeRootItem('/kb/notes', 'Notes', false)
      expect(item.clickable).toBe(true)
      expect(item.kind).toBe('root')
    })
    it('root is not clickable when at root', () => {
      const item = computeRootItem('/kb/notes', 'Notes', true)
      expect(item.clickable).toBe(false)
    })
  })

  describe('computeHistoryItems', () => {
    it('maps roomHistory to history items', () => {
      const history: RoomHistoryItem[] = [
        { room: { path: '/kb/a', kbPath: '/kb', name: 'Room A' } },
        { room: { path: '/kb/a/b', kbPath: '/kb', name: 'Room B' } },
      ]
      const items = computeHistoryItems(history)
      expect(items).toHaveLength(2)
      expect(items[0].kind).toBe('history')
      expect(items[0].clickable).toBe(true)
      expect(items[0].label).toBe('Room A')
    })
    it('returns empty array for empty history', () => {
      expect(computeHistoryItems([])).toHaveLength(0)
    })
  })

  describe('computeBreadcrumbState', () => {
    it('renders root + history + current correctly', () => {
      const state = computeBreadcrumbState({
        kbPath: '/kb',
        roomPath: '/kb/notes/ml',
        roomName: 'Machine Learning',
        history: [
          { room: { path: '/kb/notes', kbPath: '/kb', name: 'Notes' } },
        ],
        rootLabel: 'My KB',
      })
      expect(state.items).toHaveLength(3)
      expect(state.items[0].kind).toBe('root')
      expect(state.items[0].label).toBe('My KB')
      expect(state.items[1].kind).toBe('history')
      expect(state.items[1].label).toBe('Notes')
      expect(state.items[2].kind).toBe('current')
      expect(state.items[2].label).toBe('Machine Learning')
      expect(state.isAtRoot).toBe(false)
      expect(state.visible).toBe(true)
    })

    it('renders only root when at root', () => {
      const state = computeBreadcrumbState({
        kbPath: '/kb',
        roomPath: '/kb',
        roomName: 'My KB',
        history: [],
        rootLabel: 'My KB',
      })
      expect(state.items).toHaveLength(1)
      expect(state.items[0].kind).toBe('root')
      expect(state.items[0].clickable).toBe(false)
      expect(state.isAtRoot).toBe(true)
    })

    it('returns invisible when kbPath is missing', () => {
      const state = computeBreadcrumbState({
        kbPath: null,
        roomPath: '/kb/notes',
        roomName: 'Notes',
        history: [],
        rootLabel: '',
      })
      expect(state.visible).toBe(false)
      expect(state.items).toHaveLength(0)
    })
  })
})
```

- [ ] **Step 2: 运行测试**

```bash
pnpm vitest run src/test/breadcrumb.test.ts
```
Expected: All 12 tests pass

- [ ] **Step 3: 提交**

```bash
git add src/test/breadcrumb.test.ts
git commit -m "test(breadcrumb): add unit tests for breadcrumb utils"
```

---

## 验证清单

重构完成后，逐一验证以下场景：

- [ ] **全局模式**：无房间时不渲染面包屑
- [ ] **全局模式**：在 KB 根时 root 节点 disabled
- [ ] **Tab 模式**：正确读取对应 tab 的 roomHistory
- [ ] **Tab 模式**：切换 Tab 后面包屑显示同步
- [ ] **历史跳转**：点击面包屑历史节点后图谱正确切换（验证 Task 6 的 bug 修复）
- [ ] **根级返回**：点击 root 后回到 KB 根
- [ ] **边界情况**：空 history 时面包屑只显示 root
- [ ] **边界情况**：rootPath 缺失时不渲染
- [ ] **样式**：root 节点在 disabled 时样式正确
- [ ] **日志**：导航动作正确触发 logAction

---

## 架构变更总览

```
Before:
Breadcrumb.tsx
  ├─ useRoomStore() × 3 selectors
  ├─ useTabStore() × 1 selector + getTabById
  ├─ useGraphContext()
  ├─ logAction() × 2 (inline)
  └─ navigate logic (inline)

After:
Breadcrumb.tsx         ← 纯渲染，无业务逻辑
  └─ useBreadcrumbModel    ← 数据适配 + 领域计算
       ├─ useRoomStore()
       └─ useTabStore()

  └─ useBreadcrumbActions  ← 导航行为 + 日志
       └─ graph.navigateToXxx()
```
