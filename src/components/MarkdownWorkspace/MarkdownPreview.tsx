import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import { MermaidBlock } from './MermaidBlock'
import { ImageBlock } from './ImageBlock'

interface MarkdownPreviewProps {
  content: string
  attachmentCardPath?: string | null
  compact?: boolean
}

export const MarkdownPreview = memo(function MarkdownPreview({ content, attachmentCardPath, compact }: MarkdownPreviewProps) {
  const components = {
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
  }

  return (
    <div className={`markdown-preview ${compact ? 'compact' : ''}`} style={{ padding: compact ? '0' : '16px', height: '100%', overflowY: 'auto' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
