/**
 * 视口滚动守卫
 *
 * TopoMind 的窗口是「不可整体滚动」的桌面布局：html/body/#root 都只做裁剪，
 * 所有滚动都发生在各自内部的滚动容器里（编辑器正文、侧栏列表、目录等）。
 * 但 html/body 是 `overflow:hidden` —— 它**仍然是滚动容器**，可以被
 *   · 程序化滚动（element.scrollIntoView / focus 会沿祖先链一路滚到底）
 *   · 浏览器滚动锚定（scroll anchoring）
 * 带动。一旦被滚动，整个界面（图谱 + 右栏 + 编辑器状态栏）会整体上移、底部露出
 * 空白，而用户无法用滚轮把它滚回来（hidden 容器不接受用户滚动）—— 即「整页漂移」。
 *
 * 这里做的是兜底自愈：任何一次根层滚动都立即复位。布局层已经用
 * `overflow:clip`（#root / 内容区 / #graph-page）让根层拿不到滚动空间，
 * 所以正常路径下这个守卫永远不会被触发；它只是最后一道保险，同时把
 * 「谁把根滚了」的证据留在控制台，便于定位漏网的调用点。
 */
const RESET_TARGETS = () => [document.documentElement, document.body]

export function installViewportScrollGuard(): () => void {
  if (typeof document === 'undefined') return () => {}

  const reset = () => {
    for (const el of RESET_TARGETS()) {
      if (el.scrollTop !== 0) el.scrollTop = 0
      if (el.scrollLeft !== 0) el.scrollLeft = 0
    }
  }

  const onScroll = (event: Event) => {
    const target = event.target
    const isRoot =
      target === document ||
      target === document.documentElement ||
      target === document.body
    if (!isRoot) return

    const de = document.documentElement
    const scrolled = de.scrollTop || de.scrollLeft || document.body.scrollTop || document.body.scrollLeft
    if (!scrolled) return

    if (import.meta.env.DEV) {
      console.warn(
        '[scroll-guard] 根层被滚动，已复位。请检查是否有 scrollIntoView / focus 未走 scrollChildIntoView：',
        {
          html: { top: de.scrollTop, left: de.scrollLeft, space: de.scrollHeight - de.clientHeight },
          body: { top: document.body.scrollTop, space: document.body.scrollHeight - document.body.clientHeight },
        },
      )
    }
    reset()
  }

  // scroll 事件不冒泡，必须用捕获阶段才能在 document 上收到元素级滚动
  document.addEventListener('scroll', onScroll, true)
  return () => document.removeEventListener('scroll', onScroll, true)
}
