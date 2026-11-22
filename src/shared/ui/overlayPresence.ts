/**
 * 全局浮层「渐出」生命周期代理。
 *
 * React 条件渲染的浮层（`if (!open) return null`）在关闭那一帧就被 removeChild，
 * DOM 消失得比一帧还快，CSS 根本来不及播退出动画 —— 这就是「弹窗出来有动画、
 * 关掉却很生硬」的根因。逐个组件改延迟卸载会牵动焦点、编辑器选区、右栏折叠
 * 等一整串状态链路，因此这里在 DOM 边界统一兜底：
 *
 *   1. MutationObserver 捕获带统一入场契约（或 data-tm-overlay）的浮层被移除；
 *   2. 把它**原样插回原父节点的原位置**（left/top、transform、z-index、尺寸
 *      全部保留，不需要几何快照，也不会像克隆节点那样丢失编辑器 / canvas 内容）；
 *   3. 标 inert、整棵子树打 `data-tm-exiting`、剥掉入场类（否则重新 attach 会
 *      重播 animation，变成「先淡入再淡出」），只播纯 opacity 淡出；
 *   4. 动画结束或超时后真正移除。
 *
 * 入场仍由组件显式套用 TM_MOTION 契约；退出用纯 opacity，是为了兼容
 * floating-ui 的 transform 定位与 `-translate-x-1/2` 居中的浮层。
 */
import { TM_MOTION } from './motion'

const ENTER_CLASS_SELECTOR = TM_MOTION.enterClassNames
  .map((name) => `.${name}`)
  .join(', ')

/**
 * 「浮层根节点」判定：显式 data-tm-overlay，或套用了统一入场契约的节点
 * （含 .tm-popover-anchor 分层外壳、四个入场类）。
 * 这样现有浮层无需逐个改造，新浮层只要套用契约就自动获得一进一出。
 * 行内 hover 工具等也用 tm-fade-enter 但不是浮层的元素，用
 * `data-tm-overlay="none"` 显式退出该机制，避免移开鼠标后残留 130ms。
 */
const OVERLAY_SELECTOR = [
  `[${TM_MOTION.overlayAttribute}]`,
  `.${TM_MOTION.anchor}`,
  ...TM_MOTION.enterClassNames.map((name) => `.${name}`),
].join(', ')

const isOverlayRoot = (node: HTMLElement): boolean => {
  if (node.getAttribute(TM_MOTION.overlayAttribute) === 'none') return false
  return node.matches(OVERLAY_SELECTOR)
}

/** 把一个刚被 React 卸载的浮层接管过来，播完淡出再真正删除。 */
function playExit(node: HTMLElement, parent: Node, nextSibling: Node | null): void {
  // 父容器自身已被一起卸载时，插回去也不可见，直接放弃（大范围视图切换的常见情况）。
  if (!parent.isConnected) return

  // ① 整棵子树立刻退出「浮层仍然存在」的查询集合。
  //    调用方统一用 :not([data-tm-exiting])，否则 Esc / 外部点击 / 右栏折叠判定
  //    会在淡出的这 130ms 里误以为面板还开着。
  node.setAttribute(TM_MOTION.exitingAttribute, '')
  node.querySelectorAll('*').forEach((child) => {
    child.setAttribute(TM_MOTION.exitingAttribute, '')
  })
  node.setAttribute('aria-hidden', 'true')
  node.setAttribute('inert', '')
  node.style.pointerEvents = 'none'

  // ② 剥掉入场类：节点重新 attach 到文档会重播 CSS animation。
  node.classList.remove(...TM_MOTION.enterClassNames)
  node.querySelectorAll(ENTER_CLASS_SELECTOR).forEach((child) => {
    child.classList.remove(...TM_MOTION.enterClassNames)
  })

  // ③ 原样插回原位。record.nextSibling 可能已在后续 mutation 中被移除，做兜底。
  const anchor = nextSibling && nextSibling.parentNode === parent ? nextSibling : null
  parent.insertBefore(node, anchor)

  // ④ 纯透明度淡出，时长与曲线由 motion.css 唯一定义。
  node.classList.add(TM_MOTION.exit)

  let done = false
  let timer = 0
  function finish(): void {
    if (done) return
    done = true
    node.removeEventListener('animationend', onAnimationEnd)
    window.clearTimeout(timer)
    node.remove()
  }
  // 子元素若有自己的动画会冒泡上来，只认根节点这一条。
  function onAnimationEnd(event: AnimationEvent): void {
    if (event.target !== node) return
    finish()
  }
  node.addEventListener('animationend', onAnimationEnd)
  // 后台标签页 / 动画被浏览器跳过时 animationend 不一定触发，超时兜底，
  // 保证幽灵节点绝不会永久残留。
  timer = window.setTimeout(finish, TM_MOTION.exitDurationMs + 80)
}

/**
 * 在应用入口调用一次即可。返回卸载函数（便于测试 / HMR 清理）。
 * 系统开启「减少动态效果」时完全不接管，浮层瞬时消失。
 */
export function installOverlayExitTransition(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const host: Node = document.body ?? document.documentElement

  const prefersReducedMotion = () =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const observer = new MutationObserver((records) => {
    if (prefersReducedMotion()) return

    for (const record of records) {
      for (const removed of record.removedNodes) {
        if (!(removed instanceof HTMLElement)) continue
        if (!isOverlayRoot(removed)) continue
        // 上一次淡出结束后真正删除时会再触发一次，必须跳过，否则会自我循环。
        if (removed.hasAttribute(TM_MOTION.exitingAttribute)) continue
        playExit(removed, record.target, record.nextSibling)
      }
    }
  })

  observer.observe(host, { childList: true, subtree: true })
  return () => observer.disconnect()
}
