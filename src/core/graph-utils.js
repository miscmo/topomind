/**
 * 图谱工具函数
 * 从 useGraph.js 提取的纯函数和工具函数，不依赖 composable 内部状态。
 * 所有需要 cy/storage/logger 的函数通过参数传入。
 */
import { GraphConstants } from '@/core/graph-constants.js'
import { logger } from '@/core/logger.js'

// ─── 边 ID 生成器 ─────────────────────────────────────────────
let _edgeCounter = 0

/**
 * 生成图边的唯一 ID，并在计数器达到上限后自动回绕。
 *
 * @returns {string} 边 ID
 */
export function autoEdgeId() {
  if (_edgeCounter > GraphConstants.EDGE_COUNTER_CAP) {
    _edgeCounter = GraphConstants.EDGE_COUNTER_INITIAL
  }
  return `e-${Date.now()}-${_edgeCounter++}`
}

// ─── 卡片去重 ─────────────────────────────────────────────────
/**
 * 按卡片路径去重，并过滤无效卡片对象。
 *
 * @param {Array<object>} cards 原始卡片数组
 * @returns {Array<object>} 去重后的卡片数组
 */
export function deduplicateCards(cards) {
  const unique = []
  const seen = new Set()
  for (const card of cards) {
    if (!card || typeof card !== 'object' || !card.path) continue
    if (seen.has(card.path)) continue
    seen.add(card.path)
    unique.push(card)
  }
  return unique
}

// ─── 边去重 ───────────────────────────────────────────────────
/**
 * 遍历边数据并按边 ID 去重后回调输出。
 * 兼容 `source/target` 与 `from/to` 两种字段命名。
 *
 * @param {Array<object>} edges 原始边数组
 * @param {(edge: object) => void} addEdgeFn 去重后边数据的消费函数
 * @returns {void}
 */
export function deduplicateEdges(edges, addEdgeFn) {
  const seenIds = new Set()
  for (const e of edges) {
    if (!e) continue
    const source = e.source || e.from
    const target = e.target || e.to
    if (!source || !target) continue
    const edgeId = e.id || autoEdgeId()
    if (seenIds.has(edgeId)) continue
    seenIds.add(edgeId)
    addEdgeFn({
      id: edgeId,
      source,
      target,
      relation: e.relation || GraphConstants.EDGE_DEFAULT_LABEL,
      weight: e.weight || 'minor',
    })
  }
}

// ─── 显示名称提取 ──────────────────────────────────────────────
/**
 * 从保存数据、卡片对象或路径中提取节点显示名称。
 *
 * @param {object} card 卡片对象
 * @param {object} saved 已保存的节点元数据
 * @returns {string} 显示名称
 */
export function extractDisplayName(card, saved) {
  if (saved && typeof saved.name === 'string' && saved.name.trim()) {
    return saved.name
  }
  if (card && typeof card.name === 'string' && card.name.trim()) {
    return card.name
  }
  const path = card?.path || ''
  return path.split('/').pop() || '未命名卡片'
}

// ─── 节点 data 对象构建 ───────────────────────────────────────
/**
 * 根据卡片对象与保存的元数据构建 Cytoscape 节点 data。
 *
 * @param {object} card 卡片对象
 * @param {object} saved 已保存的节点元数据
 * @returns {object} Cytoscape 节点 data
 */
export function buildCardData(card, saved) {
  const displayName = extractDisplayName(card, saved)
  return {
    id: card.path,
    label: displayName,
    cardPath: card.path,
    color: saved.color || '',
    fontColor: saved.fontColor || '',
    fontSize: saved.fontSize || 0,
    fontStyle: saved.fontStyle || '',
    textAlign: saved.textAlign || '',
    textWrap: saved.textWrap !== undefined ? saved.textWrap : true,
    nodeWidth: saved.nodeWidth || '',
    nodeHeight: saved.nodeHeight || '',
    borderColor: saved.borderColor || '',
    borderWidth: saved.borderWidth || 0,
    nodeShape: saved.nodeShape || '',
    nodeOpacity: saved.nodeOpacity != null ? saved.nodeOpacity : 1,
  }
}

