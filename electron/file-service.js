/**
 * Electron 文件操作服务
 * 目录即结构：每个卡片=一个目录，每个知识库=一个根目录
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let rootDir = path.join(app.getPath('documents'), 'TopoMind');

function setRootDir(dir) { rootDir = dir; ensureDir(rootDir); }
function getRootDir() { return rootDir; }

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function abs(relPath) {
  return relPath ? path.join(rootDir, relPath) : rootDir;
}

// ===== 目录操作 =====

/** 列出某路径下的直接子目录 */
function listChildren(parentPath) {
  var dir = abs(parentPath);
  ensureDir(dir);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(function(e) { return e.isDirectory() && !e.name.startsWith('.') && e.name !== 'images'; })
    .map(function(e) {
      var childPath = parentPath ? parentPath + '/' + e.name : e.name;
      var meta = readMeta(childPath);
      return Object.assign({ path: childPath, name: meta.name || e.name }, meta);
    });
}

/** 创建目录 */
function mkDir(dirPath, meta) {
  var d = abs(dirPath);
  ensureDir(d);
  // 写入 _meta.json 如果不存在
  var metaFile = path.join(d, '_meta.json');
  if (!fs.existsSync(metaFile) || meta) {
    fs.writeFileSync(metaFile, JSON.stringify(meta || {}, null, 2), 'utf-8');
  }
}

/** 递归删除目录 */
function rmDir(dirPath) {
  var d = abs(dirPath);
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

/** 读取 _meta.json */
function readMeta(dirPath) {
  var f = path.join(abs(dirPath), '_meta.json');
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (e) {}
  }
  return {};
}

/** 写入 _meta.json */
function writeMeta(dirPath, meta) {
  ensureDir(abs(dirPath));
  fs.writeFileSync(path.join(abs(dirPath), '_meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
}

/** 获取目录信息 */
function getDir(dirPath) {
  var d = abs(dirPath);
  if (!fs.existsSync(d)) return null;
  var meta = readMeta(dirPath);
  return Object.assign({ path: dirPath }, meta);
}

// ===== 文件操作 =====

function readFile(filePath) {
  var f = abs(filePath);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf-8');
  return '';
}

function writeFile(filePath, content) {
  var f = abs(filePath);
  ensureDir(path.dirname(f));
  fs.writeFileSync(f, content, 'utf-8');
}

function deleteFile(filePath) {
  var f = abs(filePath);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

function writeBlobFile(filePath, arrayBuffer) {
  var f = abs(filePath);
  ensureDir(path.dirname(f));
  fs.writeFileSync(f, Buffer.from(arrayBuffer));
}

function readBlobFile(filePath) {
  var f = abs(filePath);
  if (!fs.existsSync(f)) return null;
  var buf = fs.readFileSync(f);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function clearAll() {
  if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true, force: true });
  ensureDir(rootDir);
}

module.exports = {
  setRootDir: setRootDir, getRootDir: getRootDir, ensureDir: ensureDir,
  listChildren: listChildren, mkDir: mkDir, rmDir: rmDir,
  readMeta: readMeta, writeMeta: writeMeta, getDir: getDir,
  readFile: readFile, writeFile: writeFile, deleteFile: deleteFile,
  writeBlobFile: writeBlobFile, readBlobFile: readBlobFile,
  clearAll: clearAll
};
