/**
 * 工具只读目录（S1-2）——编译期静态数据，运行时永不修改。
 *
 * 唯一数据源：docs/design/native-ai-agent-design.md §6.1（16 行 / 20 个 id）。
 * §6.1 里「node.create / node.rename / node.link」与三个破坏性工具是合并行，
 * 这里按 §15.3 交付口径**一行一 id**，scripts/verify-ai-agent-contracts.mts
 * 会双向比对，任一漂移即门禁失败。
 *
 * 注意（§15.3）：
 *  - `params` 只是最小草案（参数名 / 类型 / 必填 / 说明），不是完整 JSON Schema；
 *    P2 由 toolRegistry 从实现侧导出完整 schema，本目录**永远不进发给模型的 tools 请求体**；
 *  - `status` 是编译期字段：P2 的 6 个读 + 9 个写，加 S3 的调度元工具
 *    agent.delegate 与 P3 / D 的 kb.ask，共 17 个已接入（wired）；
 *    三个破坏性工具为 never，not-wired 当前为 0 条；
 *    UI 的「已接入」状态由本目录 status 只读派生，契约门禁
 *    （verify-ai-agent-contracts.mts）双向比对 toolRegistry 的 WIRED_TOOL_IDS，
 *    目录与注册表任一漂移即门禁失败，因此 UI 不需要反向 import 注册表。
 */

export type ToolKind = 'read' | 'write'
export type ToolPermission = 'read-only' | 'suggest' | 'never'
export type ToolStatus = 'not-wired' | 'wired' | 'never'
export type ToolParamType = 'string' | 'number' | 'string[]' | 'object' | 'none'

export interface ToolParam {
  name: string
  type: ToolParamType
  required: boolean
  description: string
}

export interface ToolCatalogEntry {
  id: string
  kind: ToolKind
  permission: ToolPermission
  params: readonly ToolParam[]
  output: string
  source: 'builtin'
  status: ToolStatus
  note?: string
}

const P = (name: string, type: ToolParamType, description: string, required = true): ToolParam => (
  { name, type, required, description }
)

