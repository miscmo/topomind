import { memo, useMemo, useRef, useEffect, useState, useCallback, useId, type CSSProperties, type WheelEvent as ReactWheelEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronUp, Copy, Link2, Paperclip, WrapText, X } from 'lucide-react'
import { BlockNoteView } from '@blocknote/mantine'
import { FormattingToolbarController, SideMenuController, SuggestionMenuController, getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from '@blocknote/react'
import { getMultiColumnSlashMenuItems } from '@blocknote/xl-multi-column'
import { filterSuggestionItems } from '@blocknote/core'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { insertMermaid } from 'blocknote-mermaid'
import { autoUpdate, flip, offset, shift, size } from '@floating-ui/react'

import type { SmartDocumentEditorProps } from './types'
import { useSmartDocumentEditorModel } from './model/useSmartDocumentEditorModel'
import { useSmartDocumentAttachmentInsert, type SmartDocumentAttachmentEditor } from './useSmartDocumentAttachmentInsert'
import { SmartDocumentFormattingToolbar } from './components/SmartDocumentFormattingToolbar'
import { ImageAlignToolbar } from './components/ImageAlignToolbar'
import { ExcalidrawBlockToolbar } from './components/ExcalidrawBlockToolbar'
import { SmartDocumentSideMenu } from './components/SmartDocumentSideMenu'
import { EditorTopToolbar } from './components/EditorTopToolbar'
import { customCodeBlockOptions } from './components/CustomCodeBlock'
import { getImagePreviewScale } from './imagePreview'
import { setEditorLinkClickHandler, shouldInterceptLink } from './editorLinkInterceptor'
import {
  readCaretRect,
  requestDocumentLinkPicker,
  setDocumentLinkOpenHandler,
  setDocumentLinkPickerHandler,
  type DocumentLinkPickerRequest,
} from './docLinkBridge'
import { createDocumentLinkInlineContent } from './docLinkModel'
import { DocumentLinkPicker } from './components/DocumentLinkPicker'
import {
  clearExcalidrawDocumentCreateHandler,
  requestCreateExcalidrawDocument,
  setExcalidrawDocumentCardPathHint,
  setExcalidrawDocumentCreateHandler,
  type ExcalidrawDocumentCreateHandler,
} from './excalidrawDocumentBridge'
import { EXCALIDRAW_BLOCK_TITLE } from './excalidrawBlockSupport'
import { publishTopoDocumentListChange } from '../services/topoDocumentListChangeBus'
import { useStorage } from '../../../core/storage'
import { topoDocumentIdFromPath } from '../types/documentTypes'
import type { FSBDocumentCandidate } from '../../../core/fs-backend'
import { getEditorTopInset } from './smartDocumentUtils'
import { buildHeadingNumberStyles, isSameHeadingNumbering } from './headingNumbering'
import { buildEditorLayoutVars, normalizeEditorLayout } from './editorLayout'
import { getAttachmentFileNameFromRef, getAttachmentRefFromBlockProps } from './attachmentPath'

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

/**
 * 附件文件名 tooltip：hover 图片/附件块停稳后锚定显示，纯信息、不可交互，
 * portal 到 body 不进 ProseMirror DOM。附件默认都在当前节点目录内，引用里的
 * 目录段对用户没有意义，因此只保留文件名。
 */
type AttachmentPathMenuState = {
  blockId: string
  fileName: string
  top: number
  left: number
}

/** BlockNote 块的宽松形状（只用到 id / props / children，避免依赖第三方泛型）。 */
type AttachmentBlockNode = {
  id: string
  props?: Record<string, unknown>
  children?: AttachmentBlockNode[]
}

/**
 * 斜杠菜单分组归一化：默认项（中文词典）、多列扩展、mermaid 与自定义项来自不同数据源，
 * group 名混杂中英文（「基本块 / 基础 / 基础区块 / Other / Media」会同时出现），且直接
 * 拼接时同名分组交替出现——菜单按「相邻项 group 变化」插入分组标题并以 group 为 key，
 * 重复出现会报 React duplicate key、同一分组显示多次。
 * 这里把所有项归到一套固定的中文分组，按固定顺序稳定排列（组内保持原顺序），
 * 既解决 key 冲突，也让菜单结构清爽一致。filterSuggestionItems 只过滤不改序，过滤后依然成立。
 */
const SLASH_MENU_GROUP_ORDER = ['标题', '列表', '基础', '媒体', '布局', '高级'] as const
type SlashMenuGroup = (typeof SLASH_MENU_GROUP_ORDER)[number]

const SLASH_MENU_GROUP_BY_KEY: Record<string, SlashMenuGroup> = {
  heading: '标题', heading_2: '标题', heading_3: '标题',
  heading_4: '标题', heading_5: '标题', heading_6: '标题',
  toggle_heading: '标题', toggle_heading_2: '标题', toggle_heading_3: '标题',
  bullet_list: '列表', numbered_list: '列表', check_list: '列表', toggle_list: '列表',
  paragraph: '基础', quote: '基础', divider: '基础', code_block: '基础', table: '基础',
  image: '媒体', video: '媒体', audio: '媒体', file: '媒体', emoji: '媒体',
}

function normalizeSlashMenuItems(items: DefaultReactSuggestionItem[]): DefaultReactSuggestionItem[] {
  const rankOf = (group: string | undefined) => {
    const index = SLASH_MENU_GROUP_ORDER.indexOf(group as SlashMenuGroup)
    return index === -1 ? SLASH_MENU_GROUP_ORDER.length : index
  }
  return items
    .map((item) => {
      const key = (item as { key?: string }).key
      const group = (key && SLASH_MENU_GROUP_BY_KEY[key]) || item.group
      return { ...item, group }
    })
    .sort((a, b) => rankOf(a.group) - rankOf(b.group))
}

const SUPPORTED_CODE_LANGUAGES = Object.entries(customCodeBlockOptions.supportedLanguages ?? {}).map(([value, config]) => ({
  value,
  label: config.name,
}))
const SUPPORTED_CODE_LANGUAGES_MAP = customCodeBlockOptions.supportedLanguages as Record<string, { name: string }>

/**
 * 小于这个值的「记住的阅读位置」不予恢复。
 * 编辑器顶部留白 24px，再加一个块的高度余量；这么小的滚动量本来就不是有效的阅读
 * 位置，恢复它只会把 .bn-editor 的顶部留白滚掉，让首块 H1 看起来被上沿裁掉。
 */
const MIN_RESTORE_SCROLL_TOP = 48

const ATTACHMENT_BLOCK_SELECTOR = '.bn-block-content[data-content-type="image"], .bn-block-content[data-content-type="file"]'

function getAttachmentBlockContainer(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest(ATTACHMENT_BLOCK_SELECTOR) as HTMLElement | null
}

function getAttachmentBlockId(element: HTMLElement): string | null {
  return element.closest('[data-node-type="blockContainer"][data-id], [data-node-type="blockOuter"][data-id]')?.getAttribute('data-id') ?? null
}

function findAttachmentBlock(blocks: readonly AttachmentBlockNode[], id: string): AttachmentBlockNode | null {
  for (const block of blocks) {
    if (block.id === id) return block
    const found = block.children ? findAttachmentBlock(block.children, id) : null
    if (found) return found
  }
  return null
}

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
  const {
    readOnly = false,
    registerGlobalHandlers = true,
    attachmentInsertTargetKey,
    attachmentCardPath,
    onTocActiveChange,
  } = props
  const {
    editor,
    handleChange,
    customTheme,
    defaultEditorStyle,
    headingNumbering,
    headingNumbers,
    updateNumbering,
    layoutPreview,
    setLayoutPreview,
    commitEditorLayout,
    commitEditorStyle,
  } = useSmartDocumentEditorModel(props)

  // BlockNote 编辑器满足附件插入的最小结构契约；此处是唯一的边界收窄点
  useSmartDocumentAttachmentInsert(editor as unknown as SmartDocumentAttachmentEditor, attachmentInsertTargetKey)

  // 已提交值（不含拖动预览）：工具栏只认它，预览值绝不回传，否则滑杆拖动中
  // 会被「外部配置变化」的同步 effect 重置脏标记，松手就不写盘了。
  const committedLayout = useMemo(() => normalizeEditorLayout({
    maxWidth: defaultEditorStyle.contentWidth,
    marginRatio: defaultEditorStyle.contentMarginRatio,
  }), [defaultEditorStyle.contentWidth, defaultEditorStyle.contentMarginRatio])
  // 渲染层：拖动期间用预览值，其余时候用全局配置。
  const effectiveLayout = layoutPreview ?? committedLayout

  const blockNoteViewStyle = useMemo(() => {
    const layout = buildEditorLayoutVars(effectiveLayout)
    return {
      '--topomind-smart-body-font-size': `${defaultEditorStyle.fontSize}px`,
      '--topomind-smart-font-family': customTheme.fontFamily,
      '--topomind-smart-line-height': String(defaultEditorStyle.lineHeight),
      // 内容框 width:100% + max-width:配置上限 → 实际宽度 = min(可用宽度, 上限)；
      // 剩余留白按比例分给 margin-left，margin-right:auto 自动吃下剩余部分。
      '--topomind-smart-content-max-width': layout.maxWidth,
      '--topomind-smart-content-margin-split': layout.marginRatio,
      '--topomind-smart-block-spacing': `${defaultEditorStyle.blockSpacing ?? 6}px`,
      '--topomind-smart-heading-spacing-ratio': String(defaultEditorStyle.headingSpacingRatio ?? 1.5),
      '--topomind-smart-letter-spacing': `${defaultEditorStyle.letterSpacing ?? -0.003}em`,
      '--topomind-smart-font-weight': String(defaultEditorStyle.fontWeight ?? 400),
    } as CSSProperties
  }, [customTheme.fontFamily, effectiveLayout, defaultEditorStyle.fontSize, defaultEditorStyle.lineHeight, defaultEditorStyle.blockSpacing, defaultEditorStyle.headingSpacingRatio, defaultEditorStyle.letterSpacing, defaultEditorStyle.fontWeight])
  // 每个编辑器实例一份独立的编号样式表：规则按 block id 命中，不写 ProseMirror 的 DOM。
  const editorInstanceId = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const headingNumberStyles = useMemo(
    () => (headingNumbering.enabled
      ? buildHeadingNumberStyles(editorInstanceId, headingNumbers)
      : ''),
    [editorInstanceId, headingNumbering.enabled, headingNumbers],
  )
  const editorRootRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // 斜杠菜单浮层 portal 到 body，floating-ui 的 flip/shift/size 必须以正文滚动容器
  // 为边界，才能在顶端/底端呼出时把菜单夹在工具栏与状态栏之间。ref.current 在首次
  // 渲染为 null、且菜单打开由 BlockNote 内部状态驱动不一定触发本组件重渲染，因此用
  // state 持有边界元素：callback ref 挂载后再渲染一次，middleware 才能拿到真实边界。
  const [slashMenuBoundary, setSlashMenuBoundary] = useState<HTMLDivElement | null>(null)
  const attachScrollContainer = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node
    setSlashMenuBoundary(node)
  }, [])
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
  // 附件文件名 tooltip：hover 图片/附件块停稳后弹出。ref 与 state 同步，供 DOM
  // 事件回调读取当前归属（事件监听只注册一次，不能依赖闭包里的 state）。
  const [attachmentPathMenu, setAttachmentPathMenu] = useState<AttachmentPathMenuState | null>(null)
  const attachmentPathMenuRef = useRef<AttachmentPathMenuState | null>(null)
  attachmentPathMenuRef.current = attachmentPathMenu
  // hover-intent：鼠标停在图片/附件块上一小会儿才弹提示，划过不弹。
  const attachmentPathOpenTimerRef = useRef<number | null>(null)
  const pendingAttachmentBlockRef = useRef<string | null>(null)
  // 定时器回调经 ref 取最新的 open 函数，避免与 schedule 的定义顺序/依赖循环。
  const openAttachmentPathMenuRef = useRef<(container: HTMLElement, blockId: string) => void>(() => {})
  // 文档双链：由 `[[` InputRule / 斜杠菜单打开的浮层请求（模块级桥只负责传一次性请求）。
  const [docLinkPicker, setDocLinkPicker] = useState<DocumentLinkPickerRequest | null>(null)
  const onOpenDocumentByDocIdRef = useRef(props.onOpenDocumentByDocId)
  onOpenDocumentByDocIdRef.current = props.onOpenDocumentByDocId
  const currentDocId = attachmentInsertTargetKey ? topoDocumentIdFromPath(attachmentInsertTargetKey) : null
  const storage = useStorage()

  // 「手绘流程图」默认新建独立 excalidraw 文档，再把 documentId 引用插进正文。
  // 创建动作放这里而不是块节点视图：只有本组件同时拿得到当前节点路径与当前文档 id。
  const createExcalidrawDocument = useCallback(async () => {
    if (!attachmentCardPath) return null
    try {
      const siblings = await storage.listTopoDocuments(attachmentCardPath)
      const index = siblings.filter((item) => item.type === 'excalidraw'
        && (item.parentId ?? null) === (currentDocId ?? null)).length + 1
      const title = `${EXCALIDRAW_BLOCK_TITLE} ${index}`
      let created
      try {
        created = await storage.createTopoDocument(attachmentCardPath, {
          type: 'excalidraw',
          title,
          parentId: currentDocId ?? null,
        })
      } catch {
        // 关联视图 / 旧档里当前文档可能不在这份 manifest 中，父文档校验会失败；
        // 降级成根节点文档，仍然保证「新数据一律独立文档」，绝不退回内嵌。
        created = await storage.createTopoDocument(attachmentCardPath, { type: 'excalidraw', title })
      }
      publishTopoDocumentListChange(attachmentCardPath)
      return { documentId: String(created.id), title: String(created.title || title) }
    } catch (error) {
      console.error('[TopoMind] 创建流程图文档失败，已取消插入', error)
      return null
    }
  }, [attachmentCardPath, currentDocId, storage])

  const createExcalidrawDocumentRef = useRef(createExcalidrawDocument)
  createExcalidrawDocumentRef.current = createExcalidrawDocument
  useEffect(() => {
    if (!registerGlobalHandlers) return undefined
    setExcalidrawDocumentCardPathHint(attachmentCardPath)
    const handler: ExcalidrawDocumentCreateHandler = () => createExcalidrawDocumentRef.current()
    setExcalidrawDocumentCreateHandler(handler)
    return () => {
      clearExcalidrawDocumentCreateHandler(handler)
      setExcalidrawDocumentCardPathHint('')
    }
  }, [registerGlobalHandlers, attachmentCardPath])

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
  // 只读预览实例不注册：模块级 handler 是单例，多实例会互相抢占 / 误清理。
  useEffect(() => {
    if (!registerGlobalHandlers) return
    setEditorLinkClickHandler(({ href, rect }) => openLinkMenu(href, rect))
    return () => setEditorLinkClickHandler(null)
  }, [openLinkMenu, registerGlobalHandlers])

  const cancelAttachmentPathOpen = useCallback(() => {
    if (attachmentPathOpenTimerRef.current !== null) {
      window.clearTimeout(attachmentPathOpenTimerRef.current)
      attachmentPathOpenTimerRef.current = null
    }
    pendingAttachmentBlockRef.current = null
  }, [])

  // 纯展示 tooltip：鼠标移开（或滚动/Escape/按下鼠标）立即隐藏，不做延迟保活，
  // 也不需要浮层内 mousedown 白名单——pointer-events:none 让鼠标事件直接穿透。
  const closeAttachmentPathMenu = useCallback(() => {
    cancelAttachmentPathOpen()
    setAttachmentPathMenu(null)
  }, [cancelAttachmentPathOpen])

  // hover-intent：定时器回调才真正打开。若期间鼠标已移走 / 切到别的块，
  // pending 会被清空，这里据此放弃，避免“划过也弹”和弹到已离开的块上。
  const scheduleAttachmentPathOpen = useCallback((container: HTMLElement, blockId: string) => {
    if (pendingAttachmentBlockRef.current === blockId && attachmentPathOpenTimerRef.current !== null) return
    cancelAttachmentPathOpen()
    pendingAttachmentBlockRef.current = blockId
    attachmentPathOpenTimerRef.current = window.setTimeout(() => {
      attachmentPathOpenTimerRef.current = null
      if (pendingAttachmentBlockRef.current !== blockId) return
      pendingAttachmentBlockRef.current = null
      openAttachmentPathMenuRef.current(container, blockId)
    }, 400)
  }, [cancelAttachmentPathOpen])

  const openAttachmentPathMenu = useCallback((container: HTMLElement, blockId: string) => {
    cancelAttachmentPathOpen()
    const block = findAttachmentBlock(editor.document as unknown as AttachmentBlockNode[], blockId)
    if (!block) return
    const props = (block.props ?? {}) as Record<string, unknown>
    // 展示端拿不到全库附件名清单；用当前块的 name 自成一集，兼容只有 name 的旧块。
    const name = typeof props.name === 'string' ? props.name : null
    const attachmentRef = getAttachmentRefFromBlockProps(props, name ? new Set([name]) : new Set<string>())
    if (!attachmentRef) return
    // 附件默认都在当前节点目录内，目录段是冗余信息：只展示文件名。
    const fileName = getAttachmentFileNameFromRef(attachmentRef)

    // tooltip 固定在图片块正下方居中：块上方是媒体块选中后的对齐工具条区域，
    // 放上面会与之重叠。下方空间不足时把提示夹在视口内（仍贴着图片下沿），
    // 不再翻回上方。水平用 translate(-50%) 居中，按最大半宽做视口夹取，
    // 不依赖固定的 340×168 估算（旧操作面板尺寸会让小提示飘得很远）。
    const rect = container.getBoundingClientRect()
    const maxHalfWidth = 140  // 与 .tm-attachment-tooltip 的 max-w-[280px] 对应
    const margin = 8
    const tipHeight = 28
    const minLeft = margin + maxHalfWidth
    const maxLeft = Math.max(minLeft, window.innerWidth - margin - maxHalfWidth)
    const left = Math.max(minLeft, Math.min(rect.left + rect.width / 2, maxLeft))
    const maxTop = Math.max(margin, window.innerHeight - tipHeight - margin)
    const top = Math.max(margin, Math.min(rect.bottom + 6, maxTop))
    setAttachmentPathMenu({ blockId, fileName, top, left })
  }, [editor, cancelAttachmentPathOpen])
  // 供 hover-intent 定时器回调取用（定义顺序在上，随渲染同步为最新闭包）。
  openAttachmentPathMenuRef.current = openAttachmentPathMenu

  // 文档双链 chip 的点击 / `[[` 选择器的打开都从 ProseMirror 深处的节点视图发出来，
  // 通过模块级桥把一次性请求交给本组件；回调走 ref，注册只做一次，不受 props 陈旧影响。
  useEffect(() => {
    if (!registerGlobalHandlers) return
    setDocumentLinkOpenHandler(({ docId }) => {
      onOpenDocumentByDocIdRef.current?.(docId)
    })
    setDocumentLinkPickerHandler((request) => setDocLinkPicker(request))
    return () => {
      setDocumentLinkOpenHandler(null)
      setDocumentLinkPickerHandler(null)
    }
  }, [registerGlobalHandlers])

  const handlePickDocumentLink = useCallback((candidate: FSBDocumentCandidate) => {
    // `[[` 被 InputRule 删掉后光标就停在触发点；选择器浮层用 preventDefault 保住了选区，
    // 因此 insertInlineContent 会准确落在原处。末尾补一个空格，避免紧接着打字贴到 chip 上。
    editor.insertInlineContent([
      createDocumentLinkInlineContent(candidate.docId, candidate.title),
      ' ',
    ] as Parameters<typeof editor.insertInlineContent>[0])
    try { editor.focus() } catch { /* 失焦时插入仍然有效 */ }
  }, [editor])

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

    // 切到另一个文档实例时先回到顶部：BlockNote 初始化时的聚焦 / 浏览器滚动锚定
    // 都可能留下一小段 scrollTop，把 .bn-editor 的 24px 顶部留白滚掉，首块 H1
    // 的字顶看起来被裁。随后再按「有效的」历史位置恢复。
    scrollContainer.scrollTop = 0

    if (attachmentInsertTargetKey) {
      const savedScroll = localStorage.getItem(`topomind_scroll_${attachmentInsertTargetKey}`)
      const savedValue = savedScroll === null ? NaN : parseFloat(savedScroll)
      // 目录跳转曾用滚动容器的 paddingTop（0）算顶部留白，把首块 H1 顶到容器上沿，
      // 存下约 24px 的 scrollTop；这类历史脏值必须过滤，否则每次打开都复现裁切。
      if (Number.isFinite(savedValue) && savedValue >= MIN_RESTORE_SCROLL_TOP) {
        scrollTimer = setTimeout(() => {
          scrollContainer.scrollTop = savedValue
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

  // 光标回到文档首块时，ProseMirror 的 scrollRectIntoView 会把首块顶对齐滚动容器上沿，
  // 把 .bn-editor 的 24px 顶部留白整段滚掉（实测 Ctrl+Home 后 scrollTop 停在 30、H1 距
  // 容器顶 0），表现为首块 H1 上方空白被切、字顶贴住工具栏。scrollMargin / CSS
  // scroll-padding 都拦不住这段由 Transaction.scrollIntoView 触发的对齐，因此在选区
  // 变化后的一帧内检测：光标落在首块且 scrollTop 处于「伪滚动」区间（0, 48] 时归零。
  // 真实阅读位置（>= MIN_RESTORE_SCROLL_TOP）与其它块的光标定位都不受影响。
  useEffect(() => {
    let frame: number | null = null
    const unsubscribe = editor.onSelectionChange(() => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        const scrollContainer = scrollContainerRef.current
        if (!scrollContainer) return
        const top = scrollContainer.scrollTop
        if (top <= 0 || top > MIN_RESTORE_SCROLL_TOP) return
        try {
          const cursorBlockId = editor.getTextCursorPosition().block.id
          if (editor.document[0]?.id === cursorBlockId) {
            scrollContainer.scrollTop = 0
          }
        } catch {
          // 选区尚未稳定时读取失败，忽略即可，不干扰编辑
        }
      })
    })
    return () => {
      unsubscribe()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [editor])

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
      // 不会回退到上一个标题。
      // 与目录跳转共用同一个「内容区顶部」：留白在 .bn-editor 上（24px），
      // 滚动容器自身 paddingTop 是 0，按后者算会让首块标题越过阈值线。
      const padTop = getEditorTopInset(editorRoot)
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

  // hover 图片/附件块停稳后弹出附件文件名 tooltip。mouseover/out 都做同块判定，
  // 避免在图片内部子元素间移动时反复开关；tooltip portal 到 body 且
  // pointer-events:none，鼠标事件直接穿透，不需要移入保活或点击白名单。
  useEffect(() => {
    const editorRoot = editorRootRef.current
    if (!editorRoot) return

    const handleMouseOver = (event: MouseEvent) => {
      if (event.buttons !== 0) return
      const target = event.target
      if (!(target instanceof Element)) return
      const container = getAttachmentBlockContainer(target)
      if (!container || !editorRoot.contains(container)) return
      const blockId = getAttachmentBlockId(container)
      if (!blockId) return
      if (attachmentPathMenuRef.current?.blockId === blockId) return
      // 停留一会儿才打开；块内子元素间移动不会重置计时（同 blockId 直接返回）。
      scheduleAttachmentPathOpen(container, blockId)
    }

    const handleMouseOut = (event: MouseEvent) => {
      const from = getAttachmentBlockContainer(event.target)
      if (!from) return
      const next = getAttachmentBlockContainer(event.relatedTarget)
      if (next !== from) {
        // 真正离开块：撤销尚未触发的打开，已显示的 tooltip 立即隐藏。
        closeAttachmentPathMenu()
      }
    }

    editorRoot.addEventListener('mouseover', handleMouseOver)
    editorRoot.addEventListener('mouseout', handleMouseOut)
    return () => {
      editorRoot.removeEventListener('mouseover', handleMouseOver)
      editorRoot.removeEventListener('mouseout', handleMouseOut)
    }
  }, [scheduleAttachmentPathOpen, closeAttachmentPathMenu])

  useEffect(() => {
    if (!attachmentPathMenu) return
    const ownerDocument = editorRootRef.current?.ownerDocument ?? document
    // tooltip 是 pointer-events:none 的纯展示层，不必为它留 mousedown 白名单。
    const handlePointerDown = () => closeAttachmentPathMenu()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAttachmentPathMenu()
    }
    const handleScroll = () => closeAttachmentPathMenu()
    const scrollContainer = scrollContainerRef.current

    ownerDocument.addEventListener('mousedown', handlePointerDown, true)
    ownerDocument.addEventListener('keydown', handleKeyDown)
    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      ownerDocument.removeEventListener('mousedown', handlePointerDown, true)
      ownerDocument.removeEventListener('keydown', handleKeyDown)
      scrollContainer?.removeEventListener('scroll', handleScroll)
    }
  }, [attachmentPathMenu, closeAttachmentPathMenu])

  // 卸载时清掉 hover-intent 定时器，避免对已卸载组件 setState。
  useEffect(() => () => {
    if (attachmentPathOpenTimerRef.current !== null) window.clearTimeout(attachmentPathOpenTimerRef.current)
  }, [])

  // 切换节点/文档时立即收起，避免上一个文档的附件名浮在新编辑器上。
  useEffect(() => {
    closeAttachmentPathMenu()
  }, [attachmentCardPath, closeAttachmentPathMenu])

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
      title: '数学公式',
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
      aliases: ['math', 'equation', 'latex', 'katex', '公式'],
      group: '高级',
      icon: <span>∑</span>,
      subtext: '插入块级 LaTeX 数学公式',
    }

    const excalidrawItem = {
      title: '手绘流程图',
      onItemClick: () => {
        // 创建外部文档是异步的，光标锚点必须在 await 之前冻结；菜单关闭后
        // 光标会移动，事后取 getTextCursorPosition() 会把块插到别处。
        const anchor = editor.getTextCursorPosition().block
        void (async () => {
          const ref = await requestCreateExcalidrawDocument()
          // 创建失败时不插块：绝不 silently 退化成 props.scene 内嵌（旧档才用那条路径）。
          if (!ref) return
          editor.insertBlocks(
            [
              {
                type: 'excalidraw',
                props: { documentId: ref.documentId, title: ref.title, scene: '' },
              },
            ],
            anchor,
            'after',
          )
        })()
      },
      aliases: ['excalidraw', 'flow', 'draw', '流程图', '白板', '手绘'],
      group: '高级',
      icon: <span>✎</span>,
      subtext: '插入可双击全屏编辑的手绘流程图（Excalidraw），内容存为独立文档',
    }

    const docLinkItem = {
      title: '引用文档',
      onItemClick: () => {
        // 斜杠菜单会先删掉 /query 再回调，等这一帧落定再读光标矩形与打开选择器。
        queueMicrotask(() => {
          requestDocumentLinkPicker({ rect: readCaretRect(), source: 'slash-menu' })
        })
      },
      aliases: ['link', 'doc', 'ref', 'doclink', '引用', '双链', '文档引用'],
      group: '高级',
      icon: <Link2 size={16} />,
      subtext: '插入指向另一篇文档的行内引用（也可直接输入 [[）',
    }

    return normalizeSlashMenuItems([
      ...getDefaultReactSlashMenuItems(editor),
      // 多列扩展自带英文/多语言分组（Basic blocks 等），统一归入「布局」。
      ...getMultiColumnSlashMenuItems(editor).map((item) => ({ ...item, group: '布局' })),
      // mermaid 插件的条目是英文分组与文案，一并归一。
      { ...insertMermaid(), group: '高级', subtext: '插入 Mermaid 图表' },
      mathItem,
      excalidrawItem,
      docLinkItem,
    ] as unknown as DefaultReactSuggestionItem[])
  }, [editor])

  const getSlashMenuItems = useCallback(async (query: string) => (
    filterSuggestionItems(slashMenuItems, query)
  ), [slashMenuItems])

  return (
    <div className="relative h-full w-full min-h-0 flex flex-col" data-tm-editor={editorInstanceId}>
      {headingNumberStyles ? <style dangerouslySetInnerHTML={{ __html: headingNumberStyles }} /> : null}
      <EditorTopToolbar
        numbering={headingNumbering}
        onNumberingChange={updateNumbering}
        layout={committedLayout}
        onLayoutPreview={setLayoutPreview}
        onLayoutCommit={commitEditorLayout}
        editorStyle={defaultEditorStyle}
        onStyleChange={commitEditorStyle}
        disabled={readOnly}
      />
      <div ref={attachScrollContainer} data-paper-bg={defaultEditorStyle.paperBackground ?? 'plain'} className="flex-1 min-h-0 overflow-y-auto tm-smart-editor-scroll" spellCheck={false}>
        <div
          ref={editorRootRef}
        className="smart-document-content relative min-h-full"
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
            floatingUIOptions={{
              useFloatingOptions: {
                placement: 'bottom-start',
                // BlockNote 内置的 autoUpdate 关闭了 elementResize：菜单刚打开时内容
                // 还是 loading 占位（很小），autoPlacement 据此选了「向下」；等内容加载
                // 完、菜单变高后位置不再重算，底部呼出的菜单会被 size 中间件压成一条细缝。
                // 这里恢复对浮层尺寸的监听，内容就绪后重新走一遍定位中间件。
                whileElementsMounted: (reference, floating, update) =>
                  autoUpdate(reference, floating, update, { elementResize: true }),
                // 浮层是 fixed 定位、挂在 body 下，默认边界是整个视口：菜单会压过编辑器
                // 面板的工具栏 / 状态栏。把三个中间件的边界统一收进编辑器滚动容器。
                // 边界取自 state（见 attachScrollContainer），不是 ref.current——后者首帧
                // 为 null 且菜单打开未必触发本组件重渲染，会退化成视口边界。
                middleware: [
                  offset(6),
                  flip({
                    boundary: slashMenuBoundary ?? undefined,
                    padding: 8,
                    // 上下都翻不下时仍优先贴边，配合 size 的高度约束完整显示。
                    fallbackPlacements: ['bottom-start', 'top-start'],
                  }),
                  shift({ boundary: slashMenuBoundary ?? undefined, padding: 8 }),
                  size({
                    boundary: slashMenuBoundary ?? undefined,
                    padding: 8,
                    apply({ elements, availableHeight }) {
                      const maxHeight = `${Math.max(0, Math.floor(availableHeight))}px`
                      elements.floating.style.maxHeight = maxHeight
                      // 面板本体也要限高并内部滚动；portal 包装层可能截断继承链，
                      // 直接写内联值最稳，优先级也高于 CSS 的兜底 max-height。
                      const panel = elements.floating.querySelector<HTMLElement>('.bn-suggestion-menu')
                      if (panel) panel.style.maxHeight = maxHeight
                    },
                  }),
                ],
              },
              elementProps: {
                onMouseDownCapture: (event: ReactMouseEvent) => event.preventDefault(),
                // 浮层 portal 到 body，默认 z-index 80 会被 z-[3000] 的标题栏盖住，抬到其上。
                style: { zIndex: 4000 },
              },
            }}
          />
          <FormattingToolbarController
            formattingToolbar={SmartDocumentFormattingToolbar}
            portalElement={null}
            floatingUIOptions={{
              elementProps: {
                // 工具条 portal 到 body，按钮默认会抢走 contenteditable 的焦点：选区被清、
                // 工具条随即卸载，点「复制」时异步写入还没开始按钮就没了，同时会触发
                // 右栏「焦点移出」自动折叠。与斜杠菜单保持同一策略，在浮层根拦下
                // mousedown 默认行为；但改链接 / 选颜色等 popover 里的输入框必须能聚焦，
                // 否则键盘打不进去，所以放过 input / textarea / contenteditable。
                onMouseDownCapture: (event: ReactMouseEvent) => {
                  const target = event.target
                  if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return
                  event.preventDefault()
                },
              },
            }}
          />
          <SideMenuController
            sideMenu={SmartDocumentSideMenu}
            floatingUIOptions={{
              elementProps: {
                className: 'tm-smart-side-menu-popover',
              },
            }}
          />
          <ImageAlignToolbar />
          <ExcalidrawBlockToolbar />
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
        className={`absolute bottom-8 right-8 w-10 h-10 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-popover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)] transition-all duration-300 z-50 flex items-center justify-center ${
          showBackToTop ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        title="回到顶部"
      >
        <ChevronUp size={24} />
      </button>
      {imagePreview && typeof document !== 'undefined' ? createPortal(
        <div
          className="tm-image-preview tm-fade-enter"
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
          className="tm-link-menu tm-fade-enter fixed z-[1400] min-w-[260px] max-w-[320px] rounded-lg border border-[var(--color-border)] bg-[var(--titlebar-menu-bg)] shadow-[var(--shadow-popover)] backdrop-blur-xl p-2 flex flex-col gap-2"
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
      {attachmentPathMenu && typeof document !== 'undefined' ? createPortal(
        <div
          className="tm-attachment-tooltip tm-fade-enter pointer-events-none fixed z-[1400] flex max-w-[280px] items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-2.5 py-1.5 shadow-[var(--shadow-lg)]"
          style={{
            top: attachmentPathMenu.top,
            left: attachmentPathMenu.left,
            transform: 'translate(-50%, 0)',
          }}
          role="tooltip"
        >
          <Paperclip className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
          <span className="min-w-0 truncate text-[11.5px] font-medium leading-[1.4] text-[var(--color-text-primary)]">
            {attachmentPathMenu.fileName}
          </span>
        </div>,
        document.body,
      ) : null}
      {docLinkPicker && typeof document !== 'undefined' ? (
        <DocumentLinkPicker
          rect={docLinkPicker.rect}
          excludeDocId={currentDocId ?? undefined}
          onPick={handlePickDocumentLink}
          onClose={() => setDocLinkPicker(null)}
        />
      ) : null}
    </div>
  )
}, (prevProps, nextProps) => (
  prevProps.readOnly === nextProps.readOnly
  && prevProps.registerGlobalHandlers === nextProps.registerGlobalHandlers
  && prevProps.attachmentInsertTargetKey === nextProps.attachmentInsertTargetKey
  && prevProps.attachmentCardPath === nextProps.attachmentCardPath
  // 编号配置变化必须放行重渲染，否则开关点了没反应；但不能直接比 value 引用
  // （每次正文编辑都会变，会让整个编辑器跟着输入重渲染），只比归一化后的三项配置值。
  && isSameHeadingNumbering(prevProps.value?.numbering, nextProps.value?.numbering)
  && prevProps.onOpenDocumentByDocId === nextProps.onOpenDocumentByDocId
))
