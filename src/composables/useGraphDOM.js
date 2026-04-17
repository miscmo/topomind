/**
 * useGraphDOM composable (extracted from useGraph.js)
 * 封装所有 DOM 级事件绑定与管理：
 *   - 右键拖拽画布平移
 *   - 节点尺寸拖拽调整
 *   - 节点间连线拖拽
 *   - 视口缩放（滚轮）
 *   - 右键菜单拦截
 *   - 节点手柄元素（resize / connect）定位与事件
 */
import { GraphConstants } from '@/core/graph-constants.js'
import { logger } from '@/core/logger.js'

/**
 * 创建并返回 DOM 事件绑定函数及手柄元素管理器。
 *
 * @param {object} params
 * @param {import('cytoscape').Core} params.cyRef       - shallowRef 包裹的 cy 实例
 * @param {object} params.gridRef                     - grid composable 引用（用于 drawGrid）
 * @param {object} [params.dragResizeRef]             - 可选：拖拽状态 ref
 * @param {object} [params.dragConnectRef]            - 可选：连线状态 ref
 * @param {object} [params.rightDragMovedRef]         - 可选：右键拖拽标志 ref
 * @param {Function} params.saveLayout                - 保存布局 debounced 函数
 * @param {Function} params.addEdge                   - addEdge(sourceId, targetId, relation)
 * @param {Function} params.modalInput                - modalStore.showInput(...)
 * @returns {object} { bindDOMEvents, cleanupDOMEvents }
 */
