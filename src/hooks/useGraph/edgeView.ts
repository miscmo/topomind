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
  const lineMode = options.lineMode ?? 'smoothstep'
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
      strokeWidth: selected ? (weight === 'main' ? 4 : 3.5) : (weight === 'main' ? 2.5 : 2),
      strokeDasharray: lineStyle === 'dashed' ? '6 4' : undefined,
      filter: selected ? 'drop-shadow(0 0 6px rgba(52, 152, 219, 0.45))' : undefined,
    },
    markerEnd: arrow
      ? {
          type: 'arrowclosed',
          color,
        }
      : undefined,
  }
}

