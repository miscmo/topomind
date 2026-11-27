/**
 * 智能文档里的「手绘流程图」块（Excalidraw），双模式：
 *
 * - 引用模式（**新数据默认**）：块 props 只存 documentId / 标题快照，场景 JSON 存在
 *   独立的 excalidraw 类型文档里（.exdraw.json）。预览读 storage.readTopoDocument，
 *   双击全屏编辑后写回 storage.writeTopoDocument，并广播外部写 revision 让右栏 /
 *   其它引用同一文档的块同步刷新。父文档正文不再塞入场景数据。
 * - 内嵌模式（**旧档兼容**）：props.scene 非空且没有 documentId 时，完全沿用 v1
 *   行为（场景随 SmartDocumentContent 落盘，退出编辑 updateBlock 一次写回）。
 *   旧数据不迁移、不改写；两条分支共用同一套预览 / 尺寸 / 对齐 / 全屏编辑器。
 *
 * 其余既有取舍不变：官方 exportToSvg 动态 import + svgPreviewQueue LRU；
 * 尺寸 / 对齐存块 props，拖动期间只改本地 CSS，松手才 updateBlock 一次；
 * 编辑期间不 updateBlock（setNodeMarkup 会重建节点视图卸载 portal），草稿暂存在
 * ref，退出时一次性写回，并用 beginMathEditing 推迟 lastModified 写入。
 */