// ─── 节点初始样式应用 ─────────────────────────────────────────
/**
 * 将节点 data 与保存的位置、样式信息应用到 Cytoscape 元素。
 *
 * @param {import('cytoscape').NodeSingular} ele 节点元素
 * @param {object} data 节点 data
 * @param {object} saved 已保存的节点元数据
 * @returns {void}
 */
export function applyNodeStyle(ele, data, saved) {
  if (data.color) ele.style('background-color', data.color)
  if (data.fontColor) ele.style('color', data.fontColor)
  if (data.fontSize) ele.style('font-size', data.fontSize + 'px')
  if (data.fontStyle) {
    const styles = data.fontStyle.split(' ')
    if (styles.includes('bold')) ele.style('font-weight', 'bold')
    if (styles.includes('italic')) ele.style('font-style', 'italic')
  }
  if (data.textAlign) ele.style('text-halign', data.textAlign)
  if (!data.textWrap) ele.style('text-wrap', 'none')
  if (data.nodeWidth) {
    ele.style('width', data.nodeWidth + 'px')
    ele.style('text-max-width', data.nodeWidth + 'px')
  }
  if (data.nodeHeight) ele.style('height', data.nodeHeight + 'px')
  if (data.borderColor) ele.style('border-color', data.borderColor)
  if (data.borderWidth) ele.style('border-width', data.borderWidth + 'px')
  if (data.nodeShape) ele.style('shape', data.nodeShape)
  if (data.nodeOpacity != null && data.nodeOpacity !== 1) {
    ele.style('opacity', data.nodeOpacity)
  }
  if (saved?.posX !== undefined && saved?.posY !== undefined) {
    ele.position({ x: saved.posX, y: saved.posY })
  }
}

// ─── 样式 key → Cytoscape 样式函数映射 ────────────────────────
function mapStyleValue(key, value, node) {
  switch (key) {
    case 'color': return () => node.style('background-color', value)
    case 'fontColor': return () => node.style('color', value)
    case 'fontSize': return () => node.style('font-size', value + 'px')
    case 'textAlign': return () => node.style('text-halign', value)
    case 'nodeWidth':
      return () => {
        node.style('width', value ? value + 'px' : 'auto')
        node.style('text-max-width', value ? value + 'px' : '100px')
      }
    case 'nodeHeight':
      return () => node.style('height', value ? value + 'px' : 'auto')
    case 'borderColor':
      return () => {
        node.style('border-color', value)
        const bw = parseFloat(node.style('border-width')) || 0
        if (bw === 0) node.style('border-width', '1px')
      }
    case 'borderWidth':
      return () => {
        node.style('border-width', value + 'px')
        const bc = node.data('borderColor')
        if (bc) node.style('border-color', bc)
      }
    case 'nodeShape': return () => node.style('shape', value)
    case 'nodeOpacity': return () => node.style('opacity', value)
    default: return null
  }
}

// ─── 批量节点样式更新 ─────────────────────────────────────────
/**
 * 批量更新节点样式与对应 data 字段，并按需刷新 HTML 标签。
 *
 * @param {import('cytoscape').Core} cy Cytoscape 实例
 * @param {import('cytoscape').CollectionReturnValue} targets 目标节点集合
 * @param {object} styles 样式键值对
 * @param {(nodes?: any) => void} [refreshLabelsFn] 标签刷新函数
 * @returns {void}
 */
export function updateNodeStyle(cy, targets, styles, refreshLabelsFn) {
  if (!cy || !targets?.length) return
  targets.forEach((node) => {
    Object.entries(styles).forEach(([key, value]) => {
      node.data(key, value)
      const setter = mapStyleValue(key, value, node)
      setter?.()
    })
  })
  refreshLabelsFn?.(targets)
}

// ─── 字体样式更新（粗体/斜体） ────────────────────────────────
export function updateNodeFontStyle(cy, targets, style, active, refreshLabelsFn) {
  if (!cy || !targets?.length) return
  targets.forEach((node) => {
    let current = (node.data('fontStyle') || '').split(' ').filter(Boolean)
    if (active) { if (!current.includes(style)) current.push(style) }
    else current = current.filter(s => s !== style)
    const fontStyle = current.join(' ')
    node.data('fontStyle', fontStyle)
    node.style('font-weight', current.includes('bold') ? 'bold' : 'normal')
    node.style('font-style', current.includes('italic') ? 'italic' : 'normal')
  })
  refreshLabelsFn?.(targets)
}

