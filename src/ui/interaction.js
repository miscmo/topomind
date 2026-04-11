/**
 * 交互：点击、右键拖拽画布、框选、右键菜单、搜索、键盘
 */

// ===== 右键按住拖拽画布 =====
(function() {
  var container = cy.container();
  var panning = false;
  var panStart = { x: 0, y: 0 };
  var panOrigin = { x: 0, y: 0 };
  var moved = false; // 区分右键点击 vs 右键拖拽

  container.addEventListener('mousedown', function(e) {
    if (e.button === 2) { // 右键
      panning = true;
      moved = false;
      panStart = { x: e.clientX, y: e.clientY };
      panOrigin = { x: cy.pan().x, y: cy.pan().y };
      container.style.cursor = 'grabbing';
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', function(e) {
    if (!panning) return;
    var dx = e.clientX - panStart.x;
    var dy = e.clientY - panStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    cy.pan({ x: panOrigin.x + dx, y: panOrigin.y + dy });
  });

  document.addEventListener('mouseup', function(e) {
    if (e.button === 2 && panning) {
      panning = false;
      container.style.cursor = '';
    }
  });

  // 禁止画布区域默认右键菜单
  container.addEventListener('contextmenu', function(e) {
    e.preventDefault();
  });

  // 暴露 moved 状态给 cxttap 判断
  window._rightDragMoved = function() { return moved; };
})();

// ===== 节点点击（左键） =====
cy.on('tap', 'node', function(e) {
  if (edgeMode && edgeModeSource) {
    var t = e.target;
    if (t.id() === edgeModeSource.id()) return;
    var _src = edgeModeSource;
    edgeMode = false; edgeModeSource = null;
    document.getElementById('edge-mode-hint').classList.remove('active');
    showInputModal('关系类型', '演进 / 依赖 / 相关', '依赖').then(function(r) {
      if (!r) return;
      cy.add({ group: 'edges', data: { id: 'e-' + autoId('e'), source: _src.id(), target: t.id(), relation: r, weight: r === '相关' ? 'minor' : 'main' } });
      saveCurrentLayout();
    });
    return;
  }
  var node = e.target;
  if (selectedNode) selectedNode.removeClass('selected');
  node.addClass('selected'); selectedNode = node;
  showDetail(node.id());
});

// 双击节点 → 进入
cy.on('dbltap', 'node', function(e) { drillInto(e.target.id()); });

// 点击空白 → 取消选择
cy.on('tap', function(e) {
  if (e.target === cy) {
    if (selectedNode) { selectedNode.removeClass('selected'); selectedNode = null; }
    cy.nodes().unselect(); // 清除框选
    showPlaceholder();
  }
});

// ===== 背景右键菜单 =====
cy.on('cxttap', function(e) {
  if (_rightDragMoved()) return; // 拖拽后不弹菜单
  if (e.target === cy) {
    // 记录右键点击的模型坐标（用于新建节点定位）
    var pos = e.position;
    window._bgContextPos = pos ? { x: pos.x, y: pos.y } : null;
    showContextMenu('bg-context-menu', e.originalEvent.clientX, e.originalEvent.clientY);
  }
});

// ===== 多选节点右键菜单 =====
cy.on('cxttap', 'node', function(e) {
  if (_rightDragMoved()) return;
  var selected = cy.nodes(':selected');
  if (selected.length <= 1) return; // 单选由 crud.js 处理
  // 多选模式 → 批量菜单
  showContextMenu('batch-context-menu', e.originalEvent.clientX, e.originalEvent.clientY);
});

// ===== 悬停 =====
cy.on('mouseover', 'node', function(e) { e.target.addClass('highlighted'); });
cy.on('mouseout', 'node', function(e) { e.target.removeClass('highlighted'); });

// ===== 搜索 =====
document.getElementById('search-input').addEventListener('input', function() {
  var q = this.value.trim().toLowerCase();
  cy.nodes().removeClass('search-match');
  if (!q) return;
  cy.nodes().forEach(function(n) {
    if ((n.data('label') || '').toLowerCase().includes(q)) n.addClass('search-match');
  });
});

// ===== 键盘 =====
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    cancelInputModal();
    document.getElementById('modal-confirm').classList.remove('active');
    if (_pendingConfirmAction) { _pendingConfirmAction = null; }
    if (edgeMode) { edgeMode = false; edgeModeSource = null; document.getElementById('edge-mode-hint').classList.remove('active'); }
    cy.nodes().unselect(); // 取消框选
  }
  var isInput = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';
  var hasModal = document.querySelector('.modal-overlay.active');
  if (e.key === 'Backspace' && !isInput && !hasModal && currentKBPath) { e.preventDefault(); goBack(); }
  if (e.key === 'Tab' && selectedNode && !isInput && !hasModal) {
    e.preventDefault();
    var _sel = selectedNode;
    showInputModal('添加子卡片', '子卡片名称...').then(function(name) {
      if (name) {
        Store.createCard(_sel.id(), name).then(function() {
          loadRoom(currentRoomPath || currentKBPath);
        });
      }
    });
  }
  if (e.key === 'Delete' && !isInput && !hasModal) {
    e.preventDefault();
    var selected = cy.nodes(':selected');
    if (selected.length > 1) {
      batchDeleteSelected();
    } else if (selectedNode) {
      confirmDeleteCard(selectedNode);
    }
  }
});

// ===== 缩放 =====
document.getElementById('btn-zoomin').addEventListener('click', function() { cy.animate({ zoom: cy.zoom() * 1.3 }, { duration: 200 }); });
document.getElementById('btn-zoomout').addEventListener('click', function() { cy.animate({ zoom: cy.zoom() / 1.3 }, { duration: 200 }); });
document.getElementById('btn-fit').addEventListener('click', function() { cy.animate({ fit: { padding: 50 } }, { duration: 300 }); });

// ===== 滚轮缩放（手动实现，以鼠标位置为中心） =====
cy.container().addEventListener('wheel', function(e) {
  e.preventDefault();
  var factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
  var newZoom = cy.zoom() * factor;
  newZoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), newZoom));
  var rect = cy.container().getBoundingClientRect();
  var offsetX = e.clientX - rect.left;
  var offsetY = e.clientY - rect.top;
  cy.zoom({ level: newZoom, renderedPosition: { x: offsetX, y: offsetY } });
}, { passive: false });

// ===== 拖拽保存 =====
cy.on('free', 'node', function() { saveCurrentLayout(); });

// ===== 缩放联动显示规则 =====
function applyZoomDisplay(zoom) {
  if (zoom < 0.6) {
    cy.edges('[weight="main"]').style('label', '');
    cy.edges('[weight="minor"]').style('display', 'none');
  } else if (zoom < 0.8) {
    cy.edges('[weight="main"]').style('label', function(e) { return e.data('relation') || ''; });
    cy.edges('[weight="minor"]').style('display', 'none');
  } else {
    cy.edges('[weight="main"]').style('label', function(e) { return e.data('relation') || ''; });
    cy.edges('[weight="minor"]').style('display', 'element');
  }
}
cy.on('zoom', function() { applyZoomDisplay(cy.zoom()); });

// ===== 关闭所有自定义右键菜单 =====
document.addEventListener('click', function() {
  document.getElementById('context-menu').style.display = 'none';
  document.getElementById('edge-context-menu').style.display = 'none';
  document.getElementById('bg-context-menu').style.display = 'none';
  document.getElementById('batch-context-menu').style.display = 'none';
});
