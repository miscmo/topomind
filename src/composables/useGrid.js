/**
 * useGrid composable
 * 有限画布系统：网格绘制、画布边界管理、平移限制
 * 完整迁移自 grid.js
 */
import { ref, onUnmounted } from 'vue'

const GRID_SIZE = 20
const CANVAS_STEP = 500
const CANVAS_EXPAND_THRESHOLD = 100
const CANVAS_SHRINK_MARGIN = 300
const CANVAS_MIN_W = 1500
const CANVAS_MIN_H = 1000

export function useGrid(canvasRef, getCy) {
  const gridEnabled = ref(true)
  let canvasBounds = { x: -750, y: -500, w: 1500, h: 1000 }
  let _ctx = null
  let _rafId = null
  let _enforceTimer = null
  let _enforcingPan = false

  // ─── 画布边界 ────────────────────────────────────────────────
  function setCanvasBounds(b) {
    if (b && b.w && b.h) {
      canvasBounds = { x: b.x, y: b.y, w: b.w, h: b.h }
    }
  }

  function getCanvasBounds() {
    return { ...canvasBounds }
  }

  function _getNodesBBox() {
    const cy = getCy()
    if (!cy) return null
    const nodes = cy.nodes()
    if (!nodes.length) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    nodes.forEach(n => {
      const p = n.position()
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    })
    return { x1: minX, y1: minY, x2: maxX, y2: maxY }
  }

  function expandCanvasIfNeeded(nodePos) {
    let changed = false
    const right = canvasBounds.x + canvasBounds.w
    const bottom = canvasBounds.y + canvasBounds.h

    if (nodePos.x < canvasBounds.x + CANVAS_EXPAND_THRESHOLD) {
      canvasBounds.x -= CANVAS_STEP; canvasBounds.w += CANVAS_STEP; changed = true
    }
    if (nodePos.x > right - CANVAS_EXPAND_THRESHOLD) {
      canvasBounds.w += CANVAS_STEP; changed = true
    }
    if (nodePos.y < canvasBounds.y + CANVAS_EXPAND_THRESHOLD) {
      canvasBounds.y -= CANVAS_STEP; canvasBounds.h += CANVAS_STEP; changed = true
    }
    if (nodePos.y > bottom - CANVAS_EXPAND_THRESHOLD) {
      canvasBounds.h += CANVAS_STEP; changed = true
    }
    if (changed) { enforcePanBounds(); drawGrid() }
    return changed
  }

  function shrinkCanvas() {
    const bbox = _getNodesBBox()
    let changed = false

    if (!bbox) {
      if (canvasBounds.w !== CANVAS_MIN_W || canvasBounds.h !== CANVAS_MIN_H) {
        canvasBounds = { x: -CANVAS_MIN_W / 2, y: -CANVAS_MIN_H / 2, w: CANVAS_MIN_W, h: CANVAS_MIN_H }
        changed = true
      }
    } else {
      let right = canvasBounds.x + canvasBounds.w
      let bottom = canvasBounds.y + canvasBounds.h
      let safety = 0

      while (right - bbox.x2 > CANVAS_SHRINK_MARGIN + CANVAS_STEP && canvasBounds.w - CANVAS_STEP >= CANVAS_MIN_W && safety++ < 20) {
        canvasBounds.w -= CANVAS_STEP; right = canvasBounds.x + canvasBounds.w; changed = true
      }
      safety = 0
      while (bottom - bbox.y2 > CANVAS_SHRINK_MARGIN + CANVAS_STEP && canvasBounds.h - CANVAS_STEP >= CANVAS_MIN_H && safety++ < 20) {
        canvasBounds.h -= CANVAS_STEP; bottom = canvasBounds.y + canvasBounds.h; changed = true
      }
      safety = 0
      while (bbox.x1 - canvasBounds.x > CANVAS_SHRINK_MARGIN + CANVAS_STEP && canvasBounds.w - CANVAS_STEP >= CANVAS_MIN_W && safety++ < 20) {
        canvasBounds.x += CANVAS_STEP; canvasBounds.w -= CANVAS_STEP; changed = true
      }
      safety = 0
      while (bbox.y1 - canvasBounds.y > CANVAS_SHRINK_MARGIN + CANVAS_STEP && canvasBounds.h - CANVAS_STEP >= CANVAS_MIN_H && safety++ < 20) {
        canvasBounds.y += CANVAS_STEP; canvasBounds.h -= CANVAS_STEP; changed = true
      }
    }

    if (changed) { enforcePanBounds(); drawGrid() }
  }

  function enforcePanBounds() {
    const cy = getCy()
    if (!cy) return
    const zoom = cy.zoom()
    const pan = cy.pan()
    const container = cy.container()
    if (!container) return
    const cw = container.offsetWidth
    const ch = container.offsetHeight
    const margin = 200

    const maxPanX = -canvasBounds.x * zoom + cw - margin
    const minPanX = -(canvasBounds.x + canvasBounds.w) * zoom + margin
    const maxPanY = -canvasBounds.y * zoom + ch - margin
    const minPanY = -(canvasBounds.y + canvasBounds.h) * zoom + margin

    const newPanX = Math.max(minPanX, Math.min(maxPanX, pan.x))
    const newPanY = Math.max(minPanY, Math.min(maxPanY, pan.y))

    if (newPanX !== pan.x || newPanY !== pan.y) {
      cy.pan({ x: newPanX, y: newPanY })
    }
  }

  // ─── 网格绘制 ────────────────────────────────────────────────
  function drawGrid() {
    const canvas = canvasRef.value
    const cy = getCy()
    if (!canvas || !cy) return

    if (!_ctx) _ctx = canvas.getContext('2d')
    if (!_ctx) return

    const panel = canvas.parentElement
    if (!panel) return
    const w = panel.offsetWidth
    const h = panel.offsetHeight

    // 高 DPI 支持
    if (canvas.width !== w * 2 || canvas.height !== h * 2) {
      canvas.width = w * 2
      canvas.height = h * 2
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      // 先 resetTransform 避免 scale 累加（Canvas 2D scale 是乘性的）
      _ctx.setTransform(1, 0, 0, 1, 0, 0)
      _ctx.scale(2, 2)
    }

    _ctx.clearRect(0, 0, w, h)

    const zoom = cy.zoom()
    const pan = cy.pan()

    // 画布边界在屏幕空间的位置
    const bx = canvasBounds.x * zoom + pan.x
    const by = canvasBounds.y * zoom + pan.y
    const bw = canvasBounds.w * zoom
    const bh = canvasBounds.h * zoom

    // 画布外灰色遮罩
    _ctx.fillStyle = 'rgba(0,0,0,0.04)'
    if (by > 0) _ctx.fillRect(0, 0, w, by)
    if (by + bh < h) _ctx.fillRect(0, by + bh, w, h - by - bh)
    _ctx.fillRect(0, Math.max(0, by), Math.max(0, bx), Math.min(bh, h))
    if (bx + bw < w) _ctx.fillRect(bx + bw, Math.max(0, by), w - bx - bw, Math.min(bh, h))

    // 网格点（只在画布内绘制）
    if (gridEnabled.value) {
      let step = GRID_SIZE * zoom
      if (step <= 0) step = GRID_SIZE
      let safety = 0
      while (step < 12 && safety++ < 20) step *= 5
      safety = 0
      while (step > 80 && safety++ < 20) step /= 2
      if (step <= 0) step = 20

      const bigStep = step * 5
      const startX = Math.max(bx, 0)
      const startY = Math.max(by, 0)
      const endX = Math.min(bx + bw, w)
      const endY = Math.min(by + bh, h)
      const offX = pan.x % step
      const offY = pan.y % step

      _ctx.fillStyle = 'rgba(160,170,185,0.25)'
      for (let x = offX; x < endX; x += step) {
        if (x < startX) continue
        for (let y = offY; y < endY; y += step) {
          if (y < startY) continue
          _ctx.beginPath(); _ctx.arc(x, y, 0.8, 0, Math.PI * 2); _ctx.fill()
        }
      }

      _ctx.fillStyle = 'rgba(140,150,165,0.4)'
      const bx0 = pan.x % bigStep
      const by0 = pan.y % bigStep
      for (let x = bx0; x < endX; x += bigStep) {
        if (x < startX) continue
        for (let y = by0; y < endY; y += bigStep) {
          if (y < startY) continue
          _ctx.beginPath(); _ctx.arc(x, y, 1.5, 0, Math.PI * 2); _ctx.fill()
        }
      }
    }

    // 画布边界线
    _ctx.strokeStyle = 'rgba(52,152,219,0.35)'
    _ctx.lineWidth = 1.5
    _ctx.setLineDash([6, 4])
    _ctx.strokeRect(bx, by, bw, bh)
    _ctx.setLineDash([])
  }

  // ─── 绑定 Cytoscape 事件 ─────────────────────────────────────
  let _resizeBound = false

  function bindCyEvents() {
    const cy = getCy()
    if (!cy) return

    cy.on('zoom pan', () => {
      if (_rafId) cancelAnimationFrame(_rafId)
      _rafId = requestAnimationFrame(() => { _rafId = null; drawGrid() })

      clearTimeout(_enforceTimer)
      _enforceTimer = setTimeout(() => {
        if (_enforcingPan) return
        _enforcingPan = true
        enforcePanBounds()
        _enforcingPan = false
        drawGrid()
      }, 50)
    })

    cy.on('drag', 'node', (e) => { expandCanvasIfNeeded(e.target.position()) })
    cy.on('free', 'node', () => { shrinkCanvas() })
    cy.on('remove', 'node', () => { setTimeout(shrinkCanvas, 50) })

    // 窗口 resize 只绑定一次
    if (!_resizeBound) {
      _resizeBound = true
      window.addEventListener('resize', onResize)
    }
  }

  // ─── 窗口 resize ─────────────────────────────────────────────
  const onResize = () => { setTimeout(drawGrid, 50) }

  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    if (_rafId) cancelAnimationFrame(_rafId)
    clearTimeout(_enforceTimer)
  })

  return {
    gridEnabled,
    drawGrid,
    setCanvasBounds,
    getCanvasBounds,
    expandCanvasIfNeeded,
    shrinkCanvas,
    enforcePanBounds,
    bindCyEvents,
  }
}
