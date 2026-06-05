import { memo, useEffect, useMemo, useState } from 'react'

import type { LearningApi, WorkspaceApi } from '../../public'
import { formatDuration, getDateStr, getPastDays, startOfDay } from './analytics.ts'
import { useLearningRuntimeState } from './useLearningRuntimeState.ts'

const PREVIEW_DAYS = 14

export const LearningQuickPreview = memo(function LearningQuickPreview({
  learning,
  workspace,
}: {
  learning: LearningApi
  workspace: WorkspaceApi
}) {
  const { isActive, todayDuration, meta } = useLearningRuntimeState(learning)
  const [loading, setLoading] = useState(true)
  const [heatmapData, setHeatmapData] = useState<Record<string, number>>({})
  const [workspaceVersion, setWorkspaceVersion] = useState(0)

  useEffect(() => {
    const subscription = workspace.subscribeCurrentWorkspaceId(() => {
      setWorkspaceVersion((value) => value + 1)
    })
    return () => {
      subscription.dispose()
    }
  }, [workspace])

  useEffect(() => {
    let disposed = false
    setLoading(true)

    const load = async () => {
      try {
        const summary = await learning.getSummary({ days: PREVIEW_DAYS })
        if (!disposed) {
          setHeatmapData(summary)
        }
      } catch (error) {
        console.error(error)
        if (!disposed) {
          setHeatmapData({})
        }
      } finally {
        if (!disposed) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      disposed = true
    }
  }, [learning, workspaceVersion])

  const days = useMemo(() => getPastDays(PREVIEW_DAYS), [])
  const todayStr = useMemo(() => getDateStr(startOfDay(new Date())), [])
  const totalDuration = meta?.summary.totalDuration || 0
  const streak = meta?.summary.currentStreak || 0
  const goal = meta?.settings.dailyGoal || 3600 * 2

  const getColor = (duration: number) => {
    if (duration === 0) return 'bg-[var(--color-bg-muted)] border border-[var(--color-border-subtle)]'
    const ratio = duration / goal
    if (ratio < 0.25) return 'bg-[#fdd9c9]'
    if (ratio < 0.5) return 'bg-[#f3ae8f]'
    if (ratio < 0.75) return 'bg-[#df6f54]'
    return 'bg-[#c63d34]'
  }

  return (
    <div className="w-[300px] flex flex-col gap-3 text-[var(--color-text-primary)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] text-[var(--color-text-muted)]">今日学习</div>
          <div className="mt-1 text-[22px] leading-none font-semibold font-mono text-[var(--color-primary)]">
            {Math.floor(todayDuration / 3600)}h {Math.floor((todayDuration % 3600) / 60)}m
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-[var(--color-text-muted)]">状态</div>
          <div className={`mt-1 text-[12px] font-medium ${isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}`}>
            {isActive ? '学习中' : '已暂停'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
          <div className="text-[11px] text-[var(--color-text-muted)]">连续天数</div>
          <div className="mt-1 text-[16px] font-semibold font-mono text-[var(--color-primary)]">{streak} 天</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
          <div className="text-[11px] text-[var(--color-text-muted)]">累计时长</div>
          <div className="mt-1 text-[16px] font-semibold font-mono text-[var(--color-primary)]">{formatDuration(totalDuration)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] font-medium">最近 14 天</div>
          <div className="text-[11px] text-[var(--color-text-muted)]">点击查看完整统计</div>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {loading ? (
            Array.from({ length: PREVIEW_DAYS }).map((_, index) => (
              <div key={index} className="w-[14px] h-[14px] rounded-[4px] bg-[var(--color-bg-muted)] animate-pulse" />
            ))
          ) : (
            days.map((date) => {
              const duration = date === todayStr ? todayDuration : (heatmapData[date] || 0)
              return (
                <div
                  key={date}
                  className={`w-[14px] h-[14px] rounded-[4px] ${getColor(duration)}`}
                  title={`${date}: ${formatDuration(duration)}`}
                />
              )
            })
          )}
        </div>
      </div>
    </div>
  )
})