export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  // ---- 只读（6）----
  {
    id: 'workspace.getContext', kind: 'read', permission: 'read-only', params: [],
    output: 'activeTabId / roomPath / 选中节点 / 当前文档 / 视口',
    source: 'builtin', status: 'wired',
  },
  {
    id: 'document.read', kind: 'read', permission: 'read-only',
    params: [P('docId', 'string', '文档 id')],
    output: '纯文本 + 块结构摘要', source: 'builtin', status: 'wired',
  },
  {
    id: 'document.search', kind: 'read', permission: 'read-only',
    params: [P('query', 'string', '检索词')],
    output: '标题 / 面包屑命中（复用 fs:searchUnifiedDocuments）',
    source: 'builtin', status: 'wired',
  },
  {
    id: 'graph.read', kind: 'read', permission: 'read-only',
    params: [P('roomPath', 'string', '房间路径')],
    output: '全量节点 / 边（不走 lod.visibleNodes）',
    source: 'builtin', status: 'wired',
  },
  {
    id: 'graph.relations', kind: 'read', permission: 'read-only',
    params: [
      P('docId', 'string', '文档 id', false),
      P('nodeId', 'string', '节点 id', false),
    ],
    output: '双链、反向链接、从属路径', source: 'builtin', status: 'wired',
  },
  {
    id: 'kb.list', kind: 'read', permission: 'read-only', params: [],
    output: '知识库 / 房间枚举', source: 'builtin', status: 'wired',
  },

  // ---- 写：只产 AgentPatch，不自动 commit（9）----
  {
    id: 'document.draft', kind: 'write', permission: 'suggest',
    params: [
      P('instruction', 'string', '写作指令'),
      P('context', 'object', '上下文信封', false),
    ],
    output: 'document.insert_blocks Patch', source: 'builtin', status: 'wired',
  },
  {
    id: 'document.polish', kind: 'write', permission: 'suggest',
    params: [P('blockIds', 'string[]', '选区块 id')],
    output: 'document.replace_blocks Patch', source: 'builtin', status: 'wired',
  },
  {
    id: 'document.outline', kind: 'write', permission: 'suggest',
    params: [P('docId', 'string', '文档 id')],
    output: '大纲 / 摘要块 Patch', source: 'builtin', status: 'wired',
  },
  {
    id: 'node.style', kind: 'write', permission: 'suggest',
    params: [
      P('nodeIds', 'string[]', '目标节点 id'),
      P('intent', 'string', '样式意图（仅 token）'),
    ],
    output: 'node.style Patch', source: 'builtin', status: 'wired',
  },
  {
    id: 'node.create', kind: 'write', permission: 'suggest',
    params: [P('instruction', 'string', '创建指令')],
    output: 'node.create Patch', source: 'builtin', status: 'wired',
  },
  {
    id: 'node.rename', kind: 'write', permission: 'suggest',
    params: [P('instruction', 'string', '重命名指令')],
    output: 'node.rename Patch', source: 'builtin', status: 'wired',
  },
  {
    id: 'node.link', kind: 'write', permission: 'suggest',
    params: [P('instruction', 'string', '连线指令')],
    output: 'edge.create Patch', source: 'builtin', status: 'wired',
  },
  {
    id: 'canvas.layout', kind: 'write', permission: 'suggest',
    params: [
      P('roomPath', 'string', '房间路径'),
      P('nodeIds', 'string[]', '目标节点 id', false),
    ],
    output: 'canvas.layout Patch',     source: 'builtin', status: 'wired',
    note: 'P2 内置 grid / tree 布局',
  },
  {
    id: 'cardspec.generate', kind: 'write', permission: 'suggest',
    params: [
      P('nodeId', 'string', '节点 id', false),
      P('docId', 'string', '文档 id', false),
    ],
    output: 'cardspec.create / cardspec.update Patch',
    source: 'builtin', status: 'wired',
  },

  // ---- S3 调度元工具（仅总调度 Agent 可分配；由真实 tool_call 触发）----
  {
    id: 'agent.delegate', kind: 'read', permission: 'read-only',
    params: [P('subAgentId', 'string', '调度白名单内的子 Agent id'), P('task', 'string', '交给子 Agent 的任务描述')],
    output: '子 Agent 独立调用的只读结果摘要 + 委托卡片',
    source: 'builtin', status: 'wired',
    note: 'S3 自动调度；子调用只读工具子集、不继承主会话 system、不自动提交 Patch',
  },

  // ---- P3 / D 简版 RAG（只读；结果经 buildContextEnvelope 后才外发）----
  {
    id: 'kb.ask', kind: 'read', permission: 'read-only',
    params: [P('question', 'string', '问题'), P('scope', 'string', '检索范围：all / kb / room', false), P('topK', 'number', '片段条数', false)],
    output: '带 [ref:i] 引用的本地检索片段', source: 'builtin', status: 'wired',
    note: 'P3 / D 简版 RAG；未命中明确说明「未检索到」，不编造',
  },

  // ---- 永不开放（3）：即使有预览也不注册 ----
  {
    id: 'node.delete', kind: 'write', permission: 'never', params: [],
    output: '不提供', source: 'builtin', status: 'never', note: '破坏性操作，永不开放',
  },
  {
    id: 'node.move_room', kind: 'write', permission: 'never', params: [],
    output: '不提供', source: 'builtin', status: 'never', note: '跨房间移动，永不开放',
  },
  {
    id: 'document.clear', kind: 'write', permission: 'never', params: [],
    output: '不提供', source: 'builtin', status: 'never', note: '整篇清空，永不开放',
  },
]

/**
 * S3 子调用可用工具：只取已接入的只读工具，并显式剔除调度元工具本身，
 * 从根上杜绝递归委托与「子调用自动 commit」。编译期静态，门禁可真跑比对。
 */
export const SUB_AGENT_TOOL_IDS: readonly string[] = TOOL_CATALOG
  .filter((entry) => entry.status === 'wired'
    && entry.permission === 'read-only'
    && entry.id !== 'agent.delegate')
  .map((entry) => entry.id)

export const TOOL_CATALOG_IDS: readonly string[] = TOOL_CATALOG.map((entry) => entry.id)

export const NEVER_TOOL_IDS: readonly string[] = TOOL_CATALOG
  .filter((entry) => entry.permission === 'never')
  .map((entry) => entry.id)

export function isCatalogToolId(value: unknown): value is string {
  return typeof value === 'string' && TOOL_CATALOG_IDS.includes(value)
}

export function isAssignableToolId(value: unknown): boolean {
  return typeof value === 'string'
    && TOOL_CATALOG_IDS.includes(value)
    && !NEVER_TOOL_IDS.includes(value)
}
