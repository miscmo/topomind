/**
 * Electron 预加载脚本
 * 暴露统一的 IPC invoke 接口给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron';

// IPC 通道白名单，只允许渲染进程调用这些通道
const ALLOWED_CHANNELS = new Set([
  // fs
  'fs:listKBs', 'fs:listTrashKBs', 'fs:restoreTrashKB', 'fs:clearTrashKBs', 'fs:readCardChildren', 'fs:createKbsDir', 'fs:createCardDir', 'fs:deleteKbsDir',
  'fs:readGraphMeta', 'fs:writeGraphMeta',
  'fs:renameKB',
  'fs:listTopoDocuments', 'fs:createTopoDocument', 'fs:readTopoDocument', 'fs:writeTopoDocument', 'fs:renameTopoDocument', 'fs:deleteTopoDocument', 'fs:listTrashTopoDocuments', 'fs:restoreTrashTopoDocument', 'fs:clearTrashTopoDocuments', 'fs:repairTopoDocuments', 'fs:exportTopoDocument', 'fs:openTopoDocumentFolder', 'fs:moveTopoDocument',
  'fs:writeAttachmentBase64', 'fs:downloadAttachment', 'fs:readAttachmentDataUrl', 'fs:listAttachments', 'fs:importAttachment', 'fs:deleteAttachment', 'fs:listTrashAttachments', 'fs:restoreTrashAttachment', 'fs:clearTrashAttachments', 'fs:openAttachment', 'fs:showAttachmentInFolder', 'fs:getAttachmentAbsoluteUrl',
  'fs:readAppConfig', 'fs:writeAppConfig', 'fs:readLearningStatsData', 'fs:readAllLearningStatsData', 'fs:writeLearningStatsData', 'fs:readLearningStatsSummary',
  'fs:isValidWorkDir', 'fs:selectDirectory', 'fs:createWorkDir', 'fs:importKB',
  // local cache skeleton
  'localdb:init', 'localdb:health', 'localdb:getPaths', 'localdb:applyBootstrap', 'localdb:applySyncPull',
  'localdb:applySyncPushResult',
  'localdb:getWorkspaceSnapshot', 'localdb:listKnowledgeBases',
  'localdb:updateKnowledgeBase', 'localdb:deleteKnowledgeBase', 'localdb:restoreKnowledgeBase', 'localdb:purgeKnowledgeBase',
  'localdb:createCard', 'localdb:getCard', 'localdb:updateCard', 'localdb:deleteCard', 'localdb:restoreCard', 'localdb:purgeCard',
  'localdb:createDocument', 'localdb:updateDocument', 'localdb:deleteDocument', 'localdb:restoreDocument', 'localdb:purgeDocument',
  'localdb:deleteAttachment', 'localdb:restoreAttachment', 'localdb:purgeAttachment',
  'localdb:listPendingOutbox', 'localdb:markOutboxItemSending', 'localdb:markOutboxItemFailed',
  'localdb:recordSyncPushConflict', 'localdb:listSyncConflicts',
  'localdb:updateDocumentContent', 'localdb:listAttachmentsByCard',
  'localdb:getDocument', 'localdb:getGraphLayout', 'localdb:updateGraphLayout',
  'filecache:init', 'filecache:health', 'filecache:getCloudAttachmentLocalUrl', 'filecache:openCloudAttachment', 'filecache:showCloudAttachmentInFolder',
  'cloud:setSession', 'cloud:clearSession',
  'attachment:health',
  'import:health', 'import:startImportJob', 'import:getImportJob',
  'sync-debug:health', 'sync-debug:getSnapshot', 'sync-debug:listOutboxItems', 'sync-debug:listConflicts',
  'sync-debug:listAttachmentJobs', 'sync-debug:listImportJobs',
  'sync-debug:retryAttachmentJob', 'sync-debug:resumeImportJob',
  'sync-debug:retryOutboxItem', 'sync-debug:resolveConflictUseLocal',
  // app
  'app:openExternal',
  'app:openPath',
  'app:showItemInFolder',
  'app:navigateHome',
  'app:enterWorkDir',
  'app:switchWorkDir',
  'app:getFileInfo',
  'app:openFileDialog',
  'app:window:getState',
  'app:window:minimize',
  'app:window:toggleMaximize',
  'app:window:toggleDevTools',
  'app:window:close',
  // log
  'log:write', 'log:getBuffer', 'log:query', 'log:setLevel', 'log:clear',
  'log:getAvailableDates', 'log:getLogDir',
]);

const ALLOWED_SEND_CHANNELS = new Set([
  'log:subscribe',
  'log:unsubscribe',
]);

const ALLOWED_RECEIVE_CHANNELS = new Set([
  'app:menu-action',
  'app:reset-session',
  'app:window-state-change',
  'log:entry',
]);

// preload loaded — intentionally silent (no console output in production)

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
  invoke: function(channel) {
    if (!ALLOWED_CHANNELS.has(channel)) {
      return Promise.reject(new Error('IPC 通道不在白名单中: ' + channel));
    }
    var args = Array.prototype.slice.call(arguments, 1);
    return ipcRenderer.invoke.apply(ipcRenderer, [channel].concat(args));
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
