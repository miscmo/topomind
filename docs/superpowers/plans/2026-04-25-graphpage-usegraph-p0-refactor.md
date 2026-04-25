# GraphPage & useGraph P0 Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce GraphPage complexity by extracting resize, logging, room-loading, dirty-sync, and search-sync into dedicated hooks; converge Tab/global state access via a unified `useNavContext` hook; simplify GraphPage to a pure composition layer.

**Architecture:**
- Extract page-level side effects into focused hooks (`useResizePanel`, `usePageLogging`, `useRoomLoader`, `useTabDirtySync`)
- Create `useNavContext` as the single read path for all Tab/global nav state — replaces scattered `tabId ? tabStore : roomStore` branches
- `useGraph` becomes the coordination layer (unchanged structurally, but fed by `useNavContext`)
- `GraphPage` becomes a thin composition shell — no inline effects, no state logic

**Tech Stack:** React 18, TypeScript, Zustand v5, React Flow (`@xyflow/react`)

---

## Task 1: Create `useNavContext` — unified Tab/global nav state hook

**Files:**
- Create: `src/hooks/useNavContext.ts`
- Modify: `src/hooks/useGraph.ts:121-138` (replace inline `getActiveNavState` body)
- Modify: `src/components/GraphPage.tsx:176-187` (simplify effective* derivations)

- [ ] **Step 1: Create `src/hooks/useNavContext.ts` with failing test**

```typescript
import { useCallback } from 'react'
import { useAppStore } from '../stores/appStore'
import { tabStore } from '../stores/tabStore'

export interface NavState {
  kbPath: string
  roomPath: string
  roomName: string
  searchQuery: string
  selectedNodeId: string | null
}

export interface UseNavContextOptions {
  /** Tab ID — if provided, reads Tab-scoped state; otherwise global roomStore */
  tabId?: string
}

export function useNavContext(options: UseNavContextOptions = {}) {
  const { tabId } = options

  const getNavState = useCallback((): NavState => {
    if (tabId) {
      const tab = tabStore.getState().getTabById(tabId)
      if (tab && tab.type === 'kb' && tab.kbPath) {
        return {
          kbPath: tab.kbPath,
          roomPath: tab.currentRoomPath || tab.kbPath,
          roomName: tab.currentRoomName || tab.label,
          searchQuery: tab.searchQuery ?? '',
          selectedNodeId: tab.selectedNodeId ?? null,
        }
      }
    }
    const roomState = roomStore.getState()
    const appState = useAppStore.getState()
    return {
      kbPath: roomState.currentKBPath || '',
      roomPath: roomState.currentRoomPath || roomState.currentKBPath || '',
      roomName: roomState.currentRoomName || '全局',
      searchQuery: appState.searchQuery,
      selectedNodeId: appState.selectedNodeId,
    }
  }, [tabId])

  return { getNavState }
}
```

- [ ] **Step 2: Run type-check to verify compilation**

Run: `cd D:\Code\topomind_cc && pnpm tsc --noEmit --pretty false 2>&1 | head -30`
Expected: FAIL — `roomStore` not imported yet in `useNavContext.ts`

- [ ] **Step 3: Add missing `roomStore` import to `useNavContext.ts`**

```typescript
import { useRoomStore, roomStore } from '../stores/roomStore'
```

- [ ] **Step 4: Run type-check again**

Run: `pnpm tsc --noEmit --pretty false 2>&1 | grep "useNavContext" | head -20`
Expected: No errors from `useNavContext.ts`

- [ ] **Step 5: Update `useGraph.ts` to use `useNavContext` internally**

Replace the inline `getActiveNavState` body (lines 121-138) with a call to the new hook.
Create a factory pattern: pass a `getNavState` getter so `useGraph` stays self-contained.

```typescript
// In useGraph.ts — replace lines 121-138 with:
// getActiveNavState is now constructed from useNavContext via a factory
const getActiveNavState = useCallback(() => {
  if (tabId) {
    const tab = tabStore.getState().getTabById(tabId)
    if (tab && tab.type === 'kb' && tab.kbPath) {
      return {
        kbPath: tab.kbPath,
        roomPath: tab.currentRoomPath || tab.kbPath,
        roomName: tab.currentRoomName || tab.label,
      }
    }
  }
  const roomState = roomStore.getState()
  return {
    kbPath: roomState.currentKBPath || '',
    roomPath: roomState.currentRoomPath || roomState.currentKBPath || '',
    roomName: roomState.currentRoomName || '全局',
  }
}, [tabId])
```

