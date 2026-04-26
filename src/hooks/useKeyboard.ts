/**
 * useKeyboard — 全局快捷键处理
 *
 * - Escape: 清除选择 / 关闭上下文菜单
 * - Tab: 为选中节点添加子概念
 * - Delete / Backspace: 删除选中节点
 */
import { useCallback, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { logAction } from '../core/log-backend'
import { useNavContext } from './useNavContext'

interface UseKeyboardOptions {
  onDelete?: () => void
  onEscape?: () => void
  onAddChild?: (parentId: string) => void
  tabId?: string
}

export function useKeyboard(options: UseKeyboardOptions = {}) {
  const { onDelete, onEscape, onAddChild, tabId } = options

  const clearSelection = useAppStore((s) => s.clearSelection)
  const hideContextMenu = useAppStore((s) => s.hideContextMenu)
  const { getNavState } = useNavContext({ tabId })

  // Read the selection node respecting tab context when active.
  // useCallback ensures the function identity is stable across renders so
  // the useEffect deps array remains accurate without stale-closure risk.
  const getSelectedNodeId = useCallback(
    () => getNavState().selectedNodeId,
    [getNavState]
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // macOS: Cmd+Backspace fires both Meta and Backspace — guard to avoid double-trigger
      if (e.metaKey) return

      // Ignore if typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
        // Only handle Escape in inputs
        if (e.key === 'Escape') {
          ;(e.target as HTMLElement).blur?.()
          logAction('快捷键:ESC', 'useKeyboard', { action: 'blur-input' })
          onEscape?.()
        }
        return
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          logAction('快捷键:ESC', 'useKeyboard', { action: 'clear-selection' })
          clearSelection()
          logAction('右键菜单:关闭', 'useKeyboard', { source: 'Escape' })
          hideContextMenu()
          onEscape?.()
          break

        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          const selectedNodeIdForDelete = getSelectedNodeId()
          if (selectedNodeIdForDelete) {
            logAction('快捷键:删除节点', 'useKeyboard', { nodeId: selectedNodeIdForDelete })
            onDelete?.()
          }
          break

        case 'Tab':
          e.preventDefault()
          const selectedNodeIdKeyboard = getSelectedNodeId()
          if (selectedNodeIdKeyboard) {
            logAction('快捷键:添加子节点', 'useKeyboard', { parentId: selectedNodeIdKeyboard })
            onAddChild?.(selectedNodeIdKeyboard)
          }
          break

        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [clearSelection, hideContextMenu, onDelete, onEscape, onAddChild, tabId, getSelectedNodeId])
}
