/**
 * 将原始图元数据规范化为稳定结构，过滤非法字段并补齐默认值。
 * 主要用于读写 `_graph.json` 时统一 children、edges、viewport 等字段格式。
 *
 * @param {object} metaRaw 原始元数据对象
 * @returns {{children: object, edges: Array<object>, zoom: number|null, pan: {x:number,y:number}|null, canvasBounds: object|null}} 规范化后的元数据
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
    children: (meta.children && typeof meta.children === 'object' && !Array.isArray(meta.children)) ? meta.children : {},
    edges,
    zoom,
    pan,
    canvasBounds,
  }
}
