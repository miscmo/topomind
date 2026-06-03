import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { useLearningTrackerStore } from '../model/learningTrackerStore'
import { LearningQuickPreview } from './LearningQuickPreview'
import { useTabStore } from '../../../stores/tabs/tabStore'

const formatDuration = (seconds: number) => {
  if (!seconds) return '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export const LearningTrackerWidget = memo(function LearningTrackerWidget() {
  const isActive = useLearningTrackerStore(s => s.isActive)
  const todayDuration = useLearningTrackerStore(s => s.todayDuration)
  const openStatisticsTab = useTabStore(s => s.openStatisticsTab)
  const [previewOpen, setPreviewOpen] = useState(false)
  const widgetRef = useRef<HTMLDivElement>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const openPreview = useCallback(() => {
    clearTimers()
    openTimerRef.current = setTimeout(() => {
      setPreviewOpen(true)
      openTimerRef.current = null
    }, 160)
  }, [clearTimers])

  const closePreview = useCallback(() => {
    clearTimers()
    closeTimerRef.current = setTimeout(() => {
      setPreviewOpen(false)
      closeTimerRef.current = null
    }, 120)
  }, [clearTimers])

  useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [clearTimers])

  return (
    <div
      className="relative flex items-center h-full z-[4001]"
      ref={widgetRef}
      style={{ WebkitAppRegion: 'no-drag' } as any}
      onPointerEnter={openPreview}
      onPointerLeave={closePreview}
    >
      <button
        type="button"
        className={`flex items-center gap-1.5 px-2 h-[24px] rounded-md text-[12px] transition-colors border select-none
          ${isActive 
            ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)] border-[var(--color-primary-alpha)] hover:bg-[var(--color-primary-alpha)]' 
            : 'bg-[var(--color-bg-muted)] text-[var(--color-text-muted)] border-transparent hover:bg-[var(--color-hover-bg)]'
          }`}
        onClick={() => {
          setPreviewOpen(false)
          openStatisticsTab()
        }}
        title={isActive ? "正在学习中" : "休息中"}
      >
        <span className="relative flex h-2 w-2">
          <span className={`relative inline-flex rounded-full h-2 w-2 ${isActive ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-text-muted)]'}`}></span>
        </span>
        <span className="font-medium font-mono tracking-tight">{formatDuration(todayDuration)}</span>
      </button>

      {previewOpen && (
        <div className="absolute top-[calc(100%+8px)] left-0 min-w-[320px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] z-[4000] p-4 animate-in fade-in slide-in-from-top-2">
          <LearningQuickPreview />
        </div>
      )}
    </div>
  )
})
