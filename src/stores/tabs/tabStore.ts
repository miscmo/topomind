import { useMemo, useState, useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { StoreApi } from 'zustand'
import {
  createTabLifecycleActions,
  createTabRoomActions,
  createTabSelectors,
} from './tabActions'
import { TAB_INITIAL_STATE } from './tabState'
import type { TabState, GraphSession } from './tabTypes'

export type { GraphSession, Tab, TabState } from './tabTypes'

export const tabStore = create<TabState>()((set, get) => ({
  ...TAB_INITIAL_STATE,
  ...createTabLifecycleActions(set, get),
  ...createTabSelectors(get),
  ...createTabRoomActions(set, get),
}))

export const useTabStore = tabStore

export function useGraphSession(tabId: string) {
  const [session, setSession] = useState<GraphSession>(() =>
    tabStore.getState().getGraphSession(tabId)
  )

  const tabIdRef = useRef(tabId)
  tabIdRef.current = tabId

  useEffect(() => {
    setSession(tabStore.getState().getGraphSession(tabId))

    const unsubscribe = tabStore.subscribe((state) => {
      setSession(state.getGraphSession(tabIdRef.current))
    })

    return () => {
      unsubscribe()
    }
  }, [tabId])

  return session
}
