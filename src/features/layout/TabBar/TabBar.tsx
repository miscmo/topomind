import { BookOpen, MoreHorizontal, X } from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useTabStore, type Tab } from '../../../stores/tabs/tabStore'
import { useShortcut } from '../../../hooks/useShortcut'
import { flushTabs, getDirtyState } from '../../../core/close-guard'
import { recordStep } from '../../../core/traceBuffer'
import { auditInterval, recordUser } from '../../../core/observe'
import { LOG_ACTIONS } from '../../../shared/observability/logContract'
import { TM_UI, tmUI } from '../../../shared/ui/controlStyles'

/**
 * 横向知识库 tab 栏（Chrome 式弹性宽度 + Π 形连体视觉）。
 *
 * 职责边界：这里只切换「工作区内已打开的知识库」（type === 'kb'）。
 * 首页在标题栏（紧跟导航栏开关），设置 / 账户 / 学习记录 / 日志与性能由左侧 NavRail 负责，
 * 它们仍留在 tabStore 里（App.tsx 依赖 activeTab.viewId 决定视图显隐），只是不在此渲染。
 *
 * 布局边界：整条 tab 栏活在 32px 标题栏内部，是标题栏中段的 flex 子项，
 * 不是 App.tsx 的 flex-col 兄弟；新增任何一条横向 shrink-0 兄弟都会压矮
 * `#graph-panel`。
 *
 * 宽度算法（本次修复的核心，别再改回「固定宽度 + 数量预算」）：
 *   - 测量对象必须是 `data-tm-tab-zone`（中段容器，flex-1，宽度稳定），
 *     **绝不能测 .tm-tab-strip 自己**：strip 宽度由 tab 内容决定，测它会产生
 *     「渲染 2 个 → 算出只放得下 1 个 → 只剩 1 个 → 算出还是 1 个」的正反馈，
 *     表现就是「打开两个知识库也折叠成下拉」，正是用户反馈的 bug。
 *   - 可用宽度 = zone 宽 - 恒定拖拽安全带 - 父级 gap。
 *   - n 个 tab 能全部以最小宽度放下时，全部横向展示，每个宽度在
 *     [--tab-min-width, --tab-max-width] 之间按可用宽度均分（Chrome 式压缩）。
 *   - 只有「n 个都压到最小宽度仍然放不下」时，才把多出来的收进「⋯N」，
 *     并预留 --tab-overflow-width 给按钮；激活 tab 永远留在可见列表。
 */
const FADE_LABEL_LENGTH = 11

interface TabMetrics {
  min: number
  max: number
  gap: number
  overflow: number
}

interface ZoneSize {
  width: number
  gutter: number
  gap: number
}

