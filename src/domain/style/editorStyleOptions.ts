import type { DefaultEditorStyle, EditorPaperBackground } from './styleTypes'
import { STYLE_CONFIG_DEFAULTS } from './styleDefaults'

/**
 * 智能文档编辑器样式的共享定义（domain 层，单一来源）。
 * 顶部工具栏的样式浮层是现在的入口，右栏样式面板只保留预览与指引；
 * 两边都要用同一份预设/选项，避免各写一份 hex 或字体 id 导致漂移。
 */
export const EDITOR_STYLE_PRESETS: Array<{ label: string; style: DefaultEditorStyle }> = [
  { label: '默认', style: STYLE_CONFIG_DEFAULTS.defaultEditorStyle },
  { label: '护眼', style: { fontSize: 16, fontFamily: 'document-sans', backgroundColor: '#f7f3e8', textColor: '#3f3a2f', lineHeight: 1.75, contentWidth: 1200, contentMarginRatio: 0.5, blockSpacing: 6, headingSpacingRatio: 1.5, letterSpacing: 0, fontWeight: 400, paperBackground: 'plain' } },
  { label: '紧凑', style: { fontSize: 14, fontFamily: 'document-sans', backgroundColor: '#ffffff', textColor: '#1f2937', lineHeight: 1.5, contentWidth: 1200, contentMarginRatio: 0.5, blockSpacing: 4, headingSpacingRatio: 1.0, letterSpacing: -0.01, fontWeight: 400, paperBackground: 'plain' } },
]

export const PAPER_BACKGROUND_OPTIONS: Array<{ label: string; value: EditorPaperBackground }> = [
  { label: '无', value: 'plain' },
  { label: '参考线', value: 'ruled' },
  { label: '点阵', value: 'dot-grid' },
  { label: '方格', value: 'grid' },
  { label: '牛皮', value: 'kraft' },
  { label: '红装订线', value: 'manuscript' },
]

export const EDITOR_FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '默认', value: 'document-sans' },
  { label: '黑体', value: 'sans-serif' },
  { label: '宋体', value: 'serif' },
  { label: '思源黑', value: 'noto-sans' },
  { label: '霞鹜文楷', value: 'lxgw' },
  { label: '楷体', value: 'kaiti' },
]
