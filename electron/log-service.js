/**
 * 日志服务 (Electron Main Process) —— v3
 *
 * 职责：
 * 1. app 启动即落到 userData/logs 兜底目录；进入工作目录后切换并 flush 预缓冲（D5 保持现状）
 * 2. 按类分文件：<logDir>/YYYY-MM-DD/{user,internal,performance,error}.N.log
 *    v1/v2 的 <logDir>/YYYY-MM-DD(.N).log 只读兼容，不重写历史文件
 * 3. 分级保留期（user 30 / internal 14 / performance 14 / error 90 天）
 * 4. 每类独立串行队列 + 同 tick 批量 appendFile，失败条目带次数重入队
 * 5. 唯一等级阈值（DEBUG 只进内存/控制台，不落盘）
 * 6. 流式分页查询、坏行计数、跨类按 timestamp+seq 合并、v1/v2 读时兼容
 * 7. 会话关联键：sessionId（启动生成）/ seq（单调递增）/ workspaceId（路径短哈希）
 * 8. IPC 订阅广播（log:entry / log:level）、drain() 与真实落盘统计
 *
 * 分类规则来自单一真源 src/shared/observability/eventCatalog.ts，经
 * scripts/gen-event-types.mts 生成 electron/log-categories.generated.js；
 * 主进程是独立 JS 边界，禁止在这里手写一份分类表。
 */
import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import readline from 'readline';
import { redactParamsDeep } from './log-redact.js';
import {
  LOG_SCHEMA_VERSION,
  LOG_CATEGORY_IDS,
  CATEGORY_RETENTION_DAYS,
  CATEGORY_BY_ACTION,
  ACTION_LABELS,
  PERFORMANCE_ACTION_ID,
  DEFAULT_CATEGORY,
  CATEGORY_RULES,
} from './log-categories.generated.js';

// ============================================================
// 1. 配置（与契约 LOG_LIMITS 一一对应）
// ============================================================

const LOG_DIR_NAME = 'logs';
const MAX_BUFFER_SIZE = 2000;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const RETENTION_DAYS = 14;
const MAX_MESSAGE_LENGTH = 500;
const MAX_PARAMS_BYTES = 8 * 1024;
const MAX_QUERY_LIMIT = 500;
const DEFAULT_QUERY_LIMIT = 200;
const MAX_PENDING = 500;
const MAX_WRITE_RETRIES = 3;
const WRITE_RETRY_DELAY_MS = 2000;
const DRAIN_TIMEOUT_MS = 1500;
// P3 崩溃闭环
const MAX_BREADCRUMBS = 2000;
const BREADCRUMB_DUMP = 50;
const SESSION_FILE_NAME = 'session.json';
const CRASH_DIR_NAME = 'crashes';
const DIAGNOSTIC_MAX_PER_CATEGORY = 200;
const DIAGNOSTIC_TAIL_BYTES = 128 * 1024;
// P7 M5：同一交互内相同事实的短窗口去重（error 类不参与，崩溃前必达）。
const DEDUPE_WINDOW_MS = 1500;
const FACT_KINDS = ['intent', 'state', 'process', 'periodic', 'failure', 'metric'];

const LEVEL_ORDER = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(\.\d+)?$/;
const DAY_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOG_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})(\.\d+)?\.log$/;
// 类别名单来自生成产物，禁止在这里手写一份（v3 §9.7）。
const CATEGORY_FILE_PATTERN = new RegExp(`^(${LOG_CATEGORY_IDS.join('|')})(\\.\\d+)?\\.log$`);
const ERROR_ACTION_HINT = new RegExp(CATEGORY_RULES.errorActionPattern, 'i');

// ============================================================
// 2. 状态
// ============================================================

let _currentWorkDir = null;
let _fallbackLogDir = null;
/** 只有目录通过可写探测后才非 null；不可写时 write() 会进预缓冲队列而不是丢日志。 */
let _logDir = null;
let _logDirReady = false;
let _dirFailureWarned = false;
let _retryTimer = null;
let _buffer = [];
let _bufferIndex = 0;
let _bufferWrapped = false;
/** 元素为 { entry, attempts }：写失败的条目会带着重试次数重新入队。 */
let _pending = [];
let _minLevel = LEVEL_ORDER.INFO;
let _writeFailureWarned = false;
let _ipcHandlersRegistered = false;
const _subscribers = new Set();
const _writeStats = { failed: 0, retried: 0, dropped: 0, queued: 0, written: 0, duplicates: 0, byCategory: {} };
/** dedupeKey -> { at, count }；只作短窗口判重，不缓存日志正文。 */
const _dedupeSeen = new Map();

// v3 会话关联键
let _sessionId = null;
let _sessionStartedAt = null;
let _seq = 0;
let _workspaceId = 'fallback';

/** category -> { pending, chain, scheduled }：每类独立串行批量写队列。 */
const _queues = new Map();
/** category -> { date, index, bytes }：每类独立分片游标。 */
const _shardState = new Map();

// v3 P4 查询索引：分片行偏移索引 + 查询计划缓存。
// 目标是把「每页都全量解析 + 全量排序」降为「内存过滤 + 只随机读目标行」，
// 同时保持 total / parseErrors / 读时兼容 / timestamp+seq 稳定序完全不变。
/** file path -> { size, mtimeMs, exact, records, parseErrors, lineCount } */
const _indexCache = new Map();
/** filterKey -> { records, total, parseErrors }；写入或清理时整体失效。 */
const _queryCache = new Map();
const _queryStats = { rebuilt: 0, hits: 0, misses: 0, appended: 0, fallbacks: 0, indexedRecords: 0 };

// P3：原始输入黑匣子（D2）——只驻留主进程内存，绝不单独落盘。
let _breadcrumbs = [];
let _breadcrumbIndex = 0;
let _breadcrumbWrapped = false;
let _crashDumpDir = null;
let _appVersion = null;
let _sessionStatus = 'unknown';
let _sessionHistory = [];
let _recoveredFrom = null;

// ============================================================
// 3. 初始化与目录切换
// ============================================================

