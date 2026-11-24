/**
 * 主进程入口脱敏（electron CJS 边界的唯一真源）。
 *
 * 为什么需要它：v2 的脱敏只发生在渲染侧 buildLogEntry()，但 log:write 是任意
 * 渲染代码 / 插件 / DevTools 都能调用的 IPC 入口，绕过构造函数的条目会把文档
 * 正文、搜索词、绝对路径原样落盘。这里在 log-service._validateEntry() 再兜一层，
 * main-log.js 也复用同一份实现，保证「无论从哪条路径进来，落盘前都过一次」。
 *
 * 规则与 src/shared/observability/logContract.ts 的 redactParams 对齐，并额外补上
 * v3 方案 D2/D3 要求的键：newKeyword / previousKeyword / notifyMessage / 用户正文。
 * 两端口径由 scripts/verify-logging.mts 的 C8 行为用例交叉校验。
 *
 * 约束：本文件不得 import 任何模块（verify-logging.mts 会把它编码成 data: URL
 * 注入到主进程服务的冒烟环境里），也不得写 console（日志通道自身不产生日志）。
 */

const MAX_DEPTH = 3;
const MAX_ARRAY = 50;
const MAX_STRING = 200;

const SENSITIVE_KEYS = new Set([
  'content', 'text', 'body', 'markdown', 'html', 'raw', 'documentcontent',
  'filecontent', 'basecontent', 'password', 'token', 'secret', 'apikey',
  'credential', 'authorization', 'cookie', 'base64',
]);

// 只匹配「明确的后缀」，不用 includes：否则 context 会被 text、buildStatus 会被 ui 误伤。
const SENSITIVE_SUFFIX = /(?:Content|Text|Body|Markdown|Html|Raw|Password|Token|Secret|ApiKey|Credential|Authorization|Cookie|Base64)$/;
const LENGTH_ONLY_KEYS = new Set([
  'keyword', 'query', 'searchterm', 'searchtext', 'searchquery',
  'newkeyword', 'previouskeyword', 'notifymessage', 'message',
  'documenttitle', 'nodetitle', 'notetitle', 'usernote',
]);
const PATH_KEY = /path|dir|uri|url|folder|file/i;
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\/users\/|\/home\/|\/root\/|\\\\)/i;

function toBasename(value) {
  const normalized = String(value).replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  const last = parts[parts.length - 1] || normalized;
  return last.length > 80 ? last.slice(0, 80) : last;
}

function summarizeString(value) {
  return `[length:${String(value).length}]`;
}

function cleanError(value, depth, seen) {
  if (!value || typeof value !== 'object') return redactValue(value, undefined, depth, seen);
  const out = {};
  for (const key of ['name', 'message', 'stack']) {
    if (!(key in value)) continue;
    const raw = value[key];
    if (typeof raw !== 'string') {
      out[key] = redactValue(raw, undefined, depth + 1, seen);
      continue;
    }
    // 错误消息与栈是排障主线索，保留内容但截断；其中的绝对路径替换为 basename。
    const withoutPaths = raw.replace(/[a-zA-Z]:[\\/][^\s"']+/g, toBasename);
    out[key] = withoutPaths.length > (key === 'stack' ? 4000 : 500)
      ? `${withoutPaths.slice(0, key === 'stack' ? 4000 : 500)}…`
      : withoutPaths;
  }
  return out;
}

function redactValue(value, key, depth, seen) {
  if (value === null || value === undefined) return value;
  const lowerKey = typeof key === 'string' ? key.toLowerCase() : '';
  if (typeof value === 'string') {
    if (lowerKey === 'error') return cleanError(value, depth, seen);
    if (SENSITIVE_KEYS.has(lowerKey) || SENSITIVE_SUFFIX.test(key || '')) return '[redacted]';
    if (LENGTH_ONLY_KEYS.has(lowerKey)) return summarizeString(value);
    if (value.startsWith('data:')) {
      const semicolon = value.indexOf(';');
      const comma = value.indexOf(',');
      const mimeEnd = semicolon > 5 ? semicolon : comma;
      const mime = mimeEnd > 5 ? value.slice(5, mimeEnd) : 'unknown';
      return `[data-uri:${mime};length:${value.length}]`;
    }
    // 值形态兜底：即使 key 语义在 params.args 里丢失，绝对路径也不落明文。
    if (ABSOLUTE_PATH.test(value)) return toBasename(value);
    if (PATH_KEY.test(key || '') && /[\\/]/.test(value)) return toBasename(value);
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return String(value);
  if (value instanceof Error) return cleanError(value, depth, seen);
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    if (depth >= MAX_DEPTH) return '[truncated]';
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY).map((item) => redactValue(item, undefined, depth + 1, seen));
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase()) || SENSITIVE_SUFFIX.test(k)) {
        out[k] = '[redacted]';
        continue;
      }
      out[k] = k.toLowerCase() === 'error'
        ? cleanError(v, depth + 1, seen)
        : redactValue(v, k, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}

/** 返回清洗后的 params（或 meta）；输入非对象时返回空对象。 */
export function redactParamsDeep(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
  try {
    return redactValue(params, undefined, 0, new WeakSet());
  } catch {
    return { redacted: true, reason: 'redact-failed' };
  }
}

/** main-log.js 历史导出名，保持兼容。 */
export const redactMainParams = redactParamsDeep;

export default redactParamsDeep;
