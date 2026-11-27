/**
 * AI 回答的轻量 Markdown 渲染（P0 修复；P3 增加 [ref:i] 引用按钮）。
 *
 * 为什么不用 marked / react-markdown：marked 只是 mermaid 的传递依赖，不作为
 * 直接依赖使用；而回答来自远端模型，绝不走 dangerouslySetInnerHTML。这里用
 * 纯 React 元素输出，天然转义，覆盖会话常见语法即可：
 * 标题 / 粗体 / 斜体 / 行内代码 / 围栏代码块 / 有序无序列表 / 引用 / 链接 /
 * 分隔线 / GFM 管道表格（含 `:---` / `---:` / `:---:` 对齐）。
 *
 * 流式输出时语法可能尚未闭合（例如只收到一个 `**`），未匹配的标记原样保留，
 * 等后续 token 补齐后自然解析成对应样式。表格同理：分隔行没吐完前保持纯文本，
 * 补齐后整块变成表格，后续行随 token 增长，视觉值只用设计 token 与标准布局类。
 *
 * P3 / P5-r：[ref:i] 只有在本轮 kb.ask 真的返回过该编号时才渲染成可点按钮
 * （引用映射只存在 agentSessionStore 内存）；未命中 / 模型伪造的编号保持纯文本，
 * 不做死链。命中时按钮直接显示**文档名 + 编号**，回答末尾再附「参考来源」清单
 * 展开文档 / 节点 / 块三层可读名字，用户不必猜 [ref:1] 指的是什么。
 */
import type { ReactNode } from 'react'
import type { AiReference } from '@/core/ai-types'
import { TM_UI, tmUI } from '@/shared/ui/controlStyles'
import { parseReferenceToken } from './model/contextBuilder'

const HEADING_RE = /^(#{1,6})\s+(.+)$/
const UL_RE = /^[-*+]\s+(.+)$/
const OL_RE = /^\d+[.)]\s+(.+)$/
const QUOTE_RE = /^>\s?(.*)$/
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/
const FENCE_OPEN_RE = /^```[\w-]*\s*$/
const FENCE_CLOSE_RE = /^```\s*$/
const LINK_RE = /^\[([^\]]+)\]\(([^)\s]+)\)$/
const SAFE_URL_RE = /^https?:\/\/\S+$/i
// GFM 分隔行的单个单元格：至少一根短横线，两端冒号表示左 / 右对齐。
const TABLE_DELIM_CELL_RE = /^:?-+:?$/
type TableAlign = 'left' | 'center' | 'right'

// 行内语法优先级：行内代码 > 粗体 > 斜体 > 引用标记 > 链接。
// 每次调用新建 RegExp 实例，保证递归解析时 lastIndex 互不干扰。
const INLINE_SOURCE = '(`[^`\\n]+`|\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|\\*[^*\\n]+\\*|_[^_\\n]+_|\\[ref:\\d+\\]|\\[[^\\]\\n]+\\]\\([^)\\s]+\\))'

interface InlineContext {
  onOpenRef?: (ref: number) => void
  /** P5-r：编号 → 完整引用。文档 / 节点 / 块名都取自这里，渲染层不猜路径。 */
  refs: ReadonlyMap<number, AiReference>
}

/** 悬停提示：三层名字一次给全，缺字段时降级到可读面包屑而不是裸 docId。 */
function referenceTooltip(item: AiReference): string {
  const parts = [`文档：${item.title}`, `节点：${item.nodeName || item.breadcrumb}`]
  if (item.blockLabel) parts.push(`块：${item.blockLabel}`)
  return `打开引用 · ${parts.join('｜')}${item.snippet ? `\n${item.snippet}` : ''}`
}

function renderInline(text: string, keyPrefix: string, ctx?: InlineContext): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = new RegExp(INLINE_SOURCE, 'g')
  let lastIndex = 0
  let index = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    const key = `${keyPrefix}-i${index}`
    index += 1
    const ref = parseReferenceToken(token)
    if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded border border-[var(--color-border-light)] bg-[var(--color-bg)] px-1 font-mono">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key} className="font-semibold">{renderInline(token.slice(2, -2), key, ctx)}</strong>)
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), key, ctx)}</em>)
    } else if (ref !== null) {
      const item = ctx?.refs.get(ref)
      if (item) {
        nodes.push(
          <button
            key={key}
            type="button"
            data-tm-ai-ref={ref}
            data-tm-ai-ref-label={item.title}
            title={referenceTooltip(item)}
            onClick={() => ctx?.onOpenRef?.(ref)}
            className={tmUI(TM_UI.aiRefChip, 'mx-0.5 inline-flex max-w-40 items-center gap-1 align-baseline')}
          >
            <span className={TM_UI.aiRefIndex}>{ref}</span>
            <span className="truncate">{item.title}</span>
          </button>,
        )
      } else {
        nodes.push(token)
      }
    } else {
      const link = LINK_RE.exec(token)
      if (link && SAFE_URL_RE.test(link[2])) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener" className="text-[var(--color-accent)] underline">
            {link[1]}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

/** 切分一行表格：`\|` 是字面竖线不参与分列，可选的首尾竖线不产生空列。 */
function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]
    if (ch === '\\' && trimmed[i + 1] === '|') {
      cell += '|'
      i += 1
    } else if (ch === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell.trim())
  // `| a | b |` 的首尾只是外框；`|  | b |` 的第一个空单元格必须保留。
  if (cells.length > 1 && cells[0] === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
  return cells.length > 0 ? cells : null
}