/** 宽度常量只在 tokens.css 里定义一份，运行时读取，避免 TS 侧出现第二份真源。 */
function readTabMetrics(): TabMetrics {
  const style = getComputedStyle(document.documentElement)
  const px = (name: string, fallback: number) => {
    const value = Number.parseFloat(style.getPropertyValue(name))
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
  return {
    min: px('--tab-min-width', 88),
    max: px('--tab-max-width', 180),
    gap: px('--tab-gap', 4),
    overflow: px('--tab-overflow-width', 40),
  }
}

export default memo(function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activateTab = useTabStore((s) => s.activateTab)

  const kbTabs = useMemo(() => tabs.filter((tab) => tab.type === 'kb'), [tabs])

  const [isOpen, setIsOpen] = useState(false)
  const [closingTabId, setClosingTabId] = useState<string | null>(null)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [dirtyIds, setDirtyIds] = useState<string[]>([])
  const [zone, setZone] = useState<ZoneSize>({ width: 0, gutter: 0, gap: 0 })

  const metrics = useMemo(readTabMetrics, [])
  const rootRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // getDirtyState 是纯函数（由 registerTabSaver 的 isDirty 实时求值），没有可订阅的 store。
  // 低频轮询只用来刷新「未保存圆点」，不读写任何业务状态，开销可忽略。
  useEffect(() => {
    const sync = () => {
      const next = getDirtyState().dirtyTabIds
      setDirtyIds((prev) =>
        prev.length === next.length && prev.every((id, index) => id === next[index]) ? prev : next)
    }
    sync()
    // P2：1s 轮询按分钟聚合，不逐 tick 写盘。
    const timer = window.setInterval(auditInterval('TabBar.dirtySync', sync), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // 只观察中段容器：它的宽度由标题栏左右两段决定，与 tab 内容无关，因此不会自反馈。
  useEffect(() => {
    const element = rootRef.current?.closest<HTMLElement>('[data-tm-tab-zone]')
    if (!element) return

    const measure = () => {
      const gutter = element.querySelector<HTMLElement>('[data-tm-tab-drag-gutter]')
      const next: ZoneSize = {
        width: element.getBoundingClientRect().width,
        gutter: gutter?.getBoundingClientRect().width ?? 0,
        gap: Number.parseFloat(getComputedStyle(element).columnGap) || 0,
      }
      setZone((prev) =>
        prev.width === next.width && prev.gutter === next.gutter && prev.gap === next.gap ? prev : next)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => {
    const n = kbTabs.length
    if (n === 0) return { visibleCount: 0, tabWidth: metrics.max, hasOverflow: false }
    // 首帧还没测量时先按最大宽度全渲染，避免挂载瞬间闪一下溢出按钮。
    if (zone.width <= 0) return { visibleCount: n, tabWidth: metrics.max, hasOverflow: false }

    const available = Math.max(metrics.min, zone.width - zone.gutter - zone.gap)
    const allAtMin = n * metrics.min + (n - 1) * metrics.gap

    if (allAtMin <= available) {
      // 全部放得下：一个都不折叠，宽度在 min..max 之间均分，右侧留白用于拖拽窗口。
      const width = Math.min(metrics.max, Math.max(metrics.min,
        (available - (n - 1) * metrics.gap) / n))
      return { visibleCount: n, tabWidth: width, hasOverflow: false }
    }

    // 全部压到最小宽度仍放不下：预留「⋯N」按钮宽度后，尽量多展示几个，
    // 且所有可见 tab 保持最小宽度（Chrome 行为），剩余留白交还给拖拽区。
    const usable = Math.max(metrics.min, available - metrics.overflow - metrics.gap)
    const fit = Math.max(1, Math.floor((usable + metrics.gap) / (metrics.min + metrics.gap)))
    const visibleCount = Math.min(fit, n - 1)
    return { visibleCount, tabWidth: metrics.min, hasOverflow: true }
  }, [kbTabs.length, zone, metrics])

  // 当前激活的知识库必须始终可见：空间不足时把它换进可见列表末尾。
  const visibleTabs = useMemo(() => {
    if (layout.visibleCount >= kbTabs.length) return kbTabs
    const activeIndex = kbTabs.findIndex((tab) => tab.id === activeTabId)
    if (activeIndex >= layout.visibleCount) {
      return [...kbTabs.slice(0, Math.max(0, layout.visibleCount - 1)), kbTabs[activeIndex]]
    }
    return kbTabs.slice(0, layout.visibleCount)
  }, [kbTabs, layout.visibleCount, activeTabId])

  const hiddenCount = kbTabs.length - visibleTabs.length

  useEffect(() => {
    if (hiddenCount === 0 && isOpen) setIsOpen(false)
  }, [hiddenCount, isOpen])

  const handleCloseTab = useCallback(async (event: ReactMouseEvent, tabId: string) => {
    event.stopPropagation()
    event.preventDefault()
    if (closingTabId) return

    const tab = useTabStore.getState().getClosableTabInfo(tabId)
    if (!tab) return

    setCloseError(null)
    setClosingTabId(tabId)
    try {
      if (getDirtyState().dirtyTabIds.includes(tabId)) {
        const result = await flushTabs([tabId])
        if (!result.ok) throw new Error(result.error || '保存未完成，标签页未关闭')
      }
      const closedTab = useTabStore.getState().closeTab(tabId)
      if (!closedTab) return
      // P7：关闭/切换标签页的领域结果事件与语义事件原本并存，属同一事实两次上报。
      // 领域侧降级为内存步骤，只保留 1 条语义化 user 记录。
      recordStep({ name: 'ui.tab.close', outcome: 'closed', params: { tabId } })
      void recordUser(LOG_ACTIONS.userTabClose, {
        target: { type: 'tab', id: tabId, label: closedTab.label },
        result: 'closed',
        view: 'tabbar',
      })
      setIsOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setCloseError(message || '保存失败，标签页未关闭')
    } finally {
      setClosingTabId(null)
    }
  }, [closingTabId])

  const handleTabClick = useCallback((tab: Tab) => {
    if (tab.id !== activeTabId) {
      activateTab(tab.id)
      // P7：切换 tab 的领域结果事件与语义事件原本并存，同一次点击写两条 user 日志。
      // 领域侧降级为内存步骤，只保留 1 条语义化 user 记录。
      recordStep({ name: 'ui.tab.switch', outcome: 'activated', params: { tabId: tab.id } })
      void recordUser(LOG_ACTIONS.userTabSwitch, {
        target: { type: 'tab', id: tab.id, label: tab.label },
        result: 'activated',
        view: 'tabbar',
        from: activeTabId,
        to: tab.id,
      })
    }
    setIsOpen(false)
  }, [activateTab, activeTabId])

  // Ctrl+Tab 属于右栏显隐、Ctrl+1..9 属于左侧导航，这里只用 Alt+1..9 与 PageUp/PageDown。
  useShortcut(Array.from({ length: 9 }, (_, index) => `Alt+${index + 1}`), (event) => {
    const target = kbTabs[Number(event.key) - 1]
    if (target) handleTabClick(target)
  }, { scope: 'global' })

  useShortcut(['Control+PageUp', 'Control+PageDown'], (event) => {
    if (kbTabs.length < 2) return
    const index = kbTabs.findIndex((tab) => tab.id === activeTabId)
    if (index < 0) return
    const delta = event.code.toLowerCase() === 'pagedown' ? 1 : -1
    handleTabClick(kbTabs[(index + delta + kbTabs.length) % kbTabs.length])
  }, { scope: 'global' })

  useShortcut(['Escape'], () => {
    if (isOpen) setIsOpen(false)
  }, { scope: 'global', preventDefault: false })

  // 标题栏是 app-region: drag 区，它会吞掉原生指针事件。菜单展开时铺一层
  // 透明的 no-drag 遮罩来接管点击（沿用旧下拉的成熟做法）。
  useEffect(() => {
    if (!isOpen) return

    const firstMenuItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    firstMenuItem?.focus()

    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.zIndex = '1'
    overlay.style.setProperty('-webkit-app-region', 'no-drag')

    const handleClose = () => setIsOpen(false)
    overlay.addEventListener('pointerdown', handleClose)
    if (rootRef.current) rootRef.current.appendChild(overlay)
    else document.body.appendChild(overlay)

    const handleWindowPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && rootRef.current?.contains(event.target)) return
      handleClose()
    }
    window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true })

    return () => {
      overlay.removeEventListener('pointerdown', handleClose)
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
      window.removeEventListener('pointerdown', handleWindowPointerDown, { capture: true })
      window.setTimeout(() => triggerRef.current?.focus(), 0)
    }
  }, [isOpen])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    if (items.length === 0) return
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const baseIndex = currentIndex >= 0 ? currentIndex : 0
      const nextIndex = event.key === 'ArrowDown'
        ? (baseIndex + 1) % items.length
        : (baseIndex - 1 + items.length) % items.length
      items[nextIndex]?.focus()
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && currentIndex >= 0) {
      event.preventDefault()
      items[currentIndex]?.click()
    }
  }

  const handleStripKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const nodes = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
    if (nodes.length === 0) return
    const current = nodes.indexOf(document.activeElement as HTMLElement)
    let next = current
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = nodes.length - 1
    else next = (current + (event.key === 'ArrowRight' ? 1 : -1) + nodes.length) % nodes.length
    event.preventDefault()
    nodes[next]?.focus()
    nodes[next]?.click()
  }

  if (tabs.length === 0) return null

  return (
    <div
      ref={rootRef}
      data-tm-tab-bar=""
      data-tm-tab-count={kbTabs.length}
      data-tm-tab-visible={visibleTabs.length}
      data-tm-tab-overflow={hiddenCount > 0 ? 'true' : 'false'}
      className="relative flex items-center h-full min-w-0"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <div
        ref={stripRef}
        role="tablist"
        aria-label="打开的知识库"
        className={TM_UI.tabStrip}
        style={{ '--tab-current-width': `${layout.tabWidth}px` } as CSSProperties}
        onKeyDown={handleStripKeyDown}
      >
        {kbTabs.length === 0 && (
          <span className={TM_UI.hint} style={{ whiteSpace: 'nowrap', marginRight: 4 }}>
            打开一个知识库开始
          </span>
        )}
        {visibleTabs.map((tab) => {
          const selected = tab.id === activeTabId
          const dirty = dirtyIds.includes(tab.id)
          const fade = tab.label.length > FADE_LABEL_LENGTH
          return (
            <div
              key={tab.id}
              role="tab"
              data-tm-tab-id={tab.id}
              aria-selected={selected}
              aria-label={tab.label}
              tabIndex={selected ? 0 : -1}
              className={tmUI(selected ? TM_UI.tabActive : TM_UI.tab)}
              title={tab.label}
              onClick={() => handleTabClick(tab)}
              onAuxClick={(event) => {
                if (event.button === 1) void handleCloseTab(event, tab.id)
              }}
            >
              <BookOpen className={TM_UI.tabIcon} aria-hidden="true" />
              <span className={fade ? TM_UI.tabLabelFade : TM_UI.tabLabel}>{tab.label}</span>
              <span className={TM_UI.tabTrailing}>
                {dirty && <span className={TM_UI.tabDot} aria-label="未保存" />}
                <button
                  type="button"
                  className={TM_UI.tabClose}
                  aria-label={`关闭 ${tab.label}`}
                  title={`关闭 ${tab.label}`}
                  disabled={closingTabId !== null}
                  onClick={(event) => { void handleCloseTab(event, tab.id) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
                  }}
                >
                  <X className={TM_UI.iconSm} aria-hidden="true" />
                </button>
              </span>
            </div>
          )
        })}
        {hiddenCount > 0 && (
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={isOpen}
            className={TM_UI.tabActionCount}
            aria-label={`更多已打开的知识库（${hiddenCount}）`}
            title={`还有 ${hiddenCount} 个已打开的知识库`}
            onClick={() => setIsOpen(!isOpen)}
          >
            <MoreHorizontal className={TM_UI.iconSm} aria-hidden="true" />
            <span>{hiddenCount}</span>
          </button>
        )}
      </div>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="打开的标签页"
          className={tmUI(TM_UI.menu, TM_UI.scroll, 'tm-fade-enter absolute top-[calc(100%+6px)] left-0 min-w-[240px] max-w-[320px] max-h-[60vh] overflow-y-auto')}
          onKeyDown={handleMenuKeyDown}
          style={{ WebkitAppRegion: 'no-drag', zIndex: 'var(--z-titlebar-menu)' }}
        >
          {closeError && (
            <div role="alert" className={TM_UI.hint} style={{ color: 'var(--color-danger)', padding: '4px 8px' }}>
              {closeError}
            </div>
          )}
          {kbTabs.map((tab) => (
            <div
              key={tab.id}
              className={TM_UI.menuItem}
              role="menuitem"
              tabIndex={0}
              data-active={tab.id === activeTabId ? 'true' : undefined}
              onClick={() => handleTabClick(tab)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  handleTabClick(tab)
                }
              }}
            >
              <div className={TM_UI.tabMenuRow}>
                <BookOpen className={TM_UI.iconSm} aria-hidden="true" />
                <span className={TM_UI.tabMenuLabel} title={tab.label}>{tab.label}</span>
                <button
                  type="button"
                  className={TM_UI.iconButton}
                  aria-label={`关闭 ${tab.label}`}
                  title={`关闭 ${tab.label}`}
                  disabled={closingTabId !== null}
                  onClick={(event) => { void handleCloseTab(event, tab.id) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
                  }}
                >
                  <X className={TM_UI.iconSm} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