function _dateStr(value) {
  const d = value instanceof Date ? value : new Date(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** FNV-1a：工作目录短哈希，不落明文路径（v3 §0.1）。 */
function _hashWorkspace(dir) {
  const value = String(dir || 'fallback').replace(/\\/g, '/').toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function _newSessionId() {
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 目录切换 / 历史清理 / 会话重启时整体失效；成功写入走增量追加，不必全清。 */
function _invalidateIndexes() {
  _indexCache.clear();
  _queryCache.clear();
}

function getQueryStats() {
  return {
    ..._queryStats,
    indexedFiles: _indexCache.size,
    cachedPlans: _queryCache.size,
    indexedRecords: [..._indexCache.values()].reduce((sum, idx) => sum + idx.records.length, 0),
  };
}

/** 目录存在且可写才算就绪；不可写时抛错，由 _activateLogDir 决定降级路径。 */
function _ensureLogDir(dir) {
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  // existsSync / accessSync 在只读挂载与 ACL 场景下会说谎，实际写一个探测文件最可靠。
  const probe = path.join(root, `.write-probe-${process.pid}`);
  fs.writeFileSync(probe, '');
  try { fs.unlinkSync(probe); } catch { /* 探测文件清理失败不影响可写判定 */ }
  return root;
}

/** 分类兜底：查生成表 → 规则 → 默认 internal；与 TS 侧 categoryFromLegacy 同源。 */
function _resolveCategory(raw) {
  if (LOG_CATEGORY_IDS.includes(raw?.category)) return raw.category;
  const action = typeof raw?.action === 'string' ? raw.action : '';
  const mapped = CATEGORY_BY_ACTION[action];
  if (mapped) return mapped;
  if (raw?.level === 'ERROR' || ERROR_ACTION_HINT.test(action)) return 'error';
  if (action === PERFORMANCE_ACTION_ID || raw?.module === 'performance' || action.startsWith('perf.')) return 'performance';
  if (CATEGORY_RULES.userPrefixes.some((prefix) => action.startsWith(prefix))) return 'user';
  if (CATEGORY_RULES.internalPrefixes.some((prefix) => action.startsWith(prefix))) return 'internal';
  return DEFAULT_CATEGORY;
}

/**
 * 激活一个日志目录：先探测可写，再赋值 _logDir。
 * 失败时保持 _logDir = null，使 write() 进入预缓冲；绝不把不可写目录记为就绪。
 */
function _activateLogDir(dir) {
  if (!dir) return false;
  _invalidateIndexes();
  try {
    _logDir = _ensureLogDir(dir);
    _logDirReady = true;
    const today = _dateStr(new Date());
    fs.mkdirSync(path.join(_logDir, today), { recursive: true });
    for (const category of LOG_CATEGORY_IDS) _resetShard(today, category);
    // 先补写启动期条目，再写清理日志，保证恢复后时间顺序仍可读。
    _flushPending();
    _pruneOldLogs();
    return true;
  } catch (err) {
    _logDir = null;
    _logDirReady = false;
    if (!_dirFailureWarned) {
      _dirFailureWarned = true;
      // 只打 message：错误堆栈可能带完整 URL / base64 源码，会把日志撑成 MB 级。
      console.error('[LogService] log dir not writable (degraded to pending queue):', err?.message ?? err);
    }
    return false;
  }
}

/**
 * @param {{logDir: string, level?: string}|string} options - 兜底日志目录
 */
function init(options) {
  const input = typeof options === 'string' ? { logDir: options } : (options || {});
  if (!input.logDir) return false;
  _fallbackLogDir = path.resolve(input.logDir);
  _logDir = null;
  _logDirReady = false;
  _invalidateIndexes();
  _sessionId = _newSessionId();
  _sessionStartedAt = new Date().toISOString();
  _seq = 0;
  _workspaceId = _hashWorkspace(_fallbackLogDir);
  _breadcrumbs = [];
  _breadcrumbIndex = 0;
  _breadcrumbWrapped = false;
  _sessionHistory = [];
  _recoveredFrom = null;
  // P3：minidump 目录由 main.js 在 crashReporter.start 之前建好并传入；缺省退回兜底目录。
  _crashDumpDir = input.crashDumpDir
    ? path.resolve(input.crashDumpDir)
    : path.join(_fallbackLogDir, CRASH_DIR_NAME);
  _appVersion = typeof input.appVersion === 'string' && input.appVersion ? input.appVersion : null;
  try { fs.mkdirSync(_crashDumpDir, { recursive: true }); } catch { /* 不可写时 dumpRef 降级为 available:false */ }
  if (input.level) setLevel(input.level, false);
  _activateLogDir(_fallbackLogDir);
  // 目录就绪后才判读上次会话状态：恢复报告本身走 error 同步通道，能确保落盘。
  _initSession();
  _registerIpcHandlers();
  write({
    level: 'INFO', module: 'app', action: 'app.startup',
    message: '日志服务已初始化', params: { fallback: true },
  });
  return true;
}

/** 进入工作目录：切换到 <workDir>/logs，flush 预缓冲，清空上一目录的内存缓冲。 */
function enterWorkDir(workDir) {
  if (!workDir) return false;
  _currentWorkDir = path.resolve(workDir);
  const switched = _activateLogDir(path.join(_currentWorkDir, LOG_DIR_NAME));
  // 目标不可写时回退兜底目录，保证「切了目录但日志一条不落」不会出现。
  if (!switched && _fallbackLogDir) _activateLogDir(_fallbackLogDir);
  if (switched) {
    _workspaceId = _hashWorkspace(_currentWorkDir);
    // dump 引用跟随当前工作目录（D5）；不可写时保留启动兜底目录。
    try {
      const nextDumpDir = path.join(_logDir, CRASH_DIR_NAME);
      fs.mkdirSync(nextDumpDir, { recursive: true });
      _crashDumpDir = nextDumpDir;
    } catch { /* 保留启动兜底 dumps 目录 */ }
  } else if (_fallbackLogDir) {
    _workspaceId = _hashWorkspace(_fallbackLogDir);
  }
  // 只清展示用的内存缓冲；预缓冲队列已在 _activateLogDir 内 flush，不会被清掉。
  clearBuffer();
  // session.json 固定在启动兜底目录（不随工作目录漂移，避免误报崩溃），只更新 workspace 映射。
  _updateSessionFields({ workspaceId: _workspaceId, currentWorkDirId: _hashWorkspace(_currentWorkDir) });
  write({
    level: 'INFO', module: 'workspace', action: 'workspace.enter',
    message: '进入工作目录', params: { ok: true },
  });
  return true;
}

/** 离开工作目录：回到兜底目录，预缓冲与内存缓冲都不清空（不丢日志）。 */
function leaveWorkDir() {
  _currentWorkDir = null;
  if (_fallbackLogDir) _activateLogDir(_fallbackLogDir);
  _workspaceId = _hashWorkspace(_fallbackLogDir);
  write({
    level: 'INFO', module: 'workspace', action: 'workspace.leave',
    message: '离开工作目录', params: {},
  });
  return true;
}

function getCurrentWorkDir() {
  return _currentWorkDir;
}

function getLogDir() {
  return _logDir;
}

function getSessionInfo() {
  return {
    sessionId: _sessionId,
    startedAt: _sessionStartedAt,
    seq: _seq,
    workspaceId: _workspaceId,
    status: _sessionStatus,
    appVersion: _appVersion,
    crashDumpDir: CRASH_DIR_NAME,
    recoveredFrom: _recoveredFrom?.sessionId ?? null,
  };
}

// ============================================================
// 4. 写入：校验、补全、等级、队列
// ============================================================

function _randomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function _shortString(value, max) {
  if (typeof value !== 'string') return undefined;
  // 控制字符会破坏 JSON Lines 的单行结构；逐码点过滤，避免正则里的控制字符字面量。
  const clean = Array.from(value, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : ch;
  }).join('');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function _safeJsonSize(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { return MAX_PARAMS_BYTES + 1; }
}

/** 入口参数白名单校验：未知字段一律丢弃，v1 幽灵字段不再产生。 */
function _validateEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const level = typeof raw.level === 'string' && LEVEL_ORDER[raw.level.toUpperCase()] !== undefined
    ? raw.level.toUpperCase()
    : 'INFO';
  const message = _shortString(raw.message, MAX_MESSAGE_LENGTH) || _shortString(raw.action, 120) || '日志事件';
  // IPC 入口兜底脱敏：绕过渲染侧 buildLogEntry 的调用方（插件 / DevTools / 新代码）
  // 也不能把正文、搜索词、绝对路径落盘。规则在 electron/log-redact.js 单一维护。
  let params = raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
    ? redactParamsDeep(raw.params)
    : null;
  if (params && _safeJsonSize(params) > MAX_PARAMS_BYTES) {
    params = { truncated: true, originalBytes: _safeJsonSize(params) };
  }
  let meta = null;
  if (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) {
    meta = redactParamsDeep(raw.meta);
    if (_safeJsonSize(meta) > MAX_PARAMS_BYTES) {
      meta = { truncated: true, originalBytes: _safeJsonSize(meta) };
    }
  }
  let error = null;
  if (raw.error && typeof raw.error === 'object') {
    error = {
      name: _shortString(raw.error.name, 80) || 'Error',
      message: _shortString(raw.error.message, MAX_MESSAGE_LENGTH) || '',
      ...(typeof raw.error.stack === 'string' ? { stack: _shortString(raw.error.stack, 4000) } : {}),
    };
  } else if (typeof raw.error === 'string') {
    error = { name: 'Error', message: _shortString(raw.error, MAX_MESSAGE_LENGTH) || '' };
  }
  let target = null;
  if (raw.target && typeof raw.target === 'object' && !Array.isArray(raw.target)) {
    target = redactParamsDeep(raw.target);
    // D3：即使绕过 buildLogEntry，目标名称也只留长度摘要，不落明文标题。
    if (target && typeof target.label === 'string') target.label = `[length:${target.label.length}]`;
  }
  const clean = {
    level,
    module: _shortString(raw.module, 64) || 'app',
    ...(typeof raw.action === 'string' && raw.action ? { action: _shortString(raw.action, 120) } : {}),
    ...(LOG_CATEGORY_IDS.includes(raw.category) ? { category: raw.category } : {}),
    message,
    ...(params ? { params } : {}),
    ...(error ? { error } : {}),
    ...(typeof raw.traceId === 'string' && raw.traceId ? { traceId: _shortString(raw.traceId, 128) } : {}),
    ...(meta ? { meta } : {}),
    // v3 显式字段（sessionId / seq / workspaceId 不接受外部传入）
    ...(typeof raw.label === 'string' && raw.label ? { label: _shortString(raw.label, 80) } : {}),
    ...(typeof raw.spanId === 'string' && raw.spanId ? { spanId: _shortString(raw.spanId, 128) } : {}),
    ...(typeof raw.parentId === 'string' && raw.parentId ? { parentId: _shortString(raw.parentId, 128) } : {}),
    ...(typeof raw.result === 'string' && raw.result ? { result: _shortString(raw.result, 40) } : {}),
    ...(typeof raw.source === 'string' && raw.source ? { source: _shortString(raw.source, 40) } : {}),
    ...(typeof raw.outcome === 'string' && raw.outcome ? { outcome: _shortString(raw.outcome, 40) } : {}),
    ...(typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
      ? { durationMs: Math.max(0, Math.round(raw.durationMs)) } : {}),
    ...(target ? { target } : {}),
    // P7：事实唯一性字段。repeatCount 只由服务端累加，不接受外部传入（防伪造）。
    ...(FACT_KINDS.includes(raw.kind) ? { kind: raw.kind } : {}),
    ...(typeof raw.dedupeKey === 'string' && raw.dedupeKey ? { dedupeKey: _shortString(raw.dedupeKey, 64) } : {}),
    ...(typeof raw.stepCount === 'number' && Number.isFinite(raw.stepCount)
      ? { stepCount: Math.max(0, Math.round(raw.stepCount)) } : {}),
    ...(Array.isArray(raw.steps) ? {
      steps: raw.steps.slice(0, 100).map((step) => ({
        name: _shortString(step?.name, 80) || 'step',
        at: Number.isFinite(step?.at) ? step.at : 0,
        ...(Number.isFinite(step?.durationMs) ? { durationMs: Math.max(0, Math.round(step.durationMs)) } : {}),
        ...(typeof step?.outcome === 'string' ? { outcome: _shortString(step.outcome, 40) } : {}),
        ...(typeof step?.spanId === 'string' ? { spanId: _shortString(step.spanId, 128) } : {}),
        ...(typeof step?.parentId === 'string' ? { parentId: _shortString(step.parentId, 128) } : {}),
        ...(step?.params && typeof step.params === 'object' && !Array.isArray(step.params)
          ? { params: redactParamsDeep(step.params) } : {}),
      })),
    } : {}),
  };
  clean.category = _resolveCategory(clean);
  clean.label = clean.label || ACTION_LABELS[clean.action] || clean.message;
  return clean;
}

function _completeEntry(clean) {
  const now = new Date();
  const timestamp = now.toISOString();
  _seq += 1;
  return {
    v: LOG_SCHEMA_VERSION,
    id: `${timestamp.replace(/[-:T.Z]/g, '')}${_randomId()}@topomind`,
    timestamp,
    ...clean,
    // 服务端统一补全，渲染侧不可伪造。
    sessionId: _sessionId,
    seq: _seq,
    workspaceId: _workspaceId,
  };
}

/**
 * 写入一条日志。
 *
 * 语义（v3 §7 P0 + P3）：`accepted` 只表示「已被日志服务接纳」——已进内存缓冲、
 * 已广播、已排入写队列或已同步落盘；非 error 类的落盘仍是异步的，调用方不得把
 * accepted:true 当写入成功，需要确认时用 await drain()。
 * `durable` 仅当 error 类通过独立 appendFileSync 通道写入成功时为 true。
 */
/**
 * P7 M5：同一交互内「同一事实」只落一条。重复不静默丢弃 —— 计入
 * getWriteStats().duplicates，并在内存缓冲的保留条目上累加 repeatCount，
 * 因此订阅者（Debug HUD / 事件流）能看到「该事实重复了 N 次」。
 * error 类跳过去重：崩溃前最后一条日志必须必达。
 */
function _applyDedupe(entry) {
  const key = entry.dedupeKey;
  if (!key || entry.category === 'error') return false;
  const now = Date.now();
  const seen = _dedupeSeen.get(key);
  if (seen && now - seen.at <= DEDUPE_WINDOW_MS) {
    seen.count += 1;
    seen.at = now;
    _writeStats.duplicates += 1;
    for (let i = _buffer.length - 1; i >= 0; i -= 1) {
      const candidate = _buffer[i];
      if (candidate && candidate.dedupeKey === key) {
        candidate.repeatCount = (candidate.repeatCount || 0) + 1;
        break;
      }
    }
    return true;
  }
  _dedupeSeen.set(key, { at: now, count: 1 });
  if (_dedupeSeen.size > 2000) {
    for (const [k, v] of _dedupeSeen) {
      if (now - v.at > DEDUPE_WINDOW_MS) _dedupeSeen.delete(k);
    }
  }
  return false;
}

function write(raw) {
  const clean = _validateEntry(raw);
  if (!clean) return { accepted: false, reason: 'invalid' };
  if (LEVEL_ORDER[clean.level] < _minLevel) return { accepted: false, reason: 'filtered' };

  const fullEntry = _completeEntry(clean);
  if (_applyDedupe(fullEntry)) {
    return {
      accepted: true,
      deduplicated: true,
      repeatCount: _dedupeSeen.get(fullEntry.dedupeKey)?.count ?? 1,
      pendingWrites: _pending.length,
    };
  }
  // P3：error 专属上下文只在服务端生成，渲染侧无法伪造。
  if (fullEntry.category === 'error') _enrichErrorEntry(fullEntry);
  _pushToBuffer(fullEntry);
  _broadcast(fullEntry);

  if (!_logDirReady || !_logDir) {
    _queuePending(fullEntry, 0);
    return { accepted: true, reason: 'queued', durable: false, pendingWrites: _pending.length };
  }

  // DEBUG 只进内存/控制台，不落盘（规范 D4）。
  if (clean.level === 'DEBUG') {
    return { accepted: true, durable: false, pendingWrites: _pending.length };
  }
  // P3：error 类走独立同步句柄，绕开异步批量队列（崩溃前最后一条日志必达）。
  const durable = _dispatchEntry(fullEntry, 0);
  return { accepted: true, durable, pendingWrites: _pending.length };
}

/** 队列上限内保留最早的启动期条目；超出时丢弃新条目并计数（不静默）。 */
function _queuePending(entry, attempts) {
  if (_pending.length >= MAX_PENDING) {
    _writeStats.dropped += 1;
    return false;
  }
  _pending.push({ entry, attempts });
  _writeStats.queued += 1;
  return true;
}

function _scheduleRetry() {
  if (_retryTimer || _pending.length === 0) return;
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    _flushPending();
  }, WRITE_RETRY_DELAY_MS);
  if (_retryTimer && typeof _retryTimer.unref === 'function') _retryTimer.unref();
}

function _pushToBuffer(entry) {
  if (_buffer.length < MAX_BUFFER_SIZE) {
    _buffer.push(entry);
  } else {
    _buffer[_bufferIndex] = entry;
    _bufferWrapped = true;
  }
  _bufferIndex = (_bufferIndex + 1) % MAX_BUFFER_SIZE;
}

function _getQueue(category) {
  let queue = _queues.get(category);
  if (!queue) {
    queue = { pending: [], chain: Promise.resolve(), scheduled: false };
    _queues.set(category, queue);
  }
  return queue;
}

/** 同一 microtask 内的多条日志合并成一次 appendFile（按类独立队列）。 */
function _enqueueWrite(entry, attempts = 0) {
  const category = LOG_CATEGORY_IDS.includes(entry.category) ? entry.category : DEFAULT_CATEGORY;
  const queue = _getQueue(category);
  queue.pending.push({ entry, attempts });
  if (!queue.scheduled) {
    queue.scheduled = true;
    queueMicrotask(() => _flushQueue(category));
  }
}

function _flushQueue(category) {
  const queue = _queues.get(category);
  if (!queue) return;
  queue.scheduled = false;
  const batch = queue.pending.splice(0, queue.pending.length);
  if (batch.length === 0) return;
  queue.chain = queue.chain
    .catch(() => {})
    .then(() => _writeBatch(category, batch));
}

function _serializeEntry(entry) {
  try {
    return `${JSON.stringify(entry)}\n`;
  } catch {
    return `${JSON.stringify({
      ...entry,
      message: '日志序列化失败（已降级）',
      params: null,
      error: { name: 'SerializationError', message: 'entry contains circular or non-serializable values' },
    })}\n`;
  }
}

/** 按目标分片聚合行，一次 appendFile 写一批；失败整批带次数重入预缓冲。 */
async function _writeBatch(category, batch) {
  // target -> { text, items }：items 保留逐行原文与条目，供索引增量追加精确计算字节偏移。
  const groups = new Map();
  const touchedDates = new Set();
  for (const item of batch) {
    const date = _dateStr(item.entry.timestamp);
    const line = _serializeEntry(item.entry);
    const target = _pickShard(date, category);
    touchedDates.add(date);
    let group = groups.get(target);
    if (!group) {
      group = { text: '', items: [] };
      groups.set(target, group);
    }
    group.text += line;
    group.items.push({ entry: item.entry, line });
    // 乐观推进分片游标；写失败时按 stat 重建。
    const state = _shardState.get(category);
    if (state) state.bytes += Buffer.byteLength(line, 'utf8');
  }
  let ok = true;
  for (const [target, group] of groups) {
    try {
      const before = await _appendWithRetry(target, group.text);
      _appendIndexRecords(target, before, group.items);
    } catch (err) {
      ok = false;
      _writeStats.failed += 1;
      if (!_writeFailureWarned) {
        _writeFailureWarned = true;
        console.error('[LogService] write failed (degraded to memory buffer):', err?.message ?? err);
      }
      break;
    }
  }
  if (!ok) {
    for (const date of touchedDates) _resetShard(date, category);
    for (const item of batch) {
      if (item.attempts < MAX_WRITE_RETRIES) {
        _writeStats.retried += 1;
        _queuePending(item.entry, item.attempts + 1);
      } else {
        _writeStats.dropped += 1;
      }
    }
    _scheduleRetry();
    return;
  }
  _writeStats.written += batch.length;
  _writeStats.byCategory[category] = (_writeStats.byCategory[category] || 0) + batch.length;
}

async function _appendWithRetry(target, lines) {
  // 返回写入前的字节数：索引按这个基准追加新行偏移，无需重新扫描文件。
  const before = _fileSize(target);
  try {
    await fsp.appendFile(target, lines, 'utf8');
  } catch {
    // 一次重试：日期目录可能被外部清理，重建后再写；再次失败交给写队列降级。
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.appendFile(target, lines, 'utf8');
  }
  return before;
}

// ============================================================
// 5. 分片与分级保留期
// ============================================================

function _shardPath(date, category, index) {
  return path.join(_logDir, date, index === 0 ? `${category}.log` : `${category}.${index}.log`);
}

function _fileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

function _resetShard(date, category) {
  let index = 0;
  let bytes = _fileSize(_shardPath(date, category, 0));
  while (bytes >= MAX_FILE_SIZE_BYTES && index < 999) {
    index += 1;
    bytes = _fileSize(_shardPath(date, category, index));
  }
  _shardState.set(category, { date, index, bytes });
}

/** 在串行队列内调用：按该类别分片的字节数决定是否切到 .N.log。 */
function _pickShard(date, category) {
  let state = _shardState.get(category);
  if (!state || state.date !== date) {
    _resetShard(date, category);
    state = _shardState.get(category);
  }
  while (state.bytes >= MAX_FILE_SIZE_BYTES && state.index < 999) {
    state.index += 1;
    state.bytes = _fileSize(_shardPath(date, category, state.index));
  }
  return _shardPath(date, category, state.index);
}

/** 分级清理：日期目录内按 category 判断天数，v1/v2 平铺文件按 14 天兜底。 */
function _pruneOldLogs() {
  if (!_logDir || !fs.existsSync(_logDir)) return;
  const now = Date.now();
  let removed = 0;
  let failed = 0;
  for (const name of fs.readdirSync(_logDir)) {
    if (DAY_DIR_PATTERN.test(name)) {
      const dayDir = path.join(_logDir, name);
      let isDir = false;
      try { isDir = fs.statSync(dayDir).isDirectory(); } catch { /* 已被外部删除 */ }
      if (!isDir) continue;
      const dayTime = Date.parse(`${name}T00:00:00Z`);
      if (!Number.isFinite(dayTime)) continue;
      for (const file of fs.readdirSync(dayDir)) {
        const match = CATEGORY_FILE_PATTERN.exec(file);
        if (!match) continue;
        const days = CATEGORY_RETENTION_DAYS[match[1]] ?? RETENTION_DAYS;
        if (dayTime >= now - days * 24 * 60 * 60 * 1000) continue;
        try {
          fs.unlinkSync(path.join(dayDir, file));
          removed += 1;
        } catch {
          failed += 1; // 单个文件被占用不中断启动
        }
      }
      // 清空后的旧日期目录一并移除，避免日期选择器出现空日期。
      if (name !== _dateStr(new Date())) {
        try {
          if (fs.readdirSync(dayDir).length === 0) fs.rmdirSync(dayDir);
        } catch { /* 非空或权限问题，下次启动再试 */ }
      }
      continue;
    }
    const match = LOG_FILE_PATTERN.exec(name);
    if (!match) continue;
    const time = Date.parse(`${match[1]}T00:00:00Z`);
    if (!Number.isFinite(time) || time >= now - RETENTION_DAYS * 24 * 60 * 60 * 1000) continue;
    try {
      fs.unlinkSync(path.join(_logDir, name));
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  if (removed > 0 || failed > 0) {
    _invalidateIndexes();
    write({
      level: 'INFO', module: 'app', action: 'app.startup',
      message: '历史日志清理完成', params: { removed, failed, graded: true },
    });
  }
}

// ============================================================
// 6. 查询、导出与读时兼容
// ============================================================

/** 日期白名单 + 目录穿越校验；非法输入返回 null（绝不拼进 path.join）。 */
function _validateDate(raw) {
  if (raw === undefined || raw === null || raw === '') return _dateStr(new Date());
  const value = String(raw).replace(/\.log$/, '');
  if (!DATE_PATTERN.test(value)) return null;
  return value;
}

function _isInsideLogDir(file) {
  if (!_logDir) return false;
  const resolved = path.resolve(file);
  const root = path.resolve(_logDir);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

/** 返回某天的全部分片：v3 日期目录（可只挑类别） + v1/v2 平铺旧文件。 */
function _shardFiles(date, categories) {
  const files = [];
  if (_logDir && fs.existsSync(_logDir)) {
    const wanted = Array.isArray(categories) && categories.length > 0
      ? new Set(categories.filter((id) => LOG_CATEGORY_IDS.includes(id)))
      : null;
    const dayDir = path.join(_logDir, date);
    try {
      if (fs.statSync(dayDir).isDirectory()) {
        const items = fs.readdirSync(dayDir)
          .map((name) => {
            const match = CATEGORY_FILE_PATTERN.exec(name);
            if (!match) return null;
            const category = match[1];
            if (wanted && !wanted.has(category)) return null;
            return {
              name,
              category,
              index: Number((/\.(\d+)\.log$/.exec(name) || [])[1] || 0),
            };
          })
          .filter(Boolean)
          .sort((a, b) => {
            const byCategory = LOG_CATEGORY_IDS.indexOf(a.category) - LOG_CATEGORY_IDS.indexOf(b.category);
            return byCategory !== 0 ? byCategory : a.index - b.index;
          });
        for (const item of items) files.push(path.join(dayDir, item.name));
      }
    } catch { /* 日期目录不存在时只读旧格式 */ }
    // v1/v2 平铺文件：读时归类，不重写。
    const escaped = date.replace(/\./g, '\\.');
    const exactShard = DATE_PATTERN.test(date) && /\.\d+$/.test(date);
    const pattern = exactShard
      ? new RegExp(`^${escaped}\\.log$`)
      : new RegExp(`^${escaped}(\\.\\d+)?\\.log$`);
    for (const name of fs.readdirSync(_logDir).filter((n) => pattern.test(n))) {
      files.push(path.join(_logDir, name));
    }
  }
  return files.filter(_isInsideLogDir);
}

/**
 * 读时兼容：v1 补 v / error，v2 补 category / label / session / workspaceId。
 * seq 缺失时给一个递增的负偏移，配合 timestamp 排序仍能稳定回放。
 */
function _normalizeReadEntry(entry, date, readOrder = 0) {
  if (!entry || typeof entry !== 'object') return null;
  const normalized = { ...entry, v: entry.v ?? 1 };
  if (!normalized.error && normalized.params && typeof normalized.params === 'object' && normalized.params.error) {
    const raw = normalized.params.error;
    normalized.error = typeof raw === 'string'
      ? { name: 'Error', message: raw }
      : { name: raw?.name || 'Error', message: String(raw?.message ?? ''), ...(raw?.stack ? { stack: raw.stack } : {}) };
  }
  delete normalized.file;
  delete normalized.line;
  delete normalized.func;
  if (!LOG_CATEGORY_IDS.includes(normalized.category)) normalized.category = _resolveCategory(normalized);
  if (!normalized.label) normalized.label = ACTION_LABELS[normalized.action] || normalized.message || '日志事件';
  if (!normalized.sessionId) normalized.sessionId = `legacy@${date || _dateStr(new Date())}`;
  if (!Number.isFinite(normalized.seq)) normalized.seq = -1000000000 + readOrder;
  if (!normalized.workspaceId) normalized.workspaceId = 'legacy';
  normalized._readOrder = readOrder;
  return normalized;
}

function _matches(entry, filters) {
  if (filters.keyword) {
    const lower = String(filters.keyword).toLowerCase();
    // 与 LogList 的前端过滤口径一致：异常内容也必须可搜（v1 的 error 可能是字符串）。
    const errorText = typeof entry.error === 'string' ? entry.error : (entry.error?.message || '');
    const haystack = [entry.message, entry.label, entry.action, entry.module, errorText, JSON.stringify(entry.params ?? '')]
      .filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(lower)) return false;
  }
  if (filters.levels && filters.levels.length > 0 && !filters.levels.includes(entry.level)) return false;
  if (filters.actions && filters.actions.length > 0 && !filters.actions.includes(entry.action)) return false;
  if (filters.categories && filters.categories.length > 0 && !filters.categories.includes(entry.category)) return false;
  if (filters.sessionId && entry.sessionId !== filters.sessionId) return false;
  if (filters.traceId && entry.traceId !== filters.traceId) return false;
  if (filters.startTime && entry.timestamp < filters.startTime) return false;
  if (filters.endTime && entry.timestamp > filters.endTime) return false;
  return true;
}

/** 跨类文件按 timestamp + seq 合并；单文件时物理顺序已有序，走流式快速路径。 */
function _sortEntries(entries) {
  return entries.sort((a, b) => {
    const ta = Date.parse(a.timestamp) || 0;
    const tb = Date.parse(b.timestamp) || 0;
    if (ta !== tb) return ta - tb;
    const sa = Number.isFinite(a.seq) ? a.seq : -1000000000 + (a._readOrder ?? 0);
    const sb = Number.isFinite(b.seq) ? b.seq : -1000000000 + (b._readOrder ?? 0);
    if (sa !== sb) return sa - sb;
    return (a._readOrder ?? 0) - (b._readOrder ?? 0);
  });
}

// ------------------------------------------------------------
// 6.1 P4 分片行偏移索引：把「每页全量解析 + 全量排序」降为内存过滤 + 随机读目标行
// ------------------------------------------------------------

/** 把归一化条目压成轻量记录；hay 预拼好，查询时不再对每行做 JSON.stringify。 */
function _makeIndexRecord(file, n, off, len, ord) {
  const errorText = typeof n.error === 'string' ? n.error : (n.error?.message || '');
  const hay = [n.message, n.label, n.action, n.module, errorText, JSON.stringify(n.params ?? '')]
    .filter(Boolean).join(' ').toLowerCase();
  return {
    file,
    off,
    len,
    /** 文件内 readOrder：与 _normalizeReadEntry 的入参一致，保证读时兼容结果逐字相同。 */
    ord,
    t: Date.parse(n.timestamp) || 0,
    ts: n.timestamp || '',
    seq: Number.isFinite(n.seq) ? n.seq : -1e9 + ord,
    category: n.category,
    level: n.level,
    action: n.action,
    sessionId: n.sessionId,
    traceId: n.traceId ?? null,
    hay,
  };
}

/**
 * 流式建索引并精确记录每行字节偏移。
 * 末尾用 offset === file size 校验：CRLF、末尾缺换行或外部改写都会让 exact=false，
 * 此时 query 自动回退到原始流式路径，绝不返回错位的行。
 */
async function _buildFileIndex(file, date) {
  const stat = await fsp.stat(file);
  const cached = _indexCache.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached;
  const records = [];
  let parseErrors = 0;
  let offset = 0;
  let lineCount = 0;
  let readOrder = 0;
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const start = offset;
      const len = Buffer.byteLength(line, 'utf8');
      offset += len + 1; // 本服务写出的行分隔符固定是 \n
      lineCount += 1;
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        parseErrors += 1;
        continue;
      }
      readOrder += 1;
      const normalized = _normalizeReadEntry(parsed, date, readOrder);
      if (normalized) records.push(_makeIndexRecord(file, normalized, start, len, readOrder));
    }
  } catch {
    parseErrors += 1;
  } finally {
    lines.close();
    stream.destroy();
  }
  const index = {
    file,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    exact: offset === stat.size,
    records,
    parseErrors,
    lineCount,
  };
  _indexCache.set(file, index);
  _queryStats.rebuilt += 1;
  return index;
}

