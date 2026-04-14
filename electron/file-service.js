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

function safeSegment(name) {
  var s = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '')
  if (!s || s === '.' || s === '..') s = 'untitled'
  return s.slice(0, 80)
}

function uniqueFolderName(parentDir, desiredName) {
  var base = safeSegment(desiredName)
  var candidate = base
  var i = 1
  while (fs.existsSync(path.join(parentDir, candidate))) {
    candidate = base + '-' + i
    i += 1
  }
  return candidate
}

function abs(relPath) {
  if (!relPath) return rootDir;
  var resolvedRoot = path.resolve(rootDir);
  var result = path.resolve(resolvedRoot, relPath);
  // 用 path.relative 检查：若结果以 '..' 开头，说明路径逃出了根目录
  var rel = path.relative(resolvedRoot, result);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越界: ' + relPath);
  }
  return result;
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
      var rawMeta = readMeta(childPath);
      var meta = (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) ? rawMeta : {};
      var safeName = (typeof meta.name === 'string' && meta.name.trim()) ? meta.name : e.name;
      var cover = (typeof meta.cover === 'string' && meta.cover.trim()) ? meta.cover : '';
      return Object.assign({ path: childPath, name: safeName, cover: cover }, meta);
    });
}

/** 创建目录 */
function metaFilePath(dir, kind) {
  return path.join(dir, kind === 'graph' ? '_graph.json' : '_kb_meta.json');
}

function legacyMetaFilePath(dir) {
  return path.join(dir, '_meta.json');
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (e) { return null; }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data || {}, null, 2), 'utf-8');
}

function mkDir(dirPath, meta, customRootDir) {
  var parent = customRootDir ? path.resolve(customRootDir) : rootDir;
  ensureDir(parent);
  var finalName = uniqueFolderName(parent, dirPath);
  var d = path.join(parent, finalName);
  ensureDir(d);
  var kbFile = metaFilePath(d, 'kb');
  if (!fs.existsSync(kbFile) || meta) {
    writeJsonFile(kbFile, meta || {});
  }
  if (fs.existsSync(legacyMetaFilePath(d))) {
    migrateLegacyMeta(d);
  }
  if (!fs.existsSync(metaFilePath(d, 'graph'))) {
    writeJsonFile(metaFilePath(d, 'graph'), { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null });
  }
  return d;
}

/** 递归删除目录 */
function rmDir(dirPath) {
  var d = abs(dirPath);
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

/** 读取知识库元数据（优先 _kb_meta.json，兼容 _meta.json） */
function splitLegacyMeta(legacy) {
  var meta = legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : {};
  var kbMeta = {};
  var graphMeta = {
    children: meta.children || {},
    edges: meta.edges || [],
    zoom: meta.zoom || null,
    pan: meta.pan || null,
    canvasBounds: meta.canvasBounds || null,
  };
  Object.keys(meta).forEach(function(key) {
    if (['children', 'edges', 'zoom', 'pan', 'canvasBounds'].indexOf(key) !== -1) return;
    kbMeta[key] = meta[key];
  });
  return { kbMeta: kbMeta, graphMeta: graphMeta };
}

function migrateLegacyMeta(dir) {
  var legacyPath = legacyMetaFilePath(dir);
  if (!fs.existsSync(legacyPath)) return;
  var legacy = readJsonFile(legacyPath);
  if (!legacy) return;
  var split = splitLegacyMeta(legacy);
  if (!fs.existsSync(metaFilePath(dir, 'kb'))) writeJsonFile(metaFilePath(dir, 'kb'), split.kbMeta);
  if (!fs.existsSync(metaFilePath(dir, 'graph'))) writeJsonFile(metaFilePath(dir, 'graph'), split.graphMeta);
}

function readMeta(dirPath) {
  var d = abs(dirPath);
  migrateLegacyMeta(d);
  var kbMeta = readJsonFile(metaFilePath(d, 'kb'));
  if (kbMeta) return kbMeta;
  var legacy = readJsonFile(legacyMetaFilePath(d));
  return legacy ? splitLegacyMeta(legacy).kbMeta : {};
}

/** 写入知识库元数据 */
function writeMeta(dirPath, meta) {
  var d = abs(dirPath);
  ensureDir(d);
  writeJsonFile(metaFilePath(d, 'kb'), meta || {});
}

function readGraphMeta(dirPath) {
  var d = abs(dirPath);
  migrateLegacyMeta(d);
  var graph = readJsonFile(metaFilePath(d, 'graph'));
  if (graph) return graph;
  var legacy = readJsonFile(legacyMetaFilePath(d));
  if (legacy) return splitLegacyMeta(legacy).graphMeta;
  return { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null };
}

function writeGraphMeta(dirPath, meta) {
  var d = abs(dirPath);
  ensureDir(d);
  writeJsonFile(metaFilePath(d, 'graph'), meta || {});
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
  var rootAbs = path.resolve(rootDir);
  if (!fs.existsSync(rootAbs)) { ensureDir(rootAbs); return; }
  // 逐个删除子知识库目录，不删除 rootDir 本身（防止 rootDir 被设为 ~/Documents 等目录时误删）
  fs.readdirSync(rootAbs, { withFileTypes: true }).forEach(function(e) {
    if (e.isDirectory() && !e.name.startsWith('.')) {
      fs.rmSync(path.join(rootAbs, e.name), { recursive: true, force: true });
    }
  });
}

module.exports = {
  setRootDir: setRootDir, getRootDir: getRootDir, ensureDir: ensureDir,
  listChildren: listChildren, mkDir: mkDir, rmDir: rmDir,
  readMeta: readMeta, writeMeta: writeMeta, readGraphMeta: readGraphMeta, writeGraphMeta: writeGraphMeta,
  getDir: getDir,
  readFile: readFile, writeFile: writeFile, deleteFile: deleteFile,
  writeBlobFile: writeBlobFile, readBlobFile: readBlobFile,
  clearAll: clearAll
};
