/**
 * 系统提示词模板渲染（S1-3）——纯函数，零 IO、零 React、零依赖。
 *
 * 设计约束（docs/design/native-ai-agent-design.md §15.5）：
 *  - 只支持 `{{var}}` 白名单替换，**不是模板引擎**：禁嵌套 / 表达式 / 函数 /
 *    过滤器 / 条件 / 循环；不合法的 token 原样保留，绝不求值。
 *  - 变量值只由 buildContextEnvelope()（§8 唯一外发组装点）提供，本模块不读 store、
 *    不读磁盘、不发 IPC，也不另开一条取数通道。
 *  - 模板里出现未声明 / 未知变量由 validatePromptTemplate 在编辑期拦下；
 *    声明了但本轮取不到值的变量降级为 `[未提供:var]`，不猜测、不静默删除。
 *  - 渲染在渲染层完成，主进程只接收最终字符串（§15.4 单 system 构造）。
 */
import {
  PROMPT_VAR_IDS,
  isPromptVarId,
  type PromptVarId,
} from './agentTypes'

export type PromptVarValues = Partial<Record<PromptVarId, string>>

/** 单个变量值的上限：防止把整篇文档塞进系统提示词。 */
export const MAX_VAR_VALUE_LENGTH = 2000

/** 任何 `{{...}}` 形态（含不合法写法），用于校验与替换。 */
const ANY_TOKEN = /\{\{[\s\S]*?\}\}/g
/** 合法变量名：纯字母数字，不以数字开头。 */
const VALID_VAR_NAME = /^[a-zA-Z][a-zA-Z0-9]*$/

export interface PromptTemplateIssue {
  ok: boolean
  /** 语法不合法的 token（嵌套 / 表达式 / 函数调用 / 过滤器等）。 */
  invalid: string[]
  /** 不在 PROMPT_VAR_IDS，或不在 declared 列表里的变量名。 */
  undeclared: string[]
}

export interface RenderPromptResult {
  prompt: string
  /** 声明了但本轮没有值的变量。 */
  missingVars: PromptVarId[]
  declaredVars: PromptVarId[]
}

/** 列出模板中所有 `{{...}}` token（原样，供编辑期提示用）。 */
export function findPromptTokens(template: string): string[] {
  return template.match(ANY_TOKEN) ?? []
}

/** 编辑期校验：返回全部问题，不抛异常，便于表单逐项提示。 */
export function validatePromptTemplate(
  template: string,
  declared: readonly PromptVarId[],
): PromptTemplateIssue {
  const invalid: string[] = []
  const undeclared: string[] = []
  for (const token of findPromptTokens(template)) {
    const inner = token.slice(2, -2).trim()
    if (!VALID_VAR_NAME.test(inner)) {
      invalid.push(token)
      continue
    }
    if (!isPromptVarId(inner) || !declared.includes(inner)) {
      undeclared.push(inner)
    }
  }
  return { ok: invalid.length === 0 && undeclared.length === 0, invalid, undeclared }
}

function sanitizeValue(value: string): string {
  // 只做「去掉控制字符 + 限长」，不做语义转义：
  // 变量值是工作区数据，转义规则应由 buildContextEnvelope() 决定。
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, MAX_VAR_VALUE_LENGTH)
}

/**
 * 渲染模板。不合法 / 未声明的 token 原样保留（validatePromptTemplate 负责拦），
 * 替换结果不会被二次扫描，因此变量值里含 `{{...}}` 也不会被当作模板求值。
 */
export function renderPrompt(
  template: string,
  values: PromptVarValues,
  declared: readonly PromptVarId[] = PROMPT_VAR_IDS,
): RenderPromptResult {
  const missingVars: PromptVarId[] = []
  const prompt = template.replace(ANY_TOKEN, (token) => {
    const inner = token.slice(2, -2).trim()
    if (!VALID_VAR_NAME.test(inner) || !isPromptVarId(inner) || !declared.includes(inner)) {
      return token
    }
    const raw = values[inner]
    if (raw === undefined || raw === '') {
      if (!missingVars.includes(inner)) missingVars.push(inner)
      return `[未提供:${inner}]`
    }
    return sanitizeValue(raw)
  })
  return { prompt, missingVars, declaredVars: [...declared] }
}