/** 写入成功后增量追加索引；未建过索引时跳过，下次查询懒加载全量即可。 */
function _appendIndexRecords(file, startOffset, items) {
  const index = _indexCache.get(file);
  if (!index || !index.exact) return;
  let off = startOffset;
  for (const { entry, line } of items) {
    const len = Buffer.byteLength(line, 'utf8') - 1; // 去掉行尾 \n
    if (len <= 0) {
      off += Buffer.byteLength(line, 'utf8');
      continue;
    }
    const ord = index.records.length + 1;
    const normalized = _normalizeReadEntry(entry, _dateStr(entry.timestamp), ord);
    if (normalized) index.records.push(_makeIndexRecord(file, normalized, off, len, ord));
    off += len + 1;
    index.lineCount += 1;
  }
  try {
    const stat = fs.statSync(file);
    index.size = stat.size;
    index.mtimeMs = stat.mtimeMs;
  } catch {
    index.exact = false;
  }
  _queryCache.clear();
  _queryStats.appended += items.length;
}

/** 与 _matches 完全同口径；索引存的是归一化字段，无需再解析整行。 */
function _matchesIndex(rec, filters) {
  if (filters.keyword && !rec.hay.includes(String(filters.keyword).toLowerCase())) return false;
  if (filters.levels && filters.levels.length > 0 && !filters.levels.includes(rec.level)) return false;
  if (filters.actions && filters.actions.length > 0 && !filters.actions.includes(rec.action)) return false;
  if (filters.categories && filters.categories.length > 0 && !filters.categories.includes(rec.category)) return false;
  if (filters.sessionId && rec.sessionId !== filters.sessionId) return false;
  if (filters.traceId && rec.traceId !== filters.traceId) return false;
  if (filters.startTime && rec.ts < filters.startTime) return false;
  if (filters.endTime && rec.ts > filters.endTime) return false;
  return true;
}

