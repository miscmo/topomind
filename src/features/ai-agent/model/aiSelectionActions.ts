/**
 * 「选中 → 让 AI 修改」的应用级动作。
 *
 * 各 feature（图谱右键、块菜单、选区工具条、引用条）只调这里的入口，
 * 不用各自去拼 store 写入 + 打开面板 + 预填输入框，避免四处行为不一致。
 * 目标一律以稳定 id 传递，标题只用于 chip 展示。
 */
import { useNodeTreePanelStore } from '@/stores/nodeTreePanelStore'
import type { SelectionTargetRef } from '../tools/toolTypes'
import { useAgentComposerStore } from './agentComposerStore'
import { useAiSelectionStore } from './aiSelectionStore'

const DEFAULT_PROMPT = '请根据选中的内容给出修改建议。'

export function targetForNode(nodeId: string, label: string): SelectionTargetRef {
  return { kind: 'node', id: nodeId, label: label || nodeId, nodeIds: [nodeId] }
}

export function targetForNodes(nodeIds: readonly string[], label: string): SelectionTargetRef {
  const ids = [...nodeIds]
  return { kind: 'node', id: `nodes:${ids.join(',')}`, label, nodeIds: ids }
}

export function targetForDocument(docId: string, title: string, nodeId?: string | null): SelectionTargetRef {
  return { kind: 'document', id: docId, label: title || docId, docId, nodeIds: nodeId ? [nodeId] : undefined }
}

export function targetForBlocks(
  docId: string,
  blockIds: readonly string[],
  label: string,
  excerpt?: string,
): SelectionTargetRef {
  const ids = [...blockIds]
  return {
    kind: 'block',
    id: `blocks:${docId}:${ids.join(',')}`,
    label,
    docId,
    blockIds: ids,
    excerpt: excerpt?.slice(0, 400),
  }
}

/**
 * pin 目标 → 展开 AI 面板 → 预填一句提示词。
 * 不自动发送：写操作本来就必须在 PatchPreview 里由用户逐项确认。
 */
export function requestAiEdit(target: SelectionTargetRef, prompt: string = DEFAULT_PROMPT): void {
  useAiSelectionStore.getState().pinTarget(target)
  const state = useNodeTreePanelStore.getState()
  if (state.activePanelId !== 'agent' || state.collapsed) state.setActivePanel('agent')
  useAgentComposerStore.getState().setPendingDraft(prompt)
}
