import { useCallback, useRef, useState } from 'react'

export function useGraphDirtyState() {
  const [isModified, setIsModified] = useState(false)
  const isModifiedRef = useRef(false)
  const dirtyChangeCallbacksRef = useRef<Set<(isModified: boolean) => void>>(new Set())

  const setDirtyState = useCallback((next: boolean) => {
    if (isModifiedRef.current === next) return
    isModifiedRef.current = next
    setIsModified(next)
    dirtyChangeCallbacksRef.current.forEach((cb) => cb(next))
  }, [])

  const onDirtyChange = useCallback((callback: (isModified: boolean) => void) => {
    dirtyChangeCallbacksRef.current.add(callback)
    callback(isModifiedRef.current)
    return () => {
      dirtyChangeCallbacksRef.current.delete(callback)
    }
  }, [])

  return {
    isModified,
    setDirtyState,
    onDirtyChange,
  }
}
