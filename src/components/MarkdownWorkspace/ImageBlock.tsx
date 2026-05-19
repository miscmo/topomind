import { memo, useEffect, useState } from 'react'
import { useStorage } from '../../core/storage'

interface ImageBlockProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string
  attachmentCardPath?: string | null
  onPreview?: (payload: { src: string; alt?: string }) => void
}

export const ImageBlock = memo(function ImageBlock({
  src,
  attachmentCardPath,
  alt,
  onPreview,
  style,
  onDoubleClick,
  ...props
}: ImageBlockProps) {
  const storage = useStorage()
  
  const isLocal = src ? (!/^(?:https?:|data:|blob:|file:|mailto:)/i.test(src) && !src.startsWith('/') && !src.startsWith('\\')) : false

  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(() => {
    // 如果是本地相对路径（附件），初始不设置 src，避免浏览器触发无效的 file:// 请求导致 ERR_FILE_NOT_FOUND
    if (isLocal && attachmentCardPath) {
      return undefined
    }
    return src
  })

  useEffect(() => {
    if (!src || !attachmentCardPath) {
      setResolvedSrc(src)
      return
    }

    if (isLocal) {
      let cancelled = false
      storage.getAttachmentAbsoluteUrl(attachmentCardPath, src).then(url => {
        if (!cancelled && url) {
          setResolvedSrc(url)
        }
      }).catch(err => {
        console.error('Failed to load image url', src, err)
      })
      return () => {
        cancelled = true
      }
    } else {
      setResolvedSrc(src)
    }
  }, [src, attachmentCardPath, storage, isLocal])

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      draggable={false}
      style={{ maxWidth: '100%', cursor: onPreview ? 'zoom-in' : undefined, ...style }}
      onDoubleClick={(event) => {
        onDoubleClick?.(event)
        if (!event.defaultPrevented && resolvedSrc && onPreview) {
          onPreview({ src: resolvedSrc, alt })
        }
      }}
      {...props}
    />
  )
})
