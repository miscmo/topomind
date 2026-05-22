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
    if (saveError) return '#ef4444' // red
    if (isSaving) return '#3b82f6' // blue
    if (isDirty) return '#f59e0b' // orange
    return '#10b981' // green
  }

  const safeValue = value || ''
  const wordCount = safeValue.trim().split(/\s+/).filter(Boolean).length
  const charCount = safeValue.length

  return (
    <div className="flex justify-between items-center py-1.5 px-3 text-[11px] text-[#64748b] !text-[var(--color-text-muted)] border-t border-[#e2e8f0] !border-[var(--color-border)] bg-white/92 !bg-[color-mix(in_srgb,var(--color-bg)_92%,transparent)]">
      <div className="flex gap-4 items-center">
        <span>
          <span 
            className="inline-block w-2 h-2 rounded-full mr-1.5"
            style={{ backgroundColor: getStatusColor() }} 
          />
          {getStatusText()}
        </span>
      </div>
      <div className="flex gap-4 items-center">
        <span>{charCount} 字符</span>
        <span>{wordCount} 词</span>
      </div>
    </div>
  )
})
