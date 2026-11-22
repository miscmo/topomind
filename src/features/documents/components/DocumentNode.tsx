import { ChevronRight, FileText, FolderTree, Palette, Plus, Trash2 } from 'lucide-react'
import React from 'react'
import type { TopoDocumentManifestItem } from '../../../core/storage'
import { PANEL_LIST, PanelListAction } from '../../../shared/ui/panelList'
import { EmojiGlyph } from '../../../shared/ui/emoji/EmojiGlyph'
import { topoDocumentPath } from '../types/documentTypes'
import { DocumentInlineEdit } from './DocumentInlineEdit'
import type { DocumentInlineEditState } from '../model/useDocumentSidebarModel'

interface DocumentNodeProps {
  node: TopoDocumentManifestItem
  level: number
  activeDocumentPath: string
  childrenMap: Record<string, TopoDocumentManifestItem[]>
  expandedNodes: Set<string>
  inlineEdit: DocumentInlineEditState | null
  inlineInputRef: React.RefObject<HTMLInputElement | null>
  isBusy?: boolean
  draggedId: string | null
  dragState: { id: string, position: 'before' | 'inside' | 'after' } | null
  onSelectDocument: (path: string) => void
  onRenameDocument: (id: string) => void
  onOpenIconPicker: (id: string, x: number, y: number) => void
  onToggleExpand: (id: string) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  onDragStart: (e: React.DragEvent, id: string) => void
  onDragOver: (e: React.DragEvent, id: string | null) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, id: string | null) => void
  onInlineEditChange: (value: string) => void
  onInlineEditBlur: () => void
  onInlineEditKeyDown: (e: React.KeyboardEvent) => void
  onRowElement?: (id: string, element: HTMLDivElement | null) => void
  renderChildren?: boolean
  sticky?: boolean
  // 大文件夹展开时限制一次渲染的子项数，避免一次性创建数千个 DOM 节点（见模型层注释）。
  // 未提供时表示不设上限（如 sticky 行 —— 它们 renderChildren=false，本就不渲染子项）。
  getChildRenderLimit?: (id: string) => number
  onShowMoreChildren?: (id: string) => void
  /** hover 快捷操作：在该项下新建子文档 / 打开统一样式面板 / 删除该项 */
  onQuickCreate?: (id: string) => void
  onQuickStyle?: (id: string, x: number, y: number) => void
  onQuickDelete?: (id: string) => void
}

/**
 * 快捷按钮必须和行本身的行为隔离：行 div 同时绑了选中、双击重命名、右键菜单和
 * HTML5 拖拽，按钮冒泡上去会导致「点删除却先把文档打开」或误触发拖动。
 * onClick 单独在各按钮里处理，这里只拦其它事件。
 */
const QUICK_ACTION_EVENTS = {
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => e.stopPropagation(),
  onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent<HTMLButtonElement>) => e.stopPropagation(),
  onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => e.stopPropagation(),
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
  },
}

const EMPTY_CHILDREN: TopoDocumentManifestItem[] = []

/**
 * childrenMap 每次 buildDocumentTree 都会产生新对象，但单行只关心自己的子项。
 * 因此对该 prop 只比较「本节点的 children 内容」：改某一项样式时，只有该项
 * 及其祖先链需要重渲染，其余行靠这个比较直接跳过。其它 props 走引用比较。
 */
function areDocumentNodePropsEqual(prev: DocumentNodeProps, next: DocumentNodeProps) {
  const keys = new Set([
    ...Object.keys(prev),
    ...Object.keys(next),
  ] as (keyof DocumentNodeProps)[])
  for (const key of keys) {
    if (key === 'childrenMap') {
      const before = prev.childrenMap[prev.node.id] ?? EMPTY_CHILDREN
      const after = next.childrenMap[next.node.id] ?? EMPTY_CHILDREN
      if (before.length !== after.length || before.some((item, index) => item !== after[index])) return false
      continue
    }
    if (prev[key] !== next[key]) return false
  }
  return true
}

