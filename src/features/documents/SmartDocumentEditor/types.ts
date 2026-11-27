import type { SmartDocumentContent } from './smartDocumentTypes'
import type { TocItem } from '../types/workspaceTypes'

export type SmartDocumentBlockMenuMode = 'edit' | 'insert'

/** 「插入块」的方向：相对当前块的上方 / 下方。 */
export type SmartDocumentInsertPlacement = 'before' | 'after'

export interface SmartDocumentBlockMenuAction {
  key: string
  icon: string
  suffix?: string
  label: string
  type: string
  props?: Record<string, unknown>
}

/**
 * 编辑器上抛的「当前选中对象」。blockIds 是 BlockNote 的块 UUID，
 * 是 AI 按块定位修改的唯一依据；excerpt 只是短文本快照，不参与定位。
 */
export interface SmartDocumentSelectionInfo {
  blockIds: string[]
  excerpt: string
  hasTextSelection: boolean
}

export interface SmartDocumentEditorProps {
  value: SmartDocumentContent
  onChange: (value: SmartDocumentContent) => void
  onTocChange?: (items: TocItem[]) => void
  onTocItemClickReady?: (handler: ((item: TocItem) => void) | null) => void
  // 滚动联动：编辑器滚动时把“当前所在标题”的 block id 上抛，供目录高亮选中态
  onTocActiveChange?: (id: string | null) => void
  readOnly?: boolean
  /**
   * 是否注册模块级单例 handler（文档双链打开 / `[[` 选择器 / 链接菜单）。
   * 只读的引用预览会再挂一个编辑器实例，必须传 false，否则它会抢占主编辑器的
   * 注册，卸载时还会把主编辑器的注册清成 null。默认 true 保持既有行为。
   */
  registerGlobalHandlers?: boolean
  uploadFile?: (file: File) => Promise<string | Record<string, unknown>>
  importRemoteImage?: (url: string) => Promise<string | Record<string, unknown>>
  resolveFileUrl?: (url: string) => Promise<string>
  onWordCountChange?: (stats: { characters: number; words: number; blocks: number }) => void
  // 当前选中块的「最后修改时间」(epoch 毫秒)；没有选中块时为 null。
  // 由底部状态栏展示，避免在块内插入标签干扰布局与光标。
  onBlockLastModifiedChange?: (timestamp: number | null) => void
  /** 光标 / 选区变化时上抛块 id，供 AI 选中态通道消费；卸载时回传空选中。 */
  onSelectionChange?: (selection: SmartDocumentSelectionInfo) => void
  attachmentInsertTargetKey?: string
  /** 当前文档实际所属节点路径（附件物理目录）。解析/定位附件必须用这个，不能用文档路径。 */
  attachmentCardPath?: string | null
  /** 点击正文里的文档双链 chip：按 docId 在右栏打开目标文档（可跨节点 / 跨房间）。 */
  onOpenDocumentByDocId?: (docId: string) => void
}

export * from './smartDocumentTypes'
