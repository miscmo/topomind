/**
 * MonitorPage 状态管理（Zustand）
 * 日志性能监控窗口的状态
 */
import { create } from 'zustand'
import type {
  AttachmentDebugHealthResponse,
  FileCacheHealth,
  ImportDebugHealthResponse,
  LocalAttachmentUploadJob,
  LocalImportJobRecord,
  LocalSyncConflictRecord,
  LocalSyncOutboxItem,
  SyncDebugSnapshotResponse,
} from '../../../types/debug-runtime'

/** Log entry shape emitted by log-backend */
export interface LogEntry {
  timestamp: string
  level: string
  message: string
  action?: string
  module?: string
  params?: object
  error?: string | null
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

const MONITOR_INITIAL_STATE = {
  activeTab: 'log' as const,
  keyword: '',
  selectedDate: null as string | null,
  availableDates: [] as string[],
  selectedLevels: [] as string[],
  entries: [] as LogEntry[],
  selectedEntry: null as LogEntry | null,
  streaming: true,
  stats: { total: 0, debug: 0, info: 0, warn: 0, error: 0 },
  loaded: false,
  syncSnapshot: null as SyncDebugSnapshotResponse | null,
  syncSnapshotLoading: false,
  syncSnapshotLoaded: false,
  syncSnapshotError: '',
  syncOutboxItems: [] as LocalSyncOutboxItem[],
  syncConflicts: [] as LocalSyncConflictRecord[],
  syncDetailsLoading: false,
  syncDetailsLoaded: false,
  syncDetailsError: '',
  fileCacheHealth: null as FileCacheHealth | null,
  attachmentHealth: null as AttachmentDebugHealthResponse | null,
  importHealth: null as ImportDebugHealthResponse | null,
  importRuntimeLoading: false,
  importRuntimeLoaded: false,
  importRuntimeError: '',
  attachmentUploadJobs: [] as LocalAttachmentUploadJob[],
  importJobs: [] as LocalImportJobRecord[],
  importDetailsLoading: false,
  importDetailsLoaded: false,
  importDetailsError: '',
}

interface MonitorState {
  // 当前 tab
  activeTab: 'log' | 'performance' | 'sync' | 'import'
  setActiveTab: (tab: 'log' | 'performance' | 'sync' | 'import') => void

  // 筛选条件
  keyword: string
  selectedDate: string | null  // YYYY-MM-DD
  availableDates: string[]
  selectedLevels: string[]  // ['DEBUG','INFO','WARN','ERROR']

