/**
 * 卡片/边 CRUD
 */

function addCardPrompt() {
  showInputModal('新建卡片', '输入卡片名称...').then(function(name) {
    if (!name) return;
    var dirPath = currentRoomPath || currentKBPath;
    Store.createCard(dirPath, name).then(function() {
      loadRoom(dirPath);
      GitStore.markDirty(currentKBPath);
    });
  });
}

// ===== 右键菜单（单个节点） =====
var contextNode = null, contextEdge = null;

cy.on('cxttap', 'node', function(e) {
  if (_rightDragMoved()) return;
  var selected = cy.nodes(':selected');
  if (selected.length > 1) return; // 多选由 interaction.js 批量菜单处理

  e.originalEvent.preventDefault(); contextNode = e.target;
  showContextMenu('context-menu', e.originalEvent.clientX, e.originalEvent.clientY);
});

cy.on('cxttap', 'edge', function(e) {
  if (_rightDragMoved()) return;
  e.originalEvent.preventDefault(); contextEdge = e.target;
  showContextMenu('edge-context-menu', e.originalEvent.clientX, e.originalEvent.clientY);
});

document.getElementById('context-menu').addEventListener('click', function(e) {
  var it = e.target.closest('.ctx-item');
  if (!it || !contextNode) return;
  var a = it.dataset.action;
  if (a === 'drill') drillInto(contextNode.id());
  else if (a === 'add-child') {
    var _ctx = contextNode;
    showInputModal('添加子卡片', '输入子卡片名称...').then(function(name) {
      if (name) {
        Store.createCard(_ctx.id(), name).then(function() {
          loadRoom(currentRoomPath || currentKBPath);
        });
      }
    });
  }
  else if (a === 'edit-md') {
    if (selectedNode) selectedNode.removeClass('selected');
    contextNode.addClass('selected'); selectedNode = contextNode;
    showDetail(contextNode.id()); switchDetailMode('edit');
  }
  else if (a === 'connect') {
    edgeMode = true; edgeModeSource = contextNode;
    document.getElementById('edge-mode-hint').classList.add('active');
  }
  else if (a === 'delete') confirmDeleteCard(contextNode);
  document.getElementById('context-menu').style.display = 'none';
});

document.getElementById('edge-context-menu').addEventListener('click', function(e) {
  var it = e.target.closest('.ctx-item');
  if (!it || !contextEdge) return;
  if (it.dataset.action === 'delete-edge') { contextEdge.remove(); contextEdge = null; saveCurrentLayout(); }
  document.getElementById('edge-context-menu').style.display = 'none';
});

// ===== 背景右键菜单 =====
document.getElementById('bg-context-menu').addEventListener('click', function(e) {
  var it = e.target.closest('.ctx-item');
  if (!it) return;
  var a = it.dataset.action;
  if (a === 'add-card') addCardPrompt();
  else if (a === 'fit-view') cy.animate({ fit: { padding: 50 } }, { duration: 300 });
  else if (a === 'go-back') goBack();
  document.getElementById('bg-context-menu').style.display = 'none';
});

// ===== 批量右键菜单 =====
document.getElementById('batch-context-menu').addEventListener('click', function(e) {
  // 颜色点
  var dot = e.target.closest('.batch-color-dot');
  if (dot) {
    var color = dot.dataset.color;
    cy.nodes(':selected').forEach(function(n) {
      n.data('color', color);
      n.style('background-color', color);
    });
    saveCurrentLayout();
    document.getElementById('batch-context-menu').style.display = 'none';
    return;
  }
  // 菜单项
  var it = e.target.closest('.ctx-item');
  if (!it) return;
  var a = it.dataset.action;
  if (a === 'batch-delete') {
    batchDeleteSelected();
  }
  document.getElementById('batch-context-menu').style.display = 'none';
});

// ===== 删除 =====
var pendingDeleteNode = null;

function confirmDeleteCard(node) {
  pendingDeleteNode = node;
  _pendingConfirmAction = function() {
    if (!pendingDeleteNode) return;
    var cardPath = pendingDeleteNode.id();
    Store.deleteCard(cardPath).then(function() {
      pendingDeleteNode.connectedEdges().remove();
      pendingDeleteNode.remove();
      if (selectedNode && selectedNode.id() === cardPath) { selectedNode = null; showPlaceholder(); }
      pendingDeleteNode = null;
      saveCurrentLayout();
      buildNavTree();
    });
  };
  document.getElementById('confirm-message').textContent = '删除「' + node.data('label') + '」及所有子内容？';
  document.getElementById('modal-confirm').classList.add('active');
}

