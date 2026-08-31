import { create } from 'zustand'

/**
 * 界面主题只保留两套：浅色（GitHub Light）与深色（经典深色）。
 * 标题栏「视图 → 主题」菜单也只提供这两项。
 */
export type ThemeMode = 'github-light' | 'dark'

export const LIGHT_THEME: ThemeMode = 'github-light'
export const DARK_THEME: ThemeMode = 'dark'

const THEME_STORAGE_KEY = 'topomind:theme-mode'

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
  initializeTheme: () => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  // 初始值也用浅色主题，避免初始化前菜单出现无勾选项的中间态
  theme: LIGHT_THEME,
  initializeTheme: () => {
    const raw = readRawTheme()
    const theme = resolveStoredTheme(raw) ?? getSystemTheme()
    // 首次使用、或从已下线主题迁移过来时回写一次
    if (raw !== theme) {
      persistTheme(theme)
    }
    applyTheme(theme)
    set({ theme })
  },
  setTheme: (theme) => {
    applyTheme(theme)
    persistTheme(theme)
    set({ theme })
  },
  toggleTheme: () => {
    const current = get().theme
    get().setTheme(isDarkTheme(current) ? LIGHT_THEME : DARK_THEME)
  },
}))
