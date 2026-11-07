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
 * 折叠时同一条容器把高度从 36px 收到 24px（morph），控件层只做显隐过渡而不卸载——
 * 滑杆的本地草稿与拖动预览状态不会因折叠丢失。
 * 内容区自己横向滚动（窄右栏时），根容器 overflow-hidden 才能在收起时裁掉控件，
 * 也正因如此样式浮层必须 portal 到 body。
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
      className="tm-editor-top-toolbar flex shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--color-border-light)] bg-[var(--color-surface)] px-3 text-[12px] text-[var(--color-text-secondary)] box-border"
      style={{ height: collapsed ? 24 : 36 }}
    >
      <div
        className="tm-editor-top-toolbar__content flex min-w-0 flex-1 items-center gap-3 overflow-x-auto"
        aria-hidden={collapsed || undefined}
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
        className="tm-editor-top-toolbar__toggle flex h-5 w-6 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-[var(--color-text-muted)] cursor-pointer transition-colors hover:bg-[var(--color-hover-bg)] hover:text-[var(--color-accent)]"
      >
        {collapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
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
