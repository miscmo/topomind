/**
 * MonitorPage 状态管理（Zustand）
 * 日志性能监控窗口的状态
 */
import { create } from 'zustand'

/** Log entry shape emitted by log-backend */
export interface LogEntry {
  timestamp: string
  level: string
  message: string
  action?: string
  module?: string
  params?: object
  // Extended fields from log-backend
  id?: string
  func?: string
  file?: string
  line?: number
  traceId?: string
  spanId?: string
  parentId?: string
  meta?: Record<string, unknown>
}

interface MonitorState {
  // 当前 tab
  activeTab: 'log' | 'performance'
  setActiveTab: (tab: 'log' | 'performance') => void

  // 筛选条件
  keyword: string
  selectedDate: string  // YYYY-MM-DD
  availableDates: string[]
  selectedLevels: string[]  // ['DEBUG','INFO','WARN','ERROR']
  selectedActions: string[]

  setKeyword: (kw: string) => void
  setSelectedDate: (d: string) => void
  setAvailableDates: (dates: string[]) => void
  setSelectedLevels: (levels: string[]) => void
  setSelectedActions: (actions: string[]) => void

  // 日志列表
  entries: LogEntry[]
  setEntries: (entries: LogEntry[]) => void
  appendEntries: (newEntries: LogEntry[]) => void

  // 选中的条目
  selectedEntry: LogEntry | null
  setSelectedEntry: (entry: LogEntry | null) => void

  // 实时流开关
  streaming: boolean
  setStreaming: (on: boolean) => void

  // 统计
  stats: {
    total: number
    debug: number
    info: number
    warn: number
    error: number
  }
  updateStats: () => void

  // 是否已加载
  loaded: boolean
  setLoaded: (v: boolean) => void
}

const EMPTY_STATS = { total: 0, debug: 0, info: 0, warn: 0, error: 0 }

/** @type {MonitorState} */
const initialState = {
  activeTab: 'log' as const,
  keyword: '',
  selectedDate: '',
  availableDates: [] as string[],
  selectedLevels: [] as string[],
  selectedActions: [] as string[],
  entries: [] as LogEntry[],
  selectedEntry: null as LogEntry | null,
  streaming: true,
  stats: { ...EMPTY_STATS },
  loaded: false,
}

export const useMonitorStore = create<MonitorState>((set, get) => ({
  ...initialState,

  setActiveTab: (tab) => set({ activeTab: tab }),

  setKeyword: (keyword) => set({ keyword }),
  setSelectedDate: (selectedDate) => set({ selectedDate }),
  setAvailableDates: (availableDates) => set({ availableDates }),
  setSelectedLevels: (selectedLevels) => set({ selectedLevels }),
  setSelectedActions: (selectedActions) => set({ selectedActions }),

  setEntries: (entries) => {
    set({ entries, loaded: true })
    get().updateStats()
  },

  appendEntries: (newEntries) => {
    const { entries } = get()
    // 保留最新 5000 条
    const combined = [...entries, ...newEntries]
    const trimmed = combined.length > 5000 ? combined.slice(-5000) : combined
    set({ entries: trimmed })
    get().updateStats()
  },

  setSelectedEntry: (selectedEntry) => set({ selectedEntry }),

  setStreaming: (streaming) => set({ streaming }),

  updateStats: () => {
    const { entries } = get()
    const stats = { ...EMPTY_STATS }
    for (const e of entries) {
      const l = (e.level || 'INFO').toLowerCase()
      if (l === 'debug') stats.debug++
      else if (l === 'info') stats.info++
      else if (l === 'warn') stats.warn++
      else if (l === 'error') stats.error++
      stats.total++
    }
    set({ stats })
  },

  setLoaded: (loaded) => set({ loaded }),
}))

/** @typedef {LogEntry & { _filtered?: boolean }} LogEntry */
