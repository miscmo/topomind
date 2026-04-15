"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const ALLOWED_CHANNELS = /* @__PURE__ */ new Set([
  // fs
  "fs:init",
  "fs:listChildren",
  "fs:mkDir",
  "fs:rmDir",
  "fs:readMeta",
  "fs:writeMeta",
  "fs:readGraphMeta",
  "fs:writeGraphMeta",
  "fs:getDir",
  "fs:readFile",
  "fs:writeFile",
  "fs:deleteFile",
  "fs:writeBlobFile",
  "fs:readBlobFile",
  "fs:clearAll",
  "fs:openInFinder",
  "fs:countChildren",
  "fs:getRootDir",
  "fs:getLastOpenedKB",
  "fs:setLastOpenedKB",
  // git: basic
  "git:checkAvailable",
  "git:init",
  "git:status",
  "git:statusBatch",
  "git:isDirty",
  "git:commit",
  "git:log",
  "git:diff",
  "git:diffFiles",
  "git:commitDiffFiles",
  "git:commitFileDiff",
  // git: remote
  "git:push",
  "git:pull",
  "git:fetch",
  "git:remote:get",
  "git:remote:set",
  // git: conflict
  "git:conflict:list",
  "git:conflict:show",
  "git:conflict:resolve",
  "git:conflict:complete",
  // git: auth
  "git:auth:setToken",
  "git:auth:getSSHKey",
  "git:auth:setAuthType",
  "git:auth:getAuthType",
  // app
  "app:openExternal",
  // save
  "save:layout"
]);
const ALLOWED_SEND_SYNC_CHANNELS = /* @__PURE__ */ new Set([
  "save:layout"
]);
const ALLOWED_RECEIVE_CHANNELS = /* @__PURE__ */ new Set([
  "app:menu-action",
  "save:before-quit"
]);
contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  invoke: function(channel) {
    if (!ALLOWED_CHANNELS.has(channel)) {
      return Promise.reject(new Error("IPC 通道不在白名单中: " + channel));
    }
    var args = Array.prototype.slice.call(arguments, 1);
    return ipcRenderer.invoke.apply(ipcRenderer, [channel].concat(args));
  },
  sendSync: function(channel) {
    if (!ALLOWED_SEND_SYNC_CHANNELS.has(channel)) {
      console.error("[preload] sendSync 通道不在白名单中:", channel);
      return;
    }
    var args = Array.prototype.slice.call(arguments, 1);
    return ipcRenderer.sendSync.apply(ipcRenderer, [channel].concat(args));
  },
  on: function(channel, fn) {
    if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
      console.warn("[preload] 忽略未授权的监听通道:", channel);
      return;
    }
    ipcRenderer.on(channel, function(e) {
      var args = Array.prototype.slice.call(arguments, 1);
      fn.apply(null, args);
    });
  },
  off: function(channel, fn) {
    if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
      console.warn("[preload] 忽略未授权的移除通道:", channel);
      return;
    }
    ipcRenderer.off(channel, fn);
  }
});
