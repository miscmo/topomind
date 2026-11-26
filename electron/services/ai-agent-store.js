/**
 * AI 智能体配置存储（主进程，S1-4）。
 *
 * 设计约束（docs/design/native-ai-agent-design.md §15.8 / §15.10）：
 *  - 独立文件 <workDir>/.topomind/ai/agents.json，**不塞进 config.json**：
 *    ai-key-store.js 的 normalizeAiConfig 会丢弃未知字段，且 version 不符会整体回退，
 *    把 Agent 定义混进去会被一次配置保存悄悄冲掉；
 *  - 与 ai-key-store.js 同构：temp + rename 原子写、损坏自愈、按工作目录隔离；
 *  - normalize 只保留白名单字段、钳制范围；未知 version **写入时抛错且不回写**
 *    （读盘时则按默认配置自愈，不阻断主流程）——对齐 normalizeCardSpecContent 语义；
 *  - 明文密钥、磁盘路径、任意 URL 都不属于本文件的数据结构（决策 9）。
 *
 * 主进程是 CJS 边界，无法 import features 下的 TS 目录，因此 ALLOWED_TOOL_IDS
 * 是 toolCatalog.ts 的主进程侧镜像；scripts/verify-ai-agent-contracts.mts 会
 * 双向校验两者一致，任一漂移即门禁失败。
 */
import nodeFs from 'fs';
import nodePath from 'path';

const AGENT_CONFIG_VERSION = 1;
const AGENT_DEFINITION_SCHEMA = 'topomind.agent-definition';
const AGENT_CONFIG_SCHEMA = 'topomind.agent-config';
const FILE_NAME = 'agents.json';

const LIMITS = Object.freeze({
  systemPromptMax: 8000,
  nameMax: 60,
  descriptionMax: 200,
  maxAgents: 50,
  maxTags: 8,
  tagMax: 24,
  maxToolIds: 32,
});

const PROMPT_VAR_IDS = new Set([
  'nodeTitle', 'roomPath', 'selectedNodes', 'activeTab',
  'documentTitle', 'documentSummary', 'linkedDocuments', 'date', 'tools',
]);
const REASONING_MODES = new Set(['off', 'on', 'auto']);
const REASONING_PROTOCOLS = new Set([
  'auto', 'volcengine.thinking', 'openai.reasoning_effort',
  'qwen.enable_thinking', 'ollama.think', 'openrouter.reasoning',
  'gemini.thinking_config',
]);
const REASONING_EFFORTS = new Set(['low', 'medium', 'high']);
const KINDS = new Set(['orchestrator', 'sub']);
const ORIGINS = new Set(['template', 'user']);

/** 与 toolCatalog.ts 的可分配集合一一对应（门禁校验）。 */
const ALLOWED_TOOL_IDS = new Set([
  'workspace.getContext', 'document.read', 'document.search', 'graph.read',
  'graph.relations', 'kb.list', 'document.draft', 'document.polish',
  'document.outline', 'node.style', 'node.create', 'node.rename', 'node.link',
  'canvas.layout', 'cardspec.generate', 'kb.ask', 'agent.delegate',
]);
/** 破坏性工具：即使被写进 toolIds 也直接过滤，永不注册。 */
const NEVER_TOOL_IDS = new Set(['node.delete', 'node.move_room', 'document.clear']);

const DEFAULT_ORCHESTRATOR_ID = 'orchestrator.default';

/** P2 + S3 + P3：默认开放 7 个读 + 9 个写 + 1 个调度元工具；写工具一律只产预览。 */
const DEFAULT_TOOL_IDS = [
  'workspace.getContext', 'document.read', 'document.search', 'graph.read',
  'graph.relations', 'kb.list', 'kb.ask', 'document.draft', 'document.polish',
  'document.outline', 'node.style', 'node.create', 'node.rename', 'node.link',
  'canvas.layout', 'cardspec.generate', 'agent.delegate',
];

function defaultConfig() {
  return {
    schema: AGENT_CONFIG_SCHEMA,
    version: AGENT_CONFIG_VERSION,
    agents: [{
      schema: AGENT_DEFINITION_SCHEMA,
      version: AGENT_CONFIG_VERSION,
      id: DEFAULT_ORCHESTRATOR_ID,
      name: '通用助手',
      description: '默认对话 Agent，可调用工具检索工作区并生成变更建议',
      kind: 'orchestrator',
      systemPrompt: [
        '你是 TopoMind 内置的 AI 助手。TopoMind 是一款本地优先的拓扑知识管理工具。',
        '需要了解当前工作区、文档或图谱时，优先调用已开放的工具，不要凭空猜测。',
        '写类工具只会生成变更建议，必须由用户在预览中确认后才会写入；不要声称已经修改任何数据。',
        '本次会话可用工具：{{tools}}。',
        '回答使用简体中文，简洁准确，不确定的地方明确说明。',
      ].join('\n'),
      promptVars: ['tools'],
      model: { reasoning: { mode: 'auto', protocol: 'auto' } },
      toolIds: [...DEFAULT_TOOL_IDS],
      enabled: true,
      origin: 'template',
      templateId: 'builtin.general',
      tags: ['内置'],
    }],
    orchestratorId: DEFAULT_ORCHESTRATOR_ID,
    allowedSubAgentIds: [],
  };
}

function configPath(workDir) {
  return nodePath.join(workDir, '.topomind', 'ai', FILE_NAME);
}

