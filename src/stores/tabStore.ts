import { useMemo } from 'react'
import { create } from 'zustand'
import {
  createTabLifecycleActions,
  createTabRoomActions,
  createTabSelectors,
} from './tabActions'
import { TAB_INITIAL_STATE } from './tabState'
import type { TabState } from './tabTypes'

export type { GraphSession, Tab, TabState } from './tabTypes'

export const tabStore = create<TabState>()((set, get) => ({
  ...TAB_INITIAL_STATE,
  ...createTabLifecycleActions(set, get),
  ...createTabSelectors(get),
  ...createTabRoomActions(set, get),
}))

export const useTabStore = tabStore

export function useGraphSession(tabId: string) {
  const tab = useTabStore((s) => s.getTabById(tabId))

  return useMemo(() => {
    return tabStore.getState().getGraphSession(tabId)
  }, [tab, tabId])
}
