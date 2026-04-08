// ===================== 关系颜色 =====================
const REL_COLORS = { '包含': '#7f8c8d', '依赖': '#e67e22', '相关': '#9b59b6', '演进': '#27ae60' };

// ===================== 全局状态 =====================
var edgeMode = false;
var edgeModeSource = null;
var focusMode = false;       // 是否处于聚焦视图
var focusNodeId = null;      // 聚焦的中心节点ID
var focusHistory = [];       // 聚焦历史栈，支持多级钻入

// ===================== 缩放阈值 =====================
const ZOOM_SHOW_L2 = 0.75; // 缩放级别 > 此值时显示 level 2 节点

// ===================== 初始化 Cytoscape =====================
const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: { nodes: graphNodes, edges: graphEdges },
  minZoom: 0.3,
  maxZoom: 3,
  wheelSensitivity: 0.3,
  style: [
    // ---- 节点通用 ----
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '13px',
        'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        'color': '#fff',
        'text-wrap': 'wrap',
        'text-max-width': '90px',
        'width': 'label',
        'height': 'label',
        'padding': '14px',
        'shape': 'roundrectangle',
        'background-color': '#1a3a5c',
        'border-width': 2,
        'border-color': '#15304d',
        'transition-property': 'background-color, border-color, opacity, width, height',
        'transition-duration': '0.25s',
        'text-outline-width': 0,
      }
    },
    // ---- Level 1 顶层节点 ----
    {
      selector: 'node[level=1]',
      style: {
        'background-color': '#1a3a5c',
        'border-color': '#0f2640',
        'font-size': '14px',
        'font-weight': 'bold',
        'padding': '18px',
        'color': '#ffffff',
      }
    },
    // ---- Level 2 子节点 ----
    {
      selector: 'node[level=2]',
      style: {
        'background-color': '#5b9bd5',
        'border-color': '#4a89c0',
        'font-size': '12px',
        'padding': '12px',
        'color': '#ffffff',
      }
    },
    // ---- 边通用 ----
    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': '#bdc3c7',
        'target-arrow-color': '#bdc3c7',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(relation)',
        'font-size': '10px',
        'color': '#888',
        'text-background-color': '#fff',
        'text-background-opacity': 0.85,
        'text-background-padding': '3px',
        'text-rotation': 'autorotate',
        'arrow-scale': 1.1,
        'transition-property': 'line-color, target-arrow-color, opacity, width',
        'transition-duration': '0.25s',
      }
    },
    // ---- 各种关系颜色 ----
    { selector: 'edge[relation="依赖"]', style: { 'line-color': '#e67e22', 'target-arrow-color': '#e67e22' } },
    { selector: 'edge[relation="演进"]', style: { 'line-color': '#27ae60', 'target-arrow-color': '#27ae60', 'line-style': 'dashed' } },
    { selector: 'edge[relation="相关"]', style: { 'line-color': '#9b59b6', 'target-arrow-color': '#9b59b6', 'line-style': 'dashed' } },
    { selector: 'edge[relation="包含"]', style: { 'line-color': '#7f8c8d', 'target-arrow-color': '#7f8c8d' } },
    // ---- 选中状态 ----
    {
      selector: 'node.selected',
      style: {
        'border-width': 3,
        'border-color': '#e74c3c',
        'background-color': '#c0392b',
      }
    },
    // ---- 高亮状态 ----
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 3,
        'border-color': '#f39c12',
      }
    },
    {
      selector: 'edge.highlighted',
      style: {
        'width': 3.5,
        'z-index': 999,
      }
    },
    // ---- 淡出状态 ----
    {
      selector: 'node.faded',
      style: { 'opacity': 0.2 }
    },
    {
      selector: 'edge.faded',
      style: { 'opacity': 0.1 }
    },
    // ---- 搜索匹配 ----
    {
      selector: 'node.search-match',
      style: {
        'border-width': 3,
        'border-color': '#f1c40f',
        'background-color': '#f39c12',
      }
    },
    // ---- 隐藏 ----
    {
      selector: '.hidden',
      style: { 'display': 'none' }
    }
  ]
});

