import type { EdgeLineMode, EdgeLineStyle, EdgeWeight, KnowledgeEdge } from '../../types'
import { STYLE_CONFIG_DEFAULTS } from '../../domain/style/styleDefaults'

export interface EdgeViewOptions {
  lineMode?: EdgeLineMode
  lineStyle?: EdgeLineStyle
  color?: string
  arrow?: boolean
  weight?: EdgeWeight
  selected?: boolean
}

export function buildEdgeView(options: EdgeViewOptions = {}): Pick<KnowledgeEdge, 'type' | 'animated' | 'style' | 'markerEnd'> {
  const lineMode = options.lineMode ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineMode
  const lineStyle = options.lineStyle ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.lineStyle
  const color = options.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
  const arrow = options.arrow ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrow
  const weight = options.weight ?? 'minor'
  const selected = options.selected ?? false

  const finalColor = selected ? 'var(--color-accent)' : color

  return {
    type: lineMode,
    animated: weight === 'main',
    style: {
      stroke: finalColor,
      strokeWidth: weight === 'main' ? 1.5 : 1.2,
      strokeDasharray: lineStyle === 'dashed' ? '6 4' : undefined,
      opacity: selected ? 1 : 0.6,
    },
    markerEnd: arrow
      ? {
          type: 'arrowclosed',
          width: 20,
          height: 20,
          color: finalColor,
        }
      : undefined,
  }
}