import {
  lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { createReactBlockSpec } from '@blocknote/react'
import {
  EXCALIDRAW_DEFAULT_BACKGROUND,
  excalidrawSceneVersion,
  normalizeExcalidrawDocumentContent,
  serializeExcalidrawDocumentContent,
  type ExcalidrawDocumentContent,
} from '../ExcalidrawDocument/excalidrawDocumentTypes'
import {
  cloneCachedSvg, enqueueSvgRender, putCachedSvg,
} from '../../graph/GraphCanvas/containers/svgPreviewQueue'
import { beginMathEditing, endMathEditing } from './mathEditSession'
import { excalidrawPreviewFilter, useExcalidrawColorMode } from '../ExcalidrawDocument/excalidrawTheme'
import { useStorage } from '../../../core/storage'
import {
  publishDocumentExternalWrite,
  useDocumentExternalRevision,
} from '../services/documentExternalWriteBus'
import { requestOpenDocumentLink } from './docLinkBridge'
import { getExcalidrawDocumentCardPathHint } from './excalidrawDocumentBridge'

export const EXCALIDRAW_BLOCK_TYPE = 'excalidraw'
export const EXCALIDRAW_BLOCK_TITLE = '手绘流程图'
/** 与画布全屏宿主保持同一层级：在标题栏之下、所有工作区浮层之上。 */
const TITLEBAR_HEIGHT = 32
const FULLSCREEN_Z_INDEX = 2800

/** 预览块尺寸约束：宽由父容器钳制，高给一个不至于撑爆版面的上限。 */
const MIN_PREVIEW_WIDTH = 180
const MIN_PREVIEW_HEIGHT = 120
const MAX_PREVIEW_HEIGHT = 900
const DEFAULT_PREVIEW_HEIGHT = 260
type ResizeMode = 'right' | 'bottom' | 'corner'
type BlockSize = { width: number; height: number }
const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

// 唯一允许挂载 Excalidraw 实例的地方；必须 lazy，保证不进文档编辑器 / 主 chunk。
const ExcalidrawBlockEditor = lazy(() =>
  import('./ExcalidrawBlockFullscreenEditor').then((module) => ({
    default: module.ExcalidrawBlockFullscreenEditor,
  })),
)

/** 坏 JSON / 未知版本返回 null：预览显示占位且拒绝打开编辑器，绝不覆盖原始数据。 */
function parseBlockScene(raw: string): ExcalidrawDocumentContent | null {
  if (!raw) return normalizeExcalidrawDocumentContent(null, EXCALIDRAW_BLOCK_TITLE)
  try {
    return normalizeExcalidrawDocumentContent(JSON.parse(raw), EXCALIDRAW_BLOCK_TITLE)
  } catch {
    return null
  }
}

type ExternalSceneStatus = 'loading' | 'ready' | 'missing' | 'unsupported'
interface ExternalSceneState {
  status: ExternalSceneStatus
  scene: string
  cardPath: string
  title: string
}

/**
 * 引用模式：按全库稳定 docId 反查所属节点，再读独立流程图文档的场景。
 *
 * 刻意不把 cardPath 落进块 props：文档可以被移动到别的节点，docId 才是唯一真源。
 * 外部写 revision 变化时重读，保证「右栏改完 / 另一个引用块改完」这里跟着刷新。
 */
function useExcalidrawDocumentScene(documentId: string, revision: number): ExternalSceneState {
  const storage = useStorage()
  const [state, setState] = useState<ExternalSceneState>({
    status: 'loading', scene: '', cardPath: '', title: '',
  })
  const loadedDocIdRef = useRef('')

  useEffect(() => {
    if (!documentId) return undefined
    let cancelled = false
    // 换文档才清旧场景；revision 变化（自己刚写完 / 右栏改完）只是重读，
    // 保持旧预览可见，避免每次写盘都闪一下「正在读取」并重新导出 SVG。
    if (loadedDocIdRef.current !== documentId) {
      loadedDocIdRef.current = documentId
      setState({ status: 'loading', scene: '', cardPath: '', title: '' })
    }
    void (async () => {
      try {
        // cardRef 只是 O(1) 提示：文档被移到别的节点后会失效，主进程自动回落全库扫描。
        const resolved = await storage.resolveDocumentById(documentId, getExcalidrawDocumentCardPathHint())
        if (cancelled) return
        if (resolved.status !== 'ok' || !resolved.cardPath) {
          setState({ status: 'missing', scene: '', cardPath: '', title: resolved.title || '' })
          return
        }
        const raw = await storage.readTopoDocument(resolved.cardPath, documentId)
        if (cancelled) return
        const normalized = normalizeExcalidrawDocumentContent(
          raw, resolved.title || EXCALIDRAW_BLOCK_TITLE,
        )
        setState({
          status: 'ready',
          scene: serializeExcalidrawDocumentContent(normalized),
          cardPath: resolved.cardPath,
          title: resolved.title || normalized.title,
        })
      } catch {
        if (!cancelled) {
          setState({ status: 'unsupported', scene: '', cardPath: '', title: '' })
        }
      }
    })()
    return () => { cancelled = true }
  }, [documentId, revision, storage])

  return state
}

const EXTERNAL_SCENE_PLACEHOLDER: Record<ExternalSceneStatus, string | null> = {
  loading: '正在读取流程图文档…',
  ready: null,
  missing: '流程图文档已移入回收站或不存在',
  unsupported: '流程图文档数据版本不受支持，已保留原始数据',
}

/** 生成可安全重复挂载的 SVG 副本：去固定尺寸、保留 viewBox、等比居中撑满。 */
function prepareBlockSvg(svg: SVGSVGElement): SVGSVGElement {
  const mounted = svg.cloneNode(true) as SVGSVGElement
  const width = Number.parseFloat(mounted.getAttribute('width') ?? '')
  const height = Number.parseFloat(mounted.getAttribute('height') ?? '')
  if (!mounted.getAttribute('viewBox')
    && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    mounted.setAttribute('viewBox', `0 0 ${width} ${height}`)
  }
  mounted.removeAttribute('width')
  mounted.removeAttribute('height')
  mounted.style.setProperty('display', 'block')
  mounted.style.setProperty('width', '100%')
  mounted.style.setProperty('height', '100%')
  mounted.style.setProperty('max-width', '100%')
  mounted.style.setProperty('max-height', '100%')
  mounted.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  return mounted
}

function BlockPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-3 text-center">
      <span className="tm-excalidraw-block-text text-[var(--color-text-muted)]">{text}</span>
    </div>
  )
}

