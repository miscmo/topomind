/**
 * AI 对话历史会话存储（主进程）。
 *
 * 单一真源：<workDir>/.topomind/ai/sessions.json，与 agents.json 同目录、
 * 同构（temp + rename 原子写、读盘损坏自愈、按工作目录隔离）。
 *
 * 为什么不进 localStorage：项目已有 base64 内容撑爆 localStorage 的历史教训，
 * 对话正文可能很长且会持续累积；这里只由主进程落盘，渲染层只经 IPC 访问。
 * 为什么单独一个文件：ai-key-store.js 的 normalizeAiConfig 会丢弃未知字段，
 * 会话列表不能混进 config.json / agents.json 被一次配置保存悄悄冲掉。
 *
 * 落盘范围（C10 / C15）：只存对话正文与列表元数据。工具调用明细、
 * 变更预览、委托卡片、[ref:i] 映射依旧只在渲染层内存，不落盘、不进日志。
 *
 * normalize 是最终校验闸：白名单字段、枚举、条数与字符上限全在这里钳制，
 * 渲染层传来的任何未知字段（含可能的密钥 / 磁盘路径）都会被丢弃。
 */
import nodeFs from 'fs';
import nodePath from 'path';

const SESSION_SCHEMA = 'topomind.ai-session-file';
const SESSION_VERSION = 1;
const FILE_NAME = 'sessions.json';

const LIMITS = Object.freeze({
  maxSessions: 60,
  maxMessages: 100,
  messageContentMax: 12000,
  shortTextMax: 120,
  titleMax: 60,
  idMax: 100,
  /** 兜底：单文件序列化上限，超出按 updatedAt 从最旧会话开始裁剪。 */
  maxFileChars: 6 * 1024 * 1024,
});

const ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const ROLES = new Set(['user', 'assistant']);
const REASONING_MODES = new Set(['off', 'on', 'auto']);

function filePath(workDir) {
  return nodePath.join(workDir, '.topomind', 'ai', FILE_NAME);
}

function readJsonSafe(target) {
  try {
    if (!nodeFs.existsSync(target)) return null;
    const parsed = JSON.parse(nodeFs.readFileSync(target, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(target, value) {
  nodeFs.mkdirSync(nodePath.dirname(target), { recursive: true });
  const tempPath = `${target}.${process.pid}.tmp`;
  nodeFs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  nodeFs.renameSync(tempPath, target);
}

function shortText(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function boundedTimestamp(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.round(num);
}

function emptyFile() {
  return { schema: SESSION_SCHEMA, version: SESSION_VERSION, sessions: [] };
}

function normalizeMessage(raw, index) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (!ROLES.has(input.role)) return null;
  const message = {
    id: shortText(input.id, LIMITS.idMax, `msg-${index + 1}`),
    role: input.role,
    content: typeof input.content === 'string' ? input.content.slice(0, LIMITS.messageContentMax) : '',
  };
  const agentId = shortText(input.agentId, LIMITS.shortTextMax);
  if (agentId) message.agentId = agentId;
  if (REASONING_MODES.has(input.reasoningMode)) message.reasoningMode = input.reasoningMode;
  return message;
}

/** 写入 / 读盘共用；非法 id 的整条会话直接丢弃，不半写、不猜测。 */
export function normalizeAiSession(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id)) return null;
  const now = Date.now();
  const createdAt = boundedTimestamp(input.createdAt, now);
  const updatedAt = Math.max(createdAt, boundedTimestamp(input.updatedAt, now));
  const messages = Array.isArray(input.messages)
    ? input.messages.map(normalizeMessage).filter(Boolean).slice(-LIMITS.maxMessages)
    : [];
  return {
    schema: SESSION_SCHEMA,
    version: SESSION_VERSION,
    id: input.id,
    title: shortText(input.title, LIMITS.titleMax, '新会话'),
    createdAt,
    updatedAt,
    messages,
  };
}

function toSummary(record) {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messages.length,
  };
}

function byRecent(a, b) {
  return b.updatedAt - a.updatedAt;
}

/**
 * @param {{ getWorkDir: () => string }} deps
 */
export function createAiSessionStore({ getWorkDir }) {
  function readFile() {
    const data = readJsonSafe(filePath(getWorkDir()));
    if (!data || data.version !== SESSION_VERSION || !Array.isArray(data.sessions)) return emptyFile();
    const seen = new Set();
    const sessions = [];
    for (const raw of data.sessions) {
      const record = normalizeAiSession(raw);
      // 同一 id 只认第一条（文件按最近更新排序，第一条即最新版本）。
      if (!record || seen.has(record.id)) continue;
      seen.add(record.id);
      sessions.push(record);
    }
    sessions.sort(byRecent);
    return { schema: SESSION_SCHEMA, version: SESSION_VERSION, sessions };
  }

  function writeFile(file) {
    const sessions = [...file.sessions].sort(byRecent).slice(0, LIMITS.maxSessions);
    // 极端情况下正文仍可能很大：序列化后超限时从最旧会话开始裁，保证文件可控。
    let payload = { schema: SESSION_SCHEMA, version: SESSION_VERSION, sessions };
    while (sessions.length > 1 && JSON.stringify(payload).length > LIMITS.maxFileChars) {
      sessions.pop();
      payload = { schema: SESSION_SCHEMA, version: SESSION_VERSION, sessions };
    }
    writeJsonAtomic(filePath(getWorkDir()), payload);
    return payload;
  }

  /** 列表只回摘要：不把全部历史正文常驻渲染层内存。 */
  function list() {
    const file = readFile();
    return {
      schema: SESSION_SCHEMA,
      version: SESSION_VERSION,
      sessions: file.sessions.map(toSummary),
    };
  }

  function get(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
    return readFile().sessions.find((record) => record.id === id) ?? null;
  }

  /** upsert 一个会话；已存在时保留原 createdAt，避免渲染层覆盖创建时间。 */
  function upsert(payload) {
    const record = normalizeAiSession(payload);
    if (!record) throw new Error('会话标识不合法');
    const file = readFile();
    const previous = file.sessions.find((item) => item.id === record.id);
    if (previous) record.createdAt = previous.createdAt;
    const next = {
      ...file,
      sessions: [record, ...file.sessions.filter((item) => item.id !== record.id)],
    };
    writeFile(next);
    return toSummary(record);
  }

  function remove(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return { ok: true, removed: false };
    const file = readFile();
    const kept = file.sessions.filter((record) => record.id !== id);
    if (kept.length === file.sessions.length) return { ok: true, removed: false };
    writeFile({ ...file, sessions: kept });
    return { ok: true, removed: true };
  }

  return { list, get, upsert, remove };
}

export default createAiSessionStore;
