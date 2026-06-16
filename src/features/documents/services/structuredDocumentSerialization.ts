export function serializeStructuredDocumentContent(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function parseStructuredDocumentDraft(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed)
  } catch (e) {
    return {}
  }
}

export function parseStructuredDocumentValue(value: unknown): unknown {
  if (typeof value === 'string') return parseStructuredDocumentDraft(value)
  return value
}

export function isPlainStructuredDocumentContent(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
