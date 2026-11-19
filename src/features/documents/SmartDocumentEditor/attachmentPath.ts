/**
 * 附件引用路径的规范工具（单一真源）。
 *
 * 文档中真正持久化的是相对引用 `attachmentRef`（形如 `_attach/foo.png`），
 * `url` 在落盘时会被删除。运行时 image 块的 `url` 仍是该相对引用（由
 * BlockNote 的 resolveFileUrl 解析成 local-file:// 显示），file 块则是
 * `local-file://` 绝对地址。这里统一把各种形态收敛成规范引用。
 */

export function normalizeAttachmentRef(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
  return normalized.startsWith('_attach/') ? normalized : `_attach/${normalized.split('/').pop() || normalized}`
}

export function getAttachmentFileNameFromRef(value: string): string {
  const normalized = normalizeAttachmentRef(value)
  return normalized.split('/').pop() || normalized
}

function extractAttachmentFileNameFromUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const withoutQuery = trimmed.split('#')[0]?.split('?')[0] || ''
  const normalized = withoutQuery.replace(/^local-file:\/\//i, '').replace(/^file:\/\//i, '')
  const rawName = normalized.split(/[/\\]/).pop() || ''
  if (!rawName) return null
  try {
    return decodeURIComponent(rawName)
  } catch {
    return rawName
  }
}

export function canDeriveAttachmentRefFromUrl(value: string): boolean {
  const trimmed = value.trim()
  return /^local-file:\/\//i.test(trimmed)
    || /^file:\/\//i.test(trimmed)
    || /^\.?\/?_attach[\\/]/i.test(trimmed)
}

/**
 * 从块 props 抽取规范引用。优先级：attachmentRef > 可解析的 url > 已知附件名。
 * `knownAttachmentNames` 只在编辑器上下文里可得；展示场景可传 `new Set([props.name])`
 * 来兼容仅有 name 的旧块。
 */
export function getAttachmentRefFromBlockProps(
  props: Record<string, unknown>,
  knownAttachmentNames: Set<string>
): string | null {
  if (typeof props.attachmentRef === 'string' && props.attachmentRef.trim()) {
    return normalizeAttachmentRef(props.attachmentRef)
  }
  if (typeof props.url === 'string') {
    if (!canDeriveAttachmentRefFromUrl(props.url)) return null
    const fileName = extractAttachmentFileNameFromUrl(props.url)
    if (fileName) {
      return normalizeAttachmentRef(fileName)
    }
  }
  if (typeof props.name === 'string' && knownAttachmentNames.has(props.name)) {
    return normalizeAttachmentRef(props.name)
  }
  return null
}
