import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronUp, Palette } from 'lucide-react'
import type { DefaultEditorStyle } from '../../../../domain/style/styleTypes'
import type { HeadingNumberingConfig } from '../headingNumbering'
import type { EditorLayout } from '../editorLayout'
import { HeadingNumberingToolbar } from './HeadingNumberingToolbar'
import { ContentLayoutControls } from './ContentLayoutControls'
import { EditorStylePopover } from './EditorStylePopover'

interface EditorTopToolbarProps {
  numbering: HeadingNumberingConfig
  onNumberingChange: (patch: Partial<HeadingNumberingConfig>) => void
  layout: EditorLayout
  onLayoutPreview: (layout: EditorLayout) => void
  onLayoutCommit: (layout: EditorLayout) => void
  /** 全局编辑器样式（右栏「文档编辑器」分区的设置已迁到本工具栏的样式浮层） */
  editorStyle: DefaultEditorStyle
  onStyleChange: (patch: Partial<DefaultEditorStyle>) => void
  disabled?: boolean
}

/**
 * 折叠态是纯 UI 偏好，按工作区全局记一份（与目录固定、侧栏宽度同一套约定）。
 * 模块级订阅让同窗口内的多个编辑器实例（右栏 / 独立窗口）保持一致；
 * storage 事件补上跨窗口同步。纯 Node 回归脚本加载本模块时 localStorage 不存在，
 * 读初值走 try/catch + typeof 守卫，不会炸。
 */
const COLLAPSED_KEY = 'topomind_editor_top_toolbar_collapsed'
const listeners = new Set<() => void>()
let collapsedState = readCollapsed()

function readCollapsed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getCollapsedSnapshot(): boolean {
  return collapsedState
}

function setCollapsed(next: boolean): void {
  if (collapsedState === next) return
  collapsedState = next
  try {
    localStorage.setItem(COLLAPSED_KEY, String(next))
  } catch { /* 隐私模式下写盘失败不影响本次切换 */ }
  listeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== COLLAPSED_KEY) return
    const next = event.newValue === 'true'
    if (next === collapsedState) return
    collapsedState = next
    listeners.forEach((listener) => listener())
  })
}

/**
 * 编辑器顶部工具栏：左＝标题编号（文档级配置），右＝内容最大宽度 / 左右留白（全局配置），
 * 「样式」按钮＝编辑器全部外观设置的入口（portal 浮层），最右侧＝折叠/展开按钮。
 * 展开：36px 一整条（控件 + 样式 + 折叠按钮）。
 * 折叠：整条高度收到 0、不留任何控件条，只留一个展开按钮绝对定位贴住顶部边界
 * （紧贴上方标题栏的分界线），把全部垂直空间让给正文。
 * 内容区自己横向滚动（窄右栏时），展开态根容器 overflow-hidden 才能裁掉控件，
 * 也正因如此样式浮层必须 portal 到 body；折叠态改 overflow-visible 让贴边按钮不被裁。
 */
export function EditorTopToolbar({
  numbering,
  onNumberingChange,
  layout,
  onLayoutPreview,
  onLayoutCommit,
  editorStyle,
  onStyleChange,
  disabled = false,
}: EditorTopToolbarProps) {
  const collapsed = useSyncExternalStore(subscribe, getCollapsedSnapshot, () => false)
  const styleTriggerRef = useRef<HTMLButtonElement>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const [styleRect, setStyleRect] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null)

  const closeStylePopover = useCallback(() => setStyleOpen(false), [])
  const toggleStylePopover = useCallback(() => {
    if (styleOpen) {
      setStyleOpen(false)
      return
    }
    const rect = styleTriggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setStyleRect({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })
    setStyleOpen(true)
  }, [styleOpen])

  // 折叠会改变按钮位置，先关浮层，避免它停在旧坐标上。
  const handleToggleCollapsed = useCallback(() => {
    setStyleOpen(false)
    setCollapsed(!collapsedState)
  }, [])

  return (
    <div
      role="toolbar"
      aria-label="编辑器顶部设置"
      data-tm-editor-top-toolbar=""
      data-collapsed={collapsed ? 'true' : 'false'}
      className="tm-editor-top-toolbar relative flex shrink-0 items-center gap-2 border-b border-[var(--color-border-light)] bg-[var(--color-surface)] px-3 text-[12px] text-[var(--color-text-secondary)] box-border"
      style={{ height: collapsed ? 0 : 36, overflow: collapsed ? 'visible' : 'hidden' }}
    >
      <div
        className="tm-editor-top-toolbar__content flex min-w-0 flex-1 items-center gap-3 overflow-x-auto"
        aria-hidden={collapsed || undefined}
        style={collapsed ? { display: 'none' } : undefined}
      >
        <HeadingNumberingToolbar config={numbering} onChange={onNumberingChange} disabled={disabled} />
        <ContentLayoutControls
          layout={layout}
          onPreview={onLayoutPreview}
          onCommit={onLayoutCommit}
          disabled={disabled}
        />
      </div>
      <button
        type="button"
        ref={styleTriggerRef}
        data-tm-editor-style-trigger=""
        aria-expanded={styleOpen}
        aria-label="编辑器样式设置"
        title="编辑器样式设置"
        onClick={toggleStylePopover}
        className="tm-editor-top-toolbar__style-trigger flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-md border-none bg-transparent px-1.5 text-[11px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)]"
        style={collapsed ? { display: 'none' } : undefined}
      >
        <Palette size={13} aria-hidden="true" />
        样式
      </button>
      <button
        type="button"
        data-tm-editor-top-toolbar-toggle=""
        aria-expanded={!collapsed}
        aria-label={collapsed ? '展开顶部工具栏' : '收起顶部工具栏'}
        title={collapsed ? '展开顶部工具栏' : '收起顶部工具栏'}
        onClick={handleToggleCollapsed}
        className="tm-editor-top-toolbar__toggle flex h-[24px] w-[28px] shrink-0 items-center justify-center rounded-md border border-[var(--color-border-light)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] cursor-pointer shadow-sm transition-colors hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] z-50"
        style={collapsed ? { position: 'absolute', top: -12, right: 24 } : undefined}
      >
        {collapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
      </button>
      {styleOpen && styleRect && (
        <EditorStylePopover
          rect={styleRect}
          editorStyle={editorStyle}
          onChange={onStyleChange}
          onClose={closeStylePopover}
        />
      )}
    </div>
  )
}