function ExcalidrawBlockPreview({
  blockId, normalized,
}: {
  blockId: string
  normalized: ExcalidrawDocumentContent | null
}) {
  const holderRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const colorMode = useExcalidrawColorMode()
  const version = normalized ? excalidrawSceneVersion(normalized) : -1
  // SVG 内容始终按浅色场景导出，深色靠容器 CSS filter 反转，因此缓存键不带主题：
  // 切软件主题无需重导出，也不会命中另一主题下导出的旧图形。
  const cacheKey = `tm-exdraw-block:${blockId}:${version}`
  const hasElements = (normalized?.scene.elements.length ?? 0) > 0
  const backgroundColor = normalized?.scene.appState.viewBackgroundColor ?? EXCALIDRAW_DEFAULT_BACKGROUND

  useEffect(() => {
    setFailed(false)
    if (!normalized || !hasElements) return
    let cancelled = false
    const attach = (svg: SVGSVGElement) => {
      const holder = holderRef.current
      if (cancelled || !holder) return
      holder.replaceChildren(prepareBlockSvg(svg))
    }
    const cached = cloneCachedSvg(cacheKey)
    if (cached) {
      attach(cached)
      return
    }
    void enqueueSvgRender(async () => {
      // 动态 import：预览与全屏编辑共用同一个 Excalidraw chunk，主 chunk 不受影响。
      const { exportToSvg } = await import('@excalidraw/excalidraw')
      return exportToSvg({
        elements: normalized.scene.elements as unknown as Parameters<typeof exportToSvg>[0]['elements'],
        appState: {
          ...normalized.scene.appState,
          exportBackground: true,
          viewBackgroundColor: normalized.scene.appState.viewBackgroundColor ?? EXCALIDRAW_DEFAULT_BACKGROUND,
          zoom: { value: normalized.scene.appState.zoom ?? 1 },
        } as Parameters<typeof exportToSvg>[0]['appState'],
        files: {},
        exportPadding: 10,
      })
    }).then((svg) => {
      if (cancelled) return
      putCachedSvg(cacheKey, svg)
      attach(svg)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [cacheKey, normalized, hasElements])

  if (!normalized) return <BlockPlaceholder text="流程图数据版本不受支持，已保留原始数据" />
  if (failed) return <BlockPlaceholder text="预览生成失败，双击进入编辑查看" />
  if (!hasElements) return <BlockPlaceholder text="空白白板 · 双击开始绘制" />
  return (
    <div
      ref={holderRef}
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor, filter: excalidrawPreviewFilter(colorMode) }}
      data-tm-excalidraw-block-preview={blockId}
      data-tm-excalidraw-block-theme={colorMode}
      aria-label="手绘流程图预览"
    />
  )
}

function ExcalidrawBlockFullscreenHost({
  blockId, initialScene, onDraftChange, onClose, documentTitle, externalMode,
}: {
  blockId: string
  initialScene: string
  onDraftChange: (serialized: string) => void
  onClose: () => void
  documentTitle?: string
  externalMode?: boolean
}) {
  // 全屏刚打开时焦点还在文档块上；用 window 捕获阶段兜底，保证 Esc 一定能退出。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      // Excalidraw 文本编辑中的 Esc 是「结束文本」，不能顺手关掉整个编辑器。
      const active = document.activeElement as HTMLElement | null
      if (active?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [onClose])

  return createPortal(
    <div
      data-tm-excalidraw-block-editor={blockId}
      className="tm-fade-enter flex flex-col bg-[var(--color-surface)] outline-none"
      style={{
        position: 'fixed',
        top: TITLEBAR_HEIGHT,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: FULLSCREEN_Z_INDEX,
      }}
      tabIndex={-1}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 tm-excalidraw-block-text">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-[var(--color-text-primary)]">{documentTitle || EXCALIDRAW_BLOCK_TITLE}</span>
          <span className="shrink-0 text-[var(--color-text-muted)]">
            {externalMode ? '独立流程图文档 · 退出后写入文档 · 按 Esc 返回' : '全屏编辑 · 退出后写入文档 · 按 Esc 返回'}
          </span>
        </div>
        <button
          type="button"
          data-tm-excalidraw-block-close="true"
          className="shrink-0 rounded border border-[var(--color-border)] px-2.5 py-1 tm-excalidraw-block-close text-[var(--color-text-primary)] hover:bg-[var(--color-hover-bg)]"
          onClick={onClose}
        >
          退出编辑
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <Suspense fallback={
          <div className="flex h-full w-full items-center justify-center tm-excalidraw-block-loading text-[var(--color-text-muted)]">
            正在加载编辑器…
          </div>
        }>
          <ExcalidrawBlockEditor
            blockId={blockId}
            title={documentTitle || EXCALIDRAW_BLOCK_TITLE}
            initialScene={initialScene}
            onChange={onDraftChange}
          />
        </Suspense>
      </div>
    </div>,
    document.body,
  )
}

/** createReactBlockSpec 的 render props 是泛型对象，这里只声明本组件实际用到的字段。 */
interface ExcalidrawBlockRenderProps {
  block: {
    id: string
    props: {
      scene?: string
      /** 引用模式：独立流程图文档的稳定 docId；非空时 scene 一律不参与读写。 */
      documentId?: string
      /** 引用模式：创建瞬间的标题快照，仅用于外部文档尚未读回时的占位显示。 */
      title?: string
      textAlignment?: string
      displayWidth?: number
      displayHeight?: number
    }
  }
  editor: {
    isEditable: boolean
    updateBlock: (block: unknown, update: unknown) => unknown
  }
}

function ExcalidrawBlockRenderer(rawProps: unknown) {
  const props = rawProps as ExcalidrawBlockRenderProps
  const storage = useStorage()
  const documentId = typeof props.block.props.documentId === 'string'
    ? props.block.props.documentId.trim() : ''
  const isRefMode = documentId.length > 0
  const titleSnapshot = typeof props.block.props.title === 'string' ? props.block.props.title : ''
  // 外部写（右栏编辑 / 另一个引用块编辑）后重读，避免预览停留在旧场景。
  const revision = useDocumentExternalRevision(documentId || null)
  const external = useExcalidrawDocumentScene(documentId, revision)
  const legacyScene = typeof props.block.props.scene === 'string' ? props.block.props.scene : ''
  // 引用模式只认外部文档；旧档（无 documentId）继续读 props.scene，行为零变化。
  const scene = isRefMode ? external.scene : legacyScene
  const normalized = useMemo(() => parseBlockScene(scene), [scene])
  const placeholderText = isRefMode ? EXTERNAL_SCENE_PLACEHOLDER[external.status] : null
  const displayTitle = external.title || titleSnapshot || EXCALIDRAW_BLOCK_TITLE
  const initialVersion = useMemo(
    () => normalized ? excalidrawSceneVersion(normalized) : -2,
    [normalized],
  )
  const [editing, setEditing] = useState(false)
  const draftRef = useRef(scene)
  const dirtyRef = useRef(false)

  const externalCardPath = external.cardPath
  const saveExternalScene = useCallback(async (serialized: string) => {
    if (!documentId || !externalCardPath) return
    let content: ExcalidrawDocumentContent
    try {
      content = normalizeExcalidrawDocumentContent(JSON.parse(serialized), displayTitle)
    } catch {
      return
    }
    await storage.writeTopoDocument(externalCardPath, documentId, content)
    // 广播后本块的 revision 会自增并重读；右栏 adapter 同步重挂载，两边不会各自持旧草稿。
    publishDocumentExternalWrite({ documentId, cardPath: externalCardPath, content })
  }, [documentId, externalCardPath, displayTitle, storage])

  const alignment: 'left' | 'center' | 'right' = props.block.props.textAlignment === 'center'
    || props.block.props.textAlignment === 'right'
    ? props.block.props.textAlignment
    : 'left'
  const storedWidth = typeof props.block.props.displayWidth === 'number'
    ? props.block.props.displayWidth : 0
  const storedHeight = typeof props.block.props.displayHeight === 'number'
    ? clampNumber(props.block.props.displayHeight, MIN_PREVIEW_HEIGHT, MAX_PREVIEW_HEIGHT)
    : DEFAULT_PREVIEW_HEIGHT

  // 拖动期间不碰文档：本地草稿驱动 CSS，松手才一次性写块 props。
  const [draftSize, setDraftSize] = useState<BlockSize | null>(null)
  const draftSizeRef = useRef<BlockSize | null>(null)
  const dragRef = useRef<{
    mode: ResizeMode
    startX: number
    startY: number
    startW: number
    startH: number
    maxW: number
  } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const applyDraftSize = (size: BlockSize | null) => {
    draftSizeRef.current = size
    setDraftSize(size)
  }

  const startResize = (event: ReactPointerEvent<HTMLDivElement>, mode: ResizeMode) => {
    if (!props.editor.isEditable || event.button !== 0) return
    const root = rootRef.current
    if (!root) return
    // 手柄不是编辑器内容：拦下默认行为，避免 ProseMirror 把拖动当文本选择。
    event.preventDefault()
    event.stopPropagation()
    const rect = root.getBoundingClientRect()
    const parentWidth = root.parentElement?.getBoundingClientRect().width ?? rect.width
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startW: rect.width,
      startH: rect.height,
      maxW: Math.max(MIN_PREVIEW_WIDTH, Math.round(parentWidth)),
    }
    // 起始若是「撑满容器」，立刻锁定成实际像素宽，拖动过程才不会跳变。
    applyDraftSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('tm-excalidraw-block-is-resizing')
  }

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const width = drag.mode === 'bottom'
      ? drag.startW
      : clampNumber(Math.round(drag.startW + event.clientX - drag.startX), MIN_PREVIEW_WIDTH, drag.maxW)
    const height = drag.mode === 'right'
      ? drag.startH
      : clampNumber(Math.round(drag.startH + event.clientY - drag.startY), MIN_PREVIEW_HEIGHT, MAX_PREVIEW_HEIGHT)
    applyDraftSize({ width: Math.round(width), height: Math.round(height) })
  }

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    document.body.classList.remove('tm-excalidraw-block-is-resizing')
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 已自动释放 */ }
    const size = draftSizeRef.current
    applyDraftSize(null)
    if (!size) return
    try {
      props.editor.updateBlock(props.block, {
        type: EXCALIDRAW_BLOCK_TYPE,
        props: { displayWidth: size.width, displayHeight: size.height },
      })
    } catch {
      // 编辑器可能已随标签卸载；此时尺寸草稿随会话放弃，不能抛到渲染层。
    }
  }

  const size = draftSize ?? { width: storedWidth, height: storedHeight }
  const rootStyle: CSSProperties = {
    width: size.width > 0 ? `${size.width}px` : '100%',
    height: `${size.height}px`,
  }

  // 编辑期间推迟 lastModified 写入：它用 setNodeMarkup 重建块内容节点的视图，
  // 会把挂在块内的全屏 portal 一起卸载（math 块同款坑，见 mathEditSession）。
  useEffect(() => {
    if (!editing) return
    beginMathEditing()
    return () => endMathEditing()
  }, [editing])

  const handleDraftChange = useCallback((serialized: string) => {
    draftRef.current = serialized
    try {
      const next = normalizeExcalidrawDocumentContent(JSON.parse(serialized), EXCALIDRAW_BLOCK_TITLE)
      // Excalidraw 的平移 / 缩放 / 点选也会触发 onChange；用内容版本去重，
      // 避免「只是打开看一眼」就把文档标脏。
      dirtyRef.current = excalidrawSceneVersion(next) !== initialVersion
    } catch {
      dirtyRef.current = true
    }
  }, [initialVersion])

  const commitDraft = useCallback(() => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    if (isRefMode) {
      // 引用模式写外部文档，父文档正文一个字节的场景数据都不落；写失败也绝不
      // 回退成 props.scene 内嵌，否则新旧存储模式会被静默混用。
      void saveExternalScene(draftRef.current).catch(() => {
        console.error('[TopoMind] 写入独立流程图文档失败，草稿已放弃')
      })
      return
    }
    try {
      props.editor.updateBlock(props.block, {
        type: EXCALIDRAW_BLOCK_TYPE,
        props: { scene: draftRef.current },
      })
    } catch {
      // 文档编辑器可能已随标签卸载；此时草稿随会话放弃，不能抛到渲染层。
    }
  }, [isRefMode, saveExternalScene, props.editor, props.block])

  // 切标签 / 关文档导致块组件被卸载时，尽量把未提交的草稿写回。
  const commitRef = useRef(commitDraft)
  commitRef.current = commitDraft
  useEffect(() => () => { commitRef.current() }, [])

  const open = useCallback(() => {
    if (!props.editor.isEditable || normalized === null) return
    // 外部文档没读回来之前不进编辑器，避免用空场景覆盖掉还没加载的内容。
    if (isRefMode && external.status !== 'ready') return
    draftRef.current = scene
    dirtyRef.current = false
    setEditing(true)
  }, [props.editor.isEditable, normalized, isRefMode, external.status, scene])

  const close = useCallback(() => {
    commitDraft()
    setEditing(false)
  }, [commitDraft])

  return (
    <div
      ref={rootRef}
      className="tm-excalidraw-block"
      style={rootStyle}
      data-tm-excalidraw-block={props.block.id}
      data-tm-excalidraw-block-align={alignment}
      data-tm-excalidraw-block-tooltip="双击进入编辑"
      data-tm-excalidraw-block-mode={isRefMode ? 'document' : 'inline'}
    >
      <button
        type="button"
        className="tm-excalidraw-block-preview"
        data-tm-excalidraw-block-open={props.block.id}
        aria-label="双击进入编辑"
        onDoubleClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          open()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          open()
        }}
      >
        {placeholderText
          ? <BlockPlaceholder text={placeholderText} />
          : (
            <ExcalidrawBlockPreview
              blockId={isRefMode ? documentId : props.block.id}
              normalized={normalized}
            />
          )}
      </button>
      {isRefMode ? (
        <div
          className="tm-excalidraw-block-doc-bar"
          data-tm-excalidraw-block-doc={documentId}
          contentEditable={false}
        >
          <span
            className="tm-excalidraw-block-doc-title"
            data-tm-excalidraw-block-doc-title={displayTitle}
          >
            {displayTitle}
          </span>
          <button
            type="button"
            className="tm-excalidraw-block-doc-open"
            data-tm-excalidraw-block-open-doc={documentId}
            title="在右栏打开流程图文档"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              requestOpenDocumentLink({ docId: documentId, title: displayTitle })
            }}
          >
            打开文档
          </button>
        </div>
      ) : null}
      {props.editor.isEditable ? (
        <>
          {(['right', 'bottom', 'corner'] as const).map((mode) => (
            <div
              key={mode}
              className={`tm-excalidraw-block-resize tm-excalidraw-block-resize--${mode}`}
              data-tm-excalidraw-block-resize={mode}
              contentEditable={false}
              aria-hidden="true"
              onPointerDown={(event) => startResize(event, mode)}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onClick={(event) => event.stopPropagation()}
            />
          ))}
        </>
      ) : null}
      {editing ? (
        <ExcalidrawBlockFullscreenHost
          blockId={props.block.id}
          initialScene={scene}
          onDraftChange={handleDraftChange}
          onClose={close}
          documentTitle={isRefMode ? displayTitle : undefined}
          externalMode={isRefMode}
        />
      ) : null}
    </div>
  )
}

export const ExcalidrawBlock = createReactBlockSpec(
  {
    type: EXCALIDRAW_BLOCK_TYPE,
    propSchema: {
      // 旧档内嵌场景：保留默认值与读写链路，绝不迁移 / 改写成引用模式。
      scene: { default: '' },
      // 新数据：只存独立 excalidraw 文档的稳定 docId（空串 = 旧内嵌模式）。
      // 标题只是创建瞬间的快照，显示时以 resolveDocumentById 读到的真实标题为准。
      documentId: { default: '' },
      title: { default: '' },
      // 自定义块不会自动带 BlockNote 的 defaultProps，textAlignment 必须显式声明，
      // 否则对齐按钮 / 块菜单写入的值不会落在 tiptap 节点属性上，重开文档即丢失。
      textAlignment: { default: 'left', values: ['left', 'center', 'right'] },
      // 0 = 撑满正文容器；正数 = 像素宽度。高度始终是像素值。
      displayWidth: { default: 0 },
      displayHeight: { default: DEFAULT_PREVIEW_HEIGHT },
    },
    content: 'none',
  },
  {
    render: ExcalidrawBlockRenderer,
  },
)
