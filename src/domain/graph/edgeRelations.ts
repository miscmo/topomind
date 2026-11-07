import type { EdgeStylePatch } from '../../types'
import { EDGE_COLOR_PRESETS, STYLE_CONFIG_DEFAULTS } from '../style/styleDefaults.ts'
import { normalizeDefaultEdgeStyle } from '../style/normalizeStyleConfig.ts'
import type { DefaultEdgeStyle } from '../style/styleTypes'

/**
 * 连线关系（relation）的定义与解析。
 *
 * 关系用**稳定 id** 落盘，显示名只是 UI 文案：用户改名 / 删除自定义关系时，
 * 不能让已经画好的边全部变成「未知关系」。这与 docId 是同一条铁律。
 *
 * 旧存档里 relation 是中文三值 '相关' | '依赖' | '演进'，且 2153 篇文档的知识库
 * 里已有大量这类边（架构图谱 34 条边全是 '依赖'）。按用户决策做**读时映射、磁盘不动**：
 *   - 落盘边界（normalizeGraphMeta）只负责「保留任意合法字符串」，绝不改写旧值；
 *   - UI / 样式解析走 resolveEdgeRelationId() 把旧值映射到内置 id；
 *   - 只有用户手动切换某条边的关系时，那条边才写成新 id（属于正常单条编辑）。
 */

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

/** 基础关系「关联」的 id，也是所有兜底路径的默认值。 */
export const DEFAULT_EDGE_RELATION_ID = 'related'

/** 预设色板唯一来源，这里只按语义引用、不再写第二份 hex。 */
const [GREY, BLUE, , ORANGE, , PURPLE] = EDGE_COLOR_PRESETS

const BASE_STYLE = STYLE_CONFIG_DEFAULTS.defaultEdgeStyle

function relationStyle(patch: Partial<DefaultEdgeStyle>): DefaultEdgeStyle {
  return { ...BASE_STYLE, ...patch }
}

/**
 * 四种内置关系。样式差异只用现有边样式字段表达，不新增箭头形状：
 *   关联 = 灰细实线 / 空心箭头（等同全局默认）
 *   从属 = 蓝实线 / 空心箭头（is-a，指向父类）
 *   组成 = 橙虚线 / 空心箭头（part-of，指向整体）
 *   推导 = 紫粗实线 / 实心箭头（前提·依赖·因果合并，指向结论）
 */
export const BUILTIN_EDGE_RELATIONS: readonly EdgeRelationDefinition[] = [
  {
    id: DEFAULT_EDGE_RELATION_ID,
    name: '关联',
    description: '最基础的关系：两个节点有关联，不预设方向语义',
    style: relationStyle({ color: GREY }),
    builtin: true,
  },
  {
    id: 'is-a',
    name: '从属',
    description: 'A 是 B 的一种（苹果 → 水果）',
    style: relationStyle({ color: BLUE, lineWidth: 1.5, arrowShape: 'hollow' }),
    builtin: true,
  },
  {
    id: 'part-of',
    name: '组成',
    description: 'A 是 B 的一部分（引擎 → 汽车）',
    style: relationStyle({ color: ORANGE, lineStyle: 'dashed', lineWidth: 1.4, arrowShape: 'hollow' }),
    builtin: true,
  },
  {
    id: 'inference',
    name: '推导',
    description: 'A 先于 / 导致 B（前提、依赖、因果合并为一条）',
    style: relationStyle({ color: PURPLE, lineWidth: 1.6, arrowShape: 'solid' }),
    builtin: true,
  },
]

/** 旧存档中文值 → 内置 id。仅用于读取侧解析，不写回磁盘。 */
export const LEGACY_EDGE_RELATION_MAP: Readonly<Record<string, string>> = {
  '相关': DEFAULT_EDGE_RELATION_ID,
  '依赖': 'inference',
  '演进': 'inference',
}

const RELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/
const MAX_CUSTOM_RELATIONS = 32
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
 * 归一化配置里的关系列表。
 *
 * 内置 4 种永远存在（config 可以覆盖其 name / description / style，但 id 与
 * builtin 标记不可篡改）；自定义项按 id 去重、校验格式与数量上限。
 * 任何非法 / 缺失输入都返回纯内置列表，保证 UI 与样式解析永远有可用定义。
 */
export function normalizeEdgeRelationDefinitions(raw: unknown): EdgeRelationDefinition[] {
  const builtins = new Map<string, EdgeRelationDefinition>(
    BUILTIN_EDGE_RELATIONS.map((item) => [item.id, { ...item, style: { ...item.style } }]),
  )
  const custom: EdgeRelationDefinition[] = []
  const seenCustom = new Set<string>()
  const entries = Array.isArray(raw) ? raw : []

  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!RELATION_ID_PATTERN.test(id) || seenCustom.has(id)) continue
    seenCustom.add(id)

    const name = cleanText(entry.name, MAX_NAME_LENGTH)
    const description = cleanText(entry.description, MAX_DESCRIPTION_LENGTH)
    // 只有显式带了 style 对象才覆盖内置样式；否则保留内置预设，避免旧配置
    // 只写了个 name 就把四种关系的差异化样式全部冲成全局默认。
    const style = isRecord(entry.style) ? normalizeDefaultEdgeStyle(entry.style) : undefined

    const builtin = builtins.get(id)
    if (builtin) {
      builtins.set(id, {
        ...builtin,
        name: name ?? builtin.name,
        description: description ?? builtin.description,
        style: style ?? builtin.style,
      })
      continue
    }

    if (!name || custom.length >= MAX_CUSTOM_RELATIONS) continue
    custom.push({
      id,
      name,
      description,
      style: style ?? { ...BASE_STYLE },
    })
  }

  return [...builtins.values(), ...custom]
}

/**
 * 把边上的 relation 原始值解析成当前定义里的 id（读时映射）。
 * 未知 id（自定义关系被删）回退到「关联」，但**不改写磁盘上的原值**。
 */
export function resolveEdgeRelationId(
  value: unknown,
  definitions: readonly EdgeRelationDefinition[],
): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  const id = LEGACY_EDGE_RELATION_MAP[raw] ?? raw
  if (!id) return DEFAULT_EDGE_RELATION_ID
  return definitions.some((item) => item.id === id) ? id : DEFAULT_EDGE_RELATION_ID
}

export function findEdgeRelationDefinition(
  value: unknown,
  definitions: readonly EdgeRelationDefinition[],
): EdgeRelationDefinition {
  const id = resolveEdgeRelationId(value, definitions)
  return definitions.find((item) => item.id === id)
    ?? definitions.find((item) => item.id === DEFAULT_EDGE_RELATION_ID)
    ?? { ...BUILTIN_EDGE_RELATIONS[0], style: { ...BUILTIN_EDGE_RELATIONS[0].style } }
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

/** 新建自定义关系用的稳定 id。 */
export function newEdgeRelationId(): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    : Math.random().toString(36).slice(2, 12)
  return `rel_${random}`
}
