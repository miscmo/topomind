/**
 * 有限画布系统
 * - 固定大小画布，带可见边界
 * - 节点拖到边界附近自动扩展
 * - 空白区域自动收缩
 * - 平移限制在画布范围内
 */
var GRID_SIZE = 20;
var gridEnabled = true;
var gridCanvas = document.getElementById('grid-canvas');
var gridCtx = gridCanvas ? gridCanvas.getContext('2d') : null;

// 画布参数
var CANVAS_STEP = 500;   // 每次扩展/收缩步长
var CANVAS_EXPAND_THRESHOLD = 100; // 距边界多近时扩展
var CANVAS_SHRINK_MARGIN = 300;    // 节点与边界间至少保留的空白
var CANVAS_MIN_W = 1500; // 画布最小宽度
var CANVAS_MIN_H = 1000; // 画布最小高度
var canvasBounds = { x: -750, y: -500, w: 1500, h: 1000 }; // 初始 1500x1000

/** 设置画布边界 */
function setCanvasBounds(b) {
  if (b && b.w && b.h) {
    canvasBounds = { x: b.x, y: b.y, w: b.w, h: b.h };
  }
}

/** 获取画布边界 */
function getCanvasBounds() {
  return { x: canvasBounds.x, y: canvasBounds.y, w: canvasBounds.w, h: canvasBounds.h };
}

