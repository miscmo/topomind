import type { DefaultEdgeStyle, DefaultEditorStyle, DefaultNodeSize, DefaultNodeStyle, NodeSizeLimits, StyleConfigDefaults } from './styleTypes'
import { STYLE_CONFIG_DEFAULTS } from './styleDefaults'
import { EDITOR_STYLE_NUMBER_LIMITS, NODE_BADGE_SIZE_LIMIT, NODE_STYLE_NUMBER_LIMITS, clampNumber, finiteNumber } from './styleConstraints'

type RecordLike = Record<string, unknown>

function asRecord(value: unknown): RecordLike {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : {}
}

export function normalizeDefaultEdgeStyle(raw: unknown, edgeDefaultsVersion?: number): DefaultEdgeStyle {
  const style = asRecord(raw)
  const defaults = STYLE_CONFIG_DEFAULTS.defaultEdgeStyle
  return {
    lineMode: edgeDefaultsVersion === 2 && style.lineMode === 'smoothstep' ? 'smoothstep' : defaults.lineMode,
    lineStyle: style.lineStyle === 'dashed' ? 'dashed' : defaults.lineStyle,
    color: typeof style.color === 'string' ? style.color : defaults.color,
    arrow: edgeDefaultsVersion === 2 && typeof style.arrow === 'boolean' ? style.arrow : defaults.arrow,
  }
}

export function normalizeDefaultNodeStyle(raw: unknown): DefaultNodeStyle {
  const style = asRecord(raw)
  const defaults = STYLE_CONFIG_DEFAULTS.defaultNodeStyle
  return {
    headerFontSize: clampNumber(finiteNumber(style.headerFontSize, defaults.headerFontSize), NODE_STYLE_NUMBER_LIMITS.headerFontSize.min, NODE_STYLE_NUMBER_LIMITS.headerFontSize.max),
    bodyFontSize: clampNumber(finiteNumber(style.bodyFontSize, defaults.bodyFontSize), NODE_STYLE_NUMBER_LIMITS.bodyFontSize.min, NODE_STYLE_NUMBER_LIMITS.bodyFontSize.max),
    headerColor: typeof style.headerColor === 'string' ? style.headerColor : defaults.headerColor,
    headerBackgroundColor: typeof style.headerBackgroundColor === 'string' ? style.headerBackgroundColor : defaults.headerBackgroundColor,
    headerFontWeight: style.headerFontWeight === 'bold' ? 'bold' : defaults.headerFontWeight,
    headerFontStyle: style.headerFontStyle === 'italic' ? 'italic' : defaults.headerFontStyle,
    borderColor: typeof style.borderColor === 'string' ? style.borderColor : defaults.borderColor,
    borderWidth: clampNumber(finiteNumber(style.borderWidth, defaults.borderWidth), NODE_STYLE_NUMBER_LIMITS.borderWidth.min, NODE_STYLE_NUMBER_LIMITS.borderWidth.max),
    borderRadius: clampNumber(finiteNumber(style.borderRadius, defaults.borderRadius), NODE_STYLE_NUMBER_LIMITS.borderRadius.min, NODE_STYLE_NUMBER_LIMITS.borderRadius.max),
  }
}

export function normalizeNodeSizeLimits(raw: unknown): NodeSizeLimits {
  const limits = asRecord(raw)
  const defaults = STYLE_CONFIG_DEFAULTS.nodeSizeLimits
  const minWidth = Math.max(1, finiteNumber(limits.minWidth, defaults.minWidth))
  const minHeight = Math.max(1, finiteNumber(limits.minHeight, defaults.minHeight))
  const maxWidth = Math.max(minWidth, finiteNumber(limits.maxWidth, defaults.maxWidth))
  const maxHeight = Math.max(minHeight, finiteNumber(limits.maxHeight, defaults.maxHeight))
  return { minWidth, minHeight, maxWidth, maxHeight }
}

