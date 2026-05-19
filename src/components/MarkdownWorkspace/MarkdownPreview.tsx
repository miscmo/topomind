import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import { useStorage } from '../../core/storage'
import { MermaidBlock } from './MermaidBlock'
import { ImageBlock } from './ImageBlock'
import 'github-markdown-css/github-markdown-light.css'
import 'highlight.js/styles/github.css'
import styles from './MarkdownWorkspace.module.css'

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

const remarkPlugins = [remarkBreaks, remarkGfm]
const rehypePlugins = [rehypeSanitize, [rehypeHighlight, { ignoreMissing: true }]]
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
  let activeFence: { marker: string; char: string; markerEndOffset: number; rawInfo: string } | null = null

  iterateMarkdownLines(markdown, (line, lineStart) => {
    if (!activeFence) {
      const openMatch = /^(\s{0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(line)
      if (openMatch) {
        activeFence = {
          marker: openMatch[2],
          char: openMatch[2][0],
          markerEndOffset: lineStart + openMatch[1].length + openMatch[2].length,
          rawInfo: openMatch[3],
        }
        const info = openMatch[3].trim()
        const [language = ''] = info ? info.split(/\s+/) : []
        codeBlocks.push({
          infoStartOffset: activeFence.markerEndOffset,
          infoEndOffset: lineStart + line.length,
          language,
          rawInfo: openMatch[3],
        })
        return
      }

      const taskMatch = /^(\s*(?:[-+*]|\d+\.)\s+\[)( |x|X)(\]\s+)/.exec(line)
      if (taskMatch) {
        taskItems.push({
          checkedOffset: lineStart + taskMatch[1].length,
          checked: /x/i.test(taskMatch[2]),
        })
      }

      const imageRegex = /!\[([^\]]*)\]\((\S+?)(?:\s+"([^"\r\n]*)")?\)/g
      let imageMatch: RegExpExecArray | null
      while ((imageMatch = imageRegex.exec(line)) !== null) {
        const fullMatch = imageMatch[0]
        const title = imageMatch[3]
        const absoluteMatchStart = lineStart + imageMatch.index
        const insertOffset = absoluteMatchStart + fullMatch.length - 1
        let titleStartOffset: number | null = null
        let titleEndOffset: number | null = null
        if (title !== undefined) {
          const quotedTitle = `"${title}"`
          const quotedTitleIndex = fullMatch.lastIndexOf(quotedTitle)
          if (quotedTitleIndex >= 0) {
            titleStartOffset = absoluteMatchStart + quotedTitleIndex + 1
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
      return
    }

    const closePattern = new RegExp(`^\\s{0,3}${activeFence.char}{${activeFence.marker.length},}\\s*$`)
    if (closePattern.test(line)) {
      activeFence = null
    }
  })

  return { taskItems, codeBlocks, imageItems }
}

function updateTaskItem(markdown: string, taskItems: TaskItemMeta[], index: number, checked: boolean) {
  const item = taskItems[index]
  if (!item) return markdown
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
      <pre className={`${styles.interactiveCodePre} ${isWrapped ? styles.codeBlockPreWrapped : ''}`}>
        <code className={className}>{code}</code>
      </pre>
    )

  return (
    <div className={styles.interactiveCodeBlock} data-code-block-index={blockIndex}>
      <div className={styles.interactiveCodeToolbar}>
        <label className={styles.interactiveCodeLanguage} aria-label="代码语言">
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
          className={`${styles.interactiveCodeButton} ${isWrapped ? styles.interactiveCodeButtonActive : ''}`}
          onClick={onToggleWrap}
          title={isWrapped ? '关闭自动换行' : '开启自动换行'}
        >
          换行
        </button>
        <button type="button" className={styles.interactiveCodeButton} onClick={onCopy} title="复制代码">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div className={`${styles.interactiveCodeContent} ${compact ? styles.compact : ''}`}>
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

  const handleDragStart = (e: React.PointerEvent, corner: 'tl' | 'tr' | 'bl' | 'br') => {
    e.preventDefault()
    e.stopPropagation()
    if (!canEdit) return
    setIsDragging(true)
    
    // Add global class to lock cursor and prevent text selection during drag
    const cursorClass = (corner === 'tl' || corner === 'br') ? 'is-resizing-nwse' : 'is-resizing-nesw'
    document.body.classList.add(cursorClass)

    const startX = e.clientX
    const startWidthPct = width
    const containerWidth = containerRef.current?.parentElement?.clientWidth || 800
    
    const handleDragMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX
      const isLeftCorner = corner === 'tl' || corner === 'bl'
      const effectiveDeltaX = isLeftCorner ? -deltaX : deltaX
      
      const deltaPct = (effectiveDeltaX / containerWidth) * 100
      let newWidth = startWidthPct + deltaPct
      newWidth = Math.max(10, Math.min(100, newWidth))
      setTempWidth(newWidth)
    }
    
    const handleDragEnd = (endEvent: PointerEvent) => {
      setIsDragging(false)
      document.body.classList.remove(cursorClass)
      document.removeEventListener('pointermove', handleDragMove)
      document.removeEventListener('pointerup', handleDragEnd)
      
      const deltaX = endEvent.clientX - startX
      const isLeftCorner = corner === 'tl' || corner === 'bl'
      const effectiveDeltaX = isLeftCorner ? -deltaX : deltaX
      
      const deltaPct = (effectiveDeltaX / containerWidth) * 100
      let newWidth = startWidthPct + deltaPct
      newWidth = Math.max(10, Math.min(100, newWidth))
      setTempWidth(null)
      onWidthChange(newWidth)
    }
    
    document.addEventListener('pointermove', handleDragMove)
    document.addEventListener('pointerup', handleDragEnd)
  }

  const currentWidth = tempWidth !== null ? tempWidth : width

  return (
    <span
      ref={containerRef}
      className={[
        styles.interactiveImageBlock,
        align === 'center' ? styles.interactiveImageCenter : '',
        align === 'right' ? styles.interactiveImageRight : '',
      ].filter(Boolean).join(' ')}
      style={{ position: 'relative' }}
    >
      {isSelected && canEdit && (
        <span className={styles.interactiveImageToolbar}>
          <span className={styles.interactiveImageToolbarGroup}>
            <button
              type="button"
              className={`${styles.interactiveImageButton} ${align === 'left' ? styles.interactiveImageButtonActive : ''}`}
              onClick={(e) => { e.stopPropagation(); onAlignChange('left') }}
            >
              左对齐
            </button>
            <button
              type="button"
              className={`${styles.interactiveImageButton} ${align === 'center' ? styles.interactiveImageButtonActive : ''}`}
              onClick={(e) => { e.stopPropagation(); onAlignChange('center') }}
            >
              居中
            </button>
            <button
              type="button"
              className={`${styles.interactiveImageButton} ${align === 'right' ? styles.interactiveImageButtonActive : ''}`}
              onClick={(e) => { e.stopPropagation(); onAlignChange('right') }}
            >
              居右
            </button>
          </span>
        </span>
      )}
      <span className={styles.interactiveImageFrame}>
        <span 
          className={`${isSelected ? styles.interactiveImageFrameSelected : ''}`}
          style={{ width: `${currentWidth}%`, position: 'relative', display: 'flex', lineHeight: 0 }}
          onClick={(e) => { e.stopPropagation(); canEdit && setIsSelected(true) }}
        >
          <ImageBlock
            src={src}
            alt={alt}
            title={title}
            attachmentCardPath={attachmentCardPath}
            onPreview={(payload) => onPreview({ ...payload, scale: 1, offsetX: 0, offsetY: 0 })}
            className={styles.interactiveImage}
            style={{ width: '100%', height: 'auto', display: 'block', cursor: 'default' }}
          />
          {isSelected && canEdit && (
            <>
              <div 
                className={`${styles.imageResizeHandle} ${styles.imageResizeHandleTL}`}
                onPointerDown={(e) => handleDragStart(e, 'tl')}
              />
              <div 
                className={`${styles.imageResizeHandle} ${styles.imageResizeHandleTR}`}
                onPointerDown={(e) => handleDragStart(e, 'tr')}
              />
              <div 
                className={`${styles.imageResizeHandle} ${styles.imageResizeHandleBL}`}
                onPointerDown={(e) => handleDragStart(e, 'bl')}
              />
              <div 
                className={`${styles.imageResizeHandle} ${styles.imageResizeHandleBR}`}
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
          id ? { ...props, id, className: [props.className, styles.previewHeading].filter(Boolean).join(' ') } : { ...props, className: [props.className, styles.previewHeading].filter(Boolean).join(' ') },
          <>
            <span>{children}</span>
            {id && (
              <button
                type="button"
                className={styles.headingAnchorButton}
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
            className={styles.interactiveCheckbox}
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
        urlTransform={(url) => url}
      >
        {content}
      </ReactMarkdown>
      {previewImage && (
        <div
          className={styles.imagePreviewOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={previewImage.alt ? `图片预览：${previewImage.alt}` : '图片预览'}
          onClick={handleCloseImagePreview}
        >
          <button
            type="button"
            className={styles.imagePreviewClose}
            onClick={handleCloseImagePreview}
            aria-label="关闭图片预览"
          >
            关闭
          </button>
          <button
            type="button"
            className={styles.imagePreviewReset}
            onClick={handlePreviewImageReset}
            aria-label="重置图片缩放和位置"
          >
            重置
          </button>
          <div className={styles.imagePreviewStage} onClick={(event) => event.stopPropagation()}>
            <div
              className={`${styles.imagePreviewCanvas} ${previewImage.scale > 1 ? styles.imagePreviewCanvasDraggable : ''}`}
              onWheel={handlePreviewImageWheel}
              onPointerDown={handlePreviewImagePointerDown}
              onPointerMove={handlePreviewImagePointerMove}
              onPointerUp={handlePreviewImagePointerEnd}
              onPointerCancel={handlePreviewImagePointerEnd}
            >
              <img
                className={styles.imagePreviewImage}
                src={previewImage.src}
                alt={previewImage.alt}
                draggable={false}
                style={{
                  transform: `translate(${previewImage.offsetX}px, ${previewImage.offsetY}px) scale(${previewImage.scale})`,
                }}
              />
            </div>
            {previewImage.alt && (
              <div className={styles.imagePreviewCaption}>{previewImage.alt}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
