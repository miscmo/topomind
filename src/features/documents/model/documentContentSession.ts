import { isPlainStructuredDocumentContent, serializeStructuredDocumentContent } from '../services/structuredDocumentSerialization.ts'

export type DocumentContentValue = unknown

const comparableDocumentContentCache = new WeakMap<object, string>()

export function getDocumentContentLength(value: DocumentContentValue): number {
  if (value && typeof value === 'object') {
    return getComparableDocumentContent(value).length
  }
  return serializeStructuredDocumentContent(value).length
}

export function areDocumentContentsEqual(left: DocumentContentValue, right: DocumentContentValue): boolean {
  if (left === right) return true
  return getComparableDocumentContent(left) === getComparableDocumentContent(right)
}

export function prepareStructuredDocumentContentForSave(value: DocumentContentValue): Record<string, unknown> | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null
  }

  let parsedContent: unknown = value
  if (typeof value === 'string') {
    try {
      parsedContent = JSON.parse(value.trim())
    } catch (error) {
      throw new Error(`文档内容不是有效的 JSON 格式，为防止覆盖，已终止保存: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
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

function getComparableDocumentContent(value: DocumentContentValue): string {
  if (value && typeof value === 'object') {
    const cached = comparableDocumentContentCache.get(value as object)
    if (cached !== undefined) return cached
    const comparable = serializeStructuredDocumentContent(canonicalizeDocumentContent(value))
    comparableDocumentContentCache.set(value as object, comparable)
    return comparable
  }
  return serializeStructuredDocumentContent(canonicalizeDocumentContent(value))
}