// ===================== ELK 布局 =====================
function runLayout() {
  const layout = cy.layout({
    name: 'elk',
    elk: {
      algorithm: 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': 60,
      'elk.layered.spacing.nodeNodeBetweenLayers': 80,
      'elk.layered.spacing.edgeNodeBetweenLayers': 40,
      'elk.padding': '[top=50,left=50,bottom=50,right=50]',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    fit: true,
    padding: 60,
    animate: false,
  });
  layout.run();
}

// ===================== 分层显示逻辑 =====================
function updateVisibility() {
  const zoom = cy.zoom();
  const zoomPct = Math.round(zoom * 100);
  document.getElementById('zoom-indicator').textContent = '缩放: ' + zoomPct + '%';

  // 聚焦模式下不做缩放层级隐藏
  if (focusMode) return;

  const l2nodes = cy.nodes('[level=2]');
  const l2edges = cy.edges().filter(function(e) {
    return e.source().data('level') === 2 || e.target().data('level') === 2;
  });

  if (zoom < ZOOM_SHOW_L2) {
    l2nodes.addClass('hidden');
    l2edges.addClass('hidden');
  } else {
    l2nodes.removeClass('hidden');
    l2edges.removeClass('hidden');
  }
}

// ===================== Markdown 渲染 =====================
marked.setOptions({ breaks: true, gfm: true });

function showDetail(nodeId) {
  const md = MD[nodeId];
  const titleEl = document.getElementById('detail-title');
  const bodyEl = document.getElementById('detail-body');

  const node = cy.getElementById(nodeId);
  titleEl.textContent = node.data('label');

  if (md) {
    bodyEl.innerHTML = marked.parse(md);
  } else {
    bodyEl.innerHTML = '<div class="placeholder-text" style="margin-top:10vh">暂无文档内容<br><small style="color:#bbb">点击上方"编辑文档"添加内容</small></div>';
  }
  bodyEl.scrollTop = 0;

  // 显示编辑按钮
  document.getElementById('btn-edit-md').style.display = '';
  document.getElementById('btn-edit-node').style.display = '';
  document.getElementById('btn-delete-node').style.display = '';
}

function showPlaceholder() {
  document.getElementById('detail-title').textContent = '知识详情';
  document.getElementById('detail-body').innerHTML =
    '<div class="placeholder-text"><span>📖</span>点击左侧节点查看详情<br><small style="color:#bbb">滚轮缩放 · 拖拽漫游 · 单击查看 · 双击聚焦</small></div>';
  // 隐藏编辑按钮
  document.getElementById('btn-edit-md').style.display = 'none';
  document.getElementById('btn-edit-node').style.display = 'none';
  document.getElementById('btn-delete-node').style.display = 'none';
}

// ===================== 节点交互 =====================
let selectedNode = null;

// 单击 → 显示详情
cy.on('tap', 'node', function(evt) {
  // 连线模式下不走普通点击逻辑（交给后面的连线处理器）
  if (edgeMode && edgeModeSource) return;

  const node = evt.target;
  if (node.hasClass('hidden')) return;

  // 清除旧选中
  if (selectedNode) selectedNode.removeClass('selected');
  node.addClass('selected');
  selectedNode = node;

  showDetail(node.id());
});

// 双击 → 进入聚焦视图（只显示该节点及关联子节点）
cy.on('dbltap', 'node', function(evt) {
  var node = evt.target;
  if (node.hasClass('hidden')) return;
  enterFocusView(node.id());
});

// 悬停 → 高亮节点及关联边
cy.on('mouseover', 'node', function(evt) {
  const node = evt.target;
  if (node.hasClass('hidden')) return;

  const connectedEdges = node.connectedEdges().filter(function(e) { return !e.hasClass('hidden'); });
  const connectedNodes = connectedEdges.connectedNodes().filter(function(n) { return !n.hasClass('hidden'); });

  // 先淡化所有
  cy.elements().not('.hidden').addClass('faded');
  // 再高亮相关
  node.removeClass('faded').addClass('highlighted');
  connectedEdges.removeClass('faded').addClass('highlighted');
  connectedNodes.removeClass('faded').addClass('highlighted');
});

cy.on('mouseout', 'node', function() {
  cy.elements().removeClass('faded').removeClass('highlighted');
});

// 点击空白 → 取消选中
cy.on('tap', function(evt) {
  if (evt.target === cy) {
    if (selectedNode) {
      selectedNode.removeClass('selected');
      selectedNode = null;
    }
    showPlaceholder();
  }
});

// 缩放事件
cy.on('zoom', updateVisibility);

// ===================== 搜索功能 =====================
const searchInput = document.getElementById('search-input');
let searchTimeout = null;

searchInput.addEventListener('input', function() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(function() {
    const query = searchInput.value.trim().toLowerCase();
    cy.nodes().removeClass('search-match');

    if (!query) return;

    cy.nodes().forEach(function(node) {
      const label = (node.data('label') || '').toLowerCase();
      const id = (node.data('id') || '').toLowerCase();
      if (label.includes(query) || id.includes(query)) {
        node.addClass('search-match');
        node.removeClass('hidden');
        // 如果匹配到隐藏节点，也需要显示关联边
        node.connectedEdges().forEach(function(e) {
          var other = e.source().id() === node.id() ? e.target() : e.source();
          if (!other.hasClass('hidden')) e.removeClass('hidden');
        });
      }
    });

    // 聚焦到第一个匹配节点
    var matches = cy.nodes('.search-match');
    if (matches.length > 0) {
      cy.animate({ center: { eles: matches.first() } }, { duration: 300 });
    }
  }, 250);
});

