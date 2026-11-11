import type { EdgeStylePatch, EdgeRelation } from '../../types'
import { EDGE_COLOR_PRESETS, STYLE_CONFIG_DEFAULTS } from '../style/styleDefaults.ts'
import { normalizeDefaultEdgeStyle } from '../style/normalizeStyleConfig.ts'
import type { DefaultEdgeStyle } from '../style/styleTypes'

/**
 * 连线关系的唯一规则源。
 *
 * 【用户决策 2026-11-08】语义收敛为**两类**，并做**物理磁盘迁移**：
 *   - `related`     关联（弱关系）：不参与树，不参与层级推导，随便连。
 *   - `subordinate` 从属（强关系）：方向钉死 **source = 父 → target = 子**。
 *     唯一父、无环、深度 ≤ 100，由 `graphHierarchy.ts` 强校验。
 *
 * 旧值（中文三值 / 四种内置 id / 已删除的自定义 `rel_*`）只在**读取侧**经
 * `LEGACY_EDGE_RELATION_MAP` 映射回两值；磁盘上恒为两值之一。这样导入外部旧档、
 * 恢复迁移备份时都能自愈，不需要第二套格式。
 *
 * 关系定义仍用稳定 id 落在全局 `_config.json`，显示名可改；内置关系带一套默认
 * 连线样式，切换关系时套用、之后仍可单条覆盖。
 */

export const DEFAULT_EDGE_RELATION_ID: EdgeRelation = 'related'
export const SUBORDINATE_EDGE_RELATION_ID: EdgeRelation = 'subordinate'

/** 全部合法落盘值。回归脚本会断言这个数组恰好两项。 */
export const EDGE_RELATION_IDS: readonly EdgeRelation[] = [
  DEFAULT_EDGE_RELATION_ID,
  SUBORDINATE_EDGE_RELATION_ID,
] as const

export interface EdgeRelationDefinition {
  /** 稳定 id，落盘后不可变；改名只动 name */
  id: string
  /** 显示名（线上标签、下拉项） */
  name: string
  /** 语义提示，显示在下拉项副标题 */
  description?: string
  /** 该关系的默认连线样式；选/切关系时套用到边，之后仍可单条覆盖 */
  style: DefaultEdgeStyle
  /** 内置关系不可删除（可改名、可改样式） */
  builtin?: boolean
}

const [GREY, BLUE] = EDGE_COLOR_PRESETS
const BASE_STYLE = STYLE_CONFIG_DEFAULTS.defaultEdgeStyle

function relationStyle(patch: Partial<DefaultEdgeStyle>): DefaultEdgeStyle {
  return { ...BASE_STYLE, ...patch }
}

/**
 * 两种内置关系。样式差异只用现有边样式字段表达：
 *   关联 = 灰细实线 / 空心箭头（等同全局默认）
 *   从属 = 蓝实线 / 空心箭头（父 → 子，构成树）
 */
export const BUILTIN_EDGE_RELATIONS: readonly EdgeRelationDefinition[] = [
  {
    id: DEFAULT_EDGE_RELATION_ID,
    name: '关联',
    description: '弱关系：两个节点有关联，不参与层级树',
    style: relationStyle({ color: GREY }),
    builtin: true,
  },
  {
    id: SUBORDINATE_EDGE_RELATION_ID,
    name: '从属',
    description: '强关系：父 → 子，唯一父、无环、深度 1~100',
    style: relationStyle({ color: BLUE, lineWidth: 1.5, arrowShape: 'hollow' }),
    builtin: true,
  },
]

/**
 * 旧值 → 两值的**只读**兼容映射。磁盘迁移脚本与所有读盘入口共用这一份，
 * 未知值（含被删除的自定义 `rel_*`）一律回退「关联」。
 */
