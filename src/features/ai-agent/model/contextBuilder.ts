/**
 * P3 / D：上下文信封（§8 唯一外发组装点）。
 *
 * 设计约束：所有发往模型的工作区内容都必须经这里组装，后期加范围开关 / 脱敏 /
 * 黑名单 / 按知识库授权只改这一处，不动工具与协议。本模块是**纯函数**：
 * 不读 store、不读 lod.visibleNodes、不碰 IPC / window / React，可被门禁 esbuild
 * 打包真跑。L1 锚点 / L2 结构由调用方传入（当前 P3 只把本地检索的 L3 片段
 * 接到 kb.ask 的 tool 结果里），优先级 L1 > L2 > L3，超预算按 L3 → L2 顺序裁剪。
 *
 * 安全边界：
 *  - 外发文本只有 [ref:i] 编号、标题、面包屑与正文片段；
 *    docId / cardPath / 磁盘路径绝不进外发文本（引用映射只留在渲染层内存）；
 *  - 未命中时明确要求「未检索到」，禁止模型编造文档、标题或结论。
 */
import type { AiIndexHit, AiReference } from '@/core/ai-types'

export const DEFAULT_CONTEXT_BUDGET = 8000
export const MAX_QUESTION_LENGTH = 1000

export interface ContextFragment {
  label: string
  text: string
  /** 同类片段的排序权重；裁剪时先丢低分。 */
  score?: number
}

export interface ContextEnvelopeInput {
  l1?: string
  l2?: readonly ContextFragment[]
  l3?: readonly ContextFragment[]
  budget?: number
}

export interface ContextEnvelope {
  text: string
  usedTokens: number
  budget: number
  droppedL3: number
  droppedL2: number
  keptL3: number
  layers: string[]
}

/** 粗粒度估算：中英混排按 2 字符 ≈ 1 token，宁可保守裁剪也不撑爆预算。 */
export function estimateTokens(text: string): number {
  return Math.ceil(String(text ?? '').length / 2)
}

function clampBudget(value: number | undefined): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return DEFAULT_CONTEXT_BUDGET
  return Math.min(128000, Math.max(256, Math.round(num)))
}

/**
 * 三层组装 + 显式 token 预算。L1 永不裁剪；L2 按给定顺序保留；
 * L3 按 score 降序保留。超预算时先丢 L3（低分优先），再丢 L2（末尾优先）。
 */
export function buildContextEnvelope(input: ContextEnvelopeInput): ContextEnvelope {
  const budget = clampBudget(input.budget)
  const l1 = String(input.l1 ?? '').trim()
  const l2 = [...(input.l2 ?? [])].filter((item) => typeof item?.text === 'string' && item.text.trim())
  const l3 = [...(input.l3 ?? [])]
    .filter((item) => typeof item?.text === 'string' && item.text.trim())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  const fixed = l1 ? `L1 当前工作区锚点：\n${l1}\n` : ''
  let used = estimateTokens(fixed)
  let droppedL3 = 0
  let droppedL2 = 0
  const keptL2: ContextFragment[] = []
  const keptL3: ContextFragment[] = []

  // 先按优先级占位：L2 先于 L3，但超预算时允许反过来裁 L3 保 L2。
  for (const item of l2) {
    const cost = estimateTokens(item.text)
    if (used + cost <= budget) {
      keptL2.push(item)
      used += cost
    } else {
      droppedL2 += 1
    }
  }
  for (const item of l3) {
    const cost = estimateTokens(item.text)
    if (used + cost <= budget) {
      keptL3.push(item)
      used += cost
    } else {
      droppedL3 += 1
    }
  }
  // 预算仍被 L2 占满时，按 L3 → L2 顺序回收：优先保住检索片段（L3 是本轮问题的依据）。
  if (droppedL3 > 0 && keptL2.length > 0) {
    for (let i = keptL2.length - 1; i >= 0 && droppedL3 > 0; i -= 1) {
      const released = keptL2.pop()
      if (!released) break
      used -= estimateTokens(released.text)
      droppedL2 += 1
      const candidate = l3.find((item) => !keptL3.includes(item))
      if (!candidate) break
      const cost = estimateTokens(candidate.text)
      if (used + cost <= budget) {
        keptL3.push(candidate)
        used += cost
        droppedL3 -= 1
      }
    }
  }

  const parts: string[] = []
  if (fixed) parts.push(fixed.trimEnd())
  if (keptL2.length > 0) parts.push(`L2 结构上下文：\n${keptL2.map((item) => item.text).join('\n')}`)
  if (keptL3.length > 0) parts.push(`L3 检索片段：\n${keptL3.map((item) => item.text).join('\n')}`)
  const layers = [fixed ? 'L1' : '', keptL2.length ? 'L2' : '', keptL3.length ? 'L3' : ''].filter(Boolean)
  return {
    text: parts.join('\n\n'),
    usedTokens: used,
    budget,
    droppedL3,
    droppedL2,
    keptL3: keptL3.length,
    layers,
  }
}

