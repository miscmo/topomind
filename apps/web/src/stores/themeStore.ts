import { create } from 'zustand'

export type ThemeMode = 
  | 'light' 
  | 'dark' 
  | 'dracula' 
  | 'monokai' 
  | 'github-light' 
  | 'github-dark' 
  | 'solarized-light' 
  | 'solarized-dark' 
  | 'one-dark-pro'
  | 'notion-light'
  | 'linear-light'
  | 'catppuccin-latte'
  | 'rose-pine-dawn'
  | 'nord-light'
  | 'tokyo-night'
  | 'catppuccin-mocha'

const THEME_STORAGE_KEY = 'topomind:theme-mode'

const THEME_MODES = [
  'light', 'dark', 'dracula', 'monokai', 'github-light', 'github-dark', 'solarized-light', 'solarized-dark', 'one-dark-pro',
  'notion-light', 'linear-light', 'catppuccin-latte', 'rose-pine-dawn', 'nord-light', 'tokyo-night', 'catppuccin-mocha'
]

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && THEME_MODES.includes(value)
}

export function isDarkTheme(theme: ThemeMode): boolean {
  return ['dark', 'dracula', 'monokai', 'github-dark', 'solarized-dark', 'one-dark-pro', 'tokyo-night', 'catppuccin-mocha'].includes(theme)
}

function getSystemTheme(): ThemeMode {
  if (!window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredTheme(): ThemeMode | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeMode(value) ? value : null
  } catch {
    return null
  }
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
  theme: 'light',
  initializeTheme: () => {
    const theme = readStoredTheme() ?? getSystemTheme()
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
    const nextTheme = isDarkTheme(current) ? 'light' : 'dark'
    get().setTheme(nextTheme)
  },
}))
