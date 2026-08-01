import { memo, useMemo, useRef, useEffect, useState, useCallback, type CSSProperties } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, WrapText } from 'lucide-react'
import { BlockNoteView } from '@blocknote/mantine'
import { FormattingToolbarController, SideMenuController, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core'
import { insertMermaid } from 'blocknote-mermaid'

import type { SmartDocumentEditorProps } from './types'
import { useSmartDocumentEditorModel } from './model/useSmartDocumentEditorModel'
import { useSmartDocumentAttachmentInsert } from './useSmartDocumentAttachmentInsert'
import { SmartDocumentFormattingToolbar } from './components/SmartDocumentFormattingToolbar'
import { SmartDocumentSideMenu } from './components/SmartDocumentSideMenu'
import { customCodeBlockOptions } from './components/CustomCodeBlock'

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

export const SmartDocumentEditor = memo(function SmartDocumentEditor(props: SmartDocumentEditorProps) {
  const { readOnly = false, attachmentInsertTargetKey } = props
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
  const toolbarRef = useRef<HTMLDivElement>(null)

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
        const scrollTop = scrollContainer.scrollTop
        persistScrollTimer = setTimeout(() => {
          localStorage.setItem(`topomind_scroll_${attachmentInsertTargetKey}`, scrollTop.toString())
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
    }
  }, [attachmentInsertTargetKey])

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

  return (
    <div className="relative h-full w-full min-h-0">
      <div ref={scrollContainerRef} className="h-full min-h-0 overflow-y-auto bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)]" spellCheck={false}>
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
            getItems={async (query) => {
              const defaultItems = getDefaultReactSlashMenuItems(editor)
              const mermaidItem = insertMermaid()
              const mathItem = {
                title: '块级数学公式 (KaTeX)',
                onItemClick: () => {
                  editor.insertBlocks(
                    [
                      {
                        type: 'math',
                        props: {
                          autoEdit: true,
                        },
                      },
                    ],
                    editor.getTextCursorPosition().block,
                    'after'
                  )
                },
                aliases: ['math', 'equation', 'latex', 'katex'],
                group: 'Media',
                icon: <span>∑</span>,
                subtext: '插入块级 LaTeX 数学公式',
              } as any
              const mergedItems = [
                ...defaultItems,
                mermaidItem,
                mathItem,
              ]
              const filteredItems = filterSuggestionItems(mergedItems, query)
              const mergedGroupCounts = mergedItems.reduce<Record<string, number>>((acc, item) => {
                const group = typeof item.group === 'string' ? item.group : '(none)'
                acc[group] = (acc[group] ?? 0) + 1
                return acc
              }, {})
              const filteredGroupCounts = filteredItems.reduce<Record<string, number>>((acc, item) => {
                const group = typeof item.group === 'string' ? item.group : '(none)'
                acc[group] = (acc[group] ?? 0) + 1
                return acc
              }, {})
              const duplicateMergedGroups = Object.entries(mergedGroupCounts)
                .filter(([, count]) => count > 1)
                .map(([group, count]) => `${group}:${count}`)
              const duplicateFilteredGroups = Object.entries(filteredGroupCounts)
                .filter(([, count]) => count > 1)
                .map(([group, count]) => `${group}:${count}`)
              const duplicateFilteredTitles = Array.from(
                filteredItems.reduce<Map<string, number>>((acc, item) => {
                  const title = typeof item.title === 'string' ? item.title : '(untitled)'
                  acc.set(title, (acc.get(title) ?? 0) + 1)
                  return acc
                }, new Map())
              )
                .filter(([, count]) => count > 1)
                .map(([title, count]) => `${title}:${count}`)

              // Debug logging only in development
              if (import.meta.env.DEV) {
                // #region debug-point A:slash-menu-source-items
                fetch('http://127.0.0.1:7777/event', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sessionId: 'duplicate-media-key',
                    runId: 'pre-fix',
                    hypothesisId: 'A',
                    location: 'SmartDocumentEditor.tsx:getItems:source',
                    msg: '[DEBUG] slash menu source items prepared',
                    data: {
                      query,
                      defaultItemCount: defaultItems.length,
                      defaultMediaTitles: defaultItems
                        .filter((item: any) => item?.group === 'Media')
                        .map((item: any) => item?.title ?? '(untitled)'),
                      mermaidTitle: (mermaidItem as any)?.title ?? '(untitled)',
                      mermaidGroup: (mermaidItem as any)?.group ?? '(none)',
                      mathGroup: mathItem.group,
                      mergedGroupCounts,
                    },
                    ts: Date.now(),
                  }),
                }).catch(() => {})
                // #endregion

                // #region debug-point B:slash-menu-duplicate-groups
                fetch('http://127.0.0.1:7777/event', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sessionId: 'duplicate-media-key',
                    runId: 'pre-fix',
                    hypothesisId: 'B',
                    location: 'SmartDocumentEditor.tsx:getItems:filtered',
                    msg: '[DEBUG] slash menu filtered items analyzed',
                    data: {
                      query,
                      filteredItemCount: filteredItems.length,
                      filteredTitles: filteredItems.map((item: any) => item?.title ?? '(untitled)'),
                      filteredGroups: filteredItems.map((item: any) => item?.group ?? '(none)'),
                      duplicateMergedGroups,
                      duplicateFilteredGroups,
                      duplicateFilteredTitles,
                    },
                    ts: Date.now(),
                  }),
                }).catch(() => {})
                // #endregion

                // #region debug-point C:slash-menu-media-focus
                if (
                  duplicateMergedGroups.some((entry) => entry.startsWith('Media:'))
                  || duplicateFilteredGroups.some((entry) => entry.startsWith('Media:'))
                ) {
                  fetch('http://127.0.0.1:7777/event', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      sessionId: 'duplicate-media-key',
                      runId: 'pre-fix',
                      hypothesisId: 'C',
                      location: 'SmartDocumentEditor.tsx:getItems:media-focus',
                      msg: '[DEBUG] media group duplication detected',
                      data: {
                        query,
                        mergedMediaItems: mergedItems
                          .filter((item: any) => item?.group === 'Media')
                          .map((item: any) => ({
                            title: item?.title ?? '(untitled)',
                            group: item?.group ?? '(none)',
                          })),
                        filteredMediaItems: filteredItems
                          .filter((item: any) => item?.group === 'Media')
                          .map((item: any) => ({
                            title: item?.title ?? '(untitled)',
                            group: item?.group ?? '(none)',
                          })),
                      },
                      ts: Date.now(),
                    }),
                  }).catch(() => {})
                }
                // #endregion
              }

              return filteredItems
            }}
          />
          <FormattingToolbarController formattingToolbar={SmartDocumentFormattingToolbar} portalElement={null} />
          <SideMenuController sideMenu={SmartDocumentSideMenu} portalElement={null} />
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
    </div>
  )
}, (prevProps, nextProps) => (
  prevProps.readOnly === nextProps.readOnly
  && prevProps.attachmentInsertTargetKey === nextProps.attachmentInsertTargetKey
))
