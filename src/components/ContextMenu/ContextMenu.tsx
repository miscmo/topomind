/**
 * ContextMenu — 右键菜单
 *
 * Appears at cursor position when right-clicking a node.
 * Items:
 * - 新建子节点
 * - 重命名
 * - 删除
 * - 连线模式
 */
import { useEffect, useRef } from 'react'
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
  targetId: string | null
  onNewChild: (nodeId: string) => void
  onRename: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onClose: () => void
}

export default function ContextMenu({
  visible,
  x,
  y,
  targetId,
  onNewChild,
  onRename,
  onDelete,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside
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

  const items: MenuEntry[] = [
    {
      label: '新建子节点',
      action: () => {
        onNewChild(targetId)
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
  const adjustedX = Math.min(x, window.innerWidth - 160)
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36 - 16)

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
}