function _compareRecords(a, b) {
  if (a.t !== b.t) return a.t - b.t;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return (a.gOrd ?? a.ord) - (b.gOrd ?? b.ord);
}

/** 一次完成过滤 + 排序，分页直接复用；total 仍是全量匹配数（与 limit/offset 无关）。 */
async function _buildQueryPlan(files, date, filters) {
  const matched = [];
  let parseErrors = 0;
  let base = 0;
  for (const file of files) {
    let index;
    try {
      index = await _buildFileIndex(file, date);
    } catch {
      return null; // 文件在扫描期间被删除/占用，交给流式路径保持原有容错
    }
    if (!index.exact) return null;
    parseErrors += index.parseErrors;
    for (const rec of index.records) {
      if (_matchesIndex(rec, filters)) matched.push({ ...rec, gOrd: base + rec.ord });
    }
    base += index.records.length;
  }
  matched.sort(_compareRecords);
  return { records: matched, total: matched.length, parseErrors };
}

/** 按行偏移随机读目标行；每个分片只打开一次 fd，避免一页 500 次整文件读。 */
async function _readIndexedEntries(records, date) {
  const byFile = new Map();
  for (const rec of records) {
    const list = byFile.get(rec.file);
    if (list) list.push(rec);
    else byFile.set(rec.file, [rec]);
  }
  const parsed = new Map();
  let parseErrors = 0;
  for (const [file, recs] of byFile) {
    let handle = null;
    try {
      handle = await fsp.open(file, 'r');
      for (const rec of recs) {
        try {
          const buf = Buffer.allocUnsafe(rec.len);
          const { bytesRead } = await handle.read(buf, 0, rec.len, rec.off);
          const entry = _normalizeReadEntry(JSON.parse(buf.toString('utf8', 0, bytesRead)), date, rec.ord);
          if (entry) parsed.set(rec, entry);
        } catch {
          parseErrors += 1;
        }
      }
    } catch {
      parseErrors += recs.length;
    } finally {
      if (handle) await handle.close();
    }
  }
  return {
    entries: records.map((rec) => parsed.get(rec)).filter(Boolean),
    parseErrors,
  };
}

