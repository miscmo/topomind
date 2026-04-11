/**
 * 房间视野管理
 * 进入房间 = 读取该目录的子目录 + _meta.json → 渲染到 Cytoscape
 */

// 路径 -> 用户可见名称 映射缓存
var _pathNameMap = {};

/** 加载并渲染某个目录（房间）的内容 */
function loadRoom(dirPath) {
  currentRoomPath = dirPath === currentKBPath ? null : dirPath;

  // 读取该目录的子卡片 + 布局元数据
  return Promise.all([
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

    // 构建路径->名称映射
    cards.forEach(function(card) {
      _pathNameMap[card.path] = card.name || card.path;
    });
    // 当前目录的名称
    if (dirPath) {
      var metaName = meta.name;
      if (metaName) _pathNameMap[dirPath] = metaName;
    }

    // 添加节点
    cards.forEach(function(card) {
      var saved = children[card.path] || children[card.name] || {};
      var data = {
        id: card.path,
        label: saved.name || card.name,
        cardPath: card.path,
        color:        saved.color        || '',
        fontColor:    saved.fontColor    || '',
        fontSize:     saved.fontSize     || 0,
        fontStyle:    saved.fontStyle    || '',
        textAlign:    saved.textAlign    || '',
        textWrap:     saved.textWrap !== undefined ? saved.textWrap : true,
        nodeWidth:    saved.nodeWidth    || '',
        nodeHeight:   saved.nodeHeight   || '',
        borderColor:  saved.borderColor  || '',
        borderWidth:  saved.borderWidth  || 0,
        nodeShape:    saved.nodeShape    || '',
        shadowOpacity:saved.shadowOpacity|| 0,
        nodeOpacity:  saved.nodeOpacity  != null ? saved.nodeOpacity : 1,
      };
      var ele = cy.add({ group: 'nodes', data: data, classes: 'card' });
      if (data.color)       ele.style('background-color', data.color);
      if (data.fontColor)   ele.style('color', data.fontColor);
      if (data.fontSize)    ele.style('font-size', data.fontSize + 'px');
      if (data.fontStyle)  {
        var styles = data.fontStyle.split(' ');
        if (styles.indexOf('bold') >= 0) ele.style('font-weight', 'bold');
        if (styles.indexOf('italic') >= 0) ele.style('font-style', 'italic');
      }
      if (data.textAlign)   ele.style('text-halign', data.textAlign);
      if (!data.textWrap)   ele.style('text-wrap', 'none');
      if (data.nodeWidth)   { ele.style('width', data.nodeWidth + 'px'); ele.style('text-max-width', data.nodeWidth + 'px'); }
      if (data.nodeHeight)  ele.style('height', data.nodeHeight + 'px');
      if (data.borderColor && data.borderWidth) {
        ele.style('border-color', data.borderColor);
        ele.style('border-width', data.borderWidth + 'px');
      }
      if (data.nodeShape)   ele.style('shape', data.nodeShape);
      if (data.shadowOpacity) {
        ele.style('shadow-blur', 12); ele.style('shadow-color', '#000');
        ele.style('shadow-opacity', 0.25);
        ele.style('shadow-offset-x', 3); ele.style('shadow-offset-y', 3);
      }
      if (data.nodeOpacity != null && data.nodeOpacity !== 1) {
        ele.style('opacity', data.nodeOpacity);
      }
      if (saved.posX !== undefined && saved.posY !== undefined) {
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
    updateRoomTitle();

    // 异步获取每个节点的子节点数和文档状态，完成后更新徽章
    if (window.NodeBadges) {
      NodeBadges.clear();
      var nodeIds = cy.nodes().map(function(n) { return n.id(); });
      Promise.all(nodeIds.map(function(id) {
        return Promise.all([
          Store.listCards(id).catch(function() { return []; }),
          Store.readMarkdown(id).catch(function() { return ''; })
        ]).then(function(r) {
          var node = cy.getElementById(id);
          if (!node.length) return;
          node.data('childCount', r[0].length);
          node.data('hasDoc', r[1] && r[1].trim().length > 0);
        });
      })).then(function() {
        NodeBadges.update();
      });
    }
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
  if (window.TabManager) TabManager.markDirty(currentKBPath);
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

  var rootName = _pathNameMap[currentKBPath] || _pathBasename(currentKBPath) || '根';
  var html = '<span class="bc-link" onclick="goRoot()">🏠 ' + escHtml(rootName) + '</span>';
  for (var i = 0; i < roomHistory.length; i++) {
    var p = roomHistory[i];
    if (p === currentKBPath) continue;
    var name = escHtml(_pathNameMap[p] || _pathBasename(p));
    html += '<span class="bc-sep">›</span><span class="bc-link" onclick="goToHistoryLevel(' + i + ')">' + name + '</span>';
  }
  if (currentRoomPath) {
    var curName = escHtml(_pathNameMap[currentRoomPath] || _pathBasename(currentRoomPath));
    html += '<span class="bc-sep">›</span><span class="bc-current">' + curName + '</span>';
  }
  bc.innerHTML = html;
}

function updateRoomTitle() {
  var h = document.getElementById('header');
  if (!currentRoomPath) {
    h.textContent = _pathNameMap[currentKBPath] || _pathBasename(currentKBPath) || 'TopoMind';
  } else {
    h.textContent = _pathNameMap[currentRoomPath] || _pathBasename(currentRoomPath);
  }
}

window.drillInto = drillInto;
window.goBack = goBack;
window.goRoot = goRoot;
window.goToHistoryLevel = goToHistoryLevel;
