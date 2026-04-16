/**
 * 文件系统存储后端（Electron 端）ES Module 版本
 * 通过 window.electronAPI (IPC) 调用 Node.js fs
 */
const getApi = () => window.electronAPI

const _call = (channel, ...args) => {
  const api = getApi()
  if (!api) {
    console.warn(`[FSB] IPC API 未就绪，无法调用 ${channel}`)
    return Promise.reject(new Error(`IPC API 未就绪: ${channel}`))
  }
  return api.invoke(channel, ...args)
}

export const FSB = {
  open: () => _call('fs:init'),
  clearAll: () => _call('fs:clearAll'),
  initWorkDir: () => _call('fs:init'),

  listChildren: (parentPath) => _call('fs:listChildren', parentPath),
  mkDir: (dirPath, meta) => _call('fs:mkDir', dirPath, meta || {}),
  rmDir: (dirPath) => _call('fs:rmDir', dirPath),
  readMeta: (dirPath) => _call('fs:readMeta', dirPath),
  writeMeta: (dirPath, meta) => _call('fs:writeMeta', dirPath, meta),
  readGraphMeta: (dirPath) => _call('fs:readGraphMeta', dirPath),
  writeGraphMeta: (dirPath, meta) => _call('fs:writeGraphMeta', dirPath, meta),
  getDir: (dirPath) => _call('fs:getDir', dirPath),

  readFile: (filePath) => _call('fs:readFile', filePath),
  writeFile: (filePath, content) => _call('fs:writeFile', filePath, content),
  deleteFile: (filePath) => _call('fs:deleteFile', filePath),

  writeBlobFile: (filePath, blob) =>
    blob.arrayBuffer().then(ab => _call('fs:writeBlobFile', filePath, ab)),
  readBlobFile: (filePath) =>
    _call('fs:readBlobFile', filePath).then(ab => ab ? new Blob([ab]) : null),

  selectExistingWorkDir: (dirPath) => _call('fs:selectExistingWorkDir', dirPath),
  selectWorkDirCandidate: () => _call('fs:selectWorkDirCandidate'),
  createWorkDir: (dirPath) => _call('fs:createWorkDir', dirPath),
  importKB: (sourcePath) => _call('fs:importKB', sourcePath),
  openInFinder: (p) => _call('fs:openInFinder', p),
  countChildren: (p) => _call('fs:countChildren', p),
  getRootDir: () => _call('fs:getRootDir'),
  getLastOpenedKB: () => _call('fs:getLastOpenedKB'),
  setLastOpenedKB: (kbPath) => _call('fs:setLastOpenedKB', kbPath),
}