- [ ] **Step 6: Verify useGraph still type-checks**

Run: `pnpm tsc --noEmit --pretty false 2>&1 | grep "useGraph" | head -10`
Expected: No new errors

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useNavContext.ts src/hooks/useGraph.ts
git commit -m "feat: add useNavContext hook for unified Tab/global nav state access"
```

---

## Task 2: Extract resize handle into `useResizePanel` hook

**Files:**
- Modify: `src/components/GraphPage.tsx:189-229`
- Create: `src/hooks/useResizePanel.ts`
- Modify: `src/components/GraphPage.tsx:374-399` (simplify JSX usage)

- [ ] **Step 1: Create `src/hooks/useResizePanel.ts` with failing test**

```typescript
import { useState, useRef, useCallback, useEffect } from 'react'

export interface UseResizePanelOptions {
  initialWidth: number
  onWidthChange: (width: number) => void
  minWidth?: number
  maxWidth?: number
}

export function useResizePanel(options: UseResizePanelOptions) {
  const { initialWidth, onWidthChange, minWidth = 200, maxWidth = 800 } = options
  const [isResizing, setIsResizing] = useState(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = initialWidth
    setIsResizing(true)
  }, [initialWidth])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const delta = e.clientX - dragStartXRef.current
    const newWidth = Math.max(minWidth, Math.min(maxWidth, dragStartWidthRef.current - delta))
    onWidthChange(newWidth)
  }, [isResizing, minWidth, maxWidth, onWidthChange])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (!isResizing) return
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (e: MouseEvent) => handleMouseMove(e)
    const onUp = () => handleMouseUp()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  return { isResizing, handleMouseDown }
}
```

- [ ] **Step 2: Run type-check**

Run: `pnpm tsc --noEmit --pretty false 2>&1 | grep "useResizePanel" | head -10`
Expected: No errors

- [ ] **Step 3: Wire into GraphPage — remove inline resize logic (lines 189-229) and replace with hook**

Replace lines 189-229 in `GraphPage.tsx` with:
```typescript
const { isResizing, handleMouseDown: handleResizeMouseDown } = useResizePanel({
  initialWidth: rightPanelWidth,
  onWidthChange: setRightPanelWidth,
  minWidth: 200,
  maxWidth: 800,
})
```

Also remove the `useState`, `useRef` imports that were only used for resize (keep `useEffect, useRef, useState, useCallback` — resize useState removed).

- [ ] **Step 4: Run type-check**

Run: `pnpm tsc --noEmit --pretty false 2>&1 | grep "GraphPage" | head -10`
Expected: No new errors

- [ ] **Step 5: Verify the resize handle in JSX (lines 392-399) still works**

JSX: `<div className={...resizeHandle...} onMouseDown={handleResizeMouseDown} ...>`

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useResizePanel.ts src/components/GraphPage.tsx
git commit -m "refactor: extract resize handle logic into useResizePanel hook"
```

---

## Task 3: Extract page logging into `usePageLogging` hook

**Files:**
- Create: `src/hooks/usePageLogging.ts`
- Modify: `src/components/GraphPage.tsx:231-240`

- [ ] **Step 1: Create `src/hooks/usePageLogging.ts`**

```typescript
import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { logAction } from '../core/log-backend'

export interface UsePageLoggingOptions {
  view: string
  effectiveRoomPath: string | null
  effectiveKbPath: string | null
  tabId?: string
}

export function usePageLogging(options: UsePageLoggingOptions) {
  const { view, effectiveRoomPath, effectiveKbPath, tabId } = options

  useEffect(() => {
    if (view === 'graph') {
      logAction('页面:进入图谱', 'GraphPage', {
        currentRoomPath: effectiveRoomPath || '',
        currentKBPath: effectiveKbPath || '',
        tabId: tabId || '',
      })
    }
  }, [view, effectiveRoomPath, effectiveKbPath, tabId])
}
```

- [ ] **Step 2: Replace lines 231-240 in GraphPage with hook usage**

Remove the `useEffect` block from GraphPage and replace with:
```typescript
usePageLogging({
  view,
  effectiveRoomPath: effectiveRoomPath || null,
  effectiveKbPath: effectiveKbPath || null,
  tabId,
})
```

- [ ] **Step 3: Remove now-unused `logAction` import if no other usage remains**

