import type { Store } from '../../core/storage'

const imageUrlPattern = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#]\S*)?$/i

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.onerror = () => reject(reader.error || new Error('读取附件失败'))
    reader.readAsDataURL(file)
  })
}

export function generateUniqueFileName(originalName: string): string {
  const uuid = crypto.randomUUID().split('-')[0]
  const lastDot = originalName.lastIndexOf('.')
  if (lastDot !== -1 && lastDot !== 0) {
    const name = originalName.substring(0, lastDot)
    const ext = originalName.substring(lastDot)
    return `${name}_${uuid}${ext}`
  }
  return `${originalName}_${uuid}`
}

export async function handleMarkdownPaste(options: {
  event: ClipboardEvent | React.ClipboardEvent
  value: string
  selectionStart: number
  selectionEnd: number
  attachmentCardPath: string
  storage: Store
}): Promise<{
  handled: boolean
  nextValue?: string
  nextCursor?: number
}> {
  const { event, value, selectionStart, selectionEnd, attachmentCardPath, storage } = options
  const clipboardData = 'clipboardData' in event ? event.clipboardData : null
  if (!clipboardData) return { handled: false }

  const files = Array.from(clipboardData.files || [])
  if (files.length > 0) {
    event.preventDefault()
    const snippets: string[] = []
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file)
        const fileName = generateUniqueFileName(file.name || 'attachment')
        const relPath = await storage.writeAttachmentBase64(attachmentCardPath, fileName, file.type, base64)
        snippets.push(`![${fileName}](${relPath})`)
      } else {
        // 如果是系统文件，通过路径导入（需要是 electron 环境）
        if ('path' in file && typeof (file as any).path === 'string' && window.electronAPI) {
          try {
            const fileName = generateUniqueFileName(file.name || 'attachment')
            const relPath = await storage.importAttachment(attachmentCardPath, (file as any).path, fileName)
            snippets.push(`[${fileName}](${relPath})`)
          } catch (e) {
            console.error('Failed to import file attachment:', e)
          }
        }
      }
    }
    // only handle if we actually generated snippets
    if (snippets.length > 0) {
      const textToInsert = snippets.join('\n')
      const nextValue = `${value.slice(0, selectionStart)}${textToInsert}${value.slice(selectionEnd)}`
      return { handled: true, nextValue, nextCursor: selectionStart + textToInsert.length }
    }
    // if no snippets were generated (e.g. unsupported file types), do not handle
    return { handled: false }
  }

  const text = clipboardData.getData('text/plain').trim()
  if (imageUrlPattern.test(text)) {
    event.preventDefault()
    try {
      const originalName = text.split(/[/\\]/).pop() || 'image'
      const targetFileName = generateUniqueFileName(originalName)
      const relPath = await storage.downloadAttachment(attachmentCardPath, text, targetFileName)
      const fileName = relPath.split('/').pop() || 'image'
      const textToInsert = `![${fileName}](${relPath})`
      const nextValue = `${value.slice(0, selectionStart)}${textToInsert}${value.slice(selectionEnd)}`
      return { handled: true, nextValue, nextCursor: selectionStart + textToInsert.length }
    } catch (e) {
      console.error('Failed to download image:', e)
      return { handled: false }
    }
  }

  return { handled: false }
}

export async function handleMarkdownDrop(options: {
  event: DragEvent | React.DragEvent
  value: string
  selectionStart: number
  selectionEnd: number
  attachmentCardPath: string
  storage: Store
}): Promise<{
  handled: boolean
  nextValue?: string
  nextCursor?: number
}> {
  const { event, value, selectionStart, selectionEnd, attachmentCardPath, storage } = options
  const dataTransfer = 'dataTransfer' in event ? event.dataTransfer : null
  if (!dataTransfer) return { handled: false }

  const files = Array.from(dataTransfer.files || [])
  if (files.length > 0) {
    event.preventDefault()
    const snippets: string[] = []
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file)
        const fileName = generateUniqueFileName(file.name || 'attachment')
        const relPath = await storage.writeAttachmentBase64(attachmentCardPath, fileName, file.type, base64)
        snippets.push(`![${fileName}](${relPath})`)
      } else {
        // 如果是系统文件，通过路径导入（需要是 electron 环境）
        if ('path' in file && typeof (file as any).path === 'string' && window.electronAPI) {
          try {
            const fileName = generateUniqueFileName(file.name || 'attachment')
            const relPath = await storage.importAttachment(attachmentCardPath, (file as any).path, fileName)
            snippets.push(`[${fileName}](${relPath})`)
          } catch (e) {
            console.error('Failed to import file attachment:', e)
          }
        }
      }
    }

    // only handle if we actually generated snippets
    if (snippets.length > 0) {
      const textToInsert = snippets.join('\n')
      const nextValue = `${value.slice(0, selectionStart)}${textToInsert}${value.slice(selectionEnd)}`
      return { handled: true, nextValue, nextCursor: selectionStart + textToInsert.length }
    }
    return { handled: false }
  }

  const text = dataTransfer.getData('text/plain').trim()
  if (imageUrlPattern.test(text)) {
    event.preventDefault()
    try {
      const originalName = text.split(/[/\\]/).pop() || 'image'
      const targetFileName = generateUniqueFileName(originalName)
      const relPath = await storage.downloadAttachment(attachmentCardPath, text, targetFileName)
      const fileName = relPath.split('/').pop() || 'image'
      const textToInsert = `![${fileName}](${relPath})`
      const nextValue = `${value.slice(0, selectionStart)}${textToInsert}${value.slice(selectionEnd)}`
      return { handled: true, nextValue, nextCursor: selectionStart + textToInsert.length }
    } catch (e) {
      console.error('Failed to download image:', e)
      return { handled: false }
    }
  }

  return { handled: false }
}