import type { TopoDocumentManifestItem, TopoDocumentType } from '../../core/storage'

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
  if (type === 'smart') return '智能文档'
  if (type === 'mindmap') return '思维导图'
  return '流程图'
}

export function topoDocumentTypeIcon(type: TopoDocumentType) {
  if (type === 'smart') return '✨'
  if (type === 'mindmap') return '🧠'
  return '🔀'
}

export function buildDocumentTree(topoDocuments: TopoDocumentManifestItem[]) {
  // Sort by sortOrder first
  const sorted = [...topoDocuments].sort((a, b) => a.sortOrder - b.sortOrder)
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
