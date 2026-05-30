import type { StyleConfigDefaults } from './styleTypes'
import { NODE_SIZE_LIMIT_DEFAULTS } from './styleConstraints'

export const EDITOR_FONT_FAMILIES = {
  documentSans: '"Inter", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif',
  sans: '"Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif',
  serif: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", "SimSun", serif',
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
    textColor: '#37352f',
    lineHeight: 1.6,
  },
  nodeSizeLimits: NODE_SIZE_LIMIT_DEFAULTS,
  nodeBadgeSize: 14,
}
