/**
 * 选中上下文的组装与外发（唯一出口）。
 *
 * 边界：
 *  - 节点选中态来自 per-tab 的 graphStore，由调用方传入，本模块不碰 React context；
 *  - 文档 / 块 / 引用来自 aiSelectionStore；
 *  - 一份快照在发问瞬间冻结，整轮工具循环看到的都是同一批 id，不会因为
 *    用户中途点了别的节点而漂移。
 *  - 外发内容只有 id、标题、短片段；从不包含磁盘路径、workDir 或文档全文。
 */
import type { PromptVarValues } from '../config/renderPrompt'
import type { SelectionContextSnapshot, SelectionTargetRef } from '../tools/toolTypes'
import { useAiSelectionStore } from './aiSelectionStore'

const MAX_NODE_IDS = 40
const MAX_NODE_LABEL = 60

export const EMPTY_SELECTION_SNAPSHOT: SelectionContextSnapshot = {
  documentId: null,
  documentTitle: '',
  documentNodeId: null,
  nodeIds: [],
  nodeLabels: [],
  blockIds: [],
  blockExcerpt: '',
  pinned: [],
}

export interface SelectionSnapshotInput {
  nodeIds: readonly string[]
  nodeLabels: readonly string[]
}

/** 冻结一次发问的选中目标。 */
export function buildSelectionSnapshot(input: SelectionSnapshotInput): SelectionContextSnapshot {
  const state = useAiSelectionStore.getState()
  const nodeIds = input.nodeIds.filter((id) => typeof id === 'string' && id.trim()).slice(0, MAX_NODE_IDS)
  return {
    documentId: state.documentId,
    documentTitle: state.documentTitle,
    documentNodeId: state.documentNodeId,
    nodeIds: [...nodeIds],
    nodeLabels: input.nodeLabels.slice(0, nodeIds.length).map((label) => label.slice(0, MAX_NODE_LABEL)),
    blockIds: [...state.blockIds],
    blockExcerpt: state.blockExcerpt,
    pinned: [...state.pinned],
  }
}

function hasTargets(snapshot: SelectionContextSnapshot): boolean {
  return Boolean(snapshot.documentId || snapshot.nodeIds.length || snapshot.blockIds.length || snapshot.pinned.length)
}

function describePinned(target: SelectionTargetRef): string {
  const parts = [target.label || target.id]
  if (target.docId) parts.push(`docId=${target.docId}`)
  if (target.nodeIds?.length) parts.push(`nodeIds=${target.nodeIds.join(',')}`)
  if (target.blockIds?.length) parts.push(`blockIds=${target.blockIds.join(',')}`)
  return `${target.kind}:${target.id}（${parts.join(' / ')}）`
}

/**
 * 追加到本轮 user message 的选中目标信封。
 * 只发当前这一轮，不写进会话正文：历史消息保持用户原文，下一轮会带新的快照。
 */
export function buildSelectionEnvelope(snapshot: SelectionContextSnapshot): string {
  if (!hasTargets(snapshot)) return ''
  const lines: string[] = ['[选中目标 · 本轮唯一有效的定位依据]']
  if (snapshot.documentId) {
    lines.push(`文档 docId=${snapshot.documentId}${snapshot.documentTitle ? `（${snapshot.documentTitle}）` : ''}`)
  }
  if (snapshot.documentNodeId) lines.push(`文档所属节点 nodeId=${snapshot.documentNodeId}`)
  if (snapshot.nodeIds.length) {
    const labels = snapshot.nodeIds.map((id, index) => {
      const label = snapshot.nodeLabels[index]
      return label ? `${id}（${label}）` : id
    })
    lines.push(`选中节点 nodeIds=${labels.join(', ')}`)
  }
  if (snapshot.blockIds.length) lines.push(`选中内容块 blockIds=${snapshot.blockIds.join(', ')}`)
  if (snapshot.pinned.length) lines.push(`附加引用：${snapshot.pinned.map(describePinned).join('；')}`)
  if (snapshot.blockExcerpt) lines.push(`选中片段（仅供理解，不作定位）：${snapshot.blockExcerpt}`)
  // 旧版这里要求「块 id 不存在时先 document.read 核对」，模型因此习惯先输出一句
  // 「我先读取这篇文档…：」再调工具；一旦网关没回传 tool_calls，本轮就直接结束，
  // 用户看到半句话没有下文。现在改为：内容已随本轮附带，禁止只输出计划就停止。
  lines.push('本轮已随消息附上这些目标的当前内容，请直接基于内容作答，不要先声明「我先读取 / 我先查看」，也不要只输出计划就停止。')
  lines.push('定位一律使用上述 id，不要用标题、路径或位置猜测；若某个 id 不在随附的内容清单里，说明该块不存在，请如实告知用户，不要臆造。')
  lines.push('需要生成可勾选的修改预览时，再直接调用写工具（function name 用下划线形式）：document_polish（documentId + blockIds + blocks）替换块、document_draft（documentId + afterBlockId + blocks）插入块、node_style / node_rename（nodeIds / nodeId）改节点；不要只用文字描述将要调用。')
  return lines.join('\n')
}

/** 补齐模板变量，避免 renderPrompt 降级成 [未提供:var]。缺失项如实写「（无）」。 */
export function buildSelectionPromptValues(
  snapshot: SelectionContextSnapshot,
  extra?: { activeTabId?: string; roomPath?: string },
): PromptVarValues {
  const nodeLabels = snapshot.nodeIds.map((id, index) => {
    const label = snapshot.nodeLabels[index]
    return label ? `${id}（${label}）` : id
  })
  const pinned = snapshot.pinned.map(describePinned)
  return {
    nodeTitle: nodeLabels[0] ?? '（无选中节点）',
    selectedNodes: nodeLabels.length ? nodeLabels.join('、') : '（无选中节点）',
    documentTitle: snapshot.documentTitle || (snapshot.documentId ? snapshot.documentId : '（无当前文档）'),
    documentSummary: [
      snapshot.blockIds.length ? `选中块 ${snapshot.blockIds.join(', ')}` : '',
      snapshot.blockExcerpt ? `片段：${snapshot.blockExcerpt}` : '',
      pinned.length ? `附加引用：${pinned.join('；')}` : '',
    ].filter(Boolean).join('\n') || '（本轮未提供选中片段）',
    activeTab: extra?.activeTabId || '（未知）',
    roomPath: extra?.roomPath || '（未知）',
    linkedDocuments: '（本轮未提供关联文档清单，可调用 graph.relations 查询）',
  }
}

/** 引用条 / 会话 chip 展示用的短标签。 */
export function describeSelectionTarget(target: SelectionTargetRef): string {
  return target.label || target.id
}
