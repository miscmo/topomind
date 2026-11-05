import type { HeadingNumberingConfig } from '../headingNumbering'
import type { EditorLayout } from '../editorLayout'
import { HeadingNumberingToolbar } from './HeadingNumberingToolbar'
import { ContentLayoutControls } from './ContentLayoutControls'

interface EditorTopToolbarProps {
  numbering: HeadingNumberingConfig
  onNumberingChange: (patch: Partial<HeadingNumberingConfig>) => void
  layout: EditorLayout
  onLayoutPreview: (layout: EditorLayout) => void
  onLayoutCommit: (layout: EditorLayout) => void
  disabled?: boolean
}

/**
 * 编辑器顶部工具栏（单行）：左＝标题编号（文档级配置），右＝内容最大宽度 / 左右留白（全局配置）。
 * 右栏很窄时允许横向滚动，滚动条隐藏以免影响 36px 行高（样式见 SmartDocumentEditor.css）。
 */
export function EditorTopToolbar({
  numbering,
  onNumberingChange,
  layout,
  onLayoutPreview,
  onLayoutCommit,
  disabled = false,
}: EditorTopToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="编辑器顶部设置"
      className="tm-editor-top-toolbar flex h-9 shrink-0 items-center gap-3 overflow-x-auto border-b border-[var(--color-border-light)] bg-[var(--color-surface)] px-3 text-[12px] text-[var(--color-text-secondary)] box-border"
    >
      <HeadingNumberingToolbar config={numbering} onChange={onNumberingChange} disabled={disabled} />
      <ContentLayoutControls
        layout={layout}
        onPreview={onLayoutPreview}
        onCommit={onLayoutCommit}
        disabled={disabled}
      />
    </div>
  )
}
