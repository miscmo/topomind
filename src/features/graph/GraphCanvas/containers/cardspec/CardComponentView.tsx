/**
 * CardSpec 受限组件渲染：预览（节点内）与编辑器的实时预览面板共用同一组件树，
 * 保证所见即所得。
 *
 * 硬约束（设计文档 §5/§6）：
 * - 文本只渲染纯文本（whitespace-pre-wrap），不支持 markdown/HTML，无注入面；
 * - 媒体禁止自动播放，audio/video 原生 controls + preload="metadata"，img lazy；
 * - 任何单个组件失败（未知类型 / 非法 src / 资源缺失）都降级占位，不拖垮整张卡片；
 * - 交互区域挂 nodrag/nowheel，避免拖动画布或缩放误伤。
 */
import { memo, useState } from 'react'
import type { CardComponent } from '../../../../documents/CardSpecDocument/cardSpecTypes'
import { useCardAssetUrl } from './useCardAssetUrl'

export interface CardComponentViewProps {
  component: CardComponent
  cardPath: string
  /** 节点标题，binding.kind='title' 时的解析来源。 */
  cardTitle: string
  /** 节点 LOD 可见性；不可见时媒体不解析、不挂载。 */
  visible: boolean
}

const TONE_COLORS: Record<string, string> = {
  neutral: 'var(--color-text-muted)',
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex min-h-6 items-center justify-center rounded border border-dashed border-[var(--color-border)] px-2 py-1 text-center text-[var(--font-size-xs)] leading-4 text-[var(--color-text-muted)]">
      {text}
    </div>
  )
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function MediaImage({ src, alt, fit, cardPath, visible }: {
  src: string
  alt: string
  fit: 'contain' | 'cover'
  cardPath: string
  visible: boolean
}) {
  const { url, state } = useCardAssetUrl(cardPath, src, visible)
  const [broken, setBroken] = useState(false)
  if (state === 'loading') return <Placeholder text="图片加载中…" />
  if (state === 'missing' || !url || broken) return <Placeholder text={`资源缺失：${src}`} />
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setBroken(true)}
      className="nodrag max-h-40 w-full rounded"
      style={{ objectFit: fit }}
    />
  )
}

function MediaAudio({ src, label, cardPath, visible }: {
  src: string
  label: string
  cardPath: string
  visible: boolean
}) {
  const { url, state } = useCardAssetUrl(cardPath, src, visible)
  if (state === 'loading') return <Placeholder text="音频加载中…" />
  if (state === 'missing' || !url) return <Placeholder text={`资源缺失：${src}`} />
  return (
    <div className="flex flex-col gap-1">
      {label && <div className="truncate text-[var(--font-size-sm)] text-[var(--color-text-primary)]">{label}</div>}
      <audio controls preload="metadata" src={url} className="nodrag nowheel h-8 w-full" />
    </div>
  )
}

function MediaVideo({ src, label, poster, cardPath, visible }: {
  src: string
  label: string
  poster: string
  cardPath: string
  visible: boolean
}) {
  const { url, state } = useCardAssetUrl(cardPath, src, visible)
  const posterAsset = useCardAssetUrl(cardPath, poster, visible && Boolean(poster))
  if (state === 'loading') return <Placeholder text="视频加载中…" />
  if (state === 'missing' || !url) return <Placeholder text={`资源缺失：${src}`} />
  return (
    <div className="flex flex-col gap-1">
      {label && <div className="truncate text-[var(--font-size-sm)] text-[var(--color-text-primary)]">{label}</div>}
      <video
        controls
        preload="metadata"
        src={url}
        poster={posterAsset.url ?? undefined}
        className="nodrag nowheel max-h-40 w-full rounded bg-black"
      />
    </div>
  )
}

/** v1 只解析 static / title；其余绑定保留数据、降级占位（阶段 6/7 再接真实数据源）。 */
function resolveText(component: CardComponent, cardTitle: string): { text: string; unsupportedBinding: string | null } {
  const binding = component.binding
  if (!binding || binding.kind === 'static') return { text: str(component.props.text), unsupportedBinding: null }
  if (binding.kind === 'title') return { text: cardTitle, unsupportedBinding: null }
  return { text: '', unsupportedBinding: binding.kind }
}

