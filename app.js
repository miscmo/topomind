// ===================== 全局状态 =====================
var selectedNode = null;
var edgeMode = false, edgeModeSource = null;

// "当前房间"：null=顶层根视野，否则=某个卡片节点的 ID
var currentRoom = null;
var roomHistory = []; // 面包屑路径栈

// ===================== 持久化存储 =====================
var STORAGE_KEY = 'topomind-save-v1';
var saveTimer = null;

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function() {
    try {
      var state = {
        nodes: cy.nodes().map(function(n) {
          return {
            data: Object.assign({}, n.data()),
            position: Object.assign({}, n.position()),
            classes: 'card'
          };
        }),
        edges: cy.edges().map(function(e) {
          return {
            data: {
              id: e.id(),
              source: e.source().id(),
              target: e.target().id(),
              relation: e.data('relation'),
              weight: e.data('weight')
            }
          };
        }),
        markdown: Object.assign({}, MD),
        colors: Object.assign({}, DOMAIN_COLORS),
        view: {
          zoom: cy.zoom(),
          pan: cy.pan(),
          currentRoom: currentRoom,
          roomHistory: roomHistory.slice()
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      showSaveIndicator();
    } catch (e) {
      // quota exceeded 等极端情况静默忽略
    }
  }, 300); // 300ms 防抖
}

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    var state = JSON.parse(raw);
    if (!state.nodes || !state.nodes.length) return false;

    // 清空当前数据
    cy.elements().remove();
    Object.keys(MD).forEach(function(k) { delete MD[k]; });

    // 恢复颜色
    if (state.colors) Object.assign(DOMAIN_COLORS, state.colors);

    // 恢复节点（带位置）
    state.nodes.forEach(function(n) {
      var ele = cy.add({ group: 'nodes', data: n.data, classes: n.classes || 'card' });
      if (n.position && n.position.x !== undefined) {
        ele.position(n.position);
      }
    });

    // 恢复边
    if (state.edges) {
      state.edges.forEach(function(e) {
        cy.add({ group: 'edges', data: e.data });
      });
    }

    // 恢复 Markdown
    if (state.markdown) Object.assign(MD, state.markdown);

    // 恢复视野状态
    if (state.view) {
      currentRoom = state.view.currentRoom || null;
      roomHistory = state.view.roomHistory || [];
    }

    return true;
  } catch (e) {
    return false;
  }
}

function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
}

function showSaveIndicator() {
  var el = document.getElementById('save-indicator');
  if (!el) return;
  el.classList.add('visible');
  setTimeout(function() { el.classList.remove('visible'); }, 1200);
}

// ===================== 颜色工具 =====================
function dc(nodeId) {
  return DOMAIN_COLORS[nodeId] || { bg: '#666', border: '#555', light: '#eee' };
}
// 根据节点找到其所属的顶层域颜色
function nodeColor(node) {
  var id = node.id();
  if (DOMAIN_COLORS[id]) return dc(id);
  // 向上找 parent
  var p = node.parent();
  while (p && p.length) {
    if (DOMAIN_COLORS[p.id()]) return dc(p.id());
    p = p.parent();
  }
  return dc(id);
}

