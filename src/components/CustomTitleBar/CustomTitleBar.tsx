import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTabStore, type Tab } from '../../stores/tabStore'
import { useThemeStore } from '../../stores/themeStore'
import type { WindowControlsState } from '../../types/electron-api'
import styles from './CustomTitleBar.module.css'

type TitleBarMode = 'setup' | 'workspace'

type MenuKey = 'file' | 'view' | 'graph' | 'knowledge' | 'help'

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
  { key: 'graph', label: '图谱' },
  { key: 'knowledge', label: '知识库' },
  { key: 'help', label: '帮助' },
]

function isWindowControlsState(value: unknown): value is WindowControlsState {
  return !!value && typeof value === 'object' && 'isMaximized' in value && 'isFocused' in value
}

function tabIcon(tab?: Tab) {
  if (!tab) return '⌘'
  if (tab.type === 'home') return '⌂'
  if (tab.type === 'monitor') return '◌'
  return '◇'
}

export default memo(function CustomTitleBar({ mode }: CustomTitleBarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null)
  const [windowState, setWindowState] = useState<WindowControlsState>({ isMaximized: false, isFocused: true })
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openHomeTab = useTabStore((s) => s.openHomeTab)
  const openMonitorTab = useTabStore((s) => s.openMonitorTab)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const activeTab = tabs.find((tab) => tab.id === activeTabId)

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
      { label: '打开首页', action: () => openHomeTab() },
      { label: '切换工作目录', action: () => { void window.electronAPI?.invoke('app:switchWorkDir') } },
      { label: '退出 TopoMind', shortcut: 'Alt+F4', action: () => invokeWindowCommand('app:window:close') },
    ],
    view: [
      { label: '系统日志', action: () => openMonitorTab() },
      { label: '命令中心', shortcut: 'Ctrl+Shift+P', disabled: true },
      { label: '重置布局', disabled: true },
    ],
    graph: [
      { label: '适应视图', disabled: true },
      { label: '聚焦当前节点', disabled: true },
      { label: activeTab?.type === 'kb' ? `当前房间：${activeTab.currentRoomName}` : '当前没有打开图谱', disabled: true },
    ],
    knowledge: [
      { label: activeTab?.type === 'kb' ? `知识库：${activeTab.label}` : '打开知识库后可用', disabled: true },
      { label: '知识库设置', disabled: true },
      { label: '打开所在文件夹', disabled: true },
    ],
    help: [
      { label: '快捷键', disabled: true },
      { label: '关于 TopoMind', disabled: true },
    ],
  }), [activeTab, invokeWindowCommand, openHomeTab, openMonitorTab])

  const contextLabel = mode === 'setup'
    ? '选择工作目录'
    : activeTab?.type === 'kb'
      ? `${activeTab.label} / ${activeTab.currentRoomName}`
      : activeTab?.label ?? '首页'

  return (
    <div ref={rootRef} className={`${styles.titleBar} ${!windowState.isFocused ? styles.unfocused : ''}`}>
      <div className={styles.leftCluster}>
        <div className={styles.brand} title="TopoMind">
          <span className={styles.brandMark}>🧠</span>
          <span className={styles.brandName}>TopoMind</span>
        </div>
        {mode === 'workspace' && (
          <nav className={styles.menuBar} aria-label="应用菜单">
            {MENU_LABELS.map((menu) => (
              <div key={menu.key} className={styles.menuWrap}>
                <button
                  type="button"
                  className={`${styles.menuButton} ${activeMenu === menu.key ? styles.menuButtonActive : ''}`}
                  onClick={() => setActiveMenu((current) => current === menu.key ? null : menu.key)}
                  onMouseEnter={() => { if (activeMenu) setActiveMenu(menu.key) }}
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

      <div className={styles.centerCluster}>
        <button type="button" className={styles.navButton} disabled title="后退">‹</button>
        <button type="button" className={styles.navButton} disabled title="前进">›</button>
        <button type="button" className={styles.commandCenter} title="命令中心">
          <span className={styles.commandIcon}>{tabIcon(activeTab)}</span>
          <span className={styles.commandText}>{contextLabel}</span>
          <span className={styles.commandHint}>搜索或运行命令</span>
        </button>
      </div>

      <div className={styles.rightCluster}>
        {mode === 'workspace' && (
          <div className={styles.contextActions}>
            <span className={styles.savePill}>已保存</span>
            <button type="button" className={styles.toolButton} title="布局控制">布局</button>
            <button type="button" className={styles.toolButton} title="设置">设置</button>
          </div>
        )}
        <button
          type="button"
          className={`${styles.toolButton} ${styles.themeButton}`}
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          aria-pressed={theme === 'dark'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <div className={styles.windowControls}>
          <button type="button" className={styles.windowButton} onClick={() => invokeWindowCommand('app:window:minimize')} aria-label="最小化窗口">—</button>
          <button type="button" className={styles.windowButton} onClick={() => invokeWindowCommand('app:window:toggleMaximize')} aria-label={windowState.isMaximized ? '还原窗口' : '最大化窗口'}>
            {windowState.isMaximized ? '❐' : '□'}
          </button>
          <button type="button" className={`${styles.windowButton} ${styles.closeButton}`} onClick={() => invokeWindowCommand('app:window:close')} aria-label="关闭窗口">×</button>
        </div>
      </div>
    </div>
  )
})
