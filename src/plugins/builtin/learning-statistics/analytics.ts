import type {
  LearningDailyRecord as DailyRecord,
  LearningPageType,
  LearningSessionSnapshot as LearningSession,
} from '../../public'

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export const RANGE_OPTIONS = [
  { key: '7d', label: '7天', days: 7 },
  { key: '30d', label: '30天', days: 30 },
  { key: '90d', label: '90天', days: 90 },
] as const

export type StatisticsRangeKey = typeof RANGE_OPTIONS[number]['key']

export interface RangeAnalytics {
  totalDuration: number
  activeDays: number
  activeRate: number
  averageDailyDuration: number
  averageActiveDayDuration: number
  sessionCount: number
  averageSessionDuration: number
  longestSessionDuration: number
  peakHour: number | null
  topWeekday: number | null
  goalDays: number
  bestDay: { date: string; duration: number } | null
  weekdayDistribution: Array<{ weekday: number; label: string; duration: number }>
  hourDistribution: Array<{ hour: number; duration: number }>
}

export interface DerivedLearningSummary {
  totalDuration: number
  currentStreak: number
  longestStreak: number
  lastActiveDate: string
}

export interface TrendPoint {
  key: string
  label: string
  duration: number
}

export interface TrendComparison {
  currentAverageDuration: number
  previousAverageDuration: number
  deltaSeconds: number
  deltaRatio: number
  direction: 'up' | 'down' | 'flat'
}

export interface GoalAnalytics {
  dailyGoal: number
  todayDuration: number
  todayCompletionRate: number
  todayRemainingDuration: number
  rangeGoalDays: number
  rangeGoalRate: number
  last7GoalDays: number
  last7GoalRate: number
  currentWeekDuration: number
  currentWeekGoalDuration: number
  currentWeekCompletionRate: number
  currentWeekGoalDays: number
  currentWeekElapsedDays: number
  currentWeekExpectedDuration: number
  currentWeekPaceDelta: number
}

export interface ContextDistributionItem {
  key: string
  label: string
  duration: number
  sessionCount: number
  ratio: number
}

export interface ContextAnalytics {
  totalSessionDuration: number
  totalSessions: number
  sessionsWithContext: number
  sessionsWithoutContext: number
  kbTrackedDuration: number
  documentTrackedDuration: number
  pageTypeDistribution: ContextDistributionItem[]
  kbDistribution: ContextDistributionItem[]
  documentDistribution: ContextDistributionItem[]
}

export interface ContextFilter {
  pageType: LearningPageType | 'all'
  kbPath: string | 'all'
}

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

export const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export const getDateStr = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const getPastDays = (days: number) => {
  const today = startOfDay(new Date())
  return Array.from({ length: days }, (_, index) => getDateStr(addDays(today, -(days - index - 1))))
}

export const getPreviousPeriodDays = (days: number) => {
  const today = startOfDay(new Date())
  return Array.from({ length: days }, (_, index) => getDateStr(addDays(today, -((days * 2) - index - 1))))
}

export const getCurrentWeekDates = (today = startOfDay(new Date())) => {
  const weekStartOffset = (today.getDay() + 6) % 7
  const start = addDays(today, -weekStartOffset)
  return Array.from({ length: 7 }, (_, index) => getDateStr(addDays(start, index)))
}

