/**
 * 节点样式面板
 * 点击节点后在左侧样式面板展示所有样式控件
 * 多选时批量修改所有选中节点
 */

(function() {

  // ===== 最近颜色（各颜色选择框独立，localStorage，最多 8 个）=====
  var RECENT_MAX = 8;

  function getRecentColors(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { return []; }
  }

  function pushRecentColor(key, hex) {
    if (!hex || hex.length < 4) return;
    var list = getRecentColors(key).filter(function(c) { return c !== hex; });
    list.unshift(hex);
    if (list.length > RECENT_MAX) list = list.slice(0, RECENT_MAX);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch(e) {}
  }

  function renderRecentColors(key, containerId, applyFn) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var list = getRecentColors(key);
    container.innerHTML = '';
    list.forEach(function(hex) {
      var dot = document.createElement('span');
      dot.className = 'sp-recent-dot';
      dot.style.background = hex;
      dot.title = hex;
      dot.addEventListener('click', function() { applyFn(hex); });
      container.appendChild(dot);
    });
  }

  function refreshFontRecent() {
    renderRecentColors('tm_font_colors', 'sp-font-recent', function(hex) {
      applyToSelected({ fontColor: hex });
      var inp = document.getElementById('sp-font-color');
      var sw  = document.getElementById('sp-font-color-swatch');
      if (inp) inp.value = hex;
      if (sw)  sw.style.background = hex;
    });
  }

  function refreshBgRecent() {
    renderRecentColors('tm_bg_colors', 'sp-bg-recent', function(hex) {
      applyToSelected({ bgColor: hex });
      var inp = document.getElementById('sp-bg-color');
      var sw  = document.getElementById('sp-bg-color-swatch');
      if (inp) inp.value = hex;
      if (sw)  sw.style.background = hex;
    });
  }

  function refreshBorderRecent() {
    renderRecentColors('tm_border_colors', 'sp-border-recent', function(hex) {
      applyToSelected({ borderColor: hex });
      var inp = document.getElementById('sp-border-color');
      var sw  = document.getElementById('sp-border-color-swatch');
      if (inp) inp.value = hex;
      if (sw)  sw.style.background = hex;
    });
  }

  // ===== 获取当前选中节点 =====
  function getSelectedNodes() {
    var sel = cy.nodes(':selected');
    if (sel.length > 0) return sel;
    if (window.selectedNode && window.selectedNode.length) return window.selectedNode;
    return cy.collection();
  }

  // ===== 从节点读取样式值 =====
  function readNodeStyle(node) {
    var fontColor  = node.data('fontColor')  || '#ffffff';
    var bgColor    = node.data('color')       || '#4a6fa5';

    var fontSizeData = node.data('fontSize');
    var fontSize;
    if (fontSizeData) {
      fontSize = parseInt(fontSizeData);
    } else {
      var raw = node.style('font-size') || '12px';
      fontSize = parseInt(raw) || 12;
    }

    var nodeWidth  = node.data('nodeWidth')  || '';
    var nodeHeight = node.data('nodeHeight') || '';
    var textAlign  = node.data('textAlign') || node.style('text-halign') || 'center';
    var fontStyle  = node.data('fontStyle') || '';
    var textWrap   = node.data('textWrap');
    if (textWrap === undefined || textWrap === null) textWrap = true;

    var borderColor   = node.data('borderColor')   || '#cccccc';
    var borderWidth   = node.data('borderWidth') != null ? node.data('borderWidth') : 0;
    var nodeShape     = node.data('nodeShape')     || 'roundrectangle';
    var shadowOpacity = node.data('shadowOpacity') || 0;
    var nodeOpacity   = node.data('nodeOpacity')   != null ? node.data('nodeOpacity') : 1;

    return { fontColor, fontSize, fontStyle, textAlign, textWrap, bgColor, nodeWidth, nodeHeight,
             borderColor, borderWidth, nodeShape, shadowOpacity, nodeOpacity };
  }

  // ===== 将样式 patch 应用到所有选中节点 =====
  function applyToSelected(patch) {
    var nodes = getSelectedNodes();
    if (!nodes || !nodes.length) return;

    nodes.forEach(function(node) {
      if (!node || !node.length) return;

      if (patch.fontColor !== undefined) {
        node.data('fontColor', patch.fontColor);
        node.style('color', patch.fontColor);
      }
      if (patch.fontSize !== undefined) {
        var fs = Math.max(8, Math.min(72, parseInt(patch.fontSize) || 12));
        node.data('fontSize', fs);
        node.style('font-size', fs + 'px');
      }
      if (patch.fontStyle !== undefined) {
        node.data('fontStyle', patch.fontStyle);
        var parts = patch.fontStyle ? patch.fontStyle.split(' ') : [];
        node.style('font-weight', parts.indexOf('bold')   >= 0 ? 'bold'   : 'normal');
        node.style('font-style',  parts.indexOf('italic') >= 0 ? 'italic' : 'normal');
      }
      if (patch.textAlign !== undefined) {
        node.data('textAlign', patch.textAlign);
        node.style('text-halign', patch.textAlign);
      }
      if (patch.textWrap !== undefined) {
        node.data('textWrap', patch.textWrap);
        node.style('text-wrap', patch.textWrap ? 'wrap' : 'none');
      }
      if (patch.bgColor !== undefined) {
        node.data('color', patch.bgColor);
        node.style('background-color', patch.bgColor);
      }
      if (patch.nodeWidth !== undefined) {
        var w = parseInt(patch.nodeWidth) || 0;
        node.data('nodeWidth', w || '');
        node.style('width',         w > 0 ? w + 'px' : 'fit-to-label');
        node.style('text-max-width', w > 0 ? w + 'px' : '100px');
      }
      if (patch.nodeHeight !== undefined) {
        var h = parseInt(patch.nodeHeight) || 0;
        node.data('nodeHeight', h || '');
        node.style('height', h > 0 ? h + 'px' : 'fit-to-label');
      }
      if (patch.borderColor !== undefined) {
        node.data('borderColor', patch.borderColor);
        node.style('border-color', patch.borderColor);
      }
      if (patch.borderWidth !== undefined) {
        var bw = Math.max(0, Math.min(20, parseInt(patch.borderWidth) || 0));
        node.data('borderWidth', bw);
        node.style('border-width', bw + 'px');
      }
      if (patch.nodeShape !== undefined) {
        node.data('nodeShape', patch.nodeShape);
        node.style('shape', patch.nodeShape);
      }
      if (patch.shadowOpacity !== undefined) {
        node.data('shadowOpacity', patch.shadowOpacity);
        node.style('shadow-blur',     patch.shadowOpacity ? 12 : 0);
        node.style('shadow-color',    '#000');
        node.style('shadow-opacity',  patch.shadowOpacity ? 0.25 : 0);
        node.style('shadow-offset-x', patch.shadowOpacity ? 3 : 0);
        node.style('shadow-offset-y', patch.shadowOpacity ? 3 : 0);
      }
      if (patch.nodeOpacity !== undefined) {
        var op = Math.max(0.1, Math.min(1, patch.nodeOpacity));
        node.data('nodeOpacity', op);
        node.style('opacity', op);
      }
    });

    saveCurrentLayout();
  }

  // ===== 将节点当前值回填到面板 UI =====
  function fillPanel(node) {
    if (!node || !node.length) { hidePanelBody(); return; }

    var s = readNodeStyle(node);
    var nodes   = getSelectedNodes();
    var isMulti = nodes.length > 1;

    var nameEl = document.getElementById('sp-node-name');
    if (nameEl) nameEl.textContent = isMulti ? '已选 ' + nodes.length + ' 个节点' : (node.data('label') || '');

    // 字体颜色
    var fontInp = document.getElementById('sp-font-color');
    var fontSw  = document.getElementById('sp-font-color-swatch');
    if (fontInp) fontInp.value = s.fontColor;
    if (fontSw)  fontSw.style.background = s.fontColor;

    // 字体大小
    var sizeInp = document.getElementById('sp-font-size');
    if (sizeInp) sizeInp.value = s.fontSize;

    // 字体样式按钮
    var parts = s.fontStyle ? s.fontStyle.split(' ') : [];
    document.querySelectorAll('#sp-font-style .sp-font-style-btn').forEach(function(btn) {
      btn.classList.toggle('active', parts.indexOf(btn.dataset.style) >= 0);
    });

    // 文字对齐
    document.querySelectorAll('#sp-text-align .sp-icon-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.value === s.textAlign);
    });

    // 折行
    var wrapInp = document.getElementById('sp-text-wrap');
    if (wrapInp) wrapInp.checked = !!s.textWrap;

    // 背景颜色
    var bgInp = document.getElementById('sp-bg-color');
    var bgSw  = document.getElementById('sp-bg-color-swatch');
    if (bgInp) bgInp.value = s.bgColor;
    if (bgSw)  bgSw.style.background = s.bgColor;

    // 宽高（多选时清空）
    var wInp = document.getElementById('sp-node-width');
    var hInp = document.getElementById('sp-node-height');
    if (wInp) wInp.value = isMulti ? '' : (s.nodeWidth  || '');
    if (hInp) hInp.value = isMulti ? '' : (s.nodeHeight || '');

    // 透明度
    var opInp = document.getElementById('sp-opacity');
    var opVal = document.getElementById('sp-opacity-val');
    if (opInp) opInp.value = Math.round(s.nodeOpacity * 100);
    if (opVal) opVal.textContent = Math.round(s.nodeOpacity * 100) + '%';

    // 边框颜色
    var borderInp = document.getElementById('sp-border-color');
    var borderSw  = document.getElementById('sp-border-color-swatch');
    if (borderInp) borderInp.value = s.borderColor;
    if (borderSw)  borderSw.style.background = s.borderColor;

    // 边框粗细
    var borderWInp = document.getElementById('sp-border-width');
    if (borderWInp) borderWInp.value = s.borderWidth;

    // 形状
    document.querySelectorAll('.sp-shape-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.shape === s.nodeShape);
    });

    // 阴影
    var shadowInp = document.getElementById('sp-shadow');
    if (shadowInp) shadowInp.checked = !!s.shadowOpacity;

    // 刷新最近颜色
    refreshFontRecent();
    refreshBgRecent();
    refreshBorderRecent();
  }

  // ===== 显示/隐藏面板体 =====
  function showPanelBody(node) {
    var empty = document.getElementById('sp-empty');
    var body  = document.getElementById('sp-body');
    if (!empty || !body) return;
    empty.style.display = 'none';
    body.style.display  = 'block';
    fillPanel(node);
  }

  function hidePanelBody() {
    var empty = document.getElementById('sp-empty');
    var body  = document.getElementById('sp-body');
    if (empty) empty.style.display = '';
    if (body)  body.style.display  = 'none';
  }

  // ===== 折叠/展开 =====
  function initCollapse() {
    var panel      = document.getElementById('nav-panel');
    var toggleBtn  = document.getElementById('btn-toggle-style');
    var collapseBtn = document.getElementById('btn-collapse-style');
    if (!panel || !toggleBtn || !collapseBtn) return;

    collapseBtn.addEventListener('click', function() {
      panel.classList.add('collapsed');
      toggleBtn.classList.add('visible');
    });
    toggleBtn.addEventListener('click', function() {
      panel.classList.remove('collapsed');
      toggleBtn.classList.remove('visible');
    });
  }

  // ===== 绑定 Cytoscape 事件 =====
  function bindCytoscapeEvents() {
    cy.on('tap', 'node.card', function(e) {
      showPanelBody(e.target);
    });

    cy.on('select unselect', 'node.card', function() {
      var sel = cy.nodes(':selected');
      if (sel.length > 0) {
        showPanelBody(sel[0]);
      } else if (!window.selectedNode || !window.selectedNode.length) {
        hidePanelBody();
      }
    });

    cy.on('tap', function(e) {
      if (e.target === cy) hidePanelBody();
    });
  }

  // ===== 绑定控件事件 =====
  function bindControls() {

    // ── 字体颜色 ──
    var fontInp = document.getElementById('sp-font-color');
    var fontSw  = document.getElementById('sp-font-color-swatch');
    if (fontInp) {
      fontInp.addEventListener('input', function() {
        if (fontSw) fontSw.style.background = fontInp.value;
        applyToSelected({ fontColor: fontInp.value });
      });
      fontInp.addEventListener('change', function() {
        pushRecentColor('tm_font_colors', fontInp.value);
        refreshFontRecent();
      });
    }

    // ── 字体大小 ──
    var sizeInp = document.getElementById('sp-font-size');
    if (sizeInp) {
      sizeInp.addEventListener('change', function() {
        var v = Math.max(8, Math.min(72, parseInt(sizeInp.value) || 12));
        sizeInp.value = v;
        applyToSelected({ fontSize: v });
      });
      sizeInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') sizeInp.blur(); });
    }

    // ── 字体样式（加粗/斜体）──
    var fontStyleGroup = document.getElementById('sp-font-style');
    if (fontStyleGroup) {
      fontStyleGroup.addEventListener('click', function(e) {
        var btn = e.target.closest('.sp-font-style-btn');
        if (!btn) return;
        btn.classList.toggle('active');
        var activeStyles = [];
        fontStyleGroup.querySelectorAll('.sp-font-style-btn.active').forEach(function(b) {
          activeStyles.push(b.dataset.style);
        });
        applyToSelected({ fontStyle: activeStyles.join(' ') });
      });
    }

    // ── 文字对齐 ──
    var alignGroup = document.getElementById('sp-text-align');
    if (alignGroup) {
      alignGroup.addEventListener('click', function(e) {
        var btn = e.target.closest('.sp-icon-btn');
        if (!btn || !btn.dataset.value) return;
        alignGroup.querySelectorAll('.sp-icon-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        applyToSelected({ textAlign: btn.dataset.value });
      });
    }

    // ── 自动折行 ──
    var wrapInp = document.getElementById('sp-text-wrap');
    if (wrapInp) {
      wrapInp.addEventListener('change', function() {
        applyToSelected({ textWrap: wrapInp.checked });
      });
    }

    // ── 背景颜色 ──
    var bgInp = document.getElementById('sp-bg-color');
    var bgSw  = document.getElementById('sp-bg-color-swatch');
    if (bgInp) {
      bgInp.addEventListener('input', function() {
        if (bgSw) bgSw.style.background = bgInp.value;
        applyToSelected({ bgColor: bgInp.value });
      });
      bgInp.addEventListener('change', function() {
        pushRecentColor('tm_bg_colors', bgInp.value);
        refreshBgRecent();
      });
    }

    // ── 节点宽度 ──
    var wInp = document.getElementById('sp-node-width');
    if (wInp) {
      wInp.addEventListener('change', function() { applyToSelected({ nodeWidth: wInp.value }); });
      wInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') wInp.blur(); });
    }

    // ── 节点高度 ──
    var hInp = document.getElementById('sp-node-height');
    if (hInp) {
      hInp.addEventListener('change', function() { applyToSelected({ nodeHeight: hInp.value }); });
      hInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') hInp.blur(); });
    }

    // ── 透明度 ──
    var opInp = document.getElementById('sp-opacity');
    var opVal = document.getElementById('sp-opacity-val');
    if (opInp) {
      opInp.addEventListener('input', function() {
        if (opVal) opVal.textContent = opInp.value + '%';
        applyToSelected({ nodeOpacity: parseInt(opInp.value) / 100 });
      });
    }

    // ── 边框颜色 ──
    var borderInp = document.getElementById('sp-border-color');
    var borderSw  = document.getElementById('sp-border-color-swatch');
    if (borderInp) {
      borderInp.addEventListener('input', function() {
        if (borderSw) borderSw.style.background = borderInp.value;
        applyToSelected({ borderColor: borderInp.value });
      });
      borderInp.addEventListener('change', function() {
        pushRecentColor('tm_border_colors', borderInp.value);
        refreshBorderRecent();
      });
    }

    // ── 边框粗细 ──
    var borderWInp = document.getElementById('sp-border-width');
    if (borderWInp) {
      borderWInp.addEventListener('change', function() { applyToSelected({ borderWidth: borderWInp.value }); });
      borderWInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') borderWInp.blur(); });
    }

    // ── 形状 ──
    var shapeGrid = document.getElementById('sp-shape-grid');
    if (shapeGrid) {
      shapeGrid.addEventListener('click', function(e) {
        var btn = e.target.closest('.sp-shape-btn');
        if (!btn) return;
        shapeGrid.querySelectorAll('.sp-shape-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        applyToSelected({ nodeShape: btn.dataset.shape });
      });
    }

    // ── 阴影 ──
    var shadowInp = document.getElementById('sp-shadow');
    if (shadowInp) {
      shadowInp.addEventListener('change', function() {
        applyToSelected({ shadowOpacity: shadowInp.checked ? 1 : 0 });
      });
    }
  }

  // ===== 初始化 =====
  function init() {
    initCollapse();
    bindCytoscapeEvents();
    bindControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.StylePanel = {
    refresh: function() {
      var sel = cy.nodes(':selected');
      if (sel.length) showPanelBody(sel[0]);
      else if (window.selectedNode && window.selectedNode.length) showPanelBody(window.selectedNode);
      else hidePanelBody();
    }
  };

})();
