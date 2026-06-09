import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTabStore } from '../../../stores/tabs/tabStore'
import { useThemeStore } from '../../../stores/themeStore'
import { useRightPanelStore } from '../../right-panel/model/rightPanelStore'
import { useShortcut } from '../../../hooks/useShortcut'
import { logoutCloudSession } from '../../../core/auth-session'
import { LocalDB } from '../../../core/localdb-backend'
import TabBar from '../TabBar/TabBar'
import { LearningTrackerWidget } from '../../learning-tracker/components/LearningTrackerWidget'
import { useCloudSessionStore } from '../../../stores/cloudSessionStore'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { useCloudSyncEngineDebugStore } from '../../../application/cloud/syncEngineDebugStore'
import { CLOUD_LOCALDB_UPDATED_EVENT } from '../../../application/cloud/events'
import type { LocalWorkspaceSnapshot } from '../../../types/local-sync'
import type { Tab } from '../../../stores/tabs/tabTypes'

type TitleBarMode = 'setup' | 'workspace'

type MenuKey = 'file' | 'view' | 'help'

interface CustomTitleBarProps {
  mode: TitleBarMode
}

interface MenuItem {
  label: string
  shortcut?: string
  disabled?: boolean
  action?: () => void
  submenu?: MenuItem[]
  checked?: boolean
}

interface WindowControlsState {
  isFocused: boolean
  isMaximized: boolean
}

interface TitleBarCursorState {
  lastEventId: number
  lastPullAt: string | null
  lastPushAt: string | null
}

const MENU_LABELS: Array<{ key: MenuKey; label: string }> = [
  { key: 'file', label: '文件' },
  { key: 'view', label: '视图' },
  { key: 'help', label: '帮助' },
]

function isWindowControlsState(value: unknown): value is WindowControlsState {
  return !!value && typeof value === 'object' && 'isFocused' in value && 'isMaximized' in value
}

