/**
 * 应用全局主题色 · DOM 注入层（唯一有副作用的地方）
 *
 * 只写 --tm-brand-* 这一组变量到 <html> 的 inline style：
 *   - inline 优先级高于 tokens.css 的 :root / [data-theme] 规则，但不会改动任何组件；
 *   - 组件继续引用 --color-* 语义 token，主题色切换对它们是透明的；
 *   - 选回默认品牌色时清空注入，让 tokens.css 的静态 fallback 原样生效（视觉零跳变）。
 *
 * 切换浅色 / 深色时必须重新调用：同一基色在两套主题里派生出的亮度层级不同。
 */
import {
  ACCENT_TOKEN_NAMES,
  DEFAULT_ACCENT_COLOR,
  buildAccentTokens,
  normalizeAccentColor,
  type AccentTheme,
} from './accentColor.ts'

function clearAccentTokens(): void {
  const style = document.documentElement.style
  for (const name of ACCENT_TOKEN_NAMES) style.removeProperty(name)
}

export function clearAccentColor(): void {
  clearAccentTokens()
}

/** 应用（或恢复）主题色；非法值一律回落到默认品牌色。 */
export function applyAccentColor(input: unknown, theme: AccentTheme): void {
  const color = normalizeAccentColor(input) ?? DEFAULT_ACCENT_COLOR
  if (color === DEFAULT_ACCENT_COLOR) {
    clearAccentTokens()
    return
  }
  const tokens = buildAccentTokens(color, theme)
  const style = document.documentElement.style
  for (const name of ACCENT_TOKEN_NAMES) {
    style.setProperty(name, tokens[name])
  }
}
