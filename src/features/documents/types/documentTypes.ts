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

export function buildDocumentTree(topoDocuments: TopoDocumentManifestItem[]) {
  // 文档树只渲染 panel surface：container-only 载荷与已退场的 compat 类型都在这里隐藏，
  // 但 tree.json 与磁盘文件保持原样，绝不写回删除条目。
  const sorted = topoDocuments
    .filter((doc) => isPanelDocumentType(doc.type))
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
