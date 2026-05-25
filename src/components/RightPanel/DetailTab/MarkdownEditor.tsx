/**
 * Markdown 编辑器组件
 */
import { memo, useEffect, useRef, useCallback } from 'react'
import { useStorage } from '../../../core/storage'
import { useGraphUiStore } from '../../../stores/graphUiStore'
import { logAction } from '../../../core/log-backend'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  placeholder?: string
  attachmentCardPath?: string | null
}

const imageUrlPattern = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#]\S*)?$/i

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function insertText(textarea: HTMLTextAreaElement, value: string, text: string, onChange: (value: string) => void) {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`
  onChange(nextValue)
  window.setTimeout(() => {
    textarea.focus()
    const cursor = start + text.length
    textarea.setSelectionRange(cursor, cursor)
  }, 0)
}

export default memo(function MarkdownEditor({ value, onChange, onSave, placeholder, attachmentCardPath }: MarkdownEditorProps) {
  const storage = useStorage()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const defaultEditorStyle = useGraphUiStore((s) => s.defaultEditorStyle)

  // Ctrl+S / Cmd+S 保存
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        onSave?.()
      }
    },
    [onSave]
  )

  const handlePaste = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!attachmentCardPath) return
    const textarea = textareaRef.current
    if (!textarea) return

    const files = Array.from(event.clipboardData.files)
    if (files.length > 0) {
      event.preventDefault()
      const snippets: string[] = []
      for (const file of files) {
        const base64 = await fileToBase64(file)
        const fileName = file.name || 'attachment'
        const relPath = await storage.writeAttachmentBase64(attachmentCardPath, fileName, file.type, base64)
        snippets.push(file.type.startsWith('image/') ? `![${fileName}](${relPath})` : `[${fileName}](${relPath})`)
      }
      insertText(textarea, value, snippets.join('\n'), onChange)
      logAction('Markdown:粘贴文件', 'MarkdownEditor', { count: files.length })
      return
    }

    const text = event.clipboardData.getData('text/plain').trim()
    if (!imageUrlPattern.test(text)) return

    event.preventDefault()
    const relPath = await storage.downloadAttachment(attachmentCardPath, text)
    const fileName = relPath.split('/').pop() || 'image'
    insertText(textarea, value, `![${fileName}](${relPath})`, onChange)
    logAction('Markdown:粘贴网络图片并下载', 'MarkdownEditor', { url: text })
  }, [attachmentCardPath, onChange, storage, value])

  return (
    <textarea
      id="node-description"
      ref={textareaRef}
      className="w-full h-full border-none outline-none resize-none px-5 pt-3 pb-10 box-border focus:outline-none"
      style={{
        fontSize: `${defaultEditorStyle.fontSize}px`,
        fontFamily: defaultEditorStyle.fontFamily === 'inherit' ? '"SF Mono", "Fira Code", Consolas, monospace' : defaultEditorStyle.fontFamily,
        color: defaultEditorStyle.textColor,
        lineHeight: defaultEditorStyle.lineHeight,
        backgroundColor: defaultEditorStyle.backgroundColor || 'var(--color-bg)',
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      placeholder={placeholder || '在此输入 Markdown 内容...'}
      spellCheck={false}
    />
  )
})
