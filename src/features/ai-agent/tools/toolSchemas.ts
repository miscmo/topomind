/**
 * P2：下发给模型的完整 function JSON Schema（唯一真源）。
 *
 * 与 config/toolCatalog.ts 的分工：目录只保存「可分配白名单 + 最小参数草案」，
 * 本文件才是运行时 tool calling 的 schema 来源，绝不把目录塞进请求体（§15.3）。
 *
 * 写工具的 schema 参数**直接对应 AgentPatch op 字段**：模型只产结构化数据，
 * 由 handler 映射成 op 后统一过 normalizeAgentPatch；不解析自由文本、不生成 HTML。
 * 纯数据模块，不 import React / window / IO，供门禁 esbuild 打包真跑。
 */

import { DOCUMENT_BLOCK_TYPES } from '../patch/agentPatchTypes'

type Schema = Record<string, unknown>

const S = (description: string, maxLength = 400): Schema => ({ type: 'string', description, maxLength })
const ID = (description: string): Schema => ({ type: 'string', description, maxLength: 128, pattern: '^[A-Za-z0-9._\\-/]+$' })
const NUMBER = (description: string): Schema => ({ type: 'number', description })
const IDS = (description: string): Schema => ({
  type: 'array', description, maxItems: 200, items: { type: 'string', maxLength: 128 },
})

const OBJ = (properties: Record<string, unknown>, required: string[] = []): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const BLOCK_ITEM: Schema = OBJ({
  id: S('已有块 id（replace_blocks 时使用）', 128),
  type: { type: 'string', enum: [...DOCUMENT_BLOCK_TYPES], description: '块类型' },
  text: S('块文本，单段不超过 4000 字', 4000),
  level: { type: 'integer', minimum: 1, maximum: 3, description: '标题层级' },
  children: { type: 'array', description: '嵌套子块（最多 3 层）', maxItems: 50, items: { type: 'object' } },
}, ['type'])

const BLOCKS = (description: string): Schema => ({
  type: 'array', description, maxItems: 200, items: BLOCK_ITEM,
})

const STYLE_PATCH: Schema = OBJ({
  headerFontSize: NUMBER('标题字号'),
  bodyFontSize: NUMBER('正文字号'),
  borderWidth: NUMBER('边框宽度'),
  headerColor: S('颜色 token，仅接受 token:* 或受限中性值', 64),
  headerBackgroundColor: S('颜色 token', 64),
  borderColor: S('颜色 token', 64),
  headerFontWeight: { type: 'string', enum: ['normal', 'bold'] },
  headerFontStyle: { type: 'string', enum: ['normal', 'italic'] },
})

const POSITION: Schema = OBJ({
  x: NUMBER('画布 x 坐标'),
  y: NUMBER('画布 y 坐标'),
}, ['x', 'y'])

/** CardSpec 的最小结构：具体组件由 normalizeCardSpecContent 二次校验。 */
const CARD_SPEC: Schema = OBJ({
  version: NUMBER('CardSpec 版本'),
  title: S('卡片标题', 200),
  components: {
    type: 'array',
    description: '组件列表（禁止 html 类型）',
    maxItems: 50,
    items: { type: 'object' },
  },
  theme: { type: 'object', description: '主题 token 引用' },
}, ['components'])

export interface ToolSchemaEntry {
  description: string
  parameters: Schema
}

