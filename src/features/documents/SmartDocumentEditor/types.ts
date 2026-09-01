import type { SmartDocumentContent } from './smartDocumentTypes'
import type { TocItem } from '../types/workspaceTypes'

export type SmartDocumentBlockMenuMode = 'edit' | 'insert'

export interface SmartDocumentBlockMenuAction {
  key: string
  icon: string
  suffix?: string
  label: string
  type: string
  props?: Record<string, unknown>
}

export interface SmartDocumentEditorProps {
  value: SmartDocumentContent
  onChange: (value: SmartDocumentContent) => void
  onTocChange?: (items: TocItem[]) => void
  onTocItemClickReady?: (handler: ((item: TocItem) => void) | null) => void
  // 滚动联动：编辑器滚动时把“当前所在标题”的 block id 上抛，供目录高亮选中态
  onTocActiveChange?: (id: string | null) => void
  readOnly?: boolean
  uploadFile?: (file: File) => Promise<string | Record<string, unknown>>
  importRemoteImage?: (url: string) => Promise<string | Record<string, unknown>>
  resolveFileUrl?: (url: string) => Promise<string>
  onWordCountChange?: (stats: { characters: number; words: number; blocks: number }) => void
  // 当前选中块的「最后修改时间」(epoch 毫秒)；没有选中块时为 null。
  // 由底部状态栏展示，避免在块内插入标签干扰布局与光标。
  onBlockLastModifiedChange?: (timestamp: number | null) => void
  attachmentInsertTargetKey?: string
}

export * from './smartDocumentTypes'