// Escape 清除搜索
searchInput.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    searchInput.value = '';
    cy.nodes().removeClass('search-match');
    updateVisibility();
  }
});

// ===================== 控制按钮 =====================
document.getElementById('btn-zoomin').addEventListener('click', function() {
  cy.animate({ zoom: cy.zoom() * 1.3, center: cy.extent() }, { duration: 200 });
});
document.getElementById('btn-zoomout').addEventListener('click', function() {
  cy.animate({ zoom: cy.zoom() / 1.3, center: cy.extent() }, { duration: 200 });
});
document.getElementById('btn-fit').addEventListener('click', function() {
  cy.animate({ fit: { padding: 60 } }, { duration: 300 });
});

// ===================== 聚焦视图（Drill-down） =====================

/**
 * 进入聚焦视图：只显示 centerNodeId 及其直接关联的子节点/边
 */
function enterFocusView(centerNodeId) {
  var centerNode = cy.getElementById(centerNodeId);
  if (centerNode.length === 0) return;

  // 如果已在聚焦模式，把当前聚焦节点压入历史
  if (focusMode && focusNodeId) {
    focusHistory.push(focusNodeId);
  }

  focusMode = true;
  focusNodeId = centerNodeId;

  // 收集需要显示的节点：中心节点 + 所有直接关联节点
  var connEdges = centerNode.connectedEdges();
  var connNodes = connEdges.connectedNodes();
  var visibleNodes = centerNode.union(connNodes);
  var visibleEdges = connEdges;

  // 同时收集 connNodes 之间互相的边（让子网络关系也可见）
  connNodes.forEach(function(n1) {
    connNodes.forEach(function(n2) {
      if (n1.id() >= n2.id()) return;
      var between = n1.edgesWith(n2);
      if (between.length > 0) {
        visibleEdges = visibleEdges.union(between);
      }
    });
  });

  // 隐藏所有元素，再显示需要的
  cy.elements().addClass('hidden');
  visibleNodes.removeClass('hidden');
  visibleEdges.removeClass('hidden');

  // 选中中心节点
  if (selectedNode) selectedNode.removeClass('selected');
  centerNode.addClass('selected');
  selectedNode = centerNode;
  showDetail(centerNodeId);

  // 重新布局可见节点
  var visibleAll = visibleNodes.union(visibleEdges);
  var layout = visibleAll.layout({
    name: 'elk',
    elk: {
      algorithm: 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': 70,
      'elk.layered.spacing.nodeNodeBetweenLayers': 90,
      'elk.padding': '[top=50,left=50,bottom=50,right=50]',
    },
    fit: true,
    padding: 80,
    animate: true,
    animationDuration: 400,
  });
  layout.run();

  // 更新面包屑
  updateBreadcrumb();
}

/**
 * 退出聚焦视图，回到全局
 */
