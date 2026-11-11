import { memo, useEffect, useMemo, useState } from 'react'

import type { LearningApi, LearningDailyRecord, WorkspaceApi } from '../../public'
import { LearningDetailPanel } from './LearningDetailPanel.tsx'
import { LearningOverviewPanel } from './LearningOverviewPanel.tsx'
import {
  RANGE_OPTIONS,
  DEFAULT_CONTEXT_FILTER,
  PAGE_TYPE_LABELS,
  buildTrendPoints,
  buildDurationByDateFromRecords,
  computeContextAnalytics,
  computeContextAnalyticsFromSessions,
  computeRangeAnalytics,
  computeTrendComparison,
  ensureDailyRecord,
  filterDailyRecordsByContext,
  formatDurationCompact,
  getDateStr,
  getPastDays,
  getPreviousPeriodDays,
  mergeLiveDayRecord,
  startOfDay,
  hasActiveContextFilter,
  type ContextFilter,
  type LearningPageType,
  type StatisticsRangeKey,
} from './analytics.ts'
import { loadLearningStatisticsData, subscribeLearningStatisticsWorkspace } from './runtime.ts'
import { useLearningRuntimeState } from './useLearningRuntimeState.ts'

const SUMMARY_WINDOW_DAYS = 90

export const LearningStatisticsPage = memo(function LearningStatisticsPage({
  learning,
  workspace,
  onBackHome,
}: {
  learning: LearningApi
  workspace: WorkspaceApi
  onBackHome: () => void | Promise<void>
}) {
  const { todayDuration, meta, isActive, currentSession } = useLearningRuntimeState(learning)

  const [refreshKey, setRefreshKey] = useState(0)
  const [workspaceVersion, setWorkspaceVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedRange, setSelectedRange] = useState<StatisticsRangeKey>('30d')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [hoveredDay, setHoveredDay] = useState<{ date: string; duration: number } | null>(null)
  const [summaryByDate, setSummaryByDate] = useState<Record<string, number>>({})
  const [rangeRecords, setRangeRecords] = useState<Record<string, LearningDailyRecord>>({})
  const [contextFilter, setContextFilter] = useState<ContextFilter>(DEFAULT_CONTEXT_FILTER)

  useEffect(() => {
    const subscription = subscribeLearningStatisticsWorkspace(workspace, () => {
      setWorkspaceVersion((value) => value + 1)
    })
    return () => {
      subscription.dispose()
    }
  }, [workspace])

  const todayStr = useMemo(() => getDateStr(startOfDay(new Date())), [])
  const dailyGoal = meta?.settings.dailyGoal || 3600 * 2
  const selectedRangeOption = RANGE_OPTIONS.find((option) => option.key === selectedRange) || RANGE_OPTIONS[1]
  const visibleDates = useMemo(() => getPastDays(selectedRangeOption.days), [selectedRangeOption.days])
  const previousPeriodDates = useMemo(() => getPreviousPeriodDays(selectedRangeOption.days), [selectedRangeOption.days])
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
    return parts.length > 0 ? parts.join(' / ') : ''
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
    let cancelled = false
    setLoading(true)

    const load = async () => {
      try {
        const { summaryByDate: summary, rangeRecords: records } = await loadLearningStatisticsData({
          learning,
          loadedRecordDates,
          summaryWindowDays: SUMMARY_WINDOW_DAYS,
        })

        if (cancelled) return

        setSummaryByDate(summary)
        setRangeRecords(records)
      } catch (error) {
        console.error(error)
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
  }, [learning, loadedRecordDates, refreshKey, workspaceVersion])

  const durationByDate = useMemo(
    () => ({ ...summaryByDate, [todayStr]: todayDuration }),
    [summaryByDate, todayDuration, todayStr],
  )

  const liveRangeRecords = useMemo(() => {
    const nextRecords: Record<string, LearningDailyRecord> = { ...rangeRecords }
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
    () => computeContextAnalytics(visibleDates, pageTypeScopedRecords).kbDistribution.map((item) => item.key),
    [pageTypeScopedRecords, visibleDates],
  )

  useEffect(() => {
    if (contextFilter.kbPath === 'all') return
    if (kbOptions.includes(contextFilter.kbPath)) return
    setContextFilter((filter) => ({ ...filter, kbPath: 'all' }))
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

  const contextAnalytics = useMemo(
    () => computeContextAnalytics(visibleDates, filteredRangeRecords),
    [filteredRangeRecords, visibleDates],
  )

  const selectedDayData = selectedDate ? (filteredRangeRecords[selectedDate] || ensureDailyRecord(selectedDate)) : null
  const selectedDayDuration = selectedDate ? (filteredDurationByDate[selectedDate] || 0) : 0
  const selectedDayContextAnalytics = useMemo(
    () => computeContextAnalyticsFromSessions(selectedDayData?.sessions || []),
    [selectedDayData],
  )

  return (
    <div className="w-full h-full bg-[var(--color-bg-app)] text-[var(--color-text-primary)] overflow-auto">
      <div className="max-w-[1180px] mx-auto px-8 py-7">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold leading-tight">学习统计</h1>
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              {hasContextFilter ? `已筛选 ${contextFilterLabel} · ` : ''}日目标 {formatDurationCompact(dailyGoal)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSelectedRange(option.key)}
                  className={`h-8 px-3.5 rounded-md text-[12px] transition-colors ${
                    selectedRange === option.key
                      ? 'bg-[var(--color-bg-muted)] text-[var(--color-accent)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRefreshKey((key) => key + 1)}
              className="h-9 px-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[12px] hover:bg-[var(--color-hover-bg)]"
              title="刷新学习统计数据"
            >
              刷新
            </button>
            <button
              type="button"
              onClick={() => {
                void onBackHome()
              }}
              className="h-9 px-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[12px] hover:bg-[var(--color-hover-bg)]"
            >
              返回首页
            </button>
          </div>
        </header>

        <div
          className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5"
          data-tm-learning-filter=""
        >
          <span className="text-[12px] text-[var(--color-text-muted)]">筛选</span>
          <label className="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
            页面
            <select
              value={contextFilter.pageType}
              onChange={(event) => setContextFilter((filter) => ({
                ...filter,
                pageType: event.target.value as LearningPageType | 'all',
              }))}
              className="h-8 min-w-[128px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 text-[12px] text-[var(--color-text-primary)] outline-none"
            >
              <option value="all">全部页面</option>
              {pageTypeOptions.map(([pageType, label]) => (
                <option key={pageType} value={pageType}>{label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
            知识库
            <select
              value={contextFilter.kbPath}
              onChange={(event) => setContextFilter((filter) => ({ ...filter, kbPath: event.target.value }))}
              className="h-8 min-w-[180px] max-w-[280px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2.5 text-[12px] text-[var(--color-text-primary)] outline-none"
            >
              <option value="all">全部知识库</option>
              {kbOptions.map((kbPath) => (
                <option key={kbPath} value={kbPath}>{kbPath}</option>
              ))}
            </select>
          </label>
          {hasContextFilter ? (
            <button
              type="button"
              onClick={() => setContextFilter(DEFAULT_CONTEXT_FILTER)}
              className="h-8 px-2.5 rounded-lg text-[12px] text-[var(--color-accent)] hover:bg-[var(--color-hover-bg)]"
            >
              清除
            </button>
          ) : null}
          <span className="ml-auto text-[11px] text-[var(--color-text-muted)]">
            点击热力图查看当日明细
          </span>
        </div>

        {loading ? (
          <div className={`mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-16 text-center text-[13px] text-[var(--color-text-muted)]`}>
            正在载入学习统计...
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-5">
            <LearningOverviewPanel
              isActive={isActive}
              meta={meta}
              todayDuration={todayDuration}
              dailyGoal={dailyGoal}
              rangeDays={selectedRangeOption.days}
              durationByDate={filteredDurationByDate}
              analytics={analytics}
              trendPoints={trendPoints}
              trendComparison={trendComparison}
              selectedDate={selectedDate}
              hoveredDay={hoveredDay}
              onHoverDay={setHoveredDay}
              onSelectDate={setSelectedDate}
            />
            <LearningDetailPanel
              selectedDate={selectedDate}
              selectedDayData={selectedDayData}
              selectedDayDuration={selectedDayDuration}
              currentSessionId={currentSession?.id || null}
              isActive={isActive}
              contextAnalytics={contextAnalytics}
              selectedDayContextAnalytics={selectedDayContextAnalytics}
              dailyGoal={dailyGoal}
              onBackToSummary={() => setSelectedDate(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
})
