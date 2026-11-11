import type { CSSProperties } from 'react'

/**
 * 节点标题的「尺寸上限」唯一事实来源。
 *
 * 历史上这里出过两类失配：
 *   - 测量侧把高度封顶 4 行，DOM 却完整渲染 → 多出的行被 overflow-hidden 裁掉；
 *   - 渲染侧加了链环装饰，测量侧没算宽度 → 节点不再自适应。
 *
 * 因此截断规则必须由 DOM 和 Canvas 测量共同消费：
 *   - KnowledgeCard.tsx 用 getTitleClampStyle() 真实截断并显示省略号；
 *   - autoSize.ts 用 MAX_TITLE_LINES 封顶高度、MAX_TITLE_WIDTH_CHARS 封顶自动宽度。
 * 改任何一处数字都不可能只影响单边。
 */

/** 标题最多渲染的行数，超出部分显示省略号。 */
export const MAX_TITLE_LINES = 4

/**
 * 自动宽度的天花板，以「N 个汉字宽」为单位。
 * 长标题不会把节点无限撑宽，而是折行到 MAX_TITLE_LINES 后截断。
 */
export const MAX_TITLE_WIDTH_CHARS = 20

/**
 * 标题文本元素的截断样式。必须与 autoSize 的行数上限同源，
 * 否则会回到「算出的高度与 DOM 实际高度不一致」的老问题。
 * 省略号由 -webkit-line-clamp 自动生成，无需 text-overflow。
 */
export function getTitleClampStyle(): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: MAX_TITLE_LINES,
    overflow: 'hidden',
  }
}
