import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Workflow, Palette, Trash2, Maximize2, SmilePlus, FolderInput, Link2, ListTree, X } from 'lucide-react'

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
  onNewContainerChild: (position?: { x: number; y: number }) => void
  onEnterNode: (nodeId: string) => void
  onSelectSubtree: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onEdgeDelete: (edgeId: string) => void
  onEdgeStyle: (edgeId: string) => void
  onAddEmoji: (nodeId: string, position: { x: number, y: number }) => void
  onMoveToRoom: (nodeId: string) => void
  /** 打开菜单时的选中快照，用于多选批量移动入口 */
  selectedCount: number
  targetInSelection: boolean
  /** 右键落在 xyflow 多选选区包围盒上：渲染批量操作菜单 */
  selectionMenu: boolean
  onMoveSelectionToRoom: () => void
  onClearSelection: () => void
  onLinkDocument: (nodeId: string) => void
  onClose: () => void
}

export default memo(function GraphPageContextMenu({
  visible,
  x,
  y,
  type,
  targetId,
  onNewChild,
  onNewContainerChild,
  onEnterNode,
  onSelectSubtree,
  onDelete,
  onEdgeDelete,
  onEdgeStyle,
  onAddEmoji,
  onMoveToRoom,
  selectedCount,
  targetInSelection,
  selectionMenu,
  onMoveSelectionToRoom,
  onClearSelection,
  onLinkDocument,
  onClose,
}: GraphPageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuSize, setMenuSize] = useState({ width: 200, height: 0 })
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const isEdge = type === 'edge'
  const isPane = type === 'pane'
  // 右键落在框选集合内时，明确提示这会移动整批节点，而不是只移动右键的那一个。
  const moveToRoomLabel = targetInSelection && selectedCount > 1
    ? `移动选中 ${selectedCount} 个节点到房间…`
    : '移动到房间…'

  // 框选后右键画布空白处也能发起批量移动，不必再逐个右键选中节点。
  const paneItems: MenuEntry[] = [
    {
      label: '新建节点',
      icon: <Plus className="w-4 h-4" />,
      shortcut: 'Double Click',
      action: async () => {
        await onNewChild({ x, y })
        onClose()
      },
    },
    {
      label: '新建流程图容器',
      icon: <Workflow className="w-4 h-4" />,
      action: async () => {
        await onNewContainerChild({ x, y })
        onClose()
      },
    },
  ]
  if (selectedCount > 0) {
    paneItems.push({ separator: true })
    paneItems.push({
      label: `移动选中 ${selectedCount} 个节点到房间…`,
      icon: <FolderInput className="w-4 h-4" />,
      action: () => {
        onMoveSelectionToRoom()
        onClose()
      },
    })
  }

  // 框选 / 选中子树 / Shift 点选后，xyflow 的选区包围盒覆盖在节点上方，
  // 右键只会走 onSelectionContextMenu。这里给整批节点一个明确的批量菜单，
  // 集合来自打开菜单时冻结的快照，不受菜单期间选中态变化影响。
  const selectionItems: MenuEntry[] = [
    {
      label: `移动选中 ${selectedCount} 个节点到房间…`,
      icon: <FolderInput className="w-4 h-4" />,
      disabled: selectedCount === 0,
      action: () => {
        onMoveSelectionToRoom()
        onClose()
      },
    },
    {
      label: '取消选择',
      icon: <X className="w-4 h-4" />,
      action: () => {
        onClearSelection()
        onClose()
      },
    },
  ]

  const edgeItems: MenuEntry[] = [
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

  const nodeItems: MenuEntry[] = [
    {
      label: '进入节点',
      icon: <Maximize2 className="w-4 h-4" />,
      shortcut: 'Enter',
      action: async () => {
        if (targetId) await onEnterNode(targetId)
        onClose()
      },
    },
    {
      label: '选中子树',
      icon: <ListTree className="w-4 h-4" />,
      action: () => {
        if (targetId) onSelectSubtree(targetId)
        onClose()
      },
    },
    {
      label: '添加表情',
      icon: <SmilePlus className="w-4 h-4" />,
      action: async () => {
        if (targetId) await onAddEmoji(targetId, { x, y })
        onClose()
      },
    },
    {
      label: '关联已有文档…',
      icon: <Link2 className="w-4 h-4" />,
      action: async () => {
        if (targetId) await onLinkDocument(targetId)
        onClose()
      },
    },
    {
      label: moveToRoomLabel,
      icon: <FolderInput className="w-4 h-4" />,
      action: async () => {
        if (targetId) await onMoveToRoom(targetId)
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

  const items: MenuEntry[] = selectionMenu
    ? selectionItems
    : isPane
      ? paneItems
      : isEdge
        ? edgeItems
        : nodeItems

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
      // Don't close if clicking inside the unified emoji picker (portal-mounted)
      const target = e.target as Element
      if (target.closest('[data-tm-emoji-picker]:not([data-tm-exiting])')) return
      
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
    // Use capture phase to intercept clicks before they reach the window
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('contextmenu', blockMenu)
    return () => {
      document.removeEventListener('mousedown', handler, true)
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
      className="fixed z-[50] min-w-[200px] bg-[var(--titlebar-menu-bg)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] p-1.5 overflow-hidden backdrop-blur-xl tm-popover-enter"
      style={{ left: adjustedX, top: adjustedY }}
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
            data-context-menu-item="true"
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
