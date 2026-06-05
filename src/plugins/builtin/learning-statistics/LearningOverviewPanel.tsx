import { memo, useMemo } from 'react'
import type { LearningStatsMetaSnapshot as LearningStatsMeta } from '../../public'
import type {
  GoalAnalytics,
  RangeAnalytics,
  StatisticsRangeKey,
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

interface LearningOverviewPanelProps {
  isActive: boolean
  meta: LearningStatsMeta | null
  todayDuration: number
  recentWeekDuration: number
  recentMonthDuration: number
  totalDuration: number
  selectedRange: StatisticsRangeKey
  durationByDate: Record<string, number>
  analytics: RangeAnalytics
  goalAnalytics: GoalAnalytics
  trendPoints: TrendPoint[]
  trendComparison: TrendComparison
  selectedDate: string | null
  hoveredDay: { date: string; duration: number } | null
  hasContextFilter: boolean
  contextFilterLabel: string
  onHoverDay: (day: { date: string; duration: number } | null) => void
  onSelectDate: (date: string | null) => void
}

const getHeatColorClass = (duration: number, dailyGoal: number) => {
  if (duration === 0) return 'bg-[var(--color-bg-muted)] border border-[var(--color-border-subtle)]'
  const ratio = duration / dailyGoal
  if (ratio < 0.25) return 'bg-[#fdd9c9] dark:bg-[#4d2f26]'
  if (ratio < 0.5) return 'bg-[#f3ae8f] dark:bg-[#74412e]'
  if (ratio < 0.75) return 'bg-[#df6f54] dark:bg-[#9f3c2c]'
  return 'bg-[#c63d34] dark:bg-[#d85a42]'
}

export const LearningOverviewPanel = memo(function LearningOverviewPanel({
  isActive,
  meta,
  todayDuration,
  recentWeekDuration,
  recentMonthDuration,
  totalDuration,
  selectedRange,
  durationByDate,
  analytics,
  goalAnalytics,
  trendPoints,
  trendComparison,
  selectedDate,
  hoveredDay,
  hasContextFilter,
  contextFilterLabel,
  onHoverDay,
  onSelectDate,
}: LearningOverviewPanelProps) {
  const rangeDays = selectedRange === '7d' ? 7 : selectedRange === '30d' ? 30 : 90
  const dailyGoal = goalAnalytics.dailyGoal
  const todayStr = getDateStr(new Date())
  const heatmap = useMemo(() => buildHeatmapWeeks(rangeDays), [rangeDays])
  const maxTrendDuration = Math.max(...trendPoints.map(point => point.duration), dailyGoal)
  const maxWeekdayDuration = Math.max(...analytics.weekdayDistribution.map(item => item.duration), 1)
  const topHourSlots = [...analytics.hourDistribution]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 6)
  const maxHourDuration = Math.max(...topHourSlots.map(item => item.duration), 1)
  const trendToneClass = trendComparison.direction === 'up'
    ? 'text-emerald-600'
    : trendComparison.direction === 'down'
      ? 'text-amber-600'
      : 'text-[var(--color-text-primary)]'
  const trendSummary = trendComparison.direction === 'up'
    ? '较上一周期提升'
    : trendComparison.direction === 'down'
      ? '较上一周期回落'
      : '与上一周期基本持平'
  const todayGoalRate = Math.round(goalAnalytics.todayCompletionRate * 100)
  const weekGoalRate = Math.round(goalAnalytics.currentWeekCompletionRate * 100)
  const last7GoalRate = Math.round(goalAnalytics.last7GoalRate * 100)
  const rangeGoalRate = Math.round(goalAnalytics.rangeGoalRate * 100)
  const weekPaceToneClass = goalAnalytics.currentWeekPaceDelta > 60
    ? 'text-emerald-600'
    : goalAnalytics.currentWeekPaceDelta < -60
      ? 'text-amber-600'
      : 'text-[var(--color-text-primary)]'
  const weekPaceSummary = goalAnalytics.currentWeekPaceDelta > 60
    ? '快于本周目标节奏'
    : goalAnalytics.currentWeekPaceDelta < -60
      ? '低于本周目标节奏'
      : '与本周目标节奏接近'

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-primary)_7%,var(--color-surface))] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">Now Learning</div>
            <div className="mt-2 text-[30px] leading-none font-semibold text-[var(--color-primary)]">
              {formatDuration(todayDuration)}
            </div>
            <div className="mt-2 text-[13px] text-[var(--color-text-muted)]">
              {isActive ? '当前正在学习中，时长会持续累加。' : '当前处于暂停状态，等待新的应用内操作。'}
            </div>
          </div>
          <div className="rounded-full border border-[var(--color-primary-alpha)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-primary)]">
            {isActive ? '学习中' : '已暂停'}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-[12px] text-[var(--color-text-muted)]">今日学习时长</div>
          <div className="mt-2 text-[18px] font-semibold text-[var(--color-primary)]">{formatDuration(todayDuration)}</div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-[12px] text-[var(--color-text-muted)]">最近 7 天</div>
          <div className="mt-2 text-[18px] font-semibold text-[var(--color-primary)]">{formatDuration(recentWeekDuration)}</div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-[12px] text-[var(--color-text-muted)]">最近 30 天</div>
          <div className="mt-2 text-[18px] font-semibold text-[var(--color-primary)]">{formatDuration(recentMonthDuration)}</div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-[12px] text-[var(--color-text-muted)]">总累计</div>
          <div className="mt-2 text-[18px] font-semibold text-[var(--color-primary)]">{formatDuration(totalDuration)}</div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-[12px] text-[var(--color-text-muted)]">当前连续天数</div>
          <div className="mt-2 text-[18px] font-semibold text-[var(--color-primary)]">{meta?.summary.currentStreak || 0} 天</div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-[12px] text-[var(--color-text-muted)]">最长连续天数</div>
          <div className="mt-2 text-[18px] font-semibold text-[var(--color-primary)]">{meta?.summary.longestStreak || 0} 天</div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold">学习热力图</div>
            <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              {hasContextFilter
                ? `最近 ${rangeDays} 天的学习记录，已按 ${contextFilterLabel} 筛选`
                : `最近 ${rangeDays} 天的学习记录，点击日期可查看右侧明细`}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-right">
            <div className="text-[11px] text-[var(--color-text-muted)]">
              {hoveredDay ? hoveredDay.date : selectedDate || '悬停查看'}
            </div>
            <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)]">
              {hoveredDay ? formatDuration(hoveredDay.duration) : selectedDate ? formatDuration(durationByDate[selectedDate] || 0) : '查看每天的学习时长'}
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          <div className="pt-5 pr-1 text-[11px] text-[var(--color-text-muted)] flex flex-col gap-1.5">
            {WEEKDAY_LABELS.map((label, index) => (
              <div key={label} className="h-[12px] leading-[12px]">
                {index % 2 === 1 ? label : ''}
              </div>
            ))}
          </div>
          <div className="min-w-0">
            <div
              className="grid gap-1 mb-1 text-[11px] text-[var(--color-text-muted)]"
              style={{ gridTemplateColumns: `repeat(${heatmap.weeks.length}, 12px)` }}
            >
              {Array.from({ length: heatmap.weeks.length }).map((_, index) => {
                const label = heatmap.monthLabels.find(item => item.column === index)?.label || ''
                return (
                  <div key={`month-${index}`} className="h-4 leading-4 overflow-visible whitespace-nowrap">
                    {label}
                  </div>
                )
              })}
            </div>
            <div
              className="grid grid-flow-col gap-1"
              style={{ gridTemplateRows: 'repeat(7, 12px)', gridTemplateColumns: `repeat(${heatmap.weeks.length}, 12px)` }}
            >
              {heatmap.weeks.flatMap((week, weekIndex) =>
                week.map(date => {
                  const inRange = date >= getDateStr(heatmap.startDate) && date <= todayStr
                  const duration = durationByDate[date] || 0
                  return (
                    <div
                      key={`${weekIndex}-${date}`}
                      role={inRange ? 'button' : undefined}
                      tabIndex={inRange ? 0 : -1}
                      className={`w-[12px] h-[12px] rounded-[3px] transition-colors ${
                        inRange ? getHeatColorClass(duration, dailyGoal) : 'bg-transparent'
                      } ${
                        selectedDate === date ? 'ring-2 ring-[var(--color-primary)] ring-offset-1 ring-offset-[var(--color-surface)]' : ''
                      }`}
                      onMouseEnter={() => {
                        if (!inRange) return
                        onHoverDay({ date, duration })
                      }}
                      onMouseLeave={() => {
                        if (hoveredDay?.date === date) {
                          onHoverDay(null)
                        }
                      }}
                      onClick={() => {
                        if (!inRange) return
                        onSelectDate(selectedDate === date ? null : date)
                      }}
                      onKeyDown={(event) => {
                        if (!inRange) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectDate(selectedDate === date ? null : date)
                        }
                      }}
                    />
                  )
                }),
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-[11px] text-[var(--color-text-muted)]">
          <span>少</span>
          <div className="flex items-center gap-1">
            {[0, 1, 2, 3, 4].map(level => {
              const duration = level === 0 ? 0 : Math.ceil(dailyGoal * (level / 4))
              return <div key={level} className={`w-[12px] h-[12px] rounded-[3px] ${getHeatColorClass(duration, dailyGoal)}`} />
            })}
          </div>
          <span>多</span>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold">学习趋势</div>
            <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              {hasContextFilter
                ? `当前仅统计 ${contextFilterLabel} 的学习趋势`
                : selectedRange === '90d'
                  ? '90 天按周聚合'
                  : '按日展示最近学习变化'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-[var(--color-text-muted)]">当前范围</div>
            <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)]">
              活跃 {analytics.activeDays} / {rangeDays} 天
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">趋势变化</div>
            <div className={`mt-1 text-[15px] font-semibold ${trendToneClass}`}>
              {trendSummary}
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {trendComparison.direction === 'flat'
                ? '平均每日波动小于 1 分钟'
                : `${trendComparison.deltaSeconds > 0 ? '+' : ''}${formatDurationCompact(Math.abs(trendComparison.deltaSeconds))} / 日`}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">当前周期均值</div>
            <div className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
              {formatDurationCompact(trendComparison.currentAverageDuration)}
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">上一周期 {formatDurationCompact(trendComparison.previousAverageDuration)}</div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">单日峰值</div>
            <div className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
              {analytics.bestDay ? formatDurationCompact(analytics.bestDay.duration) : '0m'}
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {analytics.bestDay ? analytics.bestDay.date : '暂无活跃日期'}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-end gap-2 h-[180px] overflow-x-auto pb-2">
          {trendPoints.map(point => {
            const height = Math.max(14, Math.round((point.duration / maxTrendDuration) * 132))
            return (
              <div key={point.key} className="flex min-w-[18px] flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-md bg-[color-mix(in_srgb,var(--color-primary)_78%,transparent)]"
                  style={{ height }}
                  title={`${point.label}: ${formatDuration(point.duration)}`}
                />
                <div className="text-[10px] text-[var(--color-text-muted)]">{point.label}</div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">平均每日</div>
            <div className="mt-1 text-[14px] font-semibold text-[var(--color-text-primary)]">
              {formatDurationCompact(analytics.averageDailyDuration)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">达标天数</div>
            <div className="mt-1 text-[14px] font-semibold text-[var(--color-text-primary)]">{analytics.goalDays} 天</div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">最活跃日</div>
            <div className="mt-1 text-[14px] font-semibold text-[var(--color-text-primary)]">
              {analytics.topWeekday === null ? '暂无' : `周${WEEKDAY_LABELS[analytics.topWeekday]}`}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold">学习节奏</div>
            <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              观察当前范围内的学习频率、活跃星期分布和高频时段
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-[var(--color-text-muted)]">活跃率</div>
            <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)]">
              {Math.round(analytics.activeRate * 100)}%
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-3">
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">平均单次 Session</div>
            <div className="mt-1 text-[14px] font-semibold text-[var(--color-text-primary)]">
              {formatDurationCompact(analytics.averageSessionDuration)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">最长单次</div>
            <div className="mt-1 text-[14px] font-semibold text-[var(--color-text-primary)]">
              {formatDurationCompact(analytics.longestSessionDuration)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">活跃日均值</div>
            <div className="mt-1 text-[14px] font-semibold text-[var(--color-text-primary)]">
              {formatDurationCompact(analytics.averageActiveDayDuration)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">高频时段</div>
            <div className="mt-1 text-[14px] font-semibold text-[var(--color-text-primary)]">
              {formatHourLabel(analytics.peakHour)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4">
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4">
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">活跃星期分布</div>
            <div className="mt-4 flex flex-col gap-3">
              {analytics.weekdayDistribution.map(item => (
                <div key={item.weekday} className="grid grid-cols-[52px_minmax(0,1fr)_56px] items-center gap-3">
                  <div className="text-[12px] text-[var(--color-text-muted)]">{item.label}</div>
                  <div className="h-2 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--color-primary)]"
                      style={{ width: `${Math.max(item.duration > 0 ? 8 : 0, Math.round((item.duration / maxWeekdayDuration) * 100))}%` }}
                    />
                  </div>
                  <div className="text-right text-[12px] font-medium text-[var(--color-text-primary)]">
                    {item.duration > 0 ? formatDurationCompact(item.duration) : '0m'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4">
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">高频时段 Top 6</div>
            <div className="mt-4 flex flex-col gap-3">
              {topHourSlots.map(item => (
                <div key={item.hour} className="grid grid-cols-[84px_minmax(0,1fr)_44px] items-center gap-3">
                  <div className="text-[12px] text-[var(--color-text-muted)]">{String(item.hour).padStart(2, '0')}:00</div>
                  <div className="h-2 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[color-mix(in_srgb,var(--color-primary)_70%,transparent)]"
                      style={{ width: `${Math.max(item.duration > 0 ? 8 : 0, Math.round((item.duration / maxHourDuration) * 100))}%` }}
                    />
                  </div>
                  <div className="text-right text-[12px] font-medium text-[var(--color-text-primary)]">
                    {item.duration > 0 ? formatDurationCompact(item.duration) : '0m'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold">目标分析</div>
            <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              {hasContextFilter
                ? `围绕 ${contextFilterLabel} 观察目标达成质量`
                : '围绕日目标观察今天进度、最近达标率和本周完成情况'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-[var(--color-text-muted)]">日目标</div>
            <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)]">
              {formatDurationCompact(dailyGoal)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-3">
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">今日进度</div>
            <div className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
              {todayGoalRate}%
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {goalAnalytics.todayRemainingDuration > 0
                ? `还差 ${formatDurationCompact(goalAnalytics.todayRemainingDuration)}`
                : '今日目标已达成'}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">最近 7 天达标率</div>
            <div className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
              {last7GoalRate}%
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {goalAnalytics.last7GoalDays} / 7 天达标
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">当前范围达标率</div>
            <div className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
              {rangeGoalRate}%
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {goalAnalytics.rangeGoalDays} / {rangeDays} 天达标
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
            <div className="text-[11px] text-[var(--color-text-muted)]">本周目标进度</div>
            <div className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">
              {weekGoalRate}%
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {goalAnalytics.currentWeekGoalDays} / 7 天达标
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4">
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] font-medium text-[var(--color-text-primary)]">本周累计目标</div>
              <div className="text-[12px] text-[var(--color-text-muted)]">
                {formatDurationCompact(goalAnalytics.currentWeekDuration)} / {formatDurationCompact(goalAnalytics.currentWeekGoalDuration)}
              </div>
            </div>
            <div className="mt-4 h-2 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--color-primary)]"
                style={{ width: `${Math.min(100, Math.max(0, weekGoalRate))}%` }}
              />
            </div>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div>
                <div className={`text-[13px] font-medium ${weekPaceToneClass}`}>{weekPaceSummary}</div>
                <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  本周已过去 {goalAnalytics.currentWeekElapsedDays} 天，目标基准 {formatDurationCompact(goalAnalytics.currentWeekExpectedDuration)}
                </div>
              </div>
              <div className={`text-[12px] font-medium ${weekPaceToneClass}`}>
                {goalAnalytics.currentWeekPaceDelta > 60
                  ? `+${formatDurationCompact(goalAnalytics.currentWeekPaceDelta)}`
                  : goalAnalytics.currentWeekPaceDelta < -60
                    ? `-${formatDurationCompact(Math.abs(goalAnalytics.currentWeekPaceDelta))}`
                    : '0m'}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4">
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">目标结论</div>
            <div className="mt-4 flex flex-col gap-3 text-[12px] leading-6 text-[var(--color-text-muted)]">
              <div>
                今日已完成 <span className="text-[var(--color-text-primary)]">{formatDurationCompact(goalAnalytics.todayDuration)}</span>，
                {goalAnalytics.todayRemainingDuration > 0
                  ? <>距离日目标还差 <span className="text-[var(--color-text-primary)]">{formatDurationCompact(goalAnalytics.todayRemainingDuration)}</span>。</>
                  : <>已超过日目标。</>}
              </div>
              <div>
                最近 7 天达标 <span className="text-[var(--color-text-primary)]">{goalAnalytics.last7GoalDays}</span> 天，
                当前范围达标 <span className="text-[var(--color-text-primary)]">{goalAnalytics.rangeGoalDays}</span> 天。
              </div>
              <div>
                本周累计 <span className="text-[var(--color-text-primary)]">{formatDurationCompact(goalAnalytics.currentWeekDuration)}</span>，
                距离周目标还差 <span className="text-[var(--color-text-primary)]">{formatDurationCompact(Math.max(0, goalAnalytics.currentWeekGoalDuration - goalAnalytics.currentWeekDuration))}</span>。
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
})
