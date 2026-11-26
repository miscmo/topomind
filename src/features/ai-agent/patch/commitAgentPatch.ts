/**
 * AgentPatch v1 commit（P1 / B 第三段）——全仓唯一的 Patch 写执行点。
 *
 * 硬约束：
 * - 只执行 plan 中 status='ready' 且被用户勾选的项；图类走 graphDelta，
 *   文档 / CardSpec 类走 documentWrite（P2 遗留补齐后已可提交）。
 * - 提交前重取快照比对 digest，预览后用户又改过图就拒绝（不静默覆盖）。
 * - 文档写入本身还有第二道闸：重读磁盘比对预览摘要 + 脏草稿拒绝；
 *   预校验采用「全量通过才写」，任一失败零写入。
 * - 整次图变更包在一个事务里：begin → 一次 applyGraphDelta → end，合并为 1 步 zundo。
 * - 日志只记 taskId / 数量，不记 prompt 正文与节点内容（C10 / C15）。
 */

import {
  AgentPatchError,
  isGraphPatchOpName,
  type AgentDocumentWrite,
  type AgentDocumentWriteOutcome,
  type AgentPatch,
  type AgentPatchErrorCode,
  type PatchPlan,
  type PatchPreviewItem,
  type SnapshotNode,
} from './agentPatchTypes'
import {
  computeGraphDelta,
  computeSnapshotDigest,
  type GraphDeltaState,
} from './dryRunAgentPatch'
import type { WorkspaceApi } from '../../../application/workspace/workspaceApi'

export interface CommitIssue {
  opId: string
  code: AgentPatchErrorCode
  message: string
}

export interface CommitResult {
  ok: boolean
  appliedOpIds: string[]
  skippedOpIds: string[]
  issues: CommitIssue[]
  /** 有图变更时恒为 1（一步 undo）；纯文档写入 / 零改动为 0。 */
  undoSteps: number
  warnings: string[]
}

function throwIssue(code: AgentPatchErrorCode, message: string): never {
  throw new AgentPatchError(code, message)
}

/**
 * @param patch 已经过 normalizeAgentPatch 的 Patch（用于按勾选顺序重算纯变换）
 * @param plan  dryRunAgentPatch 的产出（勾选单位与 digest 的真源）
 * @param selectedOpIds 用户勾选的 item.opId
 * @param api  headless Workspace API（由渲染层注入真实 storeApi / storage / history）
 */
