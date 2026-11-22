/**
 * 全局浮层动效契约（TS 侧入口）。
 *
 * 视觉真源是 `src/styles/motion.css`，本文件只提供类型安全的类名 / 数值引用，
 * 不要在组件里再写 `animate-in fade-in zoom-in-95` 之类组合 —— 那会让方向、
 * 时长、transform-origin 重新散落成多份真源。
 *
 * 分层约定：
 *   - `anchor` 放在定位元素上（left/top 或 floating-ui 的 floatingStyles）；
 *   - `enter` 放在**定位元素的子元素**上，或确认自身没有 transform 定位的元素上；
 *   - 元素自带 `-translate-*` / `transform` 时一律用 `fadeEnter`，避免动画
 *     的 transform 覆盖定位 transform。
 *
 * 一进一出的成对契约：
 *   - 浮层根节点必须带 `data-tm-overlay`，全局退出代理才会接管它的渐出；
 *   - 入场由组件显式套 `enter` / `fadeEnter` / `modal*Enter`；
 *   - 退出由 `installOverlayExitTransition()` 在 DOM 边界统一播放，组件无需
 *     自己实现延迟卸载，也就不会牵动焦点 / 选区 / 右栏折叠等状态链路。
 */
export const TM_MOTION = {
  /** 入场时长，与 CSS --tm-motion-duration 保持一致；Mantine transitionProps 也取它。 */
  durationMs: 160,
  /** 退场时长，与 CSS --tm-motion-exit-duration 保持一致。 */
  exitDurationMs: 130,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',

  anchor: 'tm-popover-anchor',
  enter: 'tm-popover-enter',
  exit: 'tm-popover-exit',
  /** 纯淡入，不含 transform，供居中浮层与 transform 定位浮层使用。 */
  fadeEnter: 'tm-fade-enter',
  modalOverlayEnter: 'tm-modal-overlay-enter',
  modalPanelEnter: 'tm-modal-panel-enter',

  /** 浮层根标记：带此属性的节点才参与全局渐出生命周期代理。 */
  overlayAttribute: 'data-tm-overlay',
  /** 退出中的「幽灵」节点标记；所有存在性查询都要用 :not([data-tm-exiting]) 排除。 */
  exitingAttribute: 'data-tm-exiting',
  /** 重新插回 DOM 前必须剥掉的入场类，否则 animation 会重播成「先淡入再淡出」。 */
  enterClassNames: [
    'tm-popover-enter',
    'tm-fade-enter',
    'tm-modal-overlay-enter',
    'tm-modal-panel-enter',
  ] as const,
} as const
