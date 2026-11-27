/**
 * AI 回答引用的「临时预览」态（P5-r）。
 *
 * 语义硬约束：点击回答里的 [ref:i] 只是把目标文档借右栏看一眼，
 * **绝不**改变画布所在的房间 / 知识库，也**绝不**改变选中节点。
 * 因此这里只存展示所需的最小描述：不落盘、不写 detailPanelStore、
 * 不碰 tabStore / graphStore。关闭后右栏原样恢复。
 */
import { create } from 'zustand'

export interface ReferencePreviewTarget {
  docId: string
  /** 目标文档实际所属节点路径：读正文 / 附件一律用它，不能用当前选中节点。 */
  cardPath: string
  title: string
  type?: string
  nodeName?: string
  sourceLabel?: string
  /** 引用编号与三层可读名字，只用于预览条展示，不参与任何定位。 */
  ref?: number
  breadcrumb?: string
  blockLabel?: string
  snippet?: string
}

interface ReferencePreviewStore {
  target: ReferencePreviewTarget | null
  openPreview: (target: ReferencePreviewTarget) => void
  closePreview: () => void
}

export const useReferencePreviewStore = create<ReferencePreviewStore>()((set) => ({
  target: null,
  openPreview: (target) => set({ target }),
  closePreview: () => set({ target: null }),
}))
