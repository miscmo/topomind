/**
 * 模板变量取值（S1 最小实现）。
 *
 * 设计约束（docs/design §15.5）：变量值只能由 buildContextEnvelope()（§8 唯一
 * 外发组装点）提供，**不另开一条读数据的通道**。该函数要到 P1 才随上下文
 * 策略落地，因此当前只填两个不触碰业务数据的变量：
 *   - date：本地日期；
 *   - tools：工具目录的只读元数据摘要（P2 起按当前 Agent 的 toolIds 派生本次
 *     会话真实开放的能力边界，不含任何文档 / 节点内容）。
 * 其余变量留空，renderPrompt 会降级为 `[未提供:var]`，预览里如实展示，
 * 不做猜测、不伪造工作区数据。
 */
import type { PromptVarValues } from './renderPrompt'
import { TOOL_CATALOG } from './toolCatalog'

export function buildPromptValues(toolIds?: readonly string[]): PromptVarValues {
  const wired = TOOL_CATALOG.filter((entry) => entry.status === 'wired')
  const selected = new Set(toolIds ?? [])
  const open = wired.filter((entry) => selected.has(entry.id))
  return {
    date: new Date().toLocaleDateString('zh-CN'),
    // P2：按当前 Agent 的 toolIds 派生，模型能看见本次会话真实开放的能力边界。
    tools: `目录共 ${TOOL_CATALOG.length} 项，已接入 ${wired.length} 项；本次会话开放 ${open.length} 项：${open.map((entry) => entry.id).join('、') || '（无）'}`,
  }
}
