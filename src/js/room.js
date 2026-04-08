/**
 * 视野/房间管理：进入、退出、面包屑
 */
function enterRoom(roomId) {
  flushEdit();
  currentRoom = roomId;
  cy.nodes('.room-active').removeClass('room-active');
  cy.elements().addClass('hidden');

  var visNodes, visEdges;

  if (roomId === null) {
    visNodes = cy.nodes().filter(function(n) { return n.data('level') === 1; });
    visNodes.removeClass('hidden');
    cy.nodes().filter(function(n) { return (n.data('level') || 1) >= 2; }).addClass('hidden');
    visEdges = cy.edges().filter(function(e) {
      return e.source().data('level') === 1 && e.target().data('level') === 1;
    });
    visEdges.removeClass('hidden');
  } else {
    var room = cy.getElementById(roomId);
    if (!room.length) return;
    room.removeClass('hidden');
    room.addClass('room-active');
    var kids = room.children();
    kids.removeClass('hidden');
    kids.forEach(function(kid) { kid.children().addClass('hidden'); });
    visNodes = kids;
    var kidIds = {};
    kids.forEach(function(k) { kidIds[k.id()] = true; });
    visEdges = cy.edges().filter(function(e) {
      return kidIds[e.source().id()] && kidIds[e.target().id()];
    });
    visEdges.removeClass('hidden');
  }

  cy.edges('[weight="minor"]').not('.hidden').addClass('hidden');
  if (cy.zoom() >= 0.8) visEdges.filter('[weight="minor"]').removeClass('hidden');

  // 只在节点没有合理位置时才重新布局，否则保留已有位置
  var allVis = cy.elements().not('.hidden');
  var visibleNodes = allVis.nodes();
  if (visibleNodes.length > 0) {
    var needLayout = false;
    // 检查可见节点是否都在原点附近（说明没有保存的位置）
    visibleNodes.forEach(function(n) {
      if (n.hasClass('room-active')) return;
      var p = n.position();
      if (!p || (p.x === 0 && p.y === 0)) needLayout = true;
    });
    // 如果多个节点重叠在同一点也需要重新布局
    if (!needLayout && visibleNodes.length > 1) {
      var positions = {};
      var overlap = 0;
      visibleNodes.forEach(function(n) {
        if (n.hasClass('room-active')) return;
        var key = Math.round(n.position().x) + ',' + Math.round(n.position().y);
        if (positions[key]) overlap++;
        positions[key] = true;
      });
      if (overlap > visibleNodes.length * 0.3) needLayout = true;
    }

    if (needLayout) {
      var nodeCount = visibleNodes.length;
      var dir = (roomId === null) ? 'RIGHT' : 'DOWN';
      var spacing = Math.max(30, 70 - nodeCount * 2);
      allVis.layout({
        name: 'elk',
        elk: {
          algorithm: 'layered', 'elk.direction': dir,
          'elk.spacing.nodeNode': spacing, 'elk.layered.spacing.nodeNodeBetweenLayers': spacing + 25,
          'elk.layered.spacing.edgeNodeBetweenLayers': 20,
          'elk.padding': '[top=40,left=30,bottom=30,right=30]',
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        },
        fit: true, padding: 55, animate: roomId !== null, animationDuration: 350,
      }).run();
    }
    // 已有位置时不做任何 fit/zoom 调整，保留用户当前视野
  }

  updateBreadcrumb();
  buildNavTree();
  updateRoomTitle();
  updateZoomIndicator();
  saveState();
}

