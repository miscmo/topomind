/**
 * 唯一允许挂载 Excalidraw 实例的地方。必须由 React.lazy 加载，且只在全屏会话期间挂载。
 *
 * 该组件不自己落盘：onChange 只把归一化后的载荷交给 ContainerFullscreenEditorHost，
 * 由后者做 debounce / close-guard flush，保证「退出 / 切房间 / 切标签 / 关窗」都能收口。
 *
 * v1.4：宿主 portal 到 document.body 的 fixed 层，本组件不再嵌在
 * .react-flow__viewport 的 CSS transform 内，Excalidraw 的指针坐标与视口一致。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ContainerEditorProps } from './containerRenderers'
import {
  normalizeExcalidrawDocumentContent,
  type ExcalidrawDocumentContent,
} from '../../../documents/ExcalidrawDocument/excalidrawDocumentTypes'
import { ensureExcalidrawAssets } from './excalidrawAssets'

interface ExcalidrawApiLike {
  getSceneElements?: () => readonly unknown[]
  getAppState?: () => Record<string, unknown>
  getFiles?: () => Record<string, unknown>
}

export const ExcalidrawContainerEditor = memo(function ExcalidrawContainerEditor({
  nodeId, documentId, content, title, active, onChange,
}: ContainerEditorProps) {
  const apiRef = useRef<ExcalidrawApiLike | null>(null)
  const [versionError, setVersionError] = useState(false)

  useEffect(() => { ensureExcalidrawAssets() }, [])

  const normalized = useMemo<ExcalidrawDocumentContent | null>(() => {
    try { return normalizeExcalidrawDocumentContent(content, title) } catch { return null }
  }, [content, title])

  useEffect(() => { setVersionError(normalized === null) }, [normalized, setVersionError])

  // initialData 只在文档切换时重建；父级 onChange 引起的内容变化绝不重挂编辑器。
  const initialData = useMemo(() => ({
    elements: (normalized?.scene.elements ?? []) as never,
    appState: {
      viewBackgroundColor: normalized?.scene.appState.viewBackgroundColor ?? '#ffffff',
      gridSize: normalized?.scene.appState.gridSize ?? null,
      scrollX: normalized?.scene.appState.scrollX ?? 0,
      scrollY: normalized?.scene.appState.scrollY ?? 0,
      // 官方 AppState.zoom 是 { value }，落盘用标量，边界处必须转换。
      zoom: { value: normalized?.scene.appState.zoom ?? 1 },
    } as never,
    scrollToContent: false,
  }), [documentId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback((
    elements: readonly unknown[],
    appState: Record<string, unknown>,
  ) => {
    if (!active || versionError) return
    const rawZoom = appState.zoom as number | { value?: number } | undefined
    const zoomValue = typeof rawZoom === 'number'
      ? rawZoom
      : (typeof rawZoom?.value === 'number' ? rawZoom.value : 1)
    const next: ExcalidrawDocumentContent = {
      schema: 'topomind.excalidraw-document',
      version: 1,
      title,
      scene: {
        elements: elements as ExcalidrawDocumentContent['scene']['elements'],
        appState: {
          viewBackgroundColor: typeof appState.viewBackgroundColor === 'string'
            ? appState.viewBackgroundColor : '#ffffff',
          gridSize: typeof appState.gridSize === 'number' ? appState.gridSize : null,
          theme: 'light',
          scrollX: typeof appState.scrollX === 'number' ? appState.scrollX : 0,
          scrollY: typeof appState.scrollY === 'number' ? appState.scrollY : 0,
          zoom: zoomValue,
        },
      },
      metadata: { updatedAt: Date.now(), editor: 'excalidraw' },
    }
    onChange(next)
  }, [active, versionError, title, onChange])

  const handleKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    // Esc 由全屏宿主在 window 捕获阶段统一收口（那里还要让位给 Excalidraw 文本编辑）。
    // Ctrl/Cmd+F 是全局捕获阶段快捷键，容器编辑态必须拦下，避免穿透到外层节点搜索。
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.stopPropagation()
    }
  }, [])

  if (versionError) {
    return (
      <div className="flex h-full w-full items-center justify-center px-3 text-center text-[12px] text-[var(--color-text-muted)]">
        载荷版本不受支持，已保留原始数据，不提供编辑入口
      </div>
    )
  }

  return (
    <div
      className="nodrag nowheel absolute inset-0 overflow-hidden"
      data-tm-container-surface={active ? 'active' : 'inactive'}
      data-tm-container-node={nodeId}
      data-shortcut-scope="excalidraw"
      onWheelCapture={(event) => { if (active) event.stopPropagation() }}
      onKeyDownCapture={handleKeyDownCapture}
      onPointerDown={(event) => { if (active) event.stopPropagation() }}
    >
      <Excalidraw
        excalidrawAPI={(api) => { apiRef.current = api as unknown as ExcalidrawApiLike }}
        initialData={initialData}
        onChange={handleChange as never}
        viewModeEnabled={!active}
        // 全屏层是独立的 body 直属层，焦点未必落在 Excalidraw 内部容器；
        // 交给它自己监听 document，工具快捷键（r/o/v…）才不会在刚打开时失灵。
        handleKeyboardGlobally
        theme="light"
        langCode="zh-CN"
        UIOptions={{ tools: { image: false } }}
      />
    </div>
  )
})