export const TOOL_SCHEMAS: Readonly<Record<string, ToolSchemaEntry>> = Object.freeze({
  // ---- 只读（6）----
  'workspace.getContext': {
    description: '读取当前工作区上下文：活动标签、房间路径、选中节点、当前文档与视口。需要知道「现在在哪」时先调用。',
    parameters: OBJ({}),
  },
  'document.read': {
    description: '按文档 id 读取文档纯文本与块结构摘要。',
    parameters: OBJ({ docId: ID('文档 id') }, ['docId']),
  },
  'document.search': {
    description: '按关键词检索文档标题与面包屑，返回候选列表（复用统一文档检索）。',
    parameters: OBJ({ query: S('检索词', 200), limit: NUMBER('返回条数上限') }, ['query']),
  },
  'graph.read': {
    description: '读取当前房间的全量节点与边（不走 LOD 可见节点过滤）。',
    parameters: OBJ({ roomPath: S('房间路径；省略则用当前房间', 256) }),
  },
  'graph.relations': {
    description: '读取文档或节点的双链、反向链接、从属路径与画布连边。',
    parameters: OBJ({ docId: ID('文档 id'), nodeId: ID('节点 id') }),
  },
  'kb.list': {
    description: '枚举当前工作区的知识库与房间。',
    parameters: OBJ({}),
  },

  // ---- 写：只产 AgentPatch op，必须人工确认（9）----
  'document.draft': {
    description: '把起草好的结构化内容作为建议块插入文档。只生成变更建议，不会立即写入。',
    parameters: OBJ({
      documentId: ID('目标文档 id'),
      afterBlockId: ID('插入到此块之后；省略则追加到末尾'),
      blocks: BLOCKS('建议插入的块'),
    }, ['documentId', 'blocks']),
  },
  'document.polish': {
    description: '用结构化新块替换指定块，产出润色建议。只生成变更建议，不会立即写入。',
    parameters: OBJ({
      documentId: ID('目标文档 id'),
      blockIds: IDS('要替换的块 id'),
      blocks: BLOCKS('替换后的块'),
    }, ['documentId', 'blockIds', 'blocks']),
  },
  'document.outline': {
    description: '为文档生成大纲 / 摘要建议块。只生成变更建议，不会立即写入。',
    parameters: OBJ({
      documentId: ID('目标文档 id'),
      afterBlockId: ID('插入到此块之后'),
      blocks: BLOCKS('大纲块'),
    }, ['documentId', 'blocks']),
  },
  'node.style': {
    description: '批量修改节点样式，颜色只允许设计 token，不接受任意色值。产出预览后需人工确认。',
    parameters: OBJ({
      nodeIds: IDS('目标节点 id'),
      patch: STYLE_PATCH,
    }, ['nodeIds', 'patch']),
  },
  'node.create': {
    description: '在当前房间创建一个知识节点。产出预览后需人工确认。',
    parameters: OBJ({
      roomPath: S('房间路径', 256),
      title: S('节点标题', 200),
      position: POSITION,
      parentId: ID('父节点 id'),
    }, ['roomPath', 'title', 'position']),
  },
  'node.rename': {
    description: '重命名一个已存在的节点。产出预览后需人工确认。',
    parameters: OBJ({ nodeId: ID('节点 id'), title: S('新标题', 200) }, ['nodeId', 'title']),
  },
  'node.link': {
    description: '在两个节点间建立关系连线。产出预览后需人工确认。',
    parameters: OBJ({
      roomPath: S('房间路径', 256),
      source: ID('起点节点 id'),
      target: ID('终点节点 id'),
      relation: { type: 'string', enum: ['related', 'subordinate'], description: '关系类型' },
      weight: { type: 'string', enum: ['main', 'minor'], description: '权重' },
    }, ['roomPath', 'source', 'target', 'relation']),
  },
  'canvas.layout': {
    description: '按网格或树形算法重排房间内节点。产出预览后需人工确认。',
    parameters: OBJ({
      roomPath: S('房间路径', 256),
      algorithm: { type: 'string', enum: ['grid', 'tree'], description: '布局算法' },
      nodeIds: IDS('仅重排这些节点；省略则全房间'),
    }, ['roomPath', 'algorithm']),
  },
  'cardspec.generate': {
    description: '生成知识卡片 CardSpec（创建或更新）。产出预览后需人工确认，禁止 html 组件。',
    parameters: OBJ({
      roomPath: S('房间路径', 256),
      title: S('卡片标题', 200),
      spec: CARD_SPEC,
      nodeId: ID('绑定到已有节点'),
      documentId: ID('更新已有卡片文档'),
    }, ['spec']),
  },
  'agent.delegate': {
    description: '把一项子任务委托给配置白名单内的子智能体独立处理；该子智能体使用自己的系统提示词、模型参数与只读工具子集。只有真实工具调用会触发调度，不会解析自由文本。',
    parameters: OBJ({
      subAgentId: ID('调度白名单内的子智能体 id'),
      task: S('交给子智能体的任务描述', 4000),
    }, ['subAgentId', 'task']),
  },
  // ---- P3 / D：本地简版 RAG（只读，不写业务数据、不联网）----
  'kb.ask': {
    description: '在本地知识库做正文检索并返回带 [ref:i] 编号的片段。回答必须原样引用这些编号；未检索到时明确说明「未检索到」，不要编造文档或结论。',
    parameters: OBJ({
      question: S('要检索的问题', 1000),
      scope: { type: 'string', enum: ['all', 'kb', 'room'], description: '范围：全库 / 当前知识库 / 当前房间' },
      topK: { type: 'integer', minimum: 1, maximum: 10, description: '返回片段条数上限' },
    }, ['question']),
  },
})

export const TOOL_SCHEMA_IDS: readonly string[] = Object.keys(TOOL_SCHEMAS).sort()
