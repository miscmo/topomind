export interface MindMapNodeData {
  data: {
    text: string
    expandState?: 'expand' | 'collapse'
    [key: string]: unknown
  }
  children: MindMapNodeData[]
}

export interface MindMapDocumentContent {
  schema: 'topomind.mindmap-document'
  version: 2
  title: string
  root: MindMapNodeData
  theme?: string
  layout?: string
  metadata?: {
    createdAt?: number
    updatedAt?: number
    editor?: 'simple-mind-map'
  }
}

export const MIND_MAP_THEMES = [
  'default',
  'classic',
  'minions',
  'pinkGrapefruit',
  'mint',
  'gold',
  'vitalityOrange',
  'greenLeaf',
  'dark2',
] as const

export const MIND_MAP_LAYOUTS = [
  'logicalStructure',
  'mindMap',
  'organizationStructure',
  'catalogOrganization',
  'timeline',
  'fishbone',
] as const

export type MindMapTheme = (typeof MIND_MAP_THEMES)[number]
export type MindMapLayout = (typeof MIND_MAP_LAYOUTS)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeMindMapTheme(value: unknown): MindMapTheme {
  return typeof value === 'string' && (MIND_MAP_THEMES as readonly string[]).includes(value)
    ? value as MindMapTheme
    : 'default'
}

export function normalizeMindMapLayout(value: unknown): MindMapLayout {
  return typeof value === 'string' && (MIND_MAP_LAYOUTS as readonly string[]).includes(value)
    ? value as MindMapLayout
    : 'logicalStructure'
}

function normalizeNode(value: unknown, fallbackText: string): MindMapNodeData {
  if (!isRecord(value)) {
    return { data: { text: fallbackText, expandState: 'expand' }, children: [] }
  }

  const data = isRecord(value.data) ? value.data : {}
  return {
    data: {
      ...data,
      text: typeof data.text === 'string' ? data.text : fallbackText,
      expandState: data.expandState === 'collapse' ? 'collapse' : 'expand',
    },
    children: Array.isArray(value.children)
      ? value.children.map((child, index) => normalizeNode(child, `分支主题 ${index + 1}`))
      : [],
  }
}

// Only support version 2 (SimpleMindMap format)
export function normalizeMindMapDocumentContent(value: unknown, fallbackTitle: string): MindMapDocumentContent {
  const now = Date.now()
  const input = isRecord(value) ? value : {}
  const metadata = isRecord(input.metadata) ? input.metadata : {}

  return {
    schema: 'topomind.mindmap-document',
    version: 2,
    title: typeof input.title === 'string' && input.title.trim() ? input.title : fallbackTitle,
    root: normalizeNode(input.root, fallbackTitle || '中心主题'),
    theme: normalizeMindMapTheme(input.theme),
    layout: normalizeMindMapLayout(input.layout),
    metadata: {
      createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : now,
      updatedAt: typeof metadata.updatedAt === 'number' ? metadata.updatedAt : now,
      editor: 'simple-mind-map',
    },
  }
}

export function serializeMindMapDocumentContent(value: MindMapDocumentContent | null): string {
  return value ? JSON.stringify(value) : ''
}

export function withMindMapUpdatedAt(value: MindMapDocumentContent): MindMapDocumentContent {
  return {
    ...value,
    metadata: {
      ...value.metadata,
      editor: 'simple-mind-map',
      updatedAt: Date.now(),
    },
  }
}
