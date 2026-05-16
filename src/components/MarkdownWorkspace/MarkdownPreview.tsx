import { memo, useMemo } from 'react'
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
}

const remarkPlugins = [remarkBreaks, remarkGfm]
const rehypePlugins = [rehypeSanitize, [rehypeHighlight, { ignoreMissing: true }]]

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  attachmentCardPath,
  compact,
  className
}: MarkdownPreviewProps) {
  const components = useMemo(() => ({
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
      return (
        <a href={href} target="_blank" rel="noreferrer" {...props}>
          {children}
        </a>
      )
    }
  }), [attachmentCardPath])

  return (
    <div
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
