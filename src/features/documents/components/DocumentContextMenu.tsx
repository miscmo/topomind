import React from 'react'
import { createPortal } from 'react-dom'
import { FilePlus, Download, PenLine, Trash2, ChevronRight } from 'lucide-react'
import type { DocumentContextMenuState } from '../model/useDocumentSidebarModel'
import { getTopoDocumentTypeDefinition, TOPO_DOCUMENT_TYPES } from '../services/documentTypeRegistry'

interface DocumentContextMenuProps {
  contextMenu: DocumentContextMenuState | null
  activeSubmenu: string | null
  menuRef: React.RefObject<HTMLDivElement | null>
  isBusy?: boolean
  onMouseEnterSubmenu: (menu: string) => void
  onMouseLeaveSubmenu: () => void
  onAction: (action: string) => void
}

export const DocumentContextMenu: React.FC<DocumentContextMenuProps> = ({
  contextMenu,
  activeSubmenu,
  menuRef,
  isBusy,
  onMouseEnterSubmenu,
  onMouseLeaveSubmenu,
  onAction,
}) => {
  if (!contextMenu) return null

  const adjustedX = Math.max(0, Math.min(contextMenu.x, window.innerWidth - 180))
  const adjustedY = Math.max(0, Math.min(contextMenu.y, window.innerHeight - 200))

  return createPortal(
    <div
      ref={menuRef}
      id="document-context-menu"
      className="fixed min-w-[180px] p-1.5 bg-[var(--titlebar-menu-bg)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] z-[1200] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedX, top: adjustedY, transformOrigin: 'top left' }}
    >
      <div 
        className="relative"
        onMouseEnter={() => onMouseEnterSubmenu('create')}
        onMouseLeave={onMouseLeaveSubmenu}
      >
        <button
          type="button"
          className={`flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none text-[var(--color-text-primary)] ${activeSubmenu === 'create' ? 'bg-[var(--color-hover-bg)]' : 'bg-transparent'}`}
        >
          <span className="flex items-center justify-center text-[var(--color-text-muted)]">
            <FilePlus className="w-4 h-4" />
          </span>
          <span className="flex-1">新建文档</span>
          <span className="flex items-center justify-center text-[var(--color-text-muted)]">
            <ChevronRight className="w-4 h-4" />
          </span>
        </button>
        {activeSubmenu === 'create' && (
          <div className="absolute left-[calc(100%-4px)] top-[-6px] min-w-[160px] p-1.5 bg-[var(--titlebar-menu-bg)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-popover)] z-[1200] backdrop-blur-xl animate-in fade-in slide-in-from-left-1 duration-100">
            {TOPO_DOCUMENT_TYPES.map((type) => {
              const definition = getTopoDocumentTypeDefinition(type)
              return (
                <button
                  key={type}
                  type="button"
                  className="flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => onAction(`create:${type}`)}
                  disabled={isBusy}
                >
                  <span className="flex items-center justify-center text-[var(--color-text-muted)]">{definition.icon}</span>
                  {definition.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {contextMenu.targetId && <div className="h-px bg-[var(--color-border-subtle)] mx-1 my-1" />}
      {contextMenu.targetId && (
        <button
          type="button"
          className="flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => onAction('export')}
          disabled={isBusy}
        >
          <span className="flex items-center justify-center text-[var(--color-text-muted)]"><Download className="w-4 h-4" /></span>
          导出
        </button>
      )}
      {contextMenu.targetId && (
        <button
          type="button"
          className="flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-hover-bg)] text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => onAction('rename')}
          disabled={isBusy}
        >
          <span className="flex items-center justify-center text-[var(--color-text-muted)]"><PenLine className="w-4 h-4" /></span>
          重命名
        </button>
      )}
      {contextMenu.targetId && (
        <button
          type="button"
          className="flex items-center gap-2.5 w-full h-8 px-2 border-none rounded-md cursor-pointer text-left text-[13px] font-medium transition-colors outline-none bg-transparent hover:bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:text-[var(--color-danger-hover)] disabled:opacity-40 disabled:cursor-not-allowed group"
          onClick={() => onAction('delete')}
          disabled={isBusy}
        >
          <span className="flex items-center justify-center text-[var(--color-danger)] group-hover:text-[var(--color-danger-hover)]"><Trash2 className="w-4 h-4" /></span>
          删除
        </button>
      )}
    </div>,
    document.body
  )
}
