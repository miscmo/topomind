import { memo, useEffect, useMemo, useState } from 'react'

import type { LearningApi, WorkspaceApi } from '../../public'
import { formatDurationCompact, getDateStr, getPastDays, startOfDay } from './analytics.ts'
import { HEAT_CELL_CLASS, HEAT_CELL_SIZE, heatCellStyle } from './LearningStatisticsParts.tsx'
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

  return (
    <div className="w-[300px] flex flex-col gap-3 text-[var(--color-text-primary)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] text-[var(--color-text-muted)]">今日学习</div>
          <div className="mt-1 text-[22px] leading-none font-semibold font-mono text-[var(--color-accent)]">
            {formatDurationCompact(todayDuration)}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]">
          <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'}`} />
          {isActive ? '学习中' : '已暂停'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
          <div className="text-[11px] text-[var(--color-text-muted)]">连续天数</div>
          <div className="mt-1 text-[16px] font-semibold font-mono text-[var(--color-accent)]">{streak} 天</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
          <div className="text-[11px] text-[var(--color-text-muted)]">累计时长</div>
          <div className="mt-1 text-[16px] font-semibold font-mono text-[var(--color-accent)]">{formatDurationCompact(totalDuration)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
        <div className="text-[12px] font-medium">最近 14 天</div>
        <div className="mt-3 grid grid-cols-7 gap-1">
          {loading ? (
            Array.from({ length: PREVIEW_DAYS }).map((_, index) => (
              <div
                key={index}
                className={`${HEAT_CELL_CLASS} bg-[var(--color-bg-muted)] animate-pulse`}
                style={{ width: HEAT_CELL_SIZE, height: HEAT_CELL_SIZE }}
              />
            ))
          ) : (
            days.map((date) => {
              const duration = date === todayStr ? todayDuration : (heatmapData[date] || 0)
              return (
                <div
                  key={date}
                  className={HEAT_CELL_CLASS}
                  style={heatCellStyle(duration, goal)}
                  title={`${date}: ${formatDurationCompact(duration)}`}
                />
              )
            })
          )}
        </div>
      </div>
    </div>
  )
})
