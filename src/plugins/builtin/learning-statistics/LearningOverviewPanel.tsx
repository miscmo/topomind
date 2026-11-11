import { memo, useMemo } from 'react'
import type { LearningStatsMetaSnapshot as LearningStatsMeta } from '../../public'
import type {
  RangeAnalytics,
  TrendComparison,
  TrendPoint,
} from './analytics.ts'
import {
  WEEKDAY_LABELS,
  buildHeatmapWeeks,
  formatDuration,
  formatDurationCompact,
  formatHourLabel,
  getDateStr,
} from './analytics.ts'
import {
  HEAT_CELL_CLASS,
  HEAT_CELL_SIZE,
  HeatCell,
  MUTED_CLASS,
  MetricTile,
  ProgressBar,
  SectionCard,
  heatCellStyle,
} from './LearningStatisticsParts.tsx'

interface LearningOverviewPanelProps {
  isActive: boolean
  meta: LearningStatsMeta | null
  todayDuration: number
  dailyGoal: number
  rangeDays: number
  durationByDate: Record<string, number>
  analytics: RangeAnalytics
  trendPoints: TrendPoint[]
  trendComparison: TrendComparison
  selectedDate: string | null
  hoveredDay: { date: string; duration: number } | null
  onHoverDay: (day: { date: string; duration: number } | null) => void
  onSelectDate: (date: string | null) => void
}

