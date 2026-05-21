import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import { useStorage } from '../../core/storage'
import { MermaidBlock } from './MermaidBlock'
import { ImageBlock } from './ImageBlock'
import '../../styles/github-markdown-themed.css'
import '../../styles/highlight-themed.css'

import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { visit } from 'unist-util-visit'
import 'katex/dist/katex.min.css'

interface MarkdownPreviewProps {
  content: string
  attachmentCardPath?: string | null
  compact?: boolean
  className?: string
  onChange?: (value: string) => void
  surfaceRef?: RefObject<HTMLDivElement>
  headingIds?: string[]
  onOpenDetailDocumentLink?: (documentPath: string) => void
}

interface PreviewImageState {
  src: string
  alt?: string
  scale: number
  offsetX: number
  offsetY: number
}

const remarkPlugins = [remarkBreaks, remarkGfm, remarkMath]
const rehypePlugins = [rehypeSanitize, [rehypeHighlight, { ignoreMissing: true }], rehypeKatex]
const COMMON_CODE_LANGUAGES = [
  '',
  'plaintext',
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'json',
  'html',
  'css',
  'bash',
  'shell',
  'python',
  'java',
  'go',
  'rust',
  'sql',
  'yaml',
  'markdown',
  'mermaid',
]

interface TaskItemMeta {
  checkedOffset: number
  checked: boolean
}

interface CodeBlockMeta {
  infoStartOffset: number
  infoEndOffset: number
  language: string
  rawInfo: string
}

type ImageAlign = 'left' | 'center' | 'right'

interface ImageMeta {
  insertOffset: number
  titleStartOffset: number | null
  titleEndOffset: number | null
  align: ImageAlign
  width: number
  titleText: string
}

const DEFAULT_IMAGE_ALIGN: ImageAlign = 'left'
const DEFAULT_IMAGE_WIDTH = 100

function iterateMarkdownLines(markdown: string, visitor: (line: string, lineStart: number) => void) {
  const matches = markdown.match(/.*(?:\r?\n|$)/g) ?? []
  let offset = 0
  for (const segment of matches) {
    if (!segment) continue
    const line = segment.replace(/\r?\n$/, '')
    visitor(line, offset)
    offset += segment.length
  }
}

function clampImageWidth(width: number) {
  return Math.min(100, Math.max(20, Math.round(width)))
}

function parseImageTitleMeta(title: string | undefined): Pick<ImageMeta, 'align' | 'width' | 'titleText'> {
  if (!title) {
    return {
      align: DEFAULT_IMAGE_ALIGN,
      width: DEFAULT_IMAGE_WIDTH,
      titleText: '',
    }
  }

  const tmIndex = title.indexOf('tm:')
  const titleText = tmIndex >= 0
    ? title.slice(0, tmIndex).replace(/\|\s*$/, '').trim()
    : title.trim()
  const metaSource = tmIndex >= 0 ? title.slice(tmIndex + 3) : ''
  let align: ImageAlign = DEFAULT_IMAGE_ALIGN
  let width = DEFAULT_IMAGE_WIDTH

  for (const token of metaSource.split(/[;,\s]+/)) {
    if (!token || !token.includes('=')) continue
    const [rawKey, rawValue] = token.split('=')
    const key = rawKey.trim().toLowerCase()
    const value = rawValue.trim().toLowerCase()
    if (key === 'align' && (value === 'left' || value === 'center' || value === 'right')) {
      align = value
    }
    if (key === 'width') {
      const parsedWidth = Number.parseInt(value, 10)
      if (!Number.isNaN(parsedWidth)) {
        width = clampImageWidth(parsedWidth)
      }
    }
  }

  return { align, width, titleText }
}

function buildImageTitleMeta(meta: Pick<ImageMeta, 'align' | 'width' | 'titleText'>) {
  const metaText = `tm:align=${meta.align};width=${clampImageWidth(meta.width)}`
  return meta.titleText ? `${meta.titleText} | ${metaText}` : metaText
}