export const parseDateStr = (dateStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

export const formatDuration = (seconds: number) => {
  if (!seconds) return '0 分钟'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分钟`
  return `${m} 分钟`
}

export const formatDurationCompact = (seconds: number) => {
  if (!seconds) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export const formatDateLabel = (dateStr: string) => {
  const date = parseDateStr(dateStr)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export const formatFullDateLabel = (dateStr: string) => {
  const date = parseDateStr(dateStr)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 周${WEEKDAY_LABELS[date.getDay()]}`
}

export const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

export const formatHourLabel = (hour: number | null) => {
  if (hour === null) return '暂无'
  return `${String(hour).padStart(2, '0')}:00 - ${String((hour + 1) % 24).padStart(2, '0')}:00`
}

export const PAGE_TYPE_LABELS: Record<LearningPageType, string> = {
  home: '首页',
  kb: '知识库根视图',
  graph: '图谱',
  document: '文档',
  monitor: '系统监控',
  statistics: '学习统计',
  'secondary-view': '插件视图',
  setup: '工作区设置',
}

const UNKNOWN_PAGE_TYPE = '__unknown_page_type__'

export const DEFAULT_CONTEXT_FILTER: ContextFilter = {
  pageType: 'all',
  kbPath: 'all',
}

export const hasActiveContextFilter = (filter: ContextFilter) => (
  filter.pageType !== 'all' || filter.kbPath !== 'all'
)

const formatContextLabel = (dimension: 'pageType' | 'kbPath' | 'documentId', key: string) => {
  if (dimension === 'pageType') {
    if (key === UNKNOWN_PAGE_TYPE) return '未记录页面'
    return PAGE_TYPE_LABELS[key as LearningPageType] || key
  }
  if (dimension === 'kbPath') return key
  return key.length > 12 ? `#${key.slice(0, 8)}` : key
}

const finalizeContextDistribution = (
  dimension: 'pageType' | 'kbPath' | 'documentId',
  entries: Map<string, { duration: number; sessionCount: number }>,
  totalDuration: number,
) => {
  return [...entries.entries()]
    .map(([key, value]) => ({
      key,
      label: formatContextLabel(dimension, key),
      duration: value.duration,
      sessionCount: value.sessionCount,
      ratio: totalDuration > 0 ? value.duration / totalDuration : 0,
    }))
    .sort((a, b) => (b.duration - a.duration) || (b.sessionCount - a.sessionCount))
}

export const ensureDailyRecord = (date: string, record?: DailyRecord | null): DailyRecord => {
  if (!record || !record.date) {
    return { date, totalDuration: 0, sessions: [] }
  }
  return {
    date,
    totalDuration: record.totalDuration || 0,
    sessions: Array.isArray(record.sessions) ? [...record.sessions] : [],
  }
}

export const buildDurationByDateFromRecords = (dailyRecords: Record<string, DailyRecord>) => {
  return Object.fromEntries(
    Object.entries(dailyRecords).map(([date, record]) => [date, ensureDailyRecord(date, record).totalDuration || 0]),
  )
}

export const mergeLiveDayRecord = (
  record: DailyRecord | null | undefined,
  date: string,
  todayStr: string,
  todayDuration: number,
  currentSession: LearningSession | null,
) => {
  const nextRecord = ensureDailyRecord(date, record)
  if (date !== todayStr) {
    nextRecord.sessions.sort((a, b) => a.startTime - b.startTime)
    return nextRecord
  }

  nextRecord.totalDuration = todayDuration
  if (currentSession) {
    const existingIndex = nextRecord.sessions.findIndex(session => session.id === currentSession.id)
    if (existingIndex >= 0) {
      nextRecord.sessions[existingIndex] = currentSession
    } else {
      nextRecord.sessions.push(currentSession)
    }
  }
  nextRecord.sessions.sort((a, b) => a.startTime - b.startTime)
  return nextRecord
}

export const buildHeatmapWeeks = (days: number) => {
  const today = startOfDay(new Date())
  const startDate = addDays(today, -(days - 1))
  const alignedStart = addDays(startDate, -startDate.getDay())
  const weeks: string[][] = []
  const monthLabels: Array<{ label: string; column: number }> = []

  let cursor = alignedStart
  let weekIndex = 0
  while (cursor <= today) {
    const week: string[] = []
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      week.push(getDateStr(addDays(cursor, dayIndex)))
    }
    weeks.push(week)

    const monthLabelDate = week.find(dateStr => {
      const date = parseDateStr(dateStr)
      return date >= startDate && date.getDate() <= 7
    })
    if (monthLabelDate) {
      const date = parseDateStr(monthLabelDate)
      monthLabels.push({ label: `${date.getMonth() + 1}月`, column: weekIndex })
    }

    cursor = addDays(cursor, 7)
    weekIndex += 1
  }

  return { weeks, monthLabels, startDate, today }
}