/** 分隔行整行合法才算表格，返回每列的对齐方式；流式未吐完时返回 null 保持纯文本。 */
function parseTableAligns(line: string): TableAlign[] | null {
  const cells = splitTableRow(line)
  if (!cells || cells.length === 0 || cells.some((cell) => !TABLE_DELIM_CELL_RE.test(cell))) return null
  return cells.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

/** 表头行 + 紧随的分隔行才构成表格；列数按 GFM 必须一致，否则流式还没吐完，
 *  保持纯文本等补齐（也避免把只有一列 `| ---` 的半成品抢先渲染成空表）。 */
function isTableStart(lines: string[], index: number): boolean {
  const line = (lines[index] ?? '').replace(/\r$/, '')
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  if (FENCE_OPEN_RE.test(trimmed) || HEADING_RE.test(trimmed) || HR_RE.test(trimmed)
    || QUOTE_RE.test(line) || UL_RE.test(line) || OL_RE.test(line)) return false
  const header = splitTableRow(line)
  const aligns = parseTableAligns(lines[index + 1] ?? '')
  return header !== null && aligns !== null && header.length > 0 && header.length === aligns.length
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = (lines[index] ?? '').replace(/\r$/, '')
  const trimmed = line.trim()
  return FENCE_OPEN_RE.test(trimmed)
    || HEADING_RE.test(trimmed)
    || HR_RE.test(trimmed)
    || QUOTE_RE.test(line)
    || UL_RE.test(line)
    || OL_RE.test(line)
    || isTableStart(lines, index)
}

function renderBlocks(content: string, ctx?: InlineContext): ReactNode[] {
  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  let key = 0
  const nextKey = () => `b${key++}`

  while (index < lines.length) {
    const line = lines[index].replace(/\r$/, '')
    const trimmed = line.trim()
    if (!trimmed) {
      index += 1
      continue
    }

    if (FENCE_OPEN_RE.test(trimmed)) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !FENCE_CLOSE_RE.test(lines[index].trim())) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      const blockKey = nextKey()
      blocks.push(
        <pre key={blockKey} className="tm-scroll my-2 overflow-x-auto rounded border border-[var(--color-border-light)] bg-[var(--color-bg)] p-2 font-mono">
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = HEADING_RE.exec(trimmed)
    if (heading) {
      const blockKey = nextKey()
      blocks.push(
        <div key={blockKey} className="mb-1 mt-2 font-semibold">
          {renderInline(heading[2], blockKey, ctx)}
        </div>,
      )
      index += 1
      continue
    }

    if (HR_RE.test(trimmed)) {
      blocks.push(<hr key={nextKey()} className="my-2 border-[var(--color-border-light)]" />)
      index += 1
      continue
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && QUOTE_RE.test(lines[index])) {
        quoted.push(QUOTE_RE.exec(lines[index])?.[1] ?? '')
        index += 1
      }
      const blockKey = nextKey()
      blocks.push(
        <blockquote key={blockKey} className="my-1 whitespace-pre-line border-l-2 border-[var(--color-border-strong)] pl-2">
          {renderInline(quoted.join('\n'), blockKey, ctx)}
        </blockquote>,
      )
      continue
    }

    if (UL_RE.test(line) || OL_RE.test(line)) {
      const itemRe = UL_RE.test(line) ? UL_RE : OL_RE
      const items: string[] = []
      while (index < lines.length) {
        const item = itemRe.exec(lines[index].replace(/\r$/, ''))
        if (!item) break
        items.push(item[1])
        index += 1
      }
      const blockKey = nextKey()
      const children = items.map((item, i) => <li key={`${blockKey}-l${i}`}>{renderInline(item, `${blockKey}-l${i}`, ctx)}</li>)
      blocks.push(
        UL_RE.test(line)
          ? <ul key={blockKey} className="my-1 list-disc pl-5">{children}</ul>
          : <ol key={blockKey} className="my-1 list-decimal pl-5">{children}</ol>,
      )
      continue
    }

    if (isTableStart(lines, index)) {
      const header = splitTableRow(lines[index]) ?? []
      const aligns = parseTableAligns(lines[index + 1]) ?? []
      // 列数由表头决定；body 短行补空单元格、长行多余单元格丢弃（GFM 行为）。
      const columnCount = header.length
      const alignOf = (col: number): TableAlign => aligns[col] ?? 'left'
      const rows: string[][] = []
      index += 2
      while (index < lines.length) {
        const rowLine = lines[index].replace(/\r$/, '')
        const rowTrimmed = rowLine.trim()
        if (!rowTrimmed) break
        const cells = splitTableRow(rowLine)
        if (!cells) break
        if (HEADING_RE.test(rowTrimmed) || FENCE_OPEN_RE.test(rowTrimmed) || HR_RE.test(rowTrimmed)
          || QUOTE_RE.test(rowLine) || UL_RE.test(rowLine) || OL_RE.test(rowLine)) break
        if (rows.length > 0 && isTableStart(lines, index)) break
        rows.push(cells)
        index += 1
      }
      const blockKey = nextKey()
      const columns = Array.from({ length: columnCount }, (_, col) => col)
      blocks.push(
        <div
          key={blockKey}
          data-tm-ai-table=""
          className={tmUI(TM_UI.aiTableWrap, TM_UI.scroll, 'my-2 w-full overflow-x-auto')}
        >
          <table className={TM_UI.aiTable}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={`${blockKey}-h${col}`} data-tm-align={alignOf(col)}>
                    {renderInline(header[col] ?? '', `${blockKey}-h${col}`, ctx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${blockKey}-r${rowIndex}`}>
                  {columns.map((col) => (
                    <td key={`${blockKey}-r${rowIndex}c${col}`} data-tm-align={alignOf(col)}>
                      {renderInline(row[col] ?? '', `${blockKey}-r${rowIndex}c${col}`, ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const next = lines[index].replace(/\r$/, '')
      const nextTrimmed = next.trim()
      if (!nextTrimmed || isBlockStart(lines, index)) break
      paragraph.push(next)
      index += 1
    }
    if (paragraph.length > 0) {
      const blockKey = nextKey()
      blocks.push(<p key={blockKey} className="my-1 whitespace-pre-line">{renderInline(paragraph.join('\n'), blockKey, ctx)}</p>)
    } else {
      // 防御：语法行若被上面的分支漏掉，也要推进游标，避免死循环。
      index += 1
    }
  }
  return blocks
}

const REF_TOKEN_GLOBAL_RE = /\[ref:(\d+)\]/g

/**
 * P5-r：回答末尾的「参考来源」清单。只列本条消息正文里真正出现过的编号，
 * 且必须在引用映射里命中；重复引用去重，顺序按首次出现。整条清单是正文
 * 渲染之后的兄弟节点，不参与 Markdown 分块，流式输出时随 token 增长。
 */
function ReferenceSources({ content, refs, onOpenRef }: {
  content: string
  refs: ReadonlyMap<number, AiReference>
  onOpenRef?: (ref: number) => void
}) {
  const used: number[] = []
  for (const match of content.matchAll(REF_TOKEN_GLOBAL_RE)) {
    const ref = Number(match[1])
    if (refs.has(ref) && !used.includes(ref)) used.push(ref)
  }
  if (used.length === 0) return null
  return (
    <section className={TM_UI.aiRefSources} data-tm-ai-ref-sources="">
      <div className={tmUI(TM_UI.label, 'mb-1')}>参考来源</div>
      <ul className="space-y-1">
        {used.map((ref) => {
          const item = refs.get(ref)
          if (!item) return null
          return (
            <li key={ref}>
              <button
                type="button"
                data-tm-ai-ref-source={ref}
                title={referenceTooltip(item)}
                onClick={() => onOpenRef?.(ref)}
                className={TM_UI.aiRefSource}
              >
                <span className={TM_UI.aiRefIndex}>{ref}</span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{item.title}</span>
                  <span className={TM_UI.aiRefMeta}>
                    {item.nodeName || item.breadcrumb}
                    {item.blockLabel ? ` · ${item.blockLabel}` : ''}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

interface AiMarkdownProps {
  content: string
  placeholder?: string
  /** P3：本轮 kb.ask 返回的引用映射；只有编号存在时才渲染成可点按钮。 */
  references?: readonly AiReference[]
  onOpenRef?: (ref: number) => void
}

export default function AiMarkdown({ content, placeholder, references, onOpenRef }: AiMarkdownProps) {
  if (!content.trim()) {
    return <span className={TM_UI.hint}>{placeholder ?? ''}</span>
  }
  const refs = new Map((references ?? []).map((item) => [item.ref, item]))
  const ctx: InlineContext | undefined = refs.size > 0 ? { onOpenRef, refs } : undefined
  return (
    <div className="break-words leading-relaxed">
      {renderBlocks(content, ctx)}
      {ctx && <ReferenceSources content={content} refs={refs} onOpenRef={onOpenRef} />}
    </div>
  )
}
