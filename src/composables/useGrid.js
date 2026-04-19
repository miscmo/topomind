/**
 * useGrid composable
 * 无限画布系统：网格绘制、平移管理
 */
import { ref, onScopeDispose, getCurrentScope } from 'vue'

const GRID_SIZE = 20

export function useGrid(canvasRef, getCy) {
  const gridEnabled = ref(true)
  let _ctx = null
  let _rafId = null
  let _resizeTimer = null
  let _resizeBound = false
  let _canvasBounds = { x: -750, y: -500, w: 1500, h: 1000 }

  function setCanvasBounds(bounds) {
    if (!bounds || typeof bounds !== 'object') return
    const x = Number(bounds.x)
    const y = Number(bounds.y)
    const w = Number(bounds.w)
    const h = Number(bounds.h)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return
    _canvasBounds = { x, y, w, h }
    drawGrid()
  }

  function getCanvasBounds() {
    return { ..._canvasBounds }
  }

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

    if (canvas.width !== w * 2 || canvas.height !== h * 2) {
      canvas.width = w * 2
      canvas.height = h * 2
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      _ctx.setTransform(1, 0, 0, 1, 0, 0)
      _ctx.scale(2, 2)
    }

    _ctx.clearRect(0, 0, w, h)

    const zoom = cy.zoom()
    const pan = cy.pan()

    if (gridEnabled.value) {
      let step = GRID_SIZE * zoom
      if (step <= 0) step = GRID_SIZE
      let safety = 0
      while (step < 12 && safety++ < 20) step *= 5
      safety = 0
      while (step > 80 && safety++ < 20) step /= 2
      if (step <= 0) step = 20

      const bigStep = step * 5
      const bounds = _canvasBounds || { x: 0, y: 0, w, h }
      const startX = Math.max(0, Math.floor((bounds.x - pan.x) / step) * step + pan.x)
      const startY = Math.max(0, Math.floor((bounds.y - pan.y) / step) * step + pan.y)
      const endX = Math.min(w, bounds.x + bounds.w - pan.x)
      const endY = Math.min(h, bounds.y + bounds.h - pan.y)
      const offBigX = ((pan.x % bigStep) + bigStep) % bigStep
      const offBigY = ((pan.y % bigStep) + bigStep) % bigStep

      _ctx.fillStyle = 'rgba(160,170,185,0.12)'
      for (let x = startX; x < endX; x += step) {
        for (let y = startY; y < endY; y += step) {
          _ctx.beginPath(); _ctx.arc(x, y, 0.8, 0, Math.PI * 2); _ctx.fill()
        }
      }

      _ctx.fillStyle = 'rgba(140,150,165,0.18)'
      for (let x = offBigX; x < w; x += bigStep) {
        for (let y = offBigY; y < h; y += bigStep) {
          _ctx.beginPath(); _ctx.arc(x, y, 1.5, 0, Math.PI * 2); _ctx.fill()
        }
      }
    }
  }

  function bindCyEvents() {
    const cy = getCy()
    if (!cy) return
    cy.off('zoom pan')
    cy.on('zoom pan', () => {
      if (_rafId) cancelAnimationFrame(_rafId)
      _rafId = requestAnimationFrame(() => { _rafId = null; drawGrid() })
    })
    if (!_resizeBound) {
      _resizeBound = true
      window.addEventListener('resize', onResize)
    }
  }

  const onResize = () => {
    clearTimeout(_resizeTimer)
    _resizeTimer = setTimeout(drawGrid, 50)
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      window.removeEventListener('resize', onResize)
      clearTimeout(_resizeTimer)
      if (_rafId) cancelAnimationFrame(_rafId)
    })
  }

  return {
    gridEnabled,
    drawGrid,
    bindCyEvents,
    setCanvasBounds,
    getCanvasBounds,
  }
}