function formatRelativeTime(value: string | null) {
  if (!value) return '未同步'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '刚刚'
  const deltaMs = Date.now() - timestamp
  if (deltaMs < 30_000) return '刚刚'
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function getActiveContextLabel(activeTab: Tab | undefined) {
  if (!activeTab) return '未打开页面'
  if (activeTab.type === 'kb') {
    return activeTab.currentRoomName
      ? `房间 · ${activeTab.currentRoomName}`
      : `知识库 · ${activeTab.label}`
  }
  if (activeTab.type === 'home') return '首页'
  if (activeTab.type === 'monitor') return '系统日志'
  return '学习统计'
}

function getSyncIndicator(input: {
  status: 'disabled' | 'idle' | 'running'
  inFlight: boolean
  syncError: string
  pullError: string
  lastPullAt: string | null
  lastEventId: number | null
}) {
  if (input.syncError || input.pullError) {
    return {
      label: '同步异常',
      tone: 'error' as const,
      detail: input.pullError || input.syncError,
    }
  }
  if (input.inFlight || input.status === 'running') {
    return {
      label: '同步中',
      tone: 'primary' as const,
      detail: '正在拉取最新变更',
    }
  }
  if (input.lastPullAt) {
    return {
      label: '已同步',
      tone: 'success' as const,
      detail: `事件 ${input.lastEventId ?? 0} · ${formatRelativeTime(input.lastPullAt)}`,
    }
  }
  if (input.status === 'disabled') {
    return {
      label: '同步未启动',
      tone: 'muted' as const,
      detail: '等待工作区初始化',
    }
  }
  return {
    label: '待同步',
    tone: 'muted' as const,
    detail: '等待首次同步',
  }
}

function StatusPill({
  label,
  detail,
  tone = 'muted',
  onClick,
  title,
}: {
  label: string
  detail?: string
  tone?: 'muted' | 'primary' | 'success' | 'error'
  onClick?: () => void
  title?: string
}) {
  const toneClass = {
    muted: 'border-[var(--titlebar-command-border)] bg-[var(--titlebar-command-bg)] text-[var(--titlebar-text)]',
    primary: 'border-[color-mix(in_srgb,var(--color-primary)_28%,var(--titlebar-command-border))] bg-[color-mix(in_srgb,var(--color-primary)_14%,var(--titlebar-command-bg))] text-[var(--color-primary)]',
    success: 'border-[color-mix(in_srgb,var(--color-success)_28%,var(--titlebar-command-border))] bg-[color-mix(in_srgb,var(--color-success)_14%,var(--titlebar-command-bg))] text-[var(--color-success)]',
    error: 'border-[color-mix(in_srgb,var(--color-danger)_28%,var(--titlebar-command-border))] bg-[color-mix(in_srgb,var(--color-danger)_14%,var(--titlebar-command-bg))] text-[var(--color-danger)]',
  }[tone]

  const content = (
    <>
      <span className="font-medium">{label}</span>
      {detail ? <span className="text-[var(--titlebar-muted)]">{detail}</span> : null}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={`inline-flex h-[24px] items-center gap-1.5 rounded-[6px] border px-2.5 text-[11px] transition-colors hover:bg-[var(--titlebar-command-bg-hover)] ${toneClass}`}
        onClick={onClick}
        style={{ WebkitAppRegion: 'no-drag' } as any}
        title={title}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      className={`inline-flex h-[24px] items-center gap-1.5 rounded-[6px] border px-2.5 text-[11px] ${toneClass}`}
      style={{ WebkitAppRegion: 'no-drag' } as any}
      title={title}
    >
      {content}
    </div>
  )
}

export default memo(function CustomTitleBar({ mode }: CustomTitleBarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null)
  const [windowState, setWindowState] = useState<WindowControlsState>({ isFocused: true, isMaximized: false })
  const [cursorState, setCursorState] = useState<TitleBarCursorState | null>(null)
  const desktopWindowApi =
    typeof window === 'undefined' ? null : (window.electronAPI?.app.window ?? null)
  const isDesktopShell = Boolean(
    typeof window !== 'undefined' && window.electronAPI?.platform?.isDesktop && desktopWindowApi
  )
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openMonitorTab = useTabStore((s: any) => s.openMonitorTab)
  const openStatisticsTab = useTabStore((s: any) => s.openStatisticsTab)
  const theme = useThemeStore((s: any) => s.theme)
  const setTheme = useThemeStore((s: any) => s.setTheme)
  const currentUser = useCloudSessionStore((s) => s.user)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const availableWorkspaces = useWorkspaceStore((s) => s.availableWorkspaces)
  const workspaceSelectionLoading = useWorkspaceStore((s) => s.workspaceSelectionLoading)
  const workspaceSelectionError = useWorkspaceStore((s) => s.workspaceSelectionError)
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId)
  const syncStatus = useCloudSyncEngineDebugStore((s) => s.status)
  const syncInFlight = useCloudSyncEngineDebugStore((s) => s.inFlight)
  const syncError = useCloudSyncEngineDebugStore((s) => s.syncError)
  const pullError = useCloudSyncEngineDebugStore((s) => s.pullError)

  const rightPanelCollapsed = useRightPanelStore((s: any) => s.rightPanelCollapsed)
  const collapseRightPanel = useRightPanelStore((s: any) => s.collapseRightPanel)
  const expandRightPanel = useRightPanelStore((s: any) => s.expandRightPanel)
  const rightPanelTab = useRightPanelStore((s: any) => s.rightPanelTab)
  const setRightPanelTab = useRightPanelStore((s: any) => s.setRightPanelTab)

  const toggleRightPanel = useCallback(() => {
    if (rightPanelCollapsed) {
      expandRightPanel()
    } else {
      collapseRightPanel()
    }
  }, [rightPanelCollapsed, collapseRightPanel, expandRightPanel])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  )
  const currentWorkspace = useMemo(
    () => availableWorkspaces.find((item) => item.id === currentWorkspaceId) ?? null,
    [availableWorkspaces, currentWorkspaceId]
  )
  const activeContextLabel = useMemo(() => getActiveContextLabel(activeTab), [activeTab])
  const syncIndicator = useMemo(
    () =>
      getSyncIndicator({
        status: syncStatus,
        inFlight: syncInFlight,
        syncError,
        pullError,
        lastPullAt: cursorState?.lastPullAt ?? null,
        lastEventId: cursorState?.lastEventId ?? null,
      }),
    [syncStatus, syncInFlight, syncError, pullError, cursorState]
  )

  useEffect(() => {
    const handleFocus = () => setWindowState((state) => ({ ...state, isFocused: true }))
    const handleBlur = () => setWindowState((state) => ({ ...state, isFocused: false }))
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  useEffect(() => {
    if (!desktopWindowApi) {
      return
    }

    let cancelled = false
    const syncWindowState = async () => {
      try {
        const nextState = await desktopWindowApi.getState()
        if (!cancelled && isWindowControlsState(nextState)) {
          setWindowState(nextState)
        }
      } catch {
        // Ignore shell sync failures and keep the optimistic renderer state.
      }
    }

    void syncWindowState()

    const dispose = desktopWindowApi.onStateChange((nextState) => {
      if (cancelled || !isWindowControlsState(nextState)) {
        return
      }
      setWindowState(nextState)
    })

    return () => {
      cancelled = true
      dispose()
    }
  }, [desktopWindowApi])

  useShortcut(['Escape'], () => {
    if (activeMenu) setActiveMenu(null)
  }, { scope: 'global', preventDefault: false })

  useEffect(() => {
    if (!activeMenu) return
    
    // 创建一个全屏的透明遮罩层来拦截所有的点击事件
    // 因为 Electron 的 -webkit-app-region: drag 区域会吞噬掉原生的鼠标事件
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.zIndex = '3001' // 覆盖标题栏的其他区域，但在菜单（z-[3002]）之下
    // 强制此区域不可拖拽，以保证能接收到点击事件
    overlay.style.setProperty('-webkit-app-region', 'no-drag')
    
    const handleClose = () => setActiveMenu(null)
    
    overlay.addEventListener('pointerdown', handleClose)
    if (rootRef.current) {
      rootRef.current.appendChild(overlay)
    } else {
      document.body.appendChild(overlay)
    }

    const handleWindowPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('nav[aria-label="应用菜单"]')) {
        return
      }
      handleClose()
    }
    window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true })

    return () => {
      overlay.removeEventListener('pointerdown', handleClose)
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay)
      }
      window.removeEventListener('pointerdown', handleWindowPointerDown, { capture: true })
    }
  }, [activeMenu])

  useEffect(() => {
    if (mode !== 'workspace' || !currentWorkspaceId) {
      setCursorState(null)
      return
    }

    let cancelled = false

    const syncSnapshot = async () => {
      try {
        const snapshot = await LocalDB.getWorkspaceSnapshot(currentWorkspaceId)
        if (cancelled) return
        setCursorState({
          lastEventId: snapshot.cursor.lastEventId,
          lastPullAt: snapshot.cursor.lastPullAt,
          lastPushAt: snapshot.cursor.lastPushAt,
        })
      } catch {
        if (!cancelled) {
          setCursorState(null)
        }
      }
    }

    void syncSnapshot()

    const handleLocalDbUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      if (detail?.workspaceId && detail.workspaceId !== currentWorkspaceId) {
        return
      }
      void syncSnapshot()
    }

    window.addEventListener(CLOUD_LOCALDB_UPDATED_EVENT, handleLocalDbUpdated as EventListener)
    return () => {
      cancelled = true
      window.removeEventListener(CLOUD_LOCALDB_UPDATED_EVENT, handleLocalDbUpdated as EventListener)
    }
  }, [mode, currentWorkspaceId])

  const menuItems = useMemo<Record<MenuKey, MenuItem[]>>(() => ({
    file: [
      { label: '退出登录', action: () => { logoutCloudSession() } },
    ],
    view: [
      { 
        label: '浅色主题', 
        submenu: [
          { label: '经典浅色 (Light)', checked: theme === 'light', action: () => setTheme('light') },
          { label: 'Notion Light', checked: theme === 'notion-light', action: () => setTheme('notion-light') },
          { label: 'Linear Light', checked: theme === 'linear-light', action: () => setTheme('linear-light') },
          { label: 'Nord Light', checked: theme === 'nord-light', action: () => setTheme('nord-light') },
          { label: 'Rose Pine Dawn', checked: theme === 'rose-pine-dawn', action: () => setTheme('rose-pine-dawn') },
          { label: 'Catppuccin Latte', checked: theme === 'catppuccin-latte', action: () => setTheme('catppuccin-latte') },
          { label: 'GitHub Light', checked: theme === 'github-light', action: () => setTheme('github-light') },
          { label: 'Solarized Light', checked: theme === 'solarized-light', action: () => setTheme('solarized-light') },
        ]
      },
      { 
        label: '深色主题', 
        submenu: [
          { label: '经典深色 (Dark)', checked: theme === 'dark', action: () => setTheme('dark') },
          { label: 'Tokyo Night', checked: theme === 'tokyo-night', action: () => setTheme('tokyo-night') },
          { label: 'Catppuccin Mocha', checked: theme === 'catppuccin-mocha', action: () => setTheme('catppuccin-mocha') },
          { label: 'One Dark Pro', checked: theme === 'one-dark-pro', action: () => setTheme('one-dark-pro') },
          { label: 'Dracula', checked: theme === 'dracula', action: () => setTheme('dracula') },
          { label: 'Monokai', checked: theme === 'monokai', action: () => setTheme('monokai') },
          { label: 'GitHub Dark', checked: theme === 'github-dark', action: () => setTheme('github-dark') },
          { label: 'Solarized Dark', checked: theme === 'solarized-dark', action: () => setTheme('solarized-dark') },
        ]
      },
      { label: '系统日志', action: () => openMonitorTab() },
      { label: '命令中心', shortcut: 'Ctrl+Shift+P', disabled: true },
      { label: '重置布局', disabled: true },
    ],
    help: [
      { label: '快捷键', disabled: true },
      { label: '关于 TopoMind', disabled: true },
    ],
  }), [openMonitorTab, theme, setTheme])

  const handleWindowMinimize = useCallback(() => {
    void desktopWindowApi?.minimize()
  }, [desktopWindowApi])

  const handleWindowToggleMaximize = useCallback(() => {
    void desktopWindowApi?.toggleMaximize()
  }, [desktopWindowApi])

  const handleWindowClose = useCallback(() => {
    void desktopWindowApi?.close()
  }, [desktopWindowApi])

  return (
    <div 
      ref={rootRef} 
      className={`flex items-center shrink-0 h-[40px] bg-[var(--titlebar-bg)] border-b border-[var(--titlebar-border)] text-[var(--titlebar-text)] select-none [-webkit-app-region:drag] relative z-[3000] transition-colors ${!windowState.isFocused ? '[--titlebar-bg:var(--titlebar-bg-unfocused)] [--titlebar-text:var(--titlebar-text-unfocused)] [--titlebar-muted:var(--titlebar-muted-unfocused)]' : ''}`}
    >
      <div className="shrink-0 flex items-center pl-2 gap-2 h-full relative after:content-[''] after:absolute after:right-0 after:top-[18%] after:bottom-[18%] after:w-px after:bg-[color-mix(in_srgb,var(--titlebar-text)_18%,var(--color-border-subtle))] after:shadow-[0_0_0_1px_rgba(255,255,255,0.03)] pr-2">
        <div className="inline-flex items-center h-6 gap-[6px] px-1.5 rounded-[6px] text-[var(--titlebar-text)]" title="TopoMind" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <img src="./icon.svg" alt="Logo" className="w-4 h-4 drop-shadow-sm" />
          <span className="hidden sm:inline text-[12px] font-semibold tracking-[0.02em]">TopoMind</span>
        </div>
        {(mode === 'workspace' || mode === 'setup') && (
          <nav className="hidden md:flex items-stretch h-[24px] gap-[1px] min-w-0 relative z-[3002] ml-1" aria-label="应用菜单" style={{ WebkitAppRegion: 'no-drag' } as any}>
            {MENU_LABELS.map((menu) => (
              <div key={menu.key} className="relative flex items-center h-full">
                <button
                  type="button"
                  aria-haspopup="true"
                  className={`h-full px-2.5 rounded-[6px] bg-transparent text-[12px] font-medium cursor-default transition-colors ${activeMenu === menu.key ? 'bg-[var(--titlebar-hover)] text-[var(--titlebar-text)]' : 'text-[var(--titlebar-text)] hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)]'}`}
                  onClick={() => setActiveMenu((current) => current === menu.key ? null : menu.key)}
                  onMouseEnter={() => { if (activeMenu) setActiveMenu(menu.key) }}
                  style={{ WebkitAppRegion: 'no-drag' } as any}
                >
                  {menu.label}
                </button>
                {activeMenu === menu.key && (
                  <div className="absolute top-[calc(100%+6px)] left-0 min-w-[188px] p-1.5 bg-[var(--titlebar-menu-bg)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 z-[3001]" role="menu" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    {menuItems[menu.key].map((item) => (
                      item.submenu ? (
                        <div key={item.label} className="relative group">
                          <button
                            type="button"
                            className="flex items-center justify-between gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] peer"
                          >
                            <span>{item.label}</span>
                            <span className="text-[var(--color-text-muted)] text-[10px]">▶</span>
                          </button>
                          <div className="absolute top-[-6px] left-[calc(100%-4px)] min-w-[140px] p-1.5 bg-[var(--titlebar-menu-bg)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] backdrop-blur-xl opacity-0 invisible hover:opacity-100 hover:visible peer-hover:opacity-100 peer-hover:visible transition-all duration-100 animate-in fade-in slide-in-from-left-1 z-[3002]" role="menu" style={{ WebkitAppRegion: 'no-drag' } as any}>
                            {item.submenu.map(subItem => (
                              <button
                                key={subItem.label}
                                type="button"
                                className="flex items-center justify-between gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                                disabled={subItem.disabled}
                                 onClick={() => {
                                  if (subItem.disabled) return
                                  setActiveMenu(null)
                                  subItem.action?.()
                                }}
                              >
                                <span>{subItem.label}</span>
                                {subItem.checked && <span className="text-[var(--color-primary)]">✓</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <button
                          key={item.label}
                          type="button"
                          className="flex items-center justify-between gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                          disabled={item.disabled}
                          onClick={() => {
                            if (item.disabled) return
                            setActiveMenu(null)
                            item.action?.()
                          }}
                        >
                          <span>{item.label}</span>
                          {item.shortcut && <span className="text-[var(--color-text-muted)] text-[11px] font-sans tracking-widest">{item.shortcut}</span>}
                        </button>
                      )
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        )}
      </div>

      <div className="flex-1 min-w-0 flex items-center justify-start h-full mx-2.5 relative" style={{ WebkitAppRegion: 'drag' } as any}>
        {mode === 'workspace' && (
          <div className="h-full min-w-0 flex items-center gap-2">
            <TabBar />
            <LearningTrackerWidget />
            <div className="hidden xl:flex min-w-0 items-center gap-2">
              <StatusPill
                label={currentWorkspace?.name || '未选择工作区'}
                detail={currentWorkspace ? `角色 ${currentWorkspace.role}` : '请先选择工作区'}
                title={currentWorkspace?.updatedAt ? `更新于 ${currentWorkspace.updatedAt}` : undefined}
              />
              <StatusPill label={activeContextLabel} tone="muted" />
              <StatusPill
                label={`同步 · ${syncIndicator.label}`}
                detail={syncIndicator.detail}
                tone={syncIndicator.tone}
                onClick={() => openMonitorTab()}
                title="打开系统日志查看同步详情"
              />
              {cursorState?.lastPushAt ? (
                <StatusPill
                  label="最近写入"
                  detail={formatRelativeTime(cursorState.lastPushAt)}
                  tone="muted"
                />
              ) : null}
            </div>
          </div>
        )}
        {mode === 'setup' && (
          <div className="hidden md:flex min-w-0 items-center gap-2">
            <StatusPill
              label={currentUser ? '已登录' : '未登录'}
              detail={currentUser ? (currentUser.displayName || currentUser.email) : '登录或注册后进入工作区'}
            />
            <StatusPill
              label={currentUser ? '工作区选择' : '账号入口'}
              detail={
                currentUser
                  ? workspaceSelectionLoading
                    ? '正在加载工作区'
                    : workspaceSelectionError
                      ? '工作区加载失败'
                      : currentWorkspaceId
                        ? '已选定工作区'
                        : `可用工作区 ${availableWorkspaces.length}`
                  : '支持登录与注册'
              }
              tone={workspaceSelectionError ? 'error' : 'muted'}
            />
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-end h-full">
        {mode === 'workspace' && (
          <>
            <button
              type="button"
              className="hidden lg:inline-flex h-[24px] items-center rounded-[6px] border border-[var(--titlebar-command-border)] bg-[var(--titlebar-command-bg)] px-2.5 text-[11px] font-medium text-[var(--titlebar-text)] transition-colors hover:bg-[var(--titlebar-command-bg-hover)]"
              onClick={() => openMonitorTab()}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              title="打开系统日志"
            >
              系统日志
            </button>
            <button
              type="button"
              className="ml-2 hidden lg:inline-flex h-[24px] items-center rounded-[6px] border border-[var(--titlebar-command-border)] bg-[var(--titlebar-command-bg)] px-2.5 text-[11px] font-medium text-[var(--titlebar-text)] transition-colors hover:bg-[var(--titlebar-command-bg-hover)]"
              onClick={() => openStatisticsTab()}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              title="打开学习统计"
            >
              学习统计
            </button>
            <button
              type="button"
              className="ml-2 w-[46px] h-full inline-flex items-center justify-center bg-transparent text-[var(--titlebar-muted)] text-[13px] leading-none cursor-default hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)] aria-pressed:text-[var(--color-accent)]"
              onClick={toggleRightPanel}
              title={rightPanelCollapsed ? '展开右侧面板' : '折叠右侧面板'}
              aria-label={rightPanelCollapsed ? '展开右侧面板' : '折叠右侧面板'}
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              {rightPanelCollapsed ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10.5 2.5v11" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10.5 2.5v11" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10.5 2.5H13A1.5 1.5 0 0 1 14.5 4V12A1.5 1.5 0 0 1 13 13.5H10.5V2.5Z" fill="currentColor"/>
                </svg>
              )}
            </button>
            <div className="flex items-center h-full mx-1 mr-2 relative z-[3002]" style={{ WebkitAppRegion: 'no-drag' } as any}>
              <div className="flex items-center h-[24px] bg-[var(--titlebar-bg-unfocused)] border border-[var(--color-border-subtle)] rounded-[6px] p-[2px]">
                <button
                  type="button"
                  className={`px-3 h-full rounded-[4px] text-[11px] font-medium transition-colors ${rightPanelTab === 'detail' ? 'bg-[var(--color-surface)] text-[var(--color-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]' : 'text-[var(--titlebar-muted)] hover:text-[var(--titlebar-text)] hover:bg-[var(--titlebar-hover)]'}`}
                  onClick={() => {
                    setRightPanelTab('detail')
                    if (rightPanelCollapsed) expandRightPanel()
                  }}
                >
                  详情
                </button>
                <button
                  type="button"
                  className={`px-3 h-full rounded-[4px] text-[11px] font-medium transition-colors ${rightPanelTab === 'style' ? 'bg-[var(--color-surface)] text-[var(--color-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]' : 'text-[var(--titlebar-muted)] hover:text-[var(--titlebar-text)] hover:bg-[var(--titlebar-hover)]'}`}
                  onClick={() => {
                    setRightPanelTab('style')
                    if (rightPanelCollapsed) expandRightPanel()
                  }}
                >
                  样式
                </button>
              </div>
            </div>
            <div className="mx-1 h-[18px] w-px bg-[color-mix(in_srgb,var(--titlebar-text)_22%,var(--color-border-subtle))] shadow-[0_0_0_1px_rgba(255,255,255,0.03)]" />
            {currentUser && (
              <div
                className="hidden lg:flex items-center max-w-[220px] rounded-[6px] border border-[var(--color-border-subtle)] bg-[var(--titlebar-bg-unfocused)] px-2.5 h-[24px] text-[11px] text-[var(--titlebar-text)]"
                style={{ WebkitAppRegion: 'no-drag' } as any}
                title={currentUser.email}
              >
                <span className="truncate">
                  {currentUser.displayName || currentUser.email}
                </span>
              </div>
            )}
            {availableWorkspaces.length > 1 && (
              <button
                type="button"
                className="ml-2 hidden xl:inline-flex h-[24px] items-center rounded-[6px] border border-[var(--titlebar-command-border)] bg-[var(--titlebar-command-bg)] px-2.5 text-[11px] font-medium text-[var(--titlebar-text)] transition-colors hover:bg-[var(--titlebar-command-bg-hover)]"
                onClick={() => setCurrentWorkspaceId(null)}
                style={{ WebkitAppRegion: 'no-drag' } as any}
                title="切换工作区"
              >
                切换工作区
              </button>
            )}
            <button
              type="button"
              className="ml-2 inline-flex h-[24px] items-center rounded-[6px] border border-[var(--color-border-subtle)] bg-[var(--titlebar-bg-unfocused)] px-2.5 text-[11px] font-medium text-[var(--titlebar-text)] transition-colors hover:bg-[var(--titlebar-hover)]"
              onClick={() => logoutCloudSession()}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              title="退出登录"
            >
              退出登录
            </button>
          </>
        )}
        {mode === 'setup' && currentUser && (
          <>
            {availableWorkspaces.length > 0 && (
              <button
                type="button"
                className="hidden lg:inline-flex h-[24px] items-center rounded-[6px] border border-[var(--titlebar-command-border)] bg-[var(--titlebar-command-bg)] px-2.5 text-[11px] font-medium text-[var(--titlebar-text)] transition-colors hover:bg-[var(--titlebar-command-bg-hover)]"
                onClick={() => setCurrentWorkspaceId(null)}
                style={{ WebkitAppRegion: 'no-drag' } as any}
              >
                选择工作区
              </button>
            )}
            <button
              type="button"
              className="ml-2 inline-flex h-[24px] items-center rounded-[6px] border border-[var(--color-border-subtle)] bg-[var(--titlebar-bg-unfocused)] px-2.5 text-[11px] font-medium text-[var(--titlebar-text)] transition-colors hover:bg-[var(--titlebar-hover)]"
              onClick={() => logoutCloudSession()}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              title="退出登录"
            >
              退出登录
            </button>
          </>
        )}
        {isDesktopShell && (
          <div className="ml-1 flex h-full items-center" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <button
              type="button"
              className="inline-flex h-full w-[46px] items-center justify-center bg-transparent text-[var(--titlebar-muted)] transition-colors hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)]"
              onClick={handleWindowMinimize}
              aria-label="最小化窗口"
              title="最小化"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M1 5.5H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className="inline-flex h-full w-[46px] items-center justify-center bg-transparent text-[var(--titlebar-muted)] transition-colors hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)]"
              onClick={handleWindowToggleMaximize}
              aria-label={windowState.isMaximized ? '还原窗口' : '最大化窗口'}
              title={windowState.isMaximized ? '还原' : '最大化'}
            >
              {windowState.isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M3 1.5H8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                  <path d="M1.5 3H7V8.5H1.5V3Z" stroke="currentColor" strokeWidth="1.1" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1.1" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className="inline-flex h-full w-[46px] items-center justify-center bg-transparent text-[var(--titlebar-muted)] transition-colors hover:bg-[#d92d20] hover:text-white"
              onClick={handleWindowClose}
              aria-label="关闭窗口"
              title="关闭"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 2L8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M8 2L2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
