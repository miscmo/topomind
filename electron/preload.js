/**
 * Electron 预加载脚本
 * 暴露统一的 IPC invoke 接口给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron';

// IPC 通道白名单，只允许渲染进程调用这些通道
const ALLOWED_CHANNELS = new Set([
  // fs
  'fs:listKBs', 'fs:listTrashKBs', 'fs:restoreTrashKB', 'fs:clearTrashKBs', 'fs:readCardChildren', 'fs:createKbsDir', 'fs:deleteKbsDir',
  'fs:readGraphMeta', 'fs:readRoomNodeSummaries', 'fs:writeGraphMeta',
  'fs:renameKB',
  'fs:listAllTrashItems', 'fs:restoreGlobalTrashItem', 'fs:clearAllTrashItems',
  'fs:listTopoDocuments', 'fs:createTopoDocument', 'fs:readTopoDocument', 'fs:writeTopoDocument', 'fs:renameTopoDocument', 'fs:updateTopoDocumentMeta', 'fs:deleteTopoDocument', 'fs:listTrashTopoDocuments', 'fs:restoreTrashTopoDocument', 'fs:clearTrashTopoDocuments', 'fs:repairTopoDocuments', 'fs:exportTopoDocument', 'fs:openTopoDocumentFolder', 'fs:moveTopoDocument', 'fs:moveTopoDocumentToCard', 'fs:moveTopoNodesToRoom', 'fs:listDocumentCandidates', 'fs:resolveDocumentById', 'fs:updateNodeLinkedDocuments', 'fs:listDocumentBacklinks', 'fs:listDocumentRelations',
  'fs:listRoomNodeTargets',
  // CardSpec 容器媒体资源（主进程校验路径后返回 URL / 导入 _docs/assets/）
  'fs:resolveCardAssetUrl', 'fs:importCardAsset', 'fs:importImageAsset',
  'fs:listUnifiedTreeLevel', 'fs:searchUnifiedDocuments', 'fs:resolveUnifiedDocumentPath',
  'fs:writeAttachmentBase64', 'fs:downloadAttachment', 'fs:readAttachmentDataUrl', 'fs:listAttachments', 'fs:importAttachment', 'fs:deleteAttachment', 'fs:listTrashAttachments', 'fs:restoreTrashAttachment', 'fs:clearTrashAttachments', 'fs:openAttachment', 'fs:showAttachmentInFolder', 'fs:getAttachmentAbsoluteUrl',
  'fs:readAppConfig', 'fs:writeAppConfig', 'fs:readLearningStatsData', 'fs:readAllLearningStatsData', 'fs:writeLearningStatsData', 'fs:readLearningStatsSummary',
  'fs:isValidWorkDir', 'fs:selectDirectory', 'fs:createWorkDir', 'fs:importKB',
  // app
  'app:openExternal',
  'app:navigateHome',
  'app:enterWorkDir',
  'app:switchWorkDir',
  'app:openFileDialog',
  'app:window:getState',
  'app:window:minimize',
  'app:window:toggleMaximize',
  'app:window:toggleDevTools',
  'app:window:close',
  // log
  'log:write', 'log:getBuffer', 'log:query', 'log:setLevel', 'log:getLevel',
  'log:clearBuffer', 'log:getAvailableDates', 'log:getLogDir', 'log:export',
  // P3：一键诊断包（主进程二次脱敏 + 双目录汇总后返回 JSON 字符串）
  'log:exportBundle',
  // AI（P0）：配置 / 密钥 / 测试连接 / 启动会话；密钥只在主进程解密
  'ai:config:get', 'ai:config:save', 'ai:chat:test', 'ai:chat:start',
  // AI（S1）：智能体定义读 / 写，独立 agents.json，不含任何连接配置
  'ai:agents:get', 'ai:agents:set',
  // AI（P3 / D）：本地简版 RAG 检索；只走主进程本地磁盘，不发起外部网络请求
  'ai:index:query',
]);

const ALLOWED_SEND_CHANNELS = new Set([
  'app:close-guard:response',
  'log:subscribe',
  'log:unsubscribe',
  // P3：原始输入黑匣子的内存镜像，主进程只进内存缓冲、绝不落盘
  'log:breadcrumbs',
  // AI（P0）：取消当前流式会话（send 通道不触发 invoke 审计）
  'ai:chat:cancel',
]);

const ALLOWED_RECEIVE_CHANNELS = new Set([
  'app:close-guard:request',
  'app:menu-action',
  'app:reset-session',
  'app:window-state-change',
  'log:entry',
  'log:level',
  // AI（P0）：主进程推送的流式 token / 结束 / 错误，不走高频 invoke
  'ai:chat:chunk', 'ai:chat:done', 'ai:chat:error',
]);

// preload loaded — intentionally silent (no console output in production)

// ---------------------------------------------------------------------------
// P2 IPC 单点审计（observability-v3-plan.md §4）
//
// 所有渲染侧 invoke 都经过这里，一次覆盖 82 个业务通道，不需要 fs-backend
// 或业务代码再埋点。三条硬约束：
//  1. `log:*` 通道显式排除，否则 log:write -> IPC -> 审计 -> log:write 无限递归；
//  2. 审计日志直接走 ipcRenderer，不经过暴露给渲染进程的 invoke 包装函数；
//  3. 正常调用只按分钟聚合成一条 ipc.audit，失败/慢调用才即时记明细，
//     避免 1s 轮询之类的高频通道把日志刷成洪水。
// ---------------------------------------------------------------------------
var AUDIT_LOG_PREFIX = 'log:';
var AUDIT_WINDOW_MS = 60000;
var AUDIT_SLOW_MS = 500;
var AUDIT_MAX_CHANNELS = 30;

var auditSession = 'ipc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
var auditSeq = 0;
var rendererTraceId = null;
var auditWindowStart = Date.now();
var auditTotals = { calls: 0, failures: 0 };
var auditByChannel = new Map();

function nextAuditTraceId() {
  auditSeq += 1;
  return auditSession + ':' + auditSeq;
}

function auditEntry(action, level, params, durationMs, outcome, traceId) {
  // P5：traceId === null 表示「显式独立」。60s 聚合汇总横跨几十次用户操作，
  // 强行挂到最近一次点击的链路上会伪造因果，因此不写 traceId 字段。
  var resolvedTrace = traceId === null ? null : (traceId || rendererTraceId || nextAuditTraceId());
  var entry = {
    v: 3,
    level: level,
    category: 'internal',
    module: 'app',
    action: action,
    label: action === 'ipc.invoke' ? 'IPC 调用明细' : 'IPC 调用汇总',
    message: action === 'ipc.invoke' ? 'IPC 调用明细' : 'IPC 调用汇总',
    source: 'preload',
    outcome: outcome,
    result: outcome,
    durationMs: durationMs,
    params: params,
  };
  if (resolvedTrace) entry.traceId = resolvedTrace;
  return entry;
}

/** 审计写入失败绝不影响业务调用，也不允许再触发一次审计。 */
function auditWrite(entry) {
  try {
    var pending = ipcRenderer.invoke('log:write', entry);
    if (pending && typeof pending.catch === 'function') pending.catch(function () {});
  } catch {
    // 审计通道自身不可用时静默降级。
  }
}