export const CardComponentView = memo(function CardComponentView({
  component, cardPath, cardTitle, visible,
}: CardComponentViewProps) {
  const { type, props, degraded } = component

  if (degraded === 'unknown-type') return <Placeholder text={`暂不支持的内容类型：${type}`} />
  if (degraded === 'invalid-src') return <Placeholder text="资源路径非法（仅允许 assets/ 相对引用）" />

  const unsupportedBinding = component.binding
    && component.binding.kind !== 'static'
    && component.binding.kind !== 'title'
  if (unsupportedBinding && (type === 'title' || type === 'text' || type === 'badge' || type === 'progress' || type === 'table')) {
    return <Placeholder text={`数据绑定暂不支持（${component.binding?.kind ?? ''}）`} />
  }

  switch (type) {
    case 'title': {
      const { text } = resolveText(component, cardTitle)
      const level = num(props.level, 1)
      const sizeClass = level === 1 ? 'text-[var(--font-size-lg)]' : level === 2 ? 'text-[var(--font-size-md)]' : 'text-[var(--font-size-base)]'
      return (
        <div className={`${sizeClass} break-words font-semibold leading-5 text-[var(--color-text-primary)]`}>
          {text || '（空标题）'}
        </div>
      )
    }
    case 'text': {
      const { text } = resolveText(component, cardTitle)
      const isCaption = props.variant === 'caption'
      return (
        <div className={`whitespace-pre-wrap break-words leading-4 ${isCaption ? 'text-[var(--font-size-xs)] text-[var(--color-text-muted)]' : 'text-[var(--font-size-sm)] text-[var(--color-text-primary)]'}`}>
          {text || '（空文本）'}
        </div>
      )
    }
    case 'badge': {
      const tone = TONE_COLORS[str(props.tone)] ?? TONE_COLORS.neutral
      return (
        <div className="flex flex-wrap gap-1">
          <span
            className="inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[var(--font-size-xs)] leading-4"
            style={{ color: tone, borderColor: tone }}
          >
            {str(props.text) || '（空徽标）'}
          </span>
        </div>
      )
    }
    case 'image':
      return (
        <MediaImage
          src={str(props.src)}
          alt={str(props.alt)}
          fit={props.fit === 'cover' ? 'cover' : 'contain'}
          cardPath={cardPath}
          visible={visible}
        />
      )
    case 'audio':
      return <MediaAudio src={str(props.src)} label={str(props.label)} cardPath={cardPath} visible={visible} />
    case 'video':
      return (
        <MediaVideo
          src={str(props.src)}
          label={str(props.label)}
          poster={str(props.poster)}
          cardPath={cardPath}
          visible={visible}
        />
      )
    case 'table': {
      const columns = Array.isArray(props.columns) ? props.columns.map(str) : []
      const rows = Array.isArray(props.rows) ? props.rows : []
      if (columns.length === 0) return <Placeholder text="（空表格）" />
      return (
        <div className="nodrag nowheel max-h-40 overflow-auto rounded border border-[var(--color-border)]">
          <table className="w-full border-collapse text-[var(--font-size-xs)] leading-4 text-[var(--color-text-primary)]">
            <thead>
              <tr>
                {columns.map((column, i) => (
                  <th key={i} className="border-b border-[var(--color-border)] bg-[var(--color-hover-bg)] px-1.5 py-1 text-left font-semibold">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {(Array.isArray(row) ? row : []).map((cell, ci) => (
                    <td key={ci} className="border-b border-[var(--color-border)] px-1.5 py-1 align-top last:border-b-0">
                      {str(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'progress': {
      const value = Math.min(100, Math.max(0, num(props.value, 0)))
      const tone = TONE_COLORS[str(props.tone)] ?? TONE_COLORS.accent
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-[var(--font-size-xs)] leading-4">
            <span className="truncate text-[var(--color-text-primary)]">{str(props.label)}</span>
            <span className="shrink-0 text-[var(--color-text-muted)]">{Math.round(value)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-hover-bg)]">
            <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: tone }} />
          </div>
        </div>
      )
    }
    case 'flowchart':
      // 阶段内 P2：引用同节点 Excalidraw 文档的渲染暂缓，先占位、数据保留。
      return <Placeholder text={`流程图组件（即将支持）· 引用 ${str(props.documentId) || '未配置'}`} />
    case 'html':
      return <Placeholder text="HTML 组件（默认关闭）" />
    default:
      return <Placeholder text={`暂不支持的内容类型：${type}`} />
  }
})
