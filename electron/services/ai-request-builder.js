/**
 * 请求体构造（S2 核心）——主进程 CJS 纯函数，零依赖、零 IO、可 node --test 真跑。
 *
 * 设计约束（docs/design §15.6 / §15.7）：
 *  - 参数分两层：common（钳范围后总是可发）+ providerExtras（按能力位决定发不发）；
 *  - **绝不做「用户填任意 JSON 直接塞进 body」**：只认白名单字段与内置协议表；
 *  - top_k 不是 OpenAI Chat Completions 标准字段，只在能力位允许时发送；
 *  - 深度思考各家协议互不相同；开推理后采样参数会冲突（OpenAI 携带
 *    temperature 会 400、Anthropic 强制 temperature=1 并忽略 top_p/top_k），
 *    统一在这里钳制 / 剔除；
 *  - 自动模式识别不到协议时**不发送任何推理字段**，降级为普通调用。
 *
 * 返回值分两段：fields 是要展开进请求体的字段，meta 只描述「发了什么协议、
 * 忽略了什么」，不含 prompt 正文、不含密钥，可用于 UI 提示与不落盘的诊断。
 */

const PROTOCOL = Object.freeze({
  VOLCENGINE: 'volcengine.thinking',
  OPENAI: 'openai.reasoning_effort',
  QWEN: 'qwen.enable_thinking',
  OLLAMA: 'ollama.think',
  OPENROUTER: 'openrouter.reasoning',
  GEMINI: 'gemini.thinking_config',
});

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function pick(override, fallback) {
  return override === undefined || override === null || override === '' ? fallback : override;
}

/** 静态能力表：不做网络探测、不拉模型列表（§15.7）。 */
export function detectReasoningProtocol(config) {
  const base = String(config?.baseURL ?? '').toLowerCase();
  const model = String(config?.model ?? '').toLowerCase();
  if (base.includes('volces') || base.includes('volcengine') || model.includes('doubao')) return PROTOCOL.VOLCENGINE;
  if (base.includes('generativelanguage') || base.includes('googleapis')) return PROTOCOL.GEMINI;
  if (base.includes('openrouter.ai')) return PROTOCOL.OPENROUTER;
  if (base.includes('11434') || base.includes('ollama')) return PROTOCOL.OLLAMA;
  if (base.includes('dashscope') || base.includes('siliconflow') || model.includes('qwen')) return PROTOCOL.QWEN;
  // 仅凭 baseURL 判 OpenAI 会误伤普通 chat 模型（gpt-4o-mini 不支持 reasoning_effort），
  // 因此只认推理模型名前缀；用户仍可在对话界面手选该协议。
  if (/^(o1|o3|o4|gpt-5)/.test(model)) return PROTOCOL.OPENAI;
  return null;
}

function resolveProtocol(config, reasoning) {
  const requested = reasoning?.protocol;
  return !requested || requested === 'auto'
    ? detectReasoningProtocol(config)
    : String(requested);
}

function reasoningFields(protocol, enabled, effort) {
  if (!protocol) return {};
  switch (protocol) {
    case PROTOCOL.VOLCENGINE:
      return { thinking: { type: enabled ? 'enabled' : 'disabled' } };
    case PROTOCOL.OPENAI:
      return enabled ? { reasoning_effort: effort || 'medium' } : {};
    case PROTOCOL.QWEN:
      return { enable_thinking: enabled };
    case PROTOCOL.OLLAMA:
      return { think: enabled };
    case PROTOCOL.OPENROUTER:
      return { reasoning: { enabled } };
    case PROTOCOL.GEMINI:
      return { extra_body: { google: { thinking_config: { include_thoughts: enabled } } } };
    default:
      // 用户手选了表里没有的协议：不猜测、不发送，避免污染请求体。
      return {};
  }
}

/**
 * @param {object} config 全局公开配置（getConfig()，不含明文密钥）
 * @param {object|null} agent 渲染层已合并会话覆盖后的 { model, reasoning }
 * @returns {{ fields: object, meta: object }}
 */
export function buildRequestBody(config, agent) {
  const agentModel = agent && typeof agent.model === 'object' && agent.model ? agent.model : {};
  const reasoning = agent && typeof agent.reasoning === 'object' && agent.reasoning
    ? agent.reasoning
    : (agentModel.reasoning ?? {});
  const mode = ['off', 'on', 'auto'].includes(reasoning.mode) ? reasoning.mode : 'auto';
  const protocol = resolveProtocol(config, reasoning);
  const warnings = [];

  const fields = {
    model: typeof agentModel.model === 'string' && agentModel.model.trim()
      ? agentModel.model.trim().slice(0, 120)
      : String(config.model),
    temperature: clampNumber(pick(agentModel.temperature, config.temperature), 0, 2, 0.7),
    max_tokens: Math.round(clampNumber(pick(agentModel.maxTokens, config.maxTokens), 1, 32768, 2048)),
  };
  if (agentModel.topP !== undefined) fields.top_p = clampNumber(agentModel.topP, 0, 1, 1);
  if (agentModel.presencePenalty !== undefined) {
    fields.presence_penalty = clampNumber(agentModel.presencePenalty, -2, 2, 0);
  }

  let reasoningSent = false;
  if (mode === 'off') {
    // 对「默认开思考」的服务显式发 disabled，其它服务什么都不发。
    const disabled = reasoningFields(protocol, false, reasoning.effort);
    if (Object.keys(disabled).length > 0) Object.assign(fields, disabled);
  } else {
    const extras = reasoningFields(protocol, true, reasoning.effort);
    if (Object.keys(extras).length > 0) {
      Object.assign(fields, extras);
      reasoningSent = true;
    } else if (mode === 'auto' && !protocol) {
      warnings.push('未识别推理协议，已按普通模式发送');
    } else if (mode === 'on') {
      warnings.push('未识别推理协议，已忽略深度思考设置');
    }
  }

  // 开推理后的采样冲突：reasoning_effort 体系不允许携带采样参数。
  if (reasoningSent && protocol === PROTOCOL.OPENAI) {
    delete fields.temperature;
    delete fields.top_p;
    delete fields.top_k;
    delete fields.presence_penalty;
    warnings.push('该协议下已剔除 temperature / top_p 等采样参数');
  }

  // top_k 能力位：仅 Ollama / 自建 vLLM 兼容端点接受，其余一律不发。
  if (agentModel.topK !== undefined) {
    const allowTopK = protocol === PROTOCOL.OLLAMA
      || String(config.baseURL ?? '').toLowerCase().includes('vllm');
    if (allowTopK) fields.top_k = Math.round(clampNumber(agentModel.topK, 1, 1000, 40));
    else warnings.push('top_k 非当前供应商支持字段，已忽略');
  }

  return {
    fields,
    meta: {
      mode,
      protocol: protocol ?? null,
      reasoningSent,
      warnings,
    },
  };
}

export default buildRequestBody;
