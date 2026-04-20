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
import { memo, useEffect, useRef, useState } from 'react'
import styles from './ContextMenu.module.css'

interface MenuItem {
  label: string
  action: () => void
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
  onFocus,
  onProperties,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuSize, setMenuSize] = useState({ width: 160, height: 0 })

  // Measure menu size when it becomes visible
  useEffect(() => {
    if (!visible || !menuRef.current) return
    const measured = menuRef.current.getBoundingClientRect()
    setMenuSize({ width: measured.width, height: measured.height })
  }, [visible])
  useEffect(() => {
    if (!visible) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [visible, onClose])

  // Close on scroll or resize
  useEffect(() => {
    if (!visible) return
    const handler = () => onClose()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [visible, onClose])

  if (!visible || !targetId) return null

  const isEdge = type === 'edge'

  const items: MenuEntry[] = isEdge
    ? [
        {
          label: '删除连线',
          action: () => {
            onEdgeDelete(targetId)
            onClose()
          },
          danger: true,
        },
      ]
    : [
        {
          label: '新建子节点',
          action: () => {
            onNewChild(targetId)
            onClose()
          },
        },
        {
          label: '聚焦节点',
          action: () => {
            onFocus(targetId)
            onClose()
          },
        },
        {
          label: '重命名',
          action: () => {
            onRename(targetId)
            onClose()
          },
        },
        {
          label: '属性',
          action: () => {
            onProperties(targetId)
            onClose()
          },
        },
        { separator: true },
        {
          label: '删除节点',
          action: () => {
            onDelete(targetId)
            onClose()
          },
          danger: true,
        },
      ]

  // Adjust position to keep menu in viewport
  const adjustedX = Math.min(x, window.innerWidth - menuSize.width)
  const adjustedY = Math.min(y, window.innerHeight - menuSize.height)

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className={styles.sep} />
        ) : (
          <button
            key={i}
            className={`${styles.item} ${item.danger ? styles.danger : ''}`}
            onClick={item.action}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
})
