import type { DefaultEdgeStyle, DefaultEditorStyle, DefaultNodeSize, DefaultNodeStyle } from '../../../types/uiStoreTypes'
import { STYLE_CONFIG_DEFAULTS } from '../../../domain/style/styleDefaults'

export const NODE_STYLE_PRESETS: Array<{ label: string; style: DefaultNodeStyle; size: DefaultNodeSize }> = [
  {
    label: '清爽',
    style: {
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
    size: { width: 120, height: 52 },
  },
  {
    label: '蓝调',
    style: {
      headerFontSize: 12,
      bodyFontSize: 12,
      headerColor: '#1d4ed8',
      headerBackgroundColor: '#eff6ff',
      headerFontWeight: 'bold',
      headerFontStyle: 'normal',
      borderColor: '#93c5fd',
      borderWidth: 1,
      borderRadius: 10,
    },
    size: { width: 132, height: 56 },
  },
  {
    label: '高对比',
    style: {
      headerFontSize: 13,
      bodyFontSize: 12,
      headerColor: '#ffffff',
      headerBackgroundColor: '#0f172a',
      headerFontWeight: 'bold',
      headerFontStyle: 'normal',
      borderColor: '#334155',
      borderWidth: 2,
      borderRadius: 6,
    },
    size: { width: 136, height: 58 },
  },
]

export const EDGE_STYLE_PRESETS: Array<{ label: string; style: DefaultEdgeStyle }> = [
  { label: '默认', style: STYLE_CONFIG_DEFAULTS.defaultEdgeStyle },
  { label: '柔和', style: { lineMode: 'smoothstep', lineStyle: 'solid', color: '#60a5fa', arrow: true } },
  { label: '虚线', style: { lineMode: 'smoothstep', lineStyle: 'dashed', color: '#94a3b8', arrow: false } },
]

export const EDITOR_STYLE_PRESETS: Array<{ label: string; style: DefaultEditorStyle }> = [
  { label: '默认', style: STYLE_CONFIG_DEFAULTS.defaultEditorStyle },
  { label: '护眼', style: { fontSize: 16, fontFamily: 'document-sans', backgroundColor: '#f7f3e8', textColor: '#3f3a2f', lineHeight: 1.7 } },
  { label: '紧凑', style: { fontSize: 14, fontFamily: 'document-sans', backgroundColor: '#ffffff', textColor: '#1f2937', lineHeight: 1.35 } },
]
