import { useEffect } from 'react'
import { useLearningTrackerStore } from './model/learningTrackerStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

export function LearningTrackerProvider({ children }: { children: React.ReactNode }) {
  const { init, recordActivity, setIdle, shutdown } = useLearningTrackerStore()
  const workspaceRoot = useWorkspaceStore(s => s.currentWorkspaceRoot)

  useEffect(() => {
    if (!workspaceRoot) return

    void init()

    return () => {
      void shutdown(workspaceRoot)
    }
  }, [workspaceRoot, init, shutdown])

  useEffect(() => {
    if (!workspaceRoot) return

    let throttleTimer: any = null
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

    const handleWindowBlur = () => {
      setIdle()
    }

    window.addEventListener('mousemove', handleActivity)
    window.addEventListener('mousedown', handleActivity)
    window.addEventListener('keydown', handleActivity)
    window.addEventListener('scroll', handleActivity, true)
    window.addEventListener('blur', handleWindowBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('mousemove', handleActivity)
      window.removeEventListener('mousedown', handleActivity)
      window.removeEventListener('keydown', handleActivity)
      window.removeEventListener('scroll', handleActivity, true)
      window.removeEventListener('blur', handleWindowBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (throttleTimer) clearTimeout(throttleTimer)
    }
  }, [workspaceRoot, recordActivity, setIdle])

  return <>{children}</>
}
