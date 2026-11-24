/**
 * Debug HUD 的 UI 状态（P6 / D18，P8 增加透明背景）。
 *
 * 与 layoutStore 同套路：zustand + localStorage，读时逐字段校验，
 * 隐私模式 / 配额不足时退化为内存态。开关状态持久化是刻意选择——
 * 用户主动开的透明化工具不该每次重启都要重开；浮窗与菜单都常驻可见的关闭入口。
 */
import { create } from 'zustand'
import { DEBUG_HUD_CATEGORIES, DEBUG_HUD_LEVELS } from './debugLogBuffer'
import { translucentPatch } from './debugSurface'

const STORAGE_KEY = 'topomind_debug_hud_v1'

export interface DebugHudBounds {
  /** -1 = 首次显示时按视口右下角自动定位。 */
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_DEBUG_BOUNDS: DebugHudBounds = {
  x: -1,
  y: -1,
  width: 480,
  height: 280,
}

const MIN_WIDTH = 280
const MAX_WIDTH = 1200
const MIN_HEIGHT = 120
const MAX_HEIGHT = 900

interface PersistedDebugHud {
  enabled: boolean
  collapsed: boolean
  bounds: DebugHudBounds
  /** 暂停 = 定格当前视图并停止自动滚动，仍继续收集（恢复后一次补齐）。 */
  paused: boolean
  autoScroll: boolean
  /** 详细模式 = 行内可展开 params/error；默认关，避免屏幕上直接暴露详情。 */
  detailed: boolean
  /** 点击穿透 = 日志区不拦截鼠标，调试时不挡住下层界面；标题栏始终可点。 */
  clickThrough: boolean
  /** P8：半透明背景。开启时联动打开穿透，关闭不擅自改回用户的穿透选择。 */
  translucent: boolean
  levels: readonly string[]
  categories: readonly string[]
  keyword: string
}

const INITIAL: PersistedDebugHud = {
  enabled: false,
  collapsed: false,
  bounds: { ...DEFAULT_DEBUG_BOUNDS },
  paused: false,
  autoScroll: true,
  detailed: false,
  clickThrough: false,
  translucent: false,
  levels: [],
  categories: [],
  keyword: '',
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function readStringList(value: unknown, allowed: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && (allowed as readonly string[]).includes(item))
}

function readPersisted(): PersistedDebugHud {
  if (typeof window === 'undefined') {
    return { ...INITIAL, bounds: { ...DEFAULT_DEBUG_BOUNDS }, levels: [], categories: [] }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...INITIAL, bounds: { ...DEFAULT_DEBUG_BOUNDS }, levels: [], categories: [] }
    const parsed = JSON.parse(raw) as Partial<PersistedDebugHud>
    const rawBounds = parsed.bounds
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : INITIAL.enabled,
      collapsed: typeof parsed.collapsed === 'boolean' ? parsed.collapsed : INITIAL.collapsed,
      bounds: rawBounds
        ? {
            x: clamp(rawBounds.x, -1, 10000, DEFAULT_DEBUG_BOUNDS.x),
            y: clamp(rawBounds.y, -1, 10000, DEFAULT_DEBUG_BOUNDS.y),
            width: clamp(rawBounds.width, MIN_WIDTH, MAX_WIDTH, DEFAULT_DEBUG_BOUNDS.width),
            height: clamp(rawBounds.height, MIN_HEIGHT, MAX_HEIGHT, DEFAULT_DEBUG_BOUNDS.height),
          }
        : { ...DEFAULT_DEBUG_BOUNDS },
      paused: typeof parsed.paused === 'boolean' ? parsed.paused : INITIAL.paused,
      autoScroll: typeof parsed.autoScroll === 'boolean' ? parsed.autoScroll : INITIAL.autoScroll,
      detailed: typeof parsed.detailed === 'boolean' ? parsed.detailed : INITIAL.detailed,
      clickThrough: typeof parsed.clickThrough === 'boolean' ? parsed.clickThrough : INITIAL.clickThrough,
      translucent: typeof parsed.translucent === 'boolean' ? parsed.translucent : INITIAL.translucent,
      levels: readStringList(parsed.levels, DEBUG_HUD_LEVELS),
      categories: readStringList(parsed.categories, DEBUG_HUD_CATEGORIES),
      keyword: typeof parsed.keyword === 'string' ? parsed.keyword.slice(0, 200) : '',
    }
  } catch {
    return { ...INITIAL, bounds: { ...DEFAULT_DEBUG_BOUNDS }, levels: [], categories: [] }
  }
}

