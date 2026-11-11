/**
 * 画布只读状态的外部 store（不进 zustand、不落盘、不写 nodes[].data）。
 *
 * 为什么不用 GraphContext 传 props：编辑入口分散在画布组件、卡片内部、连线浮层、
 * 右键菜单和全局快捷键里，其中不少是事件回调 / 非 React 代码；用 context 逐个透传
 * 必然漏掉一条。所有写操作统一在 useGraph() 读 `isCanvasReadOnly(tabId)`，
 * 卡片 / 连线这类拿不到 tabId 的叶子组件订阅 `useActiveCanvasReadOnly()`。
 *
 * 【铁律】先写快照再通知：`useSyncExternalStore` 的监听器在通知时立刻读 getSnapshot，
 * 顺序反了会读到旧值，React 直接丢弃这次重渲染（与 lodCollapseStore 同一个坑）。
 */
import { useSyncExternalStore } from 'react'
import {
  CANVAS_EDITABLE_STATE,
  computeCanvasReadOnly,
  type CanvasReadOnlyState,
} from '../domain/graph/canvasReadOnly'

const states = new Map<string, CanvasReadOnlyState>()
const listeners = new Set<() => void>()
let activeScope = ''
let activeSnapshot: CanvasReadOnlyState = CANVAS_EDITABLE_STATE

function sameState(a: CanvasReadOnlyState, b: CanvasReadOnlyState): boolean {
  return a.readOnly === b.readOnly
    && a.reason === b.reason
    && a.hiddenNodeCount === b.hiddenNodeCount
    && a.atMaxZoom === b.atMaxZoom
}

/** 由当前渲染中的 GraphCanvas 在 layout effect 里调用；scope 用 tabId 隔离多标签页。 */
export function publishCanvasReadOnly(scope: string, zoom: number, hiddenNodeCount: number): void {
  const next = computeCanvasReadOnly(zoom, hiddenNodeCount)
  states.set(scope, next)
  activeScope = scope
  // 比较的是「当前对外快照」而不是本 scope 的旧值：切换 tab 时即使新 tab 状态与
  // 自身旧状态相同，也可能与旧 tab 的快照不同，必须通知订阅者。
  const changed = !sameState(activeSnapshot, next)
  activeSnapshot = next
  if (changed) {
    for (const listener of listeners) listener()
  }
}

export function clearCanvasReadOnly(scope: string): void {
  if (!states.delete(scope)) return
  if (activeScope !== scope) return
  activeScope = ''
  if (sameState(activeSnapshot, CANVAS_EDITABLE_STATE)) return
  activeSnapshot = CANVAS_EDITABLE_STATE
  for (const listener of listeners) listener()
}

/** 精确按 tab 查询：useGraph 的编辑闸门用这个，非活动标签页不会被误锁。 */
export function isCanvasReadOnly(scope: string): boolean {
  return states.get(scope)?.readOnly ?? false
}

export function getActiveCanvasReadOnly(): CanvasReadOnlyState {
  return activeSnapshot
}

/** 事件回调 / 非 React 代码里的兜底判定。 */
export function isActiveCanvasReadOnly(): boolean {
  return activeSnapshot.readOnly
}

/**
 * 叶子组件（卡片 / 连线）只订阅布尔本身：缩放过程中 hiddenNodeCount 每个 2% 台阶都变，
 * 若订阅整个 state 对象，所有可见卡片都会跟着重渲染，撞上「缩放期零重渲染」铁律。
 * useSyncExternalStore 会按 Object.is 比较布尔值，readOnly 不变时通知被自动丢弃。
 */
export function useActiveCanvasReadOnly(): boolean {
  return useSyncExternalStore(subscribeCanvasReadOnly, isActiveCanvasReadOnly, isActiveCanvasReadOnly)
}

function subscribeCanvasReadOnly(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
