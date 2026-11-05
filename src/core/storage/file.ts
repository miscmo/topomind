import { FSB } from '../fs-backend'
import type { StorageBackend, TopoDocumentCreateInput, TopoDocumentManifestItem, TopoDocumentMetaPatch, MoveTopoDocumentToCardResult, MoveTopoNodesToRoomResult } from './service'
import type { CardInfo, GraphMeta } from '../../domain/graph/model'
import type { EdgeRelation, EdgeWeight, EdgeArrowShape, EdgeArrowPosition, KnowledgeNodeStyle, EdgeAnchor, GraphNodeKind } from '../../types'
import { basenameRef, joinRefs, normalizeRef } from '../../domain/graph/path-utils'
import { normalizeEdgeAnchor } from '../../domain/graph/edgeAnchors'
import { normalizeCurveControl, type CurveControl } from '../../domain/graph/edgeCurve'

interface FSBGraphChild {
  name: string
  /** P1 schema：知识节点 / 画布形状节点，缺省 = knowledge */
  kind?: GraphNodeKind
  x?: number
  y?: number
  width?: number
  height?: number
  widthMode?: 'auto' | 'manual'
  heightMode?: 'auto' | 'manual'
  expanded?: boolean
  style?: KnowledgeNodeStyle
  expandedWidth?: number
  expandedHeight?: number
  emojis?: string[]
}

interface FSBGraphEdge {
  id: string
  source: string
  target: string
  relation?: EdgeRelation
  weight?: EdgeWeight
  lineMode?: 'smoothstep' | 'straight' | 'curve'
  lineStyle?: 'solid' | 'dashed'
  color?: string
  lineWidth?: number
  arrow?: boolean
  arrowSize?: number
  arrowShape?: EdgeArrowShape
  arrowPosition?: EdgeArrowPosition
  /** 曲线控制点（归一化 {u,v}），null/缺省=直线；仅 lineMode='curve' 时生效 */
  curveControl?: CurveControl | null
  /** 旧版单曲率系数，仅读入时兼容，写出时不再产生 */
  curveBend?: number | null
  sourceAnchor?: EdgeAnchor | null
  targetAnchor?: EdgeAnchor | null
  highlighted?: boolean
  faded?: boolean
}

