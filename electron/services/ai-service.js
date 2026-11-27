/**
 * AI 网关：OpenAI-compatible 云端 LLM 调用（主进程，P0）。
 *
 * 为什么必须在主进程：生产 CSP 是 `connect-src 'self'` 且 renderer 开了
 * `sandbox: true`，渲染进程不能直连外部模型端点；这里用 Node fetch 发起请求，
 * 再通过 webContents.send 把增量 token 推回渲染层（不经过高频 invoke）。
 *
 * 设计约束（docs/design/native-ai-agent-design.md §7）：
 *  - P0 只读问答，不注册任何工具、不产出 Patch、不写业务数据；
 *  - Provider 无关：目前只注册 openai-compatible，ollama / hosted 仅留枚举；
 *  - 任一失败都归一化为 AIServiceError 并推送 ai:chat:error，绝不阻断主流程；
 *  - 桌面本地应用，baseURL 由用户自己填写，允许本地/内网代理；仍做协议、
 *    凭据、长度与重定向校验，避免拼出可执行 URL 或被静默跳转到其它主机。
 */
import { buildRequestBody } from './ai-request-builder.js';

/** S3：主 + 子至少占 2 个槽位，调度期把并发上限提到 4（§15.9）。 */
const MAX_CONCURRENT = 4;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
// 工具轮次上限放开到 20（最多 50）后，一轮可能产生多条 tool 结果，
// 50 条窗口会把 assistant.tool_calls 截掉、留下孤儿 tool 消息导致网关 400。
const MAX_MESSAGES = 200;
const MAX_CONTENT_LENGTH = 20000;
/** 与 AgentDefinition 的 AGENT_LIMITS.systemPromptMax 一致（§15.4）。 */
const MAX_SYSTEM_PROMPT_LENGTH = 8000;
/** P2：一次请求最多下发的工具数、单条 arguments 与 schema 体积上限。 */
const MAX_TOOLS = 32;
const MAX_TOOL_ARGUMENTS_LENGTH = 20000;
const MAX_TOOL_SCHEMA_LENGTH = 8000;
const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
const RETRY_DELAYS_MS = [300, 900];
const SYSTEM_PROMPT = '你是 TopoMind 内置的 AI 助手。TopoMind 是一款本地优先的拓扑知识管理工具。当前阶段你只能回答问题、解释与给出建议，不能执行任何修改操作；回答使用简体中文，简洁准确，不确定的地方明确说明。';