/** 回退路径：非精确文件仍用原始流式语义（P1 行为逐字保留）。 */
async function _queryStream(opts, files, date, limit, offset) {
  const streamOnly = files.length <= 1;
  const entries = [];
  let total = 0;
  let parseErrors = 0;
  let readOrder = 0;
  for (const file of files) {
    let stream;
    try {
      stream = fs.createReadStream(file, { encoding: 'utf8' });
    } catch {
      parseErrors += 1;
      continue;
    }
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          parseErrors += 1;
          continue;
        }
        readOrder += 1;
        const entry = _normalizeReadEntry(parsed, date, readOrder);
        if (!entry || !_matches(entry, opts)) continue;
        if (streamOnly && total >= offset && entries.length < limit) entries.push(entry);
        else if (!streamOnly) entries.push(entry);
        total += 1;
      }
    } catch {
      parseErrors += 1;
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  if (streamOnly) return { entries, total, parseErrors };
  _sortEntries(entries);
  return { entries: entries.slice(offset, offset + limit), total, parseErrors };
}

/** 返回 { entries, total, parseErrors }；坏行计数而非静默忽略。 */
async function query(opts = {}) {
  const date = _validateDate(opts?.date ?? opts?.dateStr);
  if (!date) return { entries: [], total: 0, parseErrors: 0 };

  const limit = Math.min(Math.max(Number(opts?.limit) || DEFAULT_QUERY_LIMIT, 1), MAX_QUERY_LIMIT);
  const offset = Math.max(Number(opts?.offset) || 0, 0);
  const files = _shardFiles(date, opts?.categories);
  if (files.length === 0) return { entries: [], total: 0, parseErrors: 0 };

  // 缓存 key 带上每个分片的大小/修改时间：外部编辑或追加日志后自动重建计划，
  // 否则旧 plan 会一直返回过期结果。statSync 对几个文件的开销可忽略。
  const stamps = files.map((file) => {
    try {
      const stat = fs.statSync(file);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return 'missing';
    }
  });
  const key = JSON.stringify([
    date, files, stamps,
    opts?.keyword ?? null, opts?.levels ?? null, opts?.actions ?? null,
    opts?.categories ?? null, opts?.sessionId ?? null, opts?.traceId ?? null,
    opts?.startTime ?? null, opts?.endTime ?? null,
  ]);
  let plan = _queryCache.get(key);
  if (plan) {
    _queryStats.hits += 1;
  } else {
    plan = await _buildQueryPlan(files, date, opts);
    if (!plan) {
      _queryStats.fallbacks += 1;
      return _queryStream(opts, files, date, limit, offset);
    }
    if (_queryCache.size >= 64) _queryCache.clear();
    _queryCache.set(key, plan);
    _queryStats.misses += 1;
  }

  const page = plan.records.slice(offset, offset + limit);
  const { entries, parseErrors } = await _readIndexedEntries(page, date);
  return { entries, total: plan.total, parseErrors: plan.parseErrors + parseErrors };
}