// ===================== Cytoscape 初始化 =====================
var cy = cytoscape({
  container: document.getElementById('cy'),
  elements: { nodes: graphNodes, edges: graphEdges },
  minZoom: 0.15, maxZoom: 3.5, wheelSensitivity: 0.2,
  style: [
    // ===== 卡片基础 =====
    {
      selector: 'node.card',
      style: {
        'shape': 'roundrectangle',
        'label': 'data(label)',
        'font-family': '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'transition-property': 'background-color,border-color,border-width,opacity,padding',
        'transition-duration': '0.3s',
      }
    },
    // ===== 容器卡片（有子节点） =====
    {
      selector: 'node.card:parent',
      style: {
        'background-color': function(n) { return dc(n.id()).light || '#f5f6f8'; },
        'background-opacity': 0.7,
        'border-width': 2,
        'border-color': function(n) { return dc(n.id()).bg || '#aaa'; },
        'border-opacity': 0.45,
        'border-style': 'solid',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -4,
        'font-size': '13px',
        'font-weight': 'bold',
        'color': function(n) { return dc(n.id()).border || '#555'; },
        'text-background-color': function(n) { return dc(n.id()).light || '#f5f6f8'; },
        'text-background-opacity': 0.9,
        'text-background-padding': '4px',
        'text-background-shape': 'roundrectangle',
        'padding': '30px',
        'min-width': '60px',
        'min-height': '20px',
        'corner-radius': 12,
        // 阴影效果
        'underlay-color': '#000',
        'underlay-opacity': 0.06,
        'underlay-padding': 4,
        'underlay-shape': 'roundrectangle',
      }
    },
    // ===== 叶子卡片（无子节点） =====
    {
      selector: 'node.card:childless',
      style: {
        'background-color': function(n) { return nodeColor(n).bg; },
        'background-opacity': 0.92,
        'border-width': 0,
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '11px',
        'font-weight': 'normal',
        'color': '#fff',
        'width': 'label',
        'height': 'label',
        'padding': '11px',
        'corner-radius': 8,
        // 阴影
        'underlay-color': '#000',
        'underlay-opacity': 0.08,
        'underlay-padding': 3,
        'underlay-shape': 'roundrectangle',
      }
    },
    // ===== 主线边（演进/依赖）=====
    {
      selector: 'edge[weight="main"]',
      style: {
        'width': 2,
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 1,
        'font-size': '8px',
        'color': '#999',
        'text-background-color': '#f8f9fb',
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
        'text-rotation': 'autorotate',
        'text-margin-y': -8,
        'label': '',
      }
    },
    { selector: 'edge[relation="演进"][weight="main"]', style: {
      'line-color': '#5cb85c', 'target-arrow-color': '#5cb85c', 'label': '演进',
    }},
    { selector: 'edge[relation="依赖"][weight="main"]', style: {
      'line-color': '#e8913a', 'target-arrow-color': '#e8913a', 'label': '依赖',
    }},
    // ===== 次线边（相关）=====
    {
      selector: 'edge[weight="minor"]',
      style: {
        'width': 1, 'line-style': 'dotted', 'line-color': '#ccc',
        'target-arrow-shape': 'none', 'opacity': 0.4,
        'curve-style': 'unbundled-bezier',
        'control-point-distances': [20],
        'control-point-weights': [0.5],
        'label': '',
      }
    },
    // ===== 状态 =====
    { selector: 'node.selected', style: { 'border-width': 3, 'border-color': '#3498db', 'border-opacity': 1 } },
    { selector: 'node.card:childless.selected', style: { 'border-width': 2, 'border-color': '#fff' } },
    { selector: 'node.highlighted', style: { 'border-width': 3, 'border-color': '#f39c12', 'border-opacity': 1 } },
    { selector: 'edge.highlighted', style: { 'width': 3, 'opacity': 1, 'z-index': 999 } },
    { selector: 'node.faded', style: { 'opacity': 0.1 } },
    { selector: 'edge.faded', style: { 'opacity': 0.03 } },
    { selector: 'node.search-match', style: { 'border-width': 3, 'border-color': '#f1c40f', 'border-opacity': 1 } },
    { selector: '.hidden', style: { 'display': 'none' } },
    // ===== 缩放级 "折叠"提示 =====
    { selector: 'node.card.collapsed-hint', style: {
      'border-style': 'dashed', 'border-opacity': 0.4,
    }},
    // ===== 当前进入的房间：父容器视觉消失 =====
    { selector: 'node.room-active', style: {
      'background-opacity': 0,
      'border-width': 0,
      'border-opacity': 0,
      'label': '',
      'text-opacity': 0,
      'underlay-opacity': 0,
      'padding': '0px',
      'min-width': '0px',
      'min-height': '0px',
      'events': 'no',
    }},
  ]
});

// ===================== 视野管理（核心） =====================

/**
 * 进入某个"房间"。
 * roomId=null → 顶层全局视野（只看 level 1 + 顶层间的边）
 * roomId=某节点 → 看该节点的直接子节点 + 子节点间的边
 */
function enterRoom(roomId) {
  currentRoom = roomId;
  // 清除上一次的房间高亮
  cy.nodes('.room-active').removeClass('room-active');
  cy.elements().addClass('hidden');

  var visNodes, visEdges;

  if (roomId === null) {
    // 全局视野：只显示 level 1 节点
    visNodes = cy.nodes().filter(function(n) { return n.data('level') === 1; });
    visNodes.removeClass('hidden');
    // 隐藏所有 level >= 2 的子节点
    cy.nodes().filter(function(n) { return (n.data('level') || 1) >= 2; }).addClass('hidden');
    // 只显示两端都是 level 1 的边
    visEdges = cy.edges().filter(function(e) {
      return e.source().data('level') === 1 && e.target().data('level') === 1;
    });
    visEdges.removeClass('hidden');
  } else {
    var room = cy.getElementById(roomId);
    if (!room.length) return;

    // 父容器可见但视觉透明（不能用 display:none，否则子节点也会消失）
    room.removeClass('hidden');
    room.addClass('room-active');
    var kids = room.children();
    kids.removeClass('hidden');
    // 隐藏孙节点
    kids.forEach(function(kid) { kid.children().addClass('hidden'); });

    visNodes = kids;

    // 只显示 **两端都是当前房间直接子节点** 的边（不含跨层边）
    var kidIds = {};
    kids.forEach(function(k) { kidIds[k.id()] = true; });

    visEdges = cy.edges().filter(function(e) {
      return kidIds[e.source().id()] && kidIds[e.target().id()];
    });
    visEdges.removeClass('hidden');
  }

  // 缩放联动：默认先只显示主线，次线根据缩放决定
  cy.edges('[weight="minor"]').not('.hidden').addClass('hidden');
  if (cy.zoom() >= 0.8) {
    visEdges.filter('[weight="minor"]').removeClass('hidden');
  }

  // 布局
  var allVis = cy.elements().not('.hidden');
  if (allVis.length > 0) {
    var nodeCount = allVis.nodes().length;
    var dir = (roomId === null) ? 'RIGHT' : 'DOWN';
    var spacing = Math.max(30, 70 - nodeCount * 2);

    allVis.layout({
      name: 'elk',
      elk: {
        algorithm: 'layered',
        'elk.direction': dir,
        'elk.spacing.nodeNode': spacing,
        'elk.layered.spacing.nodeNodeBetweenLayers': spacing + 25,
        'elk.layered.spacing.edgeNodeBetweenLayers': 20,
        'elk.padding': '[top=40,left=30,bottom=30,right=30]',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      },
      fit: true, padding: 55,
      animate: roomId !== null, animationDuration: 350,
    }).run();
  }

  updateBreadcrumb();
  buildNavTree();
  updateRoomTitle();
  updateZoomIndicator();
  saveState();
}