export const AI_ERROR_CODES = Object.freeze({
  NO_KEY: 'no_key',
  INVALID_CONFIG: 'invalid_config',
  UNSUPPORTED_PROVIDER: 'unsupported_provider',
  BUSY: 'busy',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  RATE_LIMIT: 'rate_limit',
  BAD_RESPONSE: 'bad_response',
  CANCELLED: 'cancelled',
});

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorMessage(code) {
  switch (code) {
    case AI_ERROR_CODES.NO_KEY: return '尚未配置 API Key，请先在「设置 → AI 助手」中填写';
    case AI_ERROR_CODES.INVALID_CONFIG: return '模型服务地址或模型名称不合法，请检查设置';
    case AI_ERROR_CODES.UNSUPPORTED_PROVIDER: return '当前仅支持 OpenAI 兼容的云端 API';
    case AI_ERROR_CODES.BUSY: return '正在进行中的对话过多，请稍后再试';
    case AI_ERROR_CODES.TIMEOUT: return '模型响应超时，请稍后重试';
    case AI_ERROR_CODES.RATE_LIMIT: return '模型服务限流，请稍后重试';
    case AI_ERROR_CODES.NETWORK: return '网络连接失败，请检查网络或服务地址';
    case AI_ERROR_CODES.BAD_RESPONSE: return '模型返回的内容无法解析';
    case AI_ERROR_CODES.CANCELLED: return '已停止生成';
    default: return 'AI 服务暂时不可用';
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildChatUrl(rawBaseURL) {
  let url;
  try {
    url = new URL(String(rawBaseURL || '').trim());
  } catch {
    throw makeError(AI_ERROR_CODES.INVALID_CONFIG, errorMessage(AI_ERROR_CODES.INVALID_CONFIG));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw makeError(AI_ERROR_CODES.INVALID_CONFIG, errorMessage(AI_ERROR_CODES.INVALID_CONFIG));
  }
  if (url.username || url.password) {
    throw makeError(AI_ERROR_CODES.INVALID_CONFIG, errorMessage(AI_ERROR_CODES.INVALID_CONFIG));
  }
  if (url.href.length > 500) {
    throw makeError(AI_ERROR_CODES.INVALID_CONFIG, errorMessage(AI_ERROR_CODES.INVALID_CONFIG));
  }
  const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  return `${base}/chat/completions`;
}

/**
 * P2：把渲染层下发的工具定义收敛成 OpenAI function schema。
 * 绝不把用户原始 JSON 直接塞进请求体：只保留 type / name / description / parameters，
 * 逐项校验名称、体积与数量，并按 name 去重。返回 [] 表示本次不启用工具。
 */
export function normalizeTools(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw.slice(0, MAX_TOOLS)) {
    if (!item || item.type !== 'function' || !item.function || typeof item.function !== 'object') continue;
    const fn = item.function;
    if (typeof fn.name !== 'string' || !TOOL_NAME_PATTERN.test(fn.name) || seen.has(fn.name)) continue;
    const parameters = fn.parameters && typeof fn.parameters === 'object' && !Array.isArray(fn.parameters)
      ? fn.parameters
      : { type: 'object', properties: {} };
    let encoded;
    try {
      encoded = JSON.stringify(parameters);
    } catch {
      continue;
    }
    if (!encoded || encoded.length > MAX_TOOL_SCHEMA_LENGTH) continue;
    const description = typeof fn.description === 'string' ? fn.description.slice(0, 1000) : '';
    seen.add(fn.name);
    out.push({ type: 'function', function: { name: fn.name, description, parameters } });
  }
  return out;
}

/** 组装回灌用的 assistant.tool_calls，字段逐个白名单化。 */
function normalizeAssistantToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  const calls = [];
  for (const item of raw.slice(0, MAX_TOOLS)) {
    if (!item || typeof item !== 'object') continue;
    const fn = item.function && typeof item.function === 'object' ? item.function : {};
    const name = typeof fn.name === 'string' ? fn.name.slice(0, 128) : '';
    const id = typeof item.id === 'string' ? item.id.slice(0, 128) : '';
    if (!TOOL_NAME_PATTERN.test(name) || !id) continue;
    const args = typeof fn.arguments === 'string' ? fn.arguments.slice(0, MAX_TOOL_ARGUMENTS_LENGTH) : '{}';
    calls.push({ id, type: 'function', function: { name, arguments: args } });
  }
  return calls;
}

/**
 * 单 system 构造（§15.4）：只允许一条由主进程构造的 system，
 * **丢弃调用方传入的所有 role:'system' 消息**，防止伪造第二系统指令。
 * systemPrompt 是渲染层 renderPrompt() 渲染后的最终字符串，主进程不解析模板语法。
 *
 * P2：支持 tool calling 的多轮消息——role:'tool' 必须带 tool_call_id；
 * assistant 可带 tool_calls 且允许空 content（工具轮次通常没有正文）。
 */
export function normalizeMessages(raw, systemPrompt) {
  const windowed = Array.isArray(raw) ? raw.slice(-MAX_MESSAGES) : [];
  // 窗口从头部截断时，可能只剩没有对应 assistant.tool_calls 的 tool 结果。
  // OpenAI 兼容协议要求 tool 消息紧跟配对的 assistant 调用，否则直接 400；
  // 这里丢弃窗口开头连续的孤儿 tool 消息，保证长轮次回灌始终合法。
  let start = 0;
  while (start < windowed.length && windowed[start]?.role === 'tool') start += 1;
  const input = start > 0 ? windowed.slice(start) : windowed;
  const system = typeof systemPrompt === 'string' && systemPrompt.trim()
    ? systemPrompt.slice(0, MAX_SYSTEM_PROMPT_LENGTH)
    : SYSTEM_PROMPT;
  const messages = [{ role: 'system', content: system }];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    if (item.role === 'system') continue;
    const content = typeof item.content === 'string' ? item.content.slice(0, MAX_CONTENT_LENGTH) : '';
    if (item.role === 'tool') {
      const callId = typeof item.tool_call_id === 'string' ? item.tool_call_id.slice(0, 128) : '';
      if (!callId) continue;
      messages.push({ role: 'tool', tool_call_id: callId, content });
      continue;
    }
    if (item.role === 'assistant') {
      const toolCalls = normalizeAssistantToolCalls(item.tool_calls);
      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content, tool_calls: toolCalls });
        continue;
      }
    }
    if (!content) continue;
    const role = item.role === 'assistant' ? 'assistant' : 'user';
    messages.push({ role, content });
  }
  return messages;
}

