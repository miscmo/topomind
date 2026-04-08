/**
 * 节点/边 CRUD 操作
 */
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
window.openModal = openModal; window.closeModal = closeModal;

function quickAddChild(parentId, label) {
  var id = autoId('c');
  var d = { id: id, label: label, level: 2 };
  if (parentId) { d.parent = parentId; var pn = cy.getElementById(parentId); d.level = (pn.data('level') || 1) + 1; }
  else { d.level = 1; }
  if (!DOMAIN_COLORS[id]) {
    var pool = ['#4a6fa5','#5a8f7b','#7b68ae','#c0723a','#2e86ab','#a23b72','#d64045','#5b7065','#6a8e5d','#8e6a5d'];
    DOMAIN_COLORS[id] = { bg: pool[Object.keys(DOMAIN_COLORS).length % pool.length], border: '#555', light: '#f0f0f0' };
  }
  cy.add({ group: 'nodes', data: d, classes: 'card' });
  if (!MD[id]) MD[id] = '';
  saveMarkdown(id, '');
  enterRoom(currentRoom);
  saveState();
}

// --- 右键菜单 ---
var contextNode = null, contextEdge = null;
cy.on('cxttap', 'node', function(e) {
  e.originalEvent.preventDefault(); contextNode = e.target;
  var m = document.getElementById('context-menu'); m.style.display = 'block';
  m.style.left = e.originalEvent.clientX + 'px'; m.style.top = e.originalEvent.clientY + 'px';
  document.getElementById('edge-context-menu').style.display = 'none';
});
cy.on('cxttap', 'edge', function(e) {
  e.originalEvent.preventDefault(); contextEdge = e.target;
  var m = document.getElementById('edge-context-menu'); m.style.display = 'block';
  m.style.left = e.originalEvent.clientX + 'px'; m.style.top = e.originalEvent.clientY + 'px';
  document.getElementById('context-menu').style.display = 'none';
});
document.addEventListener('click', function() {
  document.getElementById('context-menu').style.display = 'none';
  document.getElementById('edge-context-menu').style.display = 'none';
});

document.getElementById('context-menu').addEventListener('click', function(e) {
  var it = e.target.closest('.ctx-item'); if (!it || !contextNode) return;
  var a = it.dataset.action;
  if (a === 'focus-in') drillInto(contextNode.id());
  else if (a === 'edit-node') openEditNodeModal(contextNode);
  else if (a === 'edit-md') { if (selectedNode) selectedNode.removeClass('selected'); contextNode.addClass('selected'); selectedNode = contextNode; showDetail(contextNode.id()); switchDetailMode('edit'); }
  else if (a === 'add-child') { var name = prompt('子概念名称：'); if (name && name.trim()) quickAddChild(contextNode.id(), name.trim()); }
  else if (a === 'add-edge-from') { edgeMode = true; edgeModeSource = contextNode; document.getElementById('edge-mode-hint').classList.add('active'); }
  else if (a === 'delete-node') confirmDeleteNode(contextNode);
  document.getElementById('context-menu').style.display = 'none';
});
document.getElementById('edge-context-menu').addEventListener('click', function(e) {
  var it = e.target.closest('.ctx-item'); if (!it || !contextEdge) return;
  if (it.dataset.action === 'edit-edge') openEditEdgeModal(contextEdge);
  else if (it.dataset.action === 'delete-edge') { contextEdge.remove(); contextEdge = null; saveState(); }
  document.getElementById('edge-context-menu').style.display = 'none';
});

// --- 节点编辑模态 ---
var editingNodeId = null;
document.getElementById('btn-edit-node').addEventListener('click', function() { if (selectedNode) openEditNodeModal(selectedNode); });
function openEditNodeModal(n) {
  editingNodeId = n.id();
  document.getElementById('modal-node-title').textContent = '编辑节点';
  document.getElementById('node-id').value = n.id(); document.getElementById('node-id').disabled = true;
  document.getElementById('node-label').value = n.data('label');
  document.getElementById('node-level').value = String(n.data('level') || 1);
  var s = document.getElementById('node-parent'); s.innerHTML = '<option value="">无</option>';
  cy.nodes().forEach(function(nn) { if (nn.id() !== n.id()) s.innerHTML += '<option value="' + nn.id() + '">' + nn.data('label') + '</option>'; });
  s.value = n.data('parent') || '';
  openModal('modal-node');
}
document.getElementById('btn-save-node').addEventListener('click', function() {
  var label = document.getElementById('node-label').value.trim();
  if (!label) { alert('请填写名称'); return; }
  if (editingNodeId) { cy.getElementById(editingNodeId).data('label', label); if (selectedNode && selectedNode.id() === editingNodeId) showDetail(editingNodeId); buildNavTree(); saveState(); }
  closeModal('modal-node');
});
document.getElementById('btn-add-node').addEventListener('click', function() {
  var name = prompt('输入新卡片名称：');
  if (name && name.trim()) quickAddChild(currentRoom, name.trim());
});

// --- 删除（级联删除 Markdown + 图片） ---
var pendingDeleteNode = null;
function confirmDeleteNode(n) { pendingDeleteNode = n; document.getElementById('confirm-message').textContent = '删除「' + n.data('label') + '」及其所有子节点？'; openModal('modal-confirm'); }
document.getElementById('btn-delete-node').addEventListener('click', function() { if (selectedNode) confirmDeleteNode(selectedNode); });
document.getElementById('btn-confirm-delete').addEventListener('click', function() {
  if (pendingDeleteNode) {
    // 收集要删除的节点 ID（递归）
    var idsToDelete = [];
    (function collectIds(n) { idsToDelete.push(n.id()); n.children().forEach(collectIds); })(pendingDeleteNode);

    // 从 Cytoscape 中删除
    (function removeRecursive(n) { n.children().forEach(removeRecursive); n.connectedEdges().remove(); n.remove(); delete MD[n.id()]; })(pendingDeleteNode);

    // 从 IndexedDB 中级联删除 Markdown 和图片
    idsToDelete.forEach(function(nid) {
      deleteMarkdown(nid);
      deleteNodeImages(nid);
    });

    if (selectedNode && selectedNode.id() === pendingDeleteNode.id()) { selectedNode = null; showPlaceholder(); }
    pendingDeleteNode = null; enterRoom(currentRoom); saveState();
    updateStorageStatus();
  }
  closeModal('modal-confirm');
});

// --- 边 ---
var editingEdgeRef = null;
document.getElementById('btn-add-edge').addEventListener('click', function() { edgeMode = true; edgeModeSource = selectedNode; document.getElementById('edge-mode-hint').classList.add('active'); });
function openEditEdgeModal(e) {
  editingEdgeRef = e; document.getElementById('modal-edge-title').textContent = '编辑连线';
  var h = ''; cy.nodes().forEach(function(n) { h += '<option value="' + n.id() + '">' + n.data('label') + '</option>'; });
  document.getElementById('edge-source').innerHTML = h; document.getElementById('edge-target').innerHTML = h;
  document.getElementById('edge-source').value = e.source().id(); document.getElementById('edge-target').value = e.target().id();
  document.getElementById('edge-relation').value = e.data('relation'); openModal('modal-edge');
}
document.getElementById('btn-save-edge').addEventListener('click', function() {
  var s = document.getElementById('edge-source').value, t = document.getElementById('edge-target').value, r = document.getElementById('edge-relation').value;
  if (!s || !t || s === t) { alert('请正确选择'); return; }
  var w = (r === '相关') ? 'minor' : 'main';
  if (editingEdgeRef) { editingEdgeRef.data('relation', r); editingEdgeRef.data('weight', w); editingEdgeRef = null; }
  else { cy.add({ group: 'edges', data: { id: nextEdgeId(), source: s, target: t, relation: r, weight: w } }); }
  closeModal('modal-edge'); saveState();
});
document.getElementById('btn-cancel-edge-mode').addEventListener('click', function() { edgeMode = false; edgeModeSource = null; document.getElementById('edge-mode-hint').classList.remove('active'); });
cy.on('tap', 'node', function(e) {
  if (!edgeMode || !edgeModeSource) return;
  var t = e.target; if (t.id() === edgeModeSource.id()) return;
  var r = prompt('关系类型（演进/依赖/相关）：', '依赖');
  if (!r) { edgeMode = false; edgeModeSource = null; document.getElementById('edge-mode-hint').classList.remove('active'); return; }
  cy.add({ group: 'edges', data: { id: nextEdgeId(), source: edgeModeSource.id(), target: t.id(), relation: r, weight: (r === '相关') ? 'minor' : 'main' } });
  edgeMode = false; edgeModeSource = null; document.getElementById('edge-mode-hint').classList.remove('active'); saveState();
});

// --- 导入/导出 ---
document.getElementById('btn-export').addEventListener('click', function() {
  var d = { nodes: cy.nodes().map(function(n) { return { data: Object.assign({}, n.data()), position: Object.assign({}, n.position()), classes: 'card' }; }),
    edges: cy.edges().map(function(e) { return { data: { id: e.id(), source: e.source().id(), target: e.target().id(), relation: e.data('relation'), weight: e.data('weight') } }; }),
    markdown: Object.assign({}, MD), colors: Object.assign({}, DOMAIN_COLORS) };
  var b = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
  var u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = 'topomind-data.json'; a.click(); URL.revokeObjectURL(u);
});
document.getElementById('btn-import').addEventListener('click', function() { document.getElementById('import-file').click(); });
document.getElementById('import-file').addEventListener('change', function(ev) {
  var f = ev.target.files[0]; if (!f) return;
  var reader = new FileReader(); reader.onload = function(e) {
    try {
      var d = JSON.parse(e.target.result); cy.elements().remove(); Object.keys(MD).forEach(function(k) { delete MD[k]; });
      if (d.colors) Object.assign(DOMAIN_COLORS, d.colors);
      if (d.nodes) d.nodes.forEach(function(n) { var ele = cy.add({ group: 'nodes', data: n.data, classes: n.classes || 'card' }); if (n.position && n.position.x !== undefined) ele.position(n.position); });
      if (d.edges) d.edges.forEach(function(e) { cy.add({ group: 'edges', data: e.data }); });
      if (d.markdown) Object.assign(MD, d.markdown);
      roomHistory = []; currentRoom = null; selectedNode = null;

      // 写入 IndexedDB
      clearAllData().then(function() {
        return seedDefaultData(); // 用当前 cy 和 MD 的数据重新 seed
      }).then(function() {
        // 实际上需要把导入的数据写入，重新调用 saveGraphState
        _doSaveGraph();
        // 写入所有 Markdown
        var tasks = Object.keys(MD).map(function(k) { return saveMarkdown(k, MD[k]); });
        return Promise.all(tasks);
      }).then(function() {
        enterRoom(null); showPlaceholder();
        updateStorageStatus();
      });
    } catch (err) { alert('导入失败：' + err.message); }
  }; reader.readAsText(f); ev.target.value = '';
});

// --- 重置 ---
document.getElementById('btn-reset').addEventListener('click', function() {
  if (!confirm('确定要重置吗？将清除所有修改，恢复为初始数据。')) return;
  clearAllData().then(function() {
    location.reload();
  });
});
