import type { TopoDocumentManifestItem, TopoDocumentType } from '../../../core/storage'
import { isPanelDocumentType } from '../../../core/topoDocumentTypes'
import { getTopoDocumentTypeDefinition } from '../services/documentTypeRegistry'

export const TOPO_DOCUMENT_PATH_PREFIX = '__topo__/'

export function topoDocumentPath(documentId: string) {
  return `${TOPO_DOCUMENT_PATH_PREFIX}${documentId}`
}

export function isTopoDocumentPath(documentPath: string | null | undefined) {
  return String(documentPath ?? '').startsWith(TOPO_DOCUMENT_PATH_PREFIX)
}

export function topoDocumentIdFromPath(documentPath: string | null | undefined) {
  const value = String(documentPath ?? '')
  return value.startsWith(TOPO_DOCUMENT_PATH_PREFIX)
    ? value.slice(TOPO_DOCUMENT_PATH_PREFIX.length)
    : null
}

export function topoDocumentTypeLabel(type: TopoDocumentType) {
  return getTopoDocumentTypeDefinition(type).label
}

export function topoDocumentTypeIcon(type: TopoDocumentType) {
  return getTopoDocumentTypeDefinition(type).icon
}

/**
 * 文档树可见性：panel 类型恒可见；画布容器载荷（无 parentId 的 excalidraw /
 * cardspec / image）与已退场 compat 类型继续隐藏，tree.json 与磁盘文件保持原样。
 *
 * 唯一例外是编辑器里新建的**流程图子文档**：它有 parentId，是当前智能文档的
 * 子项，必须能在树里看到 / 重命名 / 删除 / 打开，才有「独立文档便于管理」的意义。
 * 画布容器白板不带 parentId，因此不会被这条例外带出来。
 */
export function isTreeVisibleDocument(doc: TopoDocumentManifestItem): boolean {
  if (isPanelDocumentType(doc.type)) return true
  return doc.type === 'excalidraw' && Boolean(doc.parentId)
}

export function buildDocumentTree(topoDocuments: TopoDocumentManifestItem[]) {
  const sorted = topoDocuments
    .filter(isTreeVisibleDocument)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const documentIds = new Set(sorted.map((doc) => doc.id))
  const documentById = new Map(sorted.map((doc) => [doc.id, doc]))
  const hasValidParent = (doc: TopoDocumentManifestItem) => {
    if (!doc.parentId) return false
    if (!documentIds.has(doc.parentId) || doc.parentId === doc.id) return false
    const visited = new Set<string>([doc.id])
    let parentId: string | null | undefined = doc.parentId
    while (parentId) {
      if (visited.has(parentId)) return false
      visited.add(parentId)
      parentId = documentById.get(parentId)?.parentId
    }
    return true
  }
  
  // Build tree
  const rootItems: TopoDocumentManifestItem[] = []
  const childrenMap: Record<string, TopoDocumentManifestItem[]> = {}
  
  for (const doc of sorted) {
    const parentId = doc.parentId
    if (parentId && hasValidParent(doc)) {
      if (!childrenMap[parentId]) childrenMap[parentId] = []
      childrenMap[parentId].push(doc)
    } else {
      rootItems.push(doc)
    }
  }
  
  return { rootItems, childrenMap }
}
