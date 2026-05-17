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
      const base64 = await fileToBase64(file)
      const fileName = file.name || 'attachment'
      const relPath = await storage.writeAttachmentBase64(attachmentCardPath, fileName, file.type, base64)
      snippets.push(file.type.startsWith('image/') ? `![${fileName}](${relPath})` : `[${fileName}](${relPath})`)
    }
    const textToInsert = snippets.join('\n')
    const nextValue = `${value.slice(0, selectionStart)}${textToInsert}${value.slice(selectionEnd)}`
    return { handled: true, nextValue, nextCursor: selectionStart + textToInsert.length }
  }

  const text = clipboardData.getData('text/plain').trim()
  if (imageUrlPattern.test(text)) {
    event.preventDefault()
    try {
      const relPath = await storage.downloadAttachment(attachmentCardPath, text)
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
      const base64 = await fileToBase64(file)
      const fileName = file.name || 'attachment'
      const relPath = await storage.writeAttachmentBase64(attachmentCardPath, fileName, file.type, base64)
      snippets.push(file.type.startsWith('image/') ? `![${fileName}](${relPath})` : `[${fileName}](${relPath})`)
    }
    const textToInsert = snippets.join('\n')
    const nextValue = `${value.slice(0, selectionStart)}${textToInsert}${value.slice(selectionEnd)}`
    return { handled: true, nextValue, nextCursor: selectionStart + textToInsert.length }
  }

  const text = dataTransfer.getData('text/plain').trim()
  if (imageUrlPattern.test(text)) {
    event.preventDefault()
    try {
      const relPath = await storage.downloadAttachment(attachmentCardPath, text)
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