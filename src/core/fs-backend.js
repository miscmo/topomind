/**
 * 文件系统存储后端（Electron 端）ES Module 版本
 * 通过 window.electronAPI (IPC) 调用 Node.js fs
 */
const api = window.electronAPI

export const FSB = {
  open: () => api.invoke('fs:init'),
  clearAll: () => api.invoke('fs:clearAll'),

  listChildren: (parentPath) => api.invoke('fs:listChildren', parentPath),
  mkDir: (dirPath, meta, rootDir) => api.invoke('fs:mkDir', dirPath, meta || {}, rootDir || ''),
  rmDir: (dirPath) => api.invoke('fs:rmDir', dirPath),
  readMeta: (dirPath) => api.invoke('fs:readMeta', dirPath),
  writeMeta: (dirPath, meta) => api.invoke('fs:writeMeta', dirPath, meta),
  getDir: (dirPath) => api.invoke('fs:getDir', dirPath),

  readFile: (filePath) => api.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => api.invoke('fs:writeFile', filePath, content),
  deleteFile: (filePath) => api.invoke('fs:deleteFile', filePath),

  writeBlobFile: (filePath, blob) =>
    blob.arrayBuffer().then(ab => api.invoke('fs:writeBlobFile', filePath, ab)),
  readBlobFile: (filePath) =>
    api.invoke('fs:readBlobFile', filePath).then(ab => ab ? new Blob([ab]) : null),

  selectDir: () => api.invoke('fs:selectDir'),
  openInFinder: (p) => api.invoke('fs:openInFinder', p),
  countChildren: (p) => api.invoke('fs:countChildren', p),
  getRootDir: () => api.invoke('fs:getRootDir'),
}
