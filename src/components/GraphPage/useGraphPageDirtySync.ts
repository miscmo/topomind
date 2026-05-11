import { useEffect, useRef } from 'react'
import { tabStore } from '../../stores/tabStore'

export interface UseGraphPageDirtySyncOptions {
  tabId: string
  onDirtyChange: (callback: (isModified: boolean) => void) => () => void
}

export function useGraphPageDirtySync(options: UseGraphPageDirtySyncOptions) {
  const { tabId, onDirtyChange } = options

  const setTabDirtyRef = useRef<(tabId: string, isDirty: boolean) => void>()
  setTabDirtyRef.current = (tid, isDirty) => {
    tabStore.getState().setTabDirty(tid, isDirty)
  }

  useEffect(() => {
    return onDirtyChange((isModified: boolean) => {
      setTabDirtyRef.current!(tabId, isModified)
    })
  }, [tabId, onDirtyChange])
}
