import { memo, useEffect, useState, useMemo } from 'react'
import { useLearningTrackerStore } from '../model/learningTrackerStore'
import type { DailyRecord, LearningSession } from '../model/learningTrackerStore'
import { FSB } from '../../../core/fs-backend'
import { useWorkspaceStore } from '../../../stores/workspaceStore'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const RANGE_OPTIONS = [
  { key: 'week', label: '本周', days: 7 },
  { key: 'month', label: '本月', days: 31 },
  { key: 'quarter', label: '90天', days: 90 }
] as const

type RangeKey = typeof RANGE_OPTIONS[number]['key']

const getDateStr = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const getPastDays = (days: number): string[] => {
  const result: string[] = []
  const today = startOfDay(new Date())
  for (let i = days - 1; i >= 0; i--) {
    result.push(getDateStr(addDays(today, -i)))
  }
  return result
}

const formatDuration = (seconds: number) => {
  if (!seconds) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const formatDurationDetail = (seconds: number) => {
  if (!seconds) return '0 分钟'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分钟`
  return `${m} 分钟`
}

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

const buildHeatmapWeeks = (days: number) => {
  const today = startOfDay(new Date())
  const startDate = addDays(today, -(days - 1))
  const alignedStart = addDays(startDate, -startDate.getDay())
  const weeks: string[][] = []
  const monthLabels: Array<{ label: string; column: number }> = []

  let cursor = alignedStart
  let weekIndex = 0
  while (cursor <= today) {
    const week: string[] = []
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      week.push(getDateStr(addDays(cursor, dayIndex)))
    }
    weeks.push(week)

    const monthLabelDate = week.find(dateStr => {
      const date = startOfDay(new Date(dateStr))
      return date >= startDate && date.getDate() <= 7
    })
    if (monthLabelDate) {
      const date = new Date(monthLabelDate)
      monthLabels.push({ label: `${date.getMonth() + 1}月`, column: weekIndex })
    }

    cursor = addDays(cursor, 7)
    weekIndex += 1
  }

  return { weeks, monthLabels, startDate, today }
}

export const LearningStatsPopover = memo(function LearningStatsPopover({
  onClose,
  showCloseButton = true,
}: {
  onClose: () => void
  showCloseButton?: boolean
}) {
  const meta = useLearningTrackerStore(s => s.meta)
  const todayDuration = useLearningTrackerStore(s => s.todayDuration)
  const currentSession = useLearningTrackerStore(s => s.currentSession)
  const workspacePath = useWorkspaceStore(s => s.currentWorkDir)
  
  const [heatmapData, setHeatmapData] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedRange, setSelectedRange] = useState<RangeKey>('quarter')
  const [hoveredDay, setHoveredDay] = useState<{ date: string; duration: number } | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => getDateStr(startOfDay(new Date())))
  const [selectedDayData, setSelectedDayData] = useState<DailyRecord | null>(null)
  const [selectedDayLoading, setSelectedDayLoading] = useState(false)

  const PAST_DAYS = 90; // Last 90 days for heatmap

  const fetchHeatmap = async () => {
    if (!workspacePath) return
    setLoading(true)
    try {
      const dataMap = await FSB.readLearningStatsSummary(workspacePath, PAST_DAYS)
      setHeatmapData(dataMap)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHeatmap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath, refreshKey])

  const todayStr = getDateStr(startOfDay(new Date()))
  const selectedRangeDays = RANGE_OPTIONS.find(option => option.key === selectedRange)?.days || PAST_DAYS
  const { weeks, monthLabels, startDate, today } = useMemo(
    () => buildHeatmapWeeks(selectedRangeDays),
    [selectedRangeDays]
  )
  const totalDuration = meta?.summary.totalDuration || 0
  const streak = meta?.summary.currentStreak || 0
  const longestStreak = meta?.summary.longestStreak || 0
  const visibleDates = useMemo(() => getPastDays(selectedRangeDays), [selectedRangeDays])
  const mergedHeatmapData = useMemo(
    () => ({ ...heatmapData, [todayStr]: todayDuration }),
    [heatmapData, todayDuration, todayStr]
  )
  const rangeActiveDays = useMemo(
    () => visibleDates.filter(date => (mergedHeatmapData[date] || 0) > 0).length,
    [mergedHeatmapData, visibleDates]
  )
  const rangeDuration = useMemo(
    () => visibleDates.reduce((sum, date) => sum + (mergedHeatmapData[date] || 0), 0),
    [mergedHeatmapData, visibleDates]
  )
  const selectedRangeLabel = RANGE_OPTIONS.find(option => option.key === selectedRange)?.label || '当前范围'

  useEffect(() => {
    const nextSelectedDate = visibleDates.includes(selectedDate) ? selectedDate : todayStr
    if (nextSelectedDate !== selectedDate) {
      setSelectedDate(nextSelectedDate)
    }
  }, [selectedDate, selectedRange, todayStr, visibleDates])

  useEffect(() => {
    if (!workspacePath || !selectedDate) {
      setSelectedDayData(null)
      return
    }

    let disposed = false
    setSelectedDayLoading(true)

    const loadSelectedDay = async () => {
      try {
        let dayData = await FSB.readLearningStatsData(workspacePath, selectedDate) as DailyRecord | null
        if (!dayData || !dayData.date) {
          dayData = { date: selectedDate, totalDuration: 0, sessions: [] }
        }

        if (selectedDate === todayStr) {
          dayData = {
            ...dayData,
            totalDuration: todayDuration,
            sessions: [...dayData.sessions]
          }
          if (currentSession) {
            const existingIdx = dayData.sessions.findIndex(session => session.id === currentSession.id)
            if (existingIdx >= 0) {
              dayData.sessions[existingIdx] = currentSession
            } else {
              dayData.sessions.push(currentSession)
            }
          }
        }

        dayData.sessions.sort((a, b) => a.startTime - b.startTime)
        if (!disposed) {
          setSelectedDayData(dayData)
        }
      } catch (err) {
        console.error(err)
        if (!disposed) {
          setSelectedDayData({ date: selectedDate, totalDuration: 0, sessions: [] })
        }
      } finally {
        if (!disposed) {
          setSelectedDayLoading(false)
        }
      }
    }

    void loadSelectedDay()

    return () => {
      disposed = true
    }
  }, [workspacePath, selectedDate, refreshKey, todayDuration, currentSession, todayStr])

  const getColorLevel = (duration: number) => {
    const goal = meta?.settings.dailyGoal || 3600 * 2 // default 2 hours
    if (duration === 0) return 'bg-[var(--color-bg-muted)] border border-[var(--color-border-subtle)]'
    const ratio = duration / goal
    if (ratio < 0.25) return 'bg-[#fdd9c9] dark:bg-[#4d2f26]'
    if (ratio < 0.5) return 'bg-[#f3ae8f] dark:bg-[#74412e]'
    if (ratio < 0.75) return 'bg-[#df6f54] dark:bg-[#9f3c2c]'
    return 'bg-[#c63d34] dark:bg-[#d85a42]'
  }

  return (
    <div className="w-[420px] flex flex-col gap-4 text-[var(--color-text-primary)] select-none">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-[14px]">学习统计</h3>
        {showCloseButton && (
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        )}
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-primary)_7%,var(--color-surface))] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] text-[var(--color-text-muted)]">今日学习时长</div>
            <div className="mt-1 text-[28px] leading-none font-semibold font-mono text-[var(--color-primary)]">
              {formatDuration(todayDuration)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] text-[var(--color-text-muted)]">今日状态</div>
            <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)]">
              {todayDuration > 0 ? '已开始学习' : '尚未开始'}
            </div>
          </div>
        </div>
        <div className="mt-3 text-[12px] text-[var(--color-text-muted)]">
          今天已累计 {formatDurationDetail(todayDuration)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="text-[12px] text-[var(--color-text-muted)]">累计时长</div>
          <div className="mt-1 text-[22px] font-semibold font-mono text-[var(--color-primary)]">
            {formatDuration(totalDuration)}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="text-[12px] text-[var(--color-text-muted)]">连续学习</div>
          <div className="mt-1 text-[22px] font-semibold font-mono text-[var(--color-primary)]">
            {streak} 天
          </div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="text-[12px] text-[var(--color-text-muted)]">最长连续</div>
          <div className="mt-1 text-[22px] font-semibold font-mono text-[var(--color-primary)]">
            {longestStreak} 天
          </div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="text-[12px] text-[var(--color-text-muted)]">活跃天数</div>
          <div className="mt-1 text-[22px] font-semibold font-mono text-[var(--color-primary)]">
            {rangeActiveDays} 天
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            {selectedRangeLabel}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 col-span-2">
          <div className="text-[12px] text-[var(--color-text-muted)]">{selectedRangeLabel}学习时长</div>
          <div className="mt-1 text-[22px] font-semibold font-mono text-[var(--color-primary)]">
            {formatDuration(rangeDuration)}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex justify-between items-end mb-3">
          <div>
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">学习热力图</div>
            <div className="text-[12px] text-[var(--color-text-muted)]">
              {getDateStr(startDate)} - {getDateStr(today)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-1">
              {RANGE_OPTIONS.map(option => (
                <button
                  key={option.key}
                  type="button"
                  className={`px-2.5 h-7 rounded-md text-[12px] transition-colors ${
                    selectedRange === option.key
                      ? 'bg-[var(--color-surface)] text-[var(--color-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                  onClick={() => setSelectedRange(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={loading}
              className={`text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-transform ${loading ? 'animate-spin opacity-50' : ''}`}
              title="刷新数据"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
              </svg>
            </button>
          </div>
        </div>
        
        {loading ? (
          <div className="h-[120px] flex items-center justify-center text-[12px] text-[var(--color-text-muted)]">
            加载数据中...
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] px-3 py-2">
              <div className="text-[11px] text-[var(--color-text-muted)]">
                {hoveredDay ? hoveredDay.date : '悬停某一天可查看详情'}
              </div>
              <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)]">
                {hoveredDay ? formatDurationDetail(hoveredDay.duration) : '查看每天的学习时长分布'}
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
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
                  style={{ gridTemplateColumns: `repeat(${weeks.length}, 12px)` }}
                >
                  {Array.from({ length: weeks.length }).map((_, index) => {
                    const label = monthLabels.find(item => item.column === index)?.label || ''
                    return (
                      <div key={`month-${index}`} className="h-4 leading-4 overflow-visible whitespace-nowrap">
                        {label}
                      </div>
                    )
                  })}
                </div>
                <div
                  className="grid grid-flow-col gap-1"
                  style={{ gridTemplateRows: 'repeat(7, 12px)', gridTemplateColumns: `repeat(${weeks.length}, 12px)` }}
                >
                  {weeks.flatMap((week, weekIndex) => (
                    week.map(date => {
                      const duration = date === todayStr ? todayDuration : (heatmapData[date] || 0)
                      const inRange = date >= getDateStr(startDate) && date <= todayStr
                      return (
                        <div
                          key={`${weekIndex}-${date}`}
                          role={inRange ? 'button' : undefined}
                          tabIndex={inRange ? 0 : -1}
                          className={`w-[12px] h-[12px] rounded-[3px] transition-colors ${
                            inRange ? getColorLevel(duration) : 'bg-transparent'
                          } ${
                            selectedDate === date ? 'ring-2 ring-[var(--color-primary)] ring-offset-1 ring-offset-[var(--color-surface)]' : ''
                          }`}
                          onMouseEnter={() => {
                            if (!inRange) return
                            setHoveredDay({ date, duration })
                          }}
                          onMouseLeave={() => {
                            setHoveredDay(current => current?.date === date ? null : current)
                          }}
                          onClick={() => {
                            if (!inRange) return
                            setSelectedDate(date)
                          }}
                          onKeyDown={(event) => {
                            if (!inRange) return
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelectedDate(date)
                            }
                          }}
                        />
                      )
                    })
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--color-text-muted)]">
              <span>少</span>
              <div className="flex items-center gap-1">
                {[0, 1, 2, 3, 4].map(level => {
                  const duration = level === 0
                    ? 0
                    : Math.ceil((meta?.settings.dailyGoal || 3600 * 2) * (level / 4))
                  return (
                    <div
                      key={level}
                      className={`w-[12px] h-[12px] rounded-[3px] ${getColorLevel(duration)}`}
                    />
                  )
                })}
              </div>
              <span>多</span>
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] text-[var(--color-text-muted)]">当天明细</div>
                  <div className="mt-1 text-[14px] font-medium text-[var(--color-text-primary)]">
                    {selectedDate}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[12px] text-[var(--color-text-muted)]">学习时长</div>
                  <div className="mt-1 text-[14px] font-medium text-[var(--color-primary)]">
                    {formatDurationDetail(selectedDayData?.totalDuration || 0)}
                  </div>
                </div>
              </div>

              {selectedDayLoading ? (
                <div className="mt-3 text-[12px] text-[var(--color-text-muted)]">加载明细中...</div>
              ) : selectedDayData && selectedDayData.sessions.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2 max-h-[180px] overflow-auto pr-1">
                  {selectedDayData.sessions.map((session: LearningSession) => {
                    const isRunning = selectedDate === todayStr && currentSession?.id === session.id
                    return (
                      <div
                        key={session.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
                            {formatTime(session.startTime)} - {formatTime(session.endTime)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                            {isRunning ? '进行中' : '已完成'}
                          </div>
                        </div>
                        <div className="shrink-0 text-[12px] font-medium font-mono text-[var(--color-primary)]">
                          {formatDuration(session.duration)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-3 text-[12px] text-[var(--color-text-muted)]">
                  这一天还没有学习记录
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
