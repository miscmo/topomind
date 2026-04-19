/**
 * 日志服务 (Electron Main Process)
 *
 * 职责：
 * 1. 初始化 logs/ 目录（与应用工作目录平级）
 * 2. 按日期分文件存储日志（JSON Lines 格式）
 * 3. 维护内存环形缓冲区（最新 2000 条）
 * 4. 异步写入文件，不阻塞主线程
 * 5. 响应 renderer 发来的日志 IPC 请求
 */

import { ipcMain, app } from 'electron';
import path from 'path';
import fs from 'fs';

// ============================================================
// 1. 配置
// ============================================================

/** 日志目录名称（与工作目录平级） */
const LOG_DIR_NAME = 'logs';

/** 环形缓冲区最大容量 */
const MAX_BUFFER_SIZE = 2000;

/** 单个日志文件最大字节数（10MB） */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// ============================================================
// 2. 状态
// ============================================================

/** logs/ 目录路径 */
let _logDir = null;

/** 日志缓冲区（环形数组） */
let _buffer = [];

/** 缓冲区索引（指向下一条写入位置） */
let _bufferIndex = 0;

/** 是否已填满一轮（用于判断 _bufferIndex 的含义） */
let _bufferWrapped = false;

/** 当前写入的文件路径 */
let _currentLogFile = null;

/** 当前文件已写入字节数 */
let _currentFileBytes = 0;

/** 当前日期（用于检测日期变更） */
let _currentDate = null;

/** 日志等级过滤 */
let _minLevel = 1; // 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR

const LEVEL_MAP = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// ============================================================
// 3. 初始化
// ============================================================

/**
 * 初始化日志服务
 * @param {string} workDir - 应用工作目录（日志目录将创建在其平级）
 */
function init(workDir) {
  _logDir = path.join(workDir, '..', LOG_DIR_NAME);
  _ensureLogDir();
  _initTodayFile();
  _registerIpcHandlers();
  write({
    level: 'INFO',
    module: 'LogService',
    action: 'app:start',
    message: `日志服务初始化，logDir=${_logDir}`,
    params: { workDir, platform: process.platform, version: app.getVersion() },
    meta: { platform: process.platform, version: app.getVersion() },
  });
}

/**
 * 确保日志目录存在
 */
function _ensureLogDir() {
  if (!_logDir) return;
  if (!fs.existsSync(_logDir)) {
    fs.mkdirSync(_logDir, { recursive: true });
  }
}

/**
 * 初始化今天的日志文件
 */
function _initTodayFile() {
  const today = _getDateStr();
  _currentDate = today;
  _currentLogFile = _getLogFilePath(today);
  _currentFileBytes = 0;

  if (fs.existsSync(_currentLogFile)) {
    try {
      const stat = fs.statSync(_currentLogFile);
      _currentFileBytes = stat.size;
    } catch (e) {
      _currentFileBytes = 0;
    }
  }
}

/**
 * 获取今天的日期字符串
 */
function _getDateStr() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 获取指定日期的日志文件路径
 * @param {string} dateStr - 日期字符串 YYYY-MM-DD
 */
function _getLogFilePath(dateStr) {
  return path.join(_logDir, `${dateStr}.log`);
}

/**
 * 获取带序号的新日志文件路径（轮转时使用）
 */
function _getNextLogFilePath(dateStr) {
  let seq = 1;
  let filePath;
  do {
    filePath = seq === 1
      ? _getLogFilePath(dateStr)
      : path.join(_logDir, `${dateStr}.${seq}.log`);
    seq++;
  } while (fs.existsSync(filePath) && seq < 1000);
  return filePath;
}

// ============================================================
// 4. 日志写入
// ============================================================

/**
 * 写入一条日志
 * @param {object} entry - 日志条目
 */
function write(entry) {
  // 检查日期是否变更
  const today = _getDateStr();
  if (today !== _currentDate) {
    _initTodayFile();
  }

  // 补充字段
  const now = new Date();
  const timestamp = now.toISOString();
  const id = `${timestamp.replace(/[-:T.Z]/g, '')}${_randomId()}@topomind`;

  const fullEntry = {
    id,
    timestamp,
    level: entry.level || 'INFO',
    module: entry.module || 'Unknown',
    file: entry.file || '',
    line: entry.line || 0,
    func: entry.func || '',
    action: entry.action || '',
    message: entry.message || '',
    params: entry.params || null,
    traceId: entry.traceId || null,
    spanId: entry.spanId || null,
    parentId: entry.parentId || null,
    meta: entry.meta || null,
  };

  // 检查日志等级过滤
  const entryLevel = LEVEL_MAP[fullEntry.level] ?? 1;
  if (entryLevel < _minLevel) return;

  // 写入缓冲区
  _pushToBuffer(fullEntry);

  // 异步写入文件
  _writeToFile(fullEntry);

  // 广播给订阅者
  _broadcast(fullEntry);
}

/**
 * 生成随机 ID 片段
 */
function _randomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

/**
 * 推入环形缓冲区
 */
