/**
 * Electron 预加载脚本
 * 通过 contextBridge 将安全的文件操作 API 暴露给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 标识
  isElectron: true,

  // Markdown
  readMarkdown: function(nodeId) { return ipcRenderer.invoke('fs:readMarkdown', nodeId); },
  writeMarkdown: function(nodeId, content) { return ipcRenderer.invoke('fs:writeMarkdown', nodeId, content); },
  deleteMarkdown: function(nodeId) { return ipcRenderer.invoke('fs:deleteMarkdown', nodeId); },
  listMarkdownFiles: function() { return ipcRenderer.invoke('fs:listMarkdownFiles'); },

  // 图片
  writeImage: function(filename, arrayBuffer) { return ipcRenderer.invoke('fs:writeImage', filename, arrayBuffer); },
  readImage: function(filename) { return ipcRenderer.invoke('fs:readImage', filename); },
  deleteImage: function(filename) { return ipcRenderer.invoke('fs:deleteImage', filename); },
  listImages: function() { return ipcRenderer.invoke('fs:listImages'); },

  // 工作目录
  getWorkDir: function() { return ipcRenderer.invoke('fs:getWorkDir'); },
  selectWorkDir: function() { return ipcRenderer.invoke('fs:selectWorkDir'); },

  // 导入/导出
  exportJson: function(data) { return ipcRenderer.invoke('fs:exportJson', data); },
  importJson: function() { return ipcRenderer.invoke('fs:importJson'); },

  // 窗口控制
  setTitle: function(title) { ipcRenderer.send('win:setTitle', title); },
});
