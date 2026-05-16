import { createElement, memo, useMemo, type RefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import { MermaidBlock } from './MermaidBlock'
import { ImageBlock } from './ImageBlock'
import styles from './MarkdownWorkspace.module.css'

import 'github-markdown-css/github-markdown-light.css'
import 'highlight.js/styles/github.css'

interface MarkdownPreviewProps {
  content: string
  attachmentCardPath?: string | null
  compact?: boolean
  className?: string
  surfaceRef?: RefObject<HTMLDivElement | null>
  headingIds?: string[]
  onOpenDetailDocumentLink?: (documentPath: string) => void
}

const remarkPlugins = [remarkBreaks, remarkGfm]
const rehypePlugins = [rehypeSanitize, [rehypeHighlight, { ignoreMissing: true }]]

function normalizeLinkedDetailDocumentPath(href: string | null | undefined) {
  const normalized = String(href ?? '').trim().replace(/\\/g, '/')
  if (!normalized) return null
  if (/^(?:[a-z]+:|\/\/|#)/i.test(normalized)) return null

  const [pathPart] = normalized.split('#')
  const decodedPath = (() => {
    try {
      return decodeURIComponent(pathPart)
    } catch {
      return pathPart
    }
  })()
  const cleanPath = decodedPath.replace(/^\.\//, '').replace(/^\/+/, '')
  if (!cleanPath) return null
  if (cleanPath === '_content.md') return '_content.md'
  if (/^_content\/[^/]+\.md$/i.test(cleanPath)) return cleanPath
  return null
}

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  attachmentCardPath,
  compact,
  className,
  surfaceRef,
  headingIds,
  onOpenDetailDocumentLink
}: MarkdownPreviewProps) {
  const components = useMemo(() => ({
    ...(() => {
      let headingIndex = 0
      const createHeading = (tagName: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') => {
        return function HeadingRenderer({ children, ...props }: any) {
          const id = headingIds?.[headingIndex]
          headingIndex += 1
          return createElement(tagName, id ? { ...props, id } : props, children)
        }
      }
      return {
        h1: createHeading('h1'),
        h2: createHeading('h2'),
        h3: createHeading('h3'),
        h4: createHeading('h4'),
        h5: createHeading('h5'),
        h6: createHeading('h6'),
      }
    })(),
    code({ node, inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      if (!inline && match && match[1] === 'mermaid') {
        return <MermaidBlock code={String(children).replace(/\n$/, '')} />
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    },
    img({ src, alt, ...props }: any) {
      return <ImageBlock src={src} alt={alt} attachmentCardPath={attachmentCardPath} {...props} />
    },
    a({ href, children, ...props }: any) {
      const linkedDetailDocumentPath = normalizeLinkedDetailDocumentPath(href)
      if (linkedDetailDocumentPath && onOpenDetailDocumentLink) {
        return (
          <a
            href={href}
            {...props}
            onClick={(event) => {
              event.preventDefault()
              onOpenDetailDocumentLink(linkedDetailDocumentPath)
            }}
          >
            {children}
          </a>
        )
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" {...props}>
          {children}
        </a>
      )
    }
  }), [attachmentCardPath, headingIds, onOpenDetailDocumentLink])

  return (
    <div
      ref={surfaceRef}
      className={[
        styles.previewSurface,
        'markdown-preview',
        'markdown-body',
        compact ? 'compact' : '',
        className ?? ''
      ].filter(Boolean).join(' ')}
      style={{ padding: compact ? '10px 12px' : '24px 28px' }}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins as any}
        rehypePlugins={rehypePlugins as any}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
