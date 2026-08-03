export interface DocumentSidebarStateStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function getExpandedDocumentNodesStorageKey(nodeId: string): string {
  return `topomind_expanded_nodes_${nodeId}`
}

export function getDocumentSidebarScrollStorageKey(nodeId: string): string {
  return `topomind_document_sidebar_scroll_${nodeId}`
}

export function parseExpandedDocumentNodeIds(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return Array.from(new Set(parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
  } catch {
    return []
  }
}

export function loadExpandedDocumentNodeIds(
  storage: DocumentSidebarStateStorage,
  nodeId: string | undefined,
): Set<string> {
  if (!nodeId) return new Set()
  return new Set(parseExpandedDocumentNodeIds(storage.getItem(getExpandedDocumentNodesStorageKey(nodeId))))
}

export function saveExpandedDocumentNodeIds(
  storage: DocumentSidebarStateStorage,
  nodeId: string | undefined,
  expandedNodeIds: Iterable<string>,
): void {
  if (!nodeId) return
  storage.setItem(
    getExpandedDocumentNodesStorageKey(nodeId),
    JSON.stringify(Array.from(new Set(expandedNodeIds))),
  )
}

export function loadDocumentSidebarScrollTop(
  storage: DocumentSidebarStateStorage,
  nodeId: string | undefined,
): number {
  if (!nodeId) return 0
  const value = Number(storage.getItem(getDocumentSidebarScrollStorageKey(nodeId)))
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function saveDocumentSidebarScrollTop(
  storage: DocumentSidebarStateStorage,
  nodeId: string | undefined,
  scrollTop: number,
): void {
  if (!nodeId || !Number.isFinite(scrollTop)) return
  storage.setItem(getDocumentSidebarScrollStorageKey(nodeId), String(Math.max(0, scrollTop)))
}