/**
 * P2：SSE 的 delta.tool_calls 是分片到达的（首帧给 id/name，后续帧只补 arguments）。
 * 纯函数，按 index 累积；重复帧的 name / id 不重复拼接。导出供门禁打包真跑。
 */
export function mergeToolCallDeltas(existing, deltas) {
  if (!Array.isArray(deltas) || deltas.length === 0) return existing;
  const next = existing.map((item) => ({ ...item }));
  for (const delta of deltas) {
    if (!delta || typeof delta !== 'object') continue;
    const index = Number.isInteger(delta.index) ? delta.index : next.length;
    if (index < 0 || index >= MAX_TOOLS) continue;
    while (next.length <= index) next.push({ index: next.length, id: '', name: '', arguments: '' });
    const target = next[index];
    if (typeof delta.id === 'string' && delta.id && delta.id !== target.id && !target.id) {
      target.id = delta.id.slice(0, 128);
    }
    const fn = delta.function && typeof delta.function === 'object' ? delta.function : null;
    if (!fn) continue;
    if (typeof fn.name === 'string' && fn.name && fn.name !== target.name) {
      target.name = (target.name + fn.name).slice(0, 128);
    }
    if (typeof fn.arguments === 'string' && fn.arguments) {
      target.arguments = (target.arguments + fn.arguments).slice(0, MAX_TOOL_ARGUMENTS_LENGTH);
    }
  }
  return next;
}

/** 累积结果 → 可执行的 tool_call 列表；缺 name 或 id 的分片直接丢弃。 */
export function finishToolCalls(drafts) {
  if (!Array.isArray(drafts)) return [];
  const calls = [];
  for (const draft of drafts.slice(0, MAX_TOOLS)) {
    if (!draft || !draft.name || !TOOL_NAME_PATTERN.test(draft.name)) continue;
    const id = draft.id || `call_${draft.index}`;
    calls.push({ id: String(id).slice(0, 128), name: draft.name, arguments: draft.arguments || '{}' });
  }
  return calls;
}

/**
 * SSE 增量解析（P2）：同时取 choices[0].delta.content 与 delta.tool_calls。
 * tool_calls 的 arguments 是分片到达的，用 mergeToolCallDeltas 按 index 累积，
 * 流结束后一次性交给 onToolCalls；主进程不执行工具、不持有会话状态。
 *
 * 按 SSE 规范以空行分帧、合并多行 data；同时兼容三种常见代理层差异：
 * CRLF、不发空行分隔（连续 data 行）、以及把非流式 JSON 错标成 event-stream。
 * 帧内 JSON 合并解析失败时逐行重试，避免整帧内容被静默丢弃。
 */
