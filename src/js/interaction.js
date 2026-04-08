/**
 * 交互：搜索、悬停、键盘快捷、连线手柄
 */

// --- 节点点击/双击 ---
cy.on('tap', 'node', function(evt) {
  var node = evt.target;
  if (node.hasClass('hidden') || node.hasClass('room-active')) return;
  if (selectedNode) selectedNode.removeClass('selected');
  node.addClass('selected'); selectedNode = node;
  showDetail(node.id());
});

cy.on('dbltap', 'node', function(evt) {
  var node = evt.target;
  if (node.hasClass('hidden') || node.hasClass('room-active')) return;
  drillInto(node.id());
});

cy.on('dbltap', function(evt) {
  if (evt.target !== cy) return;
  var pos = evt.position;
  showInlineInput(pos, function(name) {
    if (name && name.trim()) quickAddChild(currentRoom, name.trim());
  });
});

cy.on('tap', function(evt) {
  if (evt.target === cy) {
    if (selectedNode) { selectedNode.removeClass('selected'); selectedNode = null; }
    clearHandles();
    showPlaceholder();
  }
});

// --- 悬停高亮 ---
cy.on('mouseover', 'node', function(evt) {
  var node = evt.target;
  if (node.hasClass('hidden') || node.hasClass('room-active')) return;
  var conn = node.connectedEdges().not('.hidden');
  var connN = conn.connectedNodes().not('.hidden');
  cy.elements().not('.hidden').addClass('faded');
  node.removeClass('faded').addClass('highlighted');
  if (node.isParent()) node.children().not('.hidden').removeClass('faded');
  conn.removeClass('faded').addClass('highlighted');
  connN.removeClass('faded').addClass('highlighted');
  connN.forEach(function(n) { if (n.isParent()) n.children().not('.hidden').removeClass('faded'); });
});
cy.on('mouseout', 'node', function() { cy.elements().removeClass('faded highlighted'); });

// --- 搜索 ---
var searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', function() {
  var q = this.value.trim().toLowerCase();
  cy.nodes().removeClass('search-match');
  if (!q) return;
  cy.nodes().forEach(function(n) {
    if ((n.data('label') || '').toLowerCase().includes(q) || n.id().toLowerCase().includes(q)) n.addClass('search-match');
  });
});
searchInput.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { this.value = ''; cy.nodes().removeClass('search-match'); }
});

// --- 键盘快捷 ---
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(function(m) { m.classList.remove('active'); });
  }
  var isInput = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';
  var hasModal = document.querySelector('.modal-overlay.active');
  if (e.key === 'Backspace' && !isInput && !hasModal && currentRoom !== null) { e.preventDefault(); goBack(); }
  if (e.key === 'Tab' && selectedNode && !isInput && !hasModal) { e.preventDefault(); showInlineInput(selectedNode.position(), function(name) { if (name && name.trim()) quickAddChild(selectedNode.id(), name.trim()); }); }
  if (e.key === 'Delete' && selectedNode && !isInput && !hasModal) { e.preventDefault(); confirmDeleteNode(selectedNode); }
});

// --- 缩放控制 ---
document.getElementById('btn-zoomin').addEventListener('click', function() { cy.animate({ zoom: cy.zoom() * 1.3 }, { duration: 200 }); });
document.getElementById('btn-zoomout').addEventListener('click', function() { cy.animate({ zoom: cy.zoom() / 1.3 }, { duration: 200 }); });
document.getElementById('btn-fit').addEventListener('click', function() { cy.animate({ fit: { padding: 50 } }, { duration: 300 }); });
cy.on('zoom', function() { updateZoomIndicator(); });

// --- 内联输入框 ---
function showInlineInput(cyPos, callback) {
  var input = document.getElementById('inline-input');
  var container = document.getElementById('cy').getBoundingClientRect();
  var pan = cy.pan(), zoom = cy.zoom();
  var screenX = cyPos.x * zoom + pan.x + container.left;
  var screenY = cyPos.y * zoom + pan.y + container.top;
  input.value = '';
  input.style.display = 'block';
  input.style.left = (screenX - 80) + 'px';
  input.style.top = (screenY - 16) + 'px';
  input.focus();
  function done() {
    var val = input.value;
    input.style.display = 'none';
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('blur', onBlur);
    callback(val);
  }
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); done(); }
    if (e.key === 'Escape') { input.style.display = 'none'; input.removeEventListener('keydown', onKey); input.removeEventListener('blur', onBlur); }
  }
  function onBlur() { done(); }
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', onBlur);
}