// ===== 缩放联动：动态显示/隐藏次线边 =====
function updateZoomIndicator() {
  var z = cy.zoom();
  document.getElementById('zoom-indicator').textContent = Math.round(z * 100) + '%';

  // 次线边：只在放大到一定程度时才显示
  if (currentRoom !== null) {
    var room = cy.getElementById(currentRoom);
    if (room.length) {
      var kidIds = {};
      room.children().forEach(function(k) { kidIds[k.id()] = true; });
      var minorEdges = cy.edges('[weight="minor"]').filter(function(e) {
        return kidIds[e.source().id()] && kidIds[e.target().id()];
      });
      if (z >= 0.8) { minorEdges.removeClass('hidden'); }
      else { minorEdges.addClass('hidden'); }
    }
  } else {
    var topMinor = cy.edges('[weight="minor"]').filter(function(e) {
      return e.source().data('level') === 1 && e.target().data('level') === 1;
    });
    if (z >= 0.8) { topMinor.removeClass('hidden'); }
    else { topMinor.addClass('hidden'); }
  }

  // 边标签：只在足够大时才显示
  if (z < 0.6) {
    cy.edges('[weight="main"]').style('label', '');
  } else {
    cy.edges('[weight="main"][relation="演进"]').style('label', '演进');
    cy.edges('[weight="main"][relation="依赖"]').style('label', '依赖');
  }
}

/**
 * 双击卡片 → 进入该卡片内部
 */
function drillInto(nodeId) {
  var node = cy.getElementById(nodeId);
  if (!node.length) return;
  // 只有有子节点的卡片可以进入
  if (node.children().length === 0) {
    // 叶子节点：选中并显示详情
    if (selectedNode) selectedNode.removeClass('selected');
    node.addClass('selected'); selectedNode = node;
    showDetail(nodeId);
    return;
  }
  roomHistory.push(currentRoom);
  enterRoom(nodeId);
}

/**
 * 返回上一层
 */
function goBack() {
  if (roomHistory.length === 0) return;
  var prev = roomHistory.pop();
  enterRoom(prev);
}

/**
 * 返回到全局
 */
function goRoot() {
  roomHistory = [];
  enterRoom(null);
}

// ===================== 面包屑 =====================
function updateBreadcrumb() {
  var bc = document.getElementById('breadcrumb');
  if (currentRoom === null && roomHistory.length === 0) {
    bc.classList.remove('active');
    return;
  }
  bc.classList.add('active');
  var html = '<span class="bc-link" onclick="goRoot()">🏠 全局</span>';

  // 历史中的每一层
  for (var i = 0; i < roomHistory.length; i++) {
    var rid = roomHistory[i];
    if (rid === null) continue;
    var rn = cy.getElementById(rid);
    var rl = rn.length ? rn.data('label') : rid;
    html += '<span class="bc-sep">›</span><span class="bc-link" onclick="goToHistoryLevel(' + i + ')">' + rl + '</span>';
  }

  // 当前
  if (currentRoom !== null) {
    var cn = cy.getElementById(currentRoom);
    html += '<span class="bc-sep">›</span><span class="bc-current">' + (cn.length ? cn.data('label') : currentRoom) + '</span>';
  }
  bc.innerHTML = html;
}

window.goRoot = goRoot;
window.goToHistoryLevel = function(idx) {
  var target = roomHistory[idx];
  roomHistory = roomHistory.slice(0, idx);
  enterRoom(target);
};

