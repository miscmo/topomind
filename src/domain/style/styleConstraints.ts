import type { DefaultEditorStyle, DefaultNodeStyle, NodeSizeLimits } from './styleTypes'

export const NODE_STYLE_NUMBER_LIMITS: Record<keyof Pick<DefaultNodeStyle, 'headerFontSize' | 'bodyFontSize' | 'borderWidth' | 'borderRadius'>, { min: number; max: number }> = {
  headerFontSize: { min: 8, max: 28 },
  bodyFontSize: { min: 8, max: 24 },
  borderWidth: { min: 0, max: 8 },
  borderRadius: { min: 0, max: 32 },
}

export const NODE_SIZE_LIMIT_DEFAULTS: NodeSizeLimits = {
  minWidth: 120,
  minHeight: 52,
  maxWidth: 640,
  maxHeight: 480,
}

export const NODE_BADGE_SIZE_LIMIT = { min: 8, max: 28 }

/** 连线箭头长度（px）取值范围 */
export const EDGE_ARROW_SIZE_LIMIT = { min: 6, max: 36, step: 1 }

/** 连线线条粗细（px）取值范围 */
export const EDGE_LINE_WIDTH_LIMIT = { min: 0.5, max: 8, step: 0.1 }

/**
 * 主线（weight=main）相对基础线宽的加粗倍率。
 * 默认 1.2 × 1.25 = 1.5，与改造前主线硬编码的 1.5 一致。
 */
export const MAIN_EDGE_WIDTH_RATIO = 1.25

export const EDITOR_STYLE_NUMBER_LIMITS: Record<keyof Pick<DefaultEditorStyle, 'fontSize' | 'lineHeight' | 'contentWidth' | 'blockSpacing' | 'headingSpacingRatio' | 'letterSpacing' | 'fontWeight'>, { min: number; max: number; step?: number }> = {
  fontSize: { min: 10, max: 36 },
  lineHeight: { min: 1, max: 3, step: 0.1 },
  contentWidth: { min: 400, max: 1200, step: 10 },
  blockSpacing: { min: 0, max: 32, step: 1 },
  headingSpacingRatio: { min: 0.5, max: 3.0, step: 0.1 },
  letterSpacing: { min: -0.1, max: 0.5, step: 0.01 },
  fontWeight: { min: 100, max: 900, step: 10 },
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
