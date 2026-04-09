/**
 * Electron 预加载脚本
 * 暴露统一的 IPC invoke 接口给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  invoke: function(channel) {
    var args = Array.prototype.slice.call(arguments, 1);
    return ipcRenderer.invoke.apply(ipcRenderer, [channel].concat(args));
  },
  on: function(channel, fn) {
    ipcRenderer.on(channel, function(e) {
      var args = Array.prototype.slice.call(arguments, 1);
      fn.apply(null, args);
    });
  }
});
