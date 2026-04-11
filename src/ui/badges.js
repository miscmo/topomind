/**
 * NodeBadges — 节点徽章层 + 文档预览 Tooltip
 *
 * 徽章：在 Cytoscape canvas 上方叠加 HTML 层，
 *       每个节点右下角显示子节点数 / 文档标记。
 * Tooltip：鼠标悬停节点时，延迟 220ms 后显示文档前 150 字。
 */
var NodeBadges = (function() {

  var _layer   = null;   // #node-badges-layer
  var _tooltip = null;   // #node-tooltip
  var _ttTitle = null;
  var _ttBody  = null;

  var _hoverTimer  = null;
  var _hideTimer   = null;
  var _mouseX = 0, _mouseY = 0;

  // ── 初始化（在 cy 就绪后调用一次）──
  function init() {
    _layer   = document.getElementById('node-badges-layer');
    _tooltip = document.getElementById('node-tooltip');
    _ttTitle = document.getElementById('node-tooltip-title');
    _ttBody  = document.getElementById('node-tooltip-body');

    if (!_layer || !_tooltip) return;

    // 跟踪鼠标位置（用于 tooltip 定位）
    document.addEventListener('mousemove', function(e) {
      _mouseX = e.clientX;
      _mouseY = e.clientY;
      if (_tooltip.classList.contains('visible')) {
        _positionTooltip();
      }
    });

    // Cytoscape 事件：pan/zoom/layout 后同步徽章位置
    cy.on('render', function() { _syncPositions(); });

    // Cytoscape 事件：hover
    cy.on('mouseover', 'node', function(e) {
      var node = e.target;
      clearTimeout(_hideTimer);
      _hoverTimer = setTimeout(function() {
        _showTooltip(node);
      }, 220);
    });

    cy.on('mouseout', 'node', function() {
      clearTimeout(_hoverTimer);
      _hideTimer = setTimeout(function() {
        _tooltip.classList.remove('visible');
      }, 80);
    });
  }

  // ── 更新徽章（loadRoom 完成后调用）──
  function update() {
    if (!_layer) return;
    _layer.innerHTML = '';

    cy.nodes().forEach(function(node) {
      var childCount = node.data('childCount') || 0;
      var hasDoc     = !!node.data('hasDoc');

      if (childCount === 0 && !hasDoc) return;

      var badge = document.createElement('div');
      badge.className = 'node-badge';
      badge.dataset.nodeId = node.id();

      if (hasDoc) {
        var pill = document.createElement('span');
        pill.className = 'node-badge-pill has-doc';
        pill.textContent = '📄';
        badge.appendChild(pill);
      }

      if (childCount > 0) {
        var pill2 = document.createElement('span');
        pill2.className = 'node-badge-pill has-children';
        pill2.textContent = childCount + '↓';
        badge.appendChild(pill2);
      }

      _layer.appendChild(badge);
    });

    _syncPositions();
  }

  // ── 同步所有徽章的屏幕坐标 ──
  function _syncPositions() {
    if (!_layer) return;
    var container = document.getElementById('cy');
    if (!container) return;
    var rect = container.getBoundingClientRect();
    // getBoundingClientRect 是相对 viewport 的，
    // 但 #node-badges-layer 是 position:absolute 在 #graph-panel 内，
    // 所以要减去 #graph-panel 的 offset
    var panelRect = _layer.parentElement.getBoundingClientRect();
    var offsetX = rect.left - panelRect.left;
    var offsetY = rect.top  - panelRect.top;

    var badges = _layer.querySelectorAll('.node-badge');
    badges.forEach(function(badge) {
      var nodeId = badge.dataset.nodeId;
      var node = cy.getElementById(nodeId);
      if (!node || !node.length) { badge.style.display = 'none'; return; }

      var rp = node.renderedPosition();
      var h  = node.renderedHeight();

      // 定位到节点底部中心
      badge.style.left = (offsetX + rp.x) + 'px';
      badge.style.top  = (offsetY + rp.y + h / 2 + 2) + 'px';
      badge.style.display = '';
    });
  }

  // ── 显示 Tooltip ──
  function _showTooltip(node) {
    var hasDoc = !!node.data('hasDoc');
    if (!hasDoc) return;

    var label    = node.data('label') || '';
    var cardPath = node.data('cardPath') || node.id();

    _ttTitle.textContent = label;
    _ttBody.textContent  = '加载中...';
    _tooltip.classList.add('visible');
    _positionTooltip();

    Store.readMarkdown(cardPath).then(function(md) {
      if (!_tooltip.classList.contains('visible')) return;
      var text = (md || '').replace(/^#+\s+.*/gm, '').replace(/[*_`>#\-\[\]]/g, '').trim();
      _ttBody.textContent = text.slice(0, 150) + (text.length > 150 ? '…' : '');
    }).catch(function() {
      _ttBody.textContent = '';
    });
  }

  function _positionTooltip() {
    var tw = _tooltip.offsetWidth  || 260;
    var th = _tooltip.offsetHeight || 80;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var x  = _mouseX + 14;
    var y  = _mouseY + 14;
    if (x + tw > vw - 8) x = _mouseX - tw - 10;
    if (y + th > vh - 8) y = _mouseY - th - 10;
    _tooltip.style.left = x + 'px';
    _tooltip.style.top  = y + 'px';
  }

  // ── 清空（切换房间时调用）──
  function clear() {
    if (_layer) _layer.innerHTML = '';
    if (_tooltip) _tooltip.classList.remove('visible');
    clearTimeout(_hoverTimer);
    clearTimeout(_hideTimer);
  }

  return { init: init, update: update, clear: clear };

})();
