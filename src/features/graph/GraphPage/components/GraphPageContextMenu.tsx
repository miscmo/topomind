import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Palette, Trash2, Maximize2 } from 'lucide-react'

interface MenuItem {
  label: string
  action: () => void | Promise<void>
  icon?: React.ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  separator?: never
}

interface MenuSeparator {
  separator: true
  label?: never
  action?: never
  icon?: never
  shortcut?: never
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
  const [menuSize, setMenuSize] = useState({ width: 200, height: 0 })
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const isEdge = type === 'edge'
  const isPane = type === 'pane'

  const items: MenuEntry[] = isPane
    ? [
        {
          label: '新建节点',
          icon: <Plus className="w-4 h-4" />,
          shortcut: 'Double Click',
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
            icon: <Palette className="w-4 h-4" />,
            action: async () => {
              if (targetId) await onEdgeStyle(targetId)
              onClose()
            },
          },
          { separator: true },
          {
            label: '删除连线',
            icon: <Trash2 className="w-4 h-4" />,
            shortcut: 'Backspace',
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
            icon: <Maximize2 className="w-4 h-4" />,
            shortcut: 'Enter',
            action: async () => {
              if (targetId) await onEnterNode(targetId)
              onClose()
            },
          },
          { separator: true },
          {
            label: '删除节点',
            icon: <Trash2 className="w-4 h-4" />,
            shortcut: 'Backspace',
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
    setFocusedIndex(-1)
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
    const blockMenu = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) {
        e.preventDefault()
      } else {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('contextmenu', blockMenu)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('contextmenu', blockMenu)
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
      className="fixed z-[50] min-w-[200px] bg-white/90 dark:bg-[#1b2330]/90 border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] p-1.5 overflow-hidden backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedX, top: adjustedY, transformOrigin: 'top left' }}
      onMouseLeave={() => setFocusedIndex(-1)}
    >
      {items.map((item, i) => {
        if ('separator' in item) {
          return <div key={i} className="h-px bg-[var(--color-border-subtle)] mx-1 my-1" />
        }

        navigableIndex += 1
        const currentIndex = navigableIndex
        const isFocused = focusedIndex === currentIndex

        let textColor = 'text-[var(--color-text-primary)]'
        let iconColor = 'text-[var(--color-text-muted)]'
        let bgColor = isFocused ? 'bg-[var(--color-hover-bg)]' : 'bg-transparent'

        if (item.danger) {
          textColor = isFocused ? 'text-[var(--color-danger-hover)]' : 'text-[var(--color-danger)]'
          iconColor = isFocused ? 'text-[var(--color-danger-hover)]' : 'text-[var(--color-danger)]'
          bgColor = isFocused ? 'bg-[var(--color-danger-soft)]' : 'bg-transparent'
        }

        return (
          <button
            key={i}
            className={`flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none disabled:opacity-40 disabled:cursor-not-allowed ${bgColor} ${textColor}`}
            onClick={async () => { await item.action() }}
            onMouseEnter={() => setFocusedIndex(currentIndex)}
            disabled={item.disabled}
          >
            {item.icon && (
              <span className={`flex items-center justify-center ${iconColor}`}>
                {item.icon}
              </span>
            )}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="ml-auto text-[11px] tracking-widest text-[var(--color-text-muted)] opacity-70 font-sans">
                {item.shortcut}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
})