/** 计算所有节点的包围盒 */
function getNodesBBox() {
  var nodes = cy.nodes();
  if (nodes.length === 0) return null;
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(function(n) {
    var p = n.position();
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  return { x1: minX, y1: minY, x2: maxX, y2: maxY };
}

/** 检查节点位置，必要时扩展画布 */
function expandCanvasIfNeeded(nodePos) {
  var changed = false;
  var right = canvasBounds.x + canvasBounds.w;
  var bottom = canvasBounds.y + canvasBounds.h;

  if (nodePos.x < canvasBounds.x + CANVAS_EXPAND_THRESHOLD) {
    canvasBounds.x -= CANVAS_STEP;
    canvasBounds.w += CANVAS_STEP;
    changed = true;
  }
  if (nodePos.x > right - CANVAS_EXPAND_THRESHOLD) {
    canvasBounds.w += CANVAS_STEP;
    changed = true;
  }
  if (nodePos.y < canvasBounds.y + CANVAS_EXPAND_THRESHOLD) {
    canvasBounds.y -= CANVAS_STEP;
    canvasBounds.h += CANVAS_STEP;
    changed = true;
  }
  if (nodePos.y > bottom - CANVAS_EXPAND_THRESHOLD) {
    canvasBounds.h += CANVAS_STEP;
    changed = true;
  }
  if (changed) {
    enforcePanBounds();
    drawGrid();
  }
  return changed;
}

/** 根据当前节点分布收缩画布空白区域 */
function shrinkCanvas() {
  var bbox = getNodesBBox();
  var changed = false;

  if (!bbox) {
    // 无节点，恢复初始大小
    if (canvasBounds.w !== CANVAS_MIN_W || canvasBounds.h !== CANVAS_MIN_H) {
      canvasBounds = { x: -CANVAS_MIN_W / 2, y: -CANVAS_MIN_H / 2, w: CANVAS_MIN_W, h: CANVAS_MIN_H };
      changed = true;
    }
  } else {
    var right = canvasBounds.x + canvasBounds.w;
    var bottom = canvasBounds.y + canvasBounds.h;

    // 右侧空白过多 → 收缩
    while (right - bbox.x2 > CANVAS_SHRINK_MARGIN + CANVAS_STEP &&
           canvasBounds.w - CANVAS_STEP >= CANVAS_MIN_W) {
      canvasBounds.w -= CANVAS_STEP;
      right = canvasBounds.x + canvasBounds.w;
      changed = true;
    }
    // 下侧空白过多 → 收缩
    while (bottom - bbox.y2 > CANVAS_SHRINK_MARGIN + CANVAS_STEP &&
           canvasBounds.h - CANVAS_STEP >= CANVAS_MIN_H) {
      canvasBounds.h -= CANVAS_STEP;
      bottom = canvasBounds.y + canvasBounds.h;
      changed = true;
    }
    // 左侧空白过多 → 收缩
    while (bbox.x1 - canvasBounds.x > CANVAS_SHRINK_MARGIN + CANVAS_STEP &&
           canvasBounds.w - CANVAS_STEP >= CANVAS_MIN_W) {
      canvasBounds.x += CANVAS_STEP;
      canvasBounds.w -= CANVAS_STEP;
      changed = true;
    }
    // 上侧空白过多 → 收缩
    while (bbox.y1 - canvasBounds.y > CANVAS_SHRINK_MARGIN + CANVAS_STEP &&
           canvasBounds.h - CANVAS_STEP >= CANVAS_MIN_H) {
      canvasBounds.y += CANVAS_STEP;
      canvasBounds.h -= CANVAS_STEP;
      changed = true;
    }
  }

  if (changed) {
    enforcePanBounds();
    drawGrid();
  }
}

/** 限制平移范围 */
function enforcePanBounds() {
  var zoom = cy.zoom();
  var pan = cy.pan();
  var container = cy.container();
  var cw = container.offsetWidth;
  var ch = container.offsetHeight;
  var margin = 200;

  var maxPanX = -canvasBounds.x * zoom + cw - margin;
  var minPanX = -(canvasBounds.x + canvasBounds.w) * zoom + margin;
  var maxPanY = -canvasBounds.y * zoom + ch - margin;
  var minPanY = -(canvasBounds.y + canvasBounds.h) * zoom + margin;

  var newPanX = Math.max(minPanX, Math.min(maxPanX, pan.x));
  var newPanY = Math.max(minPanY, Math.min(maxPanY, pan.y));

  if (newPanX !== pan.x || newPanY !== pan.y) {
    cy.pan({ x: newPanX, y: newPanY });
  }
}

/** 绘制网格和画布边界 */
function drawGrid() {
  if (!gridCtx) return;
  var panel = document.getElementById('graph-panel');
  var w = panel.offsetWidth, h = panel.offsetHeight;
  if (gridCanvas.width !== w * 2 || gridCanvas.height !== h * 2) {
    gridCanvas.width = w * 2; gridCanvas.height = h * 2;
    gridCanvas.style.width = w + 'px'; gridCanvas.style.height = h + 'px';
    gridCtx.scale(2, 2);
  }
  gridCtx.clearRect(0, 0, w, h);

  var zoom = cy.zoom(), pan = cy.pan();

  // 画布边界在屏幕空间的位置
  var bx = canvasBounds.x * zoom + pan.x;
  var by = canvasBounds.y * zoom + pan.y;
  var bw = canvasBounds.w * zoom;
  var bh = canvasBounds.h * zoom;

  // 画布外区域（灰色遮罩）
  gridCtx.fillStyle = 'rgba(0,0,0,0.04)';
  if (by > 0) gridCtx.fillRect(0, 0, w, by);
  if (by + bh < h) gridCtx.fillRect(0, by + bh, w, h - by - bh);
  gridCtx.fillRect(0, Math.max(0, by), Math.max(0, bx), Math.min(bh, h));
  if (bx + bw < w) gridCtx.fillRect(bx + bw, Math.max(0, by), w - bx - bw, Math.min(bh, h));

  // 网格点（只在画布内绘制）
  if (gridEnabled) {
    var step = GRID_SIZE * zoom;
    while (step < 12) step *= 5;
    while (step > 80) step /= 2;
    var bigStep = step * 5;

    var startX = Math.max(bx, 0);
    var startY = Math.max(by, 0);
    var endX = Math.min(bx + bw, w);
    var endY = Math.min(by + bh, h);

    var offX = pan.x % step;
    var offY = pan.y % step;

    gridCtx.fillStyle = 'rgba(160,170,185,0.25)';
    for (var x = offX; x < endX; x += step) {
      if (x < startX) continue;
      for (var y = offY; y < endY; y += step) {
        if (y < startY) continue;
        gridCtx.beginPath(); gridCtx.arc(x, y, 0.8, 0, Math.PI * 2); gridCtx.fill();
      }
    }

    gridCtx.fillStyle = 'rgba(140,150,165,0.4)';
    var bx0 = pan.x % bigStep, by0 = pan.y % bigStep;
    for (var bxp = bx0; bxp < endX; bxp += bigStep) {
      if (bxp < startX) continue;
      for (var byp = by0; byp < endY; byp += bigStep) {
        if (byp < startY) continue;
        gridCtx.beginPath(); gridCtx.arc(bxp, byp, 1.5, 0, Math.PI * 2); gridCtx.fill();
      }
    }
  }

  // 画布边界线
  gridCtx.strokeStyle = 'rgba(52,152,219,0.35)';
  gridCtx.lineWidth = 1.5;
  gridCtx.setLineDash([6, 4]);
  gridCtx.strokeRect(bx, by, bw, bh);
  gridCtx.setLineDash([]);
}

// ===== 事件监听 =====
var _enforcingPan = false;
var _enforceTimer = null;
var _zoomIndicator = document.getElementById('zoom-indicator');
cy.on('zoom pan resize', function() {
  drawGrid();
  if (_zoomIndicator) _zoomIndicator.textContent = Math.round(cy.zoom() * 100) + '%';
  clearTimeout(_enforceTimer);
  _enforceTimer = setTimeout(function() {
    if (_enforcingPan) return;
    _enforcingPan = true;
    enforcePanBounds();
    _enforcingPan = false;
    drawGrid();
  }, 50);
});
window.addEventListener('resize', function() { setTimeout(drawGrid, 50); });
setTimeout(drawGrid, 400);

// 节点拖拽时扩展，松手时收缩
cy.on('drag', 'node', function(e) {
  expandCanvasIfNeeded(e.target.position());
});
cy.on('free', 'node', function() {
  shrinkCanvas();
});

// 节点删除后收缩
cy.on('remove', 'node', function() {
  setTimeout(shrinkCanvas, 50);
});

// 网格开关
var btnGrid = document.getElementById('btn-toggle-grid');
if (btnGrid) btnGrid.addEventListener('click', function() {
  gridEnabled = !gridEnabled;
  this.classList.toggle('active', gridEnabled);
  drawGrid();
});
