import type { StyleConfigDefaults } from './styleTypes'
import { NODE_SIZE_LIMIT_DEFAULTS } from './styleConstraints'

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
    fontFamily: 'inherit',
    backgroundColor: '#ffffff',
    textColor: '#333333',
    lineHeight: 1.5,
  },
  nodeSizeLimits: NODE_SIZE_LIMIT_DEFAULTS,
  nodeBadgeSize: 14,
}