const appendSessionHours = (buckets: number[], session: LearningSession) => {
  const safeEndTime = Math.max(session.startTime, session.endTime)
  if (safeEndTime === session.startTime) {
    buckets[new Date(session.startTime).getHours()] += session.duration || 0
    return
  }

  let cursor = session.startTime
  while (cursor < safeEndTime) {
    const date = new Date(cursor)
    const nextHour = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours() + 1,
      0,
      0,
      0,
    ).getTime()
    const end = Math.min(nextHour, safeEndTime)
    buckets[date.getHours()] += Math.max(0, Math.round((end - cursor) / 1000))
    cursor = end
  }
}

export const buildDayHourBuckets = (sessions: LearningSession[]) => {
  const buckets = Array.from({ length: 24 }, () => 0)
  sessions.forEach(session => appendSessionHours(buckets, session))
  return buckets
}

export const computeContextAnalyticsFromSessions = (sessions: LearningSession[]): ContextAnalytics => {
  const pageTypeBuckets = new Map<string, { duration: number; sessionCount: number }>()
  const kbBuckets = new Map<string, { duration: number; sessionCount: number }>()
  const documentBuckets = new Map<string, { duration: number; sessionCount: number }>()
  let totalSessionDuration = 0
  let sessionsWithContext = 0
  let sessionsWithoutContext = 0
  let kbTrackedDuration = 0
  let documentTrackedDuration = 0

  sessions.forEach(session => {
    const duration = Math.max(0, session.duration || 0)
    totalSessionDuration += duration

    const context = session.context
    if (context) {
      sessionsWithContext += 1
    } else {
      sessionsWithoutContext += 1
    }

    const pageTypeKey = context?.pageType || UNKNOWN_PAGE_TYPE
    const currentPageType = pageTypeBuckets.get(pageTypeKey) || { duration: 0, sessionCount: 0 }
    pageTypeBuckets.set(pageTypeKey, {
      duration: currentPageType.duration + duration,
      sessionCount: currentPageType.sessionCount + 1,
    })

    if (context?.kbPath) {
      kbTrackedDuration += duration
      const currentKb = kbBuckets.get(context.kbPath) || { duration: 0, sessionCount: 0 }
      kbBuckets.set(context.kbPath, {
        duration: currentKb.duration + duration,
        sessionCount: currentKb.sessionCount + 1,
      })
    }

    if (context?.documentId) {
      documentTrackedDuration += duration
      const currentDocument = documentBuckets.get(context.documentId) || { duration: 0, sessionCount: 0 }
      documentBuckets.set(context.documentId, {
        duration: currentDocument.duration + duration,
        sessionCount: currentDocument.sessionCount + 1,
      })
    }
  })

  return {
    totalSessionDuration,
    totalSessions: sessions.length,
    sessionsWithContext,
    sessionsWithoutContext,
    kbTrackedDuration,
    documentTrackedDuration,
    pageTypeDistribution: finalizeContextDistribution('pageType', pageTypeBuckets, totalSessionDuration),
    kbDistribution: finalizeContextDistribution('kbPath', kbBuckets, kbTrackedDuration),
    documentDistribution: finalizeContextDistribution('documentId', documentBuckets, documentTrackedDuration),
  }
}

export const computeContextAnalytics = (
  dates: string[],
  dailyRecords: Record<string, DailyRecord>,
): ContextAnalytics => {
  const sessions = dates.flatMap(date => ensureDailyRecord(date, dailyRecords[date]).sessions)
  return computeContextAnalyticsFromSessions(sessions)
}

const matchesContextFilter = (session: LearningSession, filter: ContextFilter) => {
  if (filter.pageType !== 'all' && session.context?.pageType !== filter.pageType) {
    return false
  }
  if (filter.kbPath !== 'all' && session.context?.kbPath !== filter.kbPath) {
    return false
  }
  return true
}

export const filterDailyRecordsByContext = (
  dailyRecords: Record<string, DailyRecord>,
  filter: ContextFilter,
) => {
  if (!hasActiveContextFilter(filter)) {
    return Object.fromEntries(
      Object.entries(dailyRecords).map(([date, record]) => [date, ensureDailyRecord(date, record)]),
    )
  }

  return Object.fromEntries(
    Object.entries(dailyRecords).map(([date, record]) => {
      const safeRecord = ensureDailyRecord(date, record)
      const sessions = safeRecord.sessions.filter(session => matchesContextFilter(session, filter))
      return [
        date,
        {
          date,
          totalDuration: sessions.reduce((sum, session) => sum + Math.max(0, session.duration || 0), 0),
          sessions,
        } satisfies DailyRecord,
      ]
    }),
  )
}