export const LEGACY_EDGE_RELATION_MAP: Readonly<Record<string, EdgeRelation>> = {
  '相关': DEFAULT_EDGE_RELATION_ID,
  '关联': DEFAULT_EDGE_RELATION_ID,
  'related': DEFAULT_EDGE_RELATION_ID,
  '依赖': SUBORDINATE_EDGE_RELATION_ID,
  '演进': SUBORDINATE_EDGE_RELATION_ID,
  '从属': SUBORDINATE_EDGE_RELATION_ID,
  '组成': SUBORDINATE_EDGE_RELATION_ID,
  '推导': SUBORDINATE_EDGE_RELATION_ID,
  'is-a': SUBORDINATE_EDGE_RELATION_ID,
  'part-of': SUBORDINATE_EDGE_RELATION_ID,
  'inference': SUBORDINATE_EDGE_RELATION_ID,
  'subordinate': SUBORDINATE_EDGE_RELATION_ID,
}

const MAX_NAME_LENGTH = 24
const MAX_DESCRIPTION_LENGTH = 120

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

/**
 * 把任意落盘值解析成两值之一。这是**唯一**的关系读取入口
 * （normalizeGraphMeta / resolveEdgeRelationId / 迁移脚本 / 树校验全部走它）。
 */
export function readEdgeRelationId(value: unknown): EdgeRelation {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return DEFAULT_EDGE_RELATION_ID
  return LEGACY_EDGE_RELATION_MAP[raw] ?? DEFAULT_EDGE_RELATION_ID
}

/** 是否为强关系（从属）。树构建与 LOD 判定只认这一个入口。 */
export function isSubordinate(value: unknown): boolean {
  return readEdgeRelationId(value) === SUBORDINATE_EDGE_RELATION_ID
}

/**
 * 归一化配置里的关系列表：恒返回两种内置关系，配置只能覆盖其
 * name / description / style，id 与 builtin 不可篡改；自定义关系一律丢弃
 * （磁盘迁移后 `_config.json` 里也不再有自定义项）。
 */
export function normalizeEdgeRelationDefinitions(raw: unknown): EdgeRelationDefinition[] {
  const builtins = new Map<string, EdgeRelationDefinition>(
    BUILTIN_EDGE_RELATIONS.map((item) => [item.id, { ...item, style: { ...item.style } }]),
  )
  const entries = Array.isArray(raw) ? raw : []
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const builtin = builtins.get(id)
    if (!builtin) continue
    const name = cleanText(entry.name, MAX_NAME_LENGTH)
    const description = cleanText(entry.description, MAX_DESCRIPTION_LENGTH)
    // 只有显式带了 style 对象才覆盖内置样式；否则保留内置预设，避免旧配置
    // 只写了个 name 就把两种关系的差异化样式全部冲成全局默认。
    const style = isRecord(entry.style) ? normalizeDefaultEdgeStyle(entry.style) : undefined
    builtins.set(id, {
      ...builtin,
      name: name ?? builtin.name,
      description: description ?? builtin.description,
      style: style ?? builtin.style,
    })
  }
  return [...builtins.values()]
}

/**
 * 兼容旧签名 `(value, definitions)`。内置 id 恒为两值、不依赖配置，
 * 所以 definitions 只保留以兼容既有调用点，不参与解析。
 */
export function resolveEdgeRelationId(
  value: unknown,
  _definitions?: readonly EdgeRelationDefinition[],
): EdgeRelation {
  return readEdgeRelationId(value)
}

export function findEdgeRelationDefinition(
  value: unknown,
  definitions: readonly EdgeRelationDefinition[],
): EdgeRelationDefinition {
  const id = readEdgeRelationId(value)
  return definitions.find((item) => item.id === id)
    ?? definitions.find((item) => item.id === DEFAULT_EDGE_RELATION_ID)
    ?? { ...BUILTIN_EDGE_RELATIONS[0], style: { ...BUILTIN_EDGE_RELATIONS[0].style } }
}

// ============ 连线语义契约（只约束关系名文字，不干预样式）============

