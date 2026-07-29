import { useEffect } from 'react'
import { useLearningTrackerStore } from './model/learningTrackerStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

export function LearningTrackerProvider({ children }: { children: React.ReactNode }) {
  const { init, recordActivity, setIdle, shutdown } = useLearningTrackerStore()
  const workspacePath = useWorkspaceStore(s => s.currentWorkDir)

  useEffect(() => {
    if (!workspacePath) return

    void init().catch((error) => {
      console.error('Failed to init learning tracker:', error)
    })

    return () => {
      shutdown(workspacePath).catch((error) => {
        console.error('Failed to shutdown learning tracker:', error)
      })
    }
  }, [workspacePath, init, shutdown])

  useEffect(() => {
    if (!workspacePath) return

    let throttleTimer: ReturnType<typeof setTimeout> | null = null
    const handleActivity = () => {
      if (!throttleTimer) {
        recordActivity()
        throttleTimer = setTimeout(() => {
          throttleTimer = null
        }, 1000) // Throttle 1 second
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        setIdle()
      }
    }

    const handleWindowStateChange = (...args: unknown[]) => {
      const state = args[0] as { isFocused: boolean } | undefined
      if (state && !state.isFocused) {
        setIdle()
      }
    }

    const handleWindowBlur = () => {
      setIdle()
    }

    window.addEventListener('mousemove', handleActivity)
    window.addEventListener('mousedown', handleActivity)
    window.addEventListener('keydown', handleActivity)
    window.addEventListener('scroll', handleActivity, true)
    window.addEventListener('blur', handleWindowBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.electronAPI?.on('app:window-state-change', handleWindowStateChange)

    return () => {
      window.removeEventListener('mousemove', handleActivity)
      window.removeEventListener('mousedown', handleActivity)
      window.removeEventListener('keydown', handleActivity)
      window.removeEventListener('scroll', handleActivity, true)
      window.removeEventListener('blur', handleWindowBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.electronAPI?.off('app:window-state-change', handleWindowStateChange)
      if (throttleTimer) clearTimeout(throttleTimer)
    }
  }, [workspacePath, recordActivity, setIdle])

  return <>{children}</>
}
