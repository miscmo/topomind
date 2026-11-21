/**
 * SVG 预览的并发闸门 + 内存 LRU 缓存（模块级单例，全画布共享）。
 *
 * - 并发上限：多容器房间首帧不会同时触发 N 次 exportToSvg 把主线程打满。
 * - LRU：按 scene version 失效，容量有界；v1 不落盘，卸载后重新进入时重新生成。
 * - 缓存存的是 SVG DOM 模板，挂载时 cloneNode，全程不碰 innerHTML / 净化管线。
 */
export const SVG_PREVIEW_MAX_CONCURRENCY = 3
export const SVG_PREVIEW_CACHE_LIMIT = 128

let running = 0
const pending: Array<() => void> = []

export function enqueueSvgRender<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running += 1
      void task().then(resolve, reject).finally(() => {
        running -= 1
        const next = pending.shift()
        if (next) next()
      })
    }
    if (running < SVG_PREVIEW_MAX_CONCURRENCY) run()
    else pending.push(run)
  })
}

export function svgPreviewQueueSize(): number {
  return running + pending.length
}

const cache = new Map<string, SVGSVGElement>()

export function getCachedSvg(key: string): SVGSVGElement | undefined {
  const found = cache.get(key)
  if (!found) return undefined
  cache.delete(key)
  cache.set(key, found)
  return found
}

/** 返回可安全挂载的副本；同一模板可被多个节点同时使用。 */
export function cloneCachedSvg(key: string): SVGSVGElement | null {
  const found = getCachedSvg(key)
  if (!found) return null
  return found.cloneNode(true) as SVGSVGElement
}

export function putCachedSvg(key: string, svg: SVGSVGElement): void {
  cache.delete(key)
  cache.set(key, svg)
  while (cache.size > SVG_PREVIEW_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function clearSvgPreviewCache(): void {
  cache.clear()
  pending.length = 0
}

export function svgPreviewCacheSize(): number {
  return cache.size
}