function updateRoomTitle() {
  var h = document.getElementById('header');
  if (currentRoom === null) {
    h.textContent = 'TopoMind · 拓扑知识大脑';
  } else {
    var n = cy.getElementById(currentRoom);
    h.textContent = n.length ? n.data('label') : currentRoom;
  }
}

// ===================== Markdown 渲染 =====================
marked.setOptions({ breaks: true, gfm: true });

function showDetail(nodeId) {
  var md = MD[nodeId];
  var titleEl = document.getElementById('detail-title');
  var body = document.getElementById('detail-body');
  var rendered = body.querySelector('.rendered-content');
  var textarea = document.getElementById('detail-edit-area');
  var node = cy.getElementById(nodeId);
  var c = nodeColor(node);

  titleEl.textContent = node.data('label');
  titleEl.style.borderLeftColor = c.bg;

  // 内联编辑模式重置
  if (textarea) textarea.classList.remove('active');
  document.getElementById('btn-mode-read').classList.add('active');
  document.getElementById('btn-mode-edit').classList.remove('active');

  var hasKids = node.children().length > 0;
  var childInfo = '';
  if (hasKids) {
    childInfo = '<div style="margin:12px 0;padding:10px 14px;background:#f5f7fa;border-radius:8px;font-size:12px;color:#666">';
    childInfo += '<strong style="color:#333">📂 包含 ' + node.children().length + ' 个子概念</strong><br>';
    node.children().forEach(function(kid) {
      childInfo += '<span style="display:inline-block;margin:3px 4px 3px 0;padding:2px 8px;background:' + nodeColor(kid).bg + ';color:#fff;border-radius:4px;font-size:11px;cursor:pointer" onclick="drillInto(\'' + kid.id() + '\')">' + kid.data('label') + '</span>';
    });
    childInfo += '<br><small style="color:#aaa">双击卡片或点击标签进入</small></div>';
  }

  if (rendered) {
    rendered.style.display = '';
    rendered.innerHTML = (md ? marked.parse(md) : '<div style="color:#bbb;margin-top:20px">暂无文档内容</div>') + childInfo;
  }
  body.scrollTop = 0;

  document.getElementById('btn-edit-md').style.display = '';
  document.getElementById('btn-edit-node').style.display = '';
  document.getElementById('btn-delete-node').style.display = '';
  document.getElementById('detail-mode-toggle').classList.add('visible');

  document.querySelectorAll('#nav-tree .nav-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.id === nodeId);
  });
}
window.drillInto = drillInto;

function showPlaceholder() {
  document.getElementById('detail-title').textContent = '知识详情';
  document.getElementById('detail-title').style.borderLeftColor = '#ddd';
  var body = document.getElementById('detail-body');
  var rendered = body.querySelector('.rendered-content');
  if (rendered) { rendered.style.display = ''; rendered.innerHTML = '<div class="placeholder-text"><span>📖</span>点击节点查看详情<br><small style="color:#bbb">双击卡片进入内部</small></div>'; }
  var ta = document.getElementById('detail-edit-area');
  if (ta) ta.classList.remove('active');
  document.getElementById('btn-edit-md').style.display = 'none';
  document.getElementById('btn-edit-node').style.display = 'none';
  document.getElementById('btn-delete-node').style.display = 'none';
  document.getElementById('detail-mode-toggle').classList.remove('visible');
  document.querySelectorAll('#nav-tree .nav-item').forEach(function(el) { el.classList.remove('active'); });
}

// ===================== 构建左侧导航 =====================
function buildNavTree() {
  var tree = document.getElementById('nav-tree');
  tree.innerHTML = '';

  // 确定当前视野的节点
  var roomNode = currentRoom ? cy.getElementById(currentRoom) : null;
  var kids;
  if (roomNode && roomNode.length) {
    kids = roomNode.children();
  } else {
    kids = cy.nodes().filter(function(n) { return n.data('level') === 1; });
  }

  // 返回按钮
  if (currentRoom !== null) {
    var backRow = document.createElement('div');
    backRow.style.cssText = 'padding:8px 16px';
    backRow.innerHTML = '<button onclick="goBack()" style="width:100%;height:28px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;color:#666;transition:all .12s">← 返回上一层</button>';
    tree.appendChild(backRow);
  }

  kids.sort(function(a, b) { return a.data('label').localeCompare(b.data('label')); });
  kids.forEach(function(n) {
    var c = nodeColor(n);
    var hasKids = n.children().length > 0;
    var div = document.createElement('div');
    div.className = 'nav-group';
    var badge = hasKids ? '<span style="font-size:10px;color:#aaa;margin-left:4px">📂' + n.children().length + '</span>' : '';
    div.innerHTML = '<div class="nav-item nav-domain" data-id="' + n.id() + '" style="border-left-color:' + c.bg + '"><span>' + n.data('label') + badge + '</span><button class="nav-add-btn" data-parent="' + n.id() + '" title="添加子节点">＋</button></div>';
    tree.appendChild(div);
  });

  // 添加新卡片按钮
  var addRow = document.createElement('div');
  addRow.style.cssText = 'padding:8px 16px';
  addRow.innerHTML = '<button id="nav-add-card" style="width:100%;height:28px;border:1.5px dashed #ccc;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;color:#999">＋ 新建卡片</button>';
  tree.appendChild(addRow);

  // 绑定事件
  tree.querySelectorAll('.nav-item').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.classList.contains('nav-add-btn')) return;
      var nid = el.dataset.id;
      var node = cy.getElementById(nid);
      if (!node.length) return;
      if (selectedNode) selectedNode.removeClass('selected');
      node.addClass('selected'); selectedNode = node;
      showDetail(nid);
    });
    el.addEventListener('dblclick', function(e) {
      if (e.target.classList.contains('nav-add-btn')) return;
      drillInto(el.dataset.id);
    });
  });

  tree.querySelectorAll('.nav-add-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var pid = btn.dataset.parent;
      var name = prompt('输入子概念名称：');
      if (!name || !name.trim()) return;
      quickAddChild(pid, name.trim());
    });
  });

  var addCardBtn = document.getElementById('nav-add-card');
  if (addCardBtn) {
    addCardBtn.addEventListener('click', function() {
      var name = prompt('输入新卡片名称：');
      if (!name || !name.trim()) return;
      quickAddChild(currentRoom, name.trim());
    });
  }
}
window.goBack = goBack;

