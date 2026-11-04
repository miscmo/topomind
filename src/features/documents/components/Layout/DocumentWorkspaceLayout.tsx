import { memo, useState, useCallback, useRef, useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { GripVertical, ListTree, Pin, PinOff } from 'lucide-react'
import type { DetailSidebarTab, DocumentSaveStatus, DocumentWorkspaceLayoutProps, TocItem } from '../../types/workspaceTypes'
import { AttachmentsTab } from './AttachmentsTab'
import { useResizePanel } from '../../../../hooks/useResizePanel'
import { logAction } from '../../../../core/log-backend'
import { useRightPanelStore } from '@/stores/rightPanelStore'
import { useDetailLockStore } from '../../../right-panel/model/detailLockStore'
import { useGraphStore, useSelectedNodeId } from '../../../../stores/graphStore'
import { useTabStore, useGraphSession } from '../../../../stores/tabs/tabStore'
import { scrollChildIntoView } from '../../SmartDocumentEditor/smartDocumentUtils'

// 目录固定状态持久化；旧的 topomind_toc_panel_position（自由拖动位置）已废弃，不再读取。
const TOC_PINNED_KEY = 'topomind_toc_pinned'
// 触发条只保留「上下拖动」：存相对编辑器区可用高度的比例 0~1，窗口缩放后位置仍合理。
const TOC_RAIL_Y_KEY = 'topomind_toc_rail_y'
// 鼠标从触发条移到面板之间可能短暂离开命中区，延迟关闭避免面板闪烁。
const TOC_CLOSE_DELAY_MS = 150
// 极短的展开延迟：给「按住触发条直接拖动」留出抓取窗口，同时不影响 hover 的即时感。
const TOC_OPEN_DELAY_MS = 90
// 触发条尺寸：收起态也能一眼看到「目录 + 可拖动」。
const TOC_RAIL_WIDTH = 22
const TOC_RAIL_HEIGHT = 104
const TOC_RAIL_EDGE = 12
// 展开后的整体宽度 = 触发条原宽 + 原面板宽。触发条与面板不再是两个物体，
// 而是同一个 morph 容器的两种形态：宽/高/圆角/底色/边框/阴影连续过渡。
const TOC_PANEL_WIDTH = 262
const TOC_HEADER_HEIGHT = 36
const TOC_MORPH_MS = 300
// 标准缓动而非前载的 easeOutQuint：前 1/4 时间只张开约 1/3，才看得出「竖条在长成面板」。
const TOC_MORPH_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

export const DocumentWorkspaceLayout = memo(function DocumentWorkspaceLayout({
  isDirty,
  onSave,
  attachmentCardPath,
  documentType,
  detailHeader,
  documentsTabContent,
  activeDetailDocumentPath,
  detailSidebarTab: controlledDetailSidebarTab,
  onDetailSidebarTabChange,
  detailSidebarCollapsed: controlledDetailSidebarCollapsed,
  detailSidebarFloating,
  onDetailSidebarCollapsedChange,
  onSidebarHoverChange,
  tocItems: providedTocItems,
  onTocItemClick,
  activeTocId,
  editorContent,
  statusBarContent,
  renderStatusBar
}: DocumentWorkspaceLayoutProps) {
  const [saveStatus, setSaveStatus] = useState<DocumentSaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [internalDetailSidebarCollapsed, setInternalDetailSidebarCollapsed] = useState(false)
  const [detailSidebarWidth, setDetailSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('topomind_detail_sidebar_width')
    return saved ? parseInt(saved, 10) : 180
  })
  const [internalDetailSidebarTab, setInternalDetailSidebarTab] = useState<DetailSidebarTab>('documents')
  // 点击目录项时锁定高亮，屏蔽滚动联动的覆写，直到 scroll-spy 追上一致 / 用户手动滚动 / 超时
  const [manualActiveId, setManualActiveId] = useState<string | null>(null)

  // 目录默认收起成贴右缘的触发条：hover 展开、鼠标移出才隐藏；左上角图钉可固定常驻。
  // 面板始终吸附右侧（不再支持左右自由拖动），触发条只允许上下拖动。
  const [tocPinned, setTocPinned] = useState<boolean>(() => {
    try { return localStorage.getItem(TOC_PINNED_KEY) === 'true' } catch { return false }
  })
  const [tocHovered, setTocHovered] = useState(false)
  const tocExpanded = tocPinned || tocHovered
  const tocCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tocOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tocListRef = useRef<HTMLDivElement>(null)
  const tocPanelContentRef = useRef<HTMLDivElement>(null)

  const [tocRailRatio, setTocRailRatio] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(TOC_RAIL_Y_KEY)
      const value = raw == null ? 0 : Number.parseFloat(raw)
      return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
    } catch { return 0 }
  })
  const tocRailRatioRef = useRef(tocRailRatio)
  // 触发条所在区域的尺寸 / 编辑器原生滚动条宽度，运行时实测（overlay 滚动条宽度为 0）。
  const [tocZoneHeight, setTocZoneHeight] = useState(0)
  // 滚动条宽度之外再留 10px 视觉间隙，避免和原生滚动条挤成「两条细条」。
  const [tocRightInset, setTocRightInset] = useState(10)
  // 面板内容自然高度（实测），morph 容器展开时的目标高度由它和可用空间共同决定。
  const [tocPanelHeight, setTocPanelHeight] = useState(TOC_RAIL_HEIGHT + TOC_HEADER_HEIGHT)
  const [tocDragging, setTocDragging] = useState(false)
  const tocZoneRef = useRef<HTMLDivElement>(null)
  const tocDragRef = useRef<{ startY: number; startTop: number; moved: boolean } | null>(null)
  const tocDraggingRef = useRef(false)
  const hasToc = (providedTocItems?.length ?? 0) > 0
  // 拖动范围恒以「收起态高度」为基准：这样保存的比例在展开/收起两态换算出的位置一致，
  // 而展开态容器高度又被可用空间钳住，不会顶出底边。
  const tocRailRange = Math.max(0, tocZoneHeight - TOC_RAIL_HEIGHT - TOC_RAIL_EDGE * 2)
  const tocRailTop = TOC_RAIL_EDGE + tocRailRange * tocRailRatio
  const tocAvailableHeight = Math.max(140, tocZoneHeight - tocRailTop - TOC_RAIL_EDGE)
  const tocShellHeight = Math.min(Math.max(140, tocPanelHeight), tocAvailableHeight)
  const tocListMaxHeight = Math.max(80, tocAvailableHeight - TOC_HEADER_HEIGHT)
  // 面板内容固定 262 宽贴右缘；展开时随容器左缘一起向左推（translateX = clip 右侧裁量），
  // 让文字从第一帧就贴着容器左缘出现，而不是等板子长完才从右侧空白里「迟到」。
  const tocClipRight = tocExpanded ? 0 : TOC_PANEL_WIDTH - TOC_RAIL_WIDTH
  const tocClipBottom = Math.max(
    0,
    tocPanelHeight - (tocExpanded ? tocShellHeight : TOC_RAIL_HEIGHT),
  )

  const toggleTocPinned = useCallback(() => {
    const next = !tocPinned
    setTocPinned(next)
    try { localStorage.setItem(TOC_PINNED_KEY, String(next)) } catch { /* ignore */ }
  }, [tocPinned])

  const cancelTocClose = useCallback(() => {
    if (tocCloseTimerRef.current != null) {
      clearTimeout(tocCloseTimerRef.current)
      tocCloseTimerRef.current = null
    }
  }, [])
  const cancelTocOpen = useCallback(() => {
    if (tocOpenTimerRef.current != null) {
      clearTimeout(tocOpenTimerRef.current)
      tocOpenTimerRef.current = null
    }
  }, [])

  // 鼠标进入：留 90ms 抓取窗口（按住即可直接拖动），随后展开；键盘 focus 立即展开。
  const handleTocEnter = useCallback(() => {
    cancelTocClose()
    if (tocDraggingRef.current) return
    if (tocPinned || tocHovered) {
      setTocHovered(true)
      return
    }
    cancelTocOpen()
    tocOpenTimerRef.current = setTimeout(() => setTocHovered(true), TOC_OPEN_DELAY_MS)
  }, [cancelTocClose, cancelTocOpen, tocPinned, tocHovered])
  const handleTocFocus = useCallback(() => {
    cancelTocOpen()
    cancelTocClose()
    if (!tocDraggingRef.current) setTocHovered(true)
  }, [cancelTocOpen, cancelTocClose])
  const handleTocLeave = useCallback(() => {
    cancelTocOpen()
    cancelTocClose()
    // 拖动过程中指针可能滑出容器，此时不要收起；唯一隐藏入口仍是「鼠标移出」。
    if (tocDraggingRef.current) return
    tocCloseTimerRef.current = setTimeout(() => setTocHovered(false), TOC_CLOSE_DELAY_MS)
  }, [cancelTocOpen, cancelTocClose])

  // 拖动指针挂在 morph 容器上：收起态整条 22px 都是把手，展开态只认 header 的 grip，
  // 这样捕获目标始终是同一个稳定元素，且不会抢走目录项 / 图钉的点击。
  const handleTocPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    const fromHandle = !!(e.target as HTMLElement).closest?.('[data-toc-drag-handle]')
    if (tocExpanded && !fromHandle) return
    cancelTocOpen()
    cancelTocClose()
    tocDraggingRef.current = true
    tocDragRef.current = { startY: e.clientY, startTop: tocRailTop, moved: false }
    setTocDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [tocExpanded, tocRailTop, cancelTocOpen, cancelTocClose])

  const handleTocPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const drag = tocDragRef.current
    if (!drag) return
    const dy = e.clientY - drag.startY
    if (!drag.moved && Math.abs(dy) < 3) return
    drag.moved = true
    const range = Math.max(0, tocZoneHeight - TOC_RAIL_HEIGHT - TOC_RAIL_EDGE * 2)
    const nextTop = Math.min(TOC_RAIL_EDGE + range, Math.max(TOC_RAIL_EDGE, drag.startTop + dy))
    const nextRatio = range > 0 ? (nextTop - TOC_RAIL_EDGE) / range : 0
    tocRailRatioRef.current = nextRatio
    setTocRailRatio(nextRatio)
  }, [tocZoneHeight])

  const finishTocDrag = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!tocDraggingRef.current) return
    const moved = tocDragRef.current?.moved ?? false
    tocDraggingRef.current = false
    tocDragRef.current = null
    setTocDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (moved) {
      try { localStorage.setItem(TOC_RAIL_Y_KEY, String(tocRailRatioRef.current)) } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === TOC_PINNED_KEY) setTocPinned(e.newValue === 'true')
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  useEffect(() => {
    return () => {
      if (tocCloseTimerRef.current != null) clearTimeout(tocCloseTimerRef.current)
      if (tocOpenTimerRef.current != null) clearTimeout(tocOpenTimerRef.current)
    }
  }, [])

  // 有效的当前标题 = 点击锁定的 id 优先，否则跟随滚动联动算出的 activeTocId
  const effectiveActiveId = manualActiveId ?? activeTocId

  // 点击锁定释放：scroll-spy 已追上到同一标题、或用户手动滚动（滚轮/方向键/空格/PageUp-Down/Home-End）时，解除锁定。
  // 注意：不再用固定 2s 超时无条件释放——否则当 scroll-spy 尚未追上（或算出不同 id）时会回退到错误的高亮项。
  useEffect(() => {
    if (!manualActiveId) return
    if (activeTocId === manualActiveId) {
      setManualActiveId(null)
      return
    }
    const release = () => setManualActiveId(null)
    const onUserScrollIntent = (e: Event) => {
      if (e.type === 'wheel') {
        release()
        return
      }
      if (e.type === 'keydown') {
        const k = (e as KeyboardEvent).key
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(k)) release()
      }
    }
    window.addEventListener('wheel', onUserScrollIntent, { passive: true })
    window.addEventListener('keydown', onUserScrollIntent)
    return () => {
      window.removeEventListener('wheel', onUserScrollIntent)
      window.removeEventListener('keydown', onUserScrollIntent)
    }
  }, [manualActiveId, activeTocId])

  // 滚动联动：当前所在标题在目录列表内自动滚动到可见区域（仅当展开时）
  // 只调整目录列表自身的 scrollTop（scrollChildIntoView），不用 scrollIntoView：
  // 后者会连带滚动祖先链上任何存在滚动空间的容器（html/body、图谱页、内容区），
  // 表现为「整个页面往上漂移、底部露出空白」，且漂移无法用滚轮滚回。
  useEffect(() => {
    if (!effectiveActiveId || !tocExpanded || !tocListRef.current) return
    const activeEl = tocListRef.current.querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(effectiveActiveId)}"]`)
    if (!activeEl) return
    scrollChildIntoView(tocListRef.current, activeEl)
  }, [effectiveActiveId, tocExpanded])
  const containerRef = useRef<HTMLDivElement>(null)
  
  const tocItems = providedTocItems ?? []

  // 实测编辑器区高度与原生滚动条宽度：触发条/面板都放在滚动条内侧，避免压住滚动条。
  // 滚动条随内容高度出现或消失（overlay 滚动条宽度为 0），ResizeObserver 负责同步。
  useEffect(() => {
    if (!hasToc) return
    const zone = tocZoneRef.current
    if (!zone) return
    const measure = () => {
      setTocZoneHeight(zone.clientHeight)
      const scroller = containerRef.current?.querySelector<HTMLElement>('.tm-smart-editor-scroll')
      if (scroller) {
        const barWidth = Math.max(0, scroller.offsetWidth - scroller.clientWidth)
        setTocRightInset(barWidth + 10)
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(zone)
    const scroller = containerRef.current?.querySelector<HTMLElement>('.tm-smart-editor-scroll')
    if (scroller) observer.observe(scroller)
    return () => observer.disconnect()
  }, [hasToc])

  // 面板内容自然高度：收起态 visibility:hidden 仍有布局，可直接量 scrollHeight。
  // 展开时容器高度过渡到这个实测值，不做 max-height 那种「凭空撑开」的假动画。
  useEffect(() => {
    if (!hasToc) return
    const el = tocPanelContentRef.current
    if (!el) return
    const measure = () => setTocPanelHeight(el.scrollHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasToc])

  // 目录缩进相对"当前目录里最顶级标题"，而非绝对等级：
  // 例如全文只有 H4 时，H4 的缩进应为 0（作为顶级），而不是固定的 H4 缩进。
  const minTocLevel = tocItems.reduce(
    (min, item) => (item.level < min ? item.level : min),
    Infinity,
  )
  const tocBaseLevel = Number.isFinite(minTocLevel) ? minTocLevel : 1

  const currentDetailDocumentPath = activeDetailDocumentPath ?? ''
  const detailSidebarCollapsed = controlledDetailSidebarCollapsed ?? internalDetailSidebarCollapsed
  const detailSidebarTab = controlledDetailSidebarTab ?? internalDetailSidebarTab
  const effectiveFloating = detailSidebarFloating
  const showSidebarContent = !detailSidebarCollapsed || effectiveFloating
  const isSaving = saveStatus === 'saving'

  const isMaximized = useRightPanelStore((s) => s.rightPanelMaximized)
  const toggleMaximized = useRightPanelStore((s) => s.toggleRightPanelMaximized)

  // 锁定按知识库(kbPath)维度隔离：只取当前知识库自己的锁定状态，避免切库后串扰
  const selectedNodeIdRaw = useSelectedNodeId()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const kbPath = useGraphSession(activeTabId).kbPath
  const lockedNodeId = useDetailLockStore((s) => (kbPath ? (s.lockedByKb[kbPath] ?? null) : null))
  const toggleLock = useDetailLockStore((s) => s.toggleLock)
  const isLocked = lockedNodeId !== null
  const lockedNodeLabel = useGraphStore((s) => (lockedNodeId ? s.nodesMap.get(lockedNodeId)?.data.label ?? '' : ''))
  const selectedNodeLabel = useGraphStore((s) => (selectedNodeIdRaw ? s.nodesMap.get(selectedNodeIdRaw)?.data.label ?? '' : ''))
  // 详情区当前展示的节点标题：锁定时取锁定节点，否则取当前选中节点
  const detailNodeTitle = isLocked ? lockedNodeLabel : selectedNodeLabel

  const { isResizing: isSidebarResizing, handleMouseDown: handleSidebarResizeMouseDown } = useResizePanel({
    initialWidth: detailSidebarWidth,
    onWidthChange: (width) => {
      setDetailSidebarWidth(width)
      localStorage.setItem('topomind_detail_sidebar_width', String(width))
    },
    minWidth: 180,
    maxWidth: 360,
    direction: 'left',
  })

  const setDetailSidebarCollapsed = useCallback((collapsed: boolean) => {
    if (controlledDetailSidebarCollapsed === undefined) {
      setInternalDetailSidebarCollapsed(collapsed)
    }
    onDetailSidebarCollapsedChange?.(collapsed)
  }, [controlledDetailSidebarCollapsed, onDetailSidebarCollapsedChange])

  const setDetailSidebarTab = useCallback((tab: DetailSidebarTab) => {
    if (controlledDetailSidebarTab === undefined) {
      setInternalDetailSidebarTab(tab)
    }
    onDetailSidebarTabChange?.(tab)
  }, [controlledDetailSidebarTab, onDetailSidebarTabChange])

  const handleSave = useCallback(async () => {
    if (!isDirty || isSaving) return

    setSaveStatus('saving')
    setSaveError(null)
    try {
      await onSave()
      setLastSavedAt(Date.now())
      setSaveStatus('saved')
      logAction('Document:保存成功', 'DocumentWorkspaceLayout', { documentType, path: currentDetailDocumentPath })
    } catch (err: any) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : String(err))
      logAction('Document:保存失败', 'DocumentWorkspaceLayout', { error: err.message, documentType })
    }
  }, [isDirty, isSaving, onSave, documentType, currentDetailDocumentPath])

  const saveTimeoutRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (isDirty && saveStatus !== 'saving' && saveStatus !== 'error') {
      setSaveStatus('dirty')
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = window.setTimeout(() => {
        void handleSave()
      }, 1500)
    } else if (!isDirty && (saveStatus === 'dirty' || saveStatus === 'error')) {
      setSaveStatus(lastSavedAt ? 'saved' : 'idle')
      setSaveError(null)
    }
    return () => clearTimeout(saveTimeoutRef.current)
  }, [handleSave, isDirty, lastSavedAt, saveStatus])

  const handleTocJump = useCallback((item: TocItem) => {
    setManualActiveId(item.id)
    if (onTocItemClick) {
      onTocItemClick(item)
    }
  }, [onTocItemClick])

  const handleRailTabClick = useCallback((tab: DetailSidebarTab) => {
    if (!detailSidebarCollapsed && detailSidebarTab === tab) {
      setDetailSidebarCollapsed(true)
    } else {
      setDetailSidebarTab(tab)
      setDetailSidebarCollapsed(false)
    }
  }, [detailSidebarCollapsed, detailSidebarTab, setDetailSidebarCollapsed, setDetailSidebarTab])

  return (
    <div 
      ref={containerRef}
      className={`flex flex-col h-full border border-[var(--color-border)] rounded-lg overflow-hidden bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] shadow-[var(--shadow-sm)] ${documentType}`} 
    >
      <div className="flex flex-1 overflow-hidden relative">
        {documentType === 'detail' && !effectiveFloating && (
          <div className="w-9 shrink-0 border-r border-[var(--color-border-light)] bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] flex flex-col items-center gap-1 py-2 z-10">
            <button
              type="button"
              className={`w-7 h-7 rounded-lg border border-transparent text-[14px] font-semibold cursor-pointer transition-colors bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)] flex items-center justify-center`}
              onClick={toggleMaximized}
              title={isMaximized ? "还原面板" : "最大化面板"}
              aria-label={isMaximized ? "还原面板" : "最大化面板"}
            >
              {isMaximized ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
              )}
            </button>
            <button
              type="button"
              className={`w-7 h-7 rounded-lg border border-transparent cursor-pointer transition-colors flex items-center justify-center ${
                isLocked
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-[var(--shadow-inset-highlight)]'
                  : 'bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)]'
              }`}
              onClick={() => toggleLock(kbPath, selectedNodeIdRaw)}
              disabled={!isLocked && !selectedNodeIdRaw}
              title={isLocked ? `已锁定节点${lockedNodeLabel ? `：${lockedNodeLabel}` : ''}（点击解锁）` : '锁定当前节点（固定显示该节点内容，不受选中变化影响）'}
              aria-label={isLocked ? '解锁节点' : '锁定当前节点'}
            >
              {isLocked ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
              )}
            </button>
            <div className="w-5 h-px bg-[var(--color-border-light)] my-0.5" />
            <button
              type="button"
              className={`w-7 h-7 rounded-lg border border-transparent text-[12px] font-semibold cursor-pointer transition-colors ${!detailSidebarCollapsed && detailSidebarTab === 'documents' ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-[var(--shadow-inset-highlight)]' : 'bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)]'}`}
              onClick={() => handleRailTabClick('documents')}
              title="文档"
              aria-label="文档"
            >
              文
            </button>
            <button
              type="button"
              className={`w-7 h-7 rounded-lg border border-transparent text-[12px] font-semibold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${!detailSidebarCollapsed && detailSidebarTab === 'attachments' ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-[var(--shadow-inset-highlight)]' : 'bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)]'}`}
              onClick={() => handleRailTabClick('attachments')}
              disabled={!attachmentCardPath}
              title={!attachmentCardPath ? '当前环境暂不支持附件' : '附件'}
              aria-label="附件"
            >
              附
            </button>
          </div>
        )}
        {documentType === 'detail' && (
          <aside
            className={`w-[180px] shrink-0 flex flex-col bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] ${
              effectiveFloating 
                ? 'absolute left-[12px] top-[42px] bottom-[16px] z-30 shadow-[var(--shadow-popover)] border border-[var(--color-border-strong)] rounded-lg overflow-hidden'
                : detailSidebarCollapsed 
                  ? '!w-0 !bg-transparent overflow-hidden' 
                  : ''
            }`}
            style={!showSidebarContent ? undefined : { width: detailSidebarWidth }}
            onMouseEnter={() => onSidebarHoverChange?.(true)}
            onMouseLeave={() => onSidebarHoverChange?.(false)}
          >
            <div className="flex items-center justify-center gap-2 min-h-[58px] p-2.5 px-3 pb-2 border-b border-[var(--color-border-subtle)] bg-gradient-to-b from-[color-mix(in_srgb,var(--color-surface)_98%,transparent)] to-[var(--color-bg)] box-border">
              {showSidebarContent ? (
                <div className="w-full min-w-0 flex items-center justify-center h-[30px] text-center">
                  <span className="text-[14px] font-bold text-[var(--color-text-primary)] truncate">
                    {detailSidebarTab === 'documents' ? (detailNodeTitle || '文档') : '附件'}
                  </span>
                </div>
              ) : (
                <div className="w-full h-full" aria-hidden="true" />
              )}
            </div>
            {showSidebarContent && (
              <>
                <div className={`flex-1 min-h-0 flex flex-col ${detailSidebarTab === 'documents' ? '' : 'hidden'}`}>
                  {documentsTabContent}
                </div>
                <div className={`flex-1 min-h-0 flex flex-col ${detailSidebarTab === 'attachments' ? '' : 'hidden'}`} style={{ padding: 0 }}>
                  {attachmentCardPath && (
                    <AttachmentsTab
                      attachmentCardPath={attachmentCardPath}
                      insertTargetKey={currentDetailDocumentPath}
                    />
                  )}
                </div>
              </>
            )}
          </aside>
        )}
        {documentType === 'detail' && showSidebarContent && !effectiveFloating && (
          <div
            className={`w-[6px] h-full cursor-col-resize shrink-0 bg-[var(--color-bg)] relative select-none transition-colors duration-75 before:content-[""] before:absolute before:top-0 before:bottom-0 before:right-0 before:w-px before:bg-[var(--color-border-light)] before:transition-all before:duration-75 hover:before:bg-[var(--color-primary)] ${isSidebarResizing ? 'before:!bg-[var(--color-primary)]' : ''}`}
            onMouseDown={handleSidebarResizeMouseDown}
            title="拖拽调整侧栏宽度"
          />
        )}

        <div className={`flex flex-1 min-w-0 min-h-0 ${documentType === 'detail' ? 'flex-col' : ''}`}>
          {documentType === 'detail' && detailHeader && (
            <div className="shrink-0 border-b border-[var(--color-border-light)] bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)]">
              {detailHeader}
            </div>
          )}

          <div className="flex flex-1 min-w-0 min-h-0 relative">
            {editorContent && (
              <div className="flex-1 min-w-0 min-h-0 flex flex-col relative">
                {editorContent}
              </div>
            )}

            {/* 目录是「一个物体的两种形态」：同一个 morph 容器的宽/高/圆角/底色/边框连续过渡，
                触发条内容让位淡出，面板内容沿同一节奏从右往左揭开——看起来就是竖条长成了面板。
                唯一隐藏入口是鼠标移出；点击目录项、编辑器 focus 都不收起。
                容器贴右缘且落在原生滚动条内侧，Y 轴可拖动，位置按可用高度比例持久化。 */}
            {hasToc && (
              <div
                ref={tocZoneRef}
                className="absolute inset-y-0 right-0 z-20 pointer-events-none"
                style={{ width: 0 }}
              >
                <nav
                  id="topomind-toc-panel"
                  aria-label="文档目录"
                  className="absolute select-none touch-none border border-r-0 backdrop-blur-[2px]"
                  style={{
                    top: tocRailTop,
                    right: tocRightInset,
                    width: tocExpanded ? TOC_PANEL_WIDTH : TOC_RAIL_WIDTH,
                    height: tocExpanded ? tocShellHeight : TOC_RAIL_HEIGHT,
                    borderRadius: tocExpanded ? '14px 0 0 14px' : '8px 0 0 8px',
                    backgroundColor: tocExpanded
                      ? 'color-mix(in srgb, var(--color-surface) 92%, transparent)'
                      : 'color-mix(in srgb, var(--color-accent) 10%, var(--color-surface))',
                    borderColor: tocExpanded ? 'var(--color-border-light)' : 'var(--color-border-strong)',
                    pointerEvents: 'auto',
                    cursor: tocDragging ? 'grabbing' : undefined,
                    transition: [
                      `width ${TOC_MORPH_MS}ms ${TOC_MORPH_EASING}`,
                      `height ${TOC_MORPH_MS}ms ${TOC_MORPH_EASING}`,
                      `border-radius ${TOC_MORPH_MS}ms ${TOC_MORPH_EASING}`,
                      `background-color ${TOC_MORPH_MS}ms ease`,
                      `border-color ${TOC_MORPH_MS}ms ease`,
                    ].join(', '),
                  }}
                  onMouseEnter={handleTocEnter}
                  onMouseLeave={handleTocLeave}
                  onFocus={handleTocFocus}
                  onPointerDown={handleTocPointerDown}
                  onPointerMove={handleTocPointerMove}
                  onPointerUp={finishTocDrag}
                  onPointerCancel={finishTocDrag}
                  onLostPointerCapture={finishTocDrag}
                >
                  {/* 两个 token 阴影层数不同，直接 transition box-shadow 会跳变；改为交叉淡入 */}
                  <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ borderRadius: 'inherit', boxShadow: 'var(--shadow-sm)', opacity: tocExpanded ? 0 : 1, transition: `opacity ${TOC_MORPH_MS}ms ease` }} />
                  <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ borderRadius: 'inherit', boxShadow: 'var(--shadow-popover)', opacity: tocExpanded ? 1 : 0, transition: `opacity ${TOC_MORPH_MS}ms ease` }} />

                  {/* 收起态：整条就是拖拽把手；展开后彻底让位（视觉上不复存在） */}
                  <button
                    type="button"
                    data-toc-drag-handle
                    aria-label="文档目录（悬停展开，上下拖动调整位置）"
                    aria-expanded={tocExpanded}
                    aria-hidden={tocExpanded}
                    tabIndex={tocExpanded ? -1 : 0}
                    title="悬停展开目录 · 上下拖动可调整位置"
                    className={`absolute top-0 right-0 flex flex-col items-center justify-center gap-2 text-[var(--color-accent)] ${tocDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    style={{
                      width: TOC_RAIL_WIDTH,
                      height: TOC_RAIL_HEIGHT,
                      opacity: tocExpanded ? 0 : 1,
                      // 朝面板内部平移再淡出：像被「拉开融入」面板，而不是挂在右边原地缩小
                      transform: tocExpanded ? 'translateX(-26px) scale(0.9)' : 'none',
                      pointerEvents: tocExpanded ? 'none' : 'auto',
                      transition: `opacity 220ms ease-out ${tocExpanded ? 0 : 130}ms, transform ${TOC_MORPH_MS}ms ${TOC_MORPH_EASING} ${tocExpanded ? 0 : 130}ms`,
                    }}
                  >
                    <ListTree size={14} strokeWidth={2} aria-hidden="true" />
                    <span className="text-[10px] font-semibold leading-none tracking-[0.15em]" style={{ writingMode: 'vertical-rl' }}>目录</span>
                    <GripVertical size={12} className="opacity-60" aria-hidden="true" />
                  </button>

                  {/* 展开态：内容层与容器左缘同步左移，clip-path 同时裁掉超出容器的右/下部分。
                      于是文字从第一帧就贴着左缘、随板子一起「摊开」，不存在空板期。 */}
                  <div
                    ref={tocPanelContentRef}
                    className="absolute top-0 right-0 flex flex-col"
                    style={{
                      width: TOC_PANEL_WIDTH,
                      transform: `translateX(${tocClipRight}px)`,
                      clipPath: `inset(0 ${tocClipRight}px ${tocClipBottom}px 0 round 14px 0 0 14px)`,
                      // 展开时立即不透明（不留空板）；收起时先快速淡出，再让触发条浮现
                      opacity: tocExpanded ? 1 : 0,
                      visibility: tocExpanded ? 'visible' : 'hidden',
                      pointerEvents: tocExpanded ? 'auto' : 'none',
                      transition: `transform ${TOC_MORPH_MS}ms ${TOC_MORPH_EASING}, clip-path ${TOC_MORPH_MS}ms ${TOC_MORPH_EASING}, opacity ${tocExpanded ? 0 : 140}ms ease, visibility ${TOC_MORPH_MS}ms`,
                    }}
                  >
                    <div
                      className="shrink-0 flex items-center gap-1.5 w-full pl-2 pr-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] border-b border-[var(--color-border-light)]"
                      style={{
                        height: TOC_HEADER_HEIGHT,
                        boxSizing: 'border-box',
                      }}
                    >
                      <button
                        type="button"
                        onClick={toggleTocPinned}
                        aria-pressed={tocPinned}
                        aria-label={tocPinned ? '取消固定目录' : '固定目录'}
                        title={tocPinned ? '取消固定（恢复自动隐藏）' : '固定目录（一直显示）'}
                        className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-md cursor-pointer transition-colors duration-100 ${
                          tocPinned
                            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)]'
                        }`}
                      >
                        {tocPinned ? <PinOff size={12} aria-hidden="true" /> : <Pin size={12} aria-hidden="true" />}
                      </button>
                      <span className="flex-1 text-center select-none">目录</span>
                      <span className="shrink-0 text-[10px] font-normal tabular-nums opacity-80">{tocItems.length}</span>
                      <button
                        type="button"
                        data-toc-drag-handle
                        aria-label="上下拖动调整目录位置"
                        title="上下拖动调整位置"
                        className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-md text-[var(--color-text-muted)] opacity-60 hover:opacity-100 hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)] ${tocDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                      >
                        <GripVertical size={12} aria-hidden="true" />
                      </button>
                    </div>
                    <div
                      ref={tocListRef}
                      className="overflow-y-auto pl-2 pr-4 pb-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--color-text-muted)_34%,transparent)] [&::-webkit-scrollbar-thumb]:rounded-full"
                      style={{ maxHeight: tocListMaxHeight }}
                    >
                      {tocItems.map((item, index) => {
                        const isActive = item.id === effectiveActiveId
                        return (
                          <button
                            key={item.id}
                            type="button"
                            data-toc-id={item.id}
                            aria-current={isActive ? 'true' : undefined}
                            className={`block w-full text-left text-[12px] leading-[1.5] py-1 px-1.5 rounded-md border-none bg-transparent cursor-pointer truncate ${
                              isActive
                                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold'
                                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-selected-bg)] hover:text-[var(--color-accent)]'
                            }`}
                            style={{
                              paddingLeft: `${10 + (item.level - tocBaseLevel) * 12}px`,
                              // 只做极轻的依次落位，不另做整体淡入（内容已由 clip-path 显现）
                              transform: tocExpanded ? 'translateX(0)' : 'translateX(6px)',
                              transition: `transform 240ms ${TOC_MORPH_EASING}, background-color 75ms`,
                              transitionDelay: tocExpanded ? `${Math.min(index, 7) * 14}ms` : '0ms',
                            }}
                            onClick={() => handleTocJump(item)}
                            title={item.text}
                          >
                            {item.text}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </nav>
              </div>
            )}
          </div>

          {(statusBarContent || renderStatusBar) && (
            <div className="shrink-0 relative z-20">
              {statusBarContent}
              {renderStatusBar?.({ saveStatus: isDirty && saveStatus === 'saved' ? 'dirty' : saveStatus, lastSavedAt, saveError })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
