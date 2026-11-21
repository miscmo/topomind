/**
 * 容器只读预览：官方 exportToSvg → 真实 DOM 挂载（不注入 HTML 字符串）。
 *
 * v1.5「预览适配节点大小」：SVG 自带的是**场景边界**尺寸，不能原样塞进节点。
 * 这里保留 viewBox、去掉固定 width/height，让 SVG 用 100% 撑满节点内容区，
 * 再由 ResizeObserver 把内容区的实测像素回写到 width/height 属性；
 * preserveAspectRatio="xMidYMid meet" 保证整幅白板等比缩放、居中、永不变形或裁切。
 * 用户拖边框改节点尺寸时，预览逐帧跟随，无需重新导出 SVG（导出按 scene version 缓存）。
 *
 * 非可见节点、空场景、版本不受支持、导出失败四种情况都退回静态占位，
 * 绝不影响外层节点本身。编辑器实例在这里完全不挂载。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContainerPreviewProps } from './containerRenderers'
import {
  excalidrawSceneVersion,
  normalizeExcalidrawDocumentContent,
  type ExcalidrawDocumentContent,
} from '../../../documents/ExcalidrawDocument/excalidrawDocumentTypes'
import { cloneCachedSvg, enqueueSvgRender, putCachedSvg } from './svgPreviewQueue'

/** 生成可安全重复挂载的 SVG 副本：只改布局，不碰 viewBox / defs / 字体 / 背景。 */
function prepareSvg(svg: SVGSVGElement): SVGSVGElement {
  const mounted = svg.cloneNode(true) as SVGSVGElement
  const intrinsicWidth = Number.parseFloat(mounted.getAttribute('width') ?? '')
  const intrinsicHeight = Number.parseFloat(mounted.getAttribute('height') ?? '')
  // 极少数版本只给 width/height 不给 viewBox：补一个等价 viewBox，
  // 否则 100% 撑满后内部坐标不会缩放，预览会被裁成左上角一小块。
  if (!mounted.getAttribute('viewBox')
    && Number.isFinite(intrinsicWidth) && Number.isFinite(intrinsicHeight)
    && intrinsicWidth > 0 && intrinsicHeight > 0) {
    mounted.setAttribute('viewBox', `0 0 ${intrinsicWidth} ${intrinsicHeight}`)
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
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [failed, setFailed] = useState(false)

  const normalized = useMemo<ExcalidrawDocumentContent | null>(() => {
    try { return normalizeExcalidrawDocumentContent(content, title) } catch { return null }
  }, [content, title])

  const version = normalized ? excalidrawSceneVersion(normalized) : -1
  const cacheKey = `${nodeId}:${documentId}:${version}`
  const hasElements = (normalized?.scene.elements.length ?? 0) > 0
  const backgroundColor = normalized?.scene.appState.viewBackgroundColor ?? '#ffffff'

  /** 把内容区实测尺寸回写到 SVG 属性，并留一个可供 GUI 断言的诊断标记。 */
  const syncSvgSize = useCallback(() => {
    const holder = holderRef.current
    const svg = svgRef.current
    if (!holder || !svg) return
    const width = holder.clientWidth
    const height = holder.clientHeight
    if (width <= 0 || height <= 0) return
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    holder.setAttribute('data-tm-container-preview-size', `${Math.round(width)}x${Math.round(height)}`)
  }, [])

  const attachSvg = useCallback((svg: SVGSVGElement) => {
    const holder = holderRef.current
    if (!holder) return
    const mounted = prepareSvg(svg)
    svgRef.current = mounted
    holder.replaceChildren(mounted)
    syncSvgSize()
  }, [syncSvgSize])

  // 节点被拖拽 resize / 画布容器尺寸变化时，SVG 立刻跟随。holder 只在完整预览
  // 分支渲染，因此依赖里必须带上所有会让 holder 挂载/卸载的条件。
  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    const observer = new ResizeObserver(() => syncSvgSize())
    observer.observe(holder)
    syncSvgSize()
    return () => observer.disconnect()
  }, [syncSvgSize, visible, normalized, hasElements, failed])

  useEffect(() => {
    setFailed(false)
    if (!visible || !normalized || !hasElements) return
    let cancelled = false
    const cached = cloneCachedSvg(cacheKey)
    if (cached) {
      attachSvg(cached)
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
      attachSvg(svg)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [cacheKey, visible, normalized, hasElements, attachSvg])

  if (!visible) return <PreviewPlaceholder text="缩小显示中 · 放大后加载预览" />
  if (!normalized) return <PreviewPlaceholder text="载荷版本不受支持，已保留原始数据" />
  if (failed) return <PreviewPlaceholder text="预览生成失败，双击进入编辑查看" />
  if (!hasElements) return <PreviewPlaceholder text="空白白板 · 双击开始绘制" />

  return (
    <div
      ref={holderRef}
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor }}
      data-tm-container-preview={nodeId}
      data-tm-container-preview-fit="node"
      aria-label={`${title} 流程图预览`}
    />
  )
})