function DocumentNodeView({
  node,
  level,
  activeDocumentPath,
  childrenMap,
  expandedNodes,
  inlineEdit,
  inlineInputRef,
  isBusy,
  draggedId,
  dragState,
  onSelectDocument,
  onRenameDocument,
  onOpenIconPicker,
  onToggleExpand,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onInlineEditChange,
  onInlineEditBlur,
  onInlineEditKeyDown,
  onRowElement,
  renderChildren = true,
  sticky = false,
  getChildRenderLimit,
  onShowMoreChildren,
  onQuickCreate,
  onQuickStyle,
  onQuickDelete,
}: DocumentNodeProps) {
  const isEditing = inlineEdit?.mode === 'rename' && inlineEdit.targetId === node.id
  const setRowElement = React.useCallback((element: HTMLDivElement | null) => {
    onRowElement?.(node.id, element)
  }, [node.id, onRowElement])
  const children = childrenMap[node.id] || []
  const isExpanded = expandedNodes.has(node.id)
  const hasChildren = children.length > 0
  // 超过上限的子项先不渲染，改由底部的「显示剩余 N 项」按需展开。
  const childLimit = getChildRenderLimit ? getChildRenderLimit(node.id) : Number.MAX_SAFE_INTEGER
  const visibleChildren = children.slice(0, childLimit)
  const hiddenChildCount = children.length - visibleChildren.length
  const isActive = topoDocumentPath(node.id) === activeDocumentPath
  const isDragTarget = dragState?.id === node.id
  const dragClass = isDragTarget 
    ? dragState.position === 'before' ? 'border-t-[1.5px] border-t-[var(--color-primary)]' 
    : dragState.position === 'after' ? 'border-b-[1.5px] border-b-[var(--color-primary)]'
    : 'bg-[var(--color-hover-bg)] ring-[1.5px] ring-inset ring-[var(--color-primary)]'
    : ''

  return (
    <React.Fragment>
      {isEditing ? (
        <DocumentInlineEdit
          level={level}
          inlineEdit={inlineEdit}
          inlineInputRef={inlineInputRef}
          isBusy={isBusy}
          onChange={onInlineEditChange}
          onBlur={onInlineEditBlur}
          onKeyDown={onInlineEditKeyDown}
        />
      ) : (
        <div
          ref={sticky ? undefined : setRowElement}
          data-document-node-id={node.id}
          data-document-sticky={sticky ? 'true' : undefined}
          role="treeitem"
          tabIndex={0}
          aria-level={level + 1}
          aria-selected={isActive}
          aria-expanded={hasChildren ? isExpanded : undefined}
          draggable={!isEditing && !sticky}
          onDragStart={sticky ? undefined : (e) => onDragStart(e, node.id)}
          onDragOver={sticky ? undefined : (e) => onDragOver(e, node.id)}
          onDragLeave={sticky ? undefined : onDragLeave}
          onDrop={sticky ? undefined : (e) => onDrop(e, node.id)}
          className={`group relative w-full flex min-h-[26px] items-center gap-1 mb-[2px] py-1 pr-1.5 border-none rounded-md bg-transparent text-left cursor-pointer transition-colors duration-75 hover:bg-[var(--color-hover-bg)] ${isActive ? `!bg-[var(--color-accent-soft)] ${PANEL_LIST.rowActive}` : ''} ${dragClass} ${draggedId === node.id ? 'opacity-50' : ''}`}
          style={{ paddingLeft: `${level * 16 + 4}px` }}
          onClick={() => onSelectDocument(topoDocumentPath(node.id))}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelectDocument(topoDocumentPath(node.id))
            }
          }}
          onDoubleClick={(e) => {
            if (e.target !== e.currentTarget && !(e.target as HTMLElement).closest('[data-document-title]')) return
            e.preventDefault()
            e.stopPropagation()
            onRenameDocument(node.id)
          }}
          onContextMenu={(e) => onContextMenu(e, node.id)}
          title={node.title}
        >
          <span
            role={hasChildren ? 'button' : undefined}
            tabIndex={hasChildren ? 0 : -1}
            draggable={hasChildren ? false : undefined}
            aria-label={hasChildren ? `${isExpanded ? '折叠' : '展开'}「${node.title}」` : undefined}
            className={`w-4 h-4 flex items-center justify-center shrink-0 ${hasChildren ? 'cursor-pointer hover:bg-[var(--color-hover-bg)] rounded ' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation()
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
            onDragStart={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (hasChildren) onToggleExpand(node.id)
            }}
            onDoubleClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onKeyDown={(e) => {
              if (hasChildren && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                e.stopPropagation()
                onToggleExpand(node.id)
              }
            }}
          >
            {hasChildren ? (
              <ChevronRight className={`h-3 w-3 text-[var(--color-text-muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            ) : <span className="w-1" />}
          </span>
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            <span
              role="button"
              tabIndex={isBusy ? -1 : 0}
              draggable={false}
              aria-label={`更换「${node.title}」的图标`}
              aria-disabled={isBusy || undefined}
              className={`w-4 h-4 flex items-center justify-center rounded text-[12px] leading-none ${isBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-[var(--color-hover-bg)]'}`}
              onPointerDown={(e) => {
                e.stopPropagation()
              }}
              onMouseDown={(e) => {
                e.stopPropagation()
              }}
              onDragStart={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (isBusy) return
                const rect = e.currentTarget.getBoundingClientRect()
                onOpenIconPicker(node.id, rect.left, rect.bottom)
              }}
              onKeyDown={(e) => {
                if (!isBusy && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  onOpenIconPicker(node.id, rect.left, rect.bottom)
                }
              }}
            >
              {/* 自定义 emoji 保留；缺省改用语义图标：分支 / 单篇文档，颜色随选中态。 */}
              {node.icon ? <EmojiGlyph char={node.icon} size={12} /> : (
                hasChildren
                  ? <FolderTree className={isActive ? PANEL_LIST.iconActive : PANEL_LIST.icon} />
                  : <FileText className={isActive ? PANEL_LIST.iconActive : PANEL_LIST.icon} />
              )}
            </span>
          </span>
          <span
            data-document-title
            className={`block min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-[var(--color-text-primary)] ${isActive ? `${PANEL_LIST.rowTitleActive} font-medium` : ''}`}
            style={{
              color: node.color || undefined,
              fontSize: node.fontSize || undefined,
              fontWeight: node.fontWeight || undefined,
              fontStyle: node.fontStyle || undefined,
            }}
          >
            {node.title}
          </span>
          {/* 工具显隐只跟随鼠标 hover，与选中态 / 焦点态完全无关：选中项不再常驻，
              也不挂任何 focus 变体（点击 treeitem 后焦点会留在行上，focus-within
              同样会让按钮在鼠标离开后一直显示）。未 hover 时彻底不进入布局
              （不预留右侧宽度，标题用满整行），不能用 opacity-0 隐身 —— 元素仍在
              flex 流里，会一直挤压标题。
              h-4 锁死容器高度（按钮 20px 溢出到行的 py-1 内），避免 hover 时整列行高跳动。
              与关联文档列表共用 PanelListAction 的视觉语言。sticky 路径提示行不提供操作。 */}
          {!sticky && (
            <div
              data-tm-document-quick-actions=""
              data-tm-overlay="none"
              className="h-4 shrink-0 items-center gap-0.5 tm-fade-enter hidden group-hover:!flex"
            >
              <PanelListAction
                {...QUICK_ACTION_EVENTS}
                title="添加子文档"
                aria-label={`在「${node.title}」下添加子文档`}
                disabled={isBusy}
                onClick={(e) => {
                  e.stopPropagation()
                  onQuickCreate?.(node.id)
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </PanelListAction>
              <PanelListAction
                {...QUICK_ACTION_EVENTS}
                title="编辑样式"
                aria-label={`编辑「${node.title}」的样式`}
                disabled={isBusy}
                onClick={(e) => {
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  onQuickStyle?.(node.id, rect.left, rect.bottom)
                }}
              >
                <Palette className="h-3.5 w-3.5" />
              </PanelListAction>
              <PanelListAction
                {...QUICK_ACTION_EVENTS}
                title="删除"
                aria-label={`删除「${node.title}」`}
                disabled={isBusy}
                className="hover:!bg-[var(--color-danger-soft)] hover:!text-[var(--color-danger)]"
                onClick={(e) => {
                  e.stopPropagation()
                  onQuickDelete?.(node.id)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </PanelListAction>
            </div>
          )}
        </div>
      )}
      {renderChildren && isExpanded && visibleChildren.map(child => (
        <DocumentNode
          key={child.id}
          node={child}
          level={level + 1}
          activeDocumentPath={activeDocumentPath}
          childrenMap={childrenMap}
          expandedNodes={expandedNodes}
          inlineEdit={inlineEdit}
          inlineInputRef={inlineInputRef}
          isBusy={isBusy}
          draggedId={draggedId}
          dragState={dragState}
          onSelectDocument={onSelectDocument}
          onRenameDocument={onRenameDocument}
          onOpenIconPicker={onOpenIconPicker}
          onToggleExpand={onToggleExpand}
          onContextMenu={onContextMenu}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onInlineEditChange={onInlineEditChange}
          onInlineEditBlur={onInlineEditBlur}
          onInlineEditKeyDown={onInlineEditKeyDown}
          onRowElement={onRowElement}
          getChildRenderLimit={getChildRenderLimit}
          onShowMoreChildren={onShowMoreChildren}
          onQuickCreate={onQuickCreate}
          onQuickStyle={onQuickStyle}
          onQuickDelete={onQuickDelete}
        />
      ))}
      {renderChildren && isExpanded && hiddenChildCount > 0 && (
        <button
          type="button"
          className="mb-[2px] rounded-md py-1 pr-2.5 text-left text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)] transition-colors"
          style={{ paddingLeft: `${(level + 1) * 16 + 4}px` }}
          onClick={() => onShowMoreChildren?.(node.id)}
        >
          显示剩余 {hiddenChildCount} 项
        </button>
      )}
      {renderChildren && isExpanded && inlineEdit?.mode !== 'rename' && inlineEdit?.parentId === node.id && (
        <DocumentInlineEdit
          level={level + 1}
          inlineEdit={inlineEdit}
          inlineInputRef={inlineInputRef}
          isBusy={isBusy}
          onChange={onInlineEditChange}
          onBlur={onInlineEditBlur}
          onKeyDown={onInlineEditKeyDown}
        />
      )}
    </React.Fragment>
  )
}

// 递归渲染仍引用这个 memo 包装后的组件，子节点才能享受到同一套跳过逻辑。
export const DocumentNode = React.memo(DocumentNodeView, areDocumentNodePropsEqual)
