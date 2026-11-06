/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 *
 * @file components/GraphCanvas/nodes/KnowledgeCard/KnowledgeCard.tsx
 */
import { memo, useMemo, useState, useEffect, useRef, useCallback, lazy, Suspense, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Handle, NodeResizer, Position, type NodeProps, useStore } from '@xyflow/react'
const LazyEmojiPicker = lazy(async () => {
  const [pickerModule, dataModule, i18nModule] = await Promise.all([
    import('@emoji-mart/react'),
    import('@emoji-mart/data'),
    import('@emoji-mart/data/i18n/zh.json'),
  ])
  return {
    default: (props: Record<string, unknown>) => {
      const Picker = pickerModule.default
      return <Picker {...props} data={dataModule.default} i18n={i18nModule.default} />
    },
  }
})
import type { KnowledgeNode } from '../../../../../types'
import { cn } from '@/lib/utils'
import { useKnowledgeCardModel } from './model/useKnowledgeCardModel'
import { getKnowledgeCardStyles } from './utils/styles'
import QuickNodeToolbar from './QuickNodeToolbar'
import { useGraphContext } from '../../../../../contexts/GraphContext'
import { Link2 } from 'lucide-react'
import { useLinkedDocumentStore } from '../../../linkedDocumentStore'
import { tabStore } from '../../../../../stores/tabs/tabStore'

interface KnowledgeCardProps extends NodeProps<KnowledgeNode> {
  resizing?: boolean
}

type AddEmojiEvent = CustomEvent<{ nodeId: string; position?: { x: number; y: number } }>
type AddEmojiListener = (event: AddEmojiEvent) => void

const addEmojiListeners = new Map<string, AddEmojiListener>()

function dispatchAddEmojiEvent(event: Event) {
  const customEvent = event as AddEmojiEvent
  const nodeId = customEvent.detail?.nodeId
  if (!nodeId) return
  addEmojiListeners.get(nodeId)?.(customEvent)
}

function subscribeToAddEmoji(nodeId: string, listener: AddEmojiListener) {
  addEmojiListeners.set(nodeId, listener)
  if (addEmojiListeners.size === 1 && typeof document !== 'undefined') {
    document.addEventListener('topomind:add-emoji', dispatchAddEmojiEvent)
  }

  return () => {
    if (addEmojiListeners.get(nodeId) !== listener) return
    addEmojiListeners.delete(nodeId)
    if (addEmojiListeners.size === 0 && typeof document !== 'undefined') {
      document.removeEventListener('topomind:add-emoji', dispatchAddEmojiEvent)
    }
  }
}