function exitFocusView() {
  focusMode = false;
  focusNodeId = null;
  focusHistory = [];

  // 显示所有元素
  cy.elements().removeClass('hidden');

  // 重新全局布局
  runLayout();
  setTimeout(function() {
    updateVisibility();
    cy.fit(undefined, 60);
  }, 300);

  // 隐藏面包屑
  updateBreadcrumb();
}

/**
 * 返回上一级聚焦
 */
function goBackFocus() {
  if (focusHistory.length > 0) {
    var prevId = focusHistory.pop();
    focusMode = false; // 临时关闭避免 enterFocusView 再 push
    focusNodeId = null;
    enterFocusView(prevId);
    // enterFocusView 内部会重新 push，但我们已经 pop 了上一个
    // 需要修正：不重复 push
    // 实际上 enterFocusView 检查 focusMode 为 false 时不会 push
  } else {
    exitFocusView();
  }
}

/**
 * 更新面包屑导航
 */
function updateBreadcrumb() {
  var bc = document.getElementById('breadcrumb');
  if (!focusMode) {
    bc.classList.remove('active');
    return;
  }

  bc.classList.add('active');

  // 重建面包屑内容
  var html = '<span class="bc-link" id="bc-back-global">全局视图</span>';

  // 历史路径
  for (var i = 0; i < focusHistory.length; i++) {
    var hNode = cy.getElementById(focusHistory[i]);
    var hLabel = hNode.length > 0 ? hNode.data('label') : focusHistory[i];
    html += '<span class="bc-sep">›</span>';
    html += '<span class="bc-link bc-history" data-idx="' + i + '">' + hLabel + '</span>';
  }

  // 当前节点
  var curNode = cy.getElementById(focusNodeId);
  var curLabel = curNode.length > 0 ? curNode.data('label') : focusNodeId;
  html += '<span class="bc-sep">›</span>';
  html += '<span class="bc-current">' + curLabel + '</span>';

  bc.innerHTML = html;

  // 绑定全局视图点击
  var globalLink = bc.querySelector('#bc-back-global');
  if (globalLink) {
    globalLink.addEventListener('click', function() { exitFocusView(); });
  }

  // 绑定历史节点点击
  bc.querySelectorAll('.bc-history').forEach(function(el) {
    el.addEventListener('click', function() {
      var idx = parseInt(el.dataset.idx);
      // 截断历史到 idx，重新进入该节点的聚焦
      var targetId = focusHistory[idx];
      focusHistory = focusHistory.slice(0, idx);
      focusMode = false;
      focusNodeId = null;
      enterFocusView(targetId);
    });
  });
}

// ===================== 启动 =====================
runLayout();
setTimeout(function() {
  updateVisibility();
  cy.fit(undefined, 60);
}, 300);

// =====================================================================
// ===================== 编辑功能（CRUD） =====================
// =====================================================================

// ---------- 工具函数 ----------
let edgeIdCounter = 100;
function nextEdgeId() { return 'e' + (edgeIdCounter++); }

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
// 暴露到全局供 onclick 使用
window.openModal = openModal;
window.closeModal = closeModal;

function populateParentSelect() {
  const sel = document.getElementById('node-parent');
  sel.innerHTML = '<option value="">无</option>';
  cy.nodes('[level=1]').forEach(function(n) {
    sel.innerHTML += '<option value="' + n.id() + '">' + n.data('label') + ' (' + n.id() + ')</option>';
  });
}

function populateNodeSelects() {
  var html = '';
  cy.nodes().forEach(function(n) {
    html += '<option value="' + n.id() + '">' + n.data('label') + ' (' + n.id() + ')</option>';
  });
  document.getElementById('edge-source').innerHTML = html;
  document.getElementById('edge-target').innerHTML = html;
}

// ---------- 右键菜单 ----------
let contextNode = null;
let contextEdge = null;

cy.on('cxttap', 'node', function(evt) {
  evt.originalEvent.preventDefault();
  contextNode = evt.target;
  const menu = document.getElementById('context-menu');
  menu.style.display = 'block';
  menu.style.left = evt.originalEvent.clientX + 'px';
  menu.style.top = evt.originalEvent.clientY + 'px';
  // 隐藏边菜单
  document.getElementById('edge-context-menu').style.display = 'none';
});

