/**
 * 图片容器节点内只读预览：图片铺满整个节点矩形，四周零空隙。
 *
 * 与 Excalidraw 预览刻意不同：图片本身就是廉价 DOM，不走 exportToSvg / svgPreviewQueue；
 * 但仍受 ContainerCard 的 LOD visible 闸门 —— 万级节点画布里不能为每个远景节点
 * 都发一次资源 URL 解析 IPC。src 只存 assets/ 相对引用，URL 由主进程校验后返回。
 *
 * 【2026-11-24】objectFit 固定 fill：ContainerCard 会把节点矩形纠正成图片的宽高比，
 * 并锁定后续 resize 的宽高比，所以 fill 既零空隙又不会拉伸变形。载荷里的 fit
 * 只作用于全屏编辑器看大图（那里节点矩形约束不存在），不参与节点预览。
 */
import { memo, useCallback, useMemo, useRef, type SyntheticEvent } from 'react'
import type { ContainerPreviewProps } from '../containerRenderers'
import {
  normalizeImageDocumentContent,
  type ImageDocumentContent,
} from '../../../../documents/ImageDocument/imageDocumentTypes'
import { useCardAssetUrl } from '../cardspec/useCardAssetUrl'

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-3 text-center text-[var(--font-size-sm)] leading-4 text-[var(--color-text-muted)]">
      {text}
    </div>
  )
}

export const ImageContainerPreview = memo(function ImageContainerPreview({
  nodeId, cardPath, content, title, visible, onIntrinsicSize,
}: ContainerPreviewProps) {
  const normalized = useMemo<ImageDocumentContent | null>(() => {
    try { return normalizeImageDocumentContent(content, title) } catch { return null }
  }, [content, title])
  const src = normalized?.src ?? ''
  // Hooks 必须在所有 early return 之前调用；enabled 里带上 visible 与 src，
  // 空态 / 远景节点不发 IPC。
  const { url, state } = useCardAssetUrl(cardPath, src, visible && Boolean(src))
  // 同一张图只上报一次，避免 React 重渲染时反复触发节点尺寸写盘。
  const reportedRef = useRef('')
  const handleLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    const width = img.naturalWidth
    const height = img.naturalHeight
    const key = `${src}:${width}x${height}`
    if (!width || !height || reportedRef.current === key) return
    reportedRef.current = key
    onIntrinsicSize?.(width, height)
  }, [onIntrinsicSize, src])

  if (!visible) return <Placeholder text="缩小显示中 · 放大后加载预览" />
  if (!normalized) return <Placeholder text="载荷版本不受支持，已保留原始数据" />
  if (!src) return <Placeholder text="空白图片容器 · 双击选择图片" />
  if (state === 'loading') return <Placeholder text="图片加载中…" />
  if (!url) return <Placeholder text="图片资源缺失或路径非法" />

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-[var(--color-surface)]"
      data-tm-container-preview={nodeId}
      data-tm-image-preview="true"
      data-tm-image-preview-src={src}
      aria-label={`${title} 图片预览`}
    >
      <img
        src={url}
        alt={normalized.alt || title}
        className="h-full w-full select-none"
        style={{ objectFit: 'fill' }}
        onLoad={handleLoad}
        draggable={false}
      />
    </div>
  )
})
