/**
 * CardSpec 媒体资源 URL 解析。
 *
 * src（assets/ 相对引用）→ file:// URL，主进程侧完成路径校验（拒绝 .. / 绝对路径 /
 * 符号链接逃逸）。模块级缓存避免同一张卡片内重复 IPC；解析失败统一记 null（缺失），
 * 渲染层据此显示「资源缺失」占位，绝不影响卡片其余组件。
 */
import { useEffect, useState } from 'react'
import { useStorage } from '../../../../../core/storage'

export type CardAssetState = 'loading' | 'ready' | 'missing'

const cache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

async function resolveAsset(storage: ReturnType<typeof useStorage>, cardPath: string, src: string): Promise<string | null> {
  const key = `${cardPath}:${src}`
  if (cache.has(key)) return cache.get(key) ?? null
  const pending = inflight.get(key)
  if (pending) return pending
  const request = storage.resolveCardAssetUrl(cardPath, src)
    .then((url) => { cache.set(key, url ?? null); return url ?? null })
    .catch(() => { cache.set(key, null); return null })
    .finally(() => { inflight.delete(key) })
  inflight.set(key, request)
  return request
}

export function useCardAssetUrl(
  cardPath: string,
  src: string | undefined,
  enabled: boolean,
): { url: string | null; state: CardAssetState } {
  const storage = useStorage()
  const key = `${cardPath}:${src ?? ''}`
  const [state, setState] = useState<{ key: string; url: string | null; state: CardAssetState }>({
    key,
    url: null,
    state: 'loading',
  })

  useEffect(() => {
    if (!enabled || !src) return
    let cancelled = false
    void resolveAsset(storage, cardPath, src).then((url) => {
      if (cancelled) return
      setState({ key, url, state: url ? 'ready' : 'missing' })
    })
    return () => { cancelled = true }
  }, [storage, cardPath, src, enabled, key])

  if (!enabled || !src) return { url: null, state: 'loading' }
  if (state.key !== key) return { url: null, state: 'loading' }
  return { url: state.url, state: state.state }
}