cy.on('cxttap', 'edge', function(evt) {
  evt.originalEvent.preventDefault();
  contextEdge = evt.target;
  const menu = document.getElementById('edge-context-menu');
  menu.style.display = 'block';
  menu.style.left = evt.originalEvent.clientX + 'px';
  menu.style.top = evt.originalEvent.clientY + 'px';
  document.getElementById('context-menu').style.display = 'none';
});

document.addEventListener('click', function() {
  document.getElementById('context-menu').style.display = 'none';
  document.getElementById('edge-context-menu').style.display = 'none';
});

document.getElementById('context-menu').addEventListener('click', function(e) {
  const item = e.target.closest('.ctx-item');
  if (!item || !contextNode) return;
  const action = item.dataset.action;

  if (action === 'focus-in') enterFocusView(contextNode.id());
  else if (action === 'edit-node') openEditNodeModal(contextNode);
  else if (action === 'edit-md') openMdEditor(contextNode.id());
  else if (action === 'add-child') openAddChildModal(contextNode);
  else if (action === 'add-edge-from') startEdgeMode(contextNode);
  else if (action === 'delete-node') confirmDeleteNode(contextNode);

  document.getElementById('context-menu').style.display = 'none';
});

document.getElementById('edge-context-menu').addEventListener('click', function(e) {
  const item = e.target.closest('.ctx-item');
  if (!item || !contextEdge) return;
  const action = item.dataset.action;

  if (action === 'edit-edge') openEditEdgeModal(contextEdge);
  else if (action === 'delete-edge') confirmDeleteEdge(contextEdge);

  document.getElementById('edge-context-menu').style.display = 'none';
});

// ---------- 新增节点 ----------
let editingNodeId = null;

document.getElementById('btn-add-node').addEventListener('click', function() {
  editingNodeId = null;
  document.getElementById('modal-node-title').textContent = '新增节点';
  document.getElementById('node-id').value = '';
  document.getElementById('node-id').disabled = false;
  document.getElementById('node-label').value = '';
  document.getElementById('node-level').value = '2';
  populateParentSelect();
  document.getElementById('node-parent').value = '';
  openModal('modal-node');
});

function openEditNodeModal(node) {
  editingNodeId = node.id();
  document.getElementById('modal-node-title').textContent = '编辑节点';
  document.getElementById('node-id').value = node.id();
  document.getElementById('node-id').disabled = true;
  document.getElementById('node-label').value = node.data('label');
  document.getElementById('node-level').value = String(node.data('level'));
  populateParentSelect();
  document.getElementById('node-parent').value = node.data('parentDomain') || '';
  openModal('modal-node');
}

function openAddChildModal(parentNode) {
  editingNodeId = null;
  document.getElementById('modal-node-title').textContent = '添加子节点';
  document.getElementById('node-id').value = '';
  document.getElementById('node-id').disabled = false;
  document.getElementById('node-label').value = '';
  document.getElementById('node-level').value = '2';
  populateParentSelect();
  document.getElementById('node-parent').value = parentNode.id();
  openModal('modal-node');
}

document.getElementById('btn-save-node').addEventListener('click', function() {
  var id = document.getElementById('node-id').value.trim();
  var label = document.getElementById('node-label').value.trim();
  var level = parseInt(document.getElementById('node-level').value);
  var parentDomain = document.getElementById('node-parent').value;

  if (!id || !label) { alert('请填写 ID 和名称'); return; }

  if (editingNodeId) {
    // 编辑现有节点
    var node = cy.getElementById(editingNodeId);
    node.data('label', label);
    node.data('level', level);
    node.data('parentDomain', parentDomain);
    if (selectedNode && selectedNode.id() === editingNodeId) {
      showDetail(editingNodeId);
    }
  } else {
    // 新增节点
    if (cy.getElementById(id).length > 0) { alert('ID 已存在，请更换'); return; }
    cy.add({
      group: 'nodes',
      data: { id: id, label: label, level: level, parentDomain: parentDomain }
    });
    // 如果有父节点，自动添加包含关系
    if (parentDomain) {
      cy.add({
        group: 'edges',
        data: { id: nextEdgeId(), source: parentDomain, target: id, relation: '包含' }
      });
    }
    // 初始化空 Markdown
    if (!MD[id]) MD[id] = '';
    // 重新布局
    runLayout();
    setTimeout(updateVisibility, 300);
  }
  closeModal('modal-node');
});

