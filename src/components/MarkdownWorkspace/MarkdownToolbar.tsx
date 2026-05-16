import { memo } from 'react'
import type { EditorView } from '@codemirror/view'
import {
  toggleBold,
  toggleItalic,
  insertHeading,
  insertLink,
  insertImage,
  insertCodeBlock,
  insertMermaidBlock,
  insertTable,
  insertTaskList
} from './markdownCommands'
import type { MarkdownViewMode } from './markdownTypes'
import styles from './MarkdownWorkspace.module.css'

interface MarkdownToolbarProps {
  view: EditorView | null
  viewMode: MarkdownViewMode
  onViewModeChange: (mode: MarkdownViewMode) => void
  onSave?: () => void
  isSaving?: boolean
}

export const MarkdownToolbar = memo(function MarkdownToolbar({ 
  view, 
  viewMode, 
  onViewModeChange,
  onSave,
  isSaving 
}: MarkdownToolbarProps) {
  
  const handleCommand = (cmd: (v: EditorView) => void) => {
    if (view) {
      if (viewMode === 'preview') {
        onViewModeChange('edit')
      }
      cmd(view)
    }
  }

  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarGroup}>
        <button type="button" className={styles.iconButton} title="粗体" onClick={() => handleCommand(toggleBold)}><b>B</b></button>
        <button type="button" className={styles.iconButton} title="斜体" onClick={() => handleCommand(toggleItalic)}><i>I</i></button>
        <div className={styles.divider} />
        <button type="button" className={styles.iconButton} title="标题" onClick={() => handleCommand(v => insertHeading(v, 2))}>H</button>
        <button type="button" className={styles.iconButton} title="任务" onClick={() => handleCommand(insertTaskList)}>☑</button>
        <div className={styles.divider} />
        <button type="button" className={styles.iconButton} title="链接" onClick={() => handleCommand(insertLink)}>🔗</button>
        <button type="button" className={styles.iconButton} title="图片" onClick={() => handleCommand(insertImage)}>🖼</button>
        <button type="button" className={styles.iconButton} title="表格" onClick={() => handleCommand(insertTable)}>⊞</button>
        <div className={styles.divider} />
        <button type="button" className={styles.iconButton} title="代码块" onClick={() => handleCommand(v => insertCodeBlock(v))}>{'<>'}</button>
        <button type="button" className={styles.iconButton} title="Mermaid 图表" onClick={() => handleCommand(insertMermaidBlock)}>M</button>
      </div>

      <div className={styles.rightGroup}>
        <div className={styles.segmentControl}>
          <button 
            type="button"
            className={`${styles.segmentButton} ${viewMode === 'edit' ? styles.active : ''}`}
            onClick={() => onViewModeChange('edit')}
          >
            编辑
          </button>
          <button 
            type="button"
            className={`${styles.segmentButton} ${viewMode === 'preview' ? styles.active : ''}`}
            onClick={() => onViewModeChange('preview')}
          >
            预览
          </button>
        </div>
      </div>
    </div>
  )
})
