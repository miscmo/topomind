import { memo, useEffect, useMemo, useState } from 'react'
import { FSB } from '../../../core/fs-backend'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { useTabStore } from '../../../stores/tabs/tabStore'
import { LearningDetailPanel } from '../components/LearningDetailPanel'
import { LearningOverviewPanel } from '../components/LearningOverviewPanel'
import { useLearningTrackerStore } from '../model/learningTrackerStore'
import type { DailyRecord } from '../model/learningTrackerStore'
import {
  RANGE_OPTIONS,
  DEFAULT_CONTEXT_FILTER,
  PAGE_TYPE_LABELS,
  buildTrendPoints,
  buildDurationByDateFromRecords,
  computeContextAnalytics,
  computeContextAnalyticsFromSessions,
  computeGoalAnalytics,
  computeTrendComparison,
  computeRangeAnalytics,
  ensureDailyRecord,
  filterDailyRecordsByContext,
  formatDurationCompact,
  getDateStr,
  hasActiveContextFilter,
  getPastDays,
  getPreviousPeriodDays,
  mergeLiveDayRecord,
  startOfDay,
  type ContextFilter,
  type StatisticsRangeKey,
} from '../model/learningTrackerAnalytics'

const SUMMARY_WINDOW_DAYS = 90

export default memo(function LearningStatisticsPage() {
  const activateTab = useTabStore(s => s.activateTab)
  const workspacePath = useWorkspaceStore(s => s.currentWorkDir)
  const todayDuration = useLearningTrackerStore(s => s.todayDuration)
  const meta = useLearningTrackerStore(s => s.meta)
  const isActive = useLearningTrackerStore(s => s.isActive)
  const currentSession = useLearningTrackerStore(s => s.currentSession)

  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedRange, setSelectedRange] = useState<StatisticsRangeKey>('30d')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [hoveredDay, setHoveredDay] = useState<{ date: string; duration: number } | null>(null)
  const [summaryByDate, setSummaryByDate] = useState<Record<string, number>>({})
  const [rangeRecords, setRangeRecords] = useState<Record<string, DailyRecord>>({})
  const [contextFilter, setContextFilter] = useState<ContextFilter>(DEFAULT_CONTEXT_FILTER)

  const todayStr = useMemo(() => getDateStr(startOfDay(new Date())), [])
  const dailyGoal = meta?.settings.dailyGoal || 3600 * 2
  const selectedRangeOption = RANGE_OPTIONS.find(option => option.key === selectedRange) || RANGE_OPTIONS[1]
  const visibleDates = useMemo(() => getPastDays(selectedRangeOption.days), [selectedRangeOption.days])
  const previousPeriodDates = useMemo(() => getPreviousPeriodDays(selectedRangeOption.days), [selectedRangeOption.days])
  const latestSevenDates = useMemo(() => getPastDays(7), [])
  const latestThirtyDates = useMemo(() => getPastDays(30), [])
  const loadedRecordDates = useMemo(
    () => [...new Set([...visibleDates, ...previousPeriodDates, ...latestThirtyDates])].sort(),
    [latestThirtyDates, previousPeriodDates, visibleDates],
  )
  const hasContextFilter = hasActiveContextFilter(contextFilter)
  const contextFilterLabel = useMemo(() => {
    const parts: string[] = []
    if (contextFilter.pageType !== 'all') {
      parts.push(PAGE_TYPE_LABELS[contextFilter.pageType])
    }
    if (contextFilter.kbPath !== 'all') {
      parts.push(contextFilter.kbPath)
    }
    return parts.length > 0 ? parts.join(' / ') : '全部上下文'
  }, [contextFilter])
  const pageTypeOptions = useMemo(
    () => Object.entries(PAGE_TYPE_LABELS) as Array<[keyof typeof PAGE_TYPE_LABELS, string]>,
    [],
  )

  useEffect(() => {
    if (!selectedDate) return
    if (!visibleDates.includes(selectedDate)) {
      setSelectedDate(null)
    }
  }, [selectedDate, visibleDates])

  useEffect(() => {
    if (!workspacePath) {
      setSummaryByDate({})
      setRangeRecords({})
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    const load = async () => {
      try {
        const [summary, records] = await Promise.all([
          FSB.readLearningStatsSummary(workspacePath, SUMMARY_WINDOW_DAYS),
          Promise.all(
            loadedRecordDates.map(async date => {
              const record = await FSB.readLearningStatsData(workspacePath, date) as DailyRecord | null
              return [date, ensureDailyRecord(date, record)] as const
            }),
          ),
        ])

        if (cancelled) return
        setSummaryByDate(summary)
        setRangeRecords(Object.fromEntries(records))
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setSummaryByDate({})
          setRangeRecords({})
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [workspacePath, loadedRecordDates, refreshKey])

  const durationByDate = useMemo(
    () => ({ ...summaryByDate, [todayStr]: todayDuration }),
    [summaryByDate, todayDuration, todayStr],
  )

  const liveRangeRecords = useMemo(() => {
    const nextRecords: Record<string, DailyRecord> = { ...rangeRecords }
    if (loadedRecordDates.includes(todayStr)) {
      nextRecords[todayStr] = mergeLiveDayRecord(rangeRecords[todayStr], todayStr, todayStr, todayDuration, currentSession)
    }
    return nextRecords
  }, [currentSession, loadedRecordDates, rangeRecords, todayDuration, todayStr])

  const pageTypeScopedRecords = useMemo(
    () => (
      contextFilter.pageType === 'all'
        ? liveRangeRecords
        : filterDailyRecordsByContext(liveRangeRecords, { pageType: contextFilter.pageType, kbPath: 'all' })
    ),
    [contextFilter.pageType, liveRangeRecords],
  )

  const kbOptions = useMemo(
    () => computeContextAnalytics(visibleDates, pageTypeScopedRecords).kbDistribution.map(item => item.key),
    [pageTypeScopedRecords, visibleDates],
  )

  useEffect(() => {
    if (contextFilter.kbPath === 'all') return
    if (kbOptions.includes(contextFilter.kbPath)) return
    setContextFilter(filter => ({ ...filter, kbPath: 'all' }))
  }, [contextFilter.kbPath, kbOptions])

  const filteredRangeRecords = useMemo(
    () => filterDailyRecordsByContext(liveRangeRecords, contextFilter),
    [contextFilter, liveRangeRecords],
  )

  const filteredDurationByDate = useMemo(
    () => ({
      ...durationByDate,
      ...buildDurationByDateFromRecords(filteredRangeRecords),
    }),
    [durationByDate, filteredRangeRecords],
  )

  const analytics = useMemo(
    () => computeRangeAnalytics(visibleDates, filteredDurationByDate, filteredRangeRecords, dailyGoal),
    [dailyGoal, filteredDurationByDate, filteredRangeRecords, visibleDates],
  )

  const trendPoints = useMemo(
    () => buildTrendPoints(visibleDates, filteredDurationByDate, selectedRange),
    [filteredDurationByDate, selectedRange, visibleDates],
  )

  const trendComparison = useMemo(
    () => computeTrendComparison(visibleDates, previousPeriodDates, filteredDurationByDate),
    [filteredDurationByDate, previousPeriodDates, visibleDates],
  )

  const goalAnalytics = useMemo(
    () => computeGoalAnalytics(visibleDates, filteredDurationByDate, dailyGoal, todayStr),
    [dailyGoal, filteredDurationByDate, todayStr, visibleDates],
  )

  const contextAnalytics = useMemo(
    () => computeContextAnalytics(visibleDates, filteredRangeRecords),
    [filteredRangeRecords, visibleDates],
  )

  const recentWeekDuration = useMemo(
    () => latestSevenDates.reduce((sum, date) => sum + (durationByDate[date] || 0), 0),
    [durationByDate, latestSevenDates],
  )

  const recentMonthDuration = useMemo(
    () => latestThirtyDates.reduce((sum, date) => sum + (durationByDate[date] || 0), 0),
    [durationByDate, latestThirtyDates],
  )

  const selectedDayData = selectedDate ? (filteredRangeRecords[selectedDate] || ensureDailyRecord(selectedDate)) : null
  const selectedDayDuration = selectedDate ? (filteredDurationByDate[selectedDate] || 0) : 0
  const selectedDayContextAnalytics = useMemo(
    () => computeContextAnalyticsFromSessions(selectedDayData?.sessions || []),
    [selectedDayData],
  )

  return (
    <div className="w-full h-full bg-[var(--color-bg-app)] text-[var(--color-text-primary)] overflow-auto">
      <div className="max-w-[1480px] mx-auto px-8 py-7">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">Learning Center</div>
            <h1 className="mt-1 text-[30px] leading-none font-semibold">学习统计</h1>
            <p className="mt-2 text-[13px] text-[var(--color-text-muted)]">
              已接入概览区、范围汇总、按日明细联动、目标分析和上下文统计。
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
              {RANGE_OPTIONS.map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSelectedRange(option.key)}
                  className={`h-9 px-4 rounded-lg text-[13px] transition-colors ${
                    selectedRange === option.key
                      ? 'bg-[var(--color-bg-muted)] text-[var(--color-primary)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRefreshKey(key => key + 1)}
              className="h-9 px-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] hover:bg-[var(--color-hover-bg)]"
              title="刷新学习统计数据"
            >
              刷新
            </button>
            <button
              type="button"
              onClick={() => activateTab('home')}
              className="h-9 px-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] hover:bg-[var(--color-hover-bg)]"
            >
              返回首页
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[16px] font-semibold">上下文筛选</div>
              <p className="mt-1 text-[12px] leading-6 text-[var(--color-text-muted)]">
                按页面类型和知识库筛选当前统计范围，热力图、趋势图、目标分析和右侧结果区会同步联动。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setContextFilter(DEFAULT_CONTEXT_FILTER)}
              disabled={!hasContextFilter}
              className="h-9 px-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[13px] hover:bg-[var(--color-hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              清空筛选
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-4">
            <div>
              <div className="text-[12px] text-[var(--color-text-muted)]">页面类型</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setContextFilter(filter => ({ ...filter, pageType: 'all' }))}
                  className={`h-8 px-3 rounded-full border text-[12px] transition-colors ${
                    contextFilter.pageType === 'all'
                      ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,var(--color-surface))] text-[var(--color-primary)]'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  全部页面
                </button>
                {pageTypeOptions.map(([pageType, label]) => (
                  <button
                    key={pageType}
                    type="button"
                    onClick={() => setContextFilter(filter => ({ ...filter, pageType }))}
                    className={`h-8 px-3 rounded-full border text-[12px] transition-colors ${
                      contextFilter.pageType === pageType
                        ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,var(--color-surface))] text-[var(--color-primary)]'
                        : 'border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="text-[12px] text-[var(--color-text-muted)]">知识库</div>
              <select
                value={contextFilter.kbPath}
                onChange={(event) => setContextFilter(filter => ({ ...filter, kbPath: event.target.value }))}
                className="min-w-[320px] h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none"
              >
                <option value="all">全部知识库</option>
                {kbOptions.map(kbPath => (
                  <option key={kbPath} value={kbPath}>
                    {kbPath}
                  </option>
                ))}
              </select>
              <div className="text-[12px] text-[var(--color-text-muted)]">
                {hasContextFilter ? `当前筛选：${contextFilterLabel}` : '当前未启用上下文筛选'}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(440px,540px)_minmax(0,1fr)] gap-6 min-h-[760px]">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-popover)]">
            {loading ? (
              <div className="h-full min-h-[720px] flex items-center justify-center text-[13px] text-[var(--color-text-muted)]">
                正在载入学习统计...
              </div>
            ) : (
              <LearningOverviewPanel
                isActive={isActive}
                meta={meta}
                todayDuration={todayDuration}
                recentWeekDuration={recentWeekDuration}
                recentMonthDuration={recentMonthDuration}
                totalDuration={meta?.summary.totalDuration || 0}
                selectedRange={selectedRange}
                durationByDate={filteredDurationByDate}
                analytics={analytics}
                goalAnalytics={goalAnalytics}
                trendPoints={trendPoints}
                trendComparison={trendComparison}
                selectedDate={selectedDate}
                hoveredDay={hoveredDay}
                hasContextFilter={hasContextFilter}
                contextFilterLabel={contextFilterLabel}
                onHoverDay={setHoveredDay}
                onSelectDate={setSelectedDate}
              />
            )}
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-popover)]">
            {loading ? (
              <div className="h-full min-h-[720px] flex items-center justify-center text-[13px] text-[var(--color-text-muted)]">
                正在整理 {selectedRangeOption.label} 的统计结果...
              </div>
            ) : (
              <LearningDetailPanel
                selectedDate={selectedDate}
                selectedDayData={selectedDayData}
                selectedDayDuration={selectedDayDuration}
                currentSessionId={currentSession?.id || null}
                isActive={isActive}
                analytics={analytics}
                goalAnalytics={goalAnalytics}
                contextAnalytics={contextAnalytics}
                dailyGoal={dailyGoal}
                rangeLabel={selectedRangeOption.label}
                selectedDayContextAnalytics={selectedDayContextAnalytics}
                hasContextFilter={hasContextFilter}
                contextFilterLabel={contextFilterLabel}
                onBackToSummary={() => setSelectedDate(null)}
              />
            )}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 text-[13px] text-[var(--color-text-muted)]">
          当前范围为 <span className="text-[var(--color-text-primary)]">{selectedRangeOption.label}</span>，
          日目标为 <span className="text-[var(--color-text-primary)]">{formatDurationCompact(dailyGoal)}</span>，
          {hasContextFilter
            ? <>已按 <span className="text-[var(--color-text-primary)]">{contextFilterLabel}</span> 联动筛选，点击热力图日期可在右侧查看筛选后的按日 session 明细。</>
            : <>点击热力图日期可在右侧切换到按日 session 明细。</>}
        </div>
      </div>
    </div>
  )
})
