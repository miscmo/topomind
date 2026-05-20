import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { useThemeStore } from '../../stores/themeStore'
import TabBar from '../TabBar/TabBar'
import type { WindowControlsState } from '../../types/electron-api'
import styles from './CustomTitleBar.module.css'

type TitleBarMode = 'setup' | 'workspace'

type MenuKey = 'file' | 'view' | 'help'

type WindowCommandChannel = 'app:window:minimize' | 'app:window:toggleMaximize' | 'app:window:close'

interface CustomTitleBarProps {
  mode: TitleBarMode
}

interface MenuItem {
  label: string
  shortcut?: string
  disabled?: boolean
  action?: () => void
}

const MENU_LABELS: Array<{ key: MenuKey; label: string }> = [
  { key: 'file', label: '文件' },
  { key: 'view', label: '视图' },
  { key: 'help', label: '帮助' },
]

function isWindowControlsState(value: unknown): value is WindowControlsState {
  return !!value && typeof value === 'object' && 'isMaximized' in value && 'isFocused' in value
}

export default memo(function CustomTitleBar({ mode }: CustomTitleBarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null)
  const [windowState, setWindowState] = useState<WindowControlsState>({ isMaximized: false, isFocused: true })
  const openMonitorTab = useTabStore((s) => s.openMonitorTab)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    let disposed = false
    void api.invoke('app:window:getState').then((state) => {
      if (!disposed && isWindowControlsState(state)) setWindowState(state)
    })

    const handleWindowStateChange = (...args: unknown[]) => {
      const state = args[0]
      if (isWindowControlsState(state)) setWindowState(state)
    }

    api.on('app:window-state-change', handleWindowStateChange)
    return () => {
      disposed = true
      api.off('app:window-state-change', handleWindowStateChange)
    }
  }, [])

  useEffect(() => {
    if (!activeMenu) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setActiveMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveMenu(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeMenu])

  const invokeWindowCommand = useCallback((channel: WindowCommandChannel) => {
    const api = window.electronAPI
    if (!api) return

    void api.invoke(channel).then((state) => {
      if (isWindowControlsState(state)) setWindowState(state)
    })
  }, [])

  const menuItems = useMemo<Record<MenuKey, MenuItem[]>>(() => ({
    file: [
      { label: '切换工作目录', action: () => { void window.electronAPI?.invoke('app:switchWorkDir') } },
      { label: '退出 TopoMind', shortcut: 'Alt+F4', action: () => invokeWindowCommand('app:window:close') },
    ],
    view: [
      { label: '系统日志', action: () => openMonitorTab() },
      { label: '命令中心', shortcut: 'Ctrl+Shift+P', disabled: true },
      { label: '重置布局', disabled: true },
    ],
    help: [
      { label: '快捷键', disabled: true },
      { label: '关于 TopoMind', disabled: true },
    ],
  }), [invokeWindowCommand, openMonitorTab])

  return (
    <div 
      ref={rootRef} 
      className={`${styles.titleBar} ${!windowState.isFocused ? styles.unfocused : ''}`}
      onDoubleClick={(e) => {
        // Prevent double click on specific children from maximizing
        if (e.target instanceof Element && e.target.closest(`button, [role="tab"], .${styles.tabLabel}`)) {
          return
        }
        invokeWindowCommand('app:window:toggleMaximize')
      }}
    >
      <div className={styles.leftCluster}>
        <div className={styles.brand} title="TopoMind" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <span className={styles.brandMark}>🧠</span>
        </div>
        {mode === 'workspace' && (
          <nav className={styles.menuBar} aria-label="应用菜单" style={{ WebkitAppRegion: 'no-drag' } as any}>
            {MENU_LABELS.map((menu) => (
              <div key={menu.key} className={styles.menuWrap}>
                <button
                  type="button"
                  className={`${styles.menuButton} ${activeMenu === menu.key ? styles.menuButtonActive : ''}`}
                  onClick={() => setActiveMenu((current) => current === menu.key ? null : menu.key)}
                  onMouseEnter={() => { if (activeMenu) setActiveMenu(menu.key) }}
                  style={{ WebkitAppRegion: 'no-drag' } as any}
                >
                  {menu.label}
                </button>
                {activeMenu === menu.key && (
                  <div className={styles.menuPanel} role="menu">
                    {menuItems[menu.key].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className={styles.menuItem}
                        disabled={item.disabled}
                        onClick={() => {
                          if (item.disabled) return
                          setActiveMenu(null)
                          item.action?.()
                        }}
                      >
                        <span>{item.label}</span>
                        {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        )}
      </div>

      <div className={styles.centerCluster} style={{ WebkitAppRegion: 'drag' } as any}>
        {mode === 'workspace' && <TabBar />}
      </div>

      <div className={styles.rightCluster}>
        <button
          type="button"
          className={`${styles.toolButton} ${styles.themeButton}`}
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          aria-pressed={theme === 'dark'}
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <div className={styles.windowControls}>
          <button type="button" className={styles.windowButton} onClick={() => invokeWindowCommand('app:window:minimize')} aria-label="最小化窗口" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 5H10" stroke="currentColor" strokeWidth="1"/>
            </svg>
          </button>
          <button type="button" className={styles.windowButton} onClick={() => invokeWindowCommand('app:window:toggleMaximize')} aria-label={windowState.isMaximized ? '还原窗口' : '最大化窗口'} style={{ WebkitAppRegion: 'no-drag' } as any}>
            {windowState.isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor" strokeWidth="1"/>
                <path d="M0.5 2.5V9.5H7.5" stroke="currentColor" strokeWidth="1"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1"/>
              </svg>
            )}
          </button>
          <button type="button" className={`${styles.windowButton} ${styles.closeButton}`} onClick={() => invokeWindowCommand('app:window:close')} aria-label="关闭窗口" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
})
