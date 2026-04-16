/**
 * Meta 规范化工具
 */
export function normalizeMeta(metaRaw) {
  const meta = (metaRaw && typeof metaRaw === 'object' && !Array.isArray(metaRaw)) ? metaRaw : {}
  const zoom = (typeof meta.zoom === 'number' && Number.isFinite(meta.zoom)) ? meta.zoom : null
  const pan = (meta.pan && typeof meta.pan === 'object' && Number.isFinite(meta.pan.x) && Number.isFinite(meta.pan.y))
    ? { x: meta.pan.x, y: meta.pan.y }
    : null
  const canvasBounds = (meta.canvasBounds && typeof meta.canvasBounds === 'object') ? meta.canvasBounds : null

  const rawEdges = Array.isArray(meta.edges) ? meta.edges : []
  const edges = rawEdges
    .map((e) => {
      if (!e || typeof e !== 'object') return null
      const source = e.source || e.from || ''
      const target = e.target || e.to || ''
      if (!source || !target) return null
      return {
        id: e.id,
        source,
        target,
        relation: e.relation || '相关',
        weight: e.weight || 'minor',
      }
    })
    .filter(Boolean)

  return {
    name: (typeof meta.name === 'string' && meta.name.trim()) ? meta.name : '',
    children: (meta.children && typeof meta.children === 'object' && !Array.isArray(meta.children)) ? meta.children : {},
    edges,
    zoom,
    pan,
    canvasBounds,
  }
}
