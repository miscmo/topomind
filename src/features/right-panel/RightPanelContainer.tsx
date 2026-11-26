import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { useRightPanelStore } from '@/stores/rightPanelStore'
import { applyGeometryPatch, resolveWorkspaceContainer } from '../layout/useWorkspaceGeometry'
import type { WorkspaceGeometry } from '@/domain/layout/workspaceGeometry'
import { TM_UI } from '@/shared/ui/controlStyles'
import { useResizePanel } from '../../hooks/useResizePanel'
import RightPanelShell from './RightPanelShell'

interface RightPanelContainerProps {
  tabId: string
  isActive?: boolean
  /** 由 GraphPage 统一计算的三边栏几何（唯一 clamp 真源）。 */
  geometry: WorkspaceGeometry
}

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

/**
 * 拖拽区间与最大化宽度一律来自 geometry（B = 导航栏 + 左侧栏，C = W − B）：
 * 常态 clamp(desired, rightMin, C)，最大化 width = C 且 left = B。
 * 这里不再按整个窗口的比例另算一套边界。
 */
export default memo(function RightPanelContainer({ tabId, isActive = true, geometry }: RightPanelContainerProps) {
  const collapsed = useRightPanelStore((s) => s.rightPanelCollapsed)
  const maximized = useRightPanelStore((s) => s.rightPanelMaximized)
  const pinned = useRightPanelStore((s) => s.rightPanelPinned)
  const activeTab = useRightPanelStore((s) => s.rightPanelTab)
  const setWidth = useRightPanelStore((s) => s.setRightPanelWidth)
  const setActiveTab = useRightPanelStore((s) => s.setRightPanelTab)
  const collapse = useRightPanelStore((s) => s.collapseRightPanel)
  const [willAutoCollapse, setWillAutoCollapse] = useState(false)
  const [edgeHint, setEdgeHint] = useState<string | null>(null)
  const dragStartWidthRef = useRef(geometry.rightWidth)
  const autoCollapseThreshold = Math.floor(dragStartWidthRef.current / 2)
  const containerRef = useRef<HTMLDivElement>(null)
  const hadFocusRef = useRef(false)

  const boundaryName = geometry.leftWidth > 0
    ? '左侧栏边界'
    : geometry.railWidth > 0 ? '导航栏边界' : '工作区左边缘'

  const { isResizing, handleMouseDown: handleResizeMouseDown } = useResizePanel({
    initialWidth: geometry.rightWidth,
    // 拖拽期间只改 #app-layout 上的 CSS 变量：右栏与它内部的编辑器不逐帧重渲染。
    onWidthChange: (nextWidth) => {
      applyGeometryPatch(resolveWorkspaceContainer(containerRef.current), {
        rightDesiredWidth: nextWidth,
      })
    },
    minWidth: geometry.rightMin,
    maxWidth: geometry.rightMax,
    onResizeChange: ({ rawWidth }) => {
      setWillAutoCollapse(rawWidth <= autoCollapseThreshold)
      if (rawWidth >= geometry.rightMax) setEdgeHint(`已到${boundaryName}`)
      else if (rawWidth <= geometry.rightMin) setEdgeHint('已到右栏最小宽度')
      else setEdgeHint(null)
    },
    onResizeEnd: ({ rawWidth, width: nextWidth }) => {
      setWillAutoCollapse(false)
      setEdgeHint(null)
      if (rawWidth <= autoCollapseThreshold) {
        collapse()
        return
      }
      // 只有用户主动拖拽才写 desired；左栏开合 / rail 显隐 / 窗口 resize 都不会回写。
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

  // 窗口尺寸变化由 useWorkspaceGeometry 的 ResizeObserver 统一重算 effective；
  // 用户偏好宽度保持不动，窗口放大后右栏会自动恢复原来的宽度。

  const handleResizeStart = useCallback((event: MouseEvent<HTMLDivElement>) => {
    dragStartWidthRef.current = geometry.rightWidth
    setWillAutoCollapse(false)
    setEdgeHint(null)
    handleResizeMouseDown(event)
  }, [geometry.rightWidth, handleResizeMouseDown])

  const handleResizeDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setWillAutoCollapse(false)
    setEdgeHint(null)
    collapse()
  }, [collapse])

  // 【右栏浮层 2026-11-12 / 2026-11-25 互斥改造】常态贴右、最大化铺满 B 右侧可用区，
  // 两种形态都是 absolute，绝不参与 app-layout 的 flex 计算：折叠/展开只切换显隐，
  // 画布宽度、React Flow Panel 定位和缩略图视口框都不受影响。z-30 高于画布 isolate 层（0），
  // 低于 fixed 右键菜单 z-50 与全局弹窗，避免浮层把菜单盖住；与左栏 / 导航栏零重叠靠
  // --tm-workspace-left-boundary 保证，不靠 z-index 互相遮挡。
  return (
    <div
      ref={containerRef}
      className={`${collapsed ? 'hidden' : 'flex'} h-full shrink-0 right-panel-container absolute inset-y-0 right-0 z-30 ${maximized ? 'bg-[var(--color-canvas-bg)]' : ''}`}
      style={maximized
        ? { left: 'var(--tm-workspace-left-boundary, 0px)', width: 'auto' }
        : { width: 'var(--tm-right-panel-width, 600px)' }}
      data-tm-right-panel-overlay="true"
      data-tm-right-panel-pinned={pinned ? 'true' : 'false'}
      data-tm-right-panel-focus-auto-hide="true"
      data-tm-right-panel-left-boundary={geometry.boundary}
      aria-hidden={collapsed}
    >
      {!maximized && edgeHint && isResizing && (
        <div className={`pointer-events-none absolute left-3 top-3 z-20 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-medium text-[var(--color-text-secondary)] shadow-[var(--shadow-md)] tm-popover-enter ${TM_UI.hint}`}>
          {edgeHint}
        </div>
      )}
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
          data-tm-right-panel-resize=""
          className="group absolute left-0 top-0 bottom-0 z-[20] w-2 -translate-x-1/2 cursor-col-resize bg-transparent select-none transition-colors"
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
        width={maximized ? '100%' : 'var(--tm-right-panel-width, 600px)'}
        onTabChange={setActiveTab}
        onCollapse={collapse}
        isActive={isActive && !collapsed}
      />
    </div>
  )
})