function readJsonSafe(filePath) {
  try {
    if (!nodeFs.existsSync(filePath)) return null;
    const parsed = JSON.parse(nodeFs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  nodeFs.mkdirSync(nodePath.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  nodeFs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  nodeFs.renameSync(tempPath, filePath);
}

function shortString(value, max, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function boundedNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.min(max, Math.max(min, num));
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function agentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeReasoning(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = {
    mode: REASONING_MODES.has(input.mode) ? input.mode : 'auto',
    protocol: REASONING_PROTOCOLS.has(input.protocol) ? input.protocol : 'auto',
  };
  if (REASONING_EFFORTS.has(input.effort)) result.effort = input.effort;
  return result;
}

/** AgentModelConfig：不含 baseURL / apiKeyRef，任何未知字段都被丢弃。 */
function normalizeModel(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = { reasoning: normalizeReasoning(input.reasoning) };
  if (typeof input.model === 'string' && input.model.trim()) result.model = input.model.trim().slice(0, 120);
  const fields = [
    ['temperature', 0, 2], ['topP', 0, 1], ['topK', 1, 1000],
    ['maxTokens', 1, 32768], ['presencePenalty', -2, 2],
  ];
  for (const [key, min, max] of fields) {
    const value = boundedNumber(input[key], min, max);
    if (value !== undefined) result[key] = key === 'maxTokens' || key === 'topK' ? Math.round(value) : value;
  }
  return result;
}

function normalizeAgent(raw, fallbackId) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const systemPrompt = typeof input.systemPrompt === 'string'
    ? input.systemPrompt.slice(0, LIMITS.systemPromptMax)
    : '';
  const promptVars = Array.isArray(input.promptVars)
    ? [...new Set(input.promptVars.filter((id) => PROMPT_VAR_IDS.has(id)))].slice(0, PROMPT_VAR_IDS.size)
    : [];
  const toolIds = Array.isArray(input.toolIds)
    ? [...new Set(input.toolIds.filter((id) => typeof id === 'string'
      && ALLOWED_TOOL_IDS.has(id) && !NEVER_TOOL_IDS.has(id)))].slice(0, LIMITS.maxToolIds)
    : [];
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.filter((tag) => typeof tag === 'string' && tag.trim())
      .map((tag) => tag.trim().slice(0, LIMITS.tagMax)))].slice(0, LIMITS.maxTags)
    : [];
  const result = {
    schema: AGENT_DEFINITION_SCHEMA,
    version: AGENT_CONFIG_VERSION,
    id: shortString(input.id, 80, fallbackId),
    name: shortString(input.name, LIMITS.nameMax, '未命名 Agent'),
    description: typeof input.description === 'string' ? input.description.trim().slice(0, LIMITS.descriptionMax) : '',
    kind: KINDS.has(input.kind) ? input.kind : 'sub',
    systemPrompt,
    promptVars,
    model: normalizeModel(input.model),
    toolIds,
    enabled: boolOr(input.enabled, true),
    origin: ORIGINS.has(input.origin) ? input.origin : 'user',
    tags,
  };
  if (typeof input.templateId === 'string' && input.templateId.trim()) {
    result.templateId = input.templateId.trim().slice(0, 80);
  }
  return result;
}

/**
 * 写入归一化。校验失败抛带 code 的 Error，调用方转成 IPC 错误响应，
 * **绝不半写、绝不回写默认值**。
 */
export function normalizeAgentConfig(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (input.version !== AGENT_CONFIG_VERSION) {
    throw agentError('agent_version_invalid', 'Agent 配置版本不兼容');
  }
  if (!Array.isArray(input.agents)) {
    throw agentError('agent_invalid_shape', 'agents 必须是数组');
  }
  if (input.agents.length > LIMITS.maxAgents) {
    throw agentError('agent_invalid_shape', `Agent 数量超过上限 ${LIMITS.maxAgents}`);
  }
  const agents = input.agents.map((agent, index) => normalizeAgent(agent, `agent.${index + 1}`));
  const ids = agents.map((agent) => agent.id);
  if (new Set(ids).size !== ids.length) {
    throw agentError('agent_duplicate_id', 'Agent id 重复');
  }
  const orchestrators = agents.filter((agent) => agent.kind === 'orchestrator');
  if (orchestrators.length !== 1) {
    throw agentError('agent_orchestrator_invalid', '必须有且仅有一个总调度 Agent');
  }
  const orchestratorId = typeof input.orchestratorId === 'string' && ids.includes(input.orchestratorId)
    ? input.orchestratorId
    : orchestrators[0].id;
  if (orchestrators[0].id !== orchestratorId) {
    throw agentError('agent_orchestrator_invalid', 'orchestratorId 必须指向唯一的 orchestrator');
  }
  const allowedSubAgentIds = Array.isArray(input.allowedSubAgentIds)
    ? [...new Set(input.allowedSubAgentIds.filter((id) => ids.includes(id)
      && id !== orchestratorId))].slice(0, LIMITS.maxAgents)
    : [];
  return {
    schema: AGENT_CONFIG_SCHEMA,
    version: AGENT_CONFIG_VERSION,
    agents,
    orchestratorId,
    allowedSubAgentIds,
  };
}

/** @param {{ getWorkDir: () => string }} deps */
export function createAiAgentStore({ getWorkDir }) {
  function getConfig() {
    const data = readJsonSafe(configPath(getWorkDir()));
    if (!data || data.version !== AGENT_CONFIG_VERSION) return defaultConfig();
    try {
      return normalizeAgentConfig(data);
    } catch {
      // 派生数据损坏时自愈：回退默认，不覆盖原文件，等用户主动保存再重建。
      return defaultConfig();
    }
  }

  function saveConfig(payload) {
    const next = normalizeAgentConfig(payload);
    writeJsonAtomic(configPath(getWorkDir()), next);
    return next;
  }

  return { getConfig, saveConfig };
}

export default createAiAgentStore;
