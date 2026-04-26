/**
 * ContextMenu — 右键菜单
 *
 * Appears at cursor position when right-clicking a node or edge.
 * Items (node):
 * - 新建子节点
 * - 重命名
 * - 删除
 * Items (edge):
 * - 删除连线
 */
import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import styles from './ContextMenu.module.css'

interface MenuItem {
  label: string
  action: () => void | Promise<void>
  danger?: boolean
  disabled?: boolean
  separator?: never
}

interface MenuSeparator {
  separator: true
  label?: never
  action?: never
  danger?: never
  disabled?: never
}

type MenuEntry = MenuItem | MenuSeparator

interface ContextMenuProps {
  visible: boolean
  x: number
  y: number
  type: 'node' | 'edge' | 'pane' | null
  targetId: string | null
  onNewChild: (nodeId: string) => void
  onRename: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onEdgeDelete: (edgeId: string) => void
  onEdgeStyle: (edgeId: string) => void
  onFocus: (nodeId: string) => void
  onProperties: (nodeId: string) => void
  onClose: () => void
}

export default memo(function ContextMenu({
  visible,
  x,
  y,
  type,
  targetId,
  onNewChild,
  onRename,
  onDelete,
  onEdgeDelete,
  onEdgeStyle,
  onFocus,
  onProperties,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuSize, setMenuSize] = useState({ width: 160, height: 0 })
  // Keyboard navigation: tracks focused item index among non-separator items
  const [focusedIndex, setFocusedIndex] = useState(-1)

  if (!visible) return null

  const isEdge = type === 'edge'
  const isPane = type === 'pane'
  const paneTargetId = isPane ? '' : targetId

  // Build menu items — must be before useEffect that references `items`
  const items: MenuEntry[] = isPane
    ? [
        {
          label: '新建子节点',
          action: async () => {
            await onNewChild('')
            onClose()
          },
        },
      ]
    : isEdge
      ? [
          {
            label: '连线样式',
            action: async () => {
              if (targetId) await onEdgeStyle(targetId)
              onClose()
            },
          },
          { separator: true },
          {
            label: '删除连线',
            action: async () => {
              if (targetId) await onEdgeDelete(targetId)
              onClose()
            },
            danger: true,
          },
        ]
      : [
          {
            label: '新建子节点',
            action: async () => {
              await onNewChild(paneTargetId ?? '')
              onClose()
            },
          },
          {
            label: '聚焦节点',
            action: () => {
              if (paneTargetId) onFocus(paneTargetId)
              onClose()
            },
          },
          {
            label: '重命名',
            action: async () => {
              if (paneTargetId) await onRename(paneTargetId)
              onClose()
            },
          },
          {
            label: '属性',
            action: () => {
              if (paneTargetId) onProperties(paneTargetId)
              onClose()
            },
          },
          { separator: true },
          {
            label: '删除节点',
            action: async () => {
              if (paneTargetId) await onDelete(paneTargetId)
              onClose()
            },
            danger: true,
          },
        ]

  // Memoize navigable (non-separator) items so focusedIndex maps correctly
  const navigableItems = useMemo(
    () => items.filter((item): item is MenuItem => !('separator' in item)),
    [items]
  )

  // Reset focus to first item when menu opens
  useEffect(() => {
    setFocusedIndex(navigableItems.length > 0 ? 0 : -1)
  }, [visible, navigableItems.length])

  // Measure menu size when it becomes visible
  useEffect(() => {
    if (!menuRef.current) return
    const measured = menuRef.current.getBoundingClientRect()
    setMenuSize({ width: measured.width, height: measured.height })
  }, [visible])

  // Close on mousedown/contextmenu outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('contextmenu', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('contextmenu', handler)
    }
  }, [onClose])

  // Close on scroll or resize
  useEffect(() => {
    const handler = () => onClose()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [onClose])

  // Keyboard: Escape closes, Arrow keys navigate, Enter activates
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) =>
          prev < navigableItems.length - 1 ? prev + 1 : 0
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) =>
          prev > 0 ? prev - 1 : navigableItems.length - 1
        )
      } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < navigableItems.length) {
        e.preventDefault()
        const item = navigableItems[focusedIndex]!
        if (item && !item.disabled) item.action()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, navigableItems, focusedIndex])

  // Adjust position to keep menu in viewport — x stays at 0 if it would go negative
  const adjustedX = Math.max(0, Math.min(x, window.innerWidth - menuSize.width))
  // y stays at 0 if it would go negative
  const adjustedY = Math.max(0, Math.min(y, window.innerHeight - menuSize.height))

  // Build index → position map so button refs can be focused
  const itemButtonRefs = useRef<(HTMLButtonElement | null)[]>([])

  return (
    <div
      ref={menuRef}
      data-testid="context-menu"
      className={styles.menu}
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className={styles.sep} />
        ) : (
          <button
            ref={(el) => { itemButtonRefs.current[i] = el }}
            key={i}
            data-testid={`context-menu-${item.label}`}
            className={`${styles.item} ${item.danger ? styles.danger : ''} ${focusedIndex === i ? styles.focused : ''}`}
            onClick={async () => { await item.action() }}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
})
