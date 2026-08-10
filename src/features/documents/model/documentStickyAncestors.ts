import type { TopoDocumentManifestItem } from '../../../core/storage'

export interface VisibleDocumentTreeRow {
  node: TopoDocumentManifestItem
  level: number
  ancestorIds: string[]
}

export interface DocumentTreeRowLayout {
  row: VisibleDocumentTreeRow
  top: number
  bottom: number
  stackHeight?: number
}

export function flattenVisibleDocumentTree(
  rootItems: TopoDocumentManifestItem[],
  childrenMap: Record<string, TopoDocumentManifestItem[]>,
  expandedNodes: Set<string>,
): VisibleDocumentTreeRow[] {
  const rows: VisibleDocumentTreeRow[] = []
  const visit = (
    nodes: TopoDocumentManifestItem[],
    level: number,
    ancestorIds: string[],
  ) => {
    for (const node of nodes) {
      rows.push({ node, level, ancestorIds })
      if (!expandedNodes.has(node.id)) continue
      const children = childrenMap[node.id]
      if (!children?.length) continue
      visit(children, level + 1, [...ancestorIds, node.id])
    }
  }

  visit(rootItems, 0, [])
  return rows
}

export function resolveStickyDocumentAncestorIds(
  layouts: DocumentTreeRowLayout[],
  scrollTop: number,
  layoutById: ReadonlyMap<string, DocumentTreeRowLayout> = new Map(
    layouts.map((layout) => [layout.row.node.id, layout]),
  ),
): string[] {
  if (layouts.length === 0 || scrollTop <= 0) return []

  const findFirstVisible = (visibleTop: number) => {
    let low = 0
    let high = layouts.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (layouts[middle].bottom <= visibleTop) low = middle + 1
      else high = middle
    }
    return layouts[low]
  }

  let stickyIds: string[] = []
  for (let pass = 0; pass <= layouts.length; pass += 1) {
    const stickyHeight = stickyIds.reduce((height, id) => {
      const layout = layoutById.get(id)
      return height + (layout ? Math.max(0, layout.stackHeight ?? layout.bottom - layout.top) : 0)
    }, 0)
    const firstVisibleLayout = findFirstVisible(scrollTop + stickyHeight)
    if (!firstVisibleLayout) return stickyIds

    const nextStickyIds: string[] = []
    let occupiedHeight = 0
    for (const ancestorId of firstVisibleLayout.row.ancestorIds) {
      const ancestorLayout = layoutById.get(ancestorId)
      if (!ancestorLayout || ancestorLayout.bottom > scrollTop + occupiedHeight) break
      nextStickyIds.push(ancestorId)
      occupiedHeight += Math.max(0, ancestorLayout.stackHeight ?? ancestorLayout.bottom - ancestorLayout.top)
    }

    if (
      nextStickyIds.length === stickyIds.length
      && nextStickyIds.every((id, index) => id === stickyIds[index])
    ) {
      return nextStickyIds
    }
    stickyIds = nextStickyIds
  }

  return stickyIds
}
