import type { TocItem } from '../types/workspaceTypes'

/**
 * 标题自动编号：编号是「视图层装饰」，不写进 blocks、不进剪贴板/选区/撤销历史。
 *
 * 设计要点（与 SmartDocumentEditor.css 中 H1~H6 水印的 ::after 装饰同一路子）：
 * - 配置按文档存储（SmartDocumentContent.numbering），缺省即关闭，旧文档零影响；
 * - 编号由目录数据 TocItem[] 计算，正文与目录共用同一份结果，不会出现两边对不上；
 * - 正文编号通过一张按 block id 生成的动态 <style> 注入 ::before content，
 *   不往 ProseMirror 管理的 DOM 写属性（节点重建会把它抹掉）。
 */

export type HeadingNumberingStyle = 'decimal' | 'chapter' | 'cjk' | 'alpha'

export interface HeadingNumberingConfig {
  /** 是否开启；默认关闭 */
  enabled: boolean
  /** 编号样式 */
  style: HeadingNumberingStyle
  /** 编号到第几级标题（1~6），更深的不编号也不占号 */
  depth: number
}

export const HEADING_NUMBERING_DEPTH_MIN = 1
export const HEADING_NUMBERING_DEPTH_MAX = 6

export const DEFAULT_HEADING_NUMBERING: HeadingNumberingConfig = {
  enabled: false,
  style: 'decimal',
  depth: 3,
}

export const HEADING_NUMBERING_STYLE_OPTIONS: ReadonlyArray<{
  value: HeadingNumberingStyle
  label: string
  preview: string
}> = [
  { value: 'decimal', label: '数字', preview: '1 / 1.1 / 1.1.1' },
  { value: 'chapter', label: '章节', preview: '第一章 / 1.1 / 1.1.1' },
  { value: 'cjk', label: '中文', preview: '一、 / （一） / 1.' },
  { value: 'alpha', label: '字母', preview: 'A / A.1 / A.1.a' },
]

const STYLE_VALUES = HEADING_NUMBERING_STYLE_OPTIONS.map((option) => option.value)

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 旧存档 / 非法配置一律收敛到合法值，避免脏值穿透到渲染层。 */
export function normalizeHeadingNumbering(raw: unknown): HeadingNumberingConfig {
  const value = asRecord(raw)
  const depth = typeof value.depth === 'number' && Number.isFinite(value.depth)
    ? Math.round(value.depth)
    : DEFAULT_HEADING_NUMBERING.depth
  return {
    enabled: value.enabled === true,
    style: STYLE_VALUES.includes(value.style as HeadingNumberingStyle)
      ? value.style as HeadingNumberingStyle
      : DEFAULT_HEADING_NUMBERING.style,
    depth: Math.min(
      HEADING_NUMBERING_DEPTH_MAX,
      Math.max(HEADING_NUMBERING_DEPTH_MIN, depth),
    ),
  }
}

