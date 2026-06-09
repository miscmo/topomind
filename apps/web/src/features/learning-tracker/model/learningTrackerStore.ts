import { create } from 'zustand'
import {
  readAllLearningStatsData,
  readLearningStatsData,
  writeLearningStatsData,
} from '../../../core/learning-stats-backend'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { deriveSummaryFromDailyRecords } from './learningTrackerAnalytics'
import { resolveLearningSessionContext, type LearningSessionContext } from './learningTrackerContextStore'

export interface LearningSession {
  id: string
  startTime: number
  endTime: number
  duration: number
  context?: LearningSessionContext
}

export interface DailyRecord {
  date: string
  totalDuration: number
  sessions: LearningSession[]
}

export interface LearningStatsMeta {
  version: "1.0"
  settings: {
    idleThreshold: number // seconds
    dailyGoal: number     // seconds
  }
  summary: {
    totalDuration: number
    currentStreak: number
    longestStreak: number
    lastActiveDate: string
  }
}

interface LearningTrackerState {
  isActive: boolean
  lastActiveTime: number
  todayDuration: number // seconds
  lastFlushedDuration: number // 记录当前日期上次 flush 时的时长快照
  currentDateStr: string // 记录当前的日期字符串，用于判断跨天
  currentSession: LearningSession | null
  meta: LearningStatsMeta | null
  
  // Actions
  init: () => Promise<void>
  recordActivity: () => void
  tick: () => void
  flush: (rootDirOverride?: string | null) => Promise<void>
  setIdle: () => void
  shutdown: (rootDirOverride?: string | null) => Promise<void>
}

const IDLE_THRESHOLD = 180 // 3 minutes

