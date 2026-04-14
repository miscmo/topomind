/**
 * useGrid composable
 * 无限画布系统：网格绘制、平移管理
 */
import { ref, onUnmounted } from 'vue'

const GRID_SIZE = 20

export function useGrid(canvasRef, getCy) {
  const gridEnabled = ref(true)
  let _ctx = null
  let _rafId = null
  let _resizeBound = false

  function setCanvasBounds() {}
  function getCanvasBounds() { return null }
  function expandCanvasIfNeeded() { return false }
  function shrinkCanvas() {}
  function enforcePanBounds() {}

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
      const offX = ((pan.x % step) + step) % step
      const offY = ((pan.y % step) + step) % step
      const offBigX = ((pan.x % bigStep) + bigStep) % bigStep
      const offBigY = ((pan.y % bigStep) + bigStep) % bigStep

      _ctx.fillStyle = 'rgba(160,170,185,0.12)'
      for (let x = offX; x < w; x += step) {
        for (let y = offY; y < h; y += step) {
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

  const onResize = () => { setTimeout(drawGrid, 50) }

  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    if (_rafId) cancelAnimationFrame(_rafId)
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
