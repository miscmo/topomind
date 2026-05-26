import { isPlainStructuredDocumentContent, parseStructuredDocumentValue, serializeStructuredDocumentContent } from './structuredDocumentSerialization'

export type DocumentContentValue = unknown

export function getDocumentContentLength(value: DocumentContentValue): number {
  return serializeStructuredDocumentContent(value).length
}

export function areDocumentContentsEqual(left: DocumentContentValue, right: DocumentContentValue): boolean {
  return serializeStructuredDocumentContent(canonicalizeDocumentContent(left)) === serializeStructuredDocumentContent(canonicalizeDocumentContent(right))
}

export function prepareStructuredDocumentContentForSave(value: DocumentContentValue): Record<string, unknown> {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw new Error('文档内容为空，为防止覆盖，已终止保存')
  }

  const parsedContent = parseStructuredDocumentValue(value)
  if (!isPlainStructuredDocumentContent(parsedContent)) {
    throw new Error('文档内容不是有效的对象格式，为防止覆盖，已终止保存')
  }

  return parsedContent
}

function canonicalizeDocumentContent(value: DocumentContentValue): DocumentContentValue {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}
