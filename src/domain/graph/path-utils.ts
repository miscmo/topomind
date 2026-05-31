export function normalizeRef(ref: string | null | undefined): string {
  return String(ref ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
}

export function joinRefs(...parts: Array<string | null | undefined>): string {
  return normalizeRef(parts.map((part) => normalizeRef(part)).filter(Boolean).join('/'))
}

export function resolveRoomChildRef(roomRef: string | null | undefined, childRef: string | null | undefined): string {
  const normalizedRoom = normalizeRef(roomRef)
  const normalizedChild = normalizeRef(childRef)
  if (!normalizedChild) return ''
  if (!normalizedRoom) return normalizedChild
  if (normalizedChild === normalizedRoom || normalizedChild.startsWith(`${normalizedRoom}/`)) {
    return normalizedChild
  }
  return joinRefs(normalizedRoom, normalizedChild)
}

export function basenameRef(ref: string | null | undefined): string {
  const normalized = normalizeRef(ref)
  if (!normalized) return ''
  const parts = normalized.split('/')
  return parts[parts.length - 1] ?? ''
}