export function useGraphDOM({
  cyRef,
  gridRef,
  dragResizeRef,
  dragConnectRef,
  rightDragMovedRef,
  saveLayout,
  addEdge,
  modalInput,
}) {
  const _handleElsByCy = new Map()
  const _domCleanupByCy = new Map()

  // ─── 节点手柄定位 ──────────────────────────────────────────────
  function updateNodeHandles(c = null) {
    const inst = c || cyRef.value
    if (!inst) return
    const els = _handleElsByCy.get(inst)
    if (!els) return

    const { resizeHandleEl, connectHandleEl } = els
    const selected = inst.nodes(':selected')
    if (selected.length !== 1) {
      resizeHandleEl?.classList.remove('active')
      connectHandleEl?.classList.remove('active')
      return
    }

    const node = selected[0]
    const p = node.renderedPosition()
    const w = node.renderedWidth()
    const h = node.renderedHeight()

    resizeHandleEl?.classList.add('active')
    connectHandleEl?.classList.add('active')

    if (resizeHandleEl) {
      resizeHandleEl.style.left = `${p.x + w / 2 - 6}px`
      resizeHandleEl.style.top = `${p.y + h / 2 - 6}px`
    }
    if (connectHandleEl) {
      connectHandleEl.style.left = `${p.x + w / 2 + 8}px`
      connectHandleEl.style.top = `${p.y - 6}px`
    }
  }

  // ─── 点命中检测 ─────────────────────────────────────────────────
  function hitNodeByClientPoint(c, clientX, clientY) {
    const container = c.container()
    if (!container) return null

    const rect = container.getBoundingClientRect()
    const rx = clientX - rect.left
    const ry = clientY - rect.top

    const nodes = c.nodes()
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const n = nodes[i]
      const bb = n.renderedBoundingBox()
      if (rx >= bb.x1 && rx <= bb.x2 && ry >= bb.y1 && ry <= bb.y2) {
        return n
      }
    }
    return null
  }

  // ─── 缩放显示控制 ────────────────────────────────────────────────
  function applyZoomDisplay(zoom) {
    if (!cyRef.value) return
    if (zoom < 0.6) {
      cyRef.value.edges('[weight="main"]').style('label', '')
      cyRef.value.edges('[weight="minor"]').style('display', 'none')
    } else if (zoom < 0.8) {
      cyRef.value.edges('[weight="main"]').style('label', e => e.data('relation') || '')
      cyRef.value.edges('[weight="minor"]').style('display', 'none')
    } else {
      cyRef.value.edges('[weight="main"]').style('label', e => e.data('relation') || '')
      cyRef.value.edges('[weight="minor"]').style('display', 'element')
    }
  }

  // AbortController per cy instance — aborts stale handle listeners on re-attach
  const _handleAbortByCy = new Map()

  // ─── 内部：附加手柄元素 ────────────────────────────────────────
  function attachHandleElements(c, els) {
    // Abort any previous listeners on this cy instance before adding new ones.
    // This prevents listener accumulation when updateNodeHandles re-attaches.
    _handleAbortByCy.get(c)?.abort()
    const ac = new AbortController()
    _handleAbortByCy.set(c, ac)
    _handleElsByCy.set(c, els)
    updateNodeHandles(c)

    const { resizeHandleEl, connectHandleEl } = els

    resizeHandleEl?.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const selected = c.nodes(':selected')
      const node = selected.length ? selected[0] : null
      if (!node) return

      const startW = Number(node.data('nodeWidth')) || node.renderedWidth()
      const startH = Number(node.data('nodeHeight')) || node.renderedHeight()

      if (dragResizeRef) {
        dragResizeRef.value = { active: true, nodeId: node.id(), startX: e.clientX, startY: e.clientY, startW, startH }
      }
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'nwse-resize'
    }, { signal: ac.signal })

    connectHandleEl?.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const selected = c.nodes(':selected')
      const node = selected.length ? selected[0] : null
      if (!node) return

      const p = node.renderedPosition()
      if (dragConnectRef) {
        dragConnectRef.value = { active: true, sourceId: node.id() }
      }
      if (els.previewLineEl) {
        els.previewLineEl.style.display = 'block'
        els.previewLineEl.style.left = `${p.x}px`
        els.previewLineEl.style.top = `${p.y}px`
        els.previewLineEl.style.width = '0px'
        els.previewLineEl.style.transform = 'rotate(0deg)'
      }
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'crosshair'
    }, { signal: ac.signal })
  }

  // ─── 内部：分离手柄元素 ────────────────────────────────────────
  function detachHandleElements(c) {
    _handleAbortByCy.get(c)?.abort()
    _handleAbortByCy.delete(c)
    _handleElsByCy.delete(c)
  }

  // ─── 核心：绑定 DOM 事件 ────────────────────────────────────────
  function bindDOMEvents(targetCy = null) {
    const c = targetCy || cyRef.value
    if (!c) return
    if (_domCleanupByCy.has(c)) return

    const container = c.container()

    // 创建手柄 DOM 元素
    const resizeHandleEl = document.createElement('div')
    resizeHandleEl.className = 'node-resize-handle'
    container.parentElement?.appendChild(resizeHandleEl)

    const connectHandleEl = document.createElement('div')
    connectHandleEl.className = 'edge-handle'
    container.parentElement?.appendChild(connectHandleEl)

    const previewLineEl = document.createElement('div')
    previewLineEl.className = 'connect-preview-line'
    previewLineEl.style.display = 'none'
    container.parentElement?.appendChild(previewLineEl)

    attachHandleElements(c, { resizeHandleEl, connectHandleEl, previewLineEl })

    // 右键拖拽画布状态（实例级局部变量）
    let localPanning = false
    let localPanStart = { x: 0, y: 0 }
    let localPanOrigin = { x: 0, y: 0 }

    const onMousedown = (e) => {
      if (e.button === 2) {
        localPanning = true
        if (rightDragMovedRef) rightDragMovedRef.value = false
        localPanStart = { x: e.clientX, y: e.clientY }
        localPanOrigin = { x: c.pan().x, y: c.pan().y }
        container.style.cursor = 'grabbing'
        e.preventDefault()
      }
    }

    const onMousemove = (e) => {
      try {
        if (dragResizeRef?.value?.active) {
          const node = c.getElementById(dragResizeRef.value.nodeId)
          if (node?.length) {
            const dx = e.clientX - dragResizeRef.value.startX
            const dy = e.clientY - dragResizeRef.value.startY
            const nextW = Math.max(
              GraphConstants.NODE_WIDTH_MIN,
              Math.min(GraphConstants.NODE_WIDTH_MAX, Math.round(dragResizeRef.value.startW + dx / Math.max(c.zoom(), 0.2))),
            )
            const nextH = Math.max(
              GraphConstants.NODE_HEIGHT_MIN,
              Math.min(GraphConstants.NODE_HEIGHT_MAX, Math.round(dragResizeRef.value.startH + dy / Math.max(c.zoom(), 0.2))),
            )
            node.data('nodeWidth', nextW)
            node.data('nodeHeight', nextH)
            node.style('width', `${nextW}px`)
            node.style('height', `${nextH}px`)
            node.style('text-max-width', `${nextW}px`)
            updateNodeHandles(c)
          }
          return
        }

        if (dragConnectRef?.value?.active) {
          const src = c.getElementById(dragConnectRef.value.sourceId)
          const els = _handleElsByCy.get(c)
          if (src?.length && els?.previewLineEl) {
            const s = src.renderedPosition()
            const rect = container.getBoundingClientRect()
            const tx = e.clientX - rect.left
            const ty = e.clientY - rect.top
            const dx = tx - s.x
            const dy = ty - s.y
            const len = Math.sqrt(dx * dx + dy * dy)
            const angle = Math.atan2(dy, dx) * 180 / Math.PI
            els.previewLineEl.style.left = `${s.x}px`
            els.previewLineEl.style.top = `${s.y}px`
            els.previewLineEl.style.width = `${len}px`
            els.previewLineEl.style.transform = `rotate(${angle}deg)`
          }
          return
        }

        if (!localPanning) return
        const dx = e.clientX - localPanStart.x
        const dy = e.clientY - localPanStart.y
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          if (rightDragMovedRef) rightDragMovedRef.value = true
        }
        c.pan({ x: localPanOrigin.x + dx, y: localPanOrigin.y + dy })
        gridRef?.drawGrid?.()
      } catch (err) {
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        logger.catch('useGraphDOM mousemove', 'mousemove 事件处理失败', err)
      }
    }

    const onMouseup = async (e) => {
      try {
        if (dragResizeRef?.value?.active) {
          dragResizeRef.value = null
          document.body.style.userSelect = ''
          document.body.style.cursor = ''
          saveLayout?.()
          return
        }

        if (dragConnectRef?.value?.active) {
          const sourceId = dragConnectRef.value.sourceId
          const target = hitNodeByClientPoint(c, e.clientX, e.clientY)
          const els = _handleElsByCy.get(c)
          if (els?.previewLineEl) els.previewLineEl.style.display = 'none'

          dragConnectRef.value = null
          document.body.style.userSelect = ''
          document.body.style.cursor = ''

          if (target && target.id() !== sourceId) {
            const relation = await modalInput('关系类型', '演进 / 依赖 / 相关', '依赖')
            if (relation) addEdge?.(sourceId, target.id(), relation)
          }
          return
        }

        if (e.button === 2 && localPanning) {
          localPanning = false
          container.style.cursor = ''
        }
      } catch (err) {
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        logger.catch('useGraphDOM mouseup', 'mouseup 事件处理失败', err)
      } finally {
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
    }

    const onContextmenu = (e) => e.preventDefault()

    const onWheel = (e) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? GraphConstants.ZOOM_WHEEL_FACTOR : 1 / GraphConstants.ZOOM_WHEEL_FACTOR
      let newZoom = c.zoom() * factor
      newZoom = Math.max(c.minZoom(), Math.min(c.maxZoom(), newZoom))
      const rect = container.getBoundingClientRect()
      c.zoom({ level: newZoom, renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top } })
    }

    container.addEventListener('contextmenu', onContextmenu)
    container.addEventListener('mousedown', onMousedown)
    document.addEventListener('mousemove', onMousemove)
    document.addEventListener('mouseup', onMouseup)
    container.addEventListener('wheel', onWheel, { passive: false })

    _domCleanupByCy.set(c, () => {
      container.removeEventListener('contextmenu', onContextmenu)
      container.removeEventListener('mousedown', onMousedown)
      document.removeEventListener('mousemove', onMousemove)
      document.removeEventListener('mouseup', onMouseup)
      container.removeEventListener('wheel', onWheel)
      resizeHandleEl.remove()
      connectHandleEl.remove()
      previewLineEl.remove()
      detachHandleElements(c)
    })
  }

  // ─── 批量清理除指定实例外的所有 DOM 绑定 ────────────────────────
  function cleanupDOMEventsExcept(activeCy = null) {
    for (const [cyInst, cleanup] of _domCleanupByCy.entries()) {
      if (!activeCy || cyInst !== activeCy) {
        try { cleanup?.() } catch (_) {}
        _domCleanupByCy.delete(cyInst)
      }
    }
  }

  // ─── 强制刷新所有实例的手柄位置 ────────────────────────────────
  function refreshAllHandles() {
    for (const cyInst of _handleElsByCy.keys()) {
      updateNodeHandles(cyInst)
    }
  }

  return {
    bindDOMEvents,
    cleanupDOMEventsExcept,
    updateNodeHandles,
    refreshAllHandles,
    applyZoomDisplay,
    _handleElsByCy,
    _domCleanupByCy,
  }
}