function KnowledgeCard({ id, data, selected, dragging, width, height, resizing }: KnowledgeCardProps) {
  const { state, actions, refs } = useKnowledgeCardModel(id, data, selected, width, height, resizing)
  // 语义层标记：与右槽位的「自身文档」纸片图标分离，不进格式刷。
  const linkedDocumentCount = data.linkedDocuments?.length ?? 0

  // 细节分三档，用一次订阅拿到档位而不是 zoom 浮点值本身。
  // useStore 不传 equalityFn 时按 Object.is 比较：若 selector 返回 transform[2]，
  // 缩放期间每一个 zoom 变化都会让**所有可见节点**重渲染（大图缩放掉帧的主因）；
  // 返回 0/1/2 这种档位值后，只会在跨过阈值时重渲染一次。
  //   2 = 完整；1 = 低细节（去掉 resizer/工具栏/阴影）；0 = 极低（再去掉 emoji/徽章/标题文字）
  const zoomDetailLevel = useStore((s) => {
    const zoom = s.transform[2]
    if (zoom < 0.25) return 0
    if (zoom < 0.45) return 1
    return 2
  })
  const {
    titleEditing,
    showHoverControls,
    showResizeLabel,
    resizeLabel,
    visuallySelected,
    visuallyHovered,
    isConnectTarget,
    isConnectSource,
    contentInteractionsEnabled,
    isMultiSelected,
    zoomDegradedDuringZoom,
    nodeStyle,
    nodeWidth,
    nodeHeight,
    nodeSizeLimits,
    nodeBadgeSize,
    widthMode,
    showQuickToolbar,
    accessoryWidth,
    isFormatPainterActive,
  } = state

  // 缩放期间强制降到最低档：缩放会让大批节点在视口边界反复进出
  // （实测 2~3 秒可达 1600+ 次 mount/unmount），按最低档渲染能把每次挂载的成本
  // 从 ~12 个 DOM 元素压到 ~2 个。只在"开始/结束缩放"各翻转一次，不是每帧变化；
  // 且只有大房间才降级，小房间不牺牲缩放时的可读性。
  const detailLevel = zoomDegradedDuringZoom ? 0 : zoomDetailLevel
  const isMinimalDetail = detailLevel === 0
  const isLowDetail = detailLevel < 2

  const {
    setIsHovered,
    updateResizePreview,
    hideResizePreviewSoon,
    handleDrillDown,
    confirmTitleEdit,
    cancelTitleEdit,
    startTitleEdit,
    setSizingMode,
    updateHeaderBackgroundColor,
    updateHeaderFontSize,
    toggleBold,
    toggleItalic,
    toggleFormatPainter,
    selectNode
  } = actions

  const { updateNodeEmojis } = useGraphContext()
  const [editingEmojiIndex, setEditingEmojiIndex] = useState<number | null>(null)
  const [emojiPickerPosition, setEmojiPickerPosition] = useState<{ x: number, y: number } | null>(null)
  const cardRootRef = useRef<HTMLDivElement>(null)

  const { titleInputRef, titleDraftRef } = refs

  const {
    borderRadius,
    badgeStyle,
    docIconStyle,
    docIconSvgStyle,
    headerStyle,
    titleFieldStyle
  } = useMemo(() => getKnowledgeCardStyles(nodeStyle, nodeBadgeSize), [nodeStyle, nodeBadgeSize])

  // 边框色优先级：节点显式自定义 > 域色(domainColor) > 默认样式。
  // 只写 CSS 变量、不直接写 border-color：inline 的 border-color 会压过 hover/active 变体类，
  // 让自定义过颜色的节点彻底失去悬停反馈（历史 bug）。
  const cardStyle = useMemo(() => {
    const style: CSSProperties & Record<string, string | number> = {
      cursor: dragging ? 'grabbing' : 'default',
      '--tm-card-border': isConnectTarget
        ? 'var(--color-success)'
        : visuallySelected
          ? 'var(--color-accent)'
          : (data.nodeStyle?.borderColor ?? data.domainColor ?? nodeStyle.borderColor),
      borderWidth: isConnectTarget ? 2 : nodeStyle.borderWidth,
      borderRadius,
      width: nodeWidth,
      height: nodeHeight,
    }
    return style
  }, [
    borderRadius,
    data.domainColor,
    data.nodeStyle,
    dragging,
    isConnectTarget,
    nodeHeight,
    nodeStyle,
    nodeWidth,
    visuallySelected,
  ])

  const resolvePickerPosition = useCallback((anchorRect: DOMRect, preferredPlacement: 'node' | 'emoji' = 'node') => {
    const PICKER_WIDTH = 352
    const PICKER_HEIGHT = 435
    const GAP = 6
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let x = preferredPlacement === 'emoji'
      ? anchorRect.left - 12
      : anchorRect.right + GAP
    let y = preferredPlacement === 'emoji'
      ? anchorRect.bottom + GAP
      : anchorRect.top - 6

    if (preferredPlacement === 'node' && x + PICKER_WIDTH > viewportWidth - GAP) {
      x = anchorRect.left - PICKER_WIDTH - GAP
    }
    if (preferredPlacement === 'emoji' && x + PICKER_WIDTH > viewportWidth - GAP) {
      x = Math.max(GAP, viewportWidth - PICKER_WIDTH - GAP)
    }

    if (x < GAP) x = GAP
    if (x + PICKER_WIDTH > viewportWidth - GAP) {
      x = Math.max(GAP, viewportWidth - PICKER_WIDTH - GAP)
    }

    if (y + PICKER_HEIGHT > viewportHeight - GAP) {
      y = anchorRect.top - PICKER_HEIGHT - GAP
    }
    if (y < GAP) {
      y = Math.max(GAP, Math.min(anchorRect.bottom + GAP, viewportHeight - PICKER_HEIGHT - GAP))
    }

    return {
      x,
      y,
    }
  }, [])

  useEffect(() => {
    let emojiTimer: ReturnType<typeof setTimeout> | null = null
    const handleAddEmojiEvent: AddEmojiListener = (_e) => {
      emojiTimer = setTimeout(() => {
        const cardRect = cardRootRef.current?.getBoundingClientRect()
        if (!cardRect) return
        setEmojiPickerPosition(resolvePickerPosition(cardRect, 'node'))
        setEditingEmojiIndex(null) // null means append new emoji
      }, 10)
    }
    const unsubscribe = subscribeToAddEmoji(id, handleAddEmojiEvent)
    return () => {
      unsubscribe()
      if (emojiTimer) clearTimeout(emojiTimer)
    }
  }, [id, resolvePickerPosition])

  const hasChildBadge = data.childCount !== undefined && data.childCount > 0
  const hasDetail = data.hasDetail === true

  return (
    <div
      ref={cardRootRef}
      onPointerEnter={() => setIsHovered(true)}
      onPointerDownCapture={selectNode}
      onPointerLeave={() => setIsHovered(false)}
      className={cn(
        "relative flex items-stretch justify-stretch overflow-visible rounded-lg border border-[var(--tm-card-border)] bg-[var(--color-surface)] w-full h-full box-border",
        !isLowDetail && "shadow-sm transition-opacity duration-75 active:border-[var(--color-accent)] active:shadow-[0_0_0_1px_var(--color-accent-soft)]",
        selected && "shadow-[0_0_0_1px_var(--color-accent)] z-10",
        isConnectTarget && "border-2 border-[var(--color-success)] shadow-[0_0_0_1px_var(--color-success)] !border-[var(--color-success)] z-10",
        // hover/active 必须用变体类：inline style 的 border-color 优先级高于任何非 !important 的 class，
        // 之前把颜色写进 inline 导致自定义过颜色的节点完全没有悬停反馈。
        visuallyHovered && !visuallySelected && !isConnectTarget && "hover:border-[var(--color-border-strong)]",
        dragging && "opacity-90"
      )}
      style={cardStyle}
    >
      {showQuickToolbar && !dragging && !isLowDetail && (
        <QuickNodeToolbar
          autoWidth={widthMode === 'auto'}
          fontSize={nodeStyle.headerFontSize ?? 11}
          backgroundColor={nodeStyle.headerBackgroundColor ?? 'var(--color-bg-muted)'}
          bold={nodeStyle.headerFontWeight === 'bold'}
          italic={nodeStyle.headerFontStyle === 'italic'}
          isFormatPainterActive={isFormatPainterActive}
          onToggleAutoWidth={() => { void setSizingMode(widthMode !== 'auto') }}
          onBackgroundColorChange={(value) => { void updateHeaderBackgroundColor(value) }}
          onFontSizeChange={(value) => { void updateHeaderFontSize(value) }}
          onToggleBold={() => { void toggleBold() }}
          onToggleItalic={() => { void toggleItalic() }}
          onToggleFormatPainter={() => { void toggleFormatPainter() }}
        />
      )}

      {/* 多选时整组缩放手柄都不渲染：
          ① 多选本来就不支持单个节点 resize，手柄纯属干扰；
          ② NodeResizer 是 8 个句柄 + 4 条线，框选时每多选中一个节点就要挂载一整组，
             选中几十上百个节点时这笔 DOM / reconciliation 开销相当可观。 */}
      {!isLowDetail && !isMultiSelected && (
      <NodeResizer
        isVisible={showHoverControls}
        minWidth={nodeSizeLimits.minWidth}
        minHeight={nodeSizeLimits.minHeight}
        maxWidth={nodeSizeLimits.maxWidth}
        maxHeight={nodeSizeLimits.maxHeight}
        handleClassName="w-2 h-2 bg-[var(--color-surface)] border-[1.5px] border-[var(--color-accent)] rounded-sm shadow-sm z-30"
        lineClassName="border-transparent z-20"
        onResizeStart={(_, params) => updateResizePreview(params)}
        onResize={(_, params) => updateResizePreview(params)}
        onResizeEnd={(_, params) => hideResizePreviewSoon(params)}
      />
      )}

      {showResizeLabel && !isLowDetail && (
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-0.5 text-xs text-[var(--color-text-muted)] shadow-sm pointer-events-none whitespace-nowrap z-50">
          {resizeLabel}
        </div>
      )}

      <Handle type="target" position={Position.Left} className="w-0 h-0 border-none opacity-0" isConnectable={false} />
      <Handle 
        type="source" 
        position={Position.Right} 
        className={cn(
          "w-5 h-5 border-[1.5px] border-accent rounded-full shadow-[0_2px_4px_var(--color-accent-soft)] !-right-[18px] z-30 flex items-center justify-center transition-all duration-75 cursor-crosshair",
          showHoverControls ? "opacity-100" : "opacity-0 pointer-events-none",
          isConnectSource
            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] ring-2 ring-[var(--color-accent-soft)]"
            : "bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)]"
        )}
      >
        {/* Handle 元素本身必须保留：React Flow 靠它测量端点位置来画连线，
            去掉会让边画不出来；但内部的加号图标在极低缩放下纯属浪费。 */}
        {!isMinimalDetail && (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
        )}
      </Handle>

      <div className="flex flex-1 flex-col items-center justify-center overflow-hidden pointer-events-none min-w-0 min-h-0" style={{ borderRadius }}>
        {/* Header 层 */}
        <div className="relative flex w-full items-center justify-center shrink-0 min-h-0 h-full" style={headerStyle}>
          <div
            className={cn("flex w-full rounded-md transition-colors duration-75 items-center justify-center h-full", titleEditing && "bg-[color-mix(in_srgb,var(--color-surface)_20%,transparent)] shadow-[inset_0_0_0_1px_var(--color-border-light)] focus-within:bg-[color-mix(in_srgb,var(--color-surface)_40%,transparent)] focus-within:shadow-[inset_0_0_0_1px_var(--color-border),0_0_0_2px_var(--color-accent-soft)]")}
            style={{
              ...titleFieldStyle,
              paddingLeft: '8px',
              paddingRight: `${Math.max(8, accessoryWidth)}px`,
            }}
          >
            {titleEditing ? (
              <input
                ref={titleInputRef}
                className="w-full h-full px-[3px] py-[1px] border-none rounded-none bg-transparent text-inherit font-inherit leading-inherit outline-none box-border pointer-events-auto shadow-none caret-current transition-colors duration-75 nodrag nowheel text-center"
                defaultValue={titleDraftRef.current}
                onChange={(event) => { titleDraftRef.current = event.target.value }}
                onBlur={() => void confirmTitleEdit({ restoreFocus: false })}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void confirmTitleEdit({ restoreFocus: true })
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelTitleEdit({ restoreFocus: true })
                  }
                }}
              />
            ) : isMinimalDetail ? null : (
              // 极低缩放（<0.25）下标题字号不到 3px，本就不可读，
              // 但浏览器仍要为它做一次文本排版；直接省掉，卡片退化成纯色块。
              <div
                className="w-full h-full break-words whitespace-pre-wrap pointer-events-auto select-none flex items-center justify-center gap-[3px] min-w-0"
                onDoubleClick={contentInteractionsEnabled ? startTitleEdit : undefined}
                title={contentInteractionsEnabled ? '双击编辑标题' : undefined}
              >
                {!isMinimalDetail && linkedDocumentCount > 0 && (
                  <button
                    type="button"
                    className="nodrag nowheel flex items-center gap-[1px] shrink-0 px-[2px] rounded text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] leading-none cursor-pointer border-none bg-transparent"
                    style={{ fontSize: '0.92em' }}
                    title={`${linkedDocumentCount} 篇关联文档 · 点击在右栏查看`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      useLinkedDocumentStore.getState().requestLinkedView(id, tabStore.getState().activeTabId ?? '')
                    }}
                  >
                    <Link2 style={{ width: '1em', height: '1em' }} />
                    {linkedDocumentCount > 1 && <span className="font-semibold" style={{ fontSize: '0.82em' }}>{linkedDocumentCount}</span>}
                  </button>
                )}
                {!isMinimalDetail && data.emojis && data.emojis.length > 0 && (
                  <div className="flex items-center gap-[2px] shrink-0 pr-[2px]" onDoubleClick={e => e.stopPropagation()}>
                    {data.emojis.map((emoji, index) => (
                      <div 
                        key={`${index}-${emoji}`}
                        className="inline-flex items-center justify-center cursor-pointer rounded-md px-[2px] transition-colors leading-none hover:bg-black/[0.045] dark:hover:bg-white/[0.06]"
                        style={{ fontSize: '1.08em', lineHeight: 1, transform: 'translateY(0.02em)' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          const rect = e.currentTarget.getBoundingClientRect()
                          setEmojiPickerPosition(resolvePickerPosition(rect, 'emoji'))
                          setEditingEmojiIndex(index)
                        }}
                      >
                        {emoji}
                      </div>
                    ))}
                  </div>
                )}
                <span className="min-w-0 flex-1 text-center leading-[inherit] tracking-[-0.005em]">{data.label}</span>
              </div>
            )}
          </div>

          {/* 右槽位：极低缩放下整块不渲染（此时徽章/图标都点不准，留着只是白付 DOM 成本）。
              注意右侧内边距仍由 accessoryWidth 保留，卡片宽度不会因此抖动。 */}
          {!isMinimalDetail && (
          <div className="absolute right-[6px] top-1/2 z-50 flex -translate-y-1/2 items-center justify-end gap-[2px] shrink-0 pointer-events-auto">
            {hasDetail && (
              <div className="flex items-center justify-center shrink-0 text-[var(--color-text-muted)] leading-none" title="包含详情" style={docIconStyle}>
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={docIconSvgStyle}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
              </div>
            )}
            {hasChildBadge && (
              <div
                className="flex items-center justify-center bg-[var(--color-accent)] text-[var(--color-text-inverse)] cursor-pointer transition-colors duration-75 hover:bg-[var(--color-accent-hover)] font-bold select-none nodrag nowheel"
                onPointerDownCapture={(e) => {
                  e.stopPropagation()
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  handleDrillDown(e)
                }}
                title={`点击进入包含 ${data.childCount} 个子节点的画布`}
                style={badgeStyle}
              >
                {data.childCount}
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {emojiPickerPosition && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed z-[1000] shadow-xl border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] overflow-hidden"
          style={{ left: emojiPickerPosition.x, top: emojiPickerPosition.y }}
          onPointerDown={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
        >
          {editingEmojiIndex !== null && (
            <div className="w-full p-2 border-b border-[var(--color-border-light)] bg-[var(--color-hover-bg)] relative z-10">
              <button
                className="w-full py-1.5 text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] rounded transition-colors flex items-center justify-center gap-1 cursor-pointer"
                onClick={() => {
                  const newEmojis = [...(data.emojis || [])]
                  newEmojis.splice(editingEmojiIndex, 1)
                  void updateNodeEmojis(id, newEmojis.length > 0 ? newEmojis : undefined)
                  setEmojiPickerPosition(null)
                  setEditingEmojiIndex(null)
                }}
              >
                移除此表情
              </button>
            </div>
          )}
          <Suspense fallback={<div className="w-[352px] h-[360px] grid place-items-center text-sm text-[var(--color-text-muted)]">正在加载表情选择器…</div>}>
          <LazyEmojiPicker
            onEmojiSelect={(emoji: { native: string }) => {
              const currentEmojis = data.emojis || []
              const newEmojis = [...currentEmojis]
              if (editingEmojiIndex !== null) {
                newEmojis[editingEmojiIndex] = emoji.native
              } else {
                newEmojis.push(emoji.native)
              }
              void updateNodeEmojis(id, newEmojis)
              setEmojiPickerPosition(null)
              setEditingEmojiIndex(null)
            }}
            onClickOutside={(e: MouseEvent) => {
              const target = e.target as Element
              if (target.closest?.('[data-context-menu-item]')) return
              setEmojiPickerPosition(null)
              setEditingEmojiIndex(null)
            }}
            theme="auto"
          />
          </Suspense>
        </div>,
        document.body
      )}
    </div>
  )
}

export default memo(KnowledgeCard)