export interface RetrievalEnvelope {
  /** 允许作为 role:'tool' 回灌给模型的文本（已过 token 预算裁剪）。 */
  text: string
  /** 只留渲染层内存的 [ref:i] → docId 映射，绝不随请求外发。 */
  references: AiReference[]
  noHit: boolean
  budget: ContextEnvelope
}

function referenceOf(hit: AiIndexHit): AiReference {
  return {
    ref: hit.ref,
    docId: hit.docId,
    cardPath: hit.cardPath,
    title: hit.title,
    breadcrumb: hit.breadcrumb,
    // P5-r：三层可读名字只在渲染层内存里，绝不进外发文本 / 会话正文。
    ...(hit.nodeName ? { nodeName: hit.nodeName } : {}),
    ...(hit.blockLabel ? { blockLabel: hit.blockLabel } : {}),
    ...(hit.snippet ? { snippet: hit.snippet } : {}),
    charRange: [hit.charRange[0], hit.charRange[1]],
  }
}

function fragmentOf(hit: AiIndexHit): ContextFragment {
  const range = `${hit.charRange[0]}-${hit.charRange[1]}`
  return {
    label: `[ref:${hit.ref}]`,
    text: `[ref:${hit.ref}] ${hit.title}｜位置：${hit.breadcrumb}｜片段范围：${range}\n${hit.text}`,
    score: hit.score,
  }
}

/**
 * kb.ask 的唯一外发组装点。命中为空时明确写「未检索到」并禁止编造；
 * 命中时强制逐条 [ref:i] 引用。返回的外发文本不含 docId / cardPath / 磁盘路径。
 */
export function buildRetrievalEnvelope(
  question: string,
  hits: readonly AiIndexHit[],
  budget?: number,
): RetrievalEnvelope {
  const safeQuestion = String(question ?? '').trim().slice(0, MAX_QUESTION_LENGTH)
  const safeHits = (Array.isArray(hits) ? hits : []).filter((hit) => hit && typeof hit.docId === 'string')
  if (safeHits.length === 0) {
    const instruction = `本地知识库检索：未检索到与「${safeQuestion}」相关的内容。`
      + '\n必须明确回答「未检索到相关内容」，不要编造任何文档、标题、事实或结论，也不要使用 [ref:i] 引用。'
      + '\n可以建议用户换关键词、扩大检索范围或先创建相关文档。'
    const envelope = buildContextEnvelope({ l3: [{ label: 'no-hit', text: instruction, score: 1 }], budget })
    return { text: envelope.text, references: [], noHit: true, budget: envelope }
  }

  const instruction = `本地知识库检索结果（问题：${safeQuestion}）。`
    + '\n只能使用下列片段作答，每条结论都要原样保留对应的 [ref:i] 标记；'
    + '不要编造未出现的文档、标题、事实或引用编号；片段不足时明确说明「已检索到的资料不足」。'
  const fragments = safeHits.map(fragmentOf)
  const envelope = buildContextEnvelope({
    l3: [{ label: 'instruction', text: instruction, score: Number.MAX_SAFE_INTEGER }, ...fragments],
    budget,
  })
  // 被预算裁掉的片段不能留下死链：只把真正外发过的 ref 放进引用表。
  const keptRefs = new Set(
    [...envelope.text.matchAll(/\[ref:(\d+)\]/g)].map((match) => Number(match[1])),
  )
  const references = safeHits.filter((hit) => keptRefs.has(hit.ref)).map(referenceOf)
  return { text: envelope.text, references, noHit: false, budget: envelope }
}

/** [ref:i] 是否合法引用编号；渲染层据此决定能不能渲染成可点按钮。 */
export function parseReferenceToken(token: string): number | null {
  const match = /^\[ref:(\d+)\]$/.exec(String(token ?? ''))
  if (!match) return null
  const ref = Number(match[1])
  return Number.isInteger(ref) && ref > 0 && ref <= 999 ? ref : null
}
