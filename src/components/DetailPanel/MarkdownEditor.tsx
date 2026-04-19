/**
 * Markdown 编辑器组件
 */
import { useEffect, useRef, useCallback } from 'react'
import styles from './DetailPanel.module.css'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  placeholder?: string
}

export default function MarkdownEditor({ value, onChange, onSave, placeholder }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Ctrl+S / Cmd+S 保存
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        onSave?.()
      }
    },
    [onSave]
  )

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.addEventListener('keydown', handleKeyDown)
    return () => ta.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <textarea
      ref={textareaRef}
      className={styles.mdEditorTextarea}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || '在此输入 Markdown 内容...'}
      spellCheck={false}
    />
  )
}
