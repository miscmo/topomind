import type { SmartDocumentBlockMenuAction } from './types'

export const SMART_DOCUMENT_TEXT_ACTIONS: SmartDocumentBlockMenuAction[] = [
  { key: 'paragraph', icon: 'T', label: '正文', type: 'paragraph' },
  { key: 'heading-1', icon: 'H', suffix: '1', label: '标题 1', type: 'heading', props: { level: 1 } },
  { key: 'heading-2', icon: 'H', suffix: '2', label: '标题 2', type: 'heading', props: { level: 2 } },
  { key: 'heading-3', icon: 'H', suffix: '3', label: '标题 3', type: 'heading', props: { level: 3 } },
  { key: 'heading-4', icon: 'H', suffix: '4', label: '标题 4', type: 'heading', props: { level: 4 } },
  { key: 'heading-5', icon: 'H', suffix: '5', label: '标题 5', type: 'heading', props: { level: 5 } },
  { key: 'heading-6', icon: 'H', suffix: '6', label: '标题 6', type: 'heading', props: { level: 6 } },
  { key: 'bullet-list', icon: '☷', label: '项目列表', type: 'bulletListItem' },
  { key: 'numbered-list', icon: '☰', label: '编号列表', type: 'numberedListItem' },
  { key: 'check-list', icon: '☑', label: '待办', type: 'checkListItem' },
  { key: 'quote', icon: '❝', label: '引用', type: 'quote' },
  { key: 'divider', icon: '━', label: '分割线', type: 'divider' },
  { key: 'code-block', icon: '</>', label: '代码块', type: 'codeBlock' },
]

export const SMART_DOCUMENT_MEDIA_ACTIONS: SmartDocumentBlockMenuAction[] = [
  { key: 'table', icon: '▦', label: '表格', type: 'table' },
  { key: 'mermaid', icon: '⫸', label: '流程图 (Mermaid)', type: 'mermaid' },
  { key: 'math', icon: '∑', label: '数学公式 (KaTeX)', type: 'math' },
]
