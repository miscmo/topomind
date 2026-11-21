/**
 * 容器只读预览：官方 exportToSvg → 真实 DOM 挂载（不注入 HTML 字符串）。
 *
 * 非可见节点、空场景、版本不受支持、导出失败四种情况都退回静态占位，
 * 绝不影响外层节点本身。编辑器实例在这里完全不挂载。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ContainerPreviewProps } from './containerRenderers'
import {
  excalidrawSceneVersion,
  normalizeExcalidrawDocumentContent,
  type ExcalidrawDocumentContent,
} from '../../../documents/ExcalidrawDocument/excalidrawDocumentTypes'
import { cloneCachedSvg, enqueueSvgRender, putCachedSvg } from './svgPreviewQueue'

function mountSvg(holder: HTMLDivElement | null, svg: SVGSVGElement): void {
  if (!holder) return
  const mounted = svg.cloneNode(true) as SVGSVGElement
  mounted.setAttribute('style', 'display:block;width:100%;height:100%;max-width:100%;max-height:100%')
  mounted.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  holder.replaceChildren(mounted)
}

function PreviewPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-3 text-center text-[11px] leading-4 text-[var(--color-text-muted)]">
      {text}
    </div>
  )
}

export const ContainerSvgPreview = memo(function ContainerSvgPreview({
  nodeId, documentId, content, title, visible,
}: ContainerPreviewProps) {
  const holderRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  const normalized = useMemo<ExcalidrawDocumentContent | null>(() => {
    try { return normalizeExcalidrawDocumentContent(content, title) } catch { return null }
  }, [content, title])

  const version = normalized ? excalidrawSceneVersion(normalized) : -1
  const cacheKey = `${nodeId}:${documentId}:${version}`
  const hasElements = (normalized?.scene.elements.length ?? 0) > 0

  useEffect(() => {
    setFailed(false)
    if (!visible || !normalized || !hasElements) return
    let cancelled = false
    const cached = cloneCachedSvg(cacheKey)
    if (cached) {
      mountSvg(holderRef.current, cached)
      return
    }
    void enqueueSvgRender(async () => {
      // 动态 import：预览与编辑态共用同一个 Excalidraw chunk，主 chunk 不受影响。
      const { exportToSvg } = await import('@excalidraw/excalidraw')
      return exportToSvg({
        elements: normalized.scene.elements as unknown as Parameters<typeof exportToSvg>[0]['elements'],
        appState: {
          ...normalized.scene.appState,
          exportBackground: true,
          viewBackgroundColor: normalized.scene.appState.viewBackgroundColor ?? '#ffffff',
          zoom: { value: normalized.scene.appState.zoom ?? 1 },
        } as Parameters<typeof exportToSvg>[0]['appState'],
        files: {},
        exportPadding: 10,
      })
    }).then((svg) => {
      if (cancelled) return
      putCachedSvg(cacheKey, svg)
      mountSvg(holderRef.current, svg)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [cacheKey, visible, normalized, hasElements])

  if (!visible) return <PreviewPlaceholder text="缩小显示中 · 放大后加载预览" />
  if (!normalized) return <PreviewPlaceholder text="载荷版本不受支持，已保留原始数据" />
  if (failed) return <PreviewPlaceholder text="预览生成失败，双击进入编辑查看" />
  if (!hasElements) return <PreviewPlaceholder text="空白白板 · 双击开始绘制" />

  return (
    <div
      ref={holderRef}
      className="absolute inset-0 overflow-hidden"
      data-tm-container-preview={nodeId}
      aria-label={`${title} 流程图预览`}
    />
  )
})