// ===================== 快捷创建 =====================
var autoIdCounter = Date.now();
function autoId(prefix) { return (prefix || 'n') + '-' + (autoIdCounter++).toString(36); }

function quickAddChild(parentId, label) {
  var id = autoId('c');
  var d = { id: id, label: label, level: 2 };
  if (parentId) {
    d.parent = parentId;
    // 计算 level
    var pn = cy.getElementById(parentId);
    d.level = (pn.data('level') || 1) + 1;
  } else {
    d.level = 1;
  }
  // 确保颜色
  if (!DOMAIN_COLORS[id]) {
    var pool = ['#4a6fa5','#5a8f7b','#7b68ae','#c0723a','#2e86ab','#a23b72','#d64045','#5b7065','#6a8e5d','#8e6a5d'];
    DOMAIN_COLORS[id] = { bg: pool[Object.keys(DOMAIN_COLORS).length % pool.length], border: '#555', light: '#f0f0f0' };
  }
  cy.add({ group: 'nodes', data: d, classes: 'card' });
  if (!MD[id]) MD[id] = '';
  // 刷新视野
  enterRoom(currentRoom);
  saveState();
}

// ===================== 节点交互 =====================
cy.on('tap', 'node', function(evt) {
  if (edgeMode && edgeModeSource) return;
  var node = evt.target;
  if (node.hasClass('hidden') || node.hasClass('room-active')) return;
  if (selectedNode) selectedNode.removeClass('selected');
  node.addClass('selected'); selectedNode = node;
  showDetail(node.id());
});

// 双击进入卡片
cy.on('dbltap', 'node', function(evt) {
  var node = evt.target;
  if (node.hasClass('hidden') || node.hasClass('room-active')) return;
  drillInto(node.id());
});

// 双击空白创建卡片
cy.on('dbltap', function(evt) {
  if (evt.target !== cy) return;
  var name = prompt('输入新卡片名称：');
  if (!name || !name.trim()) return;
  quickAddChild(currentRoom, name.trim());
});

// 悬停高亮
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
cy.on('mouseout', 'node', function() {
  cy.elements().removeClass('faded highlighted');
});

cy.on('tap', function(evt) {
  if (evt.target === cy) {
    if (selectedNode) { selectedNode.removeClass('selected'); selectedNode = null; }
    showPlaceholder();
  }
});

// ===================== 搜索 =====================
var searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', function() {
  var q = this.value.trim().toLowerCase();
  cy.nodes().removeClass('search-match');
  if (!q) return;
  cy.nodes().forEach(function(n) {
    if ((n.data('label') || '').toLowerCase().includes(q) || n.id().toLowerCase().includes(q)) {
      n.addClass('search-match');
    }
  });
});
searchInput.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { this.value = ''; cy.nodes().removeClass('search-match'); }
});

// ===================== 键盘快捷 =====================
document.addEventListener('keydown', function(e) {
  // Esc
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(function(m) { m.classList.remove('active'); });
    if (edgeMode) { edgeMode = false; edgeModeSource = null; document.getElementById('edge-mode-hint').classList.remove('active'); }
  }
  // Backspace → 返回上一层（非输入状态）
  if (e.key === 'Backspace' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !document.querySelector('.modal-overlay.active')) {
    if (currentRoom !== null) { e.preventDefault(); goBack(); }
  }
  // Tab → 快速添加子节点
  if (e.key === 'Tab' && selectedNode && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !document.querySelector('.modal-overlay.active')) {
    e.preventDefault();
    var name = prompt('输入子概念名称：');
    if (name && name.trim()) quickAddChild(selectedNode.id(), name.trim());
  }
  // Delete → 删除选中
  if (e.key === 'Delete' && selectedNode && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !document.querySelector('.modal-overlay.active')) {
    e.preventDefault();
    confirmDeleteNode(selectedNode);
  }
});

