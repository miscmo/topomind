import type { CardInfo, GraphMeta, KBEdge } from './model'
import type { EdgeLineMode, EdgeLineStyle, EdgeRelation, EdgeWeight, KnowledgeNodeStyle } from '../../types'

const DEFAULT_VIEWPORT = { zoom: 1, pan: { x: 0, y: 0 } }
const DEFAULT_NODE_SIZE = { width: 120, height: 52 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function normalizePoint(value: unknown, fallback: { x: number; y: number }) {
  if (!isRecord(value)) return fallback
  return {
    x: asFiniteNumber(value.x, fallback.x),
    y: asFiniteNumber(value.y, fallback.y),
  }
}

function normalizeRelation(value: unknown): EdgeRelation {
  return value === '演进' || value === '依赖' || value === '相关' ? value : '相关'
}

function normalizeWeight(value: unknown): EdgeWeight {
  return value === 'main' || value === 'minor' ? value : 'minor'
}

function normalizeLineMode(value: unknown): EdgeLineMode | undefined {
  return value === 'smoothstep' || value === 'straight' ? value : undefined
}

function normalizeLineStyle(value: unknown): EdgeLineStyle | undefined {
  return value === 'solid' || value === 'dashed' ? value : undefined
}

function normalizeCard(value: unknown, fallbackRef: string): CardInfo {
  const card = isRecord(value) ? value : {}
  const ref = asString(card.ref, fallbackRef)
  return {
    ref,
    name: asString(card.name, ref),
    updatedAt: typeof card.updatedAt === 'string' ? card.updatedAt : undefined,
  }
}

function normalizeNodeStyle(value: unknown): KnowledgeNodeStyle | undefined {
  if (!isRecord(value)) return undefined
  const style: KnowledgeNodeStyle = {}
  if (Number.isFinite(value.headerFontSize)) style.headerFontSize = value.headerFontSize as number
  if (Number.isFinite(value.bodyFontSize)) style.bodyFontSize = value.bodyFontSize as number
  if (typeof value.headerColor === 'string') style.headerColor = value.headerColor
  if (typeof value.headerBackgroundColor === 'string') style.headerBackgroundColor = value.headerBackgroundColor
  if (value.headerFontWeight === 'normal' || value.headerFontWeight === 'bold') style.headerFontWeight = value.headerFontWeight
  if (value.headerFontStyle === 'normal' || value.headerFontStyle === 'italic') style.headerFontStyle = value.headerFontStyle
  if (typeof value.borderColor === 'string') style.borderColor = value.borderColor
  if (Number.isFinite(value.borderWidth)) style.borderWidth = value.borderWidth as number
  if (Number.isFinite(value.borderRadius)) style.borderRadius = value.borderRadius as number
  return Object.keys(style).length > 0 ? style : undefined
}

export function normalizeGraphMeta(input: unknown): GraphMeta {
  const raw = isRecord(input) ? input : {}
  const rawNodes = isRecord(raw.nodes) ? raw.nodes : {}
  const nodes: GraphMeta['nodes'] = {}

  for (const [key, rawNode] of Object.entries(rawNodes)) {
    if (!isRecord(rawNode)) continue
    const id = asString(rawNode.id, key)
    if (!id) continue
    const card = normalizeCard(rawNode.card, id)
    nodes[id] = {
      id,
      card,
      height: asFiniteNumber(rawNode.height, DEFAULT_NODE_SIZE.height),
      width: asFiniteNumber(rawNode.width, DEFAULT_NODE_SIZE.width),
      widthMode: rawNode.widthMode === 'manual' ? 'manual' : (rawNode.widthMode === 'auto' ? 'auto' : undefined),
      heightMode: rawNode.heightMode === 'manual' ? 'manual' : (rawNode.heightMode === 'auto' ? 'auto' : undefined),
      position: isRecord(rawNode.position)
        ? normalizePoint(rawNode.position, { x: 0, y: 0 })
        : undefined,
      expanded: typeof rawNode.expanded === 'boolean' ? rawNode.expanded : undefined,
      color: typeof rawNode.color === 'string' ? rawNode.color : undefined,
      style: normalizeNodeStyle(rawNode.style),
      expandedWidth: typeof rawNode.expandedWidth === 'number' ? rawNode.expandedWidth : undefined,
      expandedHeight: typeof rawNode.expandedHeight === 'number' ? rawNode.expandedHeight : undefined,
      emojis: Array.isArray(rawNode.emojis) ? rawNode.emojis.filter((emoji): emoji is string => typeof emoji === 'string') : undefined,
    }
  }

  const edgeIds = new Set<string>()
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : []
  const edges: KBEdge[] = []

  for (const rawEdge of rawEdges) {
    if (!isRecord(rawEdge)) continue
    const id = asString(rawEdge.id, '')
    if (!id || edgeIds.has(id)) continue
    const source = normalizeCard(rawEdge.source, '')
    const target = normalizeCard(rawEdge.target, '')
    if (!source.ref || !target.ref) continue

    edgeIds.add(id)
    edges.push({
      id,
      source,
      target,
      relation: normalizeRelation(rawEdge.relation),
      weight: normalizeWeight(rawEdge.weight),
      lineMode: normalizeLineMode(rawEdge.lineMode),
      lineStyle: normalizeLineStyle(rawEdge.lineStyle),
      color: typeof rawEdge.color === 'string' ? rawEdge.color : undefined,
      arrow: typeof rawEdge.arrow === 'boolean' ? rawEdge.arrow : undefined,
      highlighted: typeof rawEdge.highlighted === 'boolean' ? rawEdge.highlighted : undefined,
      faded: typeof rawEdge.faded === 'boolean' ? rawEdge.faded : undefined,
    })
  }

  const rawViewport = isRecord(raw.viewport) ? raw.viewport : {}
  return {
    nodes,
    edges,
    viewport: {
      zoom: asFiniteNumber(rawViewport.zoom, DEFAULT_VIEWPORT.zoom),
      pan: normalizePoint(rawViewport.pan, DEFAULT_VIEWPORT.pan),
    },
  }
}
