import { create } from 'zustand'
import type { Viewport } from '@xyflow/react'
import { useTabStore } from '../../../../stores/tabs/tabStore'
import {
  VIEWPORT_RETURN_SETTLE_MS,
  shouldOfferViewportReturn,
  type ViewportReturnEntry,
  type ViewportSnapshot,
} from '../../../../domain/graph/viewportReturn'

/**
 * 「返回上个视野」的运行时状态：按 tab 隔离、只保留最近一次跳转、不持久化。
 * 视口是瞬时上下文，刷新后不该冒出一个指向旧镜头的按钮，故不进 localStorage、不进 undo。
 */
interface ViewportReturnState {
  entries: Record<string, ViewportReturnEntry>
  record: (tabId: string, entry: ViewportReturnEntry) => void
  dismiss: (tabId: string) => void
}

export const useViewportReturnStore = create<ViewportReturnState>((set) => ({
  entries: {},
  record: (tabId, entry) => set((state) => ({
    entries: { ...state.entries, [tabId]: entry },
  })),
  dismiss: (tabId) => set((state) => {
    if (!(tabId in state.entries)) return state
    const entries = { ...state.entries }
    delete entries[tabId]
    return { entries }
  }),
}))

interface ReactFlowViewportReader {
  getViewport: () => Viewport
}

/** 连续跳转时只认最后一次，避免早先的定时器把新跳转的落点覆盖掉。 */
const jumpTokenByTab = new Map<string, number>()

/**
 * 只在「程序化跳转到某个节点」的入口调用，且必须在 setCenter 之前。
 * 手动平移 / 滚轮缩放不经过这里，因此不会污染返回历史。
 *
 * 不直接把目标中心换算成 viewport：setCenter 带动画，且不同 lineMode 的落点计算
 * 由 React Flow 负责；等镜头停稳后采样真实 getViewport() 最可靠，也少一套坐标换算。
 */
export function rememberViewportJump(
  reactFlow: ReactFlowViewportReader,
  label: string,
): void {
  const tabId = useTabStore.getState().activeTabId ?? ''
  if (!tabId) return
  const token = (jumpTokenByTab.get(tabId) ?? 0) + 1
  jumpTokenByTab.set(tabId, token)
  const from: ViewportSnapshot = { ...reactFlow.getViewport() }

  window.setTimeout(() => {
    if (jumpTokenByTab.get(tabId) !== token) return
    const to: ViewportSnapshot = { ...reactFlow.getViewport() }
    const store = useViewportReturnStore.getState()
    if (!shouldOfferViewportReturn(from, to)) {
      store.dismiss(tabId)
      return
    }
    store.record(tabId, {
      from,
      to,
      label: label.trim() || '上一个位置',
      createdAt: Date.now(),
    })
  }, VIEWPORT_RETURN_SETTLE_MS)
}
