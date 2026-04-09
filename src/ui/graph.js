/**
 * Cytoscape 图谱引擎初始化
 */
var cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [],
  minZoom: 0.15, maxZoom: 3.5,
  userZoomingEnabled: false,    // 禁用内置滚轮缩放（手动实现）
  userPanningEnabled: false,    // 禁用左键拖拽画布（改为右键拖拽）
  boxSelectionEnabled: true,    // 启用左键框选
  selectionType: 'additive',    // 框选追加模式
  style: [
    { selector: 'node.card', style: {
      'shape': 'roundrectangle', 'label': 'data(label)',
      'font-family': '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'text-wrap': 'wrap', 'text-max-width': '100px',
      'background-color': '#4a6fa5', 'background-opacity': 0.92,
      'color': '#fff', 'font-size': '12px',
      'text-valign': 'center', 'text-halign': 'center',
      'width': 'fit-to-label', 'height': 'fit-to-label', 'padding': '14px',
      'underlay-color': '#000', 'underlay-opacity': 0.06, 'underlay-padding': 3,
      'transition-property': 'background-color,border-color,border-width,opacity',
      'transition-duration': '0.3s',
    }},
    // 主线边
    { selector: 'edge[weight="main"]', style: {
      'width': 2, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 1,
      'label': 'data(relation)', 'font-size': '8px', 'color': '#999',
      'text-rotation': 'autorotate', 'text-margin-y': -8,
      'text-background-color': '#f8f9fb', 'text-background-opacity': 0.9, 'text-background-padding': '2px',
    }},
    { selector: 'edge[relation="演进"]', style: { 'line-color': '#5cb85c', 'target-arrow-color': '#5cb85c' }},
    { selector: 'edge[relation="依赖"]', style: { 'line-color': '#e8913a', 'target-arrow-color': '#e8913a' }},
    // 次线边
    { selector: 'edge[weight="minor"]', style: {
      'width': 1, 'line-style': 'dotted', 'line-color': '#ccc',
      'target-arrow-shape': 'none', 'opacity': 0.5, 'curve-style': 'bezier', 'label': '',
    }},
    // 状态
    { selector: 'node.selected', style: { 'border-width': 3, 'border-color': '#3498db' }},
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#3498db',
      'underlay-color': '#3498db', 'underlay-opacity': 0.12 }},
    { selector: 'node.highlighted', style: { 'border-width': 3, 'border-color': '#f39c12' }},
    { selector: 'edge.highlighted', style: { 'width': 3, 'opacity': 1, 'z-index': 999 }},
    { selector: 'node.faded', style: { 'opacity': 0.1 }},
    { selector: 'edge.faded', style: { 'opacity': 0.03 }},
    { selector: 'node.search-match', style: { 'border-width': 3, 'border-color': '#f1c40f' }},
  ]
});