function _pushToBuffer(entry) {
  if (_buffer.length < MAX_BUFFER_SIZE) {
    _buffer.push(entry);
  } else {
    _buffer[_bufferIndex] = entry;
  }
  _bufferIndex = (_bufferIndex + 1) % MAX_BUFFER_SIZE;
}

/**
 * 异步写入文件（JSON Lines）
 */
function _writeToFile(entry) {
  const line = JSON.stringify(entry) + '\n';
  const lineBytes = Buffer.byteLength(line, 'utf8');

  // 检查文件大小限制
  if (_currentFileBytes + lineBytes > MAX_FILE_SIZE_BYTES) {
    _currentLogFile = _getNextLogFilePath(_currentDate);
    _currentFileBytes = 0;
  }

  fs.appendFile(_currentLogFile, line, { encoding: 'utf8' }, (err) => {
    if (err) {
      console.error('[LogService] Failed to write log:', err);
      return;
    }
    _currentFileBytes += lineBytes;
  });
}

// ============================================================
// 5. IPC 广播
// ============================================================

/** 活跃的订阅者 ID 集合 */
const _subscribers = new Set();

/** IPC handlers 是否已注册 */
let _ipcHandlersRegistered = false;

/**
 * 注册 IPC handlers（仅 subscriber 相关，核心日志读写由 main.js 处理）
 */
function _registerIpcHandlers() {
  if (_ipcHandlersRegistered) return;
  _ipcHandlersRegistered = true;

  ipcMain.on('log:subscribe', (event) => {
    _subscribers.add(event.sender.id);
  });

  ipcMain.on('log:unsubscribe', (event) => {
    _subscribers.delete(event.sender.id);
  });
}

/**
 * 广播日志给所有订阅者
 */
function _broadcast(entry) {
  for (const senderId of _subscribers) {
    const sender = ipcMain.webContentsFromId(senderId);
    if (sender && !sender.isDestroyed()) {
      sender.send('log:entry', entry);
    }
  }
}

/**
 * 关键词匹配
 */
function _matchesKeyword(entry, keyword) {
  const lower = keyword.toLowerCase();
  return (
    (entry.message || '').toLowerCase().includes(lower) ||
    (entry.action || '').toLowerCase().includes(lower) ||
    (entry.module || '').toLowerCase().includes(lower) ||
    (entry.func || '').toLowerCase().includes(lower)
  );
}

/**
 * 获取日志目录路径
 */
function getLogDir() {
  return _logDir;
}

/**
 * 获取当前缓冲区内容（按时间顺序）
 */
function getBuffer() {
  if (_bufferWrapped) {
    const tail = _buffer.slice(_bufferIndex);
    const head = _buffer.slice(0, _bufferIndex);
    return [...tail, ...head];
  }
  return [..._buffer];
}

/**
 * 查询日志文件
 * @param {object} filters - { dateStr, keyword, levels, actions, startTime, endTime }
 */
function query({ dateStr, keyword, levels, actions, startTime, endTime } = {}) {
  const results = [];
  const logFile = dateStr ? _getLogFilePath(dateStr) : null;

  if (!logFile || !fs.existsSync(logFile)) return results;

  try {
    const content = fs.readFileSync(logFile, 'utf8');
    content.split('\n').forEach(line => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line);
        if (keyword && !_matchesKeyword(entry, keyword)) return;
        if (levels && levels.length > 0 && !levels.includes(entry.level)) return;
        if (actions && actions.length > 0 && !actions.includes(entry.action)) return;
        if (startTime && entry.timestamp < startTime) return;
        if (endTime && entry.timestamp > endTime) return;
        results.push(entry);
      } catch (e) {
        // 忽略解析失败的行
      }
    });
  } catch (e) {
    // 文件不存在或读取失败
  }
  return results;
}

/**
 * 清除缓冲区
 */
function clear() {
  _buffer = [];
  _bufferIndex = 0;
  _bufferWrapped = false;
}

/**
 * 设置日志等级
 * @param {string|number} level - 'DEBUG'|'INFO'|'WARN'|'ERROR' 或 0-3
 */
function setLevel(level) {
  if (LEVEL_MAP[level] !== undefined) {
    _minLevel = LEVEL_MAP[level];
    return true;
  }
  if (typeof level === 'number' && level >= 0 && level <= 3) {
    _minLevel = level;
    return true;
  }
  return false;
}

/**
 * 获取可用日期列表（返回 logs/ 目录下的 .log 文件日期）
 */
function getAvailableDates() {
  if (!_logDir || !fs.existsSync(_logDir)) return [];
  try {
    const files = fs.readdirSync(_logDir);
    return files
      .filter(f => /^(\d{4}-\d{2}-\d{2})(\.log|\.\d+\.log)?$/.test(f))
      .map(f => f.replace(/\.\d+\.log$/, ''))
      .filter((v, i, a) => a.indexOf(v) === i) // 去重
      .sort()
      .reverse(); // 最新的在前
  } catch (e) {
    return [];
  }
}

export default { init, write, getLogDir, getAvailableDates, getBuffer, query, setLevel, clear };