// ---------- 删除节点 ----------
let pendingDeleteNode = null;
let pendingDeleteEdge = null;

function confirmDeleteNode(node) {
  pendingDeleteNode = node;
  pendingDeleteEdge = null;
  document.getElementById('confirm-message').textContent =
    '确定要删除节点「' + node.data('label') + '」及其所有连线吗？此操作不可撤销。';
  openModal('modal-confirm');
}

function confirmDeleteEdge(edge) {
  pendingDeleteEdge = edge;
  pendingDeleteNode = null;
  document.getElementById('confirm-message').textContent =
    '确定要删除「' + edge.source().data('label') + ' → ' + edge.target().data('label') + '」的连线吗？';
  openModal('modal-confirm');
}

document.getElementById('btn-confirm-delete').addEventListener('click', function() {
  if (pendingDeleteNode) {
    var id = pendingDeleteNode.id();
    pendingDeleteNode.connectedEdges().remove();
    pendingDeleteNode.remove();
    delete MD[id];
    if (selectedNode && selectedNode.id() === id) {
      selectedNode = null;
      showPlaceholder();
    }
    pendingDeleteNode = null;
  }
  if (pendingDeleteEdge) {
    pendingDeleteEdge.remove();
    pendingDeleteEdge = null;
  }
  closeModal('modal-confirm');
});

// ---------- 详情面板按钮 ----------
document.getElementById('btn-edit-md').addEventListener('click', function() {
  if (selectedNode) openMdEditor(selectedNode.id());
});
document.getElementById('btn-edit-node').addEventListener('click', function() {
  if (selectedNode) openEditNodeModal(selectedNode);
});
document.getElementById('btn-delete-node').addEventListener('click', function() {
  if (selectedNode) confirmDeleteNode(selectedNode);
});

// ---------- Markdown 编辑器 ----------
let editingMdNodeId = null;

function openMdEditor(nodeId) {
  editingMdNodeId = nodeId;
  var node = cy.getElementById(nodeId);
  document.getElementById('modal-md-title').textContent = '编辑文档 — ' + node.data('label');
  document.getElementById('md-editor-textarea').value = MD[nodeId] || '';
  switchMdTab('edit');
  openModal('modal-md');
  // 自动聚焦
  setTimeout(function() { document.getElementById('md-editor-textarea').focus(); }, 100);
}

window.switchMdTab = function(tab) {
  var editTab = document.querySelector('.md-editor-tab[data-tab="edit"]');
  var previewTab = document.querySelector('.md-editor-tab[data-tab="preview"]');
  var textarea = document.getElementById('md-editor-textarea');
  var preview = document.getElementById('md-preview-area');

  if (tab === 'edit') {
    editTab.classList.add('active');
    previewTab.classList.remove('active');
    textarea.style.display = '';
    preview.style.display = 'none';
  } else {
    previewTab.classList.add('active');
    editTab.classList.remove('active');
    textarea.style.display = 'none';
    preview.style.display = '';
    preview.innerHTML = marked.parse(textarea.value || '*暂无内容*');
  }
};

document.getElementById('btn-save-md').addEventListener('click', function() {
  if (!editingMdNodeId) return;
  MD[editingMdNodeId] = document.getElementById('md-editor-textarea').value;
  // 如果当前选中的就是这个节点，刷新详情
  if (selectedNode && selectedNode.id() === editingMdNodeId) {
    showDetail(editingMdNodeId);
  }
  closeModal('modal-md');
});

// ---------- 新增连线（模态框方式） ----------
let editingEdgeRef = null;

document.getElementById('btn-add-edge').addEventListener('click', function() {
  editingEdgeRef = null;
  document.getElementById('modal-edge-title').textContent = '新增连线';
  populateNodeSelects();
  document.getElementById('edge-source').value = selectedNode ? selectedNode.id() : '';
  document.getElementById('edge-target').value = '';
  document.getElementById('edge-relation').value = '包含';
  openModal('modal-edge');
});