function parseInteractiveMarkdown(markdown: string) {
  const taskItems: TaskItemMeta[] = []
  const codeBlocks: CodeBlockMeta[] = []
  const imageItems: ImageMeta[] = []

  const tree = unified().use(remarkParse).parse(markdown)

  visit(tree, (node: any) => {
    if (node.type === 'listItem') {
      if (node.checked !== null && node.checked !== undefined && node.position) {
        // Find the actual checkbox offset in the source text
        // Remark AST gives us the block position, we need to find the [ ] or [x] inside it
        const startOffset = node.position.start.offset
        const textToSearch = markdown.slice(startOffset, startOffset + 20)
        const match = /^(\s*(?:[-+*]|\d+\.)\s+\[)( |x|X)(\]\s+)/i.exec(textToSearch)
        if (match) {
          taskItems.push({
            checkedOffset: startOffset + match[1].length,
            checked: node.checked,
          })
        }
      }
    } else if (node.type === 'code') {
      if (node.position) {
        // Find where the info string (language) starts and ends
        const startOffset = node.position.start.offset
        const blockText = markdown.slice(startOffset, startOffset + 100)
        const match = /^(\s{0,3})(`{3,}|~{3,})([^\r\n]*)$/m.exec(blockText)
        if (match) {
          const markerEndOffset = startOffset + match.index + match[1].length + match[2].length
          const lineEndOffset = markerEndOffset + match[3].length
          codeBlocks.push({
            infoStartOffset: markerEndOffset,
            infoEndOffset: lineEndOffset,
            language: node.lang || '',
            rawInfo: match[3],
          })
        }
      }
    } else if (node.type === 'image') {
      if (node.position) {
        const startOffset = node.position.start.offset
        const endOffset = node.position.end.offset
        const fullMatchText = markdown.slice(startOffset, endOffset)
        
        const insertOffset = endOffset - 1 // right before the closing parenthesis
        
        let titleStartOffset: number | null = null
        let titleEndOffset: number | null = null
        const title = node.title
        
        if (title !== undefined && title !== null) {
          const quotedTitle = `"${title}"`
          const quotedTitleIndex = fullMatchText.lastIndexOf(quotedTitle)
          if (quotedTitleIndex >= 0) {
            titleStartOffset = startOffset + quotedTitleIndex + 1
            titleEndOffset = titleStartOffset + title.length
          }
        }
        
        const meta = parseImageTitleMeta(title)
        imageItems.push({
          insertOffset,
          titleStartOffset,
          titleEndOffset,
          ...meta,
        })
      }
    }
  })

  return { taskItems, codeBlocks, imageItems }
}

function updateTaskItem(markdown: string, taskItems: TaskItemMeta[], index: number, checked: boolean) {
  const item = taskItems[index]
  if (!item) return markdown
  
  // Replace only the checkbox character [ ] or [x] with the new state
  return `${markdown.slice(0, item.checkedOffset)}${checked ? 'x' : ' '}${markdown.slice(item.checkedOffset + 1)}`
}

function updateCodeBlockLanguage(markdown: string, codeBlocks: CodeBlockMeta[], index: number, nextLanguage: string) {
  const block = codeBlocks[index]
  if (!block) return markdown
  const info = block.rawInfo.trim()
  const infoParts = info ? info.split(/\s+/) : []
  const meta = infoParts.slice(1).join(' ')
  const nextInfo = [nextLanguage.trim(), meta].filter(Boolean).join(' ')
  const replacement = nextInfo ? ` ${nextInfo}` : ''
  return `${markdown.slice(0, block.infoStartOffset)}${replacement}${markdown.slice(block.infoEndOffset)}`
}

function updateImageMeta(markdown: string, imageItems: ImageMeta[], index: number, patch: Partial<Pick<ImageMeta, 'align' | 'width'>>) {
  const image = imageItems[index]
  if (!image) return markdown
  const nextMeta = {
    align: patch.align ?? image.align,
    width: patch.width ?? image.width,
    titleText: image.titleText,
  }
  const nextTitle = buildImageTitleMeta(nextMeta)

  if (image.titleStartOffset !== null && image.titleEndOffset !== null) {
    return `${markdown.slice(0, image.titleStartOffset)}${nextTitle}${markdown.slice(image.titleEndOffset)}`
  }

  return `${markdown.slice(0, image.insertOffset)} "${nextTitle}"${markdown.slice(image.insertOffset)}`
}

function extractPlainText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children)
  }
  if (Array.isArray(children)) {
    return children.map(extractPlainText).join('')
  }
  if (children && typeof children === 'object' && 'props' in children) {
    return extractPlainText((children as any).props?.children)
  }
  return ''
}

interface InteractiveCodeBlockProps {
  code: string
  language: string
  className?: string
  compact?: boolean
  blockIndex: number
  canEdit: boolean
  isWrapped: boolean
  copied: boolean
  onToggleWrap: () => void
  onCopy: () => void
  onLanguageChange: (language: string) => void
}

const InteractiveCodeBlock = memo(function InteractiveCodeBlock({
  code,
  language,
  className,
  compact,
  blockIndex,
  canEdit,
  isWrapped,
  copied,
  onToggleWrap,
  onCopy,
  onLanguageChange,
}: InteractiveCodeBlockProps) {
  const languageOptions = useMemo(() => {
    const normalized = language.trim().toLowerCase()
    return Array.from(new Set([normalized, ...COMMON_CODE_LANGUAGES])).filter(Boolean => true)
  }, [language])

  const codeElement = language === 'mermaid'
    ? <MermaidBlock code={code} />
    : (
      <pre className={`!mb-0 overflow-x-auto ${isWrapped ? '!whitespace-pre-wrap !break-words [overflow-wrap:anywhere] [&_code]:!whitespace-pre-wrap [&_code]:!break-words [&_code]:[overflow-wrap:anywhere]' : ''}`}>
        <code className={className}>{code}</code>
      </pre>
    )

  return (
    <div className="mb-4 relative group/code" data-code-block-index={blockIndex}>
      <div className="absolute top-2 right-2 z-[2] flex items-center justify-end gap-1.5 p-1 border border-[#d0d7de]/90 !border-[var(--color-border)] rounded-[10px] bg-white/96 !bg-[color-mix(in_srgb,var(--color-surface-elevated)_96%,transparent)] shadow-[0_6px_24px_rgba(31,35,40,0.12)] !shadow-[var(--shadow-popover)] opacity-0 -translate-y-1 pointer-events-none transition-all duration-150 backdrop-blur-md group-hover/code:opacity-100 group-hover/code:translate-y-0 group-hover/code:pointer-events-auto focus-within:opacity-100 focus-within:translate-y-0 focus-within:pointer-events-auto">
        <label className="inline-flex items-center min-w-0 [&_select]:min-w-[88px] [&_select]:max-w-[120px] [&_select]:h-6 [&_select]:pl-2 [&_select]:pr-[22px] [&_select]:border [&_select]:border-[#d0d7de] [&_select]:!border-[var(--color-border)] [&_select]:rounded-[7px] [&_select]:bg-white/96 [&_select]:!bg-[var(--color-bg)] [&_select]:text-[#1f2328] [&_select]:text-[11px] [&_select]:leading-6 hover:[&_select:not(:disabled)]:bg-[#f3f4f6] hover:[&_select:not(:disabled)]:!bg-[var(--color-hover-bg)] hover:[&_select:not(:disabled)]:border-[#afb8c1] disabled:[&_select]:cursor-not-allowed disabled:[&_select]:opacity-60" aria-label="代码语言">
          <select
            value={language}
            onChange={(event) => onLanguageChange(event.target.value)}
            disabled={!canEdit}
            title="代码语言"
          >
            {languageOptions.map((option) => (
              <option key={option || 'plain'} value={option}>
                {option || 'plaintext'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`h-6 px-2 border border-[#d0d7de] !border-[var(--color-border)] rounded-[7px] bg-[#f6f8fa]/96 !bg-[var(--color-bg)] text-[#24292f] text-[11px] font-medium cursor-pointer leading-6 hover:not(:disabled):bg-[#f3f4f6] hover:not(:disabled):!bg-[var(--color-hover-bg)] hover:not(:disabled):border-[#afb8c1] disabled:cursor-not-allowed disabled:opacity-60 ${isWrapped ? '!bg-[#ddeefe] !bg-[var(--color-selected-bg)] !border-[#54aeff] !border-[var(--color-accent)] !text-[#0969da] !text-[var(--color-accent)]' : ''}`}
          onClick={onToggleWrap}
          title={isWrapped ? '关闭自动换行' : '开启自动换行'}
        >
          换行
        </button>
        <button type="button" className="h-6 px-2 border border-[#d0d7de] !border-[var(--color-border)] rounded-[7px] bg-[#f6f8fa]/96 !bg-[var(--color-bg)] text-[#24292f] text-[11px] font-medium cursor-pointer leading-6 hover:not(:disabled):bg-[#f3f4f6] hover:not(:disabled):!bg-[var(--color-hover-bg)] hover:not(:disabled):border-[#afb8c1] disabled:cursor-not-allowed disabled:opacity-60" onClick={onCopy} title="复制代码">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div className={`min-w-0 ${compact ? 'text-[13px] leading-relaxed [&_h1]:text-[1.5em] [&_h2]:text-[1.3em] [&_h3]:text-[1.1em] [&_p]:mb-2 [&_ul]:mb-2 [&_ol]:mb-2 [&_pre]:p-2' : ''}`}>
        {codeElement}
      </div>
    </div>
  )
})

interface InteractiveImageBlockProps {
  src?: string
  alt?: string
  title?: string
  attachmentCardPath?: string | null
  canEdit: boolean
  align: ImageAlign
  width: number
  onAlignChange: (align: ImageAlign) => void
  onWidthChange: (width: number) => void
  onPreview: (payload: PreviewImageState) => void
}

const InteractiveImageBlock = memo(function InteractiveImageBlock({
  src,
  alt,
  title,
  attachmentCardPath,
  canEdit,
  align,
  width,
  onAlignChange,
  onWidthChange,
  onPreview,
}: InteractiveImageBlockProps) {
  const [isSelected, setIsSelected] = useState(false)
  const containerRef = useRef<HTMLSpanElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  
  useEffect(() => {
    if (!isSelected) return
    const handleDocumentClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsSelected(false)
      }
    }
    document.addEventListener('mousedown', handleDocumentClick)
    return () => document.removeEventListener('mousedown', handleDocumentClick)
  }, [isSelected])

  const [isDragging, setIsDragging] = useState(false)
  const [tempWidth, setTempWidth] = useState<number | null>(null)

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
    }
  }, [])

  const handleDragStart = (e: React.PointerEvent, corner: 'tl' | 'tr' | 'bl' | 'br') => {
    e.preventDefault()
    e.stopPropagation()
    if (!canEdit) return
    dragCleanupRef.current?.()
    setIsDragging(true)
    
    // Add global class to lock cursor and prevent text selection during drag
    const cursorClass = (corner === 'tl' || corner === 'br') ? 'is-resizing-nwse' : 'is-resizing-nesw'
    document.body.classList.add(cursorClass)

    const startX = e.clientX
    const startWidthPct = width
    const containerWidth = containerRef.current?.parentElement?.clientWidth || 800
    
    function handleDragMove(moveEvent: PointerEvent) {
      const deltaX = moveEvent.clientX - startX
      const isLeftCorner = corner === 'tl' || corner === 'bl'
      const effectiveDeltaX = isLeftCorner ? -deltaX : deltaX
      
      const deltaPct = (effectiveDeltaX / containerWidth) * 100
      let newWidth = startWidthPct + deltaPct
      newWidth = Math.max(10, Math.min(100, newWidth))
      setTempWidth(newWidth)
    }

    function cleanupDrag() {
      setIsDragging(false)
      document.body.classList.remove(cursorClass)
      document.removeEventListener('pointermove', handleDragMove)
      document.removeEventListener('pointerup', handleDragEnd)
      document.removeEventListener('pointercancel', handleDragCancel)
      window.removeEventListener('blur', handleDragCancel)
      dragCleanupRef.current = null
    }

    function handleDragCancel() {
      setTempWidth(null)
      cleanupDrag()
    }

    function handleDragEnd(endEvent: PointerEvent) {
      const deltaX = endEvent.clientX - startX
      const isLeftCorner = corner === 'tl' || corner === 'bl'
      const effectiveDeltaX = isLeftCorner ? -deltaX : deltaX
      
      const deltaPct = (effectiveDeltaX / containerWidth) * 100
      let newWidth = startWidthPct + deltaPct
      newWidth = Math.max(10, Math.min(100, newWidth))
      setTempWidth(null)
      cleanupDrag()
      onWidthChange(newWidth)
    }
    
    dragCleanupRef.current = cleanupDrag
    document.addEventListener('pointermove', handleDragMove)
    document.addEventListener('pointerup', handleDragEnd)
    document.addEventListener('pointercancel', handleDragCancel)
    window.addEventListener('blur', handleDragCancel)
  }

  const currentWidth = tempWidth !== null ? tempWidth : width

  return (
    <span
      ref={containerRef}
      className={[
        'flex flex-col gap-2 my-4 relative group/img',
        align === 'center' ? '[&>.interactiveImageFrame]:justify-center' : '',
        align === 'right' ? '[&>.interactiveImageFrame]:justify-end' : '',
      ].filter(Boolean).join(' ')}
      style={{ position: 'relative' }}
    >
      {isSelected && canEdit && (
        <span className="absolute -top-10 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center gap-2 py-1 px-2 border border-[#d0d7de]/90 !border-[var(--color-border)] rounded-lg bg-white/96 !bg-[color-mix(in_srgb,var(--color-surface-elevated)_96%,transparent)] shadow-[0_4px_12px_rgba(31,35,40,0.15)] !shadow-[var(--shadow-popover)] backdrop-blur-md">
          <span className="inline-flex gap-1.5">
            <button
              type="button"
              className={`h-7 px-2.5 border border-[#d0d7de] !border-[var(--color-border)] rounded-md bg-[#f6f8fa] !bg-[var(--color-bg)] text-[#24292f] text-[12px] font-medium cursor-pointer hover:bg-[#f3f4f6] hover:!bg-[var(--color-hover-bg)] hover:border-[#afb8c1] ${align === 'left' ? '!bg-[#ddeefe] !bg-[var(--color-selected-bg)] !border-[#54aeff] !border-[var(--color-accent)] !text-[#0969da] !text-[var(--color-accent)]' : ''}`}
              onClick={(e) => { e.stopPropagation(); onAlignChange('left') }}
            >
              左对齐
            </button>
            <button
              type="button"
              className={`h-7 px-2.5 border border-[#d0d7de] !border-[var(--color-border)] rounded-md bg-[#f6f8fa] !bg-[var(--color-bg)] text-[#24292f] text-[12px] font-medium cursor-pointer hover:bg-[#f3f4f6] hover:!bg-[var(--color-hover-bg)] hover:border-[#afb8c1] ${align === 'center' ? '!bg-[#ddeefe] !bg-[var(--color-selected-bg)] !border-[#54aeff] !border-[var(--color-accent)] !text-[#0969da] !text-[var(--color-accent)]' : ''}`}
              onClick={(e) => { e.stopPropagation(); onAlignChange('center') }}
            >
              居中
            </button>
            <button
              type="button"
              className={`h-7 px-2.5 border border-[#d0d7de] !border-[var(--color-border)] rounded-md bg-[#f6f8fa] !bg-[var(--color-bg)] text-[#24292f] text-[12px] font-medium cursor-pointer hover:bg-[#f3f4f6] hover:!bg-[var(--color-hover-bg)] hover:border-[#afb8c1] ${align === 'right' ? '!bg-[#ddeefe] !bg-[var(--color-selected-bg)] !border-[#54aeff] !border-[var(--color-accent)] !text-[#0969da] !text-[var(--color-accent)]' : ''}`}
              onClick={(e) => { e.stopPropagation(); onAlignChange('right') }}
            >
              居右
            </button>
          </span>
        </span>
      )}
      <span className="flex justify-start w-full interactiveImageFrame">
        <span 
          className={`${isSelected ? 'outline outline-2 outline-[#0969da] !outline-[var(--color-accent)] outline-offset-2' : ''}`}
          style={{ width: `${currentWidth}%`, position: 'relative', display: 'flex', lineHeight: 0 }}
          onClick={(e) => { e.stopPropagation(); canEdit && setIsSelected(true) }}
        >
          <ImageBlock
            src={src}
            alt={alt}
            title={title}
            attachmentCardPath={attachmentCardPath}
            onPreview={(payload) => onPreview({ ...payload, scale: 1, offsetX: 0, offsetY: 0 })}
            className="block h-auto"
            style={{ width: '100%', height: 'auto', display: 'block', cursor: 'default' }}
          />
          {isSelected && canEdit && (
            <>
              <div 
                className={`absolute w-3 h-3 bg-[#0969da] !bg-[var(--color-accent)] border-2 border-white !border-[var(--color-surface)] rounded-full z-[5] -top-[5px] -left-[5px] cursor-nwse-resize`}
                onPointerDown={(e) => handleDragStart(e, 'tl')}
              />
              <div 
                className={`absolute w-3 h-3 bg-[#0969da] !bg-[var(--color-accent)] border-2 border-white !border-[var(--color-surface)] rounded-full z-[5] -top-[5px] -right-[5px] cursor-nesw-resize`}
                onPointerDown={(e) => handleDragStart(e, 'tr')}
              />
              <div 
                className={`absolute w-3 h-3 bg-[#0969da] !bg-[var(--color-accent)] border-2 border-white !border-[var(--color-surface)] rounded-full z-[5] -bottom-[5px] -left-[5px] cursor-nesw-resize`}
                onPointerDown={(e) => handleDragStart(e, 'bl')}
              />
              <div 
                className={`absolute w-3 h-3 bg-[#0969da] !bg-[var(--color-accent)] border-2 border-white !border-[var(--color-surface)] rounded-full z-[5] -bottom-[5px] -right-[5px] cursor-nwse-resize`}
                onPointerDown={(e) => handleDragStart(e, 'br')}
              />
            </>
          )}
        </span>
      </span>
    </span>
  )
})

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
  onChange,
  surfaceRef,
  headingIds,
  onOpenDetailDocumentLink
}: MarkdownPreviewProps) {
  const storage = useStorage()
  const [wrappedCodeBlocks, setWrappedCodeBlocks] = useState<Record<number, boolean>>({})
  const [copiedCodeBlockIndex, setCopiedCodeBlockIndex] = useState<number | null>(null)
  const [copiedHeadingId, setCopiedHeadingId] = useState<string | null>(null)
  const [previewImage, setPreviewImage] = useState<PreviewImageState | null>(null)
  const imageDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const { taskItems, codeBlocks, imageItems } = useMemo(() => parseInteractiveMarkdown(content), [content])

  useEffect(() => {
    if (copiedCodeBlockIndex === null) return
    const timeout = window.setTimeout(() => setCopiedCodeBlockIndex(null), 1200)
    return () => window.clearTimeout(timeout)
  }, [copiedCodeBlockIndex])

  useEffect(() => {
    if (copiedHeadingId === null) return
    const timeout = window.setTimeout(() => setCopiedHeadingId(null), 1200)
    return () => window.clearTimeout(timeout)
  }, [copiedHeadingId])

  useEffect(() => {
    if (!previewImage) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewImage(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewImage])

  const handleTaskToggle = useCallback((taskIndex: number, checked: boolean) => {
    if (!onChange) return
    onChange(updateTaskItem(content, taskItems, taskIndex, checked))
  }, [content, onChange, taskItems])

  const handleCodeLanguageChange = useCallback((blockIndex: number, language: string) => {
    if (!onChange) return
    onChange(updateCodeBlockLanguage(content, codeBlocks, blockIndex, language))
  }, [codeBlocks, content, onChange])

  const handleToggleWrap = useCallback((blockIndex: number) => {
    setWrappedCodeBlocks((current) => ({ ...current, [blockIndex]: !current[blockIndex] }))
  }, [])

  const handleCopyCode = useCallback(async (blockIndex: number, code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCodeBlockIndex(blockIndex)
    } catch {
      setCopiedCodeBlockIndex(null)
    }
  }, [])
  const handleCopyHeadingLink = useCallback(async (headingId: string) => {
    try {
      await navigator.clipboard.writeText(`#${headingId}`)
      setCopiedHeadingId(headingId)
    } catch {
      setCopiedHeadingId(null)
    }
  }, [])
  const handleImagePreview = useCallback((payload: PreviewImageState) => {
    setPreviewImage(payload)
  }, [])
  const handleCloseImagePreview = useCallback(() => {
    setPreviewImage(null)
  }, [])
  const handleImageAlignChange = useCallback((imageIndex: number, align: ImageAlign) => {
    if (!onChange) return
    onChange(updateImageMeta(content, imageItems, imageIndex, { align }))
  }, [content, imageItems, onChange])
  const handleImageWidthChange = useCallback((imageIndex: number, width: number) => {
    if (!onChange) return
    onChange(updateImageMeta(content, imageItems, imageIndex, { width: clampImageWidth(width) }))
  }, [content, imageItems, onChange])
  const handlePreviewImageWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    setPreviewImage((current) => {
      if (!current) return current
      const nextScale = Math.min(5, Math.max(0.5, current.scale + (event.deltaY < 0 ? 0.15 : -0.15)))
      if (nextScale <= 1) {
        return { ...current, scale: 1, offsetX: 0, offsetY: 0 }
      }
      return { ...current, scale: Number(nextScale.toFixed(2)) }
    })
  }, [])
  const handlePreviewImagePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!previewImage || previewImage.scale <= 1) return
    imageDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: previewImage.offsetX,
      originY: previewImage.offsetY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [previewImage])
  const handlePreviewImagePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = imageDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPreviewImage((current) => current ? ({
      ...current,
      offsetX: drag.originX + (event.clientX - drag.startX),
      offsetY: drag.originY + (event.clientY - drag.startY),
    }) : current)
  }, [])
  const handlePreviewImagePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (imageDragRef.current?.pointerId === event.pointerId) {
      imageDragRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }
  }, [])
  const handlePreviewImageReset = useCallback(() => {
    setPreviewImage((current) => current ? { ...current, scale: 1, offsetX: 0, offsetY: 0 } : current)
  }, [])

  const components = useMemo(() => {
    let headingIndex = 0
    let taskIndex = 0
    let codeBlockIndex = 0
    let imageIndex = 0

    const createHeading = (tagName: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') => {
      return function HeadingRenderer({ children, ...props }: any) {
        const id = headingIds?.[headingIndex]
        headingIndex += 1
        const text = extractPlainText(children)
        return createElement(
          tagName,
          id ? { ...props, id, className: [props.className, 'relative flex items-center gap-2 group/heading'].filter(Boolean).join(' ') } : { ...props, className: [props.className, 'relative flex items-center gap-2 group/heading'].filter(Boolean).join(' ') },
          <>
            <span>{children}</span>
            {id && (
              <button
                type="button"
                className="shrink-0 min-w-[32px] h-6 px-2 border border-[#d0d7de] !border-[var(--color-border)] rounded-md bg-[#f6f8fa] !bg-[var(--color-bg)] text-[#57606a] text-[12px] leading-none cursor-pointer opacity-0 transition-all duration-150 group-hover/heading:opacity-100 focus-visible:opacity-100 hover:bg-[#f3f4f6] hover:!bg-[var(--color-hover-bg)] hover:border-[#afb8c1] focus-visible:bg-[#f3f4f6] focus-visible:!bg-[var(--color-hover-bg)] focus-visible:border-[#afb8c1]"
                onClick={() => handleCopyHeadingLink(id)}
                aria-label={`复制标题锚点：${text || id}`}
                title={copiedHeadingId === id ? '已复制锚点' : '复制锚点链接'}
              >
                {copiedHeadingId === id ? '已复制' : '#'}
              </button>
            )}
          </>
        )
      }
    }

    return {
      h1: createHeading('h1'),
      h2: createHeading('h2'),
      h3: createHeading('h3'),
      h4: createHeading('h4'),
      h5: createHeading('h5'),
      h6: createHeading('h6'),
      input({ type, checked, disabled, ...props }: any) {
        if (type !== 'checkbox') {
          return <input type={type} checked={checked} disabled={disabled} {...props} />
        }
        const currentTaskIndex = taskIndex
        taskIndex += 1
        return (
          <input
            {...props}
            type="checkbox"
            checked={!!checked}
            className="cursor-pointer"
            disabled={!onChange}
            onChange={(event) => handleTaskToggle(currentTaskIndex, event.target.checked)}
          />
        )
      },
      code({ node, inline, className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || '')
        if (!inline) {
          const currentBlockIndex = codeBlockIndex
          codeBlockIndex += 1
          const code = String(children).replace(/\n$/, '')
          const blockMeta = codeBlocks[currentBlockIndex]
          const language = (match?.[1] || blockMeta?.language || '').trim()
          return (
            <InteractiveCodeBlock
              code={code}
              language={language}
              className={className}
              compact={compact}
              blockIndex={currentBlockIndex}
              canEdit={!!onChange}
              isWrapped={!!wrappedCodeBlocks[currentBlockIndex]}
              copied={copiedCodeBlockIndex === currentBlockIndex}
              onToggleWrap={() => handleToggleWrap(currentBlockIndex)}
              onCopy={() => handleCopyCode(currentBlockIndex, code)}
              onLanguageChange={(nextLanguage) => handleCodeLanguageChange(currentBlockIndex, nextLanguage)}
            />
          )
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      },
      img({ src, alt, ...props }: any) {
        const currentImageIndex = imageIndex
        imageIndex += 1
        const imageMeta = imageItems[currentImageIndex] ?? {
          align: DEFAULT_IMAGE_ALIGN,
          width: DEFAULT_IMAGE_WIDTH,
          titleText: '',
        }
        return (
          <InteractiveImageBlock
            src={src}
            alt={alt}
            title={imageMeta.titleText || props.title}
            attachmentCardPath={attachmentCardPath}
            canEdit={!!onChange}
            align={imageMeta.align}
            width={imageMeta.width}
            onAlignChange={(align) => handleImageAlignChange(currentImageIndex, align)}
            onWidthChange={(width) => handleImageWidthChange(currentImageIndex, width)}
            onPreview={handleImagePreview}
          />
        )
      },
      a({ href, children, ...props }: any) {
        if (href && href.startsWith('_attach/') && attachmentCardPath) {
          return (
            <a
              href="#"
              onClick={async (event) => {
                event.preventDefault()
                try {
                  await storage.openAttachment(attachmentCardPath, href)
                } catch (err) {
                  console.error('Failed to open attachment', err)
                }
              }}
              {...props}
            >
              {children}
            </a>
          )
        }
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
    }
  }, [
    attachmentCardPath,
    codeBlocks,
    compact,
    copiedCodeBlockIndex,
    handleCodeLanguageChange,
    handleCopyCode,
    handleCopyHeadingLink,
    handleImageAlignChange,
    handleImagePreview,
    handleImageWidthChange,
    handleTaskToggle,
    handleToggleWrap,
    headingIds,
    imageItems,
    onChange,
    onOpenDetailDocumentLink,
    copiedHeadingId,
    wrappedCodeBlocks,
    storage,
  ])

  return (
    <div
      ref={surfaceRef}
      className={[
        'h-full overflow-y-auto bg-transparent [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-thumb]:border-[3px] [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-clip-content [&::-webkit-scrollbar-thumb]:shadow-[inset_0_0_0_10px_rgba(148,163,184,0.34)] hover:[&::-webkit-scrollbar-thumb]:shadow-[inset_0_0_0_10px_rgba(100,116,139,0.5)] [&::-webkit-scrollbar-corner]:bg-transparent',
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
        urlTransform={(url) => url}
      >
        {content}
      </ReactMarkdown>
      {previewImage && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-slate-900/72 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-label={previewImage.alt ? `图片预览：${previewImage.alt}` : '图片预览'}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={handleCloseImagePreview}
        >
          <button
            type="button"
            className="absolute top-6 right-6 h-8 px-3 border border-white/24 rounded-full bg-slate-900/72 text-white text-[13px] cursor-pointer hover:bg-slate-900/90"
            onClick={handleCloseImagePreview}
            aria-label="关闭图片预览"
          >
            关闭
          </button>
          <button
            type="button"
            className="absolute top-6 right-24 h-8 px-3 border border-white/24 rounded-full bg-slate-900/72 text-white text-[13px] cursor-pointer hover:bg-slate-900/90"
            onClick={handlePreviewImageReset}
            aria-label="重置图片缩放和位置"
          >
            重置
          </button>
          <div
            className="relative max-w-[min(92vw,1200px)] max-h-[calc(100vh-96px)] flex flex-col items-center gap-2.5"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className={`w-[min(92vw,1200px)] max-w-[min(92vw,1200px)] max-h-[calc(100vh-150px)] overflow-hidden flex items-center justify-center rounded-[10px] cursor-zoom-in ${previewImage.scale > 1 ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
              onWheel={handlePreviewImageWheel}
              onPointerDown={handlePreviewImagePointerDown}
              onPointerMove={handlePreviewImagePointerMove}
              onPointerUp={handlePreviewImagePointerEnd}
              onPointerCancel={handlePreviewImagePointerEnd}
            >
              <img
                className="block max-w-full max-h-[calc(100vh-150px)] object-contain rounded-[10px] shadow-[0_24px_64px_rgba(15,23,42,0.35)] bg-white !bg-[var(--color-surface)]"
                src={previewImage.src}
                alt={previewImage.alt}
                draggable={false}
                style={{
                  transform: `translate(${previewImage.offsetX}px, ${previewImage.offsetY}px) scale(${previewImage.scale})`,
                }}
              />
            </div>
            {previewImage.alt && (
              <div className="max-w-[min(92vw,960px)] py-2 px-3 rounded-lg bg-slate-900/82 text-slate-50 text-[13px] text-center">{previewImage.alt}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
