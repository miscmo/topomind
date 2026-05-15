import { memo, useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useStorage } from '../../core/storage'
import styles from './MarkdownViewer.module.css'

marked.setOptions({ breaks: true, gfm: true })

type MermaidApi = typeof import('mermaid').default
let mermaidPromise: Promise<MermaidApi> | null = null

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((module) => {
      module.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
      })
      return module.default
    })
  }
  return mermaidPromise
}

interface MarkdownViewerProps {
  content: string
  compact?: boolean
  className?: string
  attachmentCardPath?: string | null
}

function isLocalAttachmentRef(src: string): boolean {
  const value = src.trim()
  if (!value) return false
  if (/^(?:https?:|data:|blob:|file:|mailto:)/i.test(value)) return false
  if (value.startsWith('/') || value.startsWith('\\')) return false
  return true
}

function collectLocalImageRefs(html: string): string[] {
  const refs = new Set<string>()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    if (isLocalAttachmentRef(src)) refs.add(src.trim())
  })
  return Array.from(refs)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeMermaidCode(raw: string): string {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = raw
  return textarea.value
}

function collectMermaidBlocks(html: string): string[] {
  const blocks: string[] = []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('pre > code').forEach((code) => {
    if (!Array.from(code.classList).some((className) => className === 'language-mermaid' || className === 'mermaid')) return
    blocks.push(normalizeMermaidCode(code.innerHTML))
  })
  return blocks
}

function applyMermaidMap(html: string, mermaidMap?: Record<string, string>): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let changed = false
  doc.querySelectorAll('pre > code').forEach((code) => {
    if (!Array.from(code.classList).some((className) => className === 'language-mermaid' || className === 'mermaid')) return
    changed = true
    const source = normalizeMermaidCode(code.innerHTML)
    const rendered = mermaidMap?.[source]

    const container = doc.createElement('div')
    if (rendered) {
      container.className = styles.mermaid
      container.innerHTML = rendered
    } else {
      container.className = styles.mermaidLoading
      container.innerHTML = '<div class="' + styles.mermaidLoadingSpinner + '"></div><span>图表渲染中...</span>'
    }
    code.parentElement?.replaceWith(container)
  })
  return changed ? doc.body.innerHTML : html
}

function renderSanitizedMarkdownHtml(
  sanitized: string,
  imageMap?: Record<string, string>,
  mermaidMap?: Record<string, string>
): string {
  let html = applyMermaidMap(sanitized, mermaidMap)
  if (!imageMap || Object.keys(imageMap).length === 0) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src')?.trim() ?? ''
    const resolved = imageMap[src]
    if (resolved) img.setAttribute('src', resolved)
  })
  return doc.body.innerHTML
}

export function renderMarkdownToHtml(
  markdown: string,
  imageMap?: Record<string, string>,
  mermaidMap?: Record<string, string>
): string {
  return renderSanitizedMarkdownHtml(DOMPurify.sanitize(marked.parse(markdown) as string), imageMap, mermaidMap)
}

export default memo(function MarkdownViewer({ content, compact = false, className, attachmentCardPath }: MarkdownViewerProps) {
  const storage = useStorage()
  const rawHtml = useMemo(() => DOMPurify.sanitize(marked.parse(content) as string), [content])
  const [imageMap, setImageMap] = useState<Record<string, string>>({})
  const [mermaidMap, setMermaidMap] = useState<Record<string, string>>({})
  const sanitizedHtml = useMemo(() => renderSanitizedMarkdownHtml(rawHtml, imageMap, mermaidMap), [rawHtml, imageMap, mermaidMap])

  useEffect(() => {
    if (!attachmentCardPath) {
      setImageMap({})
      return
    }
    const refs = collectLocalImageRefs(rawHtml)
    if (!refs.length) {
      setImageMap({})
      return
    }

    let cancelled = false
    Promise.all(
      refs.map(async (ref) => {
        const dataUrl = await storage.readAttachmentDataUrl(attachmentCardPath, ref)
        return [ref, dataUrl] as const
      })
    ).then((entries) => {
      if (cancelled) return
      setImageMap(Object.fromEntries(entries.filter(([, dataUrl]) => !!dataUrl)))
    }).catch(() => {
      if (!cancelled) setImageMap({})
    })

    return () => {
      cancelled = true
    }
  }, [attachmentCardPath, rawHtml, storage])

  useEffect(() => {
    const blocks = collectMermaidBlocks(rawHtml)
    if (!blocks.length) {
      setMermaidMap({})
      return
    }

    let cancelled = false
    
    // Check if we need to render anything new. If all blocks are already rendered, do nothing.
    setMermaidMap(prevMap => {
      const needsRender = blocks.some(source => !prevMap[source])
      if (!needsRender) return prevMap

      Promise.all(
        blocks.map(async (source, index) => {
          try {
            if (prevMap[source]) {
              return [source, prevMap[source]] as const
            }
            const mermaid = await loadMermaid()
            const id = `mermaid-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`
            const { svg } = await mermaid.render(id, source)
            return [source, DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })] as const
          } catch (error) {
            return [source, `<pre class="${styles.mermaidError}">${escapeHtml(error instanceof Error ? error.message : 'Mermaid 渲染失败')}</pre>`] as const
          }
        })
      ).then((entries) => {
        if (!cancelled) {
          // Merge with previous entries to ensure we don't drop previously rendered svgs
          setMermaidMap(currentMap => ({ ...currentMap, ...Object.fromEntries(entries) }))
        }
      })
      
      return prevMap // keep previous map while rendering new ones
    })

    return () => {
      cancelled = true
    }
  }, [rawHtml])

  return (
    <div
      className={[styles.viewer, compact ? styles.compact : '', className ?? ''].filter(Boolean).join(' ')}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  )
})
