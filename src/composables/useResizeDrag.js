/**
 * 面板拖拽缩放通用逻辑
 * 抽取 startStyleResize 和 startDetailResize 中的重复代码
 */
import { onUnmounted, onScopeDispose } from 'vue'

/**
 * @param {MouseEvent} e - mousedown 事件
 * @param {HTMLElement|null} container - 用于获取容器宽度
 * @param {number} startWidth - 起始宽度
 * @param {Function} clampWidth - 宽度限制函数 (width => clampedWidth)
 * @param {Function} calcPreviewLeft - 预览线 left 计算函数 (width => left)
 * @param {Function} onSave - 释放时保存回调 (width => void)
 * @param {Object} resizeState - reactive 状态对象（active, previewLeft）
 * @param {number} [direction=-1] - 拖拽方向：1=右侧扩张，-1=左侧扩张
 */
export function useResizeDrag(e, container, startWidth, clampWidth, calcPreviewLeft, onSave, resizeState, direction = -1) {
  if (e.button !== 0) return
  if (!container) return

  e.preventDefault()

  const startX = e.clientX

  const prevUserSelect = document.body.style.userSelect
  const prevCursor = document.body.style.cursor

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  resizeState.active = true
  resizeState.previewLeft = calcPreviewLeft(startWidth)

  const onMove = (ev) => {
    ev.preventDefault()
    const diff = direction * (startX - ev.clientX)
    const nextWidth = clampWidth(startWidth + diff)
    resizeState.previewLeft = calcPreviewLeft(nextWidth)
  }

  const cleanup = () => {
    resizeState.active = false
    document.body.style.userSelect = prevUserSelect
    document.body.style.cursor = prevCursor
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  const onUp = (ev) => {
    ev.preventDefault()
    const nextWidth = clampWidth(startWidth + direction * (startX - ev.clientX))
    onSave(nextWidth)
    cleanup()
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  onScopeDispose(cleanup)
}
