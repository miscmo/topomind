import type { StyleConfigDefaults } from './styleTypes'
import { NODE_SIZE_LIMIT_DEFAULTS } from './styleConstraints'

export const EDITOR_FONT_FAMILIES = {
  documentSans: '"Inter", "SF Pro Display", "PingFang SC", "Helvetica Neue", "Microsoft YaHei", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  sans: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  serif: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", "SimSun", serif',
  lxgw: '"LXGW WenKai", "LXGW WenKai Screen", "Source Han Serif SC", "Noto Serif SC", serif',
  notoSans: '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  kaiti: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif',
} as const

export function resolveEditorFontFamily(fontFamily: string | null | undefined): string {
  switch (fontFamily) {
    case 'inherit':
    case 'document-sans':
    case '':
    case undefined:
    case null:
      return EDITOR_FONT_FAMILIES.documentSans
    case 'sans-serif':
      return EDITOR_FONT_FAMILIES.sans
    case 'serif':
      return EDITOR_FONT_FAMILIES.serif
    case 'lxgw':
      return EDITOR_FONT_FAMILIES.lxgw
    case 'noto-sans':
      return EDITOR_FONT_FAMILIES.notoSans
    case 'kaiti':
      return EDITOR_FONT_FAMILIES.kaiti
    default:
      return fontFamily
  }
}

export function resolveEditorFontChoice(fontFamily: string | null | undefined): string {
  if (!fontFamily || fontFamily === 'inherit' || fontFamily === EDITOR_FONT_FAMILIES.documentSans) {
    return 'document-sans'
  }
  if (fontFamily === 'sans-serif' || fontFamily === EDITOR_FONT_FAMILIES.sans) {
    return 'sans-serif'
  }
  if (fontFamily === 'serif' || fontFamily === EDITOR_FONT_FAMILIES.serif) {
    return 'serif'
  }
  if (fontFamily === 'lxgw' || fontFamily === EDITOR_FONT_FAMILIES.lxgw) {
    return 'lxgw'
  }
  if (fontFamily === 'noto-sans' || fontFamily === EDITOR_FONT_FAMILIES.notoSans) {
    return 'noto-sans'
  }
  if (fontFamily === 'kaiti' || fontFamily === EDITOR_FONT_FAMILIES.kaiti) {
    return 'kaiti'
  }
  return fontFamily
}

export const STYLE_CONFIG_DEFAULTS: StyleConfigDefaults = {
  defaultEdgeStyle: {
    lineMode: 'straight',
    lineStyle: 'solid',
    color: '#7f8c8d',
    arrow: true,
  },
  defaultNodeStyle: {
    headerFontSize: 11,
    bodyFontSize: 12,
    headerColor: '#475569',
    headerBackgroundColor: '#f8fafc',
    headerFontWeight: 'normal',
    headerFontStyle: 'normal',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 8,
  },
  defaultNodeSize: {
    width: 120,
    height: 52,
  },
  defaultEditorStyle: {
    fontSize: 16,
    fontFamily: 'document-sans',
    backgroundColor: '#ffffff',
    textColor: '#333333',
    lineHeight: 1.75,
    contentWidth: 800,
    blockSpacing: 6,
    headingSpacingRatio: 1.5,
    letterSpacing: -0.003,
    fontWeight: 400,
  },
  nodeSizeLimits: NODE_SIZE_LIMIT_DEFAULTS,
  nodeBadgeSize: 14,
}