export function normalizeDefaultNodeSize(raw: unknown, limits: NodeSizeLimits): DefaultNodeSize {
  const size = asRecord(raw)
  const defaults = STYLE_CONFIG_DEFAULTS.defaultNodeSize
  return {
    width: clampNumber(finiteNumber(size.width, defaults.width), limits.minWidth, limits.maxWidth),
    height: clampNumber(finiteNumber(size.height, defaults.height), limits.minHeight, limits.maxHeight),
  }
}

export function normalizeDefaultEditorStyle(raw: unknown): DefaultEditorStyle {
  const style = asRecord(raw)
  const defaults = STYLE_CONFIG_DEFAULTS.defaultEditorStyle
  return {
    fontSize: clampNumber(finiteNumber(style.fontSize, defaults.fontSize), EDITOR_STYLE_NUMBER_LIMITS.fontSize.min, EDITOR_STYLE_NUMBER_LIMITS.fontSize.max),
    fontFamily: typeof style.fontFamily === 'string' ? style.fontFamily : defaults.fontFamily,
    backgroundColor: typeof style.backgroundColor === 'string' ? style.backgroundColor : defaults.backgroundColor,
    textColor: typeof style.textColor === 'string' ? style.textColor : defaults.textColor,
    lineHeight: clampNumber(finiteNumber(style.lineHeight, defaults.lineHeight), EDITOR_STYLE_NUMBER_LIMITS.lineHeight.min, EDITOR_STYLE_NUMBER_LIMITS.lineHeight.max),
    contentWidth: clampNumber(finiteNumber(style.contentWidth, defaults.contentWidth), EDITOR_STYLE_NUMBER_LIMITS.contentWidth.min, EDITOR_STYLE_NUMBER_LIMITS.contentWidth.max),
    blockSpacing: clampNumber(finiteNumber(style.blockSpacing, defaults.blockSpacing), EDITOR_STYLE_NUMBER_LIMITS.blockSpacing.min, EDITOR_STYLE_NUMBER_LIMITS.blockSpacing.max),
    headingSpacingRatio: clampNumber(finiteNumber(style.headingSpacingRatio, defaults.headingSpacingRatio), EDITOR_STYLE_NUMBER_LIMITS.headingSpacingRatio.min, EDITOR_STYLE_NUMBER_LIMITS.headingSpacingRatio.max),
    letterSpacing: clampNumber(finiteNumber(style.letterSpacing, defaults.letterSpacing), EDITOR_STYLE_NUMBER_LIMITS.letterSpacing.min, EDITOR_STYLE_NUMBER_LIMITS.letterSpacing.max),
    fontWeight: clampNumber(finiteNumber(style.fontWeight, defaults.fontWeight), EDITOR_STYLE_NUMBER_LIMITS.fontWeight.min, EDITOR_STYLE_NUMBER_LIMITS.fontWeight.max),
  }
}

export function normalizeNodeBadgeSize(raw: unknown): number {
  return clampNumber(finiteNumber(raw, STYLE_CONFIG_DEFAULTS.nodeBadgeSize), NODE_BADGE_SIZE_LIMIT.min, NODE_BADGE_SIZE_LIMIT.max)
}

export function normalizeStyleConfig(raw: unknown): StyleConfigDefaults & { edgeDefaultsVersion: 2 } {
  const config = asRecord(raw)
  const edgeDefaultsVersion = config.edgeDefaultsVersion === 2 ? 2 : undefined
  const nodeSizeLimits = normalizeNodeSizeLimits(config.nodeSizeLimits)
  return {
    edgeDefaultsVersion: 2,
    defaultEdgeStyle: normalizeDefaultEdgeStyle(config.defaultEdgeStyle, edgeDefaultsVersion),
    defaultNodeStyle: normalizeDefaultNodeStyle(config.defaultNodeStyle),
    defaultNodeSize: normalizeDefaultNodeSize(config.defaultNodeSize, nodeSizeLimits),
    defaultEditorStyle: normalizeDefaultEditorStyle(config.defaultEditorStyle),
    nodeSizeLimits,
    nodeBadgeSize: normalizeNodeBadgeSize(config.nodeBadgeSize),
  }
}