// --- 拖拽连线：箭头手柄 ---
// renderedBoundingBox() returns coords relative to #cy container.
// #edge-handles and #drag-line SVGs are position:absolute inside #graph-panel,
// and #cy fills #graph-panel from (0,0), so the coordinate spaces match directly.
var handlesSvg = document.getElementById('edge-handles');
var dragLineEl = document.getElementById('drag-line-line');
var draggingEdge = false;
var dragSourceNode = null;

function screenToCy(clientX, clientY) {
  var pan = cy.pan(), zoom = cy.zoom();
  var rect = document.getElementById('cy').getBoundingClientRect();
  return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
}

function renderHandles(node) {
  handlesSvg.innerHTML = '';
  handlesSvg.style.pointerEvents = 'none';
  if (!node || node.hasClass('hidden') || node.hasClass('room-active')) return;
  handlesSvg.style.pointerEvents = 'auto';

  var bb = node.renderedBoundingBox();  // coords relative to #cy container (= panel-local)

  var cx = (bb.x1 + bb.x2) / 2;
  var cy2 = (bb.y1 + bb.y2) / 2;
  var hw = (bb.x2 - bb.x1) / 2 + 18;
  var hh = (bb.y2 - bb.y1) / 2 + 18;

  [
    { dx: 0,   dy: -hh },
    { dx: 0,   dy:  hh },
    { dx: -hw, dy:  0  },
    { dx:  hw, dy:  0  }
  ].forEach(function(d) {
    var hx = cx + d.dx;
    var hy = cy2 + d.dy;

    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.style.pointerEvents = 'all';
    g.style.cursor = 'crosshair';

    var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', hx);
    circle.setAttribute('cy', hy);
    circle.setAttribute('r', '8');
    circle.setAttribute('fill', '#3498db');
    circle.setAttribute('opacity', '0.85');
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '2');

    var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', hx);
    txt.setAttribute('y', hy + 4);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('fill', '#fff');
    txt.setAttribute('pointer-events', 'none');
    txt.textContent = '→';

    g.appendChild(circle);
    g.appendChild(txt);

    g.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      draggingEdge = true;
      dragSourceNode = node;
      // drag-line SVG is also panel-relative
      dragLineEl.setAttribute('x1', hx);
      dragLineEl.setAttribute('y1', hy);
      dragLineEl.setAttribute('x2', hx);
      dragLineEl.setAttribute('y2', hy);
      dragLineEl.removeAttribute('display');
    });

    handlesSvg.appendChild(g);
  });
}

function clearHandles() { handlesSvg.innerHTML = ''; handlesSvg.style.pointerEvents = 'none'; }

cy.on('tap', 'node', function(evt) {
  if (evt.target.hasClass('hidden') || evt.target.hasClass('room-active')) return;
  setTimeout(function() { renderHandles(evt.target); }, 0);
});
cy.on('pan zoom', function() {
  if (selectedNode) renderHandles(selectedNode);
});

document.addEventListener('mousemove', function(e) {
  if (!draggingEdge) return;
  var rect = document.getElementById('cy').getBoundingClientRect();
  dragLineEl.setAttribute('x2', e.clientX - rect.left);
  dragLineEl.setAttribute('y2', e.clientY - rect.top);
});

document.addEventListener('mouseup', function(e) {
  if (!draggingEdge) return;
  draggingEdge = false;
  dragLineEl.setAttribute('display', 'none');

  var cyPos = screenToCy(e.clientX, e.clientY);
  var target = null;
  cy.nodes().not('.hidden').not('.room-active').forEach(function(n) {
    if (n.id() === dragSourceNode.id()) return;
    var bb = n.boundingBox();
    if (cyPos.x >= bb.x1 && cyPos.x <= bb.x2 && cyPos.y >= bb.y1 && cyPos.y <= bb.y2) target = n;
  });

  if (target) {
    cy.add({ group: 'edges', data: { id: nextEdgeId(), source: dragSourceNode.id(), target: target.id(), relation: '依赖', weight: 'main' } });
    saveState();
  }
  dragSourceNode = null;
});
