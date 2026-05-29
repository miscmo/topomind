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

export const EDITOR_STYLE_NUMBER_LIMITS: Record<keyof Pick<DefaultEditorStyle, 'fontSize' | 'lineHeight'>, { min: number; max: number; step?: number }> = {
  fontSize: { min: 10, max: 36 },
  lineHeight: { min: 1, max: 3, step: 0.1 },
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