export async function commitAgentPatch(
  patch: AgentPatch,
  plan: PatchPlan,
  selectedOpIds: readonly string[],
  api: WorkspaceApi,
): Promise<CommitResult> {
  const issues: CommitIssue[] = []
  const warnings: string[] = []
  const allIds = plan.items.map((item) => item.opId)
  const skippedOpIds = allIds.filter((id) => !selectedOpIds.includes(id))

  // 取消 = 没有勾选任何项：直接返回，绝不触碰 api，节点零改动。
  if (selectedOpIds.length === 0) {
    return { ok: true, appliedOpIds: [], skippedOpIds, issues, undoSteps: 0, warnings }
  }

  const itemById = new Map<string, PatchPreviewItem>(plan.items.map((item) => [item.opId, item]))
  const selected: PatchPreviewItem[] = []
  for (const id of selectedOpIds) {
    const item = itemById.get(id)
    if (!item) throwIssue('no_selected_ops', `勾选项不在本次预览中: ${id}`)
    if (item.status !== 'ready') {
      throwIssue('op_blocked', `勾选项被阻断: ${id}（${item.blockedReason ?? 'unknown'}）`)
    }
    if (isGraphPatchOpName(item.op)) {
      if (!item.graphDelta) throwIssue('op_blocked', `图类勾选项缺少 graphDelta: ${id}`)
    } else if (!item.documentWrite) {
      throwIssue('op_blocked', `文档类勾选项缺少 documentWrite: ${id}`)
    }
    selected.push(item)
  }
  selected.sort((a, b) => a.index - b.index)

  if (!api.isEditable()) throwIssue('guard_rejected', '画布处于只读状态，Patch 未提交')
  const liveSnapshot = api.snapshot()
  const liveDigest = computeSnapshotDigest(liveSnapshot)
  if (liveDigest !== plan.snapshotDigest) {
    throwIssue('snapshot_stale', '预览后工作区已变化，请重新生成预览')
  }

  const documentItems = selected.filter((item) => !isGraphPatchOpName(item.op))
  const documentWrites: AgentDocumentWrite[] = documentItems.map((item) => item.documentWrite!)
  // 预览项与 plan 上的摘要必须一致，防止调用方替换 plan.items 绕过并发校验。
  for (const write of documentWrites) {
    if (!write.baseDigest) continue
    if (plan.documentDigests?.[write.documentId] !== write.baseDigest) {
      throwIssue('snapshot_stale', `文档预览摘要不一致，请重新生成预览: ${write.documentId}`)
    }
  }

  // 文档写入先执行：它自带「全量预校验 → 零写入」语义。失败时图一点也不动。
  let writeOutcomes: AgentDocumentWriteOutcome[] = []
  if (documentWrites.length > 0) {
    writeOutcomes = await api.applyDocumentWrites(documentWrites)
    const failed = writeOutcomes.filter((outcome) => !outcome.ok)
    if (failed.length > 0) {
      for (const outcome of failed) {
        issues.push({
          opId: outcome.opId,
          code: outcome.code ?? 'document_write_failed',
          message: outcome.message ?? '文档写入失败',
        })
      }
      return { ok: false, appliedOpIds: [], skippedOpIds, issues, undoSteps: 0, warnings }
    }
  }

  // 按勾选顺序重新累积纯变换：跳过某项时后续 op 的状态基于「没有它」的结果。
  let state: GraphDeltaState = {
    nodes: liveSnapshot.nodes,
    edges: liveSnapshot.edges,
  }
  for (const item of selected) {
    if (!isGraphPatchOpName(item.op)) continue
    try {
      const delta = computeGraphDelta(state, patch.ops[item.index], item.index, patch.taskId)
      state = delta.state
    } catch (error) {
      const code: AgentPatchErrorCode = error instanceof AgentPatchError ? error.code : 'commit_failed'
      throw new AgentPatchError(code, `${item.opId} 变换失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // cardspec.create 的真实 documentId 只有写盘后才知道，此刻补上容器节点指针。
  const outcomeByOpId = new Map(writeOutcomes.map((outcome) => [outcome.opId, outcome]))
  let createdContainers = 0
  for (const item of documentItems) {
    if (item.op !== 'cardspec.create' || !item.documentWrite) continue
    const outcome = outcomeByOpId.get(item.opId)
    if (!outcome?.ok) continue
    const write = item.documentWrite
    const xs = state.nodes.map((node) => node.position.x)
    const ys = state.nodes.map((node) => node.position.y)
    const node: SnapshotNode = {
      id: write.nodeId ?? `agent-n-${item.index}`,
      label: write.title ?? '知识卡片容器',
      roomPath: liveSnapshot.roomPath,
      position: {
        x: xs.length > 0 ? Math.max(...xs) + 280 : 0,
        y: ys.length > 0 ? Math.min(...ys) : 0,
      },
      containerType: 'cardspec',
      linkedDocumentIds: [outcome.documentId],
    }
    state = { nodes: [...state.nodes, node], edges: state.edges }
    createdContainers += 1
  }

  const hasGraphChange = selected.some((item) => isGraphPatchOpName(item.op)) || createdContainers > 0
  if (hasGraphChange) {
    api.beginTransaction()
    try {
      api.applyGraphDelta(state)
      try {
        await api.flush()
      } catch {
        // 落盘失败不回滚内存事务：既有 saveLater 会重试，撤销栈仍可用。
        warnings.push('图数据落盘失败，已保留内存变更并将由自动保存重试')
      }
      api.endTransaction()
    } catch (error) {
      api.abortTransaction()
      const code: AgentPatchErrorCode = error instanceof AgentPatchError ? error.code : 'commit_failed'
      issues.push({ opId: selected[0]?.opId ?? '', code, message: error instanceof Error ? error.message : String(error) })
      return {
        ok: false, appliedOpIds: [], skippedOpIds, issues, undoSteps: 0, warnings,
      }
    }
  }

  api.log('ai.patch_commit', {
    taskId: patch.taskId,
    applied: selected.length,
    affected: selected.reduce((sum, item) => sum + item.affectedCount, 0),
    undoSteps: hasGraphChange ? 1 : 0,
  })

  return {
    ok: true,
    appliedOpIds: selected.map((item) => item.opId),
    skippedOpIds,
    issues,
    undoSteps: hasGraphChange ? 1 : 0,
    warnings,
  }
}
