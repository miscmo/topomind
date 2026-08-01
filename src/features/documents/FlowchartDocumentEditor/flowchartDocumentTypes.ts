import type { Cell } from '@antv/x6'

export interface FlowchartViewport {
  zoom: number
  pan: {
    x: number
    y: number
  }
}

export interface FlowchartCell {
  id: string
  shape: string
  x?: number
  y?: number
  width?: number
  height?: number
  attrs?: Cell.Properties['attrs']
  data?: Cell.Properties['data']
  source?: { cell: string }
  target?: { cell: string }
  labels?: Record<string, unknown>[]
  [key: string]: unknown
}

export interface FlowchartDocumentContent {
  schema: 'topomind.flowchart-document'
  version: 2
  title: string
  cells: FlowchartCell[]
  viewport: FlowchartViewport
  metadata?: {
    createdAt?: number
    updatedAt?: number
    editor?: 'x6'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeCellAttrs(value: unknown): NonNullable<Cell.Properties['attrs']> {
  return isRecord(value) ? value as NonNullable<Cell.Properties['attrs']> : {}
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, finiteNumber(value, fallback)))
}

function normalizePoint(value: unknown, fallback: { x: number; y: number }): { x: number; y: number } {
  const input = isRecord(value) ? value : {}
  return {
    x: boundedNumber(input.x, fallback.x, -100_000, 100_000),
    y: boundedNumber(input.y, fallback.y, -100_000, 100_000),
  }
}

function getEndpointCellId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (isRecord(value) && typeof value.cell === 'string' && value.cell.trim()) return value.cell
  return null
}

function normalizeNodeCell(value: unknown, seenIds: Set<string>): FlowchartCell | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || seenIds.has(value.id)) return null

  const shape = value.shape === 'polygon' ? 'polygon' : 'rect'
  const id = value.id
  seenIds.add(id)
  return {
    ...value,
    id,
    shape,
    x: boundedNumber(value.x, 0, -100_000, 100_000),
    y: boundedNumber(value.y, 0, -100_000, 100_000),
    width: boundedNumber(value.width, shape === 'polygon' ? 160 : 120, 40, 2_000),
    height: boundedNumber(value.height, shape === 'polygon' ? 80 : 60, 30, 2_000),
    attrs: normalizeCellAttrs(value.attrs),
    data: isRecord(value.data) ? value.data : {},
  }
}

function normalizeEdgeCell(value: unknown, seenIds: Set<string>, nodeIds: Set<string>): FlowchartCell | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || seenIds.has(value.id)) return null

  const sourceId = getEndpointCellId(value.source)
  const targetId = getEndpointCellId(value.target)
  if (!sourceId || !targetId || !nodeIds.has(sourceId) || !nodeIds.has(targetId)) return null

  seenIds.add(value.id)
  return {
    ...value,
    id: value.id,
    shape: 'edge',
    source: { cell: sourceId },
    target: { cell: targetId },
    attrs: normalizeCellAttrs(value.attrs),
    data: isRecord(value.data) ? value.data : {},
    labels: Array.isArray(value.labels) ? value.labels.filter(isRecord) : [],
  }
}

function normalizeFlowchartCells(value: unknown): FlowchartCell[] {
  if (!Array.isArray(value)) return []

  const seenIds = new Set<string>()
  const nodes = value
    .filter((cell) => isRecord(cell) && cell.shape !== 'edge' && cell.shape !== 'custom-edge')
    .map((cell) => normalizeNodeCell(cell, seenIds))
    .filter((cell): cell is FlowchartCell => cell !== null)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = value
    .filter((cell) => isRecord(cell) && (cell.shape === 'edge' || cell.shape === 'custom-edge'))
    .map((cell) => normalizeEdgeCell(cell, seenIds, nodeIds))
    .filter((cell): cell is FlowchartCell => cell !== null)

  return [...nodes, ...edges]
}

function migrateV1Cells(input: Record<string, unknown>): FlowchartCell[] {
  const rawNodes = isRecord(input.nodes) ? input.nodes : {}
  const nodes = Object.entries(rawNodes).map(([key, rawNode]) => {
    const node = isRecord(rawNode) ? rawNode : {}
    const kind = node.kind === 'start' || node.kind === 'decision' || node.kind === 'end' ? node.kind : 'process'
    const id = typeof node.id === 'string' && node.id.trim() ? node.id : key
    return {
      id,
      shape: kind === 'decision' ? 'polygon' : 'rect',
      x: finiteNumber(isRecord(node.position) ? node.position.x : undefined, 0),
      y: finiteNumber(isRecord(node.position) ? node.position.y : undefined, 0),
      width: kind === 'decision' ? 160 : (kind === 'start' || kind === 'end' ? 120 : 160),
      height: kind === 'decision' ? 80 : (kind === 'start' || kind === 'end' ? 50 : 60),
      attrs: {
        label: { text: typeof node.label === 'string' ? node.label : '节点' },
      },
      data: { kind },
    }
  })

  const edges = Array.isArray(input.edges) ? input.edges.map((rawEdge, index) => {
    const edge = isRecord(rawEdge) ? rawEdge : {}
    const source = getEndpointCellId(edge.source)
    const target = getEndpointCellId(edge.target)
    const label = typeof edge.label === 'string' ? edge.label.trim() : ''
    return {
      id: typeof edge.id === 'string' && edge.id.trim() ? edge.id : `edge-${index + 1}`,
      shape: 'edge',
      source: source ? { cell: source } : undefined,
      target: target ? { cell: target } : undefined,
      labels: label ? [{ attrs: { label: { text: label }, text: { text: label } } }] : [],
    }
  }) : []

  return normalizeFlowchartCells([...nodes, ...edges])
}

export function normalizeFlowchartDocumentContent(value: unknown, fallbackTitle: string): FlowchartDocumentContent {
  const now = Date.now()
  const input = isRecord(value) ? value : {}
  const metadata = isRecord(input.metadata) ? input.metadata : {}
  const isV1 = input.version === 1 || input.nodes !== undefined

  return {
    schema: 'topomind.flowchart-document',
    version: 2,
    title: typeof input.title === 'string' && input.title.trim() ? input.title : (fallbackTitle || '未命名流程图'),
    cells: isV1 ? migrateV1Cells(input) : normalizeFlowchartCells(input.cells),
    viewport: {
      zoom: boundedNumber(isRecord(input.viewport) ? input.viewport.zoom : undefined, 1, 0.1, 4),
      pan: normalizePoint(isRecord(input.viewport) ? input.viewport.pan : undefined, { x: 0, y: 0 }),
    },
    metadata: {
      createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : now,
      updatedAt: typeof metadata.updatedAt === 'number' ? metadata.updatedAt : now,
      editor: 'x6',
    },
  }
}

export function serializeFlowchartDocumentContent(value: FlowchartDocumentContent | null): string {
  return value ? JSON.stringify(value) : ''
}

export function withFlowchartUpdatedAt(value: FlowchartDocumentContent): FlowchartDocumentContent {
  return {
    ...value,
    metadata: {
      ...value.metadata,
      editor: 'x6',
      updatedAt: Date.now(),
    },
  }
}