const getTodayDateStr = () => {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getDateStrFromTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getStartOfNextDay = (timestamp: number) => {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

const splitSessionAcrossDates = (session: LearningSession): Array<LearningSession & { date: string }> => {
  const safeEndTime = Math.max(session.startTime, session.endTime)
  const totalDuration = Math.max(0, session.duration)
  const startDate = getDateStrFromTime(session.startTime)
  const endDate = getDateStrFromTime(safeEndTime)

  if (startDate === endDate || totalDuration === 0) {
    return [{ ...session, endTime: safeEndTime, date: startDate }]
  }

  const totalMs = Math.max(1, safeEndTime - session.startTime)
  const segments: Array<LearningSession & { date: string }> = []
  let cursor = session.startTime
  let remainingDuration = totalDuration

  while (cursor < safeEndTime) {
    const segmentEnd = Math.min(getStartOfNextDay(cursor), safeEndTime)
    const chunkMs = Math.max(0, segmentEnd - cursor)
    const isLast = segmentEnd >= safeEndTime
    const segmentDuration = isLast
      ? remainingDuration
      : Math.min(remainingDuration, Math.round((totalDuration * chunkMs) / totalMs))

    segments.push({
      ...session,
      startTime: cursor,
      endTime: segmentEnd,
      duration: Math.max(0, segmentDuration),
      date: getDateStrFromTime(cursor),
    })

    remainingDuration = Math.max(0, remainingDuration - segmentDuration)
    cursor = segmentEnd
  }

  if (segments.length === 0) {
    return [{ ...session, endTime: safeEndTime, date: startDate }]
  }

  return segments
}

export const useLearningTrackerStore = create<LearningTrackerState>((set, get) => {
  let tickInterval: ReturnType<typeof setInterval> | null = null
  let saveInterval: ReturnType<typeof setInterval> | null = null
  let activeFlush: Promise<void> | null = null
  let queuedFlush = false

  const clearTimers = () => {
    if (tickInterval) {
      clearInterval(tickInterval)
      tickInterval = null
    }
    if (saveInterval) {
      clearInterval(saveInterval)
      saveInterval = null
    }
  }

  const resolveWorkspaceRoot = (workspaceRootOverride?: string | null) => workspaceRootOverride ?? useWorkspaceStore.getState().currentWorkspaceRoot

  const normalizeMeta = (meta: LearningStatsMeta | null | undefined): LearningStatsMeta => ({
    version: "1.0",
    settings: {
      idleThreshold: IDLE_THRESHOLD,
      dailyGoal: meta?.settings?.dailyGoal ?? 3600 * 2
    },
    summary: {
      totalDuration: meta?.summary?.totalDuration ?? 0,
      currentStreak: meta?.summary?.currentStreak ?? 0,
      longestStreak: meta?.summary?.longestStreak ?? 0,
      lastActiveDate: meta?.summary?.lastActiveDate ?? ""
    }
  })

  const doFlush = async (workspaceRootOverride?: string | null) => {
    const workspaceRoot = resolveWorkspaceRoot(workspaceRootOverride)
    if (!workspaceRoot) return

    const state = get()
    if (!state.meta) return

    try {
      const nextMeta = normalizeMeta(state.meta)
      const sessionSegments = state.currentSession ? splitSessionAcrossDates(state.currentSession) : []
      const affectedDates = new Set<string>([state.currentDateStr, ...sessionSegments.map(segment => segment.date)])
      const dayRecords = new Map<string, DailyRecord>()

      for (const dateStr of affectedDates) {
        let dayData = await readLearningStatsData(workspaceRoot, dateStr) as DailyRecord
        if (!dayData || !dayData.date) {
          dayData = { date: dateStr, totalDuration: 0, sessions: [] }
        } else if (!Array.isArray(dayData.sessions)) {
          dayData.sessions = []
        }
        dayRecords.set(dateStr, dayData)
      }

      for (const segment of sessionSegments) {
        const dayData = dayRecords.get(segment.date)
        if (!dayData) continue

        const previousTotal = dayData.totalDuration || 0
        const existingIdx = dayData.sessions.findIndex(session => session.id === segment.id)
        const previousDuration = existingIdx >= 0 ? Math.max(0, dayData.sessions[existingIdx].duration || 0) : 0

        if (existingIdx >= 0) {
          dayData.sessions[existingIdx] = segment
        } else {
          dayData.sessions.push(segment)
        }

        const nextTotal = Math.max(0, previousTotal + (segment.duration - previousDuration))
        dayData.totalDuration = nextTotal
        dayData.sessions.sort((a, b) => a.startTime - b.startTime)
      }

      for (const [dateStr, dayData] of dayRecords.entries()) {
        await writeLearningStatsData(workspaceRoot, dateStr, dayData)
      }

      const allDailyRecords = await readAllLearningStatsData(workspaceRoot) as Record<string, DailyRecord>
      const derivedSummary = deriveSummaryFromDailyRecords(allDailyRecords)
      nextMeta.summary = derivedSummary

      await writeLearningStatsData(workspaceRoot, null, nextMeta)

      set(current => ({
        meta: nextMeta,
        lastFlushedDuration: state.todayDuration
      }))
    } catch (err) {
      console.error("Failed to flush learning stats", err)
    }
  }

  const enqueueFlush = async (workspaceRootOverride?: string | null) => {
    if (activeFlush) {
      queuedFlush = true
      return activeFlush
    }

    activeFlush = (async () => {
      let override = workspaceRootOverride
      do {
        queuedFlush = false
        await doFlush(override)
        override = undefined
      } while (queuedFlush)
    })().finally(() => {
      activeFlush = null
    })

    return activeFlush
  }

  return {
    isActive: false,
    lastActiveTime: Date.now(),
    todayDuration: 0,
    lastFlushedDuration: 0,
    currentDateStr: getTodayDateStr(),
    currentSession: null,
    meta: null,

    init: async () => {
      const workspaceRoot = useWorkspaceStore.getState().currentWorkspaceRoot
      if (!workspaceRoot) return

      try {
        const rawMeta = normalizeMeta(await readLearningStatsData(workspaceRoot) as LearningStatsMeta)
        const allDailyRecords = await readAllLearningStatsData(workspaceRoot) as Record<string, DailyRecord>
        const meta = {
          ...rawMeta,
          summary: deriveSummaryFromDailyRecords(allDailyRecords)
        }

        const todayStr = getTodayDateStr()
        let todayData = await readLearningStatsData(workspaceRoot, todayStr) as DailyRecord
        if (!todayData || !todayData.date) {
          todayData = { date: todayStr, totalDuration: 0, sessions: [] }
        }

        await writeLearningStatsData(workspaceRoot, null, meta)

        set({
          isActive: false,
          meta,
          todayDuration: todayData.totalDuration,
          lastFlushedDuration: todayData.totalDuration,
          currentDateStr: todayStr,
          lastActiveTime: Date.now(),
          currentSession: null
        })

        clearTimers()
        tickInterval = setInterval(() => get().tick(), 1000)
        saveInterval = setInterval(() => {
          void get().flush()
        }, 60000)

      } catch (err) {
        console.error("Failed to init learning tracker", err)
      }
    },

    recordActivity: () => {
      const workspaceRoot = useWorkspaceStore.getState().currentWorkspaceRoot
      if (!workspaceRoot) return

      const now = Date.now()
      const { isActive, currentSession } = get()
      const sessionContext = resolveLearningSessionContext()

      if (!isActive) {
        set({
          isActive: true,
          lastActiveTime: now,
          currentSession: {
            id: Date.now().toString(),
            startTime: now,
            endTime: now,
            duration: 0,
            context: sessionContext,
          }
        })
      } else {
        set({
          lastActiveTime: now,
          currentSession: currentSession
            ? {
                ...currentSession,
                context: sessionContext,
              }
            : null,
        })
      }
    },

    setIdle: () => {
      if (get().isActive) {
        set({ isActive: false })
        void get().flush()
      }
    },

    tick: () => {
      const now = Date.now()
      const { isActive, lastActiveTime, currentSession, todayDuration, currentDateStr } = get()
      const workspaceRoot = useWorkspaceStore.getState().currentWorkspaceRoot
      if (!workspaceRoot) return

      const todayStr = getTodayDateStr()
      if (todayStr !== currentDateStr) {
        const keepActive = isActive && ((now - lastActiveTime) / 1000) <= IDLE_THRESHOLD
        void get().flush(workspaceRoot).then(() => {
          set({
            currentDateStr: todayStr,
            todayDuration: 0,
            lastFlushedDuration: 0,
            currentSession: keepActive ? {
              id: now.toString(),
              startTime: now,
              endTime: now,
              duration: 0,
              context: resolveLearningSessionContext(),
            } : null,
            isActive: keepActive
          })
        })
        return
      }

      if (isActive) {
        const threshold = get().meta?.settings.idleThreshold || IDLE_THRESHOLD
        const idleTime = (now - lastActiveTime) / 1000

        if (idleTime > threshold) {
          set({ isActive: false })
          void get().flush()
        } else {
          if (currentSession) {
            const newSession = { ...currentSession, endTime: now, duration: currentSession.duration + 1 }
            set({
              currentSession: newSession,
              todayDuration: todayDuration + 1
            })
          }
        }
      }
    },

    flush: async (rootDirOverride?: string | null) => {
      await enqueueFlush(rootDirOverride)
    },

    shutdown: async (rootDirOverride?: string | null) => {
      clearTimers()
      await enqueueFlush(rootDirOverride)
      set({
        isActive: false,
        currentSession: null
      })
    }
  }
})
