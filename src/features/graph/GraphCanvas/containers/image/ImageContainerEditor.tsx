/**
 * 图片容器全屏编辑器：查看大图 + 更换本地图片文件。
 *
 * 不自己落盘：onChange 把规范化后的载荷交给 ContainerFullscreenEditorHost，
 * 由后者做 400ms debounce / close-guard flush / bumpRevision，节点预览会在
 * 成功写盘后自动重读磁盘，不需要这里手动刷新画布。
 */
import { memo, useCallback, useMemo, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import type { ContainerEditorProps } from '../containerRenderers'
import { useStorage } from '../../../../../core/storage'
import {
  isImageAssetSrc,
  normalizeImageDocumentContent,
  type ImageDocumentContent,
} from '../../../../documents/ImageDocument/imageDocumentTypes'
import { useCardAssetUrl } from '../cardspec/useCardAssetUrl'

function EditorMessage({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-4 text-center text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
      {text}
    </div>
  )
}

export const ImageContainerEditor = memo(function ImageContainerEditor({
  cardPath, content, title, active, onChange,
}: ContainerEditorProps) {
  const storage = useStorage()
  const [error, setError] = useState<string | null>(null)
  const normalized = useMemo<ImageDocumentContent | null>(() => {
    try { return normalizeImageDocumentContent(content, title) } catch { return null }
  }, [content, title])
  const src = normalized?.src ?? ''
  const { url, state } = useCardAssetUrl(cardPath, src, Boolean(src))

  const chooseImage = useCallback(async () => {
    if (!normalized) return
    setError(null)
    try {
      const result = await storage.importImageAsset(cardPath)
      if (!result) return // 用户取消：保留原图与空态，不写盘
      if (!isImageAssetSrc(result.src)) {
        setError('请选择图片文件（png / jpg / jpeg / gif / webp / svg）')
        return
      }
      onChange({
        ...normalized,
        src: result.src,
        alt: result.src.slice('assets/'.length),
        metadata: { ...normalized.metadata, updatedAt: Date.now(), editor: 'image' },
      })
    } catch (e) {
      setError(`选择图片失败：${(e as Error)?.message || String(e)}`)
    }
  }, [cardPath, normalized, onChange, storage])

  if (!normalized) return <EditorMessage text="载荷版本不受支持，已保留原始数据，不提供编辑入口" />

  const fileName = src ? src.slice('assets/'.length) : '尚未选择图片'

  return (
    <div className="flex h-full w-full flex-col" data-tm-image-editor="true">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
          {fileName}
        </span>
        {error && (
          <span className="shrink-0 text-[var(--font-size-sm)] text-[var(--color-danger)]">{error}</span>
        )}
        <button
          type="button"
          data-tm-image-choose="true"
          className="tm-btn shrink-0"
          disabled={!active}
          onClick={() => { void chooseImage() }}
        >
          选择图片…
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--color-bg-muted)] p-4">
        {!src ? (
          <div className="flex flex-col items-center gap-3 text-[var(--font-size-sm)] text-[var(--color-text-muted)]">
            <ImageIcon className="h-10 w-10" aria-hidden="true" />
            <span>尚未选择图片 · 点右上角「选择图片…」导入本地文件</span>
          </div>
        ) : state === 'loading' ? (
          <EditorMessage text="图片加载中…" />
        ) : !url ? (
          <EditorMessage text="图片资源缺失或路径非法，请重新选择图片" />
        ) : (
          <img
            src={url}
            alt={normalized.alt || title}
            data-tm-image-editor-src={src}
            className="max-h-full max-w-full select-none"
            style={{ objectFit: normalized.fit }}
            draggable={false}
          />
        )}
      </div>
    </div>
  )
})