export const computeRangeAnalytics = (
  dates: string[],
  durationByDate: Record<string, number>,
  dailyRecords: Record<string, DailyRecord>,
  dailyGoal: number,
): RangeAnalytics => {
  const totalDuration = dates.reduce((sum, date) => sum + (durationByDate[date] || 0), 0)
  const activeDays = dates.filter(date => (durationByDate[date] || 0) > 0).length
  const weekdayTotals = Array.from({ length: 7 }, () => 0)
  const hourTotals = Array.from({ length: 24 }, () => 0)
  let sessionCount = 0
  let totalSessionDuration = 0
  let longestSessionDuration = 0
  let bestDay: { date: string; duration: number } | null = null

  dates.forEach(date => {
    const duration = durationByDate[date] || 0
    weekdayTotals[parseDateStr(date).getDay()] += duration
    if (!bestDay || duration > bestDay.duration) {
      bestDay = { date, duration }
    }

    const record = ensureDailyRecord(date, dailyRecords[date])
    sessionCount += record.sessions.length
    record.sessions.forEach(session => {
      totalSessionDuration += session.duration
      longestSessionDuration = Math.max(longestSessionDuration, session.duration)
      appendSessionHours(hourTotals, session)
    })
  })

  const peakHourValue = Math.max(...hourTotals)
  const topWeekdayValue = Math.max(...weekdayTotals)

  return {
    totalDuration,
    activeDays,
    activeRate: dates.length > 0 ? activeDays / dates.length : 0,
    averageDailyDuration: dates.length > 0 ? Math.round(totalDuration / dates.length) : 0,
    averageActiveDayDuration: activeDays > 0 ? Math.round(totalDuration / activeDays) : 0,
    sessionCount,
    averageSessionDuration: sessionCount > 0 ? Math.round(totalSessionDuration / sessionCount) : 0,
    longestSessionDuration,
    peakHour: peakHourValue > 0 ? hourTotals.indexOf(peakHourValue) : null,
    topWeekday: topWeekdayValue > 0 ? weekdayTotals.indexOf(topWeekdayValue) : null,
    goalDays: dates.filter(date => (durationByDate[date] || 0) >= dailyGoal).length,
    bestDay,
    weekdayDistribution: weekdayTotals.map((duration, weekday) => ({
      weekday,
      label: `周${WEEKDAY_LABELS[weekday]}`,
      duration,
    })),
    hourDistribution: hourTotals.map((duration, hour) => ({ hour, duration })),
  }
}

export const computeTrendComparison = (
  currentDates: string[],
  previousDates: string[],
  durationByDate: Record<string, number>,
): TrendComparison => {
  const currentTotal = currentDates.reduce((sum, date) => sum + (durationByDate[date] || 0), 0)
  const previousTotal = previousDates.reduce((sum, date) => sum + (durationByDate[date] || 0), 0)
  const currentAverageDuration = currentDates.length > 0 ? Math.round(currentTotal / currentDates.length) : 0
  const previousAverageDuration = previousDates.length > 0 ? Math.round(previousTotal / previousDates.length) : 0
  const deltaSeconds = currentAverageDuration - previousAverageDuration
  const deltaRatio = previousAverageDuration > 0 ? deltaSeconds / previousAverageDuration : (currentAverageDuration > 0 ? 1 : 0)
  const direction = Math.abs(deltaSeconds) < 60 ? 'flat' : deltaSeconds > 0 ? 'up' : 'down'

  return {
    currentAverageDuration,
    previousAverageDuration,
    deltaSeconds,
    deltaRatio,
    direction,
  }
}

