import { memo, useEffect, useState } from 'react'
import { useStorage } from '../../core/storage'

interface ImageBlockProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string
  attachmentCardPath?: string | null
}

export const ImageBlock = memo(function ImageBlock({ src, attachmentCardPath, alt, ...props }: ImageBlockProps) {
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

  return <img src={resolvedSrc} alt={alt} style={{ maxWidth: '100%' }} {...props} />
})
