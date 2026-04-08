/**
 * Cytoscape 图谱引擎初始化和样式
 */
function dc(nodeId) {
  return DOMAIN_COLORS[nodeId] || { bg: '#666', border: '#555', light: '#eee' };
}

function nodeColor(node) {
  var id = node.id();
  if (DOMAIN_COLORS[id]) return dc(id);
  var p = node.parent();
  while (p && p.length) {
    if (DOMAIN_COLORS[p.id()]) return dc(p.id());
    p = p.parent();
  }
  return dc(id);
}

var cy = cytoscape({
  container: document.getElementById('cy'),
  elements: { nodes: graphNodes, edges: graphEdges },
  minZoom: 0.15, maxZoom: 3.5, wheelSensitivity: 0.2,
  style: [
    { selector: 'node.card', style: {
      'shape': 'roundrectangle', 'label': 'data(label)',
      'font-family': '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'text-wrap': 'wrap', 'text-max-width': '100px',
      'transition-property': 'background-color,border-color,border-width,opacity,padding',
      'transition-duration': '0.3s',
    }},
    { selector: 'node.card:parent', style: {
      'background-color': function(n) { return dc(n.id()).light || '#f5f6f8'; },
      'background-opacity': 0.7, 'border-width': 2,
      'border-color': function(n) { return dc(n.id()).bg || '#aaa'; },
      'border-opacity': 0.45, 'border-style': 'solid',
      'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': -4,
      'font-size': '13px', 'font-weight': 'bold',
      'color': function(n) { return dc(n.id()).border || '#555'; },
      'text-background-color': function(n) { return dc(n.id()).light || '#f5f6f8'; },
      'text-background-opacity': 0.9, 'text-background-padding': '4px',
      'text-background-shape': 'roundrectangle',
      'padding': '30px', 'min-width': '60px', 'min-height': '20px', 'corner-radius': 12,
      'underlay-color': '#000', 'underlay-opacity': 0.06, 'underlay-padding': 4, 'underlay-shape': 'roundrectangle',
    }},
    { selector: 'node.card:childless', style: {
      'background-color': function(n) { return nodeColor(n).bg; },
      'background-opacity': 0.92, 'border-width': 0,
      'text-valign': 'center', 'text-halign': 'center',
      'font-size': '11px', 'font-weight': 'normal', 'color': '#fff',
      'width': 'label', 'height': 'label', 'padding': '11px', 'corner-radius': 8,
      'underlay-color': '#000', 'underlay-opacity': 0.08, 'underlay-padding': 3, 'underlay-shape': 'roundrectangle',
    }},
    { selector: 'edge[weight="main"]', style: {
      'width': 2, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 1,
      'font-size': '8px', 'color': '#999', 'text-background-color': '#f8f9fb',
      'text-background-opacity': 0.9, 'text-background-padding': '2px',
      'text-rotation': 'autorotate', 'text-margin-y': -8, 'label': '',
    }},
    { selector: 'edge[relation="演进"][weight="main"]', style: { 'line-color': '#5cb85c', 'target-arrow-color': '#5cb85c', 'label': '演进' }},
    { selector: 'edge[relation="依赖"][weight="main"]', style: { 'line-color': '#e8913a', 'target-arrow-color': '#e8913a', 'label': '依赖' }},
    { selector: 'edge[weight="minor"]', style: {
      'width': 1, 'line-style': 'dotted', 'line-color': '#ccc', 'target-arrow-shape': 'none', 'opacity': 0.4,
      'curve-style': 'unbundled-bezier', 'control-point-distances': [20], 'control-point-weights': [0.5], 'label': '',
    }},
    { selector: 'node.selected', style: { 'border-width': 3, 'border-color': '#3498db', 'border-opacity': 1 }},
    { selector: 'node.card:childless.selected', style: { 'border-width': 2, 'border-color': '#fff' }},
    { selector: 'node.highlighted', style: { 'border-width': 3, 'border-color': '#f39c12', 'border-opacity': 1 }},
    { selector: 'edge.highlighted', style: { 'width': 3, 'opacity': 1, 'z-index': 999 }},
    { selector: 'node.faded', style: { 'opacity': 0.1 }},
    { selector: 'edge.faded', style: { 'opacity': 0.03 }},
    { selector: 'node.search-match', style: { 'border-width': 3, 'border-color': '#f1c40f', 'border-opacity': 1 }},
    { selector: '.hidden', style: { 'display': 'none' }},
    { selector: 'node.card.collapsed-hint', style: { 'border-style': 'dashed', 'border-opacity': 0.4 }},
    { selector: 'node.room-active', style: {
      'background-opacity': 0, 'border-width': 0, 'border-opacity': 0, 'label': '', 'text-opacity': 0,
      'underlay-opacity': 0, 'padding': '0px', 'min-width': '0px', 'min-height': '0px', 'events': 'no',
    }},
  ]
});
