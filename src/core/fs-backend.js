/**
 * 文件系统存储后端（Electron 端）ES Module 版本
 * 通过 window.electronAPI (IPC) 调用 Node.js fs
 */
const getApi = () => window.electronAPI

export const FSB = {
  open: () => getApi().invoke('fs:init'),
  clearAll: () => getApi().invoke('fs:clearAll'),

  listChildren: (parentPath) => getApi().invoke('fs:listChildren', parentPath),
  mkDir: (dirPath, meta, rootDir) => getApi().invoke('fs:mkDir', dirPath, meta || {}, rootDir || ''),
  rmDir: (dirPath) => getApi().invoke('fs:rmDir', dirPath),
  readMeta: (dirPath) => getApi().invoke('fs:readMeta', dirPath),
  writeMeta: (dirPath, meta) => getApi().invoke('fs:writeMeta', dirPath, meta),
  getDir: (dirPath) => getApi().invoke('fs:getDir', dirPath),

  readFile: (filePath) => getApi().invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => getApi().invoke('fs:writeFile', filePath, content),
  deleteFile: (filePath) => getApi().invoke('fs:deleteFile', filePath),

  writeBlobFile: (filePath, blob) =>
    blob.arrayBuffer().then(ab => getApi().invoke('fs:writeBlobFile', filePath, ab)),
  readBlobFile: (filePath) =>
    getApi().invoke('fs:readBlobFile', filePath).then(ab => ab ? new Blob([ab]) : null),

  selectDir: () => getApi().invoke('fs:selectDir'),
  openInFinder: (p) => getApi().invoke('fs:openInFinder', p),
  countChildren: (p) => getApi().invoke('fs:countChildren', p),
  getRootDir: () => getApi().invoke('fs:getRootDir'),
}
