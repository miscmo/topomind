import { memo } from 'react'
import type { DefaultEditorStyle } from '../../../../domain/style/styleTypes'
import { EditorStylePreview } from './StylePreviews'

interface EditorStylePanelProps {
  defaultEditorStyle: DefaultEditorStyle
}

/**
 * 编辑器样式设置已全部迁到编辑器顶部工具栏的「样式」浮层。
 * 这里只保留效果预览 + 一句指引，避免同一项配置在两处重复修改、互相覆盖。
 */
export const EditorStylePanel = memo(function EditorStylePanel({
  defaultEditorStyle,
}: EditorStylePanelProps) {
  return (
    <div className="flex flex-col gap-4 max-w-[380px] mx-auto w-full mb-4">
      <EditorStylePreview style={defaultEditorStyle} />
      <div
        data-tm-editor-style-migrated-hint=""
        className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-4 text-[12px] leading-[1.6] text-[var(--color-text-secondary)] shadow-[var(--shadow-sm)]"
      >
        <div className="mb-2 text-[13px] font-semibold text-[var(--color-text-primary)]">样式设置已移到编辑器顶部工具栏</div>
        <p className="m-0 mb-2">
          点击文档编辑器顶部工具栏右侧的「样式」按钮，即可调整字体、行高、间距、颜色、纸张与风格预设；内容最大宽度与左右留白仍在工具栏的「版面」里。
        </p>
        <p className="m-0 text-[var(--color-text-muted)]">此处仅保留效果预览，避免同一项设置在两处重复修改。</p>
      </div>
    </div>
  )
})