function auditFlush(now) {
  var elapsed = now - auditWindowStart;
  auditWindowStart = now;
  if (auditTotals.calls === 0) return;
  var rows = Array.from(auditByChannel.values()).sort(function (a, b) { return b.calls - a.calls; });
  var channels = rows.slice(0, AUDIT_MAX_CHANNELS).map(function (stat) {
    return {
      channel: stat.channel,
      calls: stat.calls,
      avgMs: Math.round(stat.totalMs / stat.calls),
      maxMs: stat.maxMs,
      failures: stat.failures,
    };
  });
  var params = {
    windowMs: elapsed,
    totalCalls: auditTotals.calls,
    failures: auditTotals.failures,
    distinctChannels: rows.length,
    channels: channels,
  };
  if (rows.length > AUDIT_MAX_CHANNELS) params.otherChannels = rows.length - AUDIT_MAX_CHANNELS;
  auditWrite(auditEntry(
    'ipc.audit', 'INFO', params, elapsed,
    auditTotals.failures > 0 ? 'partial' : 'success',
    null,
  ));
  auditByChannel.clear();
  auditTotals.calls = 0;
  auditTotals.failures = 0;
}

function auditRecord(channel, durationMs, failed, traceId) {
  var now = Date.now();
  var stat = auditByChannel.get(channel);
  if (!stat) {
    stat = { channel: channel, calls: 0, totalMs: 0, maxMs: 0, failures: 0 };
    auditByChannel.set(channel, stat);
  }
  stat.calls += 1;
  stat.totalMs += durationMs;
  if (durationMs > stat.maxMs) stat.maxMs = durationMs;
  if (failed) stat.failures += 1;
  auditTotals.calls += 1;
  if (failed) auditTotals.failures += 1;

  if (failed || durationMs >= AUDIT_SLOW_MS) {
    auditWrite(auditEntry(
      'ipc.invoke', failed ? 'WARN' : 'INFO',
      { channel: channel, reason: failed ? 'rejected' : 'slow', thresholdMs: AUDIT_SLOW_MS },
      durationMs, failed ? 'failure' : 'slow', traceId,
    ));
  }
  if (now - auditWindowStart >= AUDIT_WINDOW_MS) auditFlush(now);
}

