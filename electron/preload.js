/**
 * Electron 预加载脚本
 * 暴露统一的 IPC invoke 接口给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron';

// IPC 通道白名单，只允许渲染进程调用这些通道
const ALLOWED_CHANNELS = new Set([
  // fs
  'fs:listKBs', 'fs:listCards', 'fs:createKB', 'fs:deleteKB',
  'fs:readGraphMeta', 'fs:writeGraphMeta', 'fs:getDir',
  'fs:updateCardMeta', 'fs:renameKB', 'fs:createCard', 'fs:deleteCard',
  'fs:readFile', 'fs:writeFile', 'fs:deleteFile',
  'fs:countChildren',
  'fs:readAppConfig', 'fs:writeAppConfig',
  'fs:isValidWorkDir', 'fs:selectDirectory', 'fs:createWorkDir', 'fs:importKB',
  // app
  'app:openExternal',
  'app:navigateHome',
  'app:getE2EState',
  'app:switchWorkDir',
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
