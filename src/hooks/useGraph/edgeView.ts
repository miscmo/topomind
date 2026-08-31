import type { EdgeArrowPosition, EdgeArrowShape, EdgeLineMode, EdgeLineStyle, EdgeWeight, KnowledgeEdge } from '../../types'
import { STYLE_CONFIG_DEFAULTS } from '../../domain/style/styleDefaults.ts'
import { EDGE_ARROW_SIZE_LIMIT, EDGE_LINE_WIDTH_LIMIT, MAIN_EDGE_WIDTH_RATIO, clampNumber } from '../../domain/style/styleConstraints.ts'

export interface EdgeViewOptions {
  lineMode?: EdgeLineMode
  lineStyle?: EdgeLineStyle
  color?: string
  lineWidth?: number
  arrow?: boolean
  arrowSize?: number
  arrowShape?: EdgeArrowShape
  arrowPosition?: EdgeArrowPosition
  weight?: EdgeWeight
  selected?: boolean
}

/**
 * 构建连线的 React Flow 视图属性。
 *
 * 注意：画布上的连线实际由自定义边 FloatingEdge 渲染，它会自绘箭头并覆盖这里的
 * markerStart/markerEnd。此处仍然保持新字段生效，是为了让"连线应有的外观"只有
 * 一个语义来源（缩略图、以及将来切回内置边类型时行为一致）。
 */
export function buildEdgeView(options: EdgeViewOptions = {}): Pick<KnowledgeEdge, 'type' | 'animated' | 'style' | 'markerEnd' | 'markerStart'> {
  const lineMode = options.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode
  const lineStyle = options.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
  const color = options.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
  const lineWidth = clampNumber(
    options.lineWidth ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineWidth,
    EDGE_LINE_WIDTH_LIMIT.min,
    EDGE_LINE_WIDTH_LIMIT.max
  )
  const arrow = options.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow
  const arrowSize = clampNumber(
    options.arrowSize ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize,
    EDGE_ARROW_SIZE_LIMIT.min,
    EDGE_ARROW_SIZE_LIMIT.max
  )
  const arrowShape = options.arrowShape ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape
  const arrowPosition = options.arrowPosition ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition
  const weight = options.weight ?? 'minor'
  const selected = options.selected ?? false

  const finalColor = selected ? 'var(--color-accent)' : color

  // 实心/空心对应 React Flow 的 arrowclosed / arrow；
  // markerUnits 用 userSpaceOnUse，使 arrowSize 直接等于箭头像素长度（与 FloatingEdge 一致）。
  const marker = arrow
    ? {
        type: arrowShape === 'solid' ? 'arrowclosed' : 'arrow',
        width: arrowSize,
        height: arrowSize,
        color: finalColor,
        markerUnits: 'userSpaceOnUse',
      } as const
    : undefined

  const wantsStart = arrow && (arrowPosition === 'start' || arrowPosition === 'both')
  const wantsEnd = arrow && (arrowPosition === 'end' || arrowPosition === 'both')

  return {
    type: lineMode,
    animated: weight === 'main',
    style: {
      stroke: finalColor,
      // 主线在基础线宽上加粗，默认 1.2 → 主线 1.5（与改造前的硬编码值一致）
      strokeWidth: weight === 'main' ? lineWidth * MAIN_EDGE_WIDTH_RATIO : lineWidth,
      strokeDasharray: lineStyle === 'dashed' ? '6 4' : undefined,
      opacity: selected ? 1 : 0.6,
    },
    markerStart: wantsStart ? marker : undefined,
    markerEnd: wantsEnd ? marker : undefined,
  }
}
