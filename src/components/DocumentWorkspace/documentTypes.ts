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
  if (type === 'markdown') return 'Markdown'
  if (type === 'smart') return '智能文档'
  if (type === 'mindmap') return '思维导图'
  return '流程图'
}

export function topoDocumentTypeIcon(type: TopoDocumentType) {
  if (type === 'markdown') return '📝'
  if (type === 'smart') return '✨'
  if (type === 'mindmap') return '🧠'
  return '🔀'
}

export function buildDocumentTree(topoDocuments: TopoDocumentManifestItem[]) {
  // Sort by sortOrder first
  const sorted = [...topoDocuments].sort((a, b) => a.sortOrder - b.sortOrder)
  
  // Build tree
  const rootItems: TopoDocumentManifestItem[] = []
  const childrenMap: Record<string, TopoDocumentManifestItem[]> = {}
  
  for (const doc of sorted) {
    if (doc.parentId) {
      if (!childrenMap[doc.parentId]) childrenMap[doc.parentId] = []
      childrenMap[doc.parentId].push(doc)
    } else {
      rootItems.push(doc)
    }
  }
  
  return { rootItems, childrenMap }
}
