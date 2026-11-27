/**
 * 「选中对象 → AI 编辑」的全局选中态真相源（内存态，不落盘）。
 *
 * 为什么单独一个 store：
 *  - graphStore 是 per-tab 的 context store，节点选中态天然留在那里，不重复存；
 *  - 编辑器内的光标 / 选区块只在 BlockNote 组件内部可读，必须有一条上抛通道；
 *  - AI 一轮任务里看到的选中目标必须冻结一致，不能随用户后续点击漂移。
 *
 * 本 store 只存 id / 标题 / 短文本片段，绝不存文档正文或 base64
 * （项目有 base64 撑爆 localStorage 的教训），也不进 sessions.json。
 */
import { create } from 'zustand'
import type { SelectionTargetRef } from '../tools/toolTypes'

const MAX_BLOCK_IDS = 40
const MAX_EXCERPT = 400
const MAX_PINNED = 8

function cleanIds(raw: readonly unknown[]): string[] {
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || result.includes(id)) continue
    result.push(id.slice(0, 128))
    if (result.length >= MAX_BLOCK_IDS) break
  }
  return result
}

/** 逐字符剔除控制字符（不用正则，避免 no-control-regex），再限长。 */
function stripControlChars(raw: string): string {
  let result = ''
  for (const char of raw) {
    const code = char.charCodeAt(0)
    if (code < 32 || code === 127) continue
    result += char
  }
  return result
}

function cleanLabel(raw: string): string {
  return stripControlChars(raw).trim().slice(0, 120)
}

export interface ActiveDocumentInput {
  documentId: string | null
  title?: string
  nodeId?: string | null
}

export interface EditorSelectionInput {
  blockIds: readonly string[]
  excerpt?: string
}

interface AiSelectionState {
  /** 当前右栏打开的文档 id（doc_xxx），关闭右栏时为 null。 */
  documentId: string | null
  documentTitle: string
  /** 当前文档挂在哪个知识节点下，供 node 级工具定位。 */
  documentNodeId: string | null
  /** 编辑器当前光标所在块 / 选区覆盖的块 id。 */
  blockIds: string[]
  /** 选中块的短文本快照，只给模型看，不作定位依据。 */
  blockExcerpt: string
  /** 用户从右键菜单 / 引用条主动附加的目标，发送时优先级最高。 */
  pinned: SelectionTargetRef[]
  setActiveDocument: (next: ActiveDocumentInput) => void
  /** 仅清空指定文档的选中态，避免切换文档时旧组件的 cleanup 误清新值。 */
  clearActiveDocument: (documentId: string | null) => void
  setEditorSelection: (next: EditorSelectionInput) => void
  pinTarget: (target: SelectionTargetRef) => void
  unpinTarget: (id: string) => void
  clearPinned: () => void
}

export const useAiSelectionStore = create<AiSelectionState>((set, get) => ({
  documentId: null,
  documentTitle: '',
  documentNodeId: null,
  blockIds: [],
  blockExcerpt: '',
  pinned: [],

  setActiveDocument: (next) => {
    const documentId = next.documentId
    const previous = get().documentId
    set({
      documentId,
      documentTitle: cleanLabel(next.title ?? ''),
      documentNodeId: next.nodeId ?? null,
      // 换文档必须丢掉旧文档的块 id，否则 AI 会拿 A 文档的 blockId 去改 B 文档。
      ...(previous !== documentId ? { blockIds: [], blockExcerpt: '' } : {}),
    })
  },

  clearActiveDocument: (documentId) => {
    if (get().documentId !== documentId) return
    set({ documentId: null, documentTitle: '', documentNodeId: null, blockIds: [], blockExcerpt: '' })
  },

  setEditorSelection: (next) => {
    const blockIds = cleanIds(next.blockIds)
    const blockExcerpt = stripControlChars(next.excerpt ?? '').slice(0, MAX_EXCERPT)
    const current = get()
    const sameIds = current.blockIds.length === blockIds.length
      && current.blockIds.every((id, index) => id === blockIds[index])
    if (sameIds && current.blockExcerpt === blockExcerpt) return
    set({ blockIds, blockExcerpt })
  },

  pinTarget: (raw) => {
    const id = cleanLabel(raw.id)
    if (!id) return
    const target: SelectionTargetRef = {
      ...raw,
      id,
      label: cleanLabel(raw.label) || id,
      docId: raw.docId ? cleanLabel(raw.docId) : undefined,
      nodeIds: raw.nodeIds ? cleanIds(raw.nodeIds) : undefined,
      blockIds: raw.blockIds ? cleanIds(raw.blockIds) : undefined,
      excerpt: raw.excerpt ? cleanLabel(raw.excerpt).slice(0, MAX_EXCERPT) : undefined,
    }
    const rest = get().pinned.filter((item) => item.id !== id).slice(0, MAX_PINNED - 1)
    set({ pinned: [...rest, target] })
  },

  unpinTarget: (id) => set({ pinned: get().pinned.filter((item) => item.id !== id) }),
  clearPinned: () => set({ pinned: [] }),
}))
