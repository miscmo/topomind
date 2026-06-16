import { isPlainStructuredDocumentContent, parseStructuredDocumentValue, serializeStructuredDocumentContent } from '../services/structuredDocumentSerialization'

export type DocumentContentValue = unknown

export function getDocumentContentLength(value: DocumentContentValue): number {
  return serializeStructuredDocumentContent(value).length
}

export function areDocumentContentsEqual(left: DocumentContentValue, right: DocumentContentValue): boolean {
  return serializeStructuredDocumentContent(canonicalizeDocumentContent(left)) === serializeStructuredDocumentContent(canonicalizeDocumentContent(right))
}

export function prepareStructuredDocumentContentForSave(value: DocumentContentValue): Record<string, unknown> | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null
  }

  const parsedContent = parseStructuredDocumentValue(value)
  if (!isPlainStructuredDocumentContent(parsedContent)) {
    throw new Error('文档内容不是有效的对象格式，为防止覆盖，已终止保存')
  }

  return parsedContent
}

function canonicalizeDocumentContent(value: DocumentContentValue): DocumentContentValue {
  if (typeof value !== 'string') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const cloned = { ...value } as Record<string, unknown>
      if (cloned.metadata && typeof cloned.metadata === 'object') {
        const meta = { ...(cloned.metadata as Record<string, unknown>) }
        delete meta.updatedAt
        delete meta.createdAt
        cloned.metadata = meta
      }
      return cloned
    }
    return value
  }
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (parsed.metadata && typeof parsed.metadata === 'object') {
        delete parsed.metadata.updatedAt
        delete parsed.metadata.createdAt
      }
    }
    return parsed
  } catch {
    return value
  }
}