document.getElementById('btn-confirm-delete').addEventListener('click', function() {
  if (_pendingConfirmAction) { _pendingConfirmAction(); _pendingConfirmAction = null; }
  pendingDeleteNode = null;
  document.getElementById('modal-confirm').classList.remove('active');
});

document.getElementById('btn-delete-node').addEventListener('click', function() {
  if (selectedNode) confirmDeleteCard(selectedNode);
});

// ===== 连线模式 =====
document.getElementById('btn-cancel-edge-mode').addEventListener('click', function() {
  edgeMode = false; edgeModeSource = null;
  document.getElementById('edge-mode-hint').classList.remove('active');
});

// ===== 工具栏 =====
document.getElementById('btn-add-node').addEventListener('click', addCardPrompt);

document.getElementById('btn-add-edge').addEventListener('click', function() {
  edgeMode = true; edgeModeSource = selectedNode;
  document.getElementById('edge-mode-hint').classList.add('active');
});

document.getElementById('btn-edit-node').addEventListener('click', function() {
  if (!selectedNode) return;
  showInputModal('修改名称', '卡片名称...', selectedNode.data('label')).then(function(newName) {
    if (newName) {
      selectedNode.data('label', newName);
      Store.renameCard(selectedNode.id(), newName);
      saveCurrentLayout();
      buildNavTree();
    }
  });
});

document.getElementById('btn-edit-md').onclick = function() {
  if (selectedNode) switchDetailMode('edit');
};

// ===== 导出/重置 =====
document.getElementById('btn-export').addEventListener('click', function() {
  var meta = buildCurrentMeta();
  var data = { room: currentRoomPath || currentKBPath, meta: meta };
  var b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var u = URL.createObjectURL(b);
  var a = document.createElement('a'); a.href = u; a.download = 'topomind-export.json'; a.click();
  URL.revokeObjectURL(u);
});

document.getElementById('btn-reset').addEventListener('click', function() {
  _pendingConfirmAction = function() {
    Store.clearAll().then(function() { location.reload(); });
  };
  document.getElementById('confirm-message').textContent = '确定重置？将清除所有数据，此操作不可恢复。';
  document.getElementById('modal-confirm').classList.add('active');
});

// ===== 阅读/编辑模式 =====
document.getElementById('btn-mode-read').addEventListener('click', function() { switchDetailMode('read'); });
document.getElementById('btn-mode-edit').addEventListener('click', function() { switchDetailMode('edit'); });

// ===== 编辑区自动保存 =====
var _editTimer = null;
document.getElementById('detail-edit-area').addEventListener('input', function() {
  clearTimeout(_editTimer);
  _editTimer = setTimeout(flushEdit, 1000);
});

// ===== 图片粘贴/拖拽 =====
var editArea = document.getElementById('detail-edit-area');
editArea.addEventListener('paste', function(e) {
  var items = (e.clipboardData || {}).items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') === 0) {
      e.preventDefault(); _insertImg(items[i].getAsFile()); break;
    }
  }
});
editArea.addEventListener('drop', function(e) {
  var files = (e.dataTransfer || {}).files || [];
  for (var i = 0; i < files.length; i++) {
    if (files[i].type.indexOf('image') === 0) {
      e.preventDefault(); _insertImg(files[i]); break;
    }
  }
});
editArea.addEventListener('dragover', function(e) { e.preventDefault(); });

function _insertImg(blob) {
  if (!selectedNode) return;
  var cardPath = selectedNode.id();
  var filename = 'img-' + autoId('i') + '.' + (blob.name || 'png').split('.').pop();
  Store.saveImage(cardPath, blob, filename).then(function(r) {
    var ta = document.getElementById('detail-edit-area');
    var pos = ta.selectionStart;
    var insert = '![图片](' + r.markdownRef + ')\n';
    ta.value = ta.value.substring(0, pos) + insert + ta.value.substring(pos);
    ta.selectionStart = ta.selectionEnd = pos + insert.length;
    ta.focus(); flushEdit();
  });
}
