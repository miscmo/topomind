/**
 * Electron 预加载脚本
 * 暴露统一的 IPC invoke 接口给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

// IPC 通道白名单，只允许渲染进程调用这些通道
const ALLOWED_CHANNELS = new Set([
  'fs:listChildren', 'fs:mkDir', 'fs:rmDir',
  'fs:readMeta', 'fs:writeMeta', 'fs:getDir',
  'fs:readFile', 'fs:writeFile', 'fs:deleteFile',
  'fs:writeBlobFile', 'fs:readBlobFile', 'fs:clearAll',
  'fs:setRootDir', 'fs:getRootDir', 'fs:selectDir',
  'fs:openInFinder', 'fs:countChildren',
  'git:checkAvailable', 'git:init', 'git:status',
  'git:commit', 'git:log', 'git:diff',
  'git:push', 'git:pull', 'git:fetch',
  'git:setRemote', 'git:getRemote',
  'git:getConflictList', 'git:resolveConflict', 'git:abortMerge',
  'git:statusBatch', 'git:getSSHPublicKey',
  'git:saveToken', 'git:setAuthType', 'git:getAuthType',
]);

const ALLOWED_RECEIVE_CHANNELS = new Set([
  'app:menu-action',
]);

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  invoke: function(channel) {
    if (!ALLOWED_CHANNELS.has(channel)) {
      return Promise.reject(new Error('IPC 通道不在白名单中: ' + channel));
    }
    var args = Array.prototype.slice.call(arguments, 1);
    return ipcRenderer.invoke.apply(ipcRenderer, [channel].concat(args));
  },
  on: function(channel, fn) {
    if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
      console.warn('[preload] 忽略未授权的监听通道:', channel);
      return;
    }
    ipcRenderer.on(channel, function(e) {
      var args = Array.prototype.slice.call(arguments, 1);
      fn.apply(null, args);
    });
  }
});
