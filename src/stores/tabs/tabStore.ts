import { useShallow } from 'zustand/react/shallow'
import { create } from 'zustand'
import { attachStateObservation } from '../../core/observabilityStoreMiddleware.ts'
import {
  createTabLifecycleActions,
  createTabRoomActions,
  createTabSelectors,
} from './tabActions'
import { TAB_INITIAL_STATE } from './tabState'
import { useRightPanelStore } from '../rightPanelStore'
import type { TabState } from './tabTypes'

export type { GraphSession, Tab, TabState } from './tabTypes'

export const tabStore = create<TabState>()((set, get) => ({
  ...TAB_INITIAL_STATE,
  ...createTabLifecycleActions(set, get),
  ...createTabSelectors(get),
  ...createTabRoomActions(set, get),
}))

export const useTabStore = tabStore

/**
 * 右栏展开/折叠等状态按知识库(kbPath)独立维护，作用域必须在活跃标签页变化的同时切换。
 *
 * 这里用 store 订阅而不是 App 里的 useEffect：App 把所有 KB 标签页常驻挂载，React effect
 * 是「子先父后」，父级 effect 执行前其它标签页的 resize / focus effect 已经跑过一轮，
 * 会把状态写进上一个知识库的分桶。订阅发生在 tabStore 的同一次 set 事务内，早于任何渲染。
 * 房间切换也会改 tabs 数组，但 kbPath 不变时 setActiveKbPath 自行短路，不会打断右栏状态。
 */
tabStore.subscribe((state, prevState) => {
  if (state.activeTabId === prevState.activeTabId && state.tabs === prevState.tabs) return
  const activeTab = state.getActiveTab()
  useRightPanelStore.getState().setActiveKbPath(
    activeTab?.type === 'kb' ? activeTab.kbPath : '',
  )
})

export function useGraphSession(tabId: string) {
  // Subscribe with a selector + shallow equality so this only re-renders when the
  // *session fields of this tab* actually change. The previous implementation
  // subscribed to the entire tabStore, so any tab (or room) mutation anywhere
  // re-rendered every consumer (e.g. the whole DocumentWorkspaceLayout).
  // getGraphSession derives a fresh object each call, hence the shallow compare.
  return useTabStore(
    useShallow((state) => state.getGraphSession(tabId)),
  )
}

// P7 M3：tab 列表/激活态变更自动补一条内存步骤（不落盘）。
attachStateObservation(tabStore, { name: 'tabs' })
