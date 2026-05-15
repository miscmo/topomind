import type { EdgeLineMode, EdgeLineStyle, EdgeWeight, KnowledgeEdge } from '../../types'

const DEFAULT_EDGE_COLOR = '#7f8c8d'

export interface EdgeViewOptions {
  lineMode?: EdgeLineMode
  lineStyle?: EdgeLineStyle
  color?: string
  arrow?: boolean
  weight?: EdgeWeight
  selected?: boolean
}

export function buildEdgeView(options: EdgeViewOptions = {}): Pick<KnowledgeEdge, 'type' | 'animated' | 'style' | 'markerEnd'> {
  const lineMode = options.lineMode ?? 'straight'
  const lineStyle = options.lineStyle ?? 'solid'
  const color = options.color ?? DEFAULT_EDGE_COLOR
  const arrow = options.arrow ?? true
  const weight = options.weight ?? 'minor'
  const selected = options.selected ?? false

  return {
    type: lineMode,
    animated: weight === 'main',
    style: {
      stroke: color,
      strokeWidth: selected ? (weight === 'main' ? 2.5 : 2) : (weight === 'main' ? 1.5 : 1.2),
      strokeDasharray: lineStyle === 'dashed' ? '6 4' : undefined,
      opacity: selected ? 1 : 0.6,
    },
    markerEnd: arrow
      ? {
          type: 'arrowclosed',
          color,
        }
      : undefined,
  }
}