interface FSBGraphLike {
  edges?: FSBGraphEdge[]
  children?: Record<string, FSBGraphChild>
  zoom?: number | null
  pan?: { x: number; y: number } | null
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

/** 与 normalizeGraphMeta 同规则：只放行已知枚举，未知值回落缺省 knowledge。 */
const normalizeNodeKind = (value: unknown): GraphNodeKind | undefined => (
  value === 'knowledge' || value === 'shape' ? value : undefined
)

const toCardInfo = (parentCardPath: string, key: string, rawChild: unknown): CardInfo => {
  const child = isRecord(rawChild) ? rawChild : {}
  const rawName = child.name
  const childPath = parentCardPath && !key.startsWith(`${parentCardPath}/`)
    ? joinRefs(parentCardPath, key)
    : normalizeRef(key)
  const fallbackName = basenameRef(childPath) || key
  const safeName = (typeof rawName === 'string' && rawName.trim()) ? rawName.trim() : fallbackName

  return {
    ref: childPath,
    name: safeName,
    updatedAt: undefined,
  }
}

async function updateCardName(rootDir: string, cardPath: string, newName: string): Promise<void> {
  const parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : ''
  const cardId = basenameRef(cardPath)
  const graph = await FSB.readGraphMeta(rootDir, parentPath)
  const children = isRecord(graph.children) ? { ...graph.children } : {}

  const entry = children[cardId]
  if (isRecord(entry)) {
    children[cardId] = { ...entry, name: newName }
    await FSB.writeGraphMeta(rootDir, parentPath, { ...graph, children })
  }
}

export function convertFSBToGraph(raw: FSBGraphLike, _roomRef = ''): GraphMeta {
  const children = raw.children ?? {}

  const nodes: GraphMeta['nodes'] = {}
  for (const [key, child] of Object.entries(children)) {
    const ref = normalizeRef(key)
    nodes[ref] = {
      id: ref,
      card: { ref, name: child.name, updatedAt: undefined },
      kind: normalizeNodeKind(child.kind),
      height: Number.isFinite(child.height) ? child.height as number : 52,
      width: Number.isFinite(child.width) ? child.width as number : 120,
      widthMode: child.widthMode === 'manual' ? 'manual' : (child.widthMode === 'auto' ? 'auto' : undefined),
      heightMode: child.heightMode === 'manual' ? 'manual' : (child.heightMode === 'auto' ? 'auto' : undefined),
      position: Number.isFinite(child.x) && Number.isFinite(child.y)
        ? { x: child.x as number, y: child.y as number }
        : undefined,
      expanded: typeof child.expanded === 'boolean' ? child.expanded : undefined,
      style: child.style,
      expandedWidth: Number.isFinite(child.expandedWidth) ? child.expandedWidth as number : undefined,
      expandedHeight: Number.isFinite(child.expandedHeight) ? child.expandedHeight as number : undefined,
      emojis: Array.isArray(child.emojis) ? child.emojis.filter((emoji): emoji is string => typeof emoji === 'string') : undefined,
    }
  }

  const edges: Array<{
    id: string; source: CardInfo; target: CardInfo; relation: EdgeRelation; weight: EdgeWeight
  lineMode?: 'smoothstep' | 'straight' | 'curve'; lineStyle?: 'solid' | 'dashed'
  color?: string; lineWidth?: number; arrow?: boolean; arrowSize?: number; arrowShape?: EdgeArrowShape; arrowPosition?: EdgeArrowPosition
  curveControl?: CurveControl | null; sourceAnchor?: EdgeAnchor | null; targetAnchor?: EdgeAnchor | null
  highlighted?: boolean; faded?: boolean
  }> = (raw.edges ?? []).map(e => ({
    id: e.id,
    source: { ref: normalizeRef(e.source), name: '', updatedAt: undefined },
    target: { ref: normalizeRef(e.target), name: '', updatedAt: undefined },
    relation: e.relation ?? '相关',
    weight: e.weight ?? 'minor',
    lineMode: e.lineMode,
    lineStyle: e.lineStyle,
    color: e.color,
    lineWidth: e.lineWidth,
    arrow: e.arrow,
    arrowSize: e.arrowSize,
    arrowShape: e.arrowShape,
    arrowPosition: e.arrowPosition,
    curveControl: normalizeCurveControl(e.curveControl, e.curveBend),
    sourceAnchor: normalizeEdgeAnchor(e.sourceAnchor),
    targetAnchor: normalizeEdgeAnchor(e.targetAnchor),
    highlighted: e.highlighted,
    faded: e.faded,
  }))

  return {
    nodes,
    edges,
    viewport: {
      zoom: (typeof raw.zoom === 'number' && Number.isFinite(raw.zoom)) ? raw.zoom : 1,
      pan: (raw.pan && typeof raw.pan === 'object' && Number.isFinite(raw.pan.x) && Number.isFinite(raw.pan.y))
        ? raw.pan
        : { x: 0, y: 0 },
    },
  }
}

export function convertGraphToFSB(meta: GraphMeta, _roomRef = ''): {
  children?: Record<string, FSBGraphChild>
  edges?: Array<{
    id: string; source: string; target: string; relation: EdgeRelation; weight: EdgeWeight
    lineMode?: 'smoothstep' | 'straight' | 'curve'; lineStyle?: 'solid' | 'dashed'
    color?: string; lineWidth?: number; arrow?: boolean; arrowSize?: number; arrowShape?: EdgeArrowShape; arrowPosition?: EdgeArrowPosition
    curveControl?: CurveControl | null; sourceAnchor?: EdgeAnchor | null; targetAnchor?: EdgeAnchor | null
    highlighted?: boolean; faded?: boolean
  }>
  zoom?: number; pan?: { x: number; y: number }
} {
  const children: Record<string, FSBGraphChild> = {}
  for (const node of Object.values(meta.nodes)) {
    const ref = normalizeRef(node.card?.ref || node.id)
    const key = ref || basenameRef(node.id) || node.id
    children[key] = {
      name: node.card.name,
      // P1：kind 必须写在 map 本体里。历史上只在返回类型加字段、漏写 map，
      // 结果画面生效但 _graph.json 从来没有该值，重开知识库全部复位。
      kind: normalizeNodeKind(node.kind),
      x: node.position?.x,
      y: node.position?.y,
      width: node.width,
      height: node.height,
      widthMode: node.widthMode,
      heightMode: node.heightMode,
      expanded: node.expanded,
      style: node.style,
      expandedWidth: node.expandedWidth,
      expandedHeight: node.expandedHeight,
      emojis: node.emojis,
    }
  }

  return {
    children,
    edges: meta.edges.map(e => ({
      id: e.id,
      source: normalizeRef(e.source.ref),
      target: normalizeRef(e.target.ref),
      relation: e.relation,
      weight: e.weight,
      lineMode: e.lineMode,
      lineStyle: e.lineStyle,
      color: e.color,
      lineWidth: e.lineWidth,
      arrow: e.arrow,
      arrowSize: e.arrowSize,
      arrowShape: e.arrowShape,
      arrowPosition: e.arrowPosition,
      // null 用 undefined 表示：JSON.stringify 会直接省略该键，避免每条边都写
      // 一个 "curveControl": null 白白撑大 _graph.json（万级边时尤其明显）。
      // 读入侧 normalizeCurveControl(undefined) 仍回落为 null，语义不变。
      curveControl: normalizeCurveControl(e.curveControl) ?? undefined,
      sourceAnchor: normalizeEdgeAnchor(e.sourceAnchor),
      targetAnchor: normalizeEdgeAnchor(e.targetAnchor),
      highlighted: e.highlighted,
      faded: e.faded,
    })),
    zoom: meta.viewport.zoom,
    pan: meta.viewport.pan,
  }
}

export function createFileStorageBackend(getRootDir: () => string | null): StorageBackend {
  const requireRootDir = () => {
    const rootDir = getRootDir()
    if (!rootDir) throw new Error('未选择工作目录')
    return rootDir
  }

  return {
    createVault: async (dirPath: string): Promise<void> => {
      const result = await FSB.createWorkDir(dirPath)
      if (!result.valid) {
        throw new Error(result.error || '创建工作目录失败')
      }
    },

    isValidVault: async (dirPath: string) => {
      try {
        const result = await FSB.isValidWorkDir(dirPath)
        return { valid: result.valid, error: result.error }
      } catch {
        return { valid: false, error: '工作目录校验失败' }
      }
    },

    listKBs: async () => {
      return FSB.listKBs(requireRootDir())
    },

    listTrashKBs: async () => {
      return FSB.listTrashKBs(requireRootDir())
    },

    restoreTrashKB: async (trashName: string) => {
      return FSB.restoreTrashKB(requireRootDir(), trashName)
    },

    clearTrashKBs: async () => {
      await FSB.clearTrashKBs(requireRootDir())
    },

    listAllTrashItems: async () => {
      return FSB.listAllTrashItems(requireRootDir())
    },

    restoreGlobalTrashItem: async (category: string, trashName: string) => {
      return FSB.restoreGlobalTrashItem(requireRootDir(), category, trashName)
    },

    clearAllTrashItems: async () => {
      await FSB.clearAllTrashItems(requireRootDir())
    },

    createKB: async (name: string): Promise<void> => {
      await FSB.createKbsDir(requireRootDir(), name)
    },

    deleteKB: async (kbPath: string): Promise<void> => {
      await FSB.deleteKbsDir(requireRootDir(), kbPath)
    },

    renameKB: async (kbPath: string, newName: string): Promise<void> => {
      await FSB.renameKB(requireRootDir(), kbPath, newName)
    },

    importKB: async (sourcePath: string): Promise<string> => {
      return FSB.importKB(requireRootDir(), sourcePath)
    },

    listCards: async (parentCardPath: string): Promise<CardInfo[]> => {
      const children = await FSB.readCardChildren(requireRootDir(), parentCardPath)
      return Object.entries(children)
        .map(([key, child]) => toCardInfo(parentCardPath, key, child))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
    },

    deleteCard: async (cardPath: string, label?: string): Promise<void> => {
      await FSB.deleteKbsDir(requireRootDir(), cardPath, { label })
    },

    renameCard: async (cardPath: string, newName: string): Promise<void> => {
      await updateCardName(requireRootDir(), cardPath, newName)
    },

    readLayout: async (roomPath: string): Promise<GraphMeta> => {
      try {
        const raw = await FSB.readGraphMeta(requireRootDir(), roomPath)
        return convertFSBToGraph(
          raw as Parameters<typeof convertFSBToGraph>[0],
          roomPath
        )
      } catch {
        return { nodes: {}, edges: [], viewport: { zoom: 1, pan: { x: 0, y: 0 } } }
      }
    },

    readRoomNodeSummaries: async (roomPaths) => {
      return FSB.readRoomNodeSummaries(requireRootDir(), roomPaths)
    },

    writeLayout: async (roomPath: string, meta: GraphMeta): Promise<void> => {
      await FSB.writeGraphMeta(requireRootDir(), roomPath, convertGraphToFSB(meta, roomPath) as Parameters<typeof FSB.writeGraphMeta>[2])
    },

    listTopoDocuments: async (cardPath: string): Promise<TopoDocumentManifestItem[]> => {
      return FSB.listTopoDocuments(requireRootDir(), cardPath)
    },

    createTopoDocument: async (cardPath: string, input: TopoDocumentCreateInput): Promise<TopoDocumentManifestItem> => {
      return FSB.createTopoDocument(requireRootDir(), cardPath, input)
    },

    readTopoDocument: async (cardPath: string, documentId: string): Promise<unknown> => {
      return FSB.readTopoDocument(requireRootDir(), cardPath, documentId)
    },

    writeTopoDocument: async (cardPath: string, documentId: string, content: unknown): Promise<void> => {
      await FSB.writeTopoDocument(requireRootDir(), cardPath, documentId, content)
    },

    renameTopoDocument: async (cardPath: string, documentId: string, title: string): Promise<TopoDocumentManifestItem> => {
      return FSB.renameTopoDocument(requireRootDir(), cardPath, documentId, title)
    },

    updateTopoDocumentMeta: async (cardPath: string, documentId: string, patch: TopoDocumentMetaPatch): Promise<TopoDocumentManifestItem> => {
      return FSB.updateTopoDocumentMeta(requireRootDir(), cardPath, documentId, patch)
    },

    deleteTopoDocument: async (cardPath: string, documentId: string): Promise<void> => {
      await FSB.deleteTopoDocument(requireRootDir(), cardPath, documentId)
    },

    listTrashTopoDocuments: async (cardPath: string) => {
      return FSB.listTrashTopoDocuments(requireRootDir(), cardPath)
    },

    restoreTrashTopoDocument: async (cardPath: string, trashName: string) => {
      return FSB.restoreTrashTopoDocument(requireRootDir(), cardPath, trashName)
    },

    clearTrashTopoDocuments: async (cardPath: string) => {
      await FSB.clearTrashTopoDocuments(requireRootDir(), cardPath)
    },

    moveTopoDocument: async (cardPath: string, documentId: string, newParentId: string | null, newSortOrder: number): Promise<TopoDocumentManifestItem> => {
      return FSB.moveTopoDocument(requireRootDir(), cardPath, documentId, newParentId, newSortOrder)
    },

    moveTopoDocumentToCard: async (cardPath: string, documentId: string, targetCardPath: string): Promise<MoveTopoDocumentToCardResult> => {
      return FSB.moveTopoDocumentToCard(requireRootDir(), cardPath, documentId, targetCardPath)
    },

    moveTopoNodesToRoom: async (sourceRoomPath: string, nodeIds: string[], targetRoomPath: string): Promise<MoveTopoNodesToRoomResult> => {
      return FSB.moveTopoNodesToRoom(requireRootDir(), sourceRoomPath, nodeIds, targetRoomPath)
    },

    repairTopoDocuments: async (cardPath: string) => {
      return FSB.repairTopoDocuments(requireRootDir(), cardPath)
    },

    exportTopoDocument: async (cardPath: string, documentId: string) => {
      return FSB.exportTopoDocument(requireRootDir(), cardPath, documentId)
    },

    openTopoDocumentFolder: async (cardPath: string, documentId: string) => {
      return FSB.openTopoDocumentFolder(requireRootDir(), cardPath, documentId)
    },

    listAttachments: async (cardPath: string) => {
      return FSB.listAttachments(requireRootDir(), cardPath)
    },

    importAttachment: async (cardPath: string, sourceFilePath: string, targetFileName?: string) => {
      return FSB.importAttachment(requireRootDir(), cardPath, sourceFilePath, targetFileName)
    },

    deleteAttachment: async (cardPath: string, attachmentName: string) => {
      await FSB.deleteAttachment(requireRootDir(), cardPath, attachmentName)
    },

    listTrashAttachments: async (cardPath: string) => {
      return FSB.listTrashAttachments(requireRootDir(), cardPath)
    },

    restoreTrashAttachment: async (cardPath: string, trashName: string) => {
      return FSB.restoreTrashAttachment(requireRootDir(), cardPath, trashName)
    },

    clearTrashAttachments: async (cardPath: string) => {
      await FSB.clearTrashAttachments(requireRootDir(), cardPath)
    },

    openAttachment: async (cardPath: string, attachmentRef: string) => {
      return FSB.openAttachment(requireRootDir(), cardPath, attachmentRef)
    },

    showAttachmentInFolder: async (cardPath: string, attachmentRef: string) => {
      return FSB.showAttachmentInFolder(requireRootDir(), cardPath, attachmentRef)
    },

    getAttachmentAbsoluteUrl: async (cardPath: string, attachmentRef: string) => {
      return FSB.getAttachmentAbsoluteUrl(requireRootDir(), cardPath, attachmentRef)
    },

    writeAttachmentBase64: async (cardPath: string, fileName: string, mimeType: string, base64: string) => {
      return FSB.writeAttachmentBase64(requireRootDir(), cardPath, fileName, mimeType, base64)
    },

    downloadAttachment: async (cardPath: string, url: string, targetFileName?: string) => {
      return FSB.downloadAttachment(requireRootDir(), cardPath, url, targetFileName)
    },

    readAttachmentDataUrl: async (cardPath: string, attachmentRef: string) => {
      return FSB.readAttachmentDataUrl(requireRootDir(), cardPath, attachmentRef)
    },

    readConfig: () => {
      return FSB.readAppConfig(requireRootDir())
    },

    writeConfig: async (content: unknown) => {
      await FSB.writeAppConfig(requireRootDir(), content)
    },
  }
}
