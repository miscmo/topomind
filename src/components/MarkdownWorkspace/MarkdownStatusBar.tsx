import { memo } from 'react'

interface MarkdownStatusBarProps {
  value: string
  savedValue: string
  isSaving: boolean
  saveError: string | null
}

export const MarkdownStatusBar = memo(function MarkdownStatusBar({
  value,
  savedValue,
  isSaving,
  saveError
}: MarkdownStatusBarProps) {
  const isDirty = value !== savedValue
  
  const getStatusText = () => {
    if (saveError) return `保存失败: ${saveError}`
    if (isSaving) return '保存中...'
    if (isDirty) return '未保存'
    return '已保存'
  }

  const getStatusColor = () => {
    if (saveError) return '#dc3545' // red
    if (isSaving) return '#0d6efd' // blue
    if (isDirty) return '#fd7e14' // orange
    return '#198754' // green
  }

  const wordCount = value.trim().split(/\s+/).filter(Boolean).length
  const charCount = value.length

  return (
    <div className="markdown-statusbar" style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '2px 8px',
      fontSize: '11px',
      color: '#6c757d',
      borderTop: '1px solid #eaeaea',
      backgroundColor: '#f8f9fa'
    }}>
      <div style={{ display: 'flex', gap: '16px' }}>
        <span>
          <span style={{ 
            display: 'inline-block', 
            width: '8px', 
            height: '8px', 
            borderRadius: '50%', 
            backgroundColor: getStatusColor(),
            marginRight: '4px'
          }} />
          {getStatusText()}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '16px' }}>
        <span>{charCount} 字符</span>
        <span>{wordCount} 词</span>
      </div>
    </div>
  )
})
