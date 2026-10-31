import { useShallow } from 'zustand/react/shallow'
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
  // Subscribe with a selector + shallow equality so this only re-renders when the
  // *session fields of this tab* actually change. The previous implementation
  // subscribed to the entire tabStore, so any tab (or room) mutation anywhere
  // re-rendered every consumer (e.g. the whole DocumentWorkspaceLayout).
  // getGraphSession derives a fresh object each call, hence the shallow compare.
  return useTabStore(
    useShallow((state) => state.getGraphSession(tabId)),
  )
}
