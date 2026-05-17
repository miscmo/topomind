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
  onClick,
  ...props
}: ImageBlockProps) {
  const storage = useStorage()
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(src)

  useEffect(() => {
    if (!src || !attachmentCardPath) {
      setResolvedSrc(src)
      return
    }

    const isLocal = !/^(?:https?:|data:|blob:|file:|mailto:)/i.test(src) && !src.startsWith('/') && !src.startsWith('\\')
    if (isLocal) {
      let cancelled = false
      storage.readAttachmentDataUrl(attachmentCardPath, src).then(dataUrl => {
        if (!cancelled && dataUrl) {
          setResolvedSrc(dataUrl)
        }
      }).catch(err => {
        console.error('Failed to load image', src, err)
      })
      return () => {
        cancelled = true
      }
    } else {
      setResolvedSrc(src)
    }
  }, [src, attachmentCardPath, storage])

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      style={{ maxWidth: '100%', cursor: onPreview ? 'zoom-in' : undefined, ...style }}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented && resolvedSrc && onPreview) {
          onPreview({ src: resolvedSrc, alt })
        }
      }}
      {...props}
    />
  )
})
