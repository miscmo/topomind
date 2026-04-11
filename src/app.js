/**
 * 全局状态 + 启动入口
 */

// ===== 全局状态 =====
var selectedNode = null;
var edgeMode = false, edgeModeSource = null;
var currentKBPath = null;   // 当前知识库路径
var currentRoomPath = null; // 当前房间路径（null=知识库根级）
var roomHistory = [];
var autoIdCounter = Date.now();
var _pendingConfirmAction = null; // 确认模态框回调

function autoId(prefix) { return (prefix || 'n') + '-' + (autoIdCounter++).toString(36); }

/** 批量删除选中的节点 */
function batchDeleteSelected() {
  var selected = cy.nodes(':selected');
  if (selected.length === 0) return;
  _pendingConfirmAction = function() {
    var promises = [];
    selected.forEach(function(n) {
      promises.push(Store.deleteCard(n.id()).then(function() {
        n.connectedEdges().remove(); n.remove();
      }));
    });
    Promise.all(promises).then(function() {
      selectedNode = null; showPlaceholder();
      saveCurrentLayout();
    });
  };
  document.getElementById('confirm-message').textContent = '确定删除选中的 ' + selected.length + ' 个节点？';
  document.getElementById('modal-confirm').classList.add('active');
}

/** 显示右键菜单（自动边界检测，防止超出视口） */
function showContextMenu(menuId, x, y) {
  var m = document.getElementById(menuId);
  m.style.display = 'block';
  m.style.left = '0px'; m.style.top = '0px'; // 先显示以获取尺寸
  var mw = m.offsetWidth, mh = m.offsetHeight;
  var vw = window.innerWidth, vh = window.innerHeight;
  if (x + mw > vw - 4) x = vw - mw - 4;
  if (y + mh > vh - 4) y = vh - mh - 4;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  m.style.left = x + 'px';
  m.style.top = y + 'px';
}

/** 通用输入模态框（替代 prompt()，Electron 中 prompt 不可用） */
var _inputResolve = null;
function showInputModal(title, placeholder, defaultVal) {
  return new Promise(function(resolve) {
    // 如果上一个 promise 还未 resolve，先以 null 取消，再清空引用
    if (_inputResolve) { _inputResolve(null); _inputResolve = null; }
    _inputResolve = resolve;
    document.getElementById('modal-input-title').textContent = title || '输入';
    var inp = document.getElementById('modal-input-value');
    inp.value = defaultVal || '';
    inp.placeholder = placeholder || '请输入...';
    document.getElementById('modal-input').classList.add('active');
    setTimeout(function() { inp.focus(); }, 100);
  });
}
function cancelInputModal() {
  document.getElementById('modal-input').classList.remove('active');
  if (_inputResolve) { _inputResolve(null); _inputResolve = null; }
}
document.getElementById('modal-input-ok').addEventListener('click', function() {
  var val = document.getElementById('modal-input-value').value.trim();
  document.getElementById('modal-input').classList.remove('active');
  if (_inputResolve) { _inputResolve(val || null); _inputResolve = null; }
});
document.getElementById('modal-input-value').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { document.getElementById('modal-input-ok').click(); }
  if (e.key === 'Escape') { cancelInputModal(); }
});

/** 根据当前 Cytoscape 状态构建 _meta.json */
function buildCurrentMeta() {
  var children = {};
  var edges = [];
  cy.nodes().forEach(function(n) {
    children[n.id()] = {
      name:         n.data('label'),
      color:        n.data('color')        || '',
      fontColor:    n.data('fontColor')    || '',
      fontSize:     n.data('fontSize')     || 0,
      fontStyle:    n.data('fontStyle')    || '',
      textAlign:    n.data('textAlign')    || '',
      textWrap:     n.data('textWrap') !== undefined ? n.data('textWrap') : true,
      nodeWidth:    n.data('nodeWidth')    || '',
      nodeHeight:   n.data('nodeHeight')   || '',
      borderColor:  n.data('borderColor')  || '',
      borderWidth:  n.data('borderWidth')  || 0,
      nodeShape:    n.data('nodeShape')    || '',
      shadowOpacity:n.data('shadowOpacity')|| 0,
      nodeOpacity:  n.data('nodeOpacity')  != null ? n.data('nodeOpacity') : 1,
      posX: Math.round(n.position().x),
      posY: Math.round(n.position().y)
    };
  });
  cy.edges().not('.hidden').forEach(function(e) {
    edges.push({
      id: e.id(),
      source: e.source().id(),
      target: e.target().id(),
      relation: e.data('relation') || '相关',
      weight: e.data('weight') || 'minor'
    });
  });
  return {
    children: children,
    edges: edges,
    zoom: cy.zoom(),
    pan: { x: Math.round(cy.pan().x), y: Math.round(cy.pan().y) },
    canvasBounds: getCanvasBounds()
  };
}

// ===== 启动 =====
(function boot() {
  console.log('[boot] 开始初始化...');
  console.log('[boot] window.electronAPI:', !!window.electronAPI);
  console.log('[boot] Store:', typeof Store);
  Store.init().then(function() {
    console.log('[boot] Store 初始化成功，调用 showHome');
    TabManager.init();
    NodeBadges.init();
    showHome();
  }).catch(function(err) {
    console.error('[boot] 启动失败:', err);
    TabManager.init();
    NodeBadges.init();
    showHome();
  });
})();

// ===== 页面关闭前保存 =====
window.addEventListener('beforeunload', function() {
  if (currentKBPath) {
    var meta = buildCurrentMeta();
    var dirPath = currentRoomPath || currentKBPath;
    // 使用同步 IPC 确保数据在页面卸载前写入
    try {
      window.electronAPI.sendSync('save:layout', dirPath, meta);
    } catch (e) {
      console.error('[app] beforeunload save failed:', e);
    }
  }
});

// ===== 主进程退出前保存通知 =====
if (window.electronAPI && window.electronAPI.on) {
  window.electronAPI.on('save:before-quit', function() {
    if (currentKBPath) {
      var meta = buildCurrentMeta();
      var dirPath = currentRoomPath || currentKBPath;
      Store.saveLayout(dirPath, meta);
    }
  });
}

// ===== 启动提示 =====
setTimeout(function() {
  var h = document.getElementById('shortcut-hint');
  if (h) { h.classList.add('visible'); setTimeout(function() { h.classList.remove('visible'); }, 4000); }
}, 800);
