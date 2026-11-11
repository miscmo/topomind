/**
 * 房间级「图型分类」的唯一规则源（P3-A，纯函数：无 DOM / 无 store / 无 IPC，
 * 供回归脚本 esbuild 打包真跑）。
 *
 * 【用户决策 2026-11-08】不同图谱不该共用一套操作：
 *   - 知识结构树：从属层级为主，缩小画布时按深度逐级显现（语义缩放的正面场景）；
 *   - 流程图：线性推进、没有层级，不应按深度隐藏节点，语义缩放始终关闭；
 *   - 自由关联图：网状弱关系，沿用默认行为；
 *   - 自动识别：按房间结构推断，只给建议/默认策略，用户随时可手动覆盖。
 *
 * 边界（刻意不做，避免过度工程化）：
 *   - **不做**「同画布主图型 + 辅助图型」的组合与继承体系（用户明确列为后期）；
 *   - **不做**按图型新增关系类型或样式模板；关系永远只有 related / subordinate；
 *   - 图型是**视图意图**，存在全局 `_config.json` 的 `roomProfiles`（roomPath → id），
 *     不进 `_graph.json` 索引、不碰节点/边字段 7 处白名单；旧房间无配置即为 `auto`。
 */
import type { EdgeRelation } from '../../types'

export const GRAPH_PROFILE_IDS = ['auto', 'tree', 'flow', 'network'] as const

export type GraphProfileId = typeof GRAPH_PROFILE_IDS[number]
/** `auto` 只是「跟随推断」，推断结果一定是下面三种之一。 */
export type ConcreteGraphProfileId = Exclude<GraphProfileId, 'auto'>

export interface GraphProfileDefinition {
  id: GraphProfileId
  label: string
  description: string
  /** 用户 LOD 处于「自动」时由图型给出的默认模式 */
  lodMode: 'auto' | 'off'
  /**
   * 用户显式声明「这是层级图」→ 跳过「树覆盖率过低」保护。
   * 注意：无树保护（一条从属边都没有）不会被跳过，仍然自动关闭 LOD。
   */
  skipCoverageProtection: boolean
  /** 新建连线浮层里的推荐关系：仅排序 + 标记，**绝不自动落盘** */
  preferredRelation: EdgeRelation | null
}

/** 唯一定义表：新增图型只改这里，UI / 回归共用。 */
export const GRAPH_PROFILE_DEFINITIONS: readonly GraphProfileDefinition[] = [
  {
    id: 'auto',
    label: '自动识别',
    description: '按房间结构推断图型，跟随推断结果定制操作',
    lodMode: 'auto',
    skipCoverageProtection: false,
    preferredRelation: null,
  },
  {
    id: 'tree',
    label: '知识结构树',
    description: '从属层级为主，缩小画布时按深度逐级显现',
    lodMode: 'auto',
    skipCoverageProtection: true,
    preferredRelation: 'subordinate',
  },
  {
    id: 'flow',
    label: '流程图',
    description: '线性推进、无层级，语义缩放始终关闭',
    lodMode: 'off',
    skipCoverageProtection: false,
    preferredRelation: 'related',
  },
  {
    id: 'network',
    label: '自由关联图',
    description: '网状弱关系，沿用默认行为',
    lodMode: 'auto',
    skipCoverageProtection: false,
    preferredRelation: 'related',
  },
]

export function normalizeGraphProfileId(raw: unknown): GraphProfileId {
  if (typeof raw !== 'string') return 'auto'
  const value = raw.trim().toLowerCase()
  return (GRAPH_PROFILE_IDS as readonly string[]).includes(value)
    ? value as GraphProfileId
    : 'auto'
}

/** `_config.json` 的 roomProfiles 归一化：非法键/值一律收敛，读多少次都幂等。 */
export function normalizeRoomProfiles(raw: unknown): Record<string, GraphProfileId> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, GraphProfileId> = {}
  for (const [room, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!room) continue
    result[room] = normalizeGraphProfileId(value)
  }
  return result
}

