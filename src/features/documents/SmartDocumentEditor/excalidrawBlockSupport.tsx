/**
 * 智能文档里的「手绘流程图」块（Excalidraw）。
 *
 * v1 设计取舍，刻意保持最小改动面：
 * - 数据：场景 JSON 直接存块 props.scene，随 SmartDocumentContent 一起保存 /
 *   复制 / 删除。不新增文档类型、不碰 .exdraw.json 扩展名表、不碰主进程、
 *   不碰画布容器的节点生命周期。
 * - 预览：官方 exportToSvg 动态 import，走画布同款 svgPreviewQueue 并发闸门 +
 *   LRU；不直接复用 ContainerSvgPreview 组件，避免带出 data-tm-container-* 契约。
 * - 尺寸 / 对齐：displayWidth（0 = 撑满容器）、displayHeight、textAlignment 都存在
 *   块 props 里随文档落盘。拖动边框期间**只**改本地 CSS，松手才 updateBlock 一次：
 *   BlockNote 的 setNodeMarkup 会重建节点视图，逐帧写盘既卡又会卸载预览。
 * - 编辑：双击 → portal 到 body 的全屏层 → lazy 加载 Excalidraw。编辑期间
 *   **不** updateBlock：BlockNote 的 setNodeMarkup 会重建节点视图，把挂在块内的
 *   全屏 portal 一起卸载；因此草稿暂存在 ref，退出（Esc / 按钮）时一次性写回。
 *   编辑期间用 beginMathEditing 推迟 lastModified 写入，防的是同一个坑。
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
  type ExcalidrawDocumentContent,
} from '../ExcalidrawDocument/excalidrawDocumentTypes'
import {
  cloneCachedSvg, enqueueSvgRender, putCachedSvg,
} from '../../graph/GraphCanvas/containers/svgPreviewQueue'
import { beginMathEditing, endMathEditing } from './mathEditSession'
import { excalidrawPreviewFilter, useExcalidrawColorMode } from '../ExcalidrawDocument/excalidrawTheme'

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
  blockId, initialScene, onDraftChange, onClose,
}: {
  blockId: string
  initialScene: string
  onDraftChange: (serialized: string) => void
  onClose: () => void
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
          <span className="truncate font-semibold text-[var(--color-text-primary)]">{EXCALIDRAW_BLOCK_TITLE}</span>
          <span className="shrink-0 text-[var(--color-text-muted)]">全屏编辑 · 退出后写入文档 · 按 Esc 返回</span>
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
            title={EXCALIDRAW_BLOCK_TITLE}
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
  const scene = typeof props.block.props.scene === 'string' ? props.block.props.scene : ''
  const normalized = useMemo(() => parseBlockScene(scene), [scene])
  const initialVersion = useMemo(
    () => normalized ? excalidrawSceneVersion(normalized) : -2,
    [normalized],
  )
  const [editing, setEditing] = useState(false)
  const draftRef = useRef(scene)
  const dirtyRef = useRef(false)

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
    try {
      props.editor.updateBlock(props.block, {
        type: EXCALIDRAW_BLOCK_TYPE,
        props: { scene: draftRef.current },
      })
    } catch {
      // 文档编辑器可能已随标签卸载；此时草稿随会话放弃，不能抛到渲染层。
    }
  }, [props.editor, props.block])

  // 切标签 / 关文档导致块组件被卸载时，尽量把未提交的草稿写回。
  const commitRef = useRef(commitDraft)
  commitRef.current = commitDraft
  useEffect(() => () => { commitRef.current() }, [])

  const open = useCallback(() => {
    if (!props.editor.isEditable || normalized === null) return
    draftRef.current = scene
    dirtyRef.current = false
    setEditing(true)
  }, [props.editor.isEditable, normalized, scene])

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
        <ExcalidrawBlockPreview blockId={props.block.id} normalized={normalized} />
      </button>
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
        />
      ) : null}
    </div>
  )
}

export const ExcalidrawBlock = createReactBlockSpec(
  {
    type: EXCALIDRAW_BLOCK_TYPE,
    propSchema: {
      scene: { default: '' },
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
