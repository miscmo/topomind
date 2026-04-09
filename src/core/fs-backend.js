/**
 * 文件系统存储后端（Electron 端）
 * 通过 window.electronAPI (IPC) 调用 Node.js fs
 * 接口与 IDB 后端对齐
 */
var FSB = (function() {
  var api = window.electronAPI;

  function listChildren(parentPath) {
    return api.invoke('fs:listChildren', parentPath);
  }

  function mkDir(dirPath, meta) {
    return api.invoke('fs:mkDir', dirPath, meta || {});
  }

  function rmDir(dirPath) {
    return api.invoke('fs:rmDir', dirPath);
  }

  function readMeta(dirPath) {
    return api.invoke('fs:readMeta', dirPath);
  }

  function writeMeta(dirPath, meta) {
    return api.invoke('fs:writeMeta', dirPath, meta);
  }

  function readFile(filePath) {
    return api.invoke('fs:readFile', filePath);
  }

  function writeFile(filePath, content) {
    return api.invoke('fs:writeFile', filePath, content);
  }

  function deleteFile(filePath) {
    return api.invoke('fs:deleteFile', filePath);
  }

  function writeBlobFile(filePath, blob) {
    return blob.arrayBuffer().then(function(ab) {
      return api.invoke('fs:writeBlobFile', filePath, ab);
    });
  }

  function readBlobFile(filePath) {
    return api.invoke('fs:readBlobFile', filePath).then(function(ab) {
      return ab ? new Blob([ab]) : null;
    });
  }

  function getDir(dirPath) {
    return api.invoke('fs:getDir', dirPath);
  }

  return {
    open: function() { return api.invoke('fs:init'); },
    clearAll: function() { return api.invoke('fs:clearAll'); },
    listChildren: listChildren, mkDir: mkDir, rmDir: rmDir,
    readMeta: readMeta, writeMeta: writeMeta,
    readFile: readFile, writeFile: writeFile, deleteFile: deleteFile,
    writeBlobFile: writeBlobFile, readBlobFile: readBlobFile,
    getDir: getDir,
    selectDir: function() { return api.invoke('fs:selectDir'); },
    openInFinder: function(p) { return api.invoke('fs:openInFinder', p); },
    countChildren: function(p) { return api.invoke('fs:countChildren', p); },
    getRootDir: function() { return api.invoke('fs:getRootDir'); }
  };
})();