/** 导出当日 JSONL（含全部分片原始行）；非法日期返回空串。 */
async function exportJsonl(rawDate) {
  const date = _validateDate(rawDate);
  if (!date) return '';
  const chunks = [];
  for (const file of _shardFiles(date)) {
    try {
      const content = await fsp.readFile(file, 'utf8');
      if (content) chunks.push(content.endsWith('\n') ? content : `${content}\n`);
    } catch {
      // 单个分片不可读时跳过，不阻塞导出
    }
  }
  return chunks.join('');
}

function getAvailableDates() {
  if (!_logDir || !fs.existsSync(_logDir)) return [];
  try {
    const dates = new Set();
    for (const name of fs.readdirSync(_logDir)) {
      if (DAY_DIR_PATTERN.test(name)) {
        try {
          if (fs.statSync(path.join(_logDir, name)).isDirectory()) dates.add(name);
        } catch { /* 目录被外部删除 */ }
        continue;
      }
      const match = LOG_FILE_PATTERN.exec(name);
      if (match) dates.add(match[1]);
    }
    return [...dates].sort().reverse();
  } catch {
    return [];
  }
}

function getBuffer() {
  const ordered = _bufferWrapped
    ? [..._buffer.slice(_bufferIndex), ..._buffer.slice(0, _bufferIndex)]
    : [..._buffer];
  return ordered.map((entry, index) => _normalizeReadEntry(entry, _dateStr(entry.timestamp || new Date()), index)).filter(Boolean);
}

/** 只清内存缓冲，不删磁盘文件；删盘需显式 prune 且 UI 二次确认。 */
function clearBuffer() {
  _buffer = [];
  _bufferIndex = 0;
  _bufferWrapped = false;
  return true;
}

// ============================================================
// 7. 等级与广播
// ============================================================

/** 唯一等级源；返回设置后的等级名，非法值返回当前等级。 */
function setLevel(level, broadcast = true) {
  let next = null;
  if (typeof level === 'string' && LEVEL_ORDER[level.toUpperCase()] !== undefined) {
    next = level.toUpperCase();
  } else if (Number.isInteger(level) && level >= 0 && level <= 3) {
    next = LEVEL_NAMES[level];
  }
  if (!next) return getLevel();
  _minLevel = LEVEL_ORDER[next];
  if (broadcast) _broadcastLevel(next);
  return next;
}

function getLevel() {
  return LEVEL_NAMES[_minLevel];
}

function _broadcastLevel(level) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send('log:level', level);
  }
}

function _registerIpcHandlers() {
  if (_ipcHandlersRegistered) return;
  _ipcHandlersRegistered = true;
  ipcMain.on('log:subscribe', (event) => { _subscribers.add(event.sender.id); });
  ipcMain.on('log:unsubscribe', (event) => { _subscribers.delete(event.sender.id); });
  // P3：黑匣子镜像只进主进程内存缓冲，不写日志、不落盘（D2）。
  ipcMain.on('log:breadcrumbs', (_event, payload) => { pushBreadcrumbs(payload); });
}

function _broadcast(entry) {
  // 顺便回收已销毁窗口的订阅，避免 senderId 越积越多、每次广播做无效遍历。
  const alive = new Map();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) alive.set(win.webContents.id, win);
  }
  for (const senderId of [..._subscribers]) {
    const win = alive.get(senderId);
    if (!win) {
      _subscribers.delete(senderId);
      continue;
    }
    win.webContents.send('log:entry', entry);
  }
}

function _flushPending() {
  if (!_logDirReady || !_logDir || _pending.length === 0) return;
  const batch = _pending.splice(0, _pending.length);
  for (const item of batch) {
    if (item.entry.level !== 'DEBUG') _dispatchEntry(item.entry, item.attempts || 0);
  }
}

/** 等待各类写队列排空（带超时），返回真实落盘状态；退出与诊断包导出前调用。 */
async function drain(timeoutMs = DRAIN_TIMEOUT_MS) {
  if (_pending.length > 0) _flushPending();
  // 让 _enqueueWrite 排入的 microtask 先完成，再收集各队列的 chain。
  await Promise.resolve();
  await Promise.resolve();
  const chains = [..._queues.values()].map((queue) => queue.chain);
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, Math.max(0, timeoutMs));
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  await Promise.race([Promise.all(chains), timeout]);
  if (timer) clearTimeout(timer);
  return getWriteStats();
}

function getWriteStats() {
  return {
    ..._writeStats,
    byCategory: { ..._writeStats.byCategory },
    pending: _pending.length,
    dirReady: _logDirReady,
    logDir: _logDir,
    sessionId: _sessionId,
    workspaceId: _workspaceId,
    seq: _seq,
    breadcrumbCount: _breadcrumbs.length,
    sessionStatus: _sessionStatus,
  };
}

// ============================================================
// 8. P3 崩溃闭环：黑匣子 / error 同步通道 / session 恢复 / 诊断包
// ============================================================

function _hashText(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 错误指纹：name + 归一化 message + 栈顶业务帧；同类错误聚合，不同消息不误并。 */
function _fingerprint(error) {
  const name = typeof error?.name === 'string' ? error.name : (typeof error === 'string' ? 'Error' : 'Error');
  const rawMessage = typeof error === 'string' ? error : String(error?.message ?? '');
  const message = rawMessage
    .replace(/[a-zA-Z]:[\\/][^\s"']+/g, '<path>')
    .replace(/\b0x[0-9a-f]+\b/gi, '0x0')
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  const frames = String(error?.stack ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const top = frames.find((frame) => !frame.startsWith('Error') && !frame.includes('node:internal')) ?? frames[0] ?? '';
  const frame = top
    .replace(/[a-zA-Z]:[\\/][^\s)]+/g, '<path>')
    .replace(/\b\d+:\d+\b/g, '#')
    .slice(0, 160);
  return `fp-${_hashText(`${name}|${message}|${frame}`)}`;
}

function _envSnapshot() {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    ...(process.versions?.electron ? { electron: process.versions.electron } : {}),
    ...(process.versions?.chrome ? { chrome: process.versions.chrome } : {}),
    ...(_appVersion ? { appVersion: _appVersion } : {}),
    pid: process.pid,
    sessionId: _sessionId,
    workspaceId: _workspaceId,
  };
}

/** dump 引用只留逻辑目录名与文件名，绝不落明文绝对路径（D3）。 */
function _dumpRef() {
  const ref = { available: false, dir: CRASH_DIR_NAME };
  // crashReporter 已 start 后切换目录不保证生效，故同时扫当前目录与启动兜底目录。
  const candidates = [];
  const add = (dir) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  };
  add(_crashDumpDir);
  if (_fallbackLogDir) add(path.join(_fallbackLogDir, CRASH_DIR_NAME));
  if (_logDir) add(path.join(_logDir, CRASH_DIR_NAME));
  let latest = null;
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const name of fs.readdirSync(dir).filter((item) => /\.dmp$/i.test(item))) {
        const stat = fs.statSync(path.join(dir, name));
        if (!latest || stat.mtimeMs > latest.mtimeMs) {
          latest = { name, size: stat.size, mtimeMs: stat.mtimeMs };
        }
      }
    } catch { /* 单个目录不可读不影响其它候选 */ }
  }
  if (!latest) return ref;
  return {
    available: true,
    dir: CRASH_DIR_NAME,
    file: latest.name,
    size: latest.size,
    createdAt: new Date(latest.mtimeMs).toISOString(),
  };
}

