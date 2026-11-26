/**
 * AI 回答的轻量 Markdown 渲染（P0 修复；P3 增加 [ref:i] 引用按钮）。
 *
 * 为什么不用 marked / react-markdown：marked 只是 mermaid 的传递依赖，不作为
 * 直接依赖使用；而回答来自远端模型，绝不走 dangerouslySetInnerHTML。这里用
 * 纯 React 元素输出，天然转义，覆盖会话常见语法即可：
 * 标题 / 粗体 / 斜体 / 行内代码 / 围栏代码块 / 有序无序列表 / 引用 / 链接 / 分隔线。
 *
 * 流式输出时语法可能尚未闭合（例如只收到一个 `**`），未匹配的标记原样保留，
 * 等后续 token 补齐后自然解析成对应样式。视觉值只用设计 token 与标准布局类。
 *
 * P3：[ref:i] 只有在本轮 kb.ask 真的返回过该编号时才渲染成可点按钮（引用映射
 * 只存在 agentSessionStore 内存）；未命中 / 模型伪造的编号保持纯文本，不做死链。
 */
import type { ReactNode } from 'react'
import type { AiReference } from '@/core/ai-types'
import { TM_UI } from '@/shared/ui/controlStyles'
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

// 行内语法优先级：行内代码 > 粗体 > 斜体 > 引用标记 > 链接。
// 每次调用新建 RegExp 实例，保证递归解析时 lastIndex 互不干扰。
const INLINE_SOURCE = '(`[^`\\n]+`|\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|\\*[^*\\n]+\\*|_[^_\\n]+_|\\[ref:\\d+\\]|\\[[^\\]\\n]+\\]\\([^)\\s]+\\))'

interface InlineContext {
  onOpenRef?: (ref: number) => void
  refIds: ReadonlySet<number>
  titles: ReadonlyMap<number, string>
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
      if (ctx?.onOpenRef && ctx.refIds.has(ref)) {
        nodes.push(
          <button
            key={key}
            type="button"
            data-tm-ai-ref={ref}
            title={`打开引用：${ctx.titles.get(ref) ?? '文档'}`}
            onClick={() => ctx.onOpenRef?.(ref)}
            className="mx-0.5 rounded px-1 text-[var(--color-accent)] underline"
          >
            {token}
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

function isBlockStart(line: string, trimmed: string): boolean {
  return FENCE_OPEN_RE.test(trimmed)
    || HEADING_RE.test(trimmed)
    || HR_RE.test(trimmed)
    || QUOTE_RE.test(line)
    || UL_RE.test(line)
    || OL_RE.test(line)
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

    const paragraph: string[] = []
    while (index < lines.length) {
      const next = lines[index].replace(/\r$/, '')
      const nextTrimmed = next.trim()
      if (!nextTrimmed || isBlockStart(next, nextTrimmed)) break
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
  const ctx: InlineContext | undefined = references && references.length > 0
    ? {
      onOpenRef,
      refIds: new Set(references.map((item) => item.ref)),
      titles: new Map(references.map((item) => [item.ref, item.title])),
    }
    : undefined
  return <div className="break-words leading-relaxed">{renderBlocks(content, ctx)}</div>
}
