import { memo, useMemo, useState } from 'react'

import type { LearningSessionSnapshot as LearningSession } from '../../public'
import type { DayHalfHourBucket } from './analytics.ts'
import {
  HALF_HOUR_SECONDS,
  buildDayHalfHourBuckets,
  formatDurationCompact,
  formatTime,
} from './analytics.ts'
import {
  HEAT_CELL_CLASS,
  HEAT_CELL_SIZE,
  HeatCell,
  MUTED_CLASS,
  heatCellStyle,
} from './LearningStatisticsParts.tsx'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const LEGEND_RATIOS = [0, 0.3, 0.55, 0.8, 1.2]

/**
 * 与「每日记录」同款热力图：2 行 × 24 列正方形格，每列 1 小时，
 * 上行 :00–:30、下行 :30–:00；格子尺寸、色阶、图例、悬停读数都走共用原语。
 */
export const DayHalfHourBlocks = memo(function DayHalfHourBlocks({
  sessions,
  isActive,
  currentSessionId,
  isToday,
}: {
  sessions: LearningSession[]
  isActive: boolean
  currentSessionId: string | null
  isToday: boolean
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const buckets = useMemo(() => buildDayHalfHourBuckets(sessions), [sessions])
  const activeBucketCount = buckets.filter((bucket) => bucket.duration > 0).length
  const activeBucket = selectedIndex === null ? null : buckets[selectedIndex]
  const hoveredBucket = hoveredIndex === null ? null : buckets[hoveredIndex]
  const detailSessions = activeBucket
    ? sessions.filter((session) => activeBucket.sessionIds.includes(session.id)).slice(0, 3)
    : []

  const asideText = hoveredBucket
    ? `${hoveredBucket.label} · ${formatDurationCompact(hoveredBucket.duration)}`
    : activeBucket && activeBucket.duration > 0
      ? `${activeBucket.label} · ${formatDurationCompact(activeBucket.duration)}`
      : sessions.length > 0
        ? `共 ${sessions.length} 次 · 覆盖 ${activeBucketCount} 个半小时`
        : '暂无记录'

  const renderCell = (bucket: DayHalfHourBucket) => (
    <HeatCell
      key={bucket.index}
      duration={bucket.duration}
      capacity={HALF_HOUR_SECONDS}
      label={`${bucket.label} · ${formatDurationCompact(bucket.duration)}`}
      selected={selectedIndex === bucket.index}
      onSelect={() => setSelectedIndex((previous) => previous === bucket.index ? null : bucket.index)}
      onHover={(hovering) => setHoveredIndex(hovering ? bucket.index : null)}
      dataProps={{
        'data-tm-learning-half-hour-block': '',
        'data-tm-half-hour-index': bucket.index,
        'data-tm-half-hour-duration': Math.round(bucket.duration),
      }}
    />
  )

  return (
    <div data-tm-learning-half-hour="">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px] font-medium">学习记录</div>
        <span className={`text-[12px] ${MUTED_CLASS}`} data-tm-learning-half-hour-aside="">
          {asideText}
        </span>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <div className="pt-5 pr-1 flex flex-col" style={{ gap: 4 }}>
          {[':00', ':30'].map((label) => (
            <div key={label} className="text-[10px] leading-[13px]" style={{ height: HEAT_CELL_SIZE }}>
              {label}
            </div>
          ))}
        </div>
        <div className="min-w-0">
          <div
            className="mb-1 grid gap-1 text-[10px] text-[var(--color-text-muted)]"
            style={{ gridTemplateColumns: `repeat(24, ${HEAT_CELL_SIZE}px)` }}
          >
            {HOURS.map((hour) => (
              <div key={`hour-${hour}`} className="h-4 leading-4 whitespace-nowrap overflow-visible">
                {hour % 3 === 0 ? `${String(hour).padStart(2, '0')}` : ''}
              </div>
            ))}
          </div>
          <div
            className="grid grid-flow-col gap-1"
            style={{
              gridTemplateRows: `repeat(2, ${HEAT_CELL_SIZE}px)`,
              gridTemplateColumns: `repeat(24, ${HEAT_CELL_SIZE}px)`,
            }}
            data-tm-learning-half-hour-grid=""
          >
            {buckets.map(renderCell)}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
        <span>少</span>
        {LEGEND_RATIOS.map((ratio) => (
          <span
            key={ratio}
            className={HEAT_CELL_CLASS}
            style={heatCellStyle(ratio * HALF_HOUR_SECONDS, HALF_HOUR_SECONDS)}
          />
        ))}
        <span>多</span>
        <span className="ml-auto">点击方块查看该时段</span>
      </div>

      {activeBucket && activeBucket.duration > 0 ? (
        <div
          className="mt-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] px-4 py-3"
          data-tm-learning-half-hour-detail=""
        >
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <span className="font-medium">{activeBucket.label}</span>
            <span className={MUTED_CLASS}>
              {formatDurationCompact(activeBucket.duration)} · {activeBucket.sessionIds.length} 次
            </span>
          </div>
          {detailSessions.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5">
              {detailSessions.map((session) => {
                const isRunning = isActive && isToday && currentSessionId === session.id
                return (
                  <div key={session.id} className="flex items-center justify-between gap-3 text-[12px]">
                    <span>{formatTime(session.startTime)} - {formatTime(session.endTime)}</span>
                    <span className={MUTED_CLASS}>{isRunning ? '进行中' : '已完成'}</span>
                    <span className="font-semibold text-[var(--color-accent)]">
                      {formatDurationCompact(session.duration)}
                    </span>
                  </div>
                )
              })}
              {activeBucket.sessionIds.length > detailSessions.length ? (
                <span className={`text-[11px] ${MUTED_CLASS}`}>
                  仅显示前 {detailSessions.length} 次
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