function persist(state: PersistedDebugHud): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 隐私模式 / 配额不足：退化为内存态，不影响功能
  }
}

interface DebugHudStore extends PersistedDebugHud {
  setEnabled: (value: boolean) => void
  toggleEnabled: () => void
  setCollapsed: (value: boolean) => void
  setBounds: (patch: Partial<DebugHudBounds>) => void
  setPaused: (value: boolean) => void
  setAutoScroll: (value: boolean) => void
  setDetailed: (value: boolean) => void
  setClickThrough: (value: boolean) => void
  setTranslucent: (value: boolean) => void
  toggleLevel: (level: string) => void
  toggleCategory: (category: string) => void
  clearFilters: () => void
  setKeyword: (value: string) => void
  reset: () => void
}

function snapshot(state: DebugHudStore): PersistedDebugHud {
  return {
    enabled: state.enabled,
    collapsed: state.collapsed,
    bounds: state.bounds,
    paused: state.paused,
    autoScroll: state.autoScroll,
    detailed: state.detailed,
    clickThrough: state.clickThrough,
    translucent: state.translucent,
    levels: state.levels,
    categories: state.categories,
    keyword: state.keyword,
  }
}

/** 每个动作统一落盘，避免「改了状态但重启丢失」的隐式分歧。 */
function commit(set: (patch: Partial<DebugHudStore>) => void, get: () => DebugHudStore, patch: Partial<DebugHudStore>): void {
  set(patch)
  persist(snapshot(get()))
}

function toggleIn(list: readonly string[], value: string, allowed: readonly string[]): readonly string[] {
  if (!(allowed as readonly string[]).includes(value)) return list
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export const useDebugHudStore = create<DebugHudStore>((set, get) => ({
  ...readPersisted(),

  setEnabled: (enabled) => commit(set, get, { enabled }),
  toggleEnabled: () => commit(set, get, { enabled: !get().enabled }),
  setCollapsed: (collapsed) => commit(set, get, { collapsed }),
  setBounds: (patch) => commit(set, get, {
    bounds: {
      x: clamp(patch.x ?? get().bounds.x, -1, 10000, get().bounds.x),
      y: clamp(patch.y ?? get().bounds.y, -1, 10000, get().bounds.y),
      width: clamp(patch.width ?? get().bounds.width, MIN_WIDTH, MAX_WIDTH, get().bounds.width),
      height: clamp(patch.height ?? get().bounds.height, MIN_HEIGHT, MAX_HEIGHT, get().bounds.height),
    },
  }),
  setPaused: (paused) => commit(set, get, { paused }),
  setAutoScroll: (autoScroll) => commit(set, get, { autoScroll }),
  setDetailed: (detailed) => commit(set, get, { detailed }),
  setClickThrough: (clickThrough) => commit(set, get, { clickThrough }),
  setTranslucent: (translucent) => commit(set, get, translucentPatch(get(), translucent)),
  toggleLevel: (level) => commit(set, get, { levels: toggleIn(get().levels, level, DEBUG_HUD_LEVELS) }),
  toggleCategory: (category) => commit(set, get, { categories: toggleIn(get().categories, category, DEBUG_HUD_CATEGORIES) }),
  clearFilters: () => commit(set, get, { levels: [], categories: [], keyword: '' }),
  setKeyword: (keyword) => commit(set, get, { keyword: keyword.slice(0, 200) }),
  reset: () => commit(set, get, { ...INITIAL, bounds: { ...DEFAULT_DEBUG_BOUNDS }, levels: [], categories: [] }),
}))