export function resolveGraphProfileDefinition(raw: unknown): GraphProfileDefinition {
  const id = normalizeGraphProfileId(raw)
  return GRAPH_PROFILE_DEFINITIONS.find((item) => item.id === id) ?? GRAPH_PROFILE_DEFINITIONS[0]
}

export function describeGraphProfile(raw: unknown): string {
  return resolveGraphProfileDefinition(raw).label
}

/** 自动识别只依据「已派生的树统计 + 边的稠密度」，不重新遍历全图。 */
export interface GraphProfileSignals {
  nodeCount: number
  edgeCount: number
  subordinateEdgeCount: number
  /** 0~1，树上的节点 / 全部节点 */
  treeCoverage: number
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * 保守推断，结论只作为建议（用户可一键手动覆盖）：
 *   - 无从属边 + 低平均度（链式/星状稀疏）→ 流程图；
 *   - 有从属边且树覆盖率 ≥60% → 知识结构树；
 *   - 其余 → 自由关联图。
 * 不从 relation 之外的信息猜语义，避免把普通网状图误判成流程图。
 */
export function inferGraphProfile(signals: GraphProfileSignals): ConcreteGraphProfileId {
  const nodeCount = finiteNonNegative(signals.nodeCount)
  const edgeCount = finiteNonNegative(signals.edgeCount)
  const subordinateEdgeCount = finiteNonNegative(signals.subordinateEdgeCount)
  const coverage = typeof signals.treeCoverage === 'number' && Number.isFinite(signals.treeCoverage)
    ? Math.max(0, Math.min(1, signals.treeCoverage))
    : 0

  if (subordinateEdgeCount === 0) {
    const avgDegree = nodeCount > 0 ? (2 * edgeCount) / nodeCount : 0
    return edgeCount >= 2 && nodeCount >= 3 && avgDegree <= 2.2 ? 'flow' : 'network'
  }
  return coverage >= 0.6 && subordinateEdgeCount >= 2 ? 'tree' : 'network'
}

/** `auto` 解析成推断结果，其余原样返回。 */
export function resolveEffectiveGraphProfileId(
  configured: unknown,
  inferred: ConcreteGraphProfileId,
): ConcreteGraphProfileId {
  const id = normalizeGraphProfileId(configured)
  return id === 'auto' ? inferred : id
}

export interface GraphProfileLodPolicy {
  mode: 'auto' | 'off' | 'force'
  skipCoverageProtection: boolean
  source: 'user' | 'profile'
}

/**
 * 优先级：**用户手动选择（关闭 / 强制）永远压过图型**。
 * 只有用户停在「自动」时，图型才提供默认 LOD 模式与保护豁免。
 */
export function resolveGraphProfileLodPolicy(
  effectiveId: unknown,
  userMode: unknown,
): GraphProfileLodPolicy {
  if (userMode === 'off' || userMode === 'force') {
    return { mode: userMode, skipCoverageProtection: false, source: 'user' }
  }
  const id = normalizeGraphProfileId(effectiveId)
  const definition = resolveGraphProfileDefinition(id === 'auto' ? 'network' : id)
  return {
    mode: definition.lodMode,
    skipCoverageProtection: definition.skipCoverageProtection,
    source: 'profile',
  }
}

/** 新建连线浮层的推荐关系；`auto` 图型（未解析）不推荐，保持原始顺序。 */
export function recommendedRelationForProfile(effectiveId: unknown): EdgeRelation | null {
  const id = normalizeGraphProfileId(effectiveId)
  if (id === 'auto') return null
  return resolveGraphProfileDefinition(id).preferredRelation
}

/** 推荐项排到第一位，其余保持原有顺序；两个选项仍都必须显式点选。 */
export function orderEdgeRelationOptions<T extends string>(
  ids: readonly T[],
  recommended: T | null,
): T[] {
  if (!recommended || !ids.includes(recommended)) return [...ids]
  return [recommended, ...ids.filter((id) => id !== recommended)]
}
