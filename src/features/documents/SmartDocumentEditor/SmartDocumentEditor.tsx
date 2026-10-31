import { memo, useMemo, useRef, useEffect, useState, useCallback, type CSSProperties, type WheelEvent as ReactWheelEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronUp, Copy, WrapText, X } from 'lucide-react'
import { BlockNoteView } from '@blocknote/mantine'
import { FormattingToolbarController, SideMenuController, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { getMultiColumnSlashMenuItems } from '@blocknote/xl-multi-column'
import { filterSuggestionItems } from '@blocknote/core'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { insertMermaid } from 'blocknote-mermaid'

import type { SmartDocumentEditorProps } from './types'
import { useSmartDocumentEditorModel } from './model/useSmartDocumentEditorModel'
import { useSmartDocumentAttachmentInsert } from './useSmartDocumentAttachmentInsert'
import { SmartDocumentFormattingToolbar } from './components/SmartDocumentFormattingToolbar'
import { SmartDocumentSideMenu } from './components/SmartDocumentSideMenu'
import { customCodeBlockOptions } from './components/CustomCodeBlock'
import { getImagePreviewScale } from './imagePreview'
import { setEditorLinkClickHandler, shouldInterceptLink } from './editorLinkInterceptor'

import 'katex/dist/katex.min.css'
import '@blocknote/mantine/style.css'
import './SmartDocumentEditor.css'

type HoveredCodeBlockState = {
  blockId: string
  element: HTMLElement
}

type CodeToolbarPosition = {
  top: number
  left: number
  width: number
}

type ImagePreviewState = {
  src: string
  alt: string
}

const SUPPORTED_CODE_LANGUAGES = Object.entries(customCodeBlockOptions.supportedLanguages ?? {}).map(([value, config]) => ({
  value,
  label: config.name,
}))
const SUPPORTED_CODE_LANGUAGES_MAP = customCodeBlockOptions.supportedLanguages as Record<string, { name: string }>

function getCodeBlockContainer(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('.bn-block-content[data-content-type="codeBlock"]')
}

function getCodeBlockId(element: HTMLElement): string | null {
  return element.closest('[data-node-type="blockContainer"][data-id], [data-node-type="blockOuter"][data-id]')?.getAttribute('data-id') ?? null
}

function getCodeBlockLanguage(element: HTMLElement): string {
  const select = element.querySelector('select')
  return select instanceof HTMLSelectElement ? select.value : (customCodeBlockOptions.defaultLanguage ?? 'text')
}

function getCodeBlockText(element: HTMLElement): string {
  const code = element.querySelector('code')
  return code?.textContent ?? ''
}

// 在 Electron 中通过主进程安全打开外部链接（shell.openExternal），
// 非 Electron（web）环境回退到 window.open，避免直接在当前页面内导航
function openExternalLink(href: string) {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (api) {
    void api.invoke('app:openExternal', href)
  } else {
    window.open(href, '_blank', 'noopener,noreferrer')
  }
}

export const SmartDocumentEditor = memo(function SmartDocumentEditor(props: SmartDocumentEditorProps) {
  const { readOnly = false, attachmentInsertTargetKey, onTocActiveChange } = props
  const { editor, handleChange, customTheme, defaultEditorStyle } = useSmartDocumentEditorModel(props)

  useSmartDocumentAttachmentInsert(editor as any, attachmentInsertTargetKey)

  const blockNoteViewStyle = useMemo(() => ({
    '--topomind-smart-body-font-size': `${defaultEditorStyle.fontSize}px`,
    '--topomind-smart-font-family': customTheme.fontFamily,
    '--topomind-smart-line-height': String(defaultEditorStyle.lineHeight),
    '--topomind-smart-content-width': `${defaultEditorStyle.contentWidth ?? 800}px`,
    '--topomind-smart-block-spacing': `${defaultEditorStyle.blockSpacing ?? 6}px`,
    '--topomind-smart-heading-spacing-ratio': String(defaultEditorStyle.headingSpacingRatio ?? 1.5),
    '--topomind-smart-letter-spacing': `${defaultEditorStyle.letterSpacing ?? -0.003}em`,
    '--topomind-smart-font-weight': String(defaultEditorStyle.fontWeight ?? 400),
  }) as CSSProperties, [customTheme.fontFamily, defaultEditorStyle.fontSize, defaultEditorStyle.lineHeight, defaultEditorStyle.contentWidth, defaultEditorStyle.blockSpacing, defaultEditorStyle.headingSpacingRatio, defaultEditorStyle.letterSpacing, defaultEditorStyle.fontWeight])
  const editorRootRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [hoveredCodeBlock, setHoveredCodeBlock] = useState<HoveredCodeBlockState | null>(null)
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const [languageQuery, setLanguageQuery] = useState('')
  const [copiedCodeBlockId, setCopiedCodeBlockId] = useState<string | null>(null)
  const [wrapByBlockId, setWrapByBlockId] = useState<Record<string, boolean>>({})
  const [toolbarPosition, setToolbarPosition] = useState<CodeToolbarPosition | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null)
  const [imagePreviewScale, setImagePreviewScale] = useState(1)
  const [imagePreviewOffset, setImagePreviewOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [imagePreviewDragging, setImagePreviewDragging] = useState(false)
  const imageDragStartRef = useRef<{ mouseX: number; mouseY: number; offsetX: number; offsetY: number } | null>(null)
  const imageDidDragRef = useRef(false)
  const [linkMenu, setLinkMenu] = useState<{ href: string; top: number; left: number } | null>(null)
  const linkMenuRef = useRef<HTMLDivElement>(null)
  const lastLinkMenuOpenRef = useRef<{ t: number; href: string } | null>(null)
  // 滚动联动（scroll-spy）：把当前所在标题的 block id 上抛给目录高亮
  const onTocActiveChangeRef = useRef(onTocActiveChange)
  onTocActiveChangeRef.current = onTocActiveChange
  const toolbarRef = useRef<HTMLDivElement>(null)
  const imagePreviewCloseButtonRef = useRef<HTMLButtonElement>(null)

  const closeImagePreview = useCallback(() => {
    setImagePreview(null)
    setImagePreviewScale(1)
    setImagePreviewOffset({ x: 0, y: 0 })
    setImagePreviewDragging(false)
    imageDragStartRef.current = null
    imageDidDragRef.current = false
  }, [])

  // 图片预览：拖拽平移（pan）。仅在放大（scale>1）时可拖动，缩放回到 1 时复位偏移。
  const handleImagePreviewMouseDown = useCallback((event: ReactMouseEvent<HTMLImageElement>) => {
    if (event.button !== 0 || imagePreviewScale <= 1) return
    event.preventDefault()
    imageDragStartRef.current = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      offsetX: imagePreviewOffset.x,
      offsetY: imagePreviewOffset.y,
    }
    imageDidDragRef.current = false
    setImagePreviewDragging(true)
  }, [imagePreviewScale, imagePreviewOffset])

  const handleImagePreviewMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const start = imageDragStartRef.current
    if (!start) return
    const dx = event.clientX - start.mouseX
    const dy = event.clientY - start.mouseY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) imageDidDragRef.current = true
    setImagePreviewOffset({ x: start.offsetX + dx, y: start.offsetY + dy })
  }, [])

  const handleImagePreviewMouseUp = useCallback(() => {
    imageDragStartRef.current = null
    setImagePreviewDragging(false)
  }, [])

  // 点击遮罩关闭，但拖拽结束后不触发关闭（避免“拖动查看”被误判为点击关闭）。
  const handleImagePreviewOverlayClick = useCallback((_event: ReactMouseEvent<HTMLDivElement>) => {
    if (imageDidDragRef.current) {
      imageDidDragRef.current = false
      return
    }
    closeImagePreview()
  }, [closeImagePreview])

  // 统一的链接菜单打开入口：供 DOM 捕获监听（只读/兜底）与 links.onClick（可编辑）
  // 共用，避免两套机制重复弹出。带极短去抖，防止同一次点击被两个路径各触发一次。
  const openLinkMenu = useCallback((href: string, rect: DOMRect) => {
    const now = Date.now()
    const last = lastLinkMenuOpenRef.current
    if (last && last.href === href && now - last.t < 200) return
    lastLinkMenuOpenRef.current = { t: now, href }

    const menuWidth = 300
    const menuHeight = 96
    const margin = 8
    let top = rect.bottom + 4
    let left = rect.left
    if (top + menuHeight + margin > window.innerHeight) {
      top = rect.top - menuHeight - 4
    }
    if (left + menuWidth + margin > window.innerWidth) {
      left = window.innerWidth - menuWidth - margin
    }
    left = Math.max(margin, left)
    setLinkMenu({ href, top, left })
  }, [])

  // 把“打开链接菜单”的能力注册给编辑器模型层的 links.onClick（可编辑模式下的可靠拦截点）
  useEffect(() => {
    setEditorLinkClickHandler(({ href, rect }) => openLinkMenu(href, rect))
    return () => setEditorLinkClickHandler(null)
  }, [openLinkMenu])

  const handleImagePreviewWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    setImagePreviewScale((currentScale) => {
      const next = getImagePreviewScale(currentScale, event.deltaY)
      // 缩放回 1（未放大）时清除平移偏移，避免残留位移把图片推偏
      if (next <= 1) setImagePreviewOffset({ x: 0, y: 0 })
      return next
    })
  }, [])

  const scrollToTop = useCallback(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    // 使用 requestAnimationFrame 实现自定义的平滑滚动
    // 避免部分浏览器（或 Windows 系统关闭了动画效果时）原生 behavior: 'smooth' 失效变成瞬间跳转的问题
    const start = scrollContainer.scrollTop
    const startTime = performance.now()
    const duration = 400 // 滚动动画持续时间 400ms
    let cancelled = false

    const animateScroll = (currentTime: number) => {
      if (cancelled) return
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)

      // easeOutQuart 缓动函数，实现先快后慢的丝滑减速效果
      const easeProgress = 1 - Math.pow(1 - progress, 4)

      if (scrollContainer) {
        scrollContainer.scrollTop = start * (1 - easeProgress)
      }

      if (progress < 1) {
        requestAnimationFrame(animateScroll)
      }
    }

    const frameId = requestAnimationFrame(animateScroll)

    // Return cleanup function for potential cancellation
    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    }
  }, [])

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    let scrollTimer: ReturnType<typeof setTimeout> | null = null
    let persistScrollTimer: ReturnType<typeof setTimeout> | null = null
    let pendingScrollTop: number | null = null

    const persistScrollTop = () => {
      if (!attachmentInsertTargetKey || pendingScrollTop === null) return
      localStorage.setItem(`topomind_scroll_${attachmentInsertTargetKey}`, pendingScrollTop.toString())
      pendingScrollTop = null
    }

    if (attachmentInsertTargetKey) {
      const savedScroll = localStorage.getItem(`topomind_scroll_${attachmentInsertTargetKey}`)
      if (savedScroll) {
        scrollTimer = setTimeout(() => {
          if (scrollContainer) {
            scrollContainer.scrollTop = parseFloat(savedScroll)
          }
        }, 50)
      }
    }

    const handleScroll = () => {
      if (attachmentInsertTargetKey) {
        if (persistScrollTimer) clearTimeout(persistScrollTimer)
        pendingScrollTop = scrollContainer.scrollTop
        persistScrollTimer = setTimeout(() => {
          persistScrollTop()
          persistScrollTimer = null
        }, 120)
      }
      setShowBackToTop(scrollContainer.scrollTop > 300)
    }
    
    // Initial check
    handleScroll()

    // Use debounced or passive listener
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      if (scrollTimer) clearTimeout(scrollTimer)
      if (persistScrollTimer) clearTimeout(persistScrollTimer)
      persistScrollTop()
    }
  }, [attachmentInsertTargetKey])

  // 滚动联动（scroll-spy）：根据滚动位置计算“当前所在标题”，把其 block id 上抛，
  // 供右上角浮动目录高亮选中态。用 requestAnimationFrame 节流，避免滚动时频繁重排。
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    let frame: number | null = null
    let lastActiveId: string | null | undefined = undefined

    const computeActiveTocId = (): string | null => {
      const editorRoot = editorRootRef.current
      if (!editorRoot) return null
      const containerRect = scrollContainer.getBoundingClientRect()
      const headingEls = Array.from(
        editorRoot.querySelectorAll<HTMLElement>('.bn-block-content[data-content-type="heading"]'),
      )
      if (headingEls.length === 0) return null

      // 阈值线放在容器“内容区顶部”：点击跳转（block:'start' / 直接设置 scrollTop）
      // 会把标题块对齐到这里，所以点击后 scroll-spy 算出的 id 与点击项一致，
      // 不会回退到上一个标题。用容器 paddingTop 动态计算，避免被顶部留白抬高而“差一点不达标”。
      const padTop = parseFloat(getComputedStyle(scrollContainer).paddingTop) || 0
      const OFFSET = padTop + 10

      // 滚到文档底部时，最后一个标题必然是“当前所在”，即使它还没滚到顶部阈值
      const atBottom =
        scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 2
      if (atBottom) {
        const lastEl = headingEls[headingEls.length - 1]
        return lastEl.closest('[data-id]')?.getAttribute('data-id') ?? null
      }

      let activeId: string | null = null
      for (const el of headingEls) {
        // 测量块元素（data-id）而非内部 content：跳转对齐的是块本身，二者差一个块内上边距
        const blockEl = (el.closest('[data-id]') as HTMLElement | null) ?? el
        const rect = blockEl.getBoundingClientRect()
        if (rect.top - containerRect.top <= OFFSET) {
          activeId = blockEl.getAttribute('data-id') ?? activeId
        } else {
          break
        }
      }
      // 没有任何标题越过阈值线（还停在第一个标题之前）时，默认高亮第一个标题，避免“谁都不亮”
      if (activeId === null) {
        activeId = (headingEls[0].closest('[data-id]') as HTMLElement | null)?.getAttribute('data-id') ?? null
      }
      return activeId
    }

    const runCompute = () => {
      frame = null
      const activeId = computeActiveTocId()
      if (activeId !== lastActiveId) {
        lastActiveId = activeId
        onTocActiveChangeRef.current?.(activeId)
      }
    }

    const scheduleCompute = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(runCompute)
    }

    // 初始计算（编辑器内容可能异步布局，延迟一次兜底）
    scheduleCompute()
    const initTimer = window.setTimeout(scheduleCompute, 80)

    scrollContainer.addEventListener('scroll', scheduleCompute, { passive: true })
    window.addEventListener('resize', scheduleCompute)
    return () => {
      scrollContainer.removeEventListener('scroll', scheduleCompute)
      window.removeEventListener('resize', scheduleCompute)
      if (frame !== null) cancelAnimationFrame(frame)
      window.clearTimeout(initTimer)
    }
  }, [])

  useEffect(() => {
    const editorRoot = editorRootRef.current
    if (!editorRoot) return

    const ownerDocument = editorRoot.ownerDocument
    const hideSideMenuOverDocumentSidebar = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-document-sidebar-root]')) return
      editor.getExtension(SideMenuExtension)?.hideMenuIfNotFrozen()
    }

    ownerDocument.addEventListener('mousemove', hideSideMenuOverDocumentSidebar)
    return () => {
      ownerDocument.removeEventListener('mousemove', hideSideMenuOverDocumentSidebar)
    }
  }, [editor])

  useEffect(() => {
    const editorRoot = editorRootRef.current
    if (!editorRoot) return

    const handleImageDoubleClick = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLImageElement)) return
      if (!event.target.closest('.bn-block-content[data-content-type="image"]')) return

      const src = event.target.currentSrc || event.target.src
      if (!src) return

      event.preventDefault()
      event.stopPropagation()
      setImagePreview({
        src,
        alt: event.target.alt || '文档图片',
      })
      setImagePreviewScale(1)
      setImagePreviewOffset({ x: 0, y: 0 })
    }

    editorRoot.addEventListener('dblclick', handleImageDoubleClick)
    return () => {
      editorRoot.removeEventListener('dblclick', handleImageDoubleClick)
    }
  }, [])

  useEffect(() => {
    const editorRoot = editorRootRef.current
    if (!editorRoot) return

    // 兜底拦截：只读模式下 BlockNote 的 handleClick 会提前 return false（不调用
    // links.onClick），浏览器会对 <a href> 走默认跳转；可编辑模式下若 links.onClick
    // 因故未生效，此处也能兜住。命中链接则阻止默认跳转并弹出菜单。
    const handleLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest('a[href]')
      if (!anchor || !editorRoot.contains(anchor)) return

      const href = anchor.getAttribute('href') ?? ''
      if (!shouldInterceptLink(href)) return

      event.preventDefault()
      event.stopPropagation()
      openLinkMenu(href, anchor.getBoundingClientRect())
    }

    editorRoot.addEventListener('click', handleLinkClick, true)
    return () => {
      editorRoot.removeEventListener('click', handleLinkClick, true)
    }
  }, [openLinkMenu])

  useEffect(() => {
    if (!linkMenu) return

    const ownerDocument = editorRootRef.current?.ownerDocument ?? document
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('.tm-link-menu')) return
      setLinkMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLinkMenu(null)
    }
    const scrollContainer = scrollContainerRef.current
    const handleScroll = () => setLinkMenu(null)

    ownerDocument.addEventListener('mousedown', handlePointerDown, true)
    ownerDocument.addEventListener('keydown', handleKeyDown)
    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      ownerDocument.removeEventListener('mousedown', handlePointerDown, true)
      ownerDocument.removeEventListener('keydown', handleKeyDown)
      scrollContainer?.removeEventListener('scroll', handleScroll)
    }
  }, [linkMenu])

  useEffect(() => {
    if (!imagePreview) return

    const ownerDocument = editorRootRef.current?.ownerDocument ?? document
    const previousBodyOverflow = ownerDocument.body.style.overflow
    ownerDocument.body.style.overflow = 'hidden'
    imagePreviewCloseButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeImagePreview()
    }

    ownerDocument.addEventListener('keydown', handleKeyDown)
    return () => {
      ownerDocument.removeEventListener('keydown', handleKeyDown)
      ownerDocument.body.style.overflow = previousBodyOverflow
    }
  }, [closeImagePreview, imagePreview])

  useEffect(() => {
    const ownerDocument = editorRootRef.current?.ownerDocument ?? document
    const handleContextMenu = (e: MouseEvent) => {
      const editorRoot = editorRootRef.current
      if (!editorRoot || !(e.target instanceof Node) || !editorRoot.contains(e.target)) return

      // 当用户在编辑器内右键时，触发一个鼠标左键点击事件
      // 这可以强制 BlockNote/Prosemirror 将光标移动到鼠标当前悬停的块
      // 从而解决右键粘贴时，内容没有插入到鼠标位置而是插入到旧光标位置的 bug
      if (e.target instanceof Element) {
        // 只有当目标是文本节点或者普通的段落容器时，才模拟左键点击
        // 避免在非文本块（如图片、表格、divider）上触发导致 ProseMirror 选区越界崩溃
        const isSafeTarget = e.target.closest('.bn-inline-content') || e.target.closest('[data-content-type="paragraph"]') || e.target.closest('[data-content-type="heading"]')
        
        if (isSafeTarget) {
          const mousedownEvent = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: e.clientX,
            clientY: e.clientY,
            button: 0,
          })
          e.target.dispatchEvent(mousedownEvent)
        }
      }
    }

    ownerDocument.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      ownerDocument.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [])

  useEffect(() => {
    const editorRoot = editorRootRef.current
    if (!editorRoot) return

    let positionFrame: number | null = null
    const syncToolbarPosition = (element: HTMLElement) => {
      if (positionFrame !== null) cancelAnimationFrame(positionFrame)
      positionFrame = requestAnimationFrame(() => {
        positionFrame = null
        const rootRect = editorRoot.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        setToolbarPosition((previous) => {
          const next = {
            top: elementRect.top - rootRect.top + 8,
            left: elementRect.left - rootRect.left + 12,
            width: Math.max(elementRect.width - 24, 120),
          }
          return previous && previous.top === next.top && previous.left === next.left && previous.width === next.width ? previous : next
        })
      })
    }

    const updateHoveredCodeBlock = (target: EventTarget | null) => {
      if (target instanceof Element && target.closest('.tm-code-toolbar')) {
        return
      }

      const element = getCodeBlockContainer(target)
      if (!element) {
        if (!languageMenuOpen) {
          setHoveredCodeBlock(null)
          setToolbarPosition(null)
        }
        return
      }

      const blockId = getCodeBlockId(element)
      if (!blockId) return

      syncToolbarPosition(element)

      setHoveredCodeBlock((prev) => {
        if (prev?.blockId === blockId && prev.element === element) return prev
        return { blockId, element }
      })
    }

    const handleMouseMove = (event: MouseEvent) => {
      updateHoveredCodeBlock(event.target)
    }

    const handleMouseLeave = () => {
      if (!languageMenuOpen) {
        setHoveredCodeBlock(null)
        setToolbarPosition(null)
      }
    }

    editorRoot.addEventListener('mousemove', handleMouseMove)
    editorRoot.addEventListener('mouseleave', handleMouseLeave)
    return () => {
      editorRoot.removeEventListener('mousemove', handleMouseMove)
      editorRoot.removeEventListener('mouseleave', handleMouseLeave)
      if (positionFrame !== null) cancelAnimationFrame(positionFrame)
    }
  }, [languageMenuOpen])

  useEffect(() => {
    if (!hoveredCodeBlock) return

    let positionFrame: number | null = null
    const syncToolbarPosition = () => {
      if (positionFrame !== null) cancelAnimationFrame(positionFrame)
      positionFrame = requestAnimationFrame(() => {
        positionFrame = null
        const editorRoot = editorRootRef.current
        if (!editorRoot) return
        const rootRect = editorRoot.getBoundingClientRect()
        const elementRect = hoveredCodeBlock.element.getBoundingClientRect()
        setToolbarPosition((previous) => {
          const next = {
            top: elementRect.top - rootRect.top + 8,
            left: elementRect.left - rootRect.left + 12,
            width: Math.max(elementRect.width - 24, 120),
          }
          return previous && previous.top === next.top && previous.left === next.left && previous.width === next.width ? previous : next
        })
      })
    }

    syncToolbarPosition()

    const scrollContainer = scrollContainerRef.current
    scrollContainer?.addEventListener('scroll', syncToolbarPosition, { passive: true })
    window.addEventListener('resize', syncToolbarPosition)
    return () => {
      scrollContainer?.removeEventListener('scroll', syncToolbarPosition)
      window.removeEventListener('resize', syncToolbarPosition)
      if (positionFrame !== null) cancelAnimationFrame(positionFrame)
    }
  }, [hoveredCodeBlock, languageMenuOpen])

  useEffect(() => {
    const ownerDocument = editorRootRef.current?.ownerDocument ?? document
    if (!languageMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const clickedInsideToolbar = event.target.closest('.tm-code-toolbar')
      if (!clickedInsideToolbar) {
        setLanguageMenuOpen(false)
        setLanguageQuery('')
      }
    }

    ownerDocument.addEventListener('mousedown', handlePointerDown, true)
    return () => {
      ownerDocument.removeEventListener('mousedown', handlePointerDown, true)
    }
  }, [languageMenuOpen])

  // 正文拖选进行中临时禁用块侧边菜单的指针事件：拖选时鼠标若精确压到块编辑按钮，
  // ProseMirror 坐标反查会命中按钮 DOM（不在可编辑内容树），回退到文档开头，
  // 表现为“选中上方所有行”。仅在正文内 mousedown 触发的拖选期间禁用按钮指针事件，
  // 拖选经过按钮时坐标落到下方正文、反查到当前块开头；点击/拖拽按钮本身不受影响。
  useEffect(() => {
    const editorRoot = editorRootRef.current
    if (!editorRoot) return
    const ownerDocument = editorRoot.ownerDocument ?? document
    const body = ownerDocument.body

    const clear = () => body.classList.remove('tm-text-selecting')

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element)) return
      // 每次按下先清掉“正文拖选”状态，避免任何边界下残留卡死导致按钮 permanently 不可点
      clear()
      // 命中区（按钮/侧菜单）内的按下＝点按钮或拖块，不触发拖选禁用
      if (target.closest('.tm-smart-side-menu-hit-area')) return
      // 只在可编辑正文内按下才算正文拖选
      if (!target.closest('.bn-editor') && !target.closest('.ProseMirror')) return
      body.classList.add('tm-text-selecting')
    }

    ownerDocument.addEventListener('mousedown', handleMouseDown, true)
    ownerDocument.addEventListener('mouseup', clear, true)
    ownerDocument.addEventListener('dragend', clear, true)
    window.addEventListener('blur', clear)
    return () => {
      ownerDocument.removeEventListener('mousedown', handleMouseDown, true)
      ownerDocument.removeEventListener('mouseup', clear, true)
      ownerDocument.removeEventListener('dragend', clear, true)
      window.removeEventListener('blur', clear)
      body.classList.remove('tm-text-selecting')
    }
  }, [])

  useEffect(() => {
    const editorRoot = editorRootRef.current
    if (!editorRoot) return

    const codeBlocks = Array.from(
      editorRoot.querySelectorAll<HTMLElement>('.bn-block-content[data-content-type="codeBlock"]')
    )

    for (const element of codeBlocks) {
      const blockId = getCodeBlockId(element)
      if (!blockId) continue
      element.classList.toggle('tm-code-wrap', Boolean(wrapByBlockId[blockId]))
    }
  }, [wrapByBlockId, hoveredCodeBlock, handleChange])

  const hoveredLanguage = hoveredCodeBlock ? getCodeBlockLanguage(hoveredCodeBlock.element) : (customCodeBlockOptions.defaultLanguage ?? 'text')

  const filteredLanguages = useMemo(() => {
    const query = languageQuery.trim().toLowerCase()
    if (!query) return SUPPORTED_CODE_LANGUAGES
    return SUPPORTED_CODE_LANGUAGES.filter((language) =>
      language.label.toLowerCase().includes(query) || language.value.toLowerCase().includes(query)
    )
  }, [languageQuery])

  const hoveredLanguageLabel = SUPPORTED_CODE_LANGUAGES_MAP[hoveredLanguage]?.name ?? hoveredLanguage

  const handleCopyCodeBlock = useCallback(async () => {
    if (!hoveredCodeBlock) return
    const text = getCodeBlockText(hoveredCodeBlock.element)
    await navigator.clipboard.writeText(text)
    setCopiedCodeBlockId(hoveredCodeBlock.blockId)
    window.setTimeout(() => {
      setCopiedCodeBlockId((prev) => (prev === hoveredCodeBlock.blockId ? null : prev))
    }, 1600)
  }, [hoveredCodeBlock])

  const handleToggleWrap = useCallback(() => {
    if (!hoveredCodeBlock) return
    setWrapByBlockId((prev) => ({
      ...prev,
      [hoveredCodeBlock.blockId]: !prev[hoveredCodeBlock.blockId],
    }))
  }, [hoveredCodeBlock])

  const handleLanguageChange = useCallback((language: string) => {
    if (!hoveredCodeBlock) return
    editor.updateBlock(hoveredCodeBlock.blockId, {
      props: { language },
    })
    setLanguageMenuOpen(false)
    setLanguageQuery('')
  }, [editor, hoveredCodeBlock])

  const slashMenuItems = useMemo(() => {
    const mathItem = {
      title: '块级数学公式 (KaTeX)',
      onItemClick: () => {
        editor.insertBlocks(
          [
            {
              type: 'math',
              props: { autoEdit: true },
            },
          ],
          editor.getTextCursorPosition().block,
          'after',
        )
      },
      aliases: ['math', 'equation', 'latex', 'katex'],
      group: 'Media',
      icon: <span>∑</span>,
      subtext: '插入块级 LaTeX 数学公式',
    } as any

    return [
      ...getDefaultReactSlashMenuItems(editor),
      ...getMultiColumnSlashMenuItems(editor),
      insertMermaid(),
      mathItem,
    ]
  }, [editor])

  const getSlashMenuItems = useCallback(async (query: string) => (
    filterSuggestionItems(slashMenuItems, query)
  ), [slashMenuItems])

  return (
    <div className="relative h-full w-full min-h-0">
      <div ref={scrollContainerRef} data-paper-bg={defaultEditorStyle.paperBackground ?? 'plain'} className="h-full min-h-0 overflow-y-auto bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] tm-smart-editor-scroll" spellCheck={false}>
        <div
          ref={editorRootRef}
        className="smart-document-content relative min-h-full [&_.bn-container]:!bg-transparent [&_.bn-container]:!pl-8 [&_.bn-container]:!pr-4 [&_.bn-container]:!py-0 [&_.bn-container]:!mx-auto [&_.bn-container]:!w-full [&_.bn-editor]:!min-h-0 [&_.bn-editor]:!px-0 [&_.bn-editor]:!py-4 [&_.bn-editor]:!w-full [&_.bn-side-menu]:!gap-0 [&_.bn-editor]:!bg-transparent"
        style={{ color: 'var(--color-text-primary)' }}
      >
        <BlockNoteView
          editor={editor}
          editable={!readOnly}
          theme={customTheme}
          style={blockNoteViewStyle}
          portalElements={{ default: null }}
          onChange={handleChange}
          formattingToolbar={false}
          sideMenu={false}
          slashMenu={false}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            portalElement={null}
            getItems={getSlashMenuItems}
          />
          <FormattingToolbarController formattingToolbar={SmartDocumentFormattingToolbar} portalElement={null} />
          <SideMenuController
            sideMenu={SmartDocumentSideMenu}
            floatingUIOptions={{
              elementProps: {
                className: 'tm-smart-side-menu-popover',
              },
            }}
          />
        </BlockNoteView>
        {hoveredCodeBlock && toolbarPosition ? (
          <div
            ref={toolbarRef}
            className="tm-code-toolbar"
            contentEditable={false}
            style={{ top: `${toolbarPosition.top}px`, left: `${toolbarPosition.left}px`, width: `${toolbarPosition.width}px` }}
          >
            <div className="tm-code-toolbar__row">
              <div className="tm-code-toolbar__menu-shell">
                <button
                  type="button"
                  className="tm-code-toolbar__button tm-code-toolbar__button--language"
                  onClick={() => setLanguageMenuOpen((prev) => !prev)}
                  disabled={readOnly}
                >
                  <span className="tm-code-toolbar__button-label">
                    {hoveredLanguageLabel}
                  </span>
                  <ChevronDown size={14} />
                </button>
                {languageMenuOpen ? (
                  <div className="tm-code-toolbar__menu">
                    <div className="tm-code-toolbar__search-shell">
                      <input
                        value={languageQuery}
                        onChange={(event) => setLanguageQuery(event.target.value)}
                        placeholder="搜索语言"
                        className="tm-code-toolbar__search"
                      />
                    </div>
                    <div className="tm-code-toolbar__menu-list">
                      {filteredLanguages.map((language) => (
                        <button
                          key={language.value}
                          type="button"
                          className={`tm-code-toolbar__menu-item ${language.value === hoveredLanguage ? 'is-active' : ''}`}
                          onClick={() => handleLanguageChange(language.value)}
                        >
                          <span>{language.label}</span>
                          {language.value === hoveredLanguage ? <Check size={14} /> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="tm-code-toolbar__actions">
                <button
                  type="button"
                  className={`tm-code-toolbar__button ${wrapByBlockId[hoveredCodeBlock.blockId] ? 'is-active' : ''}`}
                  onClick={handleToggleWrap}
                  title="自动换行"
                >
                  <WrapText size={14} />
                </button>
                <button
                  type="button"
                  className="tm-code-toolbar__button"
                  onClick={() => void handleCopyCodeBlock()}
                  title="复制代码"
                >
                  {copiedCodeBlockId === hoveredCodeBlock.blockId ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      </div>
      
      {/* 回到顶部按钮 */}
      <button
        onClick={scrollToTop}
        className={`absolute bottom-8 right-8 w-10 h-10 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] shadow-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)] transition-all duration-300 z-50 flex items-center justify-center ${
          showBackToTop ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        title="回到顶部"
      >
        <ChevronUp size={24} />
      </button>
      {imagePreview && typeof document !== 'undefined' ? createPortal(
        <div
          className="tm-image-preview"
          role="dialog"
          aria-modal="true"
          aria-label="图片全屏预览"
          onClick={handleImagePreviewOverlayClick}
          onWheel={handleImagePreviewWheel}
          onMouseMove={handleImagePreviewMouseMove}
          onMouseUp={handleImagePreviewMouseUp}
          onMouseLeave={handleImagePreviewMouseUp}
        >
          <button
            ref={imagePreviewCloseButtonRef}
            type="button"
            className="tm-image-preview__close"
            aria-label="关闭图片预览"
            title="关闭"
            onClick={closeImagePreview}
          >
            <X size={24} />
          </button>
          <div className="tm-image-preview__viewport">
            <img
              className="tm-image-preview__image"
              src={imagePreview.src}
              alt={imagePreview.alt}
              draggable={false}
              style={{
                transform: `translate(${imagePreviewOffset.x}px, ${imagePreviewOffset.y}px) scale(${imagePreviewScale})`,
                cursor: imagePreviewDragging ? 'grabbing' : imagePreviewScale > 1 ? 'grab' : 'default',
                transition: imagePreviewDragging ? 'none' : undefined,
              }}
              onMouseDown={handleImagePreviewMouseDown}
              onClick={(event) => { event.stopPropagation(); imageDidDragRef.current = false }}
            />
          </div>
          <div className="tm-image-preview__hint" aria-live="polite">
            滚轮缩放 · {Math.round(imagePreviewScale * 100)}%{imagePreviewScale > 1 ? ' · 拖拽平移' : ''}
          </div>
        </div>,
        document.body,
      ) : null}
      {linkMenu && typeof document !== 'undefined' ? createPortal(
        <div
          ref={linkMenuRef}
          className="tm-link-menu fixed z-[1400] min-w-[260px] max-w-[320px] rounded-lg border border-[var(--color-border)] bg-[var(--titlebar-menu-bg)] shadow-[var(--shadow-popover)] backdrop-blur-xl p-2 flex flex-col gap-2"
          style={{ top: linkMenu.top, left: linkMenu.left }}
          role="menu"
          aria-label="链接操作"
        >
          <div
            className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)] break-all max-h-[3em] overflow-hidden"
            title={linkMenu.href}
          >
            {linkMenu.href}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 h-8 rounded-md bg-[var(--color-primary)] text-[var(--color-text-inverse)] text-[12px] font-medium cursor-pointer border-none transition-colors hover:opacity-90"
              onClick={() => {
                openExternalLink(linkMenu.href)
                setLinkMenu(null)
              }}
            >
              打开链接
            </button>
            <button
              type="button"
              className="flex-1 h-8 rounded-md border border-[var(--color-border)] bg-transparent text-[var(--color-text-primary)] text-[12px] cursor-pointer transition-colors hover:bg-[var(--color-hover-bg)]"
              onClick={() => {
                void navigator.clipboard.writeText(linkMenu.href)
                setLinkMenu(null)
              }}
            >
              复制链接
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}, (prevProps, nextProps) => (
  prevProps.readOnly === nextProps.readOnly
  && prevProps.attachmentInsertTargetKey === nextProps.attachmentInsertTargetKey
))