function updateZoomIndicator() {
  var z = cy.zoom();
  document.getElementById('zoom-indicator').textContent = Math.round(z * 100) + '%';
  if (currentRoom !== null) {
    var room = cy.getElementById(currentRoom);
    if (room.length) {
      var kidIds = {};
      room.children().forEach(function(k) { kidIds[k.id()] = true; });
      var me = cy.edges('[weight="minor"]').filter(function(e) { return kidIds[e.source().id()] && kidIds[e.target().id()]; });
      if (z >= 0.8) me.removeClass('hidden'); else me.addClass('hidden');
    }
  } else {
    var tm = cy.edges('[weight="minor"]').filter(function(e) { return e.source().data('level') === 1 && e.target().data('level') === 1; });
    if (z >= 0.8) tm.removeClass('hidden'); else tm.addClass('hidden');
  }
  if (z < 0.6) { cy.edges('[weight="main"]').style('label', ''); }
  else { cy.edges('[weight="main"][relation="演进"]').style('label', '演进'); cy.edges('[weight="main"][relation="依赖"]').style('label', '依赖'); }
}

function drillInto(nodeId) {
  var node = cy.getElementById(nodeId);
  if (!node.length) return;
  if (node.children().length === 0) {
    if (selectedNode) selectedNode.removeClass('selected');
    node.addClass('selected'); selectedNode = node;
    showDetail(nodeId); return;
  }
  roomHistory.push(currentRoom);
  enterRoom(nodeId);
}
window.drillInto = drillInto;

function goBack() { if (roomHistory.length === 0) return; enterRoom(roomHistory.pop()); }
function goRoot() { roomHistory = []; enterRoom(null); }
window.goRoot = goRoot;
window.goBack = goBack;
window.goToHistoryLevel = function(idx) {
  var target = roomHistory[idx];
  roomHistory = roomHistory.slice(0, idx);
  enterRoom(target);
};

function updateBreadcrumb() {
  var bc = document.getElementById('breadcrumb');
  if (currentRoom === null && roomHistory.length === 0) { bc.classList.remove('active'); return; }
  bc.classList.add('active');
  var html = '<span class="bc-link" onclick="goRoot()">🏠 全局</span>';
  for (var i = 0; i < roomHistory.length; i++) {
    var rid = roomHistory[i]; if (rid === null) continue;
    var rn = cy.getElementById(rid);
    html += '<span class="bc-sep">›</span><span class="bc-link" onclick="goToHistoryLevel(' + i + ')">' + (rn.length ? rn.data('label') : rid) + '</span>';
  }
  if (currentRoom !== null) {
    var cn = cy.getElementById(currentRoom);
    html += '<span class="bc-sep">›</span><span class="bc-current">' + (cn.length ? cn.data('label') : currentRoom) + '</span>';
  }
  bc.innerHTML = html;
}

function updateRoomTitle() {
  var h = document.getElementById('header');
  if (currentRoom === null) h.textContent = 'TopoMind · 拓扑知识大脑';
  else { var n = cy.getElementById(currentRoom); h.textContent = n.length ? n.data('label') : currentRoom; }
}

/** 仅刷新可见性，不重新布局也不调整视野 */
function refreshRoomVisibility() {
  cy.nodes('.room-active').removeClass('room-active');
  cy.elements().addClass('hidden');

  if (currentRoom === null) {
    cy.nodes().filter(function(n) { return n.data('level') === 1; }).removeClass('hidden');
    cy.edges().filter(function(e) {
      return e.source().data('level') === 1 && e.target().data('level') === 1;
    }).removeClass('hidden');
  } else {
    var room = cy.getElementById(currentRoom);
    if (!room.length) return;
    room.removeClass('hidden').addClass('room-active');
    var kids = room.children();
    kids.removeClass('hidden');
    kids.forEach(function(kid) { kid.children().addClass('hidden'); });
    var kidIds = {};
    kids.forEach(function(k) { kidIds[k.id()] = true; });
    cy.edges().filter(function(e) {
      return kidIds[e.source().id()] && kidIds[e.target().id()];
    }).removeClass('hidden');
  }

  cy.edges('[weight="minor"]').not('.hidden').addClass('hidden');
  if (cy.zoom() >= 0.8) cy.edges('[weight="minor"]').not('.hidden').removeClass('hidden');

  updateBreadcrumb();
  buildNavTree();
  updateRoomTitle();
  updateZoomIndicator();
}
