export interface FlowchartViewport {
  zoom: number
  pan: {
    x: number
    y: number
  }
}

export interface FlowchartDocumentContent {
  schema: 'topomind.flowchart-document'
  version: 2
  title: string
  cells: any[] // We will store native X6 cells JSON directly
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

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizePoint(value: unknown, fallback: { x: number; y: number }): { x: number; y: number } {
  const input = isRecord(value) ? value : {}
  return {
    x: finiteNumber(input.x, fallback.x),
    y: finiteNumber(input.y, fallback.y),
  }
}

export function normalizeFlowchartDocumentContent(value: unknown, fallbackTitle: string): FlowchartDocumentContent {
  const now = Date.now()
  const input = isRecord(value) ? value : {}
  const metadata = isRecord(input.metadata) ? input.metadata : {}
  
  // Migration from V1 (ReactFlow) to V2 (X6)
  let cells: any[] = []
  if (input.version === 1 || input.nodes) {
    const rawNodes = isRecord(input.nodes) ? input.nodes : {}
    const x6Nodes = Object.entries(rawNodes).map(([key, node]: [string, any]) => {
      const kind = typeof node.kind === 'string' ? node.kind : 'process'
      const label = node.label || '节点'
      return {
        id: node.id || key,
        shape: kind === 'decision' ? 'polygon' : 'rect',
        x: node.position?.x || 0,
        y: node.position?.y || 0,
        width: kind === 'decision' ? 160 : (kind === 'start' || kind === 'end' ? 120 : 160),
        height: kind === 'decision' ? 80 : (kind === 'start' || kind === 'end' ? 50 : 60),
        attrs: {
          label: { text: label }
        },
        data: { kind }
      }
    })
    
    const x6Edges = Array.isArray(input.edges) ? input.edges.map((edge: any) => ({
      id: edge.id,
      shape: 'edge',
      source: edge.source,
      target: edge.target,
      labels: edge.label ? [edge.label] : undefined,
    })) : []
    
    cells = [...x6Nodes, ...x6Edges]
  } else {
    cells = Array.isArray(input.cells) ? input.cells : []
  }

  return {
    schema: 'topomind.flowchart-document',
    version: 2,
    title: typeof input.title === 'string' && input.title.trim() ? input.title : (fallbackTitle || '未命名流程图'),
    cells,
    viewport: {
      zoom: finiteNumber(isRecord(input.viewport) ? input.viewport.zoom : undefined, 1),
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
