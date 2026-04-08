/**
 * 画布网格系统 + 对齐辅助
 */
var GRID_SIZE = 20;
var gridEnabled = true;

var gridCanvas = document.getElementById('grid-canvas');
var gridCtx = gridCanvas.getContext('2d');

function drawGrid() {
  var panel = document.getElementById('graph-panel');
  var w = panel.offsetWidth, h = panel.offsetHeight;
  if (gridCanvas.width !== w * 2 || gridCanvas.height !== h * 2) {
    gridCanvas.width = w * 2; gridCanvas.height = h * 2;
    gridCanvas.style.width = w + 'px'; gridCanvas.style.height = h + 'px';
    gridCtx.scale(2, 2);
  }
  gridCtx.clearRect(0, 0, w, h);
  if (!gridEnabled) return;

  var zoom = cy.zoom(), pan = cy.pan();
  var step = GRID_SIZE * zoom;
  while (step < 12) step *= 5;
  while (step > 80) step /= 2;
  var bigStep = step * 5;
  var offX = pan.x % step, offY = pan.y % step;

  gridCtx.fillStyle = 'rgba(160,170,185,0.25)';
  for (var x = offX; x < w; x += step)
    for (var y = offY; y < h; y += step) { gridCtx.beginPath(); gridCtx.arc(x, y, 0.8, 0, Math.PI * 2); gridCtx.fill(); }

  gridCtx.fillStyle = 'rgba(140,150,165,0.4)';
  var bigOffX = pan.x % bigStep, bigOffY = pan.y % bigStep;
  for (var bx = bigOffX; bx < w; bx += bigStep)
    for (var by = bigOffY; by < h; by += bigStep) { gridCtx.beginPath(); gridCtx.arc(bx, by, 1.5, 0, Math.PI * 2); gridCtx.fill(); }

  var ox = pan.x, oy = pan.y;
  if (ox > 0 && ox < w && oy > 0 && oy < h) {
    gridCtx.strokeStyle = 'rgba(52,152,219,0.15)'; gridCtx.lineWidth = 1; gridCtx.setLineDash([4, 4]);
    gridCtx.beginPath(); gridCtx.moveTo(ox, 0); gridCtx.lineTo(ox, h); gridCtx.moveTo(0, oy); gridCtx.lineTo(w, oy); gridCtx.stroke();
    gridCtx.setLineDash([]);
  }
}

cy.on('zoom pan resize', drawGrid);
window.addEventListener('resize', function() { setTimeout(drawGrid, 50); });
setTimeout(drawGrid, 400);

document.getElementById('btn-toggle-grid').addEventListener('click', function() { gridEnabled = !gridEnabled; this.classList.toggle('active', gridEnabled); drawGrid(); });
// --- 拖拽保存 ---
cy.on('free', 'node', function() { saveState(); });
