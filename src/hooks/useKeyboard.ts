/**
 * useKeyboard — 全局快捷键处理
 *
 * - Escape: 清除选择 / 关闭上下文菜单
 * - Tab: 切换编辑模式（节点内）
 * - Delete / Backspace: 删除选中节点
 */
import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'

interface UseKeyboardOptions {
  onDelete?: () => void
  onEscape?: () => void
}

export function useKeyboard(options: UseKeyboardOptions = {}) {
  const { onDelete, onEscape } = options

  const clearSelection = useAppStore((s) => s.clearSelection)
  const hideContextMenu = useAppStore((s) => s.hideContextMenu)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
        // Only handle Escape in inputs
        if (e.key === 'Escape') {
          ;(e.target as HTMLElement).blur?.()
          onEscape?.()
        }
        return
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          clearSelection()
          hideContextMenu()
          onEscape?.()
          break

        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          onDelete?.()
          break

        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [clearSelection, hideContextMenu, onDelete, onEscape])
}
