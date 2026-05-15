import { memo, useEffect, useMemo, useRef, useState } from 'react'
import styles from './GraphPageContextMenu.module.css'

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

interface GraphPageContextMenuProps {
  visible: boolean
  x: number
  y: number
  type: 'node' | 'edge' | 'pane' | null
  targetId: string | null
  onNewChild: (position?: { x: number; y: number }) => void
  onEnterNode: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onEdgeDelete: (edgeId: string) => void
  onEdgeStyle: (edgeId: string) => void
  onClose: () => void
}

export default memo(function GraphPageContextMenu({
  visible,
  x,
  y,
  type,
  targetId,
  onNewChild,
  onEnterNode,
  onDelete,
  onEdgeDelete,
  onEdgeStyle,
  onClose,
}: GraphPageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuSize, setMenuSize] = useState({ width: 160, height: 0 })
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const isEdge = type === 'edge'
  const isPane = type === 'pane'

  const items: MenuEntry[] = isPane
    ? [
        {
          label: '新建节点',
          action: async () => {
            await onNewChild({ x, y })
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
            label: '进入节点',
            action: async () => {
              if (targetId) await onEnterNode(targetId)
              onClose()
            },
          },
          { separator: true },
          {
            label: '删除节点',
            action: async () => {
              if (targetId) await onDelete(targetId)
              onClose()
            },
            danger: true,
          },
        ]

  const navigableItems = useMemo(
    () => items.filter((item): item is MenuItem => !('separator' in item)),
    [items]
  )

  useEffect(() => {
    if (!visible) return
    setFocusedIndex(navigableItems.length > 0 ? 0 : -1)
  }, [visible, navigableItems.length])

  useEffect(() => {
    if (!menuRef.current || !visible) return
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
    document.addEventListener('contextmenu', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('contextmenu', handler)
    }
  }, [visible, onClose])

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

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((prev) => (prev < navigableItems.length - 1 ? prev + 1 : 0))
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : navigableItems.length - 1))
        return
      }

      if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < navigableItems.length) {
        e.preventDefault()
        const item = navigableItems[focusedIndex]
        if (item && !item.disabled) item.action()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [visible, onClose, navigableItems, focusedIndex])

  const adjustedX = Math.max(0, Math.min(x, window.innerWidth - menuSize.width))
  const adjustedY = Math.max(0, Math.min(y, window.innerHeight - menuSize.height))

  if (!visible) return null

  let navigableIndex = -1

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, i) => {
        if ('separator' in item) {
          return <div key={i} className={styles.sep} />
        }

        navigableIndex += 1
        const isFocused = focusedIndex === navigableIndex

        return (
          <button
            key={i}
            className={`${styles.item} ${item.danger ? styles.danger : ''} ${isFocused ? styles.focused : ''}`}
            onClick={async () => { await item.action() }}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
})
