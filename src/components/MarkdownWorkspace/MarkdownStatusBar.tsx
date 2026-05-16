import { memo } from 'react'
import styles from './MarkdownWorkspace.module.css'

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
    if (saveError) return '#ef4444' // red
    if (isSaving) return '#3b82f6' // blue
    if (isDirty) return '#f59e0b' // orange
    return '#10b981' // green
  }

  const wordCount = value.trim().split(/\s+/).filter(Boolean).length
  const charCount = value.length

  return (
    <div className={styles.statusbar}>
      <div className={styles.statusLeft}>
        <span>
          <span 
            className={styles.statusIndicator}
            style={{ backgroundColor: getStatusColor() }} 
          />
          {getStatusText()}
        </span>
      </div>
      <div className={styles.statusRight}>
        <span>{charCount} 字符</span>
        <span>{wordCount} 词</span>
      </div>
    </div>
  )
})