// ===================== 控制按钮 =====================
document.getElementById('btn-zoomin').addEventListener('click', function() { cy.animate({ zoom: cy.zoom() * 1.3 }, { duration: 200 }); });
document.getElementById('btn-zoomout').addEventListener('click', function() { cy.animate({ zoom: cy.zoom() / 1.3 }, { duration: 200 }); });
document.getElementById('btn-fit').addEventListener('click', function() { cy.animate({ fit: { padding: 50 } }, { duration: 300 }); });

cy.on('zoom', function() {
  updateZoomIndicator();
});

// ===================== 启动 =====================
var loaded = loadState();
if (loaded) {
  // 从存档恢复后，直接进入保存的视野
  enterRoom(currentRoom);
} else {
  enterRoom(null);
}

// ===================== 右侧内联编辑 =====================
document.getElementById('btn-mode-read').addEventListener('click', function() { switchDetailMode('read'); });
document.getElementById('btn-mode-edit').addEventListener('click', function() { switchDetailMode('edit'); });

function switchDetailMode(mode) {
  var body = document.getElementById('detail-body');
  var rendered = body.querySelector('.rendered-content');
  var textarea = document.getElementById('detail-edit-area');

  if (mode === 'edit' && selectedNode) {
    document.getElementById('btn-mode-read').classList.remove('active');
    document.getElementById('btn-mode-edit').classList.add('active');
    textarea.value = MD[selectedNode.id()] || '';
    textarea.classList.add('active');
    if (rendered) rendered.style.display = 'none';
    textarea.focus();
  } else {
    if (selectedNode) {
      MD[selectedNode.id()] = textarea.value;
      saveState();
    }
    document.getElementById('btn-mode-read').classList.add('active');
    document.getElementById('btn-mode-edit').classList.remove('active');
    textarea.classList.remove('active');
    if (rendered) rendered.style.display = '';
    if (selectedNode) showDetail(selectedNode.id());
  }
}

document.getElementById('btn-edit-md').onclick = function() { if (selectedNode) switchDetailMode('edit'); };

// ===================== CRUD（模态框兼容） =====================
var edgeIdCounter = 100;
function nextEdgeId() { return 'e' + (edgeIdCounter++); }
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
window.openModal = openModal; window.closeModal = closeModal;

// 右键菜单
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

// 节点编辑
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
  if (editingNodeId) {
    cy.getElementById(editingNodeId).data('label', label);
    if (selectedNode && selectedNode.id() === editingNodeId) showDetail(editingNodeId);
    buildNavTree();
    saveState();
  }
  closeModal('modal-node');
});
document.getElementById('btn-add-node').addEventListener('click', function() {
  var name = prompt('输入新卡片名称：');
  if (name && name.trim()) quickAddChild(currentRoom, name.trim());
});

// 删除
var pendingDeleteNode = null;
function confirmDeleteNode(n) {
  pendingDeleteNode = n;
  document.getElementById('confirm-message').textContent = '删除「' + n.data('label') + '」及其所有子节点？';
  openModal('modal-confirm');
}
document.getElementById('btn-delete-node').addEventListener('click', function() { if (selectedNode) confirmDeleteNode(selectedNode); });
document.getElementById('btn-confirm-delete').addEventListener('click', function() {
  if (pendingDeleteNode) {
    // 递归删除子节点
    function removeRecursive(n) {
      n.children().forEach(removeRecursive);
      var id = n.id();
      n.connectedEdges().remove();
      n.remove();
      delete MD[id];
    }
    removeRecursive(pendingDeleteNode);
    if (selectedNode && selectedNode.id() === pendingDeleteNode.id()) { selectedNode = null; showPlaceholder(); }
    pendingDeleteNode = null;
    enterRoom(currentRoom);
    saveState();
  }
  closeModal('modal-confirm');
});

