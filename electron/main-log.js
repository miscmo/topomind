/**
 * 主进程内部事件的日志适配器。
 *
 * 规范 §3.5：禁止在 main.js 里散落 LogService.write。主进程事件（工作目录、
 * 崩溃、console-message 等）统一经本模块，完成路径脱敏与异常结构化后写入。
 *
 * 主进程是 CJS 边界，无法 import TS 契约；脱敏规则统一由 electron/log-redact.js
 * 维护（与 log-service 的 IPC 入口共用一份实现），由 verify-logging.mts 的 C8
 * 行为用例与渲染侧契约 redactParams 交叉校验口径。
 */
import LogService from './log-service.js';
import { redactParamsDeep } from './log-redact.js';

/** 兼容既有调用方：主进程参数清洗委托给唯一实现。 */
export const redactMainParams = redactParamsDeep;

function normalizeMainError(error) {
  if (!error) return undefined;
  if (error instanceof Error) {
    return { name: error.name || 'Error', message: error.message || String(error), stack: error.stack };
  }
  if (typeof error === 'string') return { name: 'Error', message: error };
  if (typeof error === 'object' && 'message' in error) {
    return {
      name: typeof error.name === 'string' ? error.name : 'Error',
      message: String(error.message ?? ''),
      ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    };
  }
  return { name: 'Error', message: String(error) };
}

function emit(level, module, message, params, error, action) {
  return LogService.write({
    level,
    module,
    message,
    params: redactMainParams(params),
    ...(error ? { error: normalizeMainError(error) } : {}),
    ...(action ? { action } : {}),
  });
}

export const mainLog = {
  debug(module, message, params = {}, action) {
    return emit('DEBUG', module, message, params, undefined, action);
  },
  info(module, message, params = {}, action) {
    return emit('INFO', module, message, params, undefined, action);
  },
  warn(module, message, params = {}, error, action) {
    return emit('WARN', module, message, params, error, action);
  },
  error(module, message, params = {}, error, action) {
    return emit('ERROR', module, message, params, error, action);
  },
};

/**
 * P2 主进程生命周期埋点（v3 §4）。
 * 显式给 category / source / outcome，让这些条目稳定落到 internal 类；
 * phase 同时写进 message 与 params，便于按阶段筛选。
 */
export function mainLifecycle(phase, params = {}, action = 'app.lifecycle') {
  return LogService.write({
    level: 'INFO',
    category: 'internal',
    module: 'app',
    action,
    label: action === 'app.quit' ? '应用退出' : '应用生命周期',
    message: phase,
    source: 'main',
    outcome: phase,
    params: redactMainParams({ phase, ...params }),
  });
}

export default mainLog;
