/**
 * Tab 管理器
 * 支持同时打开多个知识库，主页是固定 Tab
 * 只有一个知识库以上时才显示 Tab 栏
 */

var TabManager = (function() {

  var _tabs = [];         // [{id, kbPath, name, roomPath, roomHistory, zoom, pan, isDirty}]
  var _activeId = 'home'; // 当前激活 tab id（'home' 或 tab id）

  // ===== 渲染 Tab 栏 =====
  function _render() {
    var bar = document.getElementById('tab-bar');
    if (!bar) return;

    if (_tabs.length === 0) {
      bar.classList.remove('visible');
      bar.innerHTML = '';
      return;
    }
    bar.classList.add('visible');

    var html = '';
    // 主页 Tab（固定，无关闭按钮）
    html += '<div class="tab-item' + (_activeId === 'home' ? ' active' : '') + '" data-tab-id="home">';
    html += '<span class="tab-item-label">🧠 主页</span>';
    html += '</div>';
    // 知识库 Tabs
    _tabs.forEach(function(tab) {
      var cls = 'tab-item' + (_activeId === tab.id ? ' active' : '') + (tab.isDirty ? ' dirty' : '');
      html += '<div class="' + cls + '" data-tab-id="' + tab.id + '">';
      html += '<span class="tab-item-label">' + escHtml(tab.name) + '</span>';
      html += '<span class="tab-item-close" data-close-tab="' + tab.id + '" title="关闭">✕</span>';
      html += '</div>';
    });
    bar.innerHTML = html;
  }

  // ===== 快照当前激活 KB 的状态 =====
  function _snapshotCurrent() {
    if (!_activeId || _activeId === 'home') return;
    var tab = _findTab(_activeId);
    if (!tab) return;
    // 只记录导航状态和视野，不写磁盘（磁盘保存由用户操作实时触发）
    tab.roomPath = currentRoomPath;
    tab.roomHistory = roomHistory.slice();
    try { tab.zoom = cy.zoom(); tab.pan = { x: cy.pan().x, y: cy.pan().y }; } catch(e) {}
  }

  // ===== 激活某个 Tab =====
  function _activate(id) {
    if (id === _activeId) return;

    // 先快照当前
    _snapshotCurrent();
    _activeId = id;

    if (id === 'home') {
      currentKBPath = null;
      currentRoomPath = null;
      roomHistory = [];
      try { cy.elements().remove(); } catch(e) {}
      showHome();
      _render();
    } else {
      var tab = _findTab(id);
      if (!tab) return;
      currentKBPath = tab.kbPath;
      currentRoomPath = tab.roomPath;
      roomHistory = tab.roomHistory.slice();
      hideHome();
      _render();
      GitBackend.checkAvailable().then(function(r) {
        if (r && r.available) GitBackend.init(tab.kbPath);
      }).catch(function() {});
      var p = loadRoom(tab.roomPath || tab.kbPath);
      if (p && p.then) {
        p.then(function() {
          try {
            if (tab.zoom && tab.zoom !== 1) cy.zoom(tab.zoom);
            if (tab.pan) cy.pan(tab.pan);
          } catch(e) {}
        }).catch(function(err) { console.error('[TabManager] loadRoom failed:', err); });
      }
    }
  }

  // ===== 辅助查找 =====
  function _findTab(id) {
    for (var i = 0; i < _tabs.length; i++) {
      if (_tabs[i].id === id) return _tabs[i];
    }
    return null;
  }

  function _findTabByKBPath(kbPath) {
    for (var i = 0; i < _tabs.length; i++) {
      if (_tabs[i].kbPath === kbPath) return _tabs[i];
    }
    return null;
  }

  // ===== 打开知识库 =====
  function open(kbPath, name) {
    // 已打开则直接切换
    var existing = _findTabByKBPath(kbPath);
    if (existing) {
      _activate(existing.id);
      return;
    }
    var tab = {
      id: 'tab-' + Date.now(),
      kbPath: kbPath,
      name: name || kbPath,
      roomPath: null,
      roomHistory: [],
      zoom: 1,
      pan: { x: 0, y: 0 },
      isDirty: false,
    };
    _tabs.push(tab);
    _activate(tab.id);
  }

  // ===== 关闭 Tab =====
  function close(id) {
    var tab = _findTab(id);
    if (!tab) return;

    function doClose() {
      var isActive = (_activeId === id);
      // 先从列表移除
      _tabs = _tabs.filter(function(t) { return t.id !== id; });

      if (isActive) {
        // 找下一个要激活的 tab（已从 _tabs 移除后，按原索引找邻居）
        var nextId = 'home';
        if (_tabs.length > 0) {
          // idx 是被删除元素在原数组中的位置，现在 _tabs 已少一个
          // 直接取第一个剩余 tab 或 home
          nextId = idx > 0 ? (_tabs[idx - 1] ? _tabs[idx - 1].id : _tabs[0].id) : _tabs[0].id;
        }
        // 强制重置 _activeId，让 _activate 不因"相同"而跳过
        _activeId = null;
        _activate(nextId);
      } else {
        _render();
      }
    }

    var idx = -1;
    for (var i = 0; i < _tabs.length; i++) { if (_tabs[i].id === id) { idx = i; break; } }

    // 检查是否有未提交的 Git 变更
    if (GitStore.isDirty(tab.kbPath)) {
      _pendingConfirmAction = doClose;
      document.getElementById('confirm-message').textContent =
        '「' + tab.name + '」有未提交的变更，确定关闭？';
      document.getElementById('modal-confirm').classList.add('active');
    } else {
      doClose();
    }
  }

  // ===== dirty 状态 =====
  function markDirty(kbPath) {
    var tab = _findTabByKBPath(kbPath);
    if (tab && !tab.isDirty) { tab.isDirty = true; _render(); }
  }

  function markClean(kbPath) {
    var tab = _findTabByKBPath(kbPath);
    if (tab && tab.isDirty) { tab.isDirty = false; _render(); }
  }

  // ===== 绑定事件 =====
  function _bindEvents() {
    var bar = document.getElementById('tab-bar');
    if (!bar) return;
    bar.addEventListener('click', function(e) {
      // 关闭按钮
      var closeBtn = e.target.closest('[data-close-tab]');
      if (closeBtn) { e.stopPropagation(); close(closeBtn.dataset.closeTab); return; }
      // Tab 切换
      var item = e.target.closest('[data-tab-id]');
      if (item) _activate(item.dataset.tabId);
    });
  }

  // ===== 初始化 =====
  function init() {
    _bindEvents();
    _render();
  }

  return {
    init:       init,
    open:       open,
    close:      close,
    markDirty:  markDirty,
    markClean:  markClean,
  };

})();
