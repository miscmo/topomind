/**
 * 随包内置智能体模板（S1-5）——编译期只读常量，不落盘、不可导入导出。
 *
 * 参考火山引擎「智能体模板」详情页做减法：模板只有定义，「使用模板」= 深拷贝
 * 成 origin:'user' 的 Agent 写入 agents.json（docs/design §15.8）。
 * 「技能 / MCP」两类入口当前不存在，UI 里置灰标注后续支持，不做假入口。
 *
 * 所有模板都产出 kind:'sub'：orchestrator 全局有且仅有一个，由默认配置提供。
 */
import type { AgentDefinition, AgentModelConfig, PromptVarId } from './agentTypes'

export interface AgentTemplate {
  templateId: string
  name: string
  description: string
  systemPrompt: string
  promptVars: PromptVarId[]
  model: AgentModelConfig
  toolIds: string[]
  tags: string[]
}

const DEFAULT_MODEL: AgentModelConfig = { reasoning: { mode: 'auto', protocol: 'auto' } }

export const BUILTIN_AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    templateId: 'builtin.writer',
    name: '文档写作助手',
    description: '基于当前文档上下文起草与润色，产出建议块而非直接改写',
    systemPrompt: [
      '你是 TopoMind 的文档写作助手。',
      '当前文档：{{documentTitle}}；所在位置：{{roomPath}}。',
      '请基于上下文起草或润色内容，结构化列出建议，不要声称已经修改文档。',
      '回答使用简体中文；不确定的地方明确说明。',
    ].join('\n'),
    promptVars: ['documentTitle', 'roomPath'],
    model: { ...DEFAULT_MODEL, temperature: 0.7 },
    toolIds: ['workspace.getContext', 'document.read', 'document.draft', 'document.polish'],
    tags: ['文档', '写作'],
  },
  {
    templateId: 'builtin.outliner',
    name: '大纲整理助手',
    description: '把选中节点整理成层级大纲，只给结构不动原数据',
    systemPrompt: [
      '你是 TopoMind 的大纲整理助手。',
      '当前节点：{{nodeTitle}}；选中内容：{{selectedNodes}}。',
      '请输出清晰的层级大纲，标明哪些是已有内容、哪些是建议新增。',
      '不要生成 HTML、不要给出磁盘路径，也不要声称已经写入画布。',
    ].join('\n'),
    promptVars: ['nodeTitle', 'selectedNodes'],
    model: { ...DEFAULT_MODEL, temperature: 0.4 },
    toolIds: ['workspace.getContext', 'graph.read', 'document.outline', 'node.create'],
    tags: ['图谱', '大纲'],
  },
  {
    templateId: 'builtin.reviewer',
    name: '知识梳理助手',
    description: '沿关联文档与双链梳理知识脉络，回答需说明依据',
    systemPrompt: [
      '你是 TopoMind 的知识梳理助手。今天是 {{date}}。',
      '关联文档：{{linkedDocuments}}。',
      '可用工具：{{tools}}。',
      '请沿关联关系梳理脉络，每条结论说明依据；未检索到的内容要明确说「未检索到」，不要编造。',
    ].join('\n'),
    promptVars: ['date', 'linkedDocuments', 'tools'],
    model: { ...DEFAULT_MODEL, temperature: 0.3 },
    toolIds: ['workspace.getContext', 'document.read', 'graph.relations', 'kb.list', 'kb.ask'],
    tags: ['知识库', '梳理'],
  },
]

/** 深拷贝一份模板为用户 Agent；调用方负责保证 id 唯一。 */
export function createAgentFromTemplate(templateId: string, id: string): AgentDefinition | null {
  const template = BUILTIN_AGENT_TEMPLATES.find((item) => item.templateId === templateId)
  if (!template) return null
  return {
    schema: 'topomind.agent-definition',
    version: 1,
    id,
    name: template.name,
    description: template.description,
    kind: 'sub',
    systemPrompt: template.systemPrompt,
    promptVars: [...template.promptVars],
    model: {
      ...template.model,
      reasoning: { ...template.model.reasoning },
    },
    toolIds: [...template.toolIds],
    enabled: true,
    origin: 'user',
    templateId: template.templateId,
    tags: [...template.tags],
  }
}