function _pushBreadcrumbBuffer(item) {
  if (_breadcrumbs.length < MAX_BREADCRUMBS) _breadcrumbs.push(item);
  else {
    _breadcrumbs[_breadcrumbIndex] = item;
    _breadcrumbWrapped = true;
  }
  _breadcrumbIndex = (_breadcrumbIndex + 1) % MAX_BREADCRUMBS;
}

function _recentBreadcrumbs(limit = BREADCRUMB_DUMP) {
  const ordered = _breadcrumbWrapped
    ? [..._breadcrumbs.slice(_breadcrumbIndex), ..._breadcrumbs.slice(0, _breadcrumbIndex)]
    : [..._breadcrumbs];
  return ordered.slice(-Math.max(1, limit));
}

/**
 * 接收渲染侧黑匣子的内存镜像。字段白名单 + 长度限制，防止 DevTools 伪造或把
 * 用户正文塞进面包屑。返回接纳条数；这里不写任何日志，也不落盘。
 */
function pushBreadcrumbs(payload) {
  if (!Array.isArray(payload)) return 0;
  let accepted = 0;
  for (const raw of payload.slice(0, BREADCRUMB_DUMP)) {
    if (!raw || typeof raw !== 'object') continue;
    const type = _shortString(raw.type, 24);
    if (!type) continue;
    const clean = {
      t: Number.isFinite(raw.t) ? Math.round(raw.t) : Date.now(),
      type,
      seq: Number.isFinite(raw.seq) ? Math.round(raw.seq) : _breadcrumbs.length + 1,
      ...(typeof raw.view === 'string' ? { view: _shortString(raw.view, 80) } : {}),
    };
    if (raw.target && typeof raw.target === 'object') {
      clean.target = {
        ...(typeof raw.target.tag === 'string' ? { tag: _shortString(raw.target.tag, 24) } : {}),
        ...(typeof raw.target.id === 'string' ? { id: _shortString(raw.target.id, 80) } : {}),
        ...(typeof raw.target.role === 'string' ? { role: _shortString(raw.target.role, 40) } : {}),
        // 控件文案只允许已经降级过的 [length:N] 摘要。
        ...(typeof raw.target.label === 'string' && raw.target.label.startsWith('[length:')
          ? { label: _shortString(raw.target.label, 40) } : {}),
      };
    }
    _pushBreadcrumbBuffer(clean);
    accepted += 1;
  }
  return accepted;
}

function getBreadcrumbs(limit = BREADCRUMB_DUMP) {
  return _recentBreadcrumbs(limit);
}

/** error 专属上下文只在服务端生成；渲染侧传同名字段会被 _validateEntry 丢弃。 */
function _enrichErrorEntry(entry) {
  entry.fingerprint = _fingerprint(entry.error || entry.message);
  entry.breadcrumbs = _recentBreadcrumbs(BREADCRUMB_DUMP);
  entry.dumpRef = _dumpRef();
  entry.env = _envSnapshot();
  return entry;
}

/**
 * P3：error 类独立同步句柄。绕开 queueMicrotask + Promise + fsp.appendFile 的异步链，
 * 保证 uncaughtException / render-process-gone 之后立刻可读；失败时降级到预缓冲重试，
 * 不与异步批量队列混写同一个 error 分片（避免行交错）。
 */
function _writeErrorSync(entry) {
  if (!_logDirReady || !_logDir) return false;
  try {
    const date = _dateStr(entry.timestamp);
    const target = _pickShard(date, 'error');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const line = _serializeEntry(entry);
    const before = _fileSize(target);
    fs.appendFileSync(target, line, 'utf8');
    _appendIndexRecords(target, before, [{ entry, line }]);
    const state = _shardState.get('error');
    if (state) state.bytes += Buffer.byteLength(line, 'utf8');
    _writeStats.written += 1;
    _writeStats.byCategory.error = (_writeStats.byCategory.error || 0) + 1;
    return true;
  } catch {
    _writeStats.failed += 1;
    // 不写 console（C6 冻结线零余量）：失败由 getWriteStats / 重试链路暴露。
    return false;
  }
}

function _dispatchEntry(entry, attempts) {
  if (entry.level === 'DEBUG') return false;
  if (entry.category === 'error') {
    if (_writeErrorSync(entry)) return true;
    if (attempts < MAX_WRITE_RETRIES) {
      _writeStats.retried += 1;
      _queuePending(entry, attempts + 1);
    } else {
      _writeStats.dropped += 1;
    }
    _scheduleRetry();
    return false;
  }
  _enqueueWrite(entry, attempts);
  return false;
}

// ----- session.json：固定写启动兜底目录，不随工作目录漂移（避免误报） -----

function _sessionPath() {
  return _fallbackLogDir ? path.join(_fallbackLogDir, SESSION_FILE_NAME) : null;
}