export const computeGoalAnalytics = (
  visibleDates: string[],
  durationByDate: Record<string, number>,
  dailyGoal: number,
  todayStr = getDateStr(startOfDay(new Date())),
): GoalAnalytics => {
  const safeDailyGoal = Math.max(1, dailyGoal)
  const todayDuration = durationByDate[todayStr] || 0
  const rangeGoalDays = visibleDates.filter(date => (durationByDate[date] || 0) >= safeDailyGoal).length
  const last7Dates = visibleDates.slice(-7)
  const last7GoalDays = last7Dates.filter(date => (durationByDate[date] || 0) >= safeDailyGoal).length
  const currentWeekDates = getCurrentWeekDates(parseDateStr(todayStr))
  const currentWeekDuration = currentWeekDates.reduce((sum, date) => sum + (durationByDate[date] || 0), 0)
  const currentWeekGoalDays = currentWeekDates.filter(date => (durationByDate[date] || 0) >= safeDailyGoal).length
  const currentWeekElapsedDays = currentWeekDates.findIndex(date => date === todayStr) + 1 || 1
  const currentWeekGoalDuration = safeDailyGoal * 7
  const currentWeekExpectedDuration = safeDailyGoal * currentWeekElapsedDays

  return {
    dailyGoal: safeDailyGoal,
    todayDuration,
    todayCompletionRate: todayDuration / safeDailyGoal,
    todayRemainingDuration: Math.max(0, safeDailyGoal - todayDuration),
    rangeGoalDays,
    rangeGoalRate: visibleDates.length > 0 ? rangeGoalDays / visibleDates.length : 0,
    last7GoalDays,
    last7GoalRate: last7Dates.length > 0 ? last7GoalDays / last7Dates.length : 0,
    currentWeekDuration,
    currentWeekGoalDuration,
    currentWeekCompletionRate: currentWeekDuration / currentWeekGoalDuration,
    currentWeekGoalDays,
    currentWeekElapsedDays,
    currentWeekExpectedDuration,
    currentWeekPaceDelta: currentWeekDuration - currentWeekExpectedDuration,
  }
}

export const deriveSummaryFromDailyRecords = (dailyRecords: Record<string, DailyRecord>): DerivedLearningSummary => {
  const activeDates = Object.entries(dailyRecords)
    .filter(([date, record]) => {
      const safeRecord = ensureDailyRecord(date, record)
      return safeRecord.totalDuration > 0
    })
    .map(([date]) => date)
    .sort()

  let totalDuration = 0
  Object.entries(dailyRecords).forEach(([date, record]) => {
    totalDuration += ensureDailyRecord(date, record).totalDuration || 0
  })

  let longestStreak = 0
  let currentLongestRun = 0
  let currentStreak = 0
  let lastActiveDate = ''

  activeDates.forEach((date, index) => {
    if (index === 0) {
      currentLongestRun = 1
    } else {
      const previous = parseDateStr(activeDates[index - 1])
      const current = parseDateStr(date)
      const diffDays = Math.floor((current.getTime() - previous.getTime()) / (1000 * 3600 * 24))
      currentLongestRun = diffDays === 1 ? currentLongestRun + 1 : 1
    }

    if (currentLongestRun > longestStreak) {
      longestStreak = currentLongestRun
    }
  })

  if (activeDates.length > 0) {
    lastActiveDate = activeDates[activeDates.length - 1]
    currentStreak = 1

    for (let index = activeDates.length - 1; index > 0; index -= 1) {
      const current = parseDateStr(activeDates[index])
      const previous = parseDateStr(activeDates[index - 1])
      const diffDays = Math.floor((current.getTime() - previous.getTime()) / (1000 * 3600 * 24))
      if (diffDays !== 1) break
      currentStreak += 1
    }
  }

  return {
    totalDuration,
    currentStreak,
    longestStreak,
    lastActiveDate,
  }
}

export const buildTrendPoints = (
  dates: string[],
  durationByDate: Record<string, number>,
  rangeKey: StatisticsRangeKey,
): TrendPoint[] => {
  if (rangeKey === '90d') {
    const points: TrendPoint[] = []
    for (let index = 0; index < dates.length; index += 7) {
      const chunk = dates.slice(index, index + 7)
      if (chunk.length === 0) continue
      points.push({
        key: `${chunk[0]}-${chunk[chunk.length - 1]}`,
        label: formatDateLabel(chunk[chunk.length - 1]),
        duration: chunk.reduce((sum, date) => sum + (durationByDate[date] || 0), 0),
      })
    }
    return points
  }

  return dates.map(date => ({
    key: date,
    label: formatDateLabel(date),
    duration: durationByDate[date] || 0,
  }))
}