async function consumeStream(response, onDelta, onToolCalls) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!response.body || !response.body.getReader) {
    throw makeError(AI_ERROR_CODES.BAD_RESPONSE, errorMessage(AI_ERROR_CODES.BAD_RESPONSE));
  }

  if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
    const payload = await response.json();
    const message = payload?.choices?.[0]?.message;
    const text = message?.content;
    if (typeof text === 'string' && text) onDelta(text);
    if (Array.isArray(message?.tool_calls)) {
      const drafts = mergeToolCallDeltas([], message.tool_calls.map((call, index) => ({
        index,
        id: call?.id,
        function: { name: call?.function?.name, arguments: call?.function?.arguments },
      })));
      const calls = finishToolCalls(drafts);
      if (calls.length > 0) onToolCalls(calls);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let bytes = 0;
  let dataLines = [];
  let finished = false;
  let toolDrafts = [];

  const applyPayload = (raw) => {
    const data = String(raw).trim();
    if (!data) return false;
    if (data === '[DONE]') return true;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return false;
    }
    if (parsed?.error) {
      throw makeError(AI_ERROR_CODES.BAD_RESPONSE, String(parsed.error.message || errorMessage(AI_ERROR_CODES.BAD_RESPONSE)));
    }
    const choice = parsed?.choices?.[0];
    const delta = choice?.delta?.content;
    const text = typeof delta === 'string' && delta
      ? delta
      : choice?.message?.content;
    if (typeof text === 'string' && text) onDelta(text);
    const callDeltas = choice?.delta?.tool_calls ?? choice?.message?.tool_calls;
    if (Array.isArray(callDeltas) && callDeltas.length > 0) {
      toolDrafts = mergeToolCallDeltas(toolDrafts, callDeltas);
    }
    return false;
  };

  const isCompleteJson = (text) => {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  };

  const flushFrame = () => {
    if (dataLines.length === 0) return;
    const combined = dataLines.join('\n');
    dataLines = [];
    const lines = combined.split('\n');
    if (lines.some((line) => line.trim() === '[DONE]')) {
      finished = true;
      return;
    }
    // 合并后本身就是一帧：只推一次。必须在这里返回，否则逐行重试会把
    // 同一个 delta 再推一遍（标准帧靠重复抑制能掩盖，累积式帧会直接错乱）。
    if (isCompleteJson(combined.trim())) {
      if (applyPayload(combined)) finished = true;
      return;
    }
    // 连续多个事件被塞进同一帧（无空行分隔）时，合并后的字符串不是合法 JSON，
    // 逐行再解析一次，保证每个事件都被推出。
    for (const line of lines) {
      if (applyPayload(line)) {
        finished = true;
        return;
      }
    }
  };

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      throw makeError(AI_ERROR_CODES.BAD_RESPONSE, '模型响应体过大');
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (!line.trim()) {
        flushFrame();
        continue;
      }
      if (line.startsWith(':')) continue;
      if (line.startsWith('data:')) {
        const data = line.slice(5).replace(/^ /, '');
        // 上一帧已经是完整 JSON 却还没遇到空行：先推出，保持逐帧流式体验。
        if (dataLines.length > 0 && isCompleteJson(dataLines.join('\n').trim())) flushFrame();
        if (finished) break;
        dataLines.push(data);
        continue;
      }
      // event / id / retry 等 SSE 元数据与内容无关，忽略。
    }
  }
  if (!finished) {
    const tail = buffer.replace(/\r$/, '');
    if (tail.startsWith('data:')) dataLines.push(tail.slice(5).replace(/^ /, ''));
    flushFrame();
  }
  const calls = finishToolCalls(toolDrafts);
  if (calls.length > 0) onToolCalls(calls);
}

function isRetryable(error) {
  if (error?.code === AI_ERROR_CODES.NETWORK) return true;
  return error?.code === AI_ERROR_CODES.BAD_RESPONSE && Boolean(error.retryable);
}

/**
 * S3：纯函数，给定 taskId→parentTaskId 映射与根任务，算出需要级联取消的全部任务。
 * 抽成导出函数是为了让契约门禁能真跑多级父子链，而不只是文本断言。
 * @param {Iterable<[string, string]>} parents
 */
export function collectCascadeTargets(parents, root) {
  const targets = new Set();
  if (typeof root !== 'string' || !root) return targets;
  targets.add(root);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, parent] of parents) {
      if (targets.has(parent) && !targets.has(child)) {
        targets.add(child);
        changed = true;
      }
    }
  }
  return targets;
}

/** S3：并发上限对外可断言，调度期主 + 子至少占 2 个槽位。 */
export const AI_MAX_CONCURRENT = MAX_CONCURRENT;

/**
 * @param {{ keyStore: ReturnType<import('./ai-key-store.js').createAiKeyStore>, emit: (event: string, payload: object) => void }} deps
 */