function _readSessionFile() {
  const file = _sessionPath();
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function _writeSessionFile(data) {
  const file = _sessionPath();
  if (!file) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data)}\n`, 'utf8');
    _sessionStatus = data.status;
    return true;
  } catch {
    return false;
  }
}

function _updateSessionFields(fields) {
  const current = _readSessionFile();
  if (!current) return false;
  return _writeSessionFile({ ...current, ...fields });
}

function _setSessionStatus(status, extra = {}) {
  const current = _readSessionFile() || {};
  return _writeSessionFile({ ...current, status, endedAt: new Date().toISOString(), ...extra });
}

function markSessionClean() {
  return _setSessionStatus('clean');
}

function markSessionCrashed(reason) {
  return _setSessionStatus('crashed', { crashReason: _shortString(String(reason || ''), 200) });
}

/** 上次会话 status=running 即视为异常退出；恢复报告走 error 同步通道必达。 */
function _initSession() {
  const previous = _readSessionFile();
  _sessionHistory = Array.isArray(previous?.history) ? previous.history.slice(-9) : [];
  if (previous && previous.status === 'running' && previous.sessionId && previous.sessionId !== _sessionId) {
    _recoveredFrom = previous;
    _sessionHistory.push({
      sessionId: previous.sessionId,
      startedAt: previous.startedAt,
      status: 'crashed',
      workspaceId: previous.workspaceId,
      pid: previous.pid,
    });
    _emitCrashRecovered(previous);
  } else if (previous && previous.sessionId) {
    _sessionHistory.push({
      sessionId: previous.sessionId,
      startedAt: previous.startedAt,
      status: previous.status || 'unknown',
      workspaceId: previous.workspaceId,
      pid: previous.pid,
    });
  }
  return _writeSessionFile({
    schema: 'topomind-session/1',
    status: 'running',
    sessionId: _sessionId,
    startedAt: _sessionStartedAt,
    workspaceId: _workspaceId,
    pid: process.pid,
    appVersion: _appVersion,
    history: _sessionHistory,
  });
}

// ----- 上次会话尾部事件：恢复报告的 breadcrumbs 来源 -----

/** 只读文件末尾，避免把 10MB 分片整份读进内存。 */
function _tailFile(file, maxBytes) {
  try {
    const size = fs.statSync(file).size;
    if (size <= 0) return [];
    const length = Math.min(size, maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(length);
    try {
      fs.readSync(fd, buf, 0, length, size - length);
    } finally {
      fs.closeSync(fd);
    }
    const lines = buf.toString('utf8').split('\n');
    if (size > length) lines.shift(); // 首行可能被从中间截断
    const out = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* 坏行跳过，不中断恢复 */ }
    }
    return out;
  } catch {
    return [];
  }
}

function _readRecentLogEntries(dir, limit = 50, categories = null) {
  if (!dir || !fs.existsSync(dir)) return [];
  const wanted = Array.isArray(categories) && categories.length > 0 ? new Set(categories) : null;
  const files = [];
  try {
    const dates = fs.readdirSync(dir).filter((name) => DAY_DIR_PATTERN.test(name)).sort().reverse().slice(0, 2);
    for (const date of dates) {
      const dayDir = path.join(dir, date);
      let isDir = false;
      try { isDir = fs.statSync(dayDir).isDirectory(); } catch { /* 已被清理 */ }
      if (!isDir) continue;
      for (const name of fs.readdirSync(dayDir)) {
        const match = CATEGORY_FILE_PATTERN.exec(name);
        if (!match) continue;
        if (wanted && !wanted.has(match[1])) continue;
        files.push(path.join(dayDir, name));
      }
    }
    if (!wanted) {
      for (const name of fs.readdirSync(dir)) {
        if (LOG_FILE_PATTERN.test(name)) files.push(path.join(dir, name));
      }
    }
  } catch { /* 目录不可读时返回空 */ }
  const all = [];
  for (const file of files) all.push(..._tailFile(file, DIAGNOSTIC_TAIL_BYTES));
  all.sort((a, b) => (Date.parse(a?.timestamp) || 0) - (Date.parse(b?.timestamp) || 0));
  return all.slice(-Math.max(1, limit));
}

/**
 * 恢复报告的面包屑：优先复用上次 error 日志里同步 dump 过的原始输入；
 * 不足时用上次会话已落盘的语义事件轨迹补齐（D2：原始输入本身已随进程消失）。
 */
function _recoveryBreadcrumbs(tail) {
  const fromErrors = [];
  for (const entry of tail) {
    if (Array.isArray(entry?.breadcrumbs)) fromErrors.push(...entry.breadcrumbs);
  }
  const mapped = tail.map((entry, index) => ({
    t: Date.parse(entry?.timestamp) || Date.now(),
    type: 'log',
    seq: index + 1,
    view: entry?.category || 'internal',
    target: {
      tag: String(entry?.action || entry?.module || 'log').slice(0, 40),
      label: `[length:${String(entry?.message || '').length}]`,
    },
  }));
  return [...fromErrors, ...mapped].slice(-BREADCRUMB_DUMP);
}

function _emitCrashRecovered(previous) {
  const tail = _readRecentLogEntries(_fallbackLogDir, BREADCRUMB_DUMP);
  for (const crumb of _recoveryBreadcrumbs(tail)) _pushBreadcrumbBuffer(crumb);
  write({
    level: 'ERROR',
    module: 'app',
    action: 'app.crash_recovered',
    message: '检测到上次会话异常退出',
    error: {
      name: 'AbnormalExit',
      message: `上次会话 ${previous.sessionId} 未正常结束`,
      stack: 'AbnormalExit: session.json status=running',
    },
    params: {
      previousSessionId: previous.sessionId,
      previousStartedAt: previous.startedAt,
      previousWorkspaceId: previous.workspaceId,
      previousPid: previous.pid,
      tailCount: tail.length,
      recoverySource: 'previous-session-logs',
    },
  });
}

// ----- 一键诊断包：四类日志 + 指纹聚合 + dump/env/session + 双目录汇总 -----

function _sanitizeDiagnosticEntry(entry) {
  const out = { ...entry };
  delete out._readOrder;
  out.params = entry.params ? redactParamsDeep(entry.params) : null;
  out.meta = entry.meta ? redactParamsDeep(entry.meta) : null;
  out.target = entry.target ? redactParamsDeep(entry.target) : null;
  if (out.error) {
    out.error = typeof out.error === 'string'
      ? _shortString(out.error, MAX_MESSAGE_LENGTH)
      : redactParamsDeep({ error: out.error }).error;
  }
  if (Array.isArray(out.breadcrumbs)) {
    out.breadcrumbs = out.breadcrumbs.slice(-BREADCRUMB_DUMP).map((crumb) => ({
      t: crumb?.t,
      type: crumb?.type,
      seq: crumb?.seq,
      view: crumb?.view,
      ...(crumb?.target ? { target: crumb.target } : {}),
    }));
  }
  // D3：中文动作名可能含文档标题，导出前降级为长度摘要。
  if (typeof out.label === 'string') out.label = `[length:${out.label.length}]`;
  if (typeof out.message === 'string') {
    out.message = _shortString(
      out.message.replace(/[a-zA-Z]:[\\/][^\s"']+/g, (match) => path.basename(match.replace(/\\/g, '/'))),
      MAX_MESSAGE_LENGTH,
    );
  }
  return out;
}

function _diagnosticDirectory(dir, role) {
  if (!dir || !fs.existsSync(dir)) {
    return { role, workspaceId: _hashWorkspace(dir || role), available: false, dates: [], fileCount: 0 };
  }
  const dates = [];
  let fileCount = 0;
  try {
    for (const name of fs.readdirSync(dir).sort().reverse().slice(0, 60)) {
      const full = path.join(dir, name);
      if (DAY_DIR_PATTERN.test(name) && fs.statSync(full).isDirectory()) {
        dates.push(name);
        fileCount += fs.readdirSync(full).filter((file) => CATEGORY_FILE_PATTERN.test(file)).length;
      } else if (LOG_FILE_PATTERN.test(name)) {
        fileCount += 1;
      }
    }
  } catch { /* 目录不可读 */ }
  return { role, workspaceId: _hashWorkspace(dir), available: true, dates: dates.slice(0, 7), fileCount };
}

function exportDiagnosticBundle() {
  const currentDir = _logDirReady && _logDir ? _logDir : null;
  const fallbackDiffers = Boolean(
    _fallbackLogDir && (!currentDir || path.resolve(_fallbackLogDir) !== path.resolve(currentDir)),
  );
  const logs = {};
  const errorIndex = new Map();
  // §0.1：D5 下当前工作目录与启动兜底目录都可能留有同会话日志，error 必须双目录汇总。
  const fallbackErrorEntries = fallbackDiffers
    ? _readRecentLogEntries(_fallbackLogDir, DIAGNOSTIC_MAX_PER_CATEGORY, ['error'])
        .filter((entry) => _resolveCategory(entry) === 'error')
    : [];
  for (const category of LOG_CATEGORY_IDS) {
    let entries = _readRecentLogEntries(currentDir, DIAGNOSTIC_MAX_PER_CATEGORY, [category])
      .filter((entry) => _resolveCategory(entry) === category);
    if (category === 'error' && fallbackErrorEntries.length > 0) {
      entries = [...entries, ...fallbackErrorEntries]
        .sort((a, b) => (Date.parse(a?.timestamp) || 0) - (Date.parse(b?.timestamp) || 0))
        .slice(-DIAGNOSTIC_MAX_PER_CATEGORY);
    }
    logs[category] = entries.map(_sanitizeDiagnosticEntry);
    if (category !== 'error') continue;
    for (const entry of entries) {
      const fingerprint = typeof entry.fingerprint === 'string'
        ? entry.fingerprint
        : _fingerprint(entry.error || entry.message);
      const row = errorIndex.get(fingerprint) ?? { fingerprint, count: 0, lastSeen: null, sample: null };
      row.count += 1;
      if (!row.lastSeen || String(entry.timestamp || '') > row.lastSeen) {
        row.lastSeen = entry.timestamp ?? null;
        row.sample = _sanitizeDiagnosticEntry(entry).error ?? null;
      }
      errorIndex.set(fingerprint, row);
    }
  }
  const bundle = {
    schema: 'topomind-diagnostic-bundle/1',
    generatedAt: new Date().toISOString(),
    session: { ...getSessionInfo(), file: _readSessionFile() },
    env: _envSnapshot(),
    dumpRef: _dumpRef(),
    directories: [
      _diagnosticDirectory(currentDir, 'current'),
      ...(fallbackDiffers ? [_diagnosticDirectory(_fallbackLogDir, 'fallback')] : []),
    ],
    logs,
    fallbackErrors: fallbackDiffers ? fallbackErrorEntries.map(_sanitizeDiagnosticEntry) : [],
    errors: [...errorIndex.values()].sort((a, b) => b.count - a.count),
    breadcrumbs: _recentBreadcrumbs(BREADCRUMB_DUMP),
    writeStats: getWriteStats(),
    notes: [
      '导出前已对 params/meta/target/error/label 二次脱敏；message 是模板摘要。',
      '原始输入事件（D2）平时只进内存，仅 error 日志与恢复报告携带 breadcrumbs。',
      '日志主仓按 D5 落在工作目录；诊断包同时汇总当前目录与启动兜底目录。',
    ],
  };
  write({
    level: 'INFO', module: 'app', action: 'app.diagnostic_export',
    message: '导出诊断包', params: { categoryCount: LOG_CATEGORY_IDS.length },
  });
  return JSON.stringify(bundle, null, 2);
}

export default {
  init,
  enterWorkDir,
  leaveWorkDir,
  getCurrentWorkDir,
  write,
  getLogDir,
  getSessionInfo,
  getAvailableDates,
  getBuffer,
  query,
  exportJsonl,
  setLevel,
  getLevel,
  clearBuffer,
  drain,
  getWriteStats,
  // P4 查询索引
  getQueryStats,
  // P3 崩溃闭环
  pushBreadcrumbs,
  getBreadcrumbs,
  markSessionClean,
  markSessionCrashed,
  exportDiagnosticBundle,
};
