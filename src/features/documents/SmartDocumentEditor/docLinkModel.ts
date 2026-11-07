/**
 * 文档双链的纯数据规则（渲染层）。
 *
 * 主进程 document-id-service.js 用同样的 DOC_LINK_INLINE_TYPE 扫描正文做反向链接，
 * 两处必须是同一个字符串；回归脚本会真跑并比对，避免「渲染叫 docLink、扫描查 docRef」
 * 这类静默失效。这里不放 React / DOM 依赖，方便回归脚本用 esbuild 打包后在 Node 里真跑。
 */

/** 行内引用 spec 的 type，同时是正文 JSON 里的节点 type。 */
export const DOC_LINK_INLINE_TYPE = 'docLink'

/** `[[` 触发器：只认「刚输入的 [ 且前一个字符也是 [」，避免误伤普通方括号。 */
export const DOC_LINK_TRIGGER_PATTERN = /\[\[$/

export interface DocumentLinkProps {
  docId: string
  title: string
}

export interface DocumentLinkInlineContent {
  type: typeof DOC_LINK_INLINE_TYPE
  props: DocumentLinkProps
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function isDocumentLinkInlineContent(value: unknown): value is DocumentLinkInlineContent {
  if (!isRecord(value) || value.type !== DOC_LINK_INLINE_TYPE) return false
  const props = value.props
  return isRecord(props) && typeof props.docId === 'string' && typeof props.title === 'string'
}

export function normalizeDocumentLinkTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  return (title || '未命名文档').slice(0, 200)
}

/** 给结构化正文构造一条行内引用；只写稳定 docId，标题只是显示快照。 */
export function createDocumentLinkInlineContent(docId: string, title: unknown): DocumentLinkInlineContent {
  return {
    type: DOC_LINK_INLINE_TYPE,
    props: {
      docId: String(docId || '').trim(),
      title: normalizeDocumentLinkTitle(title),
    },
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 复制 / 粘贴用的外部 HTML。属性名必须与 BlockNote 的 addAttributes 序列化一致：
 * propSchema 的 docId / title 会写成 data-doc-id / data-title。
 * mathPaste.ts 的 DOMPurify 白名单必须放行这三个 data-* 属性，否则粘贴后引用会退化成纯文本。
 */
export function createDocumentLinkHtml(docId: string, title: unknown): string {
  const safeTitle = normalizeDocumentLinkTitle(title)
  return `<span data-inline-content-type="${DOC_LINK_INLINE_TYPE}" data-doc-id="${escapeHtml(String(docId || '').trim())}" data-title="${escapeHtml(safeTitle)}">${escapeHtml(safeTitle)}</span>`
}
