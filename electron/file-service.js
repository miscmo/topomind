/**
 * Electron 文件操作服务
 * 目录即结构：每个卡片=一个目录，每个知识库=一个根目录
 */
const fs = require('fs');
const nfs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');

const _profile = String(process.env.TOPOMIND_PROFILE || process.env.NODE_ENV || 'prod').toLowerCase();
const _isDevProfile = _profile !== 'prod';
const _defaultRootDir = _isDevProfile
  ? path.join(app.getPath('documents'), 'TopoMind-dev')
  : path.join(app.getPath('documents'), 'TopoMind');

let rootDir = _defaultRootDir;

// ===== 配置持久化（自动记录最后打开的知识库） =====
const _configFilePath = path.join(app.getPath('userData'), `topomind-config${_isDevProfile ? '.dev' : ''}.json`);
let _config = { lastOpenedKB: null };

function _loadConfig() {
  try {
    if (fs.existsSync(_configFilePath)) {
      _config = JSON.parse(fs.readFileSync(_configFilePath, 'utf-8')) || {};
    }
    // 如果配置中有 rootDir，使用它
    if (_config.rootDir && typeof _config.rootDir === 'string' && _config.rootDir.trim()) {
      rootDir = _config.rootDir;
      ensureDir(rootDir);
    }
  } catch (e) {
    console.warn('[file-service] 加载配置失败，使用默认目录:', e);
  }
}

function _saveConfig() {
  try {
    fs.writeFileSync(_configFilePath, JSON.stringify(_config, null, 2), 'utf-8');
  } catch (e) {
    console.error('[file-service] 保存配置失败:', e);
  }
}

_loadConfig();

function setRootDir(dir) { rootDir = dir; ensureDir(rootDir); _config.rootDir = dir; _saveConfig(); }
function getRootDir() { return rootDir; }

function getLastOpenedKB() { return _config.lastOpenedKB || null; }

function setLastOpenedKB(kbPath) {
  _config.lastOpenedKB = kbPath || null;
  _saveConfig();
}

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
  var children = fs.readdirSync(dir, { withFileTypes: true })
    .filter(function(e) { return e.isDirectory() && !e.name.startsWith('.') && e.name !== 'images'; })
    .map(function(e) {
      var childPath = parentPath ? parentPath + '/' + e.name : e.name;
      var rawMeta = readMeta(childPath);
      var meta = (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) ? rawMeta : {};
      var safeName = (typeof meta.name === 'string' && meta.name.trim()) ? meta.name : e.name;
      var cover = (typeof meta.cover === 'string' && meta.cover.trim()) ? meta.cover : '';
      return Object.assign({ path: childPath, name: safeName, cover: cover }, meta);
    });
  // 排序：order 字段升序，然后按 name 字母升序
  children.sort(function(a, b) {
    var orderA = Number.isFinite(a.order) ? a.order : Infinity;
    var orderB = Number.isFinite(b.order) ? b.order : Infinity;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
  });
  return children;
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

  var segments = (dirPath || '').split('/').filter(Boolean);
  if (segments.length === 0) return parent;

  // 除了最后一层，前面的 segment 对应的目录必然已存在，
  // 只做 ensure（带脱敏），不参与去重
  for (var i = 0; i < segments.length - 1; i++) {
    parent = path.join(parent, safeSegment(segments[i]));
    ensureDir(parent);
  }

  // 最后一层：去重（可能加 -1/-2 后缀）
  var finalName = uniqueFolderName(parent, segments[segments.length - 1]);
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

/** 打开目录选择框，选择已存在的知识库 */
function selectExistingKB() {
  var result = dialog.showOpenDialogSync({
    title: '选择知识库文件夹',
    properties: ['openDirectory']
  });
  if (!result || !result[0]) return null;
  var selectedPath = path.resolve(result[0]);
  // 检查是否是有效知识库（必须有 _kb_meta.json）
  var kbMetaFile = path.join(selectedPath, '_kb_meta.json');
  var legacyMetaFile = path.join(selectedPath, '_meta.json');
  if (!nfs.existsSync(kbMetaFile) && !nfs.existsSync(legacyMetaFile)) {
    return { valid: false, path: selectedPath, error: '不是有效的知识库目录（缺少 _kb_meta.json）' };
  }
  return { valid: true, path: selectedPath, name: path.basename(selectedPath) };
}

/** 将外部知识库复制到 rootDir（导入） */
function importKB(sourcePath) {
  var src = path.resolve(sourcePath);
  if (!nfs.existsSync(src)) throw new Error('源目录不存在: ' + src);
  if (!nfs.existsSync(path.join(src, '_kb_meta.json')) &&
      !nfs.existsSync(path.join(src, '_meta.json'))) {
    throw new Error('不是有效的知识库目录');
  }
  // 读取元数据获取展示名
  var meta = readJsonFile(path.join(src, '_kb_meta.json')) ||
             readJsonFile(path.join(src, '_meta.json')) || {};
  var kbName = (meta.name && typeof meta.name === 'string' && meta.name.trim())
    ? meta.name.trim()
    : path.basename(src);
  // 复制到 rootDir
  var destName = uniqueFolderName(rootDir, kbName);
  var dest = path.join(rootDir, destName);
  ensureDir(dest);
  // 递归复制（排除 node_modules 等）
  function copyDirRecursive(srcDir, destDir) {
    ensureDir(destDir);
    var entries = nfs.readdirSync(srcDir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.name === 'node_modules') continue;
      var srcEntry = path.join(srcDir, entry.name);
      var destEntry = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        copyDirRecursive(srcEntry, destEntry);
      } else {
        ensureDir(path.dirname(destEntry));
        // JSON 和 Markdown 文件用 UTF-8 文本方式复制，其他文件（如图片）用二进制
        if (/\.(json|md|txt)$/i.test(entry.name)) {
          var text = fs.readFileSync(srcEntry, 'utf-8');
          fs.writeFileSync(destEntry, text, 'utf-8');
        } else {
          var data = nfs.readFileSync(srcEntry);
          nfs.writeFileSync(destEntry, data);
        }
      }
    }
  }
  copyDirRecursive(src, dest);
  // 迁移元数据格式（确保是新版 _kb_meta.json + _graph.json）
  migrateLegacyMeta(dest);
  // 分配 sortOrder
  var existing = listChildren('');
  var maxOrder = -1;
  for (var i = 0; i < existing.length; i++) {
    var o = existing[i].order;
    if (Number.isFinite(o) && o > maxOrder) maxOrder = o;
  }
  var meta = readMeta(path.relative(rootDir, dest)) || {};
  meta.order = maxOrder + 1;
  writeMeta(path.relative(rootDir, dest), meta);
  var relPath = path.relative(rootDir, dest);
  return relPath;
}

module.exports = {
  setRootDir: setRootDir, getRootDir: getRootDir, ensureDir: ensureDir,
  getLastOpenedKB: getLastOpenedKB, setLastOpenedKB: setLastOpenedKB,
  listChildren: listChildren, mkDir: mkDir, rmDir: rmDir,
  readMeta: readMeta, writeMeta: writeMeta, readGraphMeta: readGraphMeta, writeGraphMeta: writeGraphMeta,
  getDir: getDir,
  readFile: readFile, writeFile: writeFile, deleteFile: deleteFile,
  writeBlobFile: writeBlobFile, readBlobFile: readBlobFile,
  clearAll: clearAll,
  selectExistingKB: selectExistingKB, importKB: importKB
};