function openEditEdgeModal(edge) {
  editingEdgeRef = edge;
  document.getElementById('modal-edge-title').textContent = '编辑连线';
  populateNodeSelects();
  document.getElementById('edge-source').value = edge.source().id();
  document.getElementById('edge-source').disabled = true;
  document.getElementById('edge-target').value = edge.target().id();
  document.getElementById('edge-target').disabled = true;
  document.getElementById('edge-relation').value = edge.data('relation');
  openModal('modal-edge');
}

document.getElementById('btn-save-edge').addEventListener('click', function() {
  var src = document.getElementById('edge-source').value;
  var tgt = document.getElementById('edge-target').value;
  var rel = document.getElementById('edge-relation').value;

  if (!src || !tgt) { alert('请选择源节点和目标节点'); return; }
  if (src === tgt) { alert('不能连接自身'); return; }

  if (editingEdgeRef) {
    editingEdgeRef.data('relation', rel);
    editingEdgeRef = null;
  } else {
    cy.add({
      group: 'edges',
      data: { id: nextEdgeId(), source: src, target: tgt, relation: rel }
    });
  }
  // 恢复 disabled 状态
  document.getElementById('edge-source').disabled = false;
  document.getElementById('edge-target').disabled = false;
  closeModal('modal-edge');
});

// 关闭边模态框时恢复 disabled
var origCloseModal = closeModal;
closeModal = function(id) {
  if (id === 'modal-edge') {
    document.getElementById('edge-source').disabled = false;
    document.getElementById('edge-target').disabled = false;
    editingEdgeRef = null;
  }
  origCloseModal(id);
};
window.closeModal = closeModal;

// ---------- 连线模式（点击方式） ----------

function startEdgeMode(sourceNode) {
  edgeMode = true;
  edgeModeSource = sourceNode;
  document.getElementById('edge-mode-hint').classList.add('active');
}

document.getElementById('btn-cancel-edge-mode').addEventListener('click', function() {
  edgeMode = false;
  edgeModeSource = null;
  document.getElementById('edge-mode-hint').classList.remove('active');
});

// 拦截节点点击用于连线模式
cy.on('tap', 'node', function(evt) {
  if (!edgeMode || !edgeModeSource) return;
  var target = evt.target;
  if (target.id() === edgeModeSource.id()) return;

  // 打开边编辑模态框
  editingEdgeRef = null;
  document.getElementById('modal-edge-title').textContent = '新增连线';
  populateNodeSelects();
  document.getElementById('edge-source').value = edgeModeSource.id();
  document.getElementById('edge-target').value = target.id();
  document.getElementById('edge-relation').value = '包含';
  openModal('modal-edge');

  // 退出连线模式
  edgeMode = false;
  edgeModeSource = null;
  document.getElementById('edge-mode-hint').classList.remove('active');
});

// ---------- 导出/导入 ----------
document.getElementById('btn-export').addEventListener('click', function() {
  var data = {
    nodes: cy.nodes().map(function(n) {
      return { data: { id: n.id(), label: n.data('label'), level: n.data('level'), parentDomain: n.data('parentDomain') || '' } };
    }),
    edges: cy.edges().map(function(e) {
      return { data: { id: e.id(), source: e.source().id(), target: e.target().id(), relation: e.data('relation') } };
    }),
    markdown: Object.assign({}, MD)
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'topomind-data.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', function() {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', function(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      var data = JSON.parse(ev.target.result);
      // 清空
      cy.elements().remove();
      Object.keys(MD).forEach(function(k) { delete MD[k]; });

      // 加载节点
      if (data.nodes) data.nodes.forEach(function(n) { cy.add({ group: 'nodes', data: n.data }); });
      // 加载边
      if (data.edges) data.edges.forEach(function(e) { cy.add({ group: 'edges', data: e.data }); });
      // 加载 Markdown
      if (data.markdown) Object.assign(MD, data.markdown);

      runLayout();
      setTimeout(function() { updateVisibility(); cy.fit(undefined, 60); }, 300);
      showPlaceholder();
      selectedNode = null;
    } catch (err) {
      alert('导入失败：' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ---------- Esc 关闭模态框 ----------
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(function(m) {
      m.classList.remove('active');
    });
    if (edgeMode) {
      edgeMode = false;
      edgeModeSource = null;
      document.getElementById('edge-mode-hint').classList.remove('active');
    }
  }
});
