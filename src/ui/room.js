/**
 * 房间视野管理
 * 进入房间 = 读取该目录的子目录 + _meta.json → 渲染到 Cytoscape
 */

/** 加载并渲染某个目录（房间）的内容 */
function loadRoom(dirPath) {
  currentRoomPath = dirPath === currentKBPath ? null : dirPath;

  // 读取该目录的子卡片 + 布局元数据
  Promise.all([
    Store.listCards(dirPath),
    Store.readLayout(dirPath)
  ]).then(function(results) {
    var cards = results[0];
    var meta = results[1] || {};
    var children = meta.children || {};
    var edges = meta.edges || [];

    // 恢复画布边界
    if (meta.canvasBounds) {
      setCanvasBounds(meta.canvasBounds);
    } else {
      setCanvasBounds({ x: -750, y: -500, w: 1500, h: 1000 });
    }

    // 清空 Cytoscape
    cy.elements().remove();

    // 添加节点
    cards.forEach(function(card) {
      var saved = children[card.path] || children[card.name] || {};
      var data = {
        id: card.path,
        label: saved.name || card.name,
        cardPath: card.path,
        color: saved.color || ''
      };
      var ele = cy.add({ group: 'nodes', data: data, classes: 'card' });
      if (data.color) ele.style('background-color', data.color);
      if (saved.posX !== undefined && saved.posY !== undefined && (saved.posX !== 0 || saved.posY !== 0)) {
        ele.position({ x: saved.posX, y: saved.posY });
      }
    });

    // 添加边
    edges.forEach(function(e) {
      if (cy.getElementById(e.source).length && cy.getElementById(e.target).length) {
        cy.add({ group: 'edges', data: {
          id: e.id || autoId('e'),
          source: e.source,
          target: e.target,
          relation: e.relation || '相关',
          weight: e.weight || 'minor'
        }});
      }
    });

    // 检查是否需要自动布局
    var hasPositions = false;
    cy.nodes().forEach(function(n) {
      var p = n.position();
      if (p.x !== 0 || p.y !== 0) hasPositions = true;
    });

    // 记录进入前的缩放率（保持不变）
    var keepZoom = cy.zoom();

    if (!hasPositions && cards.length > 0) {
      // 位置全为零 → 自动布局，但布局完成后恢复 zoom，只调整 pan
      if (cy.nodes().length > 0) {
        cy.nodes().layout({
          name: 'elk',
          elk: {
            algorithm: 'layered', 'elk.direction': 'RIGHT',
            'elk.spacing.nodeNode': 60, 'elk.layered.spacing.nodeNodeBetweenLayers': 80,
            'elk.padding': '[top=40,left=30,bottom=30,right=30]',
          },
          fit: false, animate: false,
          ready: function() {},
          stop: function() {
            // 布局完成后：保持 zoom，将节点包围盒居中
            cy.zoom(keepZoom);
            cy.center();
          }
        }).run();
      }
    } else if (meta.zoom && meta.pan) {
      // 有保存的视野 → 仅恢复 pan，zoom 保持当前值
      cy.pan(meta.pan);
    } else if (cy.nodes().length > 0) {
      // 有位置但无保存视野 → 保持 zoom，将节点居中
      cy.zoom(keepZoom);
      cy.center();
    }

    updateBreadcrumb();
    buildNavTree();
    updateRoomTitle();
  });
}

// ===== 钻入/返回 =====

function drillInto(cardPath) {
  // 先同步构建 meta，保存完成后再检查子目录，避免 loadRoom 清空图谱前 save 未完成
  var meta = buildCurrentMeta();
  var dirPath = currentRoomPath || currentKBPath;
  Store.saveLayout(dirPath, meta).then(function() {
    Store.listCards(cardPath).then(function(kids) {
      if (kids.length === 0) {
        // 叶子卡片，只显示详情
        var node = cy.getElementById(cardPath);
        if (node.length) {
          if (selectedNode) selectedNode.removeClass('selected');
          node.addClass('selected'); selectedNode = node;
          showDetail(cardPath);
        }
        return;
      }
      // 有子目录，进入
      var prev = currentRoomPath || currentKBPath;
      roomHistory.push(prev);
      loadRoom(cardPath);
    });
  });
}

function goBack() {
  if (roomHistory.length === 0) { showHome(); return; }
  var meta = buildCurrentMeta();
  var dirPath = currentRoomPath || currentKBPath;
  Store.saveLayout(dirPath, meta).then(function() {
    loadRoom(roomHistory.pop());
  });
}

function goRoot() {
  var meta = buildCurrentMeta();
  var dirPath = currentRoomPath || currentKBPath;
  Store.saveLayout(dirPath, meta).then(function() {
    roomHistory = [];
    loadRoom(currentKBPath);
  });
}

function goToHistoryLevel(idx) {
  var meta = buildCurrentMeta();
  var dirPath = currentRoomPath || currentKBPath;
  Store.saveLayout(dirPath, meta).then(function() {
    var target = roomHistory[idx];
    roomHistory = roomHistory.slice(0, idx);
    loadRoom(target);
  });
}

// ===== 保存当前房间布局 =====

function saveCurrentLayout() {
  if (!currentKBPath) return;
  var dirPath = currentRoomPath || currentKBPath;
  var meta = buildCurrentMeta();
  Store.saveLayout(dirPath, meta);
  GitStore.markDirty(currentKBPath);
}

// ===== 面包屑 =====

/** 兼容 Windows/Unix 路径，取最后一段名称 */
function _pathBasename(p) {
  return (p || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;
}

function updateBreadcrumb() {
  var bc = document.getElementById('breadcrumb');
  if (!currentRoomPath) { bc.classList.remove('active'); return; }
  bc.classList.add('active');

  var html = '<span class="bc-link" onclick="goRoot()">🏠 ' + escHtml(_pathBasename(currentKBPath) || '根') + '</span>';
  for (var i = 0; i < roomHistory.length; i++) {
    var p = roomHistory[i];
    if (p === currentKBPath) continue;
    var name = escHtml(_pathBasename(p));
    html += '<span class="bc-sep">›</span><span class="bc-link" onclick="goToHistoryLevel(' + i + ')">' + name + '</span>';
  }
  if (currentRoomPath) {
    var curName = escHtml(_pathBasename(currentRoomPath));
    html += '<span class="bc-sep">›</span><span class="bc-current">' + curName + '</span>';
  }
  bc.innerHTML = html;
}

function updateRoomTitle() {
  var h = document.getElementById('header');
  if (!currentRoomPath) {
    h.textContent = _pathBasename(currentKBPath) || 'TopoMind';
  } else {
    h.textContent = _pathBasename(currentRoomPath);
  }
}

window.drillInto = drillInto;
window.goBack = goBack;
window.goRoot = goRoot;
window.goToHistoryLevel = goToHistoryLevel;
