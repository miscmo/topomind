import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { ChevronLeft, Pin, PinOff } from 'lucide-react'
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
// 鼠标从贴边触发条移到滑出面板之间可能短暂离开命中区，延迟关闭避免面板闪烁。
const TOC_CLOSE_DELAY_MS = 150

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

  // 目录默认收起成贴右缘的细条：hover 展开、移开自动隐藏；左上角图钉可固定常驻。
  // 面板吸附右缘、位置固定（不再支持自由拖动），保证触发区位置可预测。
  const [tocPinned, setTocPinned] = useState<boolean>(() => {
    try { return localStorage.getItem(TOC_PINNED_KEY) === 'true' } catch { return false }
  })
  const [tocHovered, setTocHovered] = useState(false)
  const tocExpanded = tocPinned || tocHovered
  const tocCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tocListRef = useRef<HTMLDivElement>(null)

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
  const handleTocEnter = useCallback(() => {
    cancelTocClose()
    setTocHovered(true)
  }, [cancelTocClose])
  const handleTocLeave = useCallback(() => {
    cancelTocClose()
    // 细条与面板之间有一帧空隙 / 滑出动画，延迟关闭接住这次转移，避免闪一下
    tocCloseTimerRef.current = setTimeout(() => setTocHovered(false), TOC_CLOSE_DELAY_MS)
  }, [cancelTocClose])

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

            {/* 目录默认只留贴右缘的 10px 细条，hover 才滑出面板、移开自动隐藏；
                左上角图钉可固定常驻。细条与面板共用同一个「延迟关闭」状态，
                避免鼠标在两者之间转移（或滑出动画那一帧）时面板闪烁。
                visibility 参与过渡：收起动画播完才真正隐藏，隐藏态不可聚焦、不会被读屏读到。 */}
            {tocItems.length > 0 && (
              <div
                className="absolute z-20"
                style={{ top: 12, right: 0, width: 10, height: 72, pointerEvents: 'none' }}
              >
                <button
                  type="button"
                  aria-label="展开文档目录"
                  aria-expanded={tocExpanded}
                  aria-controls="topomind-toc-panel"
                  title="悬停展开目录"
                  className="absolute right-0 top-0 flex items-center justify-center rounded-l-md border border-r-0 border-[var(--color-border-light)] bg-[color-mix(in_srgb,var(--color-surface)_85%,transparent)] text-[var(--color-text-muted)] cursor-pointer transition-colors duration-150 hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)]"
                  style={{ width: 10, height: 72, pointerEvents: 'auto', opacity: tocExpanded ? 1 : 0.6 }}
                  onMouseEnter={handleTocEnter}
                  onMouseLeave={handleTocLeave}
                  onFocus={handleTocEnter}
                  onBlur={handleTocLeave}
                >
                  <ChevronLeft size={10} strokeWidth={2.5} aria-hidden="true" />
                </button>

                <nav
                  id="topomind-toc-panel"
                  aria-label="文档目录"
                  className="absolute top-0 rounded-l-xl border border-r-0 border-[var(--color-border-light)] bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] backdrop-blur-[2px] shadow-[var(--shadow-popover)]"
                  style={{
                    right: 10,
                    width: 240,
                    transform: tocExpanded ? 'translateX(0)' : 'translateX(calc(100% + 12px))',
                    opacity: tocExpanded ? 1 : 0,
                    visibility: tocExpanded ? 'visible' : 'hidden',
                    pointerEvents: tocExpanded ? 'auto' : 'none',
                    transition: 'transform 200ms ease-out, opacity 200ms ease-out, visibility 200ms',
                  }}
                  onMouseEnter={handleTocEnter}
                  onMouseLeave={handleTocLeave}
                  onFocus={handleTocEnter}
                  onBlur={handleTocLeave}
                >
                  <div className="flex items-center gap-1.5 w-full px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] border-b border-[var(--color-border-light)]">
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
                    <span className="shrink-0 text-[10px] font-normal opacity-60">{tocItems.length}</span>
                  </div>
                  <div ref={tocListRef} className="max-h-[calc(58vh-2.5rem)] overflow-y-auto px-2 pb-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--color-text-muted)_34%,transparent)] [&::-webkit-scrollbar-thumb]:rounded-full">
                    {tocItems.map(item => {
                      const isActive = item.id === effectiveActiveId
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-toc-id={item.id}
                          aria-current={isActive ? 'true' : undefined}
                          className={`block w-full text-left text-[12px] leading-[1.5] py-1 px-1.5 rounded-md border-none bg-transparent cursor-pointer transition-colors duration-75 truncate ${
                            isActive
                              ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold'
                              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-selected-bg)] hover:text-[var(--color-accent)]'
                          }`}
                          style={{ paddingLeft: `${10 + (item.level - tocBaseLevel) * 12}px` }}
                          onClick={() => handleTocJump(item)}
                          title={item.text}
                        >
                          {item.text}
                        </button>
                      )
                    })}
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