const listenerMap = new Map();

function getChannelListenerMap(channel) {
  var channelMap = listenerMap.get(channel);
  if (!channelMap) {
    channelMap = new WeakMap();
    listenerMap.set(channel, channelMap);
  }
  return channelMap;
}

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  /**
   * 渲染侧当前操作的 traceId 镜像。只改 preload 闭包变量，不发起 IPC，
   * 因此不会触发本文件的审计逻辑（P2 因果链跨进程透传）。
   */
  setTraceContext: function(traceId) {
    rendererTraceId = typeof traceId === 'string' && traceId ? traceId : null;
  },
  invoke: function(channel) {
    if (!ALLOWED_CHANNELS.has(channel)) {
      return Promise.reject(new Error('IPC 通道不在白名单中: ' + channel));
    }
    var args = Array.prototype.slice.call(arguments, 1);
    var audited = !channel.startsWith(AUDIT_LOG_PREFIX);
    var startedAt = audited ? Date.now() : 0;
    var traceId = audited ? (rendererTraceId || nextAuditTraceId()) : null;
    var promise = ipcRenderer.invoke.apply(ipcRenderer, [channel].concat(args));
    if (!audited) return promise;
    return promise.then(
      function(value) {
        auditRecord(channel, Date.now() - startedAt, false, traceId);
        return value;
      },
      function(err) {
        auditRecord(channel, Date.now() - startedAt, true, traceId);
        throw err;
      }
    );
  },
  send: function(channel) {
    if (!ALLOWED_SEND_CHANNELS.has(channel)) {
      console.error('[preload] send 通道不在白名单中:', channel);
      return;
    }
    var args = Array.prototype.slice.call(arguments, 1);
    ipcRenderer.send.apply(ipcRenderer, [channel].concat(args));
  },
  on: function(channel, fn) {
    if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
      console.warn('[preload] 忽略未授权的监听通道:', channel);
      return;
    }
    if (typeof fn !== 'function') {
      console.warn('[preload] on 需要函数回调:', channel);
      return;
    }
    var channelMap = getChannelListenerMap(channel);
    if (channelMap.has(fn)) {
      return;
    }
    var wrapped = function() {
      var args = Array.prototype.slice.call(arguments, 1);
      fn.apply(null, args);
    };
    channelMap.set(fn, wrapped);
    ipcRenderer.on(channel, wrapped);
  },
  off: function(channel, fn) {
    if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
      console.warn('[preload] 忽略未授权的移除通道:', channel);
      return;
    }
    if (typeof fn !== 'function') {
      return;
    }
    var channelMap = getChannelListenerMap(channel);
    var wrapped = channelMap.get(fn);
    if (!wrapped) {
      return;
    }
    ipcRenderer.off(channel, wrapped);
    channelMap.delete(fn);
  }
});