export function createAiService({ keyStore, emit }) {
  const tasks = new Map();
  /** S3：taskId → parentTaskId；cancel 时沿父子链做级联 abort。 */
  const parents = new Map();

  function emitError(taskId, error) {
    const code = typeof error?.code === 'string' ? error.code : AI_ERROR_CODES.BAD_RESPONSE;
    emit('error', {
      taskId,
      code,
      message: code === AI_ERROR_CODES.BAD_RESPONSE && error?.message
        ? error.message
        : errorMessage(code),
    });
  }

  async function requestOnce({ url, apiKey, body, signal, onDelta, onToolCalls }) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      });
    } catch {
      if (signal.aborted) throw makeError(AI_ERROR_CODES.CANCELLED, errorMessage(AI_ERROR_CODES.CANCELLED));
      throw makeError(AI_ERROR_CODES.NETWORK, errorMessage(AI_ERROR_CODES.NETWORK));
    }

    if (response.status === 429) {
      throw makeError(AI_ERROR_CODES.RATE_LIMIT, errorMessage(AI_ERROR_CODES.RATE_LIMIT));
    }
    if (response.status === 401 || response.status === 403) {
      throw makeError(AI_ERROR_CODES.BAD_RESPONSE, 'API Key 无效或没有权限');
    }
    if (!response.ok) {
      const error = makeError(
        response.status >= 500 ? AI_ERROR_CODES.NETWORK : AI_ERROR_CODES.BAD_RESPONSE,
        `模型服务返回 ${response.status}`,
      );
      error.retryable = response.status >= 500;
      error.status = response.status;
      throw error;
    }
    await consumeStream(response, onDelta, onToolCalls);
  }

  /**
   * 启动一次流式对话。所有结果通过 emit 推送，不向 IPC handler 抛错，
   * handler 可以立即返回，避免长连接阻塞 invoke。
   */
  async function startChat({ taskId, messages, agent, tools, parentTaskId, modelId }) {
    if (typeof taskId !== 'string' || !taskId) return;
    if (tasks.has(taskId)) {
      emitError(taskId, makeError(AI_ERROR_CODES.BUSY, errorMessage(AI_ERROR_CODES.BUSY)));
      return;
    }
    if (tasks.size >= MAX_CONCURRENT) {
      emitError(taskId, makeError(AI_ERROR_CODES.BUSY, errorMessage(AI_ERROR_CODES.BUSY)));
      return;
    }

    // P5：modelId 由渲染层按「会话选择 > Agent 绑定 > 全局默认」解析后随本轮快照，
    // 一次任务的所有轮次（含收尾请求）都用同一份连接配置，中途切模型不影响在途对话。
    const resolved = typeof keyStore.resolveModel === 'function'
      ? keyStore.resolveModel(modelId ?? agent?.modelId)
      : { config: keyStore.getConfig(), apiKey: keyStore.getApiKey() };
    const { config, apiKey } = resolved;
    if (!apiKey) {
      emitError(taskId, makeError(AI_ERROR_CODES.NO_KEY, errorMessage(AI_ERROR_CODES.NO_KEY)));
      return;
    }
    if (config.providerType !== 'openai-compatible') {
      emitError(taskId, makeError(AI_ERROR_CODES.UNSUPPORTED_PROVIDER, errorMessage(AI_ERROR_CODES.UNSUPPORTED_PROVIDER)));
      return;
    }

    let url;
    try {
      url = buildChatUrl(config.baseURL);
    } catch (error) {
      emitError(taskId, error);
      return;
    }

    const controller = new AbortController();
    tasks.set(taskId, controller);
    if (typeof parentTaskId === 'string' && parentTaskId && parentTaskId !== taskId) {
      parents.set(taskId, parentTaskId);
    }
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.timeoutMs);

    let emittedAny = false;
    let seq = 0;
    let sentText = '';
    let lastDelta = '';
    const onDelta = (rawDelta) => {
      let delta = typeof rawDelta === 'string' ? rawDelta : '';
      if (!delta) return;
      // 兼容层把 content 当成「到目前为止的累积全文」返回：只取新增尾部。
      if (sentText && delta.length > sentText.length && delta.startsWith(sentText)) {
        delta = delta.slice(sentText.length);
      }
      // 兼容层把同一片段连发多帧：相邻完全相同的多字符片段只保留一次。
      if (!delta || (delta.length >= 2 && delta === lastDelta)) return;
      lastDelta = delta;
      sentText += delta;
      emittedAny = true;
      seq += 1;
      // seq 是渲染层幂等去重的依据；重复订阅或 IPC 重发都不会把 token 追加两次。
      emit('chunk', { taskId, seq, delta });
    };
    // S2：参数分层与推理协议由纯函数 buildRequestBody 协商（§15.6），
    // 这里不拼任何用户原始 JSON；messages 仍走单 system 构造（§15.4）。
    // P2：tools 由渲染层 toolRegistry 导出，经 normalizeTools 白名单化后才进请求体。
    const built = buildRequestBody(config, agent);
    const normalizedTools = normalizeTools(tools);
    const body = {
      messages: normalizeMessages(messages, agent?.systemPrompt),
      stream: true,
      ...built.fields,
      ...(normalizedTools.length > 0 ? { tools: normalizedTools, tool_choice: 'auto' } : {}),
    };
    let toolCalls = [];
    const onToolCalls = (calls) => { toolCalls = calls; };

    try {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        toolCalls = [];
        try {
          await requestOnce({ url, apiKey, body, signal: controller.signal, onDelta, onToolCalls });
          // tool_calls 随 done 回推，渲染层执行工具后再发起下一轮；
          // 主进程不执行工具、不持有会话状态、不逐条落盘工具明细（C15）。
          emit('done', {
            taskId,
            cancelled: false,
            seq,
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
          });
          return;
        } catch (error) {
          if (timedOut) throw makeError(AI_ERROR_CODES.TIMEOUT, errorMessage(AI_ERROR_CODES.TIMEOUT));
          if (controller.signal.aborted) throw makeError(AI_ERROR_CODES.CANCELLED, errorMessage(AI_ERROR_CODES.CANCELLED));
          // 已经吐出 token 后不再重试，避免内容重复拼接。
          if (emittedAny) throw error;
          if (attempt < RETRY_DELAYS_MS.length && (isRetryable(error) || error?.code === AI_ERROR_CODES.NETWORK)) {
            await wait(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (error?.code === AI_ERROR_CODES.CANCELLED) {
        emit('done', { taskId, cancelled: true, seq });
      } else {
        emitError(taskId, error);
      }
    } finally {
      clearTimeout(timeoutId);
      tasks.delete(taskId);
      parents.delete(taskId);
    }
  }

  /** S3：取消一个任务时，同时 abort 所有以它为祖先的在途子调用（含间接后代）。 */
  function cancel(taskId) {
    const root = typeof taskId === 'string' ? taskId : '';
    if (!root) return;
    for (const target of collectCascadeTargets(parents, root)) {
      const controller = tasks.get(target);
      if (controller) controller.abort();
    }
  }

  /** 设置页「测试连接」：非流式、最小 token，不写任何日志内容。 */
  async function testConnection(modelId) {
    const resolved = typeof keyStore.resolveModel === 'function'
      ? keyStore.resolveModel(modelId)
      : { config: keyStore.getConfig(), apiKey: keyStore.getApiKey() };
    const { config, apiKey } = resolved;
    if (!apiKey) return { ok: false, code: AI_ERROR_CODES.NO_KEY, message: errorMessage(AI_ERROR_CODES.NO_KEY) };
    if (config.providerType !== 'openai-compatible') {
      return { ok: false, code: AI_ERROR_CODES.UNSUPPORTED_PROVIDER, message: errorMessage(AI_ERROR_CODES.UNSUPPORTED_PROVIDER) };
    }
    let url;
    try {
      url = buildChatUrl(config.baseURL);
    } catch (error) {
      return { ok: false, code: AI_ERROR_CODES.INVALID_CONFIG, message: error.message };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 15000));
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'ping' }], stream: false, max_tokens: 1 }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        const code = response.status === 429 ? AI_ERROR_CODES.RATE_LIMIT : AI_ERROR_CODES.BAD_RESPONSE;
        return { ok: false, code, message: `模型服务返回 ${response.status}` };
      }
      return { ok: true, model: config.model };
    } catch {
      return { ok: false, code: AI_ERROR_CODES.NETWORK, message: errorMessage(AI_ERROR_CODES.NETWORK) };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { startChat, cancel, testConnection };
}

export default createAiService;
