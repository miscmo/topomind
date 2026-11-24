import { create } from 'zustand'
// Node 门禁直接加载本文件，显式 .ts 后缀不能省（见上方 accentColor 的注释）。
import { attachStateObservation } from '../core/observabilityStoreMiddleware.ts'
// 相对路径 + 显式 .ts：scripts/verify-critical-regressions.mts 会以 Node ESM 直接导入
// 本文件（断言主题迁移逻辑），Node 不认识 vite 的 @/ 别名。
import {
  DEFAULT_ACCENT_COLOR,
  normalizeAccentColor,
  type AccentTheme,
} from '../domain/theme/accentColor.ts'
import { applyAccentColor } from '../domain/theme/applyAccentColor.ts'
import { parseThemeConfig } from '../domain/theme/themeConfig.ts'

/**
 * 界面主题只保留两套：浅色（GitHub Light）与深色（经典深色）。
 * 标题栏「视图 → 主题」菜单也只提供这两项。
 *
 * 主题色是独立于明暗模式的第二个外观维度，与主题同生命周期（都是 localStorage 级
 * 全局 UI 偏好，不绑工作区）。两者在这里统一编排：切换明暗时必须用同一基色重新派生
 * 色阶，否则浅色 / 深色的亮度层级会错位。
 */
export type ThemeMode = 'github-light' | 'dark'

export const LIGHT_THEME: ThemeMode = 'github-light'
export const DARK_THEME: ThemeMode = 'dark'

const THEME_STORAGE_KEY = 'topomind:theme-mode'
const ACCENT_STORAGE_KEY = 'topomind:accent-color'

/**
 * 已下线主题 → 替代主题。
 * 仅用于把老存档一次性迁移到浅色/深色，不参与任何运行时逻辑；
 * 迁移完成并回写后即可安全删除本表。
 */
const RETIRED_THEME_MAP: Record<string, ThemeMode> = {
  light: LIGHT_THEME,
  'notion-light': LIGHT_THEME,
  'linear-light': LIGHT_THEME,
  'nord-light': LIGHT_THEME,
  'rose-pine-dawn': LIGHT_THEME,
  'catppuccin-latte': LIGHT_THEME,
  'solarized-light': LIGHT_THEME,
  dracula: DARK_THEME,
  monokai: DARK_THEME,
  'github-dark': DARK_THEME,
  'solarized-dark': DARK_THEME,
  'one-dark-pro': DARK_THEME,
  'tokyo-night': DARK_THEME,
  'catppuccin-mocha': DARK_THEME,
}

/** 老主题值迁移到当前两套之一；返回 null 表示无法识别，由调用方回落系统主题 */
export function migrateRetiredTheme(value: string): ThemeMode | null {
  return RETIRED_THEME_MAP[value] ?? null
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === LIGHT_THEME || value === DARK_THEME
}

export function isDarkTheme(theme: ThemeMode): boolean {
  return theme === DARK_THEME
}

function accentThemeOf(theme: ThemeMode): AccentTheme {
  return isDarkTheme(theme) ? 'dark' : 'light'
}

function getSystemTheme(): ThemeMode {
  if (!window.matchMedia) return LIGHT_THEME
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK_THEME : LIGHT_THEME
}

function readRawTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    return null
  }
}

function resolveStoredTheme(raw: string | null): ThemeMode | null {
  if (!raw) return null
  if (isThemeMode(raw)) return raw
  return migrateRetiredTheme(raw)
}

function persistTheme(theme: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    return
  }
}

/**
 * 读取走版本化入口：当前线上存档是裸 hex（v0），未来主题皮肤配置是带 version 的
 * JSON；parseThemeConfig 两者都能读，非法 / 缺失 / 损坏 / 越版本一律回落默认品牌色，
 * 避免注入一串坏变量把界面染花。
 * 写盘格式暂保持裸 hex（见 persistAccentColor），因此这次改造对现有存档零行为变化。
 */
function readAccentColor(): string {
  try {
    const raw = window.localStorage.getItem(ACCENT_STORAGE_KEY)
    return parseThemeConfig(raw, DEFAULT_ACCENT_COLOR).accentColor
  } catch {
    return DEFAULT_ACCENT_COLOR
  }
}

/** v0 写盘格式：未来切到 serializeThemeConfig 时，读侧的 parseThemeConfig 已能兼容。 */
function persistAccentColor(color: string) {
  try {
    if (color === DEFAULT_ACCENT_COLOR) {
      window.localStorage.removeItem(ACCENT_STORAGE_KEY)
    } else {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, color)
    }
  } catch {
    return
  }
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = isDarkTheme(theme) ? 'dark' : 'light'

  if (isDarkTheme(theme)) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

interface ThemeStore {
  theme: ThemeMode
  /** 用户选择的主题色基色（规范化后的 6 位 hex）。派生色阶不进 store。 */
  accentColor: string
  initializeTheme: () => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  setAccentColor: (hex: string) => void
  resetAccentColor: () => void
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  // 初始值也用浅色主题，避免初始化前菜单出现无勾选项的中间态
  theme: LIGHT_THEME,
  accentColor: DEFAULT_ACCENT_COLOR,
  initializeTheme: () => {
    const raw = readRawTheme()
    const theme = resolveStoredTheme(raw) ?? getSystemTheme()
    // 首次使用、或从已下线主题迁移过来时回写一次
    if (raw !== theme) {
      persistTheme(theme)
    }
    applyTheme(theme)
    const accentColor = readAccentColor()
    applyAccentColor(accentColor, accentThemeOf(theme))
    set({ theme, accentColor })
  },
  setTheme: (theme) => {
    applyTheme(theme)
    // 同一基色在浅色 / 深色下派生的亮度层级不同，必须重新注入。
    applyAccentColor(get().accentColor, accentThemeOf(theme))
    persistTheme(theme)
    set({ theme })
  },
  toggleTheme: () => {
    const current = get().theme
    get().setTheme(isDarkTheme(current) ? LIGHT_THEME : DARK_THEME)
  },
  setAccentColor: (hex) => {
    const color = normalizeAccentColor(hex)
    if (!color) return
    applyAccentColor(color, accentThemeOf(get().theme))
    persistAccentColor(color)
    set({ accentColor: color })
  },
  resetAccentColor: () => {
    get().setAccentColor(DEFAULT_ACCENT_COLOR)
  },
}))

// P7 M3：主题持久化状态变更自动补一条内存步骤（不落盘）。
attachStateObservation(useThemeStore, { name: 'theme' })