// 边
var editingEdgeRef = null;
document.getElementById('btn-add-edge').addEventListener('click', function() {
  edgeMode = true; edgeModeSource = selectedNode;
  document.getElementById('edge-mode-hint').classList.add('active');
});
function openEditEdgeModal(e) {
  editingEdgeRef = e;
  document.getElementById('modal-edge-title').textContent = '编辑连线';
  var h = ''; cy.nodes().forEach(function(n) { h += '<option value="' + n.id() + '">' + n.data('label') + '</option>'; });
  document.getElementById('edge-source').innerHTML = h; document.getElementById('edge-target').innerHTML = h;
  document.getElementById('edge-source').value = e.source().id();
  document.getElementById('edge-target').value = e.target().id();
  document.getElementById('edge-relation').value = e.data('relation');
  openModal('modal-edge');
}
document.getElementById('btn-save-edge').addEventListener('click', function() {
  var s = document.getElementById('edge-source').value, t = document.getElementById('edge-target').value, r = document.getElementById('edge-relation').value;
  if (!s || !t || s === t) { alert('请正确选择'); return; }
  var w = (r === '相关') ? 'minor' : 'main';
  if (editingEdgeRef) { editingEdgeRef.data('relation', r); editingEdgeRef.data('weight', w); editingEdgeRef = null; }
  else { cy.add({ group: 'edges', data: { id: nextEdgeId(), source: s, target: t, relation: r, weight: w } }); }
  closeModal('modal-edge');
  saveState();
});
document.getElementById('btn-cancel-edge-mode').addEventListener('click', function() { edgeMode = false; edgeModeSource = null; document.getElementById('edge-mode-hint').classList.remove('active'); });
cy.on('tap', 'node', function(e) {
  if (!edgeMode || !edgeModeSource) return;
  var t = e.target; if (t.id() === edgeModeSource.id()) return;
  var r = prompt('关系类型（演进/依赖/相关）：', '依赖');
  if (!r) { edgeMode = false; edgeModeSource = null; document.getElementById('edge-mode-hint').classList.remove('active'); return; }
  var w = (r === '相关') ? 'minor' : 'main';
  cy.add({ group: 'edges', data: { id: nextEdgeId(), source: edgeModeSource.id(), target: t.id(), relation: r, weight: w } });
  edgeMode = false; edgeModeSource = null; document.getElementById('edge-mode-hint').classList.remove('active');
  saveState();
});

// 导出/导入
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
      if (d.nodes) d.nodes.forEach(function(n) {
        var ele = cy.add({ group: 'nodes', data: n.data, classes: n.classes || 'card' });
        if (n.position && n.position.x !== undefined) ele.position(n.position);
      });
      if (d.edges) d.edges.forEach(function(e) { cy.add({ group: 'edges', data: e.data }); });
      if (d.markdown) Object.assign(MD, d.markdown);
      roomHistory = []; currentRoom = null; selectedNode = null;
      enterRoom(null); showPlaceholder();
      saveState();
    } catch (err) { alert('导入失败：' + err.message); }
  }; reader.readAsText(f); ev.target.value = '';
});

// 重置为默认数据
document.getElementById('btn-reset').addEventListener('click', function() {
  if (!confirm('确定要重置吗？将清除所有修改，恢复为初始数据。')) return;
  clearSavedState();
  location.reload();
});

// 启动提示
setTimeout(function() {
  var h = document.getElementById('shortcut-hint');
  if (h) { h.classList.add('visible'); setTimeout(function() { h.classList.remove('visible'); }, 4000); }
}, 800);

// =====================================================================
// ========== 画布网格系统 + 对齐辅助 ==========
// =====================================================================

var GRID_SIZE = 20; // 网格间距（模型坐标）
var gridEnabled = true;
var snapEnabled = false;
var SNAP_THRESHOLD = 6; // 对齐吸附像素阈值

// ===== 1. 网格背景渲染 =====
var gridCanvas = document.getElementById('grid-canvas');
var gridCtx = gridCanvas.getContext('2d');

function drawGrid() {
  var panel = document.getElementById('graph-panel');
  var w = panel.offsetWidth;
  var h = panel.offsetHeight;

  if (gridCanvas.width !== w * 2 || gridCanvas.height !== h * 2) {
    gridCanvas.width = w * 2;
    gridCanvas.height = h * 2;
    gridCanvas.style.width = w + 'px';
    gridCanvas.style.height = h + 'px';
    gridCtx.scale(2, 2); // retina
  }

  gridCtx.clearRect(0, 0, w, h);
  if (!gridEnabled) return;

  var zoom = cy.zoom();
  var pan = cy.pan();

  // 自适应网格密度
  var step = GRID_SIZE * zoom;
  while (step < 12) step *= 5;
  while (step > 80) step /= 2;

  var bigStep = step * 5;

  // 画布偏移
  var offX = pan.x % step;
  var offY = pan.y % step;
  var bigOffX = pan.x % bigStep;
  var bigOffY = pan.y % bigStep;

  // 小点
  gridCtx.fillStyle = 'rgba(160,170,185,0.25)';
  for (var x = offX; x < w; x += step) {
    for (var y = offY; y < h; y += step) {
      gridCtx.beginPath();
      gridCtx.arc(x, y, 0.8, 0, Math.PI * 2);
      gridCtx.fill();
    }
  }

  // 大交叉点
  gridCtx.fillStyle = 'rgba(140,150,165,0.4)';
  for (var bx = bigOffX; bx < w; bx += bigStep) {
    for (var by = bigOffY; by < h; by += bigStep) {
      gridCtx.beginPath();
      gridCtx.arc(bx, by, 1.5, 0, Math.PI * 2);
      gridCtx.fill();
    }
  }

  // 十字线（原点）
  var ox = pan.x, oy = pan.y;
  if (ox > 0 && ox < w && oy > 0 && oy < h) {
    gridCtx.strokeStyle = 'rgba(52,152,219,0.15)';
    gridCtx.lineWidth = 1;
    gridCtx.setLineDash([4, 4]);
    gridCtx.beginPath();
    gridCtx.moveTo(ox, 0); gridCtx.lineTo(ox, h);
    gridCtx.moveTo(0, oy); gridCtx.lineTo(w, oy);
    gridCtx.stroke();
    gridCtx.setLineDash([]);
  }
}

