/**
 * Cytoscape 图谱样式定义。
 * 作为图谱节点、边和状态样式的单一来源，供初始化与运行时共享。
 */
export const GRAPH_STYLE = [
  { selector: 'node.card', style: {
    'shape': 'roundrectangle',
    'font-family': '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'text-wrap': 'wrap', 'text-max-width': '100px',
    'text-justification': 'center',
    'line-height': 1.2,
    'background-color': '#4a6fa5', 'background-opacity': 0.92,
    'color': 'transparent', 'text-opacity': 0, 'font-size': '0px',
    'text-valign': 'center', 'text-halign': 'center',
    'padding': '14px',
    'underlay-color': '#000', 'underlay-opacity': 0.06, 'underlay-padding': 3,
    'transition-property': 'border-color,border-width,opacity',
    'transition-duration': '0.2s',
  }},
  { selector: 'edge[weight="main"]', style: {
    'width': 2, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 1,
    'line-color': '#999', 'target-arrow-color': '#999',
    'label': 'data(relation)', 'font-size': '8px', 'color': '#999',
    'text-rotation': 'autorotate', 'text-margin-y': -8,
    'text-background-color': '#f8f9fb', 'text-background-opacity': 0.9, 'text-background-padding': '2px',
  }},
  { selector: 'edge[relation="演进"]', style: { 'line-color': '#5cb85c', 'target-arrow-color': '#5cb85c' }},
  { selector: 'edge[relation="依赖"]', style: { 'line-color': '#e8913a', 'target-arrow-color': '#e8913a' }},
  { selector: 'edge[weight="minor"]', style: {
    'width': 1, 'line-style': 'dotted', 'line-color': '#ccc',
    'target-arrow-shape': 'none', 'opacity': 0.5, 'curve-style': 'bezier', 'label': '',
  }},
  { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#3498db',
    'underlay-color': '#3498db', 'underlay-opacity': 0.12 }},
  { selector: 'node.highlighted', style: { 'border-width': 3, 'border-color': '#f39c12' }},
  { selector: 'edge.highlighted', style: { 'width': 3, 'opacity': 1, 'z-index': 999 }},
  { selector: 'node.faded', style: { 'opacity': 0.1 }},
  { selector: 'edge.faded', style: { 'opacity': 0.03 }},
  { selector: 'node.search-match', style: { 'border-width': 3, 'border-color': '#f1c40f' }},
]

/**
 * 深拷贝图谱样式定义，避免调用方修改返回值时污染全局样式源。
 *
 * @returns {Array<{selector: string, style: object}>} 克隆后的样式数组
 */
export function cloneGraphStyle() {
  return GRAPH_STYLE.map((entry) => ({
    selector: entry.selector,
    style: { ...entry.style },
  }))
}
