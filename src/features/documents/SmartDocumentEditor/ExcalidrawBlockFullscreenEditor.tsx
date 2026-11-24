/**
 * 智能文档「手绘流程图」块的全屏编辑器内核。
 *
 * 这是该链路里唯一静态 import @excalidraw/excalidraw 的文件，必须由 React.lazy
 * 加载（见 excalidrawBlockSupport.tsx），否则 Excalidraw 会进文档编辑器 chunk。
 *
 * 刻意不复用画布的 ExcalidrawContainerEditor：那个组件带容器节点的 DOM 契约
 * （data-tm-container-*）与 cardPath / documentId 生命周期，文档块两者都没有，
 * 也不该被容器 GUI 门禁的全局选择器命中。
 */
import { memo, useCallback, useEffect, useMemo } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import {
  EXCALIDRAW_DEFAULT_BACKGROUND,
  EXCALIDRAW_DOCUMENT_SCHEMA,
  EXCALIDRAW_DOCUMENT_VERSION,
  normalizeExcalidrawDocumentContent,
  serializeExcalidrawDocumentContent,
  type ExcalidrawDocumentContent,
} from '../ExcalidrawDocument/excalidrawDocumentTypes'
import { ensureExcalidrawAssets } from '../../graph/GraphCanvas/containers/excalidrawAssets'
import { useExcalidrawColorMode } from '../ExcalidrawDocument/excalidrawTheme'

export interface ExcalidrawBlockFullscreenEditorProps {
  blockId: string
  title: string
  /** 打开瞬间的场景快照；全屏期间父级不写回块 props，所以它不会被后续编辑改掉。 */
  initialScene: string
  /** 每次场景变化都把完整载荷序列化后交给宿主暂存，不直接写文档。 */
  onChange: (serialized: string) => void
}

export const ExcalidrawBlockFullscreenEditor = memo(function ExcalidrawBlockFullscreenEditor({
  blockId, title, initialScene, onChange,
}: ExcalidrawBlockFullscreenEditorProps) {
  // 软件主题切换时只改 Excalidraw 的 theme prop（App.componentDidUpdate 会响应），
  // 不改 appState / 不重挂实例；画布由 Excalidraw 自己的 CSS filter 反转。
  const colorMode = useExcalidrawColorMode()
  // file:// 下字体/图标必须走自托管路径，否则 Excalidraw 会回落 CDN。
  useEffect(() => { ensureExcalidrawAssets() }, [])

  // initialData 只在打开时算一次。编辑期间父级不写回块，Excalidraw 的 onChange
  // 也不会触发本组件重渲染（宿主只改 ref），因此这里不会重挂编辑器实例。
  const initialData = useMemo(() => {
    let normalized: ExcalidrawDocumentContent
    try {
      normalized = normalizeExcalidrawDocumentContent(
        initialScene ? JSON.parse(initialScene) : null, title,
      )
    } catch {
      normalized = normalizeExcalidrawDocumentContent(null, title)
    }
    return {
      elements: normalized.scene.elements as never,
      appState: {
        viewBackgroundColor: normalized.scene.appState.viewBackgroundColor ?? EXCALIDRAW_DEFAULT_BACKGROUND,
        gridSize: normalized.scene.appState.gridSize ?? null,
        scrollX: normalized.scene.appState.scrollX ?? 0,
        scrollY: normalized.scene.appState.scrollY ?? 0,
        // 官方 AppState.zoom 是 { value }，落盘用标量，边界处必须转换。
        zoom: { value: normalized.scene.appState.zoom ?? 1 },
      } as never,
      scrollToContent: false,
    }
  }, [blockId, initialScene, title])

  const handleChange = useCallback((
    elements: readonly unknown[],
    appState: Record<string, unknown>,
  ) => {
    const rawZoom = appState.zoom as number | { value?: number } | undefined
    const zoomValue = typeof rawZoom === 'number'
      ? rawZoom
      : (typeof rawZoom?.value === 'number' ? rawZoom.value : 1)
    const next: ExcalidrawDocumentContent = {
      schema: EXCALIDRAW_DOCUMENT_SCHEMA,
      version: EXCALIDRAW_DOCUMENT_VERSION,
      title,
      scene: {
        elements: elements as ExcalidrawDocumentContent['scene']['elements'],
        appState: {
          viewBackgroundColor: typeof appState.viewBackgroundColor === 'string'
            ? appState.viewBackgroundColor : EXCALIDRAW_DEFAULT_BACKGROUND,
          gridSize: typeof appState.gridSize === 'number' ? appState.gridSize : null,
          // 落盘 theme 是场景自身属性，刻意不跟随软件主题：否则切主题会把文档标脏，
          // 且换设备打开时 UI 偏好会被固化进内容。
          theme: 'light',
          scrollX: typeof appState.scrollX === 'number' ? appState.scrollX : 0,
          scrollY: typeof appState.scrollY === 'number' ? appState.scrollY : 0,
          zoom: zoomValue,
        },
      },
      metadata: { updatedAt: Date.now(), editor: 'excalidraw' },
    }
    onChange(serializeExcalidrawDocumentContent(next))
  }, [title, onChange])

  const handleKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    // Esc 由全屏宿主在 window 捕获阶段收口；Ctrl/Cmd+F 是全局捕获阶段快捷键，
    // 编辑态必须拦下，避免穿透到外层节点搜索。
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.stopPropagation()
    }
  }, [])

  return (
    <div
      className="nodrag nowheel absolute inset-0 overflow-hidden"
      data-tm-excalidraw-block-surface="active"
      data-tm-excalidraw-block-node={blockId}
      data-shortcut-scope="excalidraw"
      onWheelCapture={(event) => { event.stopPropagation() }}
      onKeyDownCapture={handleKeyDownCapture}
      onPointerDown={(event) => { event.stopPropagation() }}
    >
      <Excalidraw
        initialData={initialData}
        onChange={handleChange as never}
        // 全屏层是 body 直属层，焦点未必落在 Excalidraw 内部容器；交给它自己
        // 监听 document，工具快捷键（r/o/v…）才不会在刚打开时失灵。
        handleKeyboardGlobally
        theme={colorMode}
        langCode="zh-CN"
        UIOptions={{ tools: { image: false } }}
      />
    </div>
  )
})
