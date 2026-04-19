/**
 * useKeyboard — 全局快捷键处理
 *
 * - Escape: 清除选择 / 关闭上下文菜单
 * - Tab: 为选中节点添加子概念
 * - Delete / Backspace: 删除选中节点
 */
import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'

interface UseKeyboardOptions {
  onDelete?: () => void
  onEscape?: () => void
  onAddChild?: (parentId: string) => void
}

export function useKeyboard(options: UseKeyboardOptions = {}) {
  const { onDelete, onEscape, onAddChild } = options

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

        case 'Tab':
          e.preventDefault()
          // Read fresh from store to avoid stale closure
          const selectedNodeId = useAppStore.getState().selectedNodeId
          if (selectedNodeId) {
            onAddChild?.(selectedNodeId)
          }
          break

        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [clearSelection, hideContextMenu, onDelete, onEscape, onAddChild])
}
