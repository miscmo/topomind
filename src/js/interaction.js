/**
 * 交互：搜索、悬停、键盘快捷
 */

// --- 节点点击/双击 ---
cy.on('tap', 'node', function(evt) {
  if (edgeMode && edgeModeSource) return;
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
  var name = prompt('输入新卡片名称：');
  if (name && name.trim()) quickAddChild(currentRoom, name.trim());
});

cy.on('tap', function(evt) {
  if (evt.target === cy) {
    if (selectedNode) { selectedNode.removeClass('selected'); selectedNode = null; }
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
    if (edgeMode) { edgeMode = false; edgeModeSource = null; document.getElementById('edge-mode-hint').classList.remove('active'); }
  }
  var isInput = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';
  var hasModal = document.querySelector('.modal-overlay.active');
  if (e.key === 'Backspace' && !isInput && !hasModal && currentRoom !== null) { e.preventDefault(); goBack(); }
  if (e.key === 'Tab' && selectedNode && !isInput && !hasModal) { e.preventDefault(); var name = prompt('输入子概念名称：'); if (name && name.trim()) quickAddChild(selectedNode.id(), name.trim()); }
  if (e.key === 'Delete' && selectedNode && !isInput && !hasModal) { e.preventDefault(); confirmDeleteNode(selectedNode); }
});

// --- 缩放控制 ---
document.getElementById('btn-zoomin').addEventListener('click', function() { cy.animate({ zoom: cy.zoom() * 1.3 }, { duration: 200 }); });
document.getElementById('btn-zoomout').addEventListener('click', function() { cy.animate({ zoom: cy.zoom() / 1.3 }, { duration: 200 }); });
document.getElementById('btn-fit').addEventListener('click', function() { cy.animate({ fit: { padding: 50 } }, { duration: 300 }); });
cy.on('zoom', function() { updateZoomIndicator(); });
