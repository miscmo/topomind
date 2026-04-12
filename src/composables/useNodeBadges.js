/**
 * useNodeBadges composable
 * 节点徽标层 + 文档预览 Tooltip
 * 完整迁移自 badges.js
 */
import { onUnmounted } from 'vue'
import { useStorage } from '@/composables/useStorage'

export function useNodeBadges(layerRef, tooltipRef, getCy) {
  const storage = useStorage()
  let _hoverTimer = null
  let _hideTimer = null
  let _mouseX = 0, _mouseY = 0
  let _boundCy = null
  let _cyHandlers = []

  // ─── 初始化（cy 就绪后调用）────────────────────────────────
  function init() {
    const cy = getCy()
    if (!cy) return

    // 避免重复绑定：切换实例时先解绑旧实例
    if (_boundCy && _boundCy !== cy) {
      _unbindCyEvents()
    }
    if (_boundCy === cy && _cyHandlers.length > 0) return

    _boundCy = cy

    // 跟踪鼠标位置
    document.addEventListener('mousemove', _onMouseMove)

    const onRender = () => _syncPositions()
    const onPanZoomResize = () => _syncPositions()
    const onNodeMove = () => _syncPositions()
    const onLayoutStop = () => _syncPositions()

    // 兜底：render + 关键交互事件都同步一次，保证节点拖拽时徽标跟随
    cy.on('render', onRender)
    cy.on('pan zoom resize', onPanZoomResize)
    cy.on('position drag free', 'node', onNodeMove)
    cy.on('layoutstop', onLayoutStop)

    const onMouseOverNode = (e) => {
      clearTimeout(_hideTimer)
      _hoverTimer = setTimeout(() => { _showTooltip(e.target) }, 220)
    }
    const onMouseOutNode = () => {
      clearTimeout(_hoverTimer)
      _hideTimer = setTimeout(() => {
        const tt = tooltipRef?.value
        if (tt) tt.classList.remove('visible')
      }, 80)
    }

    cy.on('mouseover', 'node', onMouseOverNode)
    cy.on('mouseout', 'node', onMouseOutNode)

    _cyHandlers = [
      ['render', null, onRender],
      ['pan zoom resize', null, onPanZoomResize],
      ['position drag free', 'node', onNodeMove],
      ['layoutstop', null, onLayoutStop],
      ['mouseover', 'node', onMouseOverNode],
      ['mouseout', 'node', onMouseOutNode],
    ]
  }

  // ─── 更新徽标（loadRoom 完成后调用）────────────────────────
  function update() {
    const layer = layerRef?.value
    const cy = getCy()
    if (!layer || !cy) return

    // 直接清空重建，避免 Vue 响应式开销（徽标是纯粹的表现层）
    layer.innerHTML = ''

    cy.nodes().forEach(node => {
      const childCount = node.data('childCount') || 0
      const hasDoc = !!node.data('hasDoc')
      if (childCount === 0 && !hasDoc) return

      const badge = document.createElement('div')
      badge.className = 'node-badge'
      badge.dataset.nodeId = node.id()

      if (hasDoc) {
        const pill = document.createElement('span')
        pill.className = 'node-badge-pill has-doc'
        pill.textContent = '📄'
        badge.appendChild(pill)
      }
      if (childCount > 0) {
        const pill = document.createElement('span')
        pill.className = 'node-badge-pill has-children'
        pill.textContent = childCount + '↓'
        badge.appendChild(pill)
      }

      layer.appendChild(badge)
    })

    _syncPositions()
  }

  // ─── 清空（切换房间时调用）──────────────────────────────────
  function clear() {
    const layer = layerRef?.value
    const tt = tooltipRef?.value
    // 直接清空 DOM，避免 Vue 响应式开销
    if (layer) layer.innerHTML = ''
    if (tt) tt.classList.remove('visible')
    clearTimeout(_hoverTimer)
    clearTimeout(_hideTimer)
  }

  function _unbindCyEvents() {
    if (!_boundCy || _cyHandlers.length === 0) return
    _cyHandlers.forEach(([eventName, selector, handler]) => {
      try {
        if (selector) _boundCy.off(eventName, selector, handler)
        else _boundCy.off(eventName, handler)
      } catch (e) {}
    })
    _cyHandlers = []
    _boundCy = null
  }

  // ─── 内部：同步徽标屏幕坐标 ─────────────────────────────────
  function _syncPositions() {
    const layer = layerRef?.value
    const cy = getCy()
    if (!layer || !cy) return

    const cyContainer = cy.container()
    if (!cyContainer) return
    const rect = cyContainer.getBoundingClientRect()
    const panelRect = layer.parentElement?.getBoundingClientRect()
    if (!panelRect) return

    const offsetX = rect.left - panelRect.left
    const offsetY = rect.top - panelRect.top

    layer.querySelectorAll('.node-badge').forEach(badge => {
      const node = cy.getElementById(badge.dataset.nodeId)
      if (!node?.length) { badge.style.display = 'none'; return }
      const rp = node.renderedPosition()
      const h = node.renderedHeight()
      badge.style.left = (offsetX + rp.x) + 'px'
      badge.style.top = (offsetY + rp.y + h / 2 + 2) + 'px'
      badge.style.display = ''
    })
  }

  // ─── 内部：显示 Tooltip ──────────────────────────────────────
  function _showTooltip(node) {
    const tt = tooltipRef?.value
    if (!tt || !node.data('hasDoc')) return

    const ttTitle = tt.querySelector('#node-tooltip-title')
    const ttBody = tt.querySelector('#node-tooltip-body')
    if (!ttTitle || !ttBody) return

    ttTitle.textContent = node.data('label') || ''
    ttBody.textContent = '加载中...'
    tt.classList.add('visible')
    _positionTooltip()

    const cardPath = node.data('cardPath') || node.id()
    storage.readMarkdown(cardPath).then(md => {
      if (!tt.classList.contains('visible')) return
      const text = (md || '').replace(/^#+\s+.*/gm, '').replace(/[*_`>#\-\[\]]/g, '').trim()
      ttBody.textContent = text.slice(0, 150) + (text.length > 150 ? '…' : '')
    }).catch((e) => {
      console.warn('[useNodeBadges] 读取文档失败:', cardPath, e)
      if (ttBody) ttBody.textContent = ''
    })
  }

  function _positionTooltip() {
    const tt = tooltipRef?.value
    if (!tt) return
    const tw = tt.offsetWidth || 260
    const th = tt.offsetHeight || 80
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = _mouseX + 14
    let y = _mouseY + 14
    if (x + tw > vw - 8) x = _mouseX - tw - 10
    if (y + th > vh - 8) y = _mouseY - th - 10
    tt.style.left = x + 'px'
    tt.style.top = y + 'px'
  }

  function _onMouseMove(e) {
    _mouseX = e.clientX
    _mouseY = e.clientY
    const tt = tooltipRef?.value
    if (tt?.classList.contains('visible')) _positionTooltip()
  }

  onUnmounted(() => {
    _unbindCyEvents()
    document.removeEventListener('mousemove', _onMouseMove)
    clearTimeout(_hoverTimer)
    clearTimeout(_hideTimer)
  })

  return { init, update, clear }
}
