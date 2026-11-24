import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { useRightPanelStore } from '@/stores/rightPanelStore'
import { useResizePanel } from '../../hooks/useResizePanel'
import RightPanelShell from './RightPanelShell'

interface RightPanelContainerProps {
  tabId: string
  isActive?: boolean
}

const RIGHT_PANEL_MIN_RATIO = 0.2
const RIGHT_PANEL_MAX_RATIO = 0.8
const RIGHT_PANEL_WIDTH_FLOOR = 280

/**
 * 「浮层交互」白名单：命中这些祖先的元素一律不算「焦点移出右栏」。
 *
 * BlockNote 的浮层全部 portal 到 body（portalElements.default = null），DOM 上不在
 * 右栏容器内。其中格式化工具条的根节点是 role="toolbar"（不是 role="menu"），
 * 链接工具条 / 块侧边菜单 / 斜杠菜单 / 颜色与链接的 popover 也各自用 bn-* 类名。
 * 用户选中文字后点工具条里的「复制」，焦点会从 contenteditable 移到 body 下的
 * <button>：只看 container.contains(active) 就会误判成离开右栏并立刻折叠，编辑器
 * 连同工具条一起被隐藏，正在进行的异步复制也被打断（2026-11-22 实测：面板消失
 * 且文字没复制进去）。这里把编辑器浮层显式纳入白名单，与「浮层打开期间不折叠」
 * 的既有规则保持一致。
 */
/**
 * 淡出中的浮层是 inert 的「幽灵」DOM：React 已经卸载它，全局退出代理只是
 * 临时插回原位播 130ms 淡出。此时它既不该挡住下一次外部点击，也不该让
 * 「浮层仍打开 → 不折叠右栏」的判定继续成立，因此白名单每一项都排除
 * data-tm-exiting 子树；两处判定仍共用同一个常量，避免白名单分叉。
 */
const RIGHT_PANEL_OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="menu"]',
  '[role="toolbar"]',
  '[data-tm-keep-right-panel]',
  '[data-tm-emoji-picker]',
  '.tm-menu',
  '.bn-formatting-toolbar',
  '.bn-link-toolbar',
  '.bn-side-menu',
  '.bn-suggestion-menu',
  '.bn-popover-content',
]
  .map((selector) => `${selector}:not([data-tm-exiting])`)
  .join(', ')

/** 按「整个应用（窗口）宽度」的百分比计算可拖拽的 [min, max] 范围。 */
function getRightPanelBounds() {
  const appWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
  const min = Math.max(RIGHT_PANEL_WIDTH_FLOOR, Math.round(appWidth * RIGHT_PANEL_MIN_RATIO))
  const max = Math.round(appWidth * RIGHT_PANEL_MAX_RATIO)
  return { min, max }
}

