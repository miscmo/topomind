import { create } from 'zustand'
import {
  createTabDirtyActions,
  createTabLifecycleActions,
  createTabRoomActions,
  createTabSelectors,
  createTabSelectionActions,
} from './tabActions'
import { TAB_INITIAL_STATE } from './tabState'
import type { TabState } from './tabTypes'

export type { Tab, TabState } from './tabTypes'

export const tabStore = create<TabState>()((set, get) => ({
  ...TAB_INITIAL_STATE,
  ...createTabLifecycleActions(set, get),
  ...createTabDirtyActions(set),
  ...createTabSelectors(get),
  ...createTabRoomActions(set, get),
  ...createTabSelectionActions(set, get),
}))

export const useTabStore = tabStore
