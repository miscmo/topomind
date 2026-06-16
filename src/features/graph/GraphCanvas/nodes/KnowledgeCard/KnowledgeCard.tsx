/**
 * TopoMind 知识卡片节点
 * React Flow 自定义节点
 *
 * @file components/GraphCanvas/nodes/KnowledgeCard/KnowledgeCard.tsx
 */
import { memo } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import type { KnowledgeNode } from '../../../../../types'
import { cn } from '@/lib/utils'
import { useKnowledgeCardModel } from './model/useKnowledgeCardModel'
import { getKnowledgeCardStyles } from './utils/styles'
import QuickNodeToolbar from './QuickNodeToolbar'

interface KnowledgeCardProps extends NodeProps<KnowledgeNode> {
  resizing?: boolean
}

function KnowledgeCard({ id, data, selected, dragging, width, height, resizing }: KnowledgeCardProps) {
  const { state, actions, refs } = useKnowledgeCardModel(id, data, selected, width, height, resizing)
  const {
    isHovered,
    titleEditing,
    titleDraft,
    showHoverControls,
    showResizeLabel,
    resizeLabel,
    visuallySelected,
    visuallyHovered,
    isConnectTarget,
    isConnectSource,
    contentInteractionsEnabled,
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

  const {
    setIsHovered,
    setTitleDraft,
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

  const { titleInputRef } = refs

  const {
    borderRadius,
    badgeStyle,
    docIconStyle,
    docIconSvgStyle,
    headerStyle,
    titleFieldStyle
  } = getKnowledgeCardStyles(nodeStyle, nodeBadgeSize)

  const hasChildBadge = data.childCount !== undefined && data.childCount > 0
  const hasDetail = data.hasDetail === true

  return (
    <div
      onPointerEnter={() => setIsHovered(true)}
      onPointerDownCapture={selectNode}
      onPointerLeave={() => setIsHovered(false)}
      className={cn(
        "relative flex items-stretch justify-stretch overflow-visible rounded-lg border bg-[var(--color-surface)] shadow-sm transition-opacity duration-75 active:border-[var(--color-accent)] active:shadow-[0_0_0_1px_var(--color-accent-soft)] w-full h-full box-border",
        selected && "border-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent)] z-10",
        isConnectTarget && "border-2 border-[var(--color-success)] shadow-[0_0_0_1px_var(--color-success)] !border-[var(--color-success)] z-10",
        visuallyHovered && !visuallySelected && !isConnectTarget && "border-[var(--color-border-strong)]",
        dragging && "opacity-90"
      )}
      style={{
        cursor: dragging ? 'grabbing' : 'default',
        borderColor: visuallySelected ? undefined : data.domainColor ?? nodeStyle.borderColor,
        borderWidth: isConnectTarget ? 2 : nodeStyle.borderWidth,
        borderRadius,
        width: nodeWidth,
        height: nodeHeight,
      }}
    >
      {showQuickToolbar && !dragging && (
        <QuickNodeToolbar
          autoWidth={widthMode === 'auto'}
          fontSize={nodeStyle.headerFontSize ?? 11}
          backgroundColor={nodeStyle.headerBackgroundColor ?? '#f8fafc'}
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

      <NodeResizer
        isVisible={showHoverControls}
        minWidth={nodeSizeLimits.minWidth}
        minHeight={nodeSizeLimits.minHeight}
        maxWidth={nodeSizeLimits.maxWidth}
        maxHeight={nodeSizeLimits.maxHeight}
        handleClassName="w-2 h-2 bg-[var(--color-surface)] border-[1.5px] border-[var(--color-accent)] rounded-[2px] shadow-sm z-30"
        lineClassName="border-transparent z-20"
        onResizeStart={(_, params) => updateResizePreview(params)}
        onResize={(_, params) => updateResizePreview(params)}
        onResizeEnd={(_, params) => hideResizePreviewSoon(params)}
      />

      {showResizeLabel && (
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
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </Handle>

      <div className="flex flex-1 flex-col items-center justify-center overflow-hidden pointer-events-none min-w-0 min-h-0" style={{ borderRadius }}>
        {/* Header 层 */}
        <div className="relative flex w-full items-center justify-center shrink-0 min-h-0 h-full" style={headerStyle}>
          <div
            className={cn("flex w-full rounded-md transition-colors duration-75 items-center justify-center h-full", titleEditing && "bg-[var(--color-surface)]/20 shadow-[inset_0_0_0_1px_var(--color-border-light)] focus-within:bg-[var(--color-surface)]/40 focus-within:shadow-[inset_0_0_0_1px_var(--color-border),0_0_0_2px_var(--color-accent-soft)]")}
            style={{
              ...titleFieldStyle,
              paddingLeft: '8px',
              paddingRight: `${Math.max(8, accessoryWidth)}px`,
            }}
          >
            {titleEditing ? (
              <input
                ref={titleInputRef}
                className="w-full h-full px-[3px] py-[1px] border-none rounded-none bg-transparent text-inherit font-inherit text-inherit leading-inherit outline-none box-border pointer-events-auto shadow-none caret-current transition-colors duration-75 nodrag nowheel text-center"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void confirmTitleEdit({ restoreFocus: false })}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') void confirmTitleEdit({ restoreFocus: true })
                  if (event.key === 'Escape') cancelTitleEdit({ restoreFocus: true })
                }}
              />
            ) : (
              <div
                className="w-full h-full break-words whitespace-pre-wrap pointer-events-auto select-none flex items-center justify-center"
                onDoubleClick={contentInteractionsEnabled ? startTitleEdit : undefined}
                title={contentInteractionsEnabled ? '双击编辑标题' : undefined}
              >
                {data.label}
              </div>
            )}
          </div>

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
                onClick={handleDrillDown}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                title={`点击进入包含 ${data.childCount} 个子节点的画布`}
                style={badgeStyle}
              >
                {data.childCount}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(KnowledgeCard)
