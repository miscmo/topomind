/**
 * 左侧全局导航栏（App 层单例，绝对定位浮层）
 *
 * 布局契约（与右侧面板 / 节点树一致，勿回灌 flex 两栏）：
 * - 挂在 App 的内容区里，与所有 tab 容器平级，因此多个知识库 tab 常驻挂载也只有一个实例；
 * - 自身 absolute inset-y-0 left-0，显隐只改它自身的宽度，
 *   `#graph-panel` 仍是 absolute inset-0 isolate，画布宽度与 React Flow Panel 坐标恒定；
 * - 层级 z-40：高于画布浮层 z-30，低于 fixed 右键菜单 z-50 与全局弹窗。
 *
 * 显隐只由 layoutStore.railVisible 这一个全局状态决定，唯一控制入口是顶部标题栏按钮，
 * 任何视图（含画布）下开关行为一致。二级面板、沉浸态与顶部品牌按钮已移除。
 */
import { Fragment, memo, useCallback, useEffect, useMemo } from 'react'
import { useTabStore } from '@/stores/tabs/tabStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { useShortcut } from '@/hooks/useShortcut'
import { executeCommand } from '@/application/commands'
import { usePluginNavItems } from './NavRailSlot'
import {
  HOST_NAV_ITEMS,
  HOST_VIEW_IDS,
  NAV_ICONS,
  resolveActiveNavId,
  type NavGroup,
  type NavItemDescriptor,
} from './navModel'

const ITEM_BUTTON =
  'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border-none bg-transparent cursor-pointer text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-text-primary)]'

interface NavButtonProps {
  item: NavItemDescriptor
  active: boolean
  onClick: () => void
}

function NavButton({ item, active, onClick }: NavButtonProps) {
  const Icon = NAV_ICONS[item.icon] ?? NAV_ICONS.default
  return (
    <div className="group relative">
      {active && (
        <span className="pointer-events-none absolute -left-[6px] top-1/2 z-10 h-4 w-[2px] -translate-y-1/2 rounded-full bg-[var(--color-accent)]" />
      )}
      <button
        type="button"
        onClick={onClick}
        title={item.title}
        aria-label={item.title}
        aria-current={active ? 'page' : undefined}
        data-tm-nav-item={item.id}
        data-tm-nav-active={active ? 'true' : 'false'}
        className={`${ITEM_BUTTON} ${active ? 'bg-[var(--color-accent-soft)] !text-[var(--color-accent)]' : ''}`}
      >
        {item.id === 'profile' ? (
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[11px] font-medium text-[var(--color-accent)]">本</span>
        ) : (
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
        )}
      </button>
      <span className="pointer-events-none absolute left-[46px] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] opacity-0 shadow-[var(--shadow-popover)] transition-opacity duration-150 group-hover:opacity-100">
        {item.title}
      </span>
    </div>
  )
}

export default memo(function NavRail() {
  const activeTab = useTabStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId))
  const railVisible = useLayoutStore((state) => state.railVisible)
  const pluginItems = usePluginNavItems()

  const isCanvasView = activeTab?.type === 'kb'
  const activeNavId = resolveActiveNavId(activeTab)

  const items = useMemo(
    () => [...HOST_NAV_ITEMS, ...pluginItems].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    [pluginItems],
  )

  // 非画布视图里导航栏让内容区整体右移；画布页永远是覆盖式浮层，画布几何不变。
  const docked = railVisible && !isCanvasView

  // 全局 dataset 只驱动 CSS 让位，不参与任何 React 布局计算。
  useEffect(() => {
    const root = document.documentElement
    root.dataset.tmNavRail = railVisible ? 'pinned' : 'hidden'
    root.dataset.tmNavRailDocked = docked ? 'true' : 'false'
    root.dataset.tmNavRailOpen = railVisible ? 'true' : 'false'
    return () => {
      delete root.dataset.tmNavRail
      delete root.dataset.tmNavRailDocked
      delete root.dataset.tmNavRailOpen
    }
  }, [railVisible, docked])

  const openHostView = useCallback((viewId: string, label: string) => {
    useTabStore.getState().openSecondaryViewTab({ viewId, label })
  }, [])

  const handleItemClick = useCallback((item: NavItemDescriptor) => {
    if (item.openCommand) {
      void executeCommand(item.openCommand).catch((error) => {
        console.error(`Failed to open plugin view from nav: ${item.id}`, error)
      })
      return
    }
    switch (item.id) {
      case 'home':
        useTabStore.getState().activateTab('home')
        break
      case 'settings':
        openHostView(HOST_VIEW_IDS.settings, '设置')
        break
      case 'profile':
        openHostView(HOST_VIEW_IDS.profile, '账户与工作区')
        break
      default:
        break
    }
  }, [openHostView])

  useShortcut(
    Array.from({ length: 9 }, (_, index) => `Control+${index + 1}`),
    (event) => {
      const index = Number(event.key) - 1
      const target = items[index]
      if (target) handleItemClick(target)
    },
    { scope: 'global' },
  )

  const renderGroup = (group: NavGroup) => {
    const groupItems = items.filter((item) => item.group === group)
    if (groupItems.length === 0) return null
    return (
      <Fragment key={group}>
        {group !== 'workspace' && <div className="mx-auto my-1 h-px w-5 bg-[var(--color-border-light)]" />}
        {groupItems.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={activeNavId === item.id}
            onClick={() => handleItemClick(item)}
          />
        ))}
      </Fragment>
    )
  }

  return (
    <div
      data-tm-nav-rail-root=""
      data-tm-nav-rail-edge={railVisible ? 'false' : 'true'}
      data-tm-nav-rail-visible={railVisible ? 'true' : 'false'}
      className="absolute inset-y-0 left-0 z-40 flex items-stretch"
      style={{ width: railVisible ? 'var(--nav-rail-width)' : '0px' }}
    >
      {railVisible && (
        <nav
          aria-label="全局导航"
          className="flex h-full shrink-0 flex-col items-center gap-1 border-r border-[var(--color-border-light)] bg-[var(--color-bg-muted)] py-2"
          style={{ width: 'var(--nav-rail-width)' }}
        >
          {renderGroup('workspace')}
          {renderGroup('tools')}
          <div className="mt-auto flex flex-col items-center gap-1">
            {renderGroup('account')}
          </div>
        </nav>
      )}
    </div>
  )
})