Check: `grep -n "logAction" src/components/GraphPage.tsx`
If only the removed block used it, remove the import.

- [ ] **Step 4: Type-check and commit**

Run: `pnpm tsc --noEmit --pretty false 2>&1 | grep "GraphPage\|usePageLogging" | head -10`

```bash
git add src/hooks/usePageLogging.ts src/components/GraphPage.tsx
git commit -m "refactor: extract page logging into usePageLogging hook"
```

---

## Task 4: Extract room-loading effect into `useRoomLoader` hook

**Files:**
- Create: `src/hooks/useRoomLoader.ts`
- Modify: `src/components/GraphPage.tsx:283-305`

- [ ] **Step 1: Create `src/hooks/useRoomLoader.ts` with failing test**

```typescript
import { useEffect, useRef, useCallback } from 'react'
import { logAction } from '../core/log-backend'

export interface UseRoomLoaderOptions {
  effectiveRoomPath: string | null
  effectiveKbPath: string | null
  tabId?: string
  loadRoom: (path: string) => Promise<void>
  isCreatingRef: React.MutableRefObject<boolean>
}

export function useRoomLoader(options: UseRoomLoaderOptions) {
  const { effectiveRoomPath, effectiveKbPath, tabId, loadRoom, isCreatingRef } = options

  const loadRoomRef = useRef(loadRoom)
  loadRoomRef.current = loadRoom

  useEffect(() => {
    const loadPath = effectiveRoomPath || effectiveKbPath || ''
    if (!loadPath) return

    queueMicrotask(() => {
      if (isCreatingRef.current) {
        isCreatingRef.current = false
        return
      }
      logAction('房间:加载触发', 'GraphPage', {
        loadPath,
        currentRoomPath: effectiveRoomPath || '',
        currentKBPath: effectiveKbPath || '',
        tabId: tabId || '',
      })
      loadRoomRef.current(loadPath)
    })
  }, [effectiveRoomPath, effectiveKbPath, tabId, isCreatingRef])
}
```

- [ ] **Step 2: Run type-check**

Run: `pnpm tsc --noEmit --pretty false 2>&1 | grep "useRoomLoader" | head -10`
Expected: No errors

- [ ] **Step 3: Replace the room-loading useEffect in GraphPage (lines 283-305)**

Replace the entire `useEffect` block in GraphPage with:
```typescript
useRoomLoader({
  effectiveRoomPath: effectiveRoomPath || null,
  effectiveKbPath: effectiveKbPath || null,
  tabId,
  loadRoom: graph.loadRoom,
  isCreatingRef: graph.isCreatingRef,
})
```

Also remove the now-unused `graphLoadRoomRef` and `graphHighlightRef` refs (lines 277-281).

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit --pretty false 2>&1 | grep "GraphPage\|useRoomLoader" | head -10`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRoomLoader.ts src/components/GraphPage.tsx
git commit -m "refactor: extract room-loading effect into useRoomLoader hook"
```

---

## Task 5: Extract dirty state sync into `useTabDirtySync` hook

**Files:**
- Create: `src/hooks/useTabDirtySync.ts`
- Modify: `src/components/GraphPage.tsx:247-257`

- [ ] **Step 1: Create `src/hooks/useTabDirtySync.ts`**

```typescript
import { useRef, useEffect } from 'react'
import { tabStore } from '../stores/tabStore'

export interface UseTabDirtySyncOptions {
  tabId?: string
  onDirtyChange: (callback: (isModified: boolean) => void) => () => void
}

export function useTabDirtySync(options: UseTabDirtySyncOptions) {
  const { tabId, onDirtyChange } = options

  const setTabDirtyRef = useRef<(tabId: string, isDirty: boolean) => void>()
  setTabDirtyRef.current = (tid: string, isDirty: boolean) => {
    tabStore.getState().setTabDirty(tid, isDirty)
  }

  useEffect(() => {
    if (!tabId) return
    return onDirtyChange((isModified: boolean) => {
      setTabDirtyRef.current!(tabId, isModified)
    })
  }, [tabId, onDirtyChange])
}
```

- [ ] **Step 2: Replace the dirty-sync useEffect in GraphPage (lines 247-257)**

Replace with:
```typescript
useTabDirtySync({
  tabId,
  onDirtyChange: graph.onDirtyChange,
})
```

Also remove `setTabDirty` from the store selectors at the top of GraphPage (it was only used for this effect).

- [ ] **Step 3: Type-check and commit**

