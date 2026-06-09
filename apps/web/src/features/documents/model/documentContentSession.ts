import { isPlainStructuredDocumentContent, parseStructuredDocumentValue, serializeStructuredDocumentContent } from '../services/structuredDocumentSerialization'

export type DocumentContentValue = unknown

export function getDocumentContentLength(value: DocumentContentValue): number {
  return serializeStructuredDocumentContent(value).length
}

export function areDocumentContentsEqual(left: DocumentContentValue, right: DocumentContentValue): boolean {
  return serializeStructuredDocumentContent(normalizeDocumentContentForComparison(canonicalizeDocumentContent(left)))
    === serializeStructuredDocumentContent(normalizeDocumentContentForComparison(canonicalizeDocumentContent(right)))
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
  const normalized = parseDocumentContent(value)
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return normalized
  }

  const record = normalized as Record<string, unknown>
  if (Array.isArray(record.blocks)) {
    // Smart documents add runtime-only fields like schema/title/version/metadata
    // around the persisted blocks payload. Ignore those wrappers when comparing
    // editor draft vs saved content so opening a document does not look dirty.
    return {
      blocks: record.blocks,
    }
  }

  const metadata = record.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !('updatedAt' in metadata)) {
    return normalized
  }

  const nextMetadata = { ...(metadata as Record<string, unknown>) }
  delete nextMetadata.updatedAt
  return {
    ...record,
    metadata: nextMetadata,
  }
}

function normalizeDocumentContentForComparison(value: DocumentContentValue): DocumentContentValue {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDocumentContentForComparison(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  const sortedEntries = Object.keys(record)
    .sort()
    .map((key) => [key, normalizeDocumentContentForComparison(record[key])])

  return Object.fromEntries(sortedEntries)
}

function parseDocumentContent(value: DocumentContentValue): DocumentContentValue {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}