/** 配置是否等价：SmartDocumentEditor 的 memo 比较器用它避免正文编辑引发重渲染。 */
export function isSameHeadingNumbering(a: unknown, b: unknown): boolean {
  const left = normalizeHeadingNumbering(a)
  const right = normalizeHeadingNumbering(b)
  return left.enabled === right.enabled && left.style === right.style && left.depth === right.depth
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

function chineseNumeral(value: number): string {
  if (value < 10) return CN_DIGITS[value] ?? String(value)
  if (value < 20) return `十${value % 10 === 0 ? '' : CN_DIGITS[value % 10]}`
  if (value < 100) return `${CN_DIGITS[Math.floor(value / 10)]}十${value % 10 === 0 ? '' : CN_DIGITS[value % 10]}`
  return String(value)
}

function alphaNumeral(value: number, upper: boolean): string {
  let rest = value
  let result = ''
  while (rest > 0) {
    const index = (rest - 1) % 26
    result = String.fromCharCode(65 + index) + result
    rest = Math.floor((rest - 1) / 26)
  }
  return upper ? result : result.toLowerCase()
}

/**
 * 把「层级计数」格式化成显示文本。
 * parts 是压平后的各级计数（例如 H1→H3 得到 [1, 1] 而不是 [1, 0, 1]）。
 */
export function formatHeadingNumber(parts: number[], style: HeadingNumberingStyle): string {
  if (parts.length === 0) return ''
  const decimal = parts.join('.')
  switch (style) {
    case 'chapter':
      // 顶级用「第 X 章」，子级保持常见的 1.1 / 1.1.1 数字路径
      return parts.length === 1 ? `第${chineseNumeral(parts[0])}章` : decimal
    case 'cjk': {
      // 公文习惯：每级只显示本级序号，不带父级路径
      const own = parts[parts.length - 1]
      switch (parts.length) {
        case 1: return `${chineseNumeral(own)}、`
        case 2: return `（${chineseNumeral(own)}）`
        case 3: return `${own}.`
        default: return `(${own})`
      }
    }
    case 'alpha':
      return parts
        .map((value, index) => (index % 2 === 0
          ? alphaNumeral(value, index === 0)
          : String(value)))
        .join('.')
    case 'decimal':
    default:
      return decimal
  }
}

export type HeadingNumberLike = Pick<TocItem, 'id' | 'level' | 'text'>

/**
 * 计算每个标题块应显示的编号。
 *
 * 「压平」＝按标题实际构成的层级栈编号，而不是照搬 H1~H6 的绝对级别：
 *   H1→H3            得 1、1.1（Word 的 1.0.1 太啰嗦）
 *   只有 H2 开头      得 1（而不是 0.1）
 *   H2→H1            得 1、2（顶级接着数，不重号）
 *   H1→H2→H1→H2     得 1、1.1、2、2.1（新的一级章节，下级重新从 1 开始）
 *   H1→H2→H3        得 1、1.1、1.1.1
 * 层级写乱时（H1→H3→H2）可能出现跳号，这是压平的固有取舍，不是缺陷。
 */
export function computeHeadingNumbers(
  items: HeadingNumberLike[],
  rawConfig: unknown,
): Record<string, string> {
  const config = normalizeHeadingNumbering(rawConfig)
  const result: Record<string, string> = {}
  if (!config.enabled) return result

  const levels: number[] = []       // 当前路径上每一层的绝对 level
  const counters: number[] = []     // 当前路径上每一层的计数（即输出的编号层级）
  const layerHistory: number[] = [] // 每个输出层用过的最大计数，回退后重新进入时接着数

  for (const item of items) {
    const level = Math.min(
      HEADING_NUMBERING_DEPTH_MAX,
      Math.max(1, Math.round(Number(item.level) || 1)),
    )
    // 超过设定深度、无 id 或空标题：不编号也不占号
    if (level > config.depth || !item.id || !item.text.trim()) continue

    // 回退到不比当前级别更深的层（跳过未使用的级别，正是「压平」）
    while (levels.length > 0 && level < levels[levels.length - 1]) {
      levels.pop()
      counters.pop()
    }

    if (levels.length > 0 && level === levels[levels.length - 1]) {
      const index = counters.length - 1
      counters[index] += 1
      layerHistory[index] = counters[index]
      // 新的一级章节：下级全部重新从 1 开始（Word 行为）
      if (index === 0) layerHistory.length = 1
    } else {
      const index = levels.length
      const next = (layerHistory[index] ?? 0) + 1
      levels.push(level)
      counters.push(next)
      layerHistory[index] = next
      if (index === 0) layerHistory.length = 1
    }

    result[item.id] = formatHeadingNumber(counters, config.style)
  }
  return result
}

export function isSameHeadingNumbers(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => right[key] === left[key])
}

const SAFE_CSS_IDENT = /^[A-Za-z0-9_-]+$/

function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '')
}

/**
 * 生成按 block id 命中的 ::before content 规则。
 *
 * 之所以用动态样式表而不是给 heading 元素写 data-* / CSS 变量：后者落在
 * ProseMirror 管理的 DOM 上，节点一重建属性就丢，得靠 MutationObserver 兜底；
 * 样式表只由 React 状态驱动，零 DOM 写入。实例 id 用来隔离同时挂载的多个编辑器。
 */
export function buildHeadingNumberStyles(
  instanceId: string,
  numbers: Record<string, string>,
): string {
  if (!SAFE_CSS_IDENT.test(instanceId)) return ''
  const rules: string[] = []
  for (const [blockId, number] of Object.entries(numbers)) {
    if (!SAFE_CSS_IDENT.test(blockId) || typeof number !== 'string' || !number) continue
    rules.push(
      `[data-tm-editor="${instanceId}"] .bn-block-outer[data-id="${blockId}"] > .bn-block > .bn-block-content[data-content-type="heading"] > .bn-inline-content::before { content: "${escapeCssString(number)}" !important; }`,
    )
  }
  return rules.join('\n')
}