/**
 * 【用户决策 2026-11-09】两类连线的语义差别只体现在「关系名文字」上：
 *   - `related`：连线上**恒显示关系名文字**（没写就兜底「关联」），且新建时强校验；
 *   - `subordinate`：**不强制**显示关系名；线条完全沿用关系配置里的
 *     color / lineWidth / lineStyle / arrow，右栏样式面板与单条边格式刷都能改。
 *
 * 【用户决策 2026-11-09 晚】曾加过「固定双线轨道 + 中点层级徽标」，用户明确要求
 * 恢复原来的从属连线样式，该视觉方案已整体移除。这里不再保留任何硬编码几何常量
 * 或专用语义色，从属边与其它边走同一套可配置渲染路径。
 */
export const DEFAULT_RELATED_DISPLAY_NAME = '关联'
const DEFAULT_SUBORDINATE_DISPLAY_NAME = '从属'

export interface EdgeSemanticDisplay {
  kind: EdgeRelation
  /** 恒非空的显示名（配置改名则用配置名，否则用内置名） */
  label: string
  /** 关联边的关系名文字必须显示（不受 showEdgeRelationLabels 开关影响） */
  mandatoryLabel: boolean
}

/**
 * 严格的**创建期**解析，与宽容的 `readEdgeRelationId` 分工：
 * 读盘 / 旧档兼容才允许兜底，新建连线只认显式两值，未知值一律拒绝。
 */
export function parseStrictEdgeRelation(value: unknown): EdgeRelation | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  return raw === DEFAULT_EDGE_RELATION_ID || raw === SUBORDINATE_EDGE_RELATION_ID
    ? raw
    : null
}

/** 关系显示名恒非空：配置改过用配置名，没写（或写成空白）兜底内置名。 */
export function describeEdgeSemantic(
  value: unknown,
  definitions?: readonly EdgeRelationDefinition[],
): EdgeSemanticDisplay {
  const relation = readEdgeRelationId(value)
  const configuredName = definitions
    ? cleanText(findEdgeRelationDefinition(relation, definitions).name, MAX_NAME_LENGTH)
    : undefined
  const subordinate = relation === SUBORDINATE_EDGE_RELATION_ID
  return {
    kind: relation,
    label: configuredName
      ?? (subordinate ? DEFAULT_SUBORDINATE_DISPLAY_NAME : DEFAULT_RELATED_DISPLAY_NAME),
    mandatoryLabel: !subordinate,
  }
}

export type EdgeCreationCheck =
  | { ok: true; relation: EdgeRelation; display: EdgeSemanticDisplay }
  | { ok: false; reason: 'missing-relation' | 'unknown-relation' | 'missing-display-name' }

/**
 * 新建连线的**最后一道强校验**（唯一规则源）。
 * 关联边「必须在连线上写清楚关系是什么」，解析不出非空显示名就拒绝创建；
 * 从属边不强制写关系名（样式由配置决定），但仍必须显式指定关系。
 */
export function assertEdgeRelationForCreate(
  value: unknown,
  definitions?: readonly EdgeRelationDefinition[],
): EdgeCreationCheck {
  const relation = parseStrictEdgeRelation(value)
  if (relation === null) {
    const empty = value === undefined || value === null || value === ''
    return { ok: false, reason: empty ? 'missing-relation' : 'unknown-relation' }
  }
  const display = describeEdgeSemantic(relation, definitions)
  if (relation === DEFAULT_EDGE_RELATION_ID && !display.label.trim()) {
    return { ok: false, reason: 'missing-display-name' }
  }
  return { ok: true, relation, display }
}

/** 把关系的完整样式转成可写进一条边的 patch（字段与 EdgeStylePatch 对齐）。 */
export function edgeRelationStylePatch(style: DefaultEdgeStyle): EdgeStylePatch {
  return {
    lineMode: style.lineMode,
    lineStyle: style.lineStyle,
    curveControl: style.curveControl ?? null,
    color: style.color,
    lineWidth: style.lineWidth,
    arrow: style.arrow,
    arrowSize: style.arrowSize,
    arrowShape: style.arrowShape,
    arrowPosition: style.arrowPosition,
  }
}