  setKeyword: (kw: string) => void
  setSelectedDate: (d: string | null) => void
  setAvailableDates: (dates: string[]) => void
  setSelectedLevels: (levels: string[]) => void

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
  syncSnapshot: SyncDebugSnapshotResponse | null
  syncSnapshotLoading: boolean
  syncSnapshotLoaded: boolean
  syncSnapshotError: string
  syncOutboxItems: LocalSyncOutboxItem[]
  syncConflicts: LocalSyncConflictRecord[]
  syncDetailsLoading: boolean
  syncDetailsLoaded: boolean
  syncDetailsError: string
  fileCacheHealth: FileCacheHealth | null
  attachmentHealth: AttachmentDebugHealthResponse | null
  importHealth: ImportDebugHealthResponse | null
  importRuntimeLoading: boolean
  importRuntimeLoaded: boolean
  importRuntimeError: string
  attachmentUploadJobs: LocalAttachmentUploadJob[]
  importJobs: LocalImportJobRecord[]
  importDetailsLoading: boolean
  importDetailsLoaded: boolean
  importDetailsError: string
  setSyncSnapshot: (snapshot: SyncDebugSnapshotResponse | null) => void
  setSyncSnapshotLoading: (loading: boolean) => void
  setSyncSnapshotError: (error: string) => void
  setSyncDetails: (input: {
    outboxItems: LocalSyncOutboxItem[]
    conflicts: LocalSyncConflictRecord[]
  }) => void
  setSyncDetailsLoading: (loading: boolean) => void
  setSyncDetailsError: (error: string) => void
  setImportRuntime: (input: {
    fileCacheHealth: FileCacheHealth | null
    attachmentHealth: AttachmentDebugHealthResponse | null
    importHealth: ImportDebugHealthResponse | null
  }) => void
  setImportRuntimeLoading: (loading: boolean) => void
  setImportRuntimeError: (error: string) => void
  setImportDetails: (input: {
    attachmentUploadJobs: LocalAttachmentUploadJob[]
    importJobs: LocalImportJobRecord[]
  }) => void
  setImportDetailsLoading: (loading: boolean) => void
  setImportDetailsError: (error: string) => void
  reset: () => void
}

const EMPTY_STATS = { total: 0, debug: 0, info: 0, warn: 0, error: 0 }

export const useMonitorStore = create<MonitorState>((set, get) => ({
  ...MONITOR_INITIAL_STATE,

  setActiveTab: (tab) => set({ activeTab: tab }),

  setKeyword: (keyword) => set({ keyword }),
  setSelectedDate: (selectedDate) => set({ selectedDate }),
  setAvailableDates: (availableDates) => set({ availableDates }),
  setSelectedLevels: (selectedLevels) => set({ selectedLevels }),

  setEntries: (entries) => {
    set({ entries, loaded: true })
    get().updateStats()
  },

  appendEntries: (newEntries) => {
    const { entries } = get()
    // 按 id 去重，防止同一条日志通过 buffer 加载和 IPC 订阅两个路径重复添加
    const existingIds = new Set(entries.map((e) => e.id).filter(Boolean))
    const unique = newEntries.filter((n) => !n.id || !existingIds.has(n.id))
    // 保留最新 5000 条
    const combined = [...entries, ...unique]
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

  setSyncSnapshot: (syncSnapshot) =>
    set({
      syncSnapshot,
      syncSnapshotLoaded: true,
      syncSnapshotLoading: false,
      syncSnapshotError: '',
    }),

  setSyncSnapshotLoading: (syncSnapshotLoading) => set({ syncSnapshotLoading }),

  setSyncSnapshotError: (syncSnapshotError) =>
    set({
      syncSnapshotError,
      syncSnapshotLoaded: true,
      syncSnapshotLoading: false,
    }),

  setSyncDetails: ({ outboxItems, conflicts }) =>
    set({
      syncOutboxItems: outboxItems,
      syncConflicts: conflicts,
      syncDetailsLoaded: true,
      syncDetailsLoading: false,
      syncDetailsError: '',
    }),

  setSyncDetailsLoading: (syncDetailsLoading) => set({ syncDetailsLoading }),

  setSyncDetailsError: (syncDetailsError) =>
    set({
      syncDetailsError,
      syncDetailsLoaded: true,
      syncDetailsLoading: false,
    }),

  setImportRuntime: ({ fileCacheHealth, attachmentHealth, importHealth }) =>
    set({
      fileCacheHealth,
      attachmentHealth,
      importHealth,
      importRuntimeLoaded: true,
      importRuntimeLoading: false,
      importRuntimeError: '',
    }),

  setImportRuntimeLoading: (importRuntimeLoading) => set({ importRuntimeLoading }),

  setImportRuntimeError: (importRuntimeError) =>
    set({
      importRuntimeError,
      importRuntimeLoaded: true,
      importRuntimeLoading: false,
    }),

  setImportDetails: ({ attachmentUploadJobs, importJobs }) =>
    set({
      attachmentUploadJobs,
      importJobs,
      importDetailsLoaded: true,
      importDetailsLoading: false,
      importDetailsError: '',
    }),

  setImportDetailsLoading: (importDetailsLoading) => set({ importDetailsLoading }),

  setImportDetailsError: (importDetailsError) =>
    set({
      importDetailsError,
      importDetailsLoaded: true,
      importDetailsLoading: false,
    }),

  reset: () => set({ ...MONITOR_INITIAL_STATE, stats: { ...EMPTY_STATS } }),
}))