export const LearningOverviewPanel = memo(function LearningOverviewPanel({
  isActive,
  meta,
  todayDuration,
  dailyGoal,
  rangeDays,
  durationByDate,
  analytics,
  trendPoints,
  trendComparison,
  selectedDate,
  hoveredDay,
  onHoverDay,
  onSelectDate,
}: LearningOverviewPanelProps) {
  const todayStr = getDateStr(new Date())
  const heatmap = useMemo(() => buildHeatmapWeeks(rangeDays), [rangeDays])
  const maxTrendDuration = Math.max(...trendPoints.map((point) => point.duration), 1)
  const labelStep = trendPoints.length > 20 ? 5 : trendPoints.length > 10 ? 2 : 1
  const todayRemaining = Math.max(0, dailyGoal - todayDuration)
  const todayRatio = todayDuration / Math.max(dailyGoal, 1)
  const trendDelta = formatDurationCompact(Math.abs(trendComparison.deltaSeconds))
  const trendSummary = trendComparison.direction === 'up'
    ? `较上周期 +${trendDelta} / 日`
    : trendComparison.direction === 'down'
      ? `较上周期 -${trendDelta} / 日`
      : '与上一周期持平'
  const habitSummary = analytics.topWeekday === null || analytics.peakHour === null
    ? '暂无足够记录判断学习习惯'
    : `最常在 周${WEEKDAY_LABELS[analytics.topWeekday]} · ${formatHourLabel(analytics.peakHour)} 学习`

  return (
    <div className="flex flex-col gap-5" data-tm-learning-overview="">
      <section
        className="rounded-2xl border border-[var(--color-accent-soft)] bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--color-surface))] p-5"
        data-tm-learning-hero=""
      >
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div>
              <div className={`text-[12px] ${MUTED_CLASS}`}>今日学习</div>
              <div className="mt-2 text-[32px] leading-none font-semibold text-[var(--color-accent)]">
                {formatDuration(todayDuration)}
              </div>
            </div>
            <div className={`flex items-center gap-1.5 text-[12px] ${MUTED_CLASS}`}>
              <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'}`} />
              {isActive ? '学习中' : '已暂停'}
            </div>
          </div>

          <div className="min-w-[240px] max-w-[420px] flex-1">
            <div className="flex items-center justify-between gap-3 text-[12px]">
              <span className={MUTED_CLASS}>日目标 {formatDurationCompact(dailyGoal)}</span>
              <span className="font-medium">{Math.round(todayRatio * 100)}%</span>
            </div>
            <div className="mt-2">
              <ProgressBar ratio={todayRatio} />
            </div>
            <div className={`mt-2 text-[11px] ${MUTED_CLASS}`}>
              {todayRemaining > 0 ? `还差 ${formatDurationCompact(todayRemaining)}` : '今日目标已达成'}
            </div>
          </div>
        </div>

        <div className={`mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--color-border-subtle)] pt-3 text-[12px] ${MUTED_CLASS}`}>
          <span>连续 <span className="font-medium text-[var(--color-text-primary)]">{meta?.summary.currentStreak || 0}</span> 天</span>
          <span>最长 <span className="font-medium text-[var(--color-text-primary)]">{meta?.summary.longestStreak || 0}</span> 天</span>
          <span>累计 <span className="font-medium text-[var(--color-text-primary)]">{formatDurationCompact(meta?.summary.totalDuration || 0)}</span></span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-tm-learning-kpi="">
        <MetricTile
          label="范围总时长"
          value={formatDurationCompact(analytics.totalDuration)}
          hint={`最近 ${rangeDays} 天`}
        />
        <MetricTile
          label="日均时长"
          value={formatDurationCompact(analytics.averageDailyDuration)}
          hint={`活跃日均 ${formatDurationCompact(analytics.averageActiveDayDuration)}`}
        />
        <MetricTile
          label="活跃天数"
          value={`${analytics.activeDays} / ${rangeDays}`}
          hint={`活跃率 ${Math.round(analytics.activeRate * 100)}%`}
        />
        <MetricTile
          label="达标天数"
          value={`${analytics.goalDays} 天`}
          hint={`日目标 ${formatDurationCompact(dailyGoal)}`}
        />
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard
          title="每日记录"
          testId="heatmap"
          aside={
            <span className={`text-[12px] ${MUTED_CLASS}`}>
              {hoveredDay
                ? `${hoveredDay.date} · ${formatDurationCompact(hoveredDay.duration)}`
                : selectedDate
                  ? `${selectedDate} · ${formatDurationCompact(durationByDate[selectedDate] || 0)}`
                  : '悬停查看时长'}
            </span>
          }
        >
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            <div className="pt-5 pr-1 flex flex-col" style={{ gap: 4 }}>
              {WEEKDAY_LABELS.map((label, index) => (
                <div key={label} className="text-[10px] leading-[13px]" style={{ height: HEAT_CELL_SIZE }}>
                  {index % 2 === 1 ? label : ''}
                </div>
              ))}
            </div>
            <div className="min-w-0">
              <div
                className="mb-1 grid gap-1 text-[10px] text-[var(--color-text-muted)]"
                style={{ gridTemplateColumns: `repeat(${heatmap.weeks.length}, ${HEAT_CELL_SIZE}px)` }}
              >
                {Array.from({ length: heatmap.weeks.length }).map((_, index) => (
                  <div key={`month-${index}`} className="h-4 leading-4 whitespace-nowrap overflow-visible">
                    {heatmap.monthLabels.find((item) => item.column === index)?.label || ''}
                  </div>
                ))}
              </div>
              <div
                className="grid grid-flow-col gap-1"
                style={{
                  gridTemplateRows: `repeat(7, ${HEAT_CELL_SIZE}px)`,
                  gridTemplateColumns: `repeat(${heatmap.weeks.length}, ${HEAT_CELL_SIZE}px)`,
                }}
              >
                {heatmap.weeks.flatMap((week, weekIndex) =>
                  week.map((date) => {
                    const inRange = date >= getDateStr(heatmap.startDate) && date <= todayStr
                    const duration = durationByDate[date] || 0
                    return (
                      <HeatCell
                        key={`${weekIndex}-${date}`}
                        active={inRange}
                        duration={duration}
                        capacity={dailyGoal}
                        label={`${date}: ${formatDuration(duration)}`}
                        selected={selectedDate === date}
                        onHover={(hovering) => {
                          if (hovering) onHoverDay({ date, duration })
                          else if (hoveredDay?.date === date) onHoverDay(null)
                        }}
                        onSelect={() => onSelectDate(selectedDate === date ? null : date)}
                      />
                    )
                  }),
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <span>少</span>
            {[0, 0.3, 0.55, 0.8, 1.2].map((ratio) => (
              <span
                key={ratio}
                className={HEAT_CELL_CLASS}
                style={heatCellStyle(ratio * dailyGoal, dailyGoal)}
              />
            ))}
            <span>多</span>
            <span className="ml-auto">点击日期查看明细</span>
          </div>
        </SectionCard>

        <SectionCard
          title="学习趋势"
          testId="trend"
          aside={<span className="text-[12px] font-medium text-[var(--color-accent)]">{trendSummary}</span>}
        >
          <div className="mt-4 flex items-end gap-1 h-[150px] overflow-x-auto pb-2">
            {trendPoints.map((point, index) => (
              <div key={point.key} className="flex min-w-[12px] flex-1 flex-col items-center justify-end gap-1.5 h-full">
                <div
                  className="w-full rounded-t-sm bg-[color-mix(in_srgb,var(--color-accent)_72%,transparent)]"
                  style={{ height: Math.max(4, Math.round((point.duration / maxTrendDuration) * 118)) }}
                  title={`${point.label}: ${formatDuration(point.duration)}`}
                />
                <div className={`h-3 text-[9px] ${MUTED_CLASS}`}>
                  {index % labelStep === 0 || index === trendPoints.length - 1 ? point.label : ''}
                </div>
              </div>
            ))}
          </div>

          <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] pt-3 text-[11px] ${MUTED_CLASS}`}>
            <span>{habitSummary}</span>
            <span>
              单日峰值 {analytics.bestDay ? formatDurationCompact(analytics.bestDay.duration) : '0m'}
              {analytics.bestDay ? ` · ${analytics.bestDay.date}` : ''}
            </span>
          </div>
        </SectionCard>
      </div>
    </div>
  )
})
