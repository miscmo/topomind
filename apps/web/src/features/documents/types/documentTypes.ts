import type { TopoDocumentManifestItem, TopoDocumentType } from '../../../core/storage'
import { getTopoDocumentTypeDefinition } from '../services/documentTypeRegistry'

export const TOPO_DOCUMENT_KEY_PREFIX = '__topo__/'

export function topoDocumentKey(documentId: string) {
  return `${TOPO_DOCUMENT_KEY_PREFIX}${documentId}`
}

export function isTopoDocumentKey(documentKey: string | null | undefined) {
  return String(documentKey ?? '').startsWith(TOPO_DOCUMENT_KEY_PREFIX)
}

export function topoDocumentIdFromKey(documentKey: string | null | undefined) {
  const value = String(documentKey ?? '')
  return value.startsWith(TOPO_DOCUMENT_KEY_PREFIX)
    ? value.slice(TOPO_DOCUMENT_KEY_PREFIX.length)
    : null
}

export function topoDocumentTypeLabel(type: TopoDocumentType) {
  return getTopoDocumentTypeDefinition(type).label
}

export function topoDocumentTypeIcon(type: TopoDocumentType) {
  return getTopoDocumentTypeDefinition(type).icon
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