// ─── 批量改色 ─────────────────────────────────────────────────
export function batchSetColor(cy, targets, color) {
  if (!cy || !targets?.length) return
  targets.forEach(node => {
    node.data('color', color)
    node.style('background-color', color)
  })
}

// ─── 加载节点徽标数据 ─────────────────────────────────────────
/**
 * 异步加载每个节点的子卡片数量和文档存在状态，用于徽标显示。
 *
 * @param {import('cytoscape').Core} cy Cytoscape 实例
 * @param {object} storage 存储层对象
 * @returns {Promise<void>} 加载结果
 */
export async function loadNodeBadges(cy, storage) {
  if (!cy) return
  const nodeIds = cy.nodes().map(n => n.id())
  await Promise.all(nodeIds.map(async (id) => {
    const [children, md] = await Promise.all([
      storage.listCards(id).catch((e) => { logger.catch('graph-utils', 'listCards', e); return [] }),
      storage.readMarkdown(id).catch((e) => { logger.catch('graph-utils', 'readMarkdown', e); return '' }),
    ])
    const node = cy?.getElementById(id)
    if (!node?.length) return
    node.data('childCount', children.length)
    node.data('hasDoc', !!(md && md.trim().length > 0))
  }))
}

// ─── 构建 meta 对象 ───────────────────────────────────────────
/**
 * 根据当前图谱状态构建可持久化的 meta 对象。
 *
 * @param {import('cytoscape').Core} cy Cytoscape 实例
 * @param {object|null} currentMeta 当前已加载的元数据
 * @param {object} grid 网格控制对象
 * @returns {object|null} 可保存的 meta 对象
 */
export function buildCurrentMeta(cy, currentMeta, grid) {
  if (!cy) return null
  const children = {}
  cy.nodes().forEach(n => {
    const d = n.data()
    const pos = n.position()
    children[d.cardPath || d.id] = {
      name: d.label,
      color: d.color || undefined,
      fontColor: d.fontColor || undefined,
      fontSize: d.fontSize || undefined,
      fontStyle: d.fontStyle || undefined,
      textAlign: d.textAlign || undefined,
      textWrap: d.textWrap !== false ? undefined : false,
      nodeWidth: d.nodeWidth || undefined,
      nodeHeight: d.nodeHeight || undefined,
      borderColor: d.borderColor || undefined,
      borderWidth: d.borderWidth || undefined,
      nodeShape: d.nodeShape || undefined,
      nodeOpacity: d.nodeOpacity !== 1 ? d.nodeOpacity : undefined,
      posX: pos.x,
      posY: pos.y,
    }
  })
  const edges = cy.edges().map(e => ({
    id: e.id(),
    source: e.data('source'),
    target: e.data('target'),
    relation: e.data('relation'),
    weight: e.data('weight'),
  }))
  const viewport = { zoom: cy.zoom(), pan: cy.pan() }
  return {
    ...(currentMeta || {}),
    children,
    edges,
    zoom: viewport.zoom,
    pan: viewport.pan,
    canvasBounds: grid?.getCanvasBounds?.(),
  }
}

// ─── 强制刷新 HTML 标签 ────────────────────────────────────────
/**
 * 触发节点的 `data` 事件，强制刷新 HTML Label 插件渲染结果。
 *
 * @param {import('cytoscape').Core} cy Cytoscape 实例
 * @param {import('cytoscape').CollectionReturnValue} [nodes] 目标节点集合
 * @returns {void}
 */
export function refreshHtmlLabels(cy, nodes) {
  if (!cy) return
  const targets = nodes || cy.nodes()
  targets.forEach((n) => {
    if (n.isNode() && n.hasClass('card')) {
      try { n.emit('data') } catch (e) { logger.warn('graph-utils', 'emit data event', e) }
    }
  })
}