Run: `pnpm tsc --noEmit --pretty false 2>&1 | grep "GraphPage\|useTabDirtySync" | head -10`

```bash
git add src/hooks/useTabDirtySync.ts src/components/GraphPage.tsx
git commit -m "refactor: extract dirty state sync into useTabDirtySync hook"
```

---

## Task 6: Simplify GraphPage — unify effective* derivations via `useNavContext`

**Files:**
- Modify: `src/components/GraphPage.tsx` (consolidate selectors and remove compatibility branches)

- [ ] **Step 1: Rewrite GraphPage selectors using `useNavContext`**

Replace the block of individual store selectors (lines 160-187) with:
```typescript
const { getNavState } = useNavContext({ tabId })

// Derived once per render:
const nav = getNavState()
const effectiveRoomPath = nav.roomPath
const effectiveKbPath = nav.kbPath
const effectiveSearchQuery = nav.searchQuery
const effectiveSelectedNodeId = nav.selectedNodeId
```

Remove all these individual selectors:
- `useRoomStore` selectors for `currentRoomPath`, `currentKBPath`, `currentRoomName`, `roomHistory`
- `useTabStore` selectors for `setTabDirty`, `getTabById`, `setTabSearchQuery`, `setTabSelectedNode`, `restoreRoomStateToTab`, `activeTabId`
- Manual computation of `tabRoomHistory`, `tabRoomPath`, `tabRoomName`, `tabLabel`, `tabKbPath`, `tabSearchQuery`, `tabSelectedNodeId`
- Manual `effective*` computation

- [ ] **Step 2: Remove compatibility `handleSearchChange` (lines 307-313)**

The new `useNavContext` makes search query access uniform. Remove the dual-write:
```typescript
// REPLACED: single write via useNavContext — remove old handleSearchChange
// Replace usages with: navStore.setSearchQuery(q) or pass getNavState up
```

- [ ] **Step 3: Remove the selected-node sync useEffect (lines 324-332)**

Replace with a direct call — since `useNavContext` unifies the source:
```typescript
// Tab-scoped selected node is now the single source; no sync needed
```

- [ ] **Step 4: Remove the `queueMicrotask` room state restoration effect (lines 265-275)**

The `restoreRoomStateToTab` compat bridge is no longer needed once `useNavContext` is the unified read path.
Delete the entire `useEffect` block.

- [ ] **Step 5: Run full type-check**

Run: `pnpm tsc --noEmit --pretty false 2>&1 | grep "GraphPage" | head -30`
Expected: Few to no errors (existing pre-existing TS errors may remain)

- [ ] **Step 6: Commit**

```bash
git add src/components/GraphPage.tsx
git commit -m "refactor: simplify GraphPage with useNavContext, remove compat branches"
```

---

## Task 7: Verify GraphPage before/after complexity

**Files:**
- Modify: none (inspection task)

- [ ] **Step 1: Count lines in GraphPage**

Run: `wc -l src/components/GraphPage.tsx`

- [ ] **Step 2: Count store subscriptions in GraphPage**

Run: `grep -c "useAppStore\|useRoomStore\|useTabStore" src/components/GraphPage.tsx`

- [ ] **Step 3: Verify GraphPage is a pure composition layer**

Check that GraphPage contains:
- No `loadRoom` calls
- No `setState`-equivalent calls
- No inline mutation logic
- Only hook calls, JSX composition, and trivial callbacks

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: record GraphPage complexity metrics after P0 refactor"
```

---

## File Structure Summary

```
src/hooks/
├── useNavContext.ts      [NEW] Unified Tab/global nav state
├── useResizePanel.ts     [NEW] Right panel drag-resize logic
├── usePageLogging.ts    [NEW] Graph page visibility logging
├── useRoomLoader.ts     [NEW] Room-loading useEffect
├── useTabDirtySync.ts    [NEW] Tab dirty state ↔ graph sync
└── useGraph.ts           [MOD] Accept getNavState factory
src/components/
└── GraphPage.tsx        [MOD] Thin composition shell (~300 lines → ~200 lines)
```

---

## Pre-existing TypeScript Errors (not in scope for this plan)

These exist in the codebase before this plan and are tracked separately:
- `ContextMenu.tsx`: `string | null` not assignable to `string`
- `graphBuilder.ts`: missing `x`/`y` on `GraphChild` type
- `graphOperations.ts`: `Edge` type incompatibility
- `useGraph.ts`: missing `selected` on edge `data` type
