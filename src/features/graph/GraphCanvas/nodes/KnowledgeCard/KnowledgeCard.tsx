/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 *
 * @file components/GraphCanvas/nodes/KnowledgeCard/KnowledgeCard.tsx
 */
import { memo, useMemo, useState, useEffect, useRef, useCallback, lazy, Suspense, useSyncExternalStore, type CSSProperties } from 'react'
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
import { getTitleClampStyle } from './model/cardSizeLimits'
import { getKnowledgeCardStyles } from './utils/styles'
import QuickNodeToolbar from './QuickNodeToolbar'
import { useGraphContext } from '../../../../../contexts/GraphContext'
import { Link2 } from 'lucide-react'
import { useLinkedDocumentStore } from '../../../linkedDocumentStore'
import { tabStore } from '../../../../../stores/tabs/tabStore'
import { useActiveCanvasReadOnly } from '../../../../../stores/canvasReadOnlyStore'
import { detailTierForZoom } from '../../../../../domain/graph/zoomScale'
import {
  getCollapsedCount,
  subscribeCollapsedCount,
} from '../../model/lodCollapseStore'

interface KnowledgeCardProps extends NodeProps<KnowledgeNode> {
  resizing?: boolean
}

type AddEmojiEvent = CustomEvent<{ nodeId: string; position?: { x: number; y: number } }>
type AddEmojiListener = (event: AddEmojiEvent) => void

// 标题截断与 autoSize 的高度计算共用 MAX_TITLE_LINES（见 cardSizeLimits.ts），
// 纯常量提到模块级，避免每个节点每次渲染都新建样式对象。
const TITLE_CLAMP_STYLE = getTitleClampStyle()

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

/**
 * 【P1.75】折叠子树徽标：缩小镜头时主干仍留在画面上，这里告诉用户「底下收了多少」。
 * 计数由 useSemanticLod 广播到运行时 store，按 nodeId 精确订阅 —— 计数不变的
 * 卡片不会因缩放重渲染，也不需要在 nodes[].data 上加字段（7 处白名单 / 落盘全不碰）。
 * 挂在视觉壳内部，跟着 --tm-glyph-comp 一起补偿，远景屏幕尺寸保持可读。
 */
function LodCollapseBadge({ nodeId }: { nodeId: string }) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeCollapsedCount(nodeId, listener),
    [nodeId],
  )
  const getSnapshot = useCallback(() => getCollapsedCount(nodeId), [nodeId])
  const count = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (count <= 0) return null
  return (
    <div
      data-tm-lod-collapse-badge={nodeId}
      data-tm-lod-collapse-count={count}
      className="tm-lod-collapse-badge absolute -bottom-[7px] -left-[7px] z-[60] flex h-[15px] min-w-[15px] items-center justify-center rounded-full border border-[var(--color-border-light)] bg-[var(--color-surface)] px-[3px] text-[9px] font-semibold leading-none tabular-nums text-[var(--color-accent)] shadow-sm pointer-events-none select-none"
      title={`已收起 ${count} 个下级节点（缩小画布时自动折叠）`}
    >
      +{count}
    </div>
  )
}

