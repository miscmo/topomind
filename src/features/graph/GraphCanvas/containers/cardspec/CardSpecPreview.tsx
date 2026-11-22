/**
 * CardSpec 节点内只读预览：受限组件的实时 DOM 渲染。
 *
 * 与 Excalidraw 预览刻意不同：不走 exportToSvg / svgPreviewQueue——受限组件
 * 本身就是廉价 DOM，配合 ContainerCard 的 LOD visible 闸门即可满足万级节点。
 * 四种降级（不可见 / 版本不受支持 / 空卡片 / 单组件失败）全部占位，绝不影响外层节点。
 */
import { memo, useMemo } from 'react'
import type { ContainerPreviewProps } from '../containerRenderers'
import {
  normalizeCardSpecContent,
  type CardSpecContent,
} from '../../../../documents/CardSpecDocument/cardSpecTypes'
import { CardSpecComponentList } from './CardSpecComponentList'

function PreviewPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-3 text-center text-[var(--font-size-sm)] leading-4 text-[var(--color-text-muted)]">
      {text}
    </div>
  )
}

export const CardSpecPreview = memo(function CardSpecPreview({
  nodeId, cardPath, content, title, visible,
}: ContainerPreviewProps) {
  const normalized = useMemo<CardSpecContent | null>(() => {
    try { return normalizeCardSpecContent(content, title) } catch { return null }
  }, [content, title])

  if (!visible) return <PreviewPlaceholder text="缩小显示中 · 放大后加载预览" />
  if (!normalized) return <PreviewPlaceholder text="载荷版本不受支持，已保留原始数据" />
  if (normalized.components.length === 0) return <PreviewPlaceholder text="空白卡片 · 双击开始编辑" />

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-[var(--color-surface)]"
      data-tm-container-preview={nodeId}
      data-tm-cardspec-preview="true"
      aria-label={`${title} 知识卡片预览`}
    >
      <CardSpecComponentList
        content={normalized}
        cardPath={cardPath}
        cardTitle={title}
        visible={visible}
      />
    </div>
  )
})
