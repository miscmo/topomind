import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { executeCommand } from '../../../application/commands'
import { useThemeStore, DARK_THEME, LIGHT_THEME } from '../../../stores/themeStore'
import { useLayoutStore } from '../../../stores/layoutStore'
import { PluginWidgetSlot } from '../../../plugins'
import { useTabStore } from '../../../stores/tabs/tabStore'
import { useShortcut } from '../../../hooks/useShortcut'
import { Menu, PanelLeft, PanelLeftClose } from 'lucide-react'
import { TM_UI, tmUI } from '../../../shared/ui/controlStyles'
import TabBar from '../TabBar/TabBar'
import { useDebugHudStore } from '../../debug/debugStore'
import type { WindowControlsState } from '../../../types/electron-api'

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

/**
 * 单条 32px 顶栏：左＝全局控制 + 学习计时 + 知识库 tab，右＝窗口控制。
 *
 * 2026-11-21 重构：
 * - 最左侧软件图标移除；改为「导航栏显隐」按钮（唯一全局入口）+ 保留三条横线菜单；
 * - 学习计时 widget 放在控制按钮之后、tab 栏之前，不再挤在右段；
 * - 右栏折叠按钮与「详情/样式」分段控件移除：右栏改为按需展开 + 失焦隐藏，
 *   样式设置迁入全局设置页。
 *
 * 右栏相关 aria-label 已不再是 GUI 契约，但 `应用菜单` / `data-tm-active-view` /
 * `data-tm-tab-zone` 仍是，必须保留。
 */
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
  const theme = useThemeStore((s) => s.theme)
  const debugEnabled = useDebugHudStore((s) => s.enabled)
  const railVisible = useLayoutStore((s) => s.railVisible)
  const toggleRailVisible = useLayoutStore((s) => s.toggleRailVisible)
  // 仅用于 Π 形连体换底色，不参与任何画布布局计算。
  const activeTabType = useTabStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.type)

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
    overlay.style.zIndex = '3001' // 覆盖标题栏的其他区域，但在菜单之下
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

  const runCommand = useCallback((commandId: string, args?: unknown) => {
    void executeCommand(commandId, args).catch((error) => {
      console.error(`Failed to execute title bar command: ${commandId}`, error)
    })
  }, [])

  // P6：Debug HUD 的全局开关。走命令而不是直接改 store，与菜单入口共用
  // observeOperation 的 user.command 埋点，开启动作本身也会出现在日志流里。
  useShortcut(['Ctrl+Shift+D'], () => { runCommand('debug.toggle') }, { scope: 'global' })

  const menuItems = useMemo<Record<MenuKey, MenuItem[]>>(() => ({
    file: [
      { label: '切换工作目录', action: () => runCommand('workspace.switch') },
      { label: '退出 TopoMind', shortcut: 'Alt+F4', action: () => runCommand('window.close') },
    ],
    view: [
      {
        label: '主题',
        submenu: [
          { label: '浅色', checked: theme === LIGHT_THEME, action: () => runCommand('theme.set', { theme: LIGHT_THEME }) },
          { label: '深色', checked: theme === DARK_THEME, action: () => runCommand('theme.set', { theme: DARK_THEME }) },
        ]
      },
      { label: '系统日志', action: () => runCommand('monitor.open') },
      { label: '学习统计', action: () => runCommand('learning.open') },
      { label: '设置', action: () => runCommand('nav.openSettings') },
      { label: '命令中心', shortcut: 'Ctrl+Shift+P', disabled: true },
      { label: '重置布局', action: () => runCommand('layout.reset') },
    ],
    help: [
      { label: '快捷键', action: () => runCommand('nav.openSettings') },
      { label: '开发者工具', shortcut: 'F12', action: () => runCommand('window.toggleDevTools') },
      {
        label: 'Debug 模式',
        shortcut: 'Ctrl+Shift+D',
        checked: debugEnabled,
        action: () => runCommand('debug.toggle'),
      },
      { label: '关于 TopoMind', action: () => runCommand('nav.openSettings') },
    ],
  }), [runCommand, theme, debugEnabled])

  const renderMenuItem = (item: MenuItem) => (
    <button
      key={item.label}
      type="button"
      className={TM_UI.menuItem}
      role="menuitem"
      disabled={item.disabled}
      onClick={() => {
        if (item.disabled) return
        setActiveMenu(null)
        item.action?.()
      }}
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <span className={TM_UI.tabMenuLabel}>{item.label}</span>
      {item.checked && <span style={{ color: 'var(--color-primary)' }}>✓</span>}
      {item.shortcut && <span className={TM_UI.hint}>{item.shortcut}</span>}
    </button>
  )

  return (
    <div
      ref={rootRef}
      data-tm-titlebar-unfocused={!windowState.isFocused ? 'true' : 'false'}
      data-tm-active-view={activeTabType ?? 'system'}
      className={`flex items-center shrink-0 h-[var(--titlebar-height)] bg-[var(--titlebar-bg)] border-b border-[var(--color-border-subtle)] text-[var(--titlebar-text)] select-none [-webkit-app-region:drag] relative z-[3000] transition-colors ${!windowState.isFocused ? '[--titlebar-bg:var(--titlebar-bg-unfocused)] [--titlebar-text:var(--titlebar-text-unfocused)] [--titlebar-muted:var(--titlebar-muted-unfocused)]' : ''}`}
      onDoubleClick={(e) => {
        // Prevent double click on specific children from maximizing
        if (e.target instanceof Element && e.target.closest(`button, [role="tab"], .truncate`)) {
          return
        }
        runCommand('window.toggleMaximize')
      }}
    >
      {/* 最左侧控制区：全局导航栏开关（唯一显隐入口）+ 三条横线应用菜单。 */}
      <div className="shrink-0 flex items-center pl-2 gap-1.5 h-full relative after:content-[''] after:absolute after:right-0 after:top-[25%] after:bottom-[25%] after:w-px after:bg-[var(--titlebar-text)] after:opacity-10 pr-2">
        {mode === 'workspace' && (
          <button
            type="button"
            aria-label={railVisible ? '收起全局导航栏' : '展开全局导航栏'}
            aria-pressed={railVisible}
            title={railVisible ? '隐藏全局导航栏' : '显示全局导航栏'}
            data-tm-nav-rail-toggle=""
            className={tmUI(TM_UI.iconButton, 'h-6 w-6')}
            onClick={toggleRailVisible}
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            {railVisible
              ? <PanelLeftClose className={TM_UI.icon} aria-hidden="true" />
              : <PanelLeft className={TM_UI.icon} aria-hidden="true" />}
          </button>
        )}
        {mode === 'workspace' && (
          <nav className="flex items-stretch h-[24px] min-w-0 relative z-[3002]" aria-label="应用菜单" style={{ WebkitAppRegion: 'no-drag' }}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={activeMenu !== null}
              aria-label="应用菜单"
              className={tmUI(TM_UI.iconButton, 'h-full w-6')}
              onClick={() => setActiveMenu((current) => current === null ? 'file' : null)}
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              <Menu className={TM_UI.icon} aria-hidden="true" />
            </button>
            {activeMenu && (
              <div
                className={tmUI(TM_UI.menu, TM_UI.scroll, 'tm-fade-enter absolute top-[calc(100%+6px)] left-0 min-w-[220px] max-h-[70vh] overflow-y-auto')}
                role="menu"
                style={{ WebkitAppRegion: 'no-drag', zIndex: 'var(--z-titlebar-menu)' }}
              >
                {MENU_LABELS.map((group) => (
                  <div key={group.key} className={TM_UI.menuGroup}>
                    <div className={TM_UI.menuGroupTitle}>{group.label}</div>
                    {menuItems[group.key].map((item) =>
                      item.submenu ? (
                        <div key={item.label}>
                          <div className={TM_UI.menuGroupTitle}>{item.label}</div>
                          {item.submenu.map(renderMenuItem)}
                        </div>
                      ) : renderMenuItem(item)
                    )}
                  </div>
                ))}
              </div>
            )}
          </nav>
        )}
      </div>

      {/* 学习计时等状态类 widget：控制按钮之后、tab 栏之前，独立占位不挤压 tab zone。 */}
      {mode === 'workspace' && (
        <div data-tm-titlebar-widget="" className="shrink-0 flex items-center h-full mr-2" style={{ WebkitAppRegion: 'no-drag' }}>
          <PluginWidgetSlot placement="titlebar" />
        </div>
      )}

      <div className="flex-1 min-w-0 flex items-center justify-start h-full mx-2.5 relative" style={{ WebkitAppRegion: 'drag' }}>
        {mode === 'workspace' && (
          /* data-tm-tab-zone 是 TabBar 的唯一宽度测量基准：它 flex-1、宽度稳定，
             内部 tab 数量变化不会反过来改变它，避免「越算越窄」的自反馈。
             右端的 drag gutter 恒定占位，再往右的剩余留白也可拖窗口。 */
          <div data-tm-tab-zone="" className="h-full w-full min-w-0 flex items-center gap-2">
            <TabBar />
            {/* 恒定拖拽安全带：tab 再多也不能把顶栏可拖区吃光。 */}
            <div
              data-tm-tab-drag-gutter=""
              className="shrink-0 h-full"
              style={{ width: 'var(--tab-drag-gutter)', WebkitAppRegion: 'drag' }}
            />
          </div>
        )}
      </div>

      {/* 右段只剩窗口控制：右栏显隐改由业务动作与失焦自动管理。 */}
      <div className="shrink-0 flex items-center justify-end h-full">
        <div className="h-full inline-flex items-stretch">
          <button type="button" className="w-[46px] h-full inline-flex items-center justify-center bg-transparent text-[var(--titlebar-muted)] text-[13px] leading-none cursor-default hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)]" onClick={() => runCommand('window.minimize')} aria-label="最小化窗口" style={{ WebkitAppRegion: 'no-drag' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 5H10" stroke="currentColor" strokeWidth="1"/>
            </svg>
          </button>
          <button type="button" className="w-[46px] h-full inline-flex items-center justify-center bg-transparent text-[var(--titlebar-muted)] text-[13px] leading-none cursor-default hover:bg-[var(--titlebar-hover)] hover:text-[var(--titlebar-text)]" onClick={() => runCommand('window.toggleMaximize')} aria-label={windowState.isMaximized ? '还原窗口' : '最大化窗口'} style={{ WebkitAppRegion: 'no-drag' }}>
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
          <button type="button" className="w-[46px] h-full inline-flex items-center justify-center bg-transparent text-[var(--titlebar-muted)] text-[13px] leading-none cursor-default hover:!bg-[var(--color-danger)] hover:!text-[var(--color-text-inverse)] transition-colors" onClick={() => runCommand('window.close')} aria-label="关闭窗口" style={{ WebkitAppRegion: 'no-drag' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
})