export default memo(function RightPanelContainer({ tabId, isActive = true }: RightPanelContainerProps) {
  const collapsed = useRightPanelStore((s) => s.rightPanelCollapsed)
  const maximized = useRightPanelStore((s) => s.rightPanelMaximized)
  const pinned = useRightPanelStore((s) => s.rightPanelPinned)
  const width = useRightPanelStore((s) => s.rightPanelWidth)
  const activeTab = useRightPanelStore((s) => s.rightPanelTab)
  const setWidth = useRightPanelStore((s) => s.setRightPanelWidth)
  const setActiveTab = useRightPanelStore((s) => s.setRightPanelTab)
  const collapse = useRightPanelStore((s) => s.collapseRightPanel)
  const [willAutoCollapse, setWillAutoCollapse] = useState(false)
  const { min: RIGHT_PANEL_MIN_WIDTH, max: RIGHT_PANEL_MAX_WIDTH } = getRightPanelBounds()
  const dragStartWidthRef = useRef(width)
  const autoCollapseThreshold = Math.floor(dragStartWidthRef.current / 2)
  const widthRef = useRef(width)
  widthRef.current = width
  const containerRef = useRef<HTMLDivElement>(null)
  const hadFocusRef = useRef(false)

  const { isResizing, handleMouseDown: handleResizeMouseDown } = useResizePanel({
    initialWidth: width,
    onWidthChange: setWidth,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    onResizeChange: ({ rawWidth }) => {
      setWillAutoCollapse(rawWidth <= autoCollapseThreshold)
    },
    onResizeEnd: ({ rawWidth, width: nextWidth }) => {
      setWillAutoCollapse(false)
      if (rawWidth <= autoCollapseThreshold) {
        collapse()
        return
      }
      setWidth(nextWidth)
    },
  })

  // 【2026-11-21 按需展开 + 失焦隐藏】界面上不再有手动折叠按钮。
  // 只在「焦点确实从右栏内部移出」时自动折叠，避免误伤：
  // - 右栏从未获得焦点时（例如刚点画布文档图标展开），点画布不会立刻把它收掉；
  // - 编辑器块间切换、颜色选择器 / 对话框 / 菜单等 portal 交互都不会触发；
  // - **焦点没有明确落点（relatedTarget === null）时绝不折叠**：contenteditable
  //   的 blur()、程序化失焦、切到窗口外都会走到这里，此时折叠会卸载编辑器并丢掉
  //   debounce 里尚未落盘的正文（2026-11-21 GUI 阶段 D 实测：输入不见且后续 40+
  //   条右栏断言连锁失败）。点画布空白收起由既有的
  //   `applyRightPanelAutoVisibility(false)` 负责，不需要这条路径补位；
  // - pinned / maximized 由 store 与下面的显式判断双重短路。
  useEffect(() => {
    // 所有 KB 标签页常驻挂载：非活跃标签页绝不能装全局失焦监听，更不能因为
    // 别的标签页里的点击把状态写进「当前活跃知识库」的分桶。
    if (!isActive || collapsed) {
      hadFocusRef.current = false
      return
    }
    const container = containerRef.current
    if (!container) return

    const isOverlayTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false
      return !!target.closest(RIGHT_PANEL_OVERLAY_SELECTOR)
    }
    const collapseIfFocusLost = () => {
      const state = useRightPanelStore.getState()
      if (state.rightPanelCollapsed || state.rightPanelPinned || state.rightPanelMaximized) return
      // 任何模态 / 浮层打开期间一律不折叠：对话框常 portal 到 body，
      // 焦点移进去时 relatedTarget 可能为空，只看 activeElement 会误判成「离开右栏」，
      // 折叠会让 DetailPanel 失活并把对话框一起卸载（2026-11-21 实测踩坑）。
      if (document.querySelector(RIGHT_PANEL_OVERLAY_SELECTOR)) return
      const active = document.activeElement
      if (active instanceof Node && container.contains(active)) return
      if (isOverlayTarget(active)) return
      // 没有明确的新焦点（body / html / null）不算「焦点移出」，只算失焦。
      // 否则编辑器 blur 会被误判，见本 effect 顶部注释。
      if (!active || active === document.body || active === document.documentElement) return
      hadFocusRef.current = false
      state.collapseRightPanel()
    }
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && container.contains(event.target)) hadFocusRef.current = true
    }
    const onFocusOut = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || !container.contains(event.target)) return
      // 焦点没有明确落点：编辑器 blur() / 程序化失焦 / 切出窗口。这类失焦不能折叠，
      // 否则右栏会连同未落盘的正文一起被卸载。点画布空白走
      // applyRightPanelAutoVisibility(false)，焦点移到别的可聚焦控件时 relatedTarget
      // 非空，仍会正常触发隐藏。
      if (event.relatedTarget === null) return
      if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return
      if (isOverlayTarget(event.relatedTarget)) return
      // 延后一拍：等浏览器把 activeElement 落定，避免 contenteditable 块间切换误判。
      window.setTimeout(collapseIfFocusLost, 0)
    }
    const onPointerDown = (event: PointerEvent) => {
      // 只补 focusout 覆盖不到的场景：焦点在右栏里，用户点了不可聚焦的画布区域。
      // 点标题栏 / 导航 / 节点树 / 浮层都不算「回到工作对象」，不能顺手收掉右栏。
      if (!hadFocusRef.current || pinned || maximized) return
      if (event.target instanceof Node && container.contains(event.target)) return
      if (isOverlayTarget(event.target)) return
      if (!(event.target instanceof Element) || !event.target.closest('#graph-panel')) return
      collapseIfFocusLost()
    }
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [collapsed, pinned, maximized, isActive])

  // 窗口尺寸变化时，把已保存宽度重新夹回 [20%, 80%]，避免面板超出可用空间。
  // 同样只对活跃标签页执行：其它标签页挂载时不能顺手改掉活跃知识库的宽度。
  useEffect(() => {
    if (!isActive) return
    const handleWindowResize = () => {
      const { min, max } = getRightPanelBounds()
      const next = Math.max(min, Math.min(max, widthRef.current))
      if (next !== widthRef.current) setWidth(next)
    }
    window.addEventListener('resize', handleWindowResize)
    handleWindowResize()
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [setWidth, isActive])

  const handleResizeStart = useCallback((event: MouseEvent<HTMLDivElement>) => {
    dragStartWidthRef.current = width
    setWillAutoCollapse(false)
    handleResizeMouseDown(event)
  }, [handleResizeMouseDown, width])

  const handleResizeDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setWillAutoCollapse(false)
    collapse()
  }, [collapse])

  // 【右栏浮层 2026-11-12】常态贴右、最大化铺满，两种形态都是 absolute，绝不参与
  // app-layout 的 flex 计算：折叠/展开只切换显隐，画布宽度、React Flow Panel 定位和
  // 缩略图视口框都不受影响。z-30 高于画布 isolate 层（0），低于 fixed 右键菜单 z-50
  // 与全局弹窗 z-10000，避免浮层把菜单盖住。
  return (
    <div
      ref={containerRef}
      className={`${collapsed ? 'hidden' : 'flex'} h-full shrink-0 right-panel-container ${maximized ? 'absolute inset-0 z-30 bg-[var(--color-canvas-bg)] w-full' : 'absolute inset-y-0 right-0 z-30'}`}
      data-tm-right-panel-overlay="true"
      data-tm-right-panel-pinned={pinned ? 'true' : 'false'}
      data-tm-right-panel-focus-auto-hide="true"
      aria-hidden={collapsed}
    >
      {!maximized && willAutoCollapse && isResizing && (
        <>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-[22] w-[3px] bg-[var(--color-danger)] shadow-[-10px_0_20px_rgba(239,68,68,0.15)] transition-all" />
          <div className="pointer-events-none absolute right-3 top-3 z-[23] rounded-full border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-danger)] shadow-[var(--shadow-md)] backdrop-blur-md tm-popover-enter">
            松开即可折叠
          </div>
        </>
      )}
      {!maximized && (
        <div
          className="group w-2 -ml-1 h-full cursor-col-resize shrink-0 bg-transparent z-[20] relative select-none transition-colors"
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          title="拖拽调整宽度，拖到当前宽度一半或双击可折叠"
        >
          <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px transition-all duration-200 group-hover:bg-[var(--color-accent)]/40 group-active:bg-[var(--color-accent)] group-active:w-[2px] ${isResizing ? 'bg-[var(--color-accent)] w-[2px]' : 'bg-transparent'} ${willAutoCollapse ? '!bg-[var(--color-danger)] !w-[3px]' : ''}`} />
        </div>
      )}
      <RightPanelShell
        tabId={tabId}
        rightPanelTab={activeTab}
        width={maximized ? '100%' : width}
        onTabChange={setActiveTab}
        onCollapse={collapse}
        isActive={isActive && !collapsed}
      />
    </div>
  )
})