function KnowledgeCard({ id, data, selected, dragging, width, height, resizing }: KnowledgeCardProps) {
  const { state, actions, refs } = useKnowledgeCardModel(id, data, selected, width, height, resizing)
  // 只读时把「加号连线手柄 / emoji 编辑」这类视觉编辑入口一并收起，
  // 只订阅布尔，缩放期间不会让所有卡片重渲染。
  const canvasReadOnly = useActiveCanvasReadOnly()
  // 语义层标记：与右槽位的「自身文档」纸片图标分离，不进格式刷。
  // 装饰的显示条件与数量统一来自 state.decorations —— 它同时是 autoSize 的测量输入，
  // 两边同源，不会再出现「渲染加了图标、测量忘了算宽度」。
  const {
    linkedDocumentCount,
    emojis,
    hasDetail,
    childCount,
    trailingWidth,
    horizontalPadding,
  } = state.decorations

  // 昂贵交互部件分三档挂载，用一次订阅拿到档位而不是 zoom 浮点值本身。
  // useStore 不传 equalityFn 时按 Object.is 比较：若 selector 返回 transform[2]，
  // 缩放期间每一个 zoom 变化都会让**所有可见节点**重渲染（大图缩放掉帧的主因）；
  // 返回 0/1/2 这种档位值后，只会在跨过阈值时重渲染一次。
  // 阈值由 zoomScale.detailTierForZoom 与「连续 detailAlpha」同源派生，
  // 不再各写一套 raw 阈值（旧 0.25/0.45 是重定基前的值，与新 0.65 基准已错位）。
  //   2 = 完整；1 = 低细节（去掉 resizer/工具栏/阴影）；0 = 极低（再去掉手柄加号）
  // 视觉装饰与标题的连续淡入淡出交给 CSS 变量 --tm-detail-alpha，不走 React。
  const zoomDetailLevel = useStore((s) => detailTierForZoom(s.transform[2]))
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
  // 「锚点壳」保持 React Flow 认定的节点盒：尺寸绝不随镜头变化，
  // Handle / NodeResizer / 拖拽命中 / measured 尺寸 / 落盘 width/height 全部留在这里。
  const cardStyle = useMemo(() => {
    const style: CSSProperties & Record<string, string | number> = {
      cursor: dragging ? 'grabbing' : 'default',
      '--tm-card-border': isConnectTarget
        ? 'var(--color-success)'
        : visuallySelected
          ? 'var(--color-accent)'
          : (data.nodeStyle?.borderColor ?? data.domainColor ?? nodeStyle.borderColor),
      width: nodeWidth,
      height: nodeHeight,
    }
    return style
  }, [
    data.domainColor,
    data.nodeStyle,
    dragging,
    isConnectTarget,
    nodeHeight,
    nodeStyle,
    nodeWidth,
    visuallySelected,
  ])

  // 「视觉壳」单独缩放：屏幕尺寸 = base × compensation × viewportZoom = base × glyphScale。
  // 变换只作用于这一层，Handle 是锚点壳的子元素（不是变换的祖先），
  // 因此 xyflow 用 getBoundingClientRect 差值算 handleBounds 时不会被污染。
  const glyphLayerStyle = useMemo<CSSProperties>(() => ({
    borderWidth: isConnectTarget ? 2 : nodeStyle.borderWidth,
    borderRadius,
    transform: 'scale(var(--tm-glyph-comp, 1))',
    transformOrigin: 'center center',
  }), [borderRadius, isConnectTarget, nodeStyle.borderWidth])

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
      if (canvasReadOnly) return
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
  }, [id, resolvePickerPosition, canvasReadOnly])

  const hasChildBadge = childCount > 0

  return (
    <div
      ref={cardRootRef}
      onPointerEnter={() => setIsHovered(true)}
      onPointerDownCapture={selectNode}
      onPointerLeave={() => setIsHovered(false)}
      data-tm-card-anchor="true"
      className="relative w-full h-full overflow-visible box-border"
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
      {!isLowDetail && !isMultiSelected && !canvasReadOnly && (
      <NodeResizer
        isVisible={showHoverControls && !canvasReadOnly}
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
          showHoverControls && !canvasReadOnly ? "opacity-100" : "opacity-0 pointer-events-none",
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

      {/* 视觉壳：唯一做字形缩放补偿的一层。锚点壳不缩放，Handle 是它的子元素，
          所以 xyflow 用 getBoundingClientRect 差值算 handleBounds 时不会被这层 transform 污染；
          measured 尺寸走 offsetWidth，外层宽高恒定 → 落盘尺寸、fitView、框选全部不变。 */}
      <div
        data-tm-glyph-layer="true"
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
        style={glyphLayerStyle}
      >
      <div className="flex flex-1 flex-col items-center justify-center overflow-hidden pointer-events-none min-w-0 min-h-0" style={{ borderRadius }}>
        {/* Header 层 */}
        <div className="relative flex w-full items-center justify-center shrink-0 min-h-0 h-full" style={headerStyle}>
          <div
            className={cn("flex w-full rounded-md transition-colors duration-75 items-center justify-center h-full", titleEditing && "bg-[color-mix(in_srgb,var(--color-surface)_20%,transparent)] shadow-[inset_0_0_0_1px_var(--color-border-light)] focus-within:bg-[color-mix(in_srgb,var(--color-surface)_40%,transparent)] focus-within:shadow-[inset_0_0_0_1px_var(--color-border),0_0_0_2px_var(--color-accent-soft)]")}
            style={{
              ...titleFieldStyle,
              paddingLeft: `${horizontalPadding}px`,
              paddingRight: `${Math.max(horizontalPadding, trailingWidth)}px`,
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
            ) : (
              // 【语义缩放】标题始终渲染：内层视觉壳按 --tm-glyph-comp 补偿后，
              // 30% 镜头下屏幕字号比 100% 还大（远景字形放大），不再退化成纯色块。
              // 装饰的连续淡入淡出由 --tm-detail-alpha 驱动（不走 React），
              // 于是放大时细节「从缝隙里长出来」，缩小时平滑缩回去。
              <div
                className="w-full h-full break-words whitespace-pre-wrap pointer-events-auto select-none flex items-center justify-center gap-[3px] min-w-0"
                onDoubleClick={contentInteractionsEnabled ? startTitleEdit : undefined}
                title={contentInteractionsEnabled ? '双击编辑标题' : undefined}
              >
                {linkedDocumentCount > 0 && (
                  <button
                    type="button"
                    className="tm-card-detail nodrag nowheel flex items-center gap-[1px] shrink-0 px-[2px] rounded text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] leading-none cursor-pointer border-none bg-transparent"
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
                {emojis.length > 0 && (
                  <div className="tm-card-detail flex items-center gap-[2px] shrink-0 pr-[2px]" onDoubleClick={e => e.stopPropagation()}>
                    {emojis.map((emoji, index) => (
                      <div 
                        key={`${index}-${emoji}`}
                        className="inline-flex items-center justify-center cursor-pointer rounded-md px-[2px] transition-colors leading-none hover:bg-black/[0.045] dark:hover:bg-white/[0.06]"
                        style={{ fontSize: '1.08em', lineHeight: 1, transform: 'translateY(0.02em)' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (canvasReadOnly) return
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
                {/* 最多 4 行 + 省略号。截断样式与 autoSize 的高度上限同源于
                    cardSizeLimits.MAX_TITLE_LINES：DOM 真实截断，测量同步封顶，
                    不会再出现「算出 4 行、DOM 渲染 6 行被裁掉」的失配。
                    被省略的内容仍可通过 title 查看完整文本。 */}
                <span
                  className="min-w-0 flex-1 text-center leading-[inherit] tracking-[-0.005em]"
                  style={TITLE_CLAMP_STYLE}
                  title={data.label}
                >{data.label}</span>
              </div>
            )}
          </div>

          {/* 右槽位：常驻但由 --tm-detail-alpha 连续淡出；远景 --tm-detail-hit=none，
              淡出的徽章不吃鼠标事件。占位宽度始终由 decorations.trailingWidth 保留，
              卡片宽度不会因缩放抖动，测量侧与渲染侧仍然同源。 */}
          <div className="tm-card-detail absolute right-[6px] top-1/2 z-50 flex -translate-y-1/2 items-center justify-end gap-[2px] shrink-0">
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
                title={`点击进入包含 ${childCount} 个子节点的画布`}
                style={badgeStyle}
              >
                {childCount}
              </div>
            )}
          </div>
        </div>
      </div>
        <LodCollapseBadge nodeId={id} />
      </div>

      {emojiPickerPosition && !canvasReadOnly && typeof document !== 'undefined' && createPortal(
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
                  const newEmojis = [...emojis]
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
              const currentEmojis = [...emojis]
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
