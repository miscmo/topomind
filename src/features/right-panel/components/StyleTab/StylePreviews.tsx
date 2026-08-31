import type { DefaultEdgeStyle, DefaultEditorStyle, DefaultNodeStyle } from '../../../../types/uiStoreTypes'
import { resolveEditorFontFamily } from '../../../../domain/style/styleDefaults'
import { EDGE_ARROW_SIZE_LIMIT, EDGE_LINE_WIDTH_LIMIT } from '../../../../domain/style/styleConstraints'

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

export function NodeStylePreview({
  style,
  width,
  height,
  nodeBadgeSize,
  title,
}: {
  style: DefaultNodeStyle
  width: number
  height: number
  nodeBadgeSize: number
  title: string
}) {
  const previewWidth = clamp(width, 120, 240)
  const previewHeight = clamp(height, 52, 120)
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border-light)] rounded-xl p-3 shadow-[var(--shadow-sm)]">
      <div className="text-[12px] font-semibold text-[var(--color-text-secondary)] mb-2">节点预览</div>
      <div className="min-h-[132px] rounded-lg bg-[var(--color-bg-muted)] border border-[var(--color-border-subtle)] flex items-center justify-center p-4 overflow-hidden">
        <div
          className="relative flex items-center justify-center shadow-sm"
          style={{
            width: previewWidth,
            height: previewHeight,
            borderRadius: style.borderRadius,
            borderWidth: style.borderWidth,
            borderStyle: 'solid',
            borderColor: style.borderColor,
            backgroundColor: style.headerBackgroundColor,
            color: style.headerColor,
          }}
        >
          <span
            className="px-2 text-center truncate"
            style={{
              fontSize: style.headerFontSize,
              fontWeight: style.headerFontWeight,
              fontStyle: style.headerFontStyle,
              lineHeight: 1.3,
              maxWidth: '100%',
            }}
          >
            {title}
          </span>
          <span
            className="absolute -right-1.5 -top-1.5 flex items-center justify-center rounded-full bg-[var(--color-primary)] text-white"
            style={{
              minWidth: nodeBadgeSize,
              height: nodeBadgeSize,
              fontSize: Math.max(8, Math.round(nodeBadgeSize * 0.64)),
            }}
          >
            3
          </span>
        </div>
      </div>
    </div>
  )
}

export function EdgeStylePreview({ style }: { style: DefaultEdgeStyle }) {
  const dashArray = style.lineStyle === 'dashed' ? '6 4' : undefined
  const path = style.lineMode === 'smoothstep' ? 'M18 58 C58 18, 122 98, 162 58' : 'M18 58 L162 58'
  const arrowSize = clamp(style.arrowSize ?? 12, EDGE_ARROW_SIZE_LIMIT.min, EDGE_ARROW_SIZE_LIMIT.max)
  // 预览画的是次线（weight=minor），直接用基础线宽，与画布上非主线连线一致
  const lineWidth = clamp(style.lineWidth ?? 1.2, EDGE_LINE_WIDTH_LIMIT.min, EDGE_LINE_WIDTH_LIMIT.max)
  const isSolid = style.arrowShape === 'solid'
  const showStart = style.arrow && (style.arrowPosition === 'start' || style.arrowPosition === 'both')
  const showEnd = style.arrow && (style.arrowPosition === 'end' || style.arrowPosition === 'both')
  // 与画布 FloatingEdge 保持同一套箭头几何：12x12 viewBox，尖端在 (12,6)
  const arrowPath = 'M 0 0 L 12 6 L 0 12'
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border-light)] rounded-xl p-3 shadow-[var(--shadow-sm)]">
      <div className="text-[12px] font-semibold text-[var(--color-text-secondary)] mb-2">连线预览</div>
      <div className="h-[116px] rounded-lg bg-[var(--color-bg-muted)] border border-[var(--color-border-subtle)] flex items-center justify-center">
        <svg width="180" height="116" viewBox="0 0 180 116" aria-hidden="true">
          <defs>
            {style.arrow && (
              <marker
                id="style-preview-arrow"
                viewBox="0 0 12 12"
                markerWidth={arrowSize}
                markerHeight={arrowSize}
                refX="12"
                refY="6"
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path
                  d={isSolid ? `${arrowPath} Z` : arrowPath}
                  fill={isSolid ? style.color : 'none'}
                  stroke={style.color}
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </marker>
            )}
          </defs>
          <circle cx="18" cy="58" r="8" fill="var(--color-surface)" stroke="var(--color-border-strong)" />
          <circle cx="162" cy="58" r="8" fill="var(--color-surface)" stroke="var(--color-border-strong)" />
          <path
            d={path}
            fill="none"
            stroke={style.color}
            strokeWidth={lineWidth}
            strokeDasharray={dashArray}
            markerStart={showStart ? 'url(#style-preview-arrow)' : undefined}
            markerEnd={showEnd ? 'url(#style-preview-arrow)' : undefined}
          />
        </svg>
      </div>
    </div>
  )
}

export function EditorStylePreview({ style }: { style: DefaultEditorStyle }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border-light)] rounded-xl p-3 shadow-[var(--shadow-sm)]">
      <div className="text-[12px] font-semibold text-[var(--color-text-secondary)] mb-2 flex items-center justify-between">
        <span>智能文档预览</span>
        <span className={`block h-5 w-9 tm-paper-thumb tm-paper-thumb--${style.paperBackground ?? 'plain'}`} />
      </div>
      <div
        className="rounded-lg border border-[var(--color-border-subtle)] p-4 min-h-[132px]"
        style={{
          backgroundColor: style.backgroundColor,
          color: style.textColor,
          fontFamily: resolveEditorFontFamily(style.fontFamily),
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
        }}
      >
        <div className="font-semibold mb-2">标题示例</div>
        <p className="m-0">这是一段智能文档正文预览，用于确认字体、颜色、背景和行高。</p>
      </div>
    </div>
  )
}
