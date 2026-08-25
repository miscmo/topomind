// 编辑器内链接点击的桥接层：
// - BlockNote 可编辑模式下，链接扩展的 `links.onClick` 钩子在 ProseMirror 的
//   handleClick 内部、且早于其自带的 window.open 触发，是“拦截直接跳转”最可靠的入口。
// - 只读模式下 BlockNote 的 handleClick 会提前 return false（不调用 onClick），
//   此时由 DOM 捕获监听兜底（见 SmartDocumentEditor 的 handleLinkClick）。
// 两者都通过 emitEditorLinkClick 把点击事件转交给组件内注册的菜单打开函数，
// 由组件决定弹出“打开/复制链接”菜单，而不是让浏览器/BlockNote 直接导航。

export type LinkMenuOpenPayload = {
  href: string
  rect: DOMRect
}

// 组件在挂载时注册、卸载时注销；模型层（editor 创建时）只持有模块级引用，
// 调用时读取最新值，因此不受闭包陈旧影响。
let handler: ((payload: LinkMenuOpenPayload) => void) | null = null

export function setEditorLinkClickHandler(fn: ((payload: LinkMenuOpenPayload) => void) | null): void {
  handler = fn
}

export function emitEditorLinkClick(payload: LinkMenuOpenPayload): void {
  handler?.(payload)
}

// 仅拦截 http/https/mailto/ftp 这类绝对外部链接；
// 文档内相对锚点（#...）、javascript: 等不做拦截，保持原有行为。
export function isNavigableHref(href: string): boolean {
  return /^(https?|mailto|ftp):/i.test(href)
}

// 广义拦截判定：任何会触发浏览器导航的 <a href>（排除页内锚点与 javascript:）。
export function shouldInterceptLink(href: string): boolean {
  return (
    href.length > 0 &&
    !href.startsWith('#') &&
    !/^javascript:/i.test(href)
  )
}
