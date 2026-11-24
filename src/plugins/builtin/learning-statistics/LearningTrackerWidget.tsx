import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import type { LearningApi, WorkspaceApi } from '../../public'
import { LearningQuickPreview } from './LearningQuickPreview.tsx'
import { useLearningRuntimeState } from './useLearningRuntimeState.ts'

const formatDuration = (seconds: number) => {
  if (!seconds) return '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * 顶栏时长必须等宽：它位于 tab 区左侧，字符串从 "0s" 到 "23h 59m 59s" 长度不同，
 * 按钮宽度一变，整排知识库 tab 就会跟着左右跳。
 *
 * 策略：拿「当日可能出现的最长字符串」做隐形占位撑开盒子，真实文本绝对定位左对齐
 * 叠在同一格里，保留原先「状态点 + 时长」紧挨的观感。不写死 px / ch —— 字体、字号、
 * 字重、字距变化时占位会自动跟着算，也不会因为某台机器字体度量不同而溢出。数字再加
 * tabular-nums，保证每一位数占同样宽。
 *
 * todayDuration 是当日累计秒数，跨天在 tick 里归零，合法上限 24h - 1s，所以两位
 * 小时就是最长形态；即便异常数据超出这个范围，真实文本脱离文档流，也不会撑宽盒子、
 * 更不会推动 tab 区。
 */
const MAX_TODAY_SECONDS = 24 * 60 * 60 - 1
const DURATION_WIDTH_SAMPLE = formatDuration(MAX_TODAY_SECONDS)

export const LearningTrackerWidget = memo(function LearningTrackerWidget({
  learning,
  workspace,
  onOpenStatistics,
}: {
  learning: LearningApi
  workspace: WorkspaceApi
  onOpenStatistics: () => void | Promise<void>
}) {
  const { isActive, todayDuration } = useLearningRuntimeState(learning)
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
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      onPointerEnter={openPreview}
      onPointerLeave={closePreview}
    >
      <button
        type="button"
        className={`flex items-center gap-1.5 px-2 h-[24px] rounded-md text-[12px] transition-colors border select-none
          ${isActive
            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent-soft)] hover:bg-[var(--color-selected-bg)]'
            : 'bg-[var(--color-bg-muted)] text-[var(--color-text-muted)] border-transparent hover:bg-[var(--color-hover-bg)]'
          }`}
        onClick={() => {
          setPreviewOpen(false)
          void onOpenStatistics()
        }}
        title={isActive ? '正在学习中' : '休息中'}
      >
        <span className="relative flex h-2 w-2">
          <span className={`relative inline-flex rounded-full h-2 w-2 ${isActive ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'}`} />
        </span>
        <span
          data-tm-learning-duration=""
          className="relative inline-flex shrink-0 justify-start font-medium font-mono tracking-tight tabular-nums whitespace-nowrap"
        >
          <span aria-hidden="true" className="invisible">{DURATION_WIDTH_SAMPLE}</span>
          <span className="absolute inset-y-0 left-0 flex items-center">{formatDuration(todayDuration)}</span>
        </span>
      </button>

      {previewOpen && (
        <div className="absolute top-[calc(100%+8px)] left-0 min-w-[320px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] z-[4000] p-4 tm-popover-enter">
          <LearningQuickPreview learning={learning} workspace={workspace} />
        </div>
      )}
    </div>
  )
})
