/**
 * 模板变量取值。
 *
 * 设计约束（docs/design §15.5）：变量值只能由发问组装点注入，本模块不读
 * store、不读磁盘、不发 IPC，保持纯函数，便于契约门禁脱离 React 真跑。
 *
 * 发问组装点（AgentPanel）会传入冻结好的选中快照，补齐原先恒为
 * `[未提供:var]` 的 nodeTitle / selectedNodes / documentTitle /
 * documentSummary / roomPath / activeTab / linkedDocuments，缺失项如实写
 * 「（无…）」。设置窗口的「预览最终提示词」不传 context，必须继续如实展示
 * 降级占位，不能拿运行期选中态去填一个静态模板预览。
 * date 与 tools 始终是本地日期、工具目录元数据。
 */
import type { PromptVarValues } from './renderPrompt'
import { TOOL_CATALOG } from './toolCatalog'
import type { SelectionContextSnapshot } from '../tools/toolTypes'
import { EMPTY_SELECTION_SNAPSHOT, buildSelectionPromptValues } from '../model/aiSelectionSnapshot'

export interface PromptContextInput {
  selection?: SelectionContextSnapshot
  activeTabId?: string
  roomPath?: string
}

export function buildPromptValues(
  toolIds?: readonly string[],
  context?: PromptContextInput,
): PromptVarValues {
  const wired = TOOL_CATALOG.filter((entry) => entry.status === 'wired')
  const selected = new Set(toolIds ?? [])
  const open = wired.filter((entry) => selected.has(entry.id))
  return {
    ...(context
      ? buildSelectionPromptValues(context.selection ?? EMPTY_SELECTION_SNAPSHOT, {
          activeTabId: context.activeTabId,
          roomPath: context.roomPath,
        })
      : {}),
    date: new Date().toLocaleDateString('zh-CN'),
    // P2：按当前 Agent 的 toolIds 派生，模型能看见本次会话真实开放的能力边界。
    tools: `目录共 ${TOOL_CATALOG.length} 项，已接入 ${wired.length} 项；本次会话开放 ${open.length} 项：${open.map((entry) => entry.id).join('、') || '（无）'}`,
  }
}
