import { useRef, useEffect } from 'react'
import { tabStore } from '../stores/tabStore'

export interface UseTabDirtySyncOptions {
  tabId?: string
  onDirtyChange: (callback: (isModified: boolean) => void) => () => void
}

export function useTabDirtySync(options: UseTabDirtySyncOptions) {
  const { tabId, onDirtyChange } = options

  const setTabDirtyRef = useRef<(tabId: string, isDirty: boolean) => void>()
  setTabDirtyRef.current = (tid, isDirty) => {
    tabStore.getState().setTabDirty(tid, isDirty)
  }

  useEffect(() => {
    if (!tabId) return
    return onDirtyChange((isModified: boolean) => {
      setTabDirtyRef.current!(tabId, isModified)
    })
  }, [tabId, onDirtyChange])
}