// 监听画布变化重绘网格
cy.on('zoom pan resize', drawGrid);
window.addEventListener('resize', function() { setTimeout(drawGrid, 50); });
setTimeout(drawGrid, 400);

// ===== 2. 网格开关 =====
document.getElementById('btn-toggle-grid').addEventListener('click', function() {
  gridEnabled = !gridEnabled;
  this.classList.toggle('active', gridEnabled);
  drawGrid();
});

// ===== 3. Snap 吸附对齐 =====
document.getElementById('btn-snap').addEventListener('click', function() {
  snapEnabled = !snapEnabled;
  this.classList.toggle('active', snapEnabled);
});

// ===== 4. 拖拽时的智能对齐辅助线 + Snap =====
var guideH = document.getElementById('guide-h');
var guideV = document.getElementById('guide-v');
var isDragging = false;

cy.on('grab', 'node', function() { isDragging = true; });

cy.on('drag', 'node', function(evt) {
  if (!isDragging) return;
  var node = evt.target;
  var pos = node.position();

  // snap to grid
  if (snapEnabled) {
    var gs = GRID_SIZE;
    var snappedX = Math.round(pos.x / gs) * gs;
    var snappedY = Math.round(pos.y / gs) * gs;
    node.position({ x: snappedX, y: snappedY });
    pos = node.position();
  }

  // 对齐辅助线：检测与其他可见节点的对齐
  var rpos = node.renderedPosition();
  var foundH = false, foundV = false;
  var panel = document.getElementById('graph-panel').getBoundingClientRect();

  cy.nodes().not(node).not('.hidden').forEach(function(other) {
    var oRpos = other.renderedPosition();
    // 水平对齐（Y 相近）
    if (Math.abs(rpos.y - oRpos.y) < SNAP_THRESHOLD) {
      guideH.style.display = 'block';
      guideH.style.top = oRpos.y + 'px';
      foundH = true;
      if (snapEnabled) {
        node.renderedPosition('y', oRpos.y);
      }
    }
    // 垂直对齐（X 相近）
    if (Math.abs(rpos.x - oRpos.x) < SNAP_THRESHOLD) {
      guideV.style.display = 'block';
      guideV.style.left = oRpos.x + 'px';
      foundV = true;
      if (snapEnabled) {
        node.renderedPosition('x', oRpos.x);
      }
    }
  });

  if (!foundH) guideH.style.display = 'none';
  if (!foundV) guideV.style.display = 'none';
});

cy.on('free', 'node', function() {
  isDragging = false;
  guideH.style.display = 'none';
  guideV.style.display = 'none';
  saveState();
});

// ===== 5. 自动整理（重新 ELK 布局 + snap to grid） =====
document.getElementById('btn-auto-align').addEventListener('click', function() {
  // 重新布局当前视野
  var allVis = cy.elements().not('.hidden');
  if (allVis.length === 0) return;

  var dir = (currentRoom === null) ? 'RIGHT' : 'DOWN';
  var nodeCount = allVis.nodes().length;
  var spacing = Math.max(35, 70 - nodeCount * 2);

  allVis.layout({
    name: 'elk',
    elk: {
      algorithm: 'layered',
      'elk.direction': dir,
      'elk.spacing.nodeNode': spacing,
      'elk.layered.spacing.nodeNodeBetweenLayers': spacing + 30,
      'elk.layered.spacing.edgeNodeBetweenLayers': 20,
      'elk.padding': '[top=40,left=30,bottom=30,right=30]',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    fit: true, padding: 55,
    animate: true, animationDuration: 400,
  }).run();

  // 布局后 snap to grid
  if (snapEnabled) {
    setTimeout(function() {
      cy.nodes().not('.hidden').forEach(function(n) {
        var p = n.position();
        n.position({
          x: Math.round(p.x / GRID_SIZE) * GRID_SIZE,
          y: Math.round(p.y / GRID_SIZE) * GRID_SIZE,
        });
      });
    }, 450);
  }

  setTimeout(drawGrid, 500);
});
