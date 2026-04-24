/**
 * Electron 预加载脚本
 * 暴露统一的 IPC invoke 接口给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron';

// IPC 通道白名单，只允许渲染进程调用这些通道
const ALLOWED_CHANNELS = new Set([
  // fs
  'fs:init', 'fs:listChildren', 'fs:mkDir', 'fs:rmDir',
  'fs:readGraphMeta', 'fs:writeGraphMeta', 'fs:getDir',
  'fs:updateCardMeta', 'fs:saveKBOrder',
  'fs:getKBCover', 'fs:saveKBCover', 'fs:renameKB',
  'fs:readFile', 'fs:writeFile', 'fs:deleteFile',
  'fs:writeBlobFile', 'fs:readBlobFile', 'fs:clearAll',
  'fs:openInFinder', 'fs:countChildren',
  'fs:ensureCardDir',
  'fs:getRootDir',
  'fs:getLastOpenedKB', 'fs:setLastOpenedKB',
  'fs:setWorkDir', 'fs:selectWorkDirCandidate', 'fs:createWorkDir', 'fs:importKB',
  // git: basic
  'git:checkAvailable', 'git:init', 'git:status',
  'git:statusBatch', 'git:isDirty',
  'git:commit', 'git:log', 'git:diff',
  'git:diffFiles', 'git:commitDiffFiles', 'git:commitFileDiff',
  // git: remote
  'git:push', 'git:pull', 'git:fetch',
  'git:remote:get', 'git:remote:set',
  // git: conflict
  'git:conflict:list', 'git:conflict:show',
  'git:conflict:resolve', 'git:conflict:complete',
  // git: auth
  'git:auth:setToken', 'git:auth:getSSHKey',
  'git:auth:setAuthType', 'git:auth:getAuthType',
  // app
  'app:openExternal',
  'app:navigateHome',
  'app:getE2EState',
  // save
  'save:layout',
  // log
  'log:write', 'log:getBuffer', 'log:query', 'log:setLevel', 'log:clear',
  'log:getAvailableDates', 'log:getLogDir',
]);

const ALLOWED_SEND_SYNC_CHANNELS = new Set([
  'save:layout',
]);

const ALLOWED_RECEIVE_CHANNELS = new Set([
  'app:menu-action',
  'app:navigate-home',
  'save:before-quit',
  'log:entry',
]);

console.log('[preload] loaded');

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
  sendSync: function(channel) {
    if (!ALLOWED_SEND_SYNC_CHANNELS.has(channel)) {
      console.error('[preload] sendSync 通道不在白名单中:', channel);
      return;
    }
    var args = Array.prototype.slice.call(arguments, 1);
    return ipcRenderer.sendSync.apply(ipcRenderer, [channel].concat(args));
  },
  send: function(channel) {
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
