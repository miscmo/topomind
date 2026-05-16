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
        onViewModeChange('split')
      }
      cmd(view)
    }
  }

  return (
    <div className="markdown-toolbar" style={{ 
      display: 'flex', 
      alignItems: 'center', 
      padding: '4px 8px',
      borderBottom: '1px solid #eaeaea',
      backgroundColor: '#f8f9fa',
      gap: '4px',
      flexWrap: 'wrap'
    }}>
      <div style={{ display: 'flex', gap: '2px', marginRight: 'auto' }}>
        <button title="粗体" onClick={() => handleCommand(toggleBold)}><b>B</b></button>
        <button title="斜体" onClick={() => handleCommand(toggleItalic)}><i>I</i></button>
        <div style={{ width: '1px', backgroundColor: '#ddd', margin: '0 4px' }} />
        <button title="标题" onClick={() => handleCommand(v => insertHeading(v, 2))}>H</button>
        <button title="任务" onClick={() => handleCommand(insertTaskList)}>☑</button>
        <div style={{ width: '1px', backgroundColor: '#ddd', margin: '0 4px' }} />
        <button title="链接" onClick={() => handleCommand(insertLink)}>🔗</button>
        <button title="图片" onClick={() => handleCommand(insertImage)}>🖼</button>
        <button title="表格" onClick={() => handleCommand(insertTable)}>⊞</button>
        <div style={{ width: '1px', backgroundColor: '#ddd', margin: '0 4px' }} />
        <button title="代码块" onClick={() => handleCommand(v => insertCodeBlock(v))}>{'<>'}</button>
        <button title="Mermaid 图表" onClick={() => handleCommand(insertMermaidBlock)}>M</button>
      </div>

      <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
        {onSave && (
          <button 
            onClick={onSave} 
            disabled={isSaving}
            style={{ marginRight: '8px' }}
          >
            {isSaving ? '保存中...' : '💾 保存'}
          </button>
        )}
        <select 
          value={viewMode} 
          onChange={(e) => onViewModeChange(e.target.value as MarkdownViewMode)}
          style={{ padding: '2px 4px', fontSize: '12px' }}
        >
          <option value="edit">编辑</option>
          <option value="split">分屏</option>
          <option value="preview">预览</option>
        </select>
      </div>
    </div>
  )
})
