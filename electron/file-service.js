/**
 * File Service - 文件系统操作服务
 * 封装工作目录、知识库、卡片和文件的基础读写能力。
 */
import nodePath from 'path';
import nodeFs from 'fs';
import { dialog } from 'electron';

let _fs_rootDir = '';
let _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };

function _fs_appConfigPath(dir) {
  return nodePath.join(dir || _fs_rootDir, '_config.json');
}

function _fs_loadAppConfig(dir) {
  try {
    var cfgPath = _fs_appConfigPath(dir);
    if (nodeFs.existsSync(cfgPath)) {
      var loaded = JSON.parse(nodeFs.readFileSync(cfgPath, 'utf-8')) || {};
      _fs_config = {
        lastOpenedKB: loaded.lastOpenedKB || null,
        orders: (loaded.orders && typeof loaded.orders === 'object') ? loaded.orders : {},
        covers: (loaded.covers && typeof loaded.covers === 'object') ? loaded.covers : {},
      };
    } else {
      _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };
    }
  } catch (e) {
    _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };
  }
}

function _fs_saveAppConfig() {
  try {
    _fs_ensureDir(_fs_rootDir);
    nodeFs.writeFileSync(_fs_appConfigPath(), JSON.stringify(_fs_config, null, 2), 'utf-8');
  } catch (e) {
    // 静默处理：配置保存失败不影响应用运行
  }
}

function _fs_isDirEmpty(dirPath) {
  try {
    if (!nodeFs.existsSync(dirPath)) return true;
    return nodeFs.readdirSync(dirPath).length === 0;
  } catch (e) { return false; }
}

function _fs_isValidWorkDir(dirPath) {
  try {
    if (!dirPath || !nodeFs.existsSync(dirPath)) return false;
    var stat = nodeFs.statSync(dirPath);
    if (!stat.isDirectory()) return false;
    return nodeFs.existsSync(nodePath.join(dirPath, '_config.json'));
  } catch (e) { return false; }
}

function _fs_ensureDir(d) {
  if (!nodeFs.existsSync(d)) nodeFs.mkdirSync(d, { recursive: true });
}

function _fs_safeSegment(name) {
  var s = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '');
  if (!s || s === '.' || s === '..') s = 'untitled';
  return s.slice(0, 80);
}

function _fs_uniqueFolderName(parentDir, desiredName) {
  var base = _fs_safeSegment(desiredName);
  var candidate = base;
  var i = 1;
  while (nodeFs.existsSync(nodePath.join(parentDir, candidate))) {
    candidate = base + '-' + i;
    i += 1;
  }
  return candidate;
}

function _fs_abs(relPath) {
  if (!relPath) return _fs_rootDir;
  var resolvedRoot = nodePath.resolve(_fs_rootDir);
  var result = nodePath.resolve(resolvedRoot, relPath);
  var rel = nodePath.relative(resolvedRoot, result);
  if (rel.startsWith('..') || nodePath.isAbsolute(rel)) {
    throw new Error('路径越界: ' + relPath);
  }
  return result;
}

function _fs_readJsonFile(filePath) {
  if (!nodeFs.existsSync(filePath)) return null;
  try { return JSON.parse(nodeFs.readFileSync(filePath, 'utf-8')); } catch (e) { return null; }
}

function _fs_writeJsonFile(filePath, data) {
  nodeFs.writeFileSync(filePath, JSON.stringify(data || {}, null, 2), 'utf-8');
}

function _fs_graphFilePath(dir) {
  return nodePath.join(dir, '_graph.json');
}

function createFileService() {
  return {
    setRootDir: function(dir) {
      _fs_rootDir = dir;
      _fs_ensureDir(_fs_rootDir);
      _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };
      _fs_saveAppConfig();
    },

    getRootDir: function() { return _fs_rootDir; },

    getLastOpenedKB: function() { return _fs_config.lastOpenedKB || null; },

    setLastOpenedKB: function(kbPath) {
      _fs_config.lastOpenedKB = kbPath || null;
      _fs_saveAppConfig();
    },

    createWorkDir: function(dirPath) {
      var dir = nodePath.resolve(dirPath);
      if (nodeFs.existsSync(dir) && !_fs_isDirEmpty(dir)) {
        throw new Error('工作目录必须是空目录');
      }
      _fs_ensureDir(dir);
      _fs_rootDir = dir;
      _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };
      _fs_saveAppConfig();
      return { valid: true, nodePath: _fs_rootDir };
    },

    selectWorkDirCandidate: function() {
      var result = dialog.showOpenDialogSync({
        title: '选择工作目录',
        properties: ['openDirectory'],
      });
      if (!result || !result[0]) return { valid: false, nodePath: null, error: '已取消选择' };
      return { valid: true, nodePath: nodePath.resolve(result[0]) };
    },

    setWorkDir: function(dirPath) {
      var dir = dirPath;
      if (!dir) {
        return { valid: false, nodePath: null, error: '未指定工作目录路径' };      }
      dir = nodePath.resolve(dir);
      if (!_fs_isValidWorkDir(dir)) {
        return { valid: false, nodePath: dir, error: '不是有效的工作目录（缺少 _config.json）' };
      }
      _fs_rootDir = dir;
      _fs_loadAppConfig(dir);
      return { valid: true, nodePath: _fs_rootDir };
    },

    initWorkDir: function() {
      if (!_fs_rootDir) return { valid: false, nodePath: null, error: '未选择工作目录' };
      _fs_ensureDir(_fs_rootDir);
      if (!nodeFs.existsSync(_fs_appConfigPath())) {
        _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };
        _fs_saveAppConfig();
      }
      return { valid: true, nodePath: _fs_rootDir };
    },

    listChildren: function(parentPath) {
      var dir = _fs_abs(parentPath);
      _fs_ensureDir(dir);
      var parentGraph = _fs_readJsonFile(_fs_graphFilePath(dir)) || { children: {} };
      var parentChildren = parentGraph.children || {};
      var children = nodeFs.readdirSync(dir, { withFileTypes: true })
        .filter(function(e) { return e.isDirectory() && !e.name.startsWith('.') && e.name !== 'images'; })
        .map(function(e) {
          var childPath = parentPath ? parentPath + '/' + e.name : e.name;
          var childGraphEntry = parentChildren[childPath];
          var safeName = (childGraphEntry && typeof childGraphEntry.name === 'string' && childGraphEntry.name.trim())
            ? childGraphEntry.name.trim()
            : e.name;
          var cover = 'images/cover.png';
          var order = Number.isFinite(_fs_config.orders[childPath]) ? _fs_config.orders[childPath] : Infinity;
          return { path: childPath, name: safeName, isDir: true, cover: cover, order: order };
        });
      children.sort(function(a, b) {
        var orderA = Number.isFinite(a.order) ? a.order : Infinity;
        var orderB = Number.isFinite(b.order) ? b.order : Infinity;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      });
      return children;
    },

    mkDir: function(dirPath, meta, customRootDir) {
      var parent = customRootDir ? nodePath.resolve(customRootDir) : _fs_rootDir;
      _fs_ensureDir(parent);
      var segments = (dirPath || '').split('/').filter(Boolean);
      if (segments.length === 0) return parent;
      for (var i = 0; i < segments.length - 1; i++) {
        parent = nodePath.join(parent, _fs_safeSegment(segments[i]));
        _fs_ensureDir(parent);
      }
      var finalName = _fs_uniqueFolderName(parent, segments[segments.length - 1]);
      var d = nodePath.join(parent, finalName);
      _fs_ensureDir(d);
      if (!nodeFs.existsSync(_fs_graphFilePath(d))) {
        _fs_writeJsonFile(_fs_graphFilePath(d), { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null });
      }
      return d;
    },

    rmDir: function(dirPath) {
      var d = _fs_abs(dirPath);
      if (nodeFs.existsSync(d)) nodeFs.rmSync(d, { recursive: true, force: true });
    },

    saveKBOrder: function(kbPath, order) {
      var relPath = nodePath.relative(_fs_rootDir, kbPath).split(nodePath.sep).join('/');
      _fs_config.orders[relPath] = Number.isFinite(order) ? order : 0;
      _fs_saveAppConfig();
    },

    getKBCover: function(kbPath) {
      var relPath = nodePath.relative(_fs_rootDir, kbPath).split(nodePath.sep).join('/');
      return _fs_config.covers[relPath] || null;
    },

    saveKBCover: function(kbPath, coverPath) {
      var relPath = nodePath.relative(_fs_rootDir, kbPath).split(nodePath.sep).join('/');
      if (coverPath) {
        _fs_config.covers[relPath] = coverPath;
      } else {
        delete _fs_config.covers[relPath];
      }
      _fs_saveAppConfig();
    },

    renameKB: function(kbPath, newName) {
      var d = _fs_abs(kbPath);
      if (!nodeFs.existsSync(d)) return null;
      var parentDir = _fs_rootDir;
      var newSafeName = _fs_safeSegment(newName);
      var newDirName = _fs_uniqueFolderName(parentDir, newSafeName);
      var oldDirName = nodePath.basename(d);
      var newDir = nodePath.join(parentDir, newDirName);
      var oldRelPath = nodePath.relative(_fs_rootDir, d).split(nodePath.sep).join('/');
      if (oldDirName !== newDirName) {
        nodeFs.renameSync(d, newDir);
      }
      var newRelPath = nodePath.relative(_fs_rootDir, newDir).split(nodePath.sep).join('/');
      if (oldRelPath !== newRelPath) {
        var orderVal = _fs_config.orders[oldRelPath];
        delete _fs_config.orders[oldRelPath];
        _fs_config.orders[newRelPath] = orderVal;
        if (_fs_config.lastOpenedKB) {
          var lastRel = nodePath.relative(_fs_rootDir, _fs_abs(_fs_config.lastOpenedKB)).split(nodePath.sep).join('/');
          if (lastRel === oldRelPath) {
            _fs_config.lastOpenedKB = newDir;
          }
        }
        _fs_saveAppConfig();
      }
      return newRelPath;
    },

    readGraphMeta: function(dirPath) {
      var d = _fs_abs(dirPath);
      var graph = _fs_readJsonFile(_fs_graphFilePath(d));
      if (graph) return graph;
      return { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null };
    },

    ensureCardDir: function(cardPath) {
      if (!cardPath) return;
      var d = _fs_abs(cardPath);
      if (nodeFs.existsSync(d)) return;
      var segments = cardPath.split('/').filter(Boolean);
      var parent = _fs_rootDir;
      for (var i = 0; i < segments.length - 1; i++) {
        parent = nodePath.join(parent, _fs_safeSegment(segments[i]));
        _fs_ensureDir(parent);
      }
      var finalName = _fs_uniqueFolderName(parent, segments[segments.length - 1]);
      d = nodePath.join(parent, finalName);
      _fs_ensureDir(d);
      if (!nodeFs.existsSync(_fs_graphFilePath(d))) {
        _fs_writeJsonFile(_fs_graphFilePath(d), { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null });
      }
    },

    writeGraphMeta: function(dirPath, meta) {
      var d = _fs_abs(dirPath);
      if (!nodeFs.existsSync(d)) {
        var segments = dirPath.split('/').filter(Boolean);
        var parent = _fs_rootDir;
        for (var i = 0; i < segments.length - 1; i++) {
          parent = nodePath.join(parent, _fs_safeSegment(segments[i]));
          _fs_ensureDir(parent);
        }
        _fs_ensureDir(d);
      }
      var graphMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
      _fs_writeJsonFile(_fs_graphFilePath(d), graphMeta);
    },

    updateCardMeta: function(cardPath, newName) {
      var parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : '';
      var parentDir = _fs_abs(parentPath);
      var graphPath = _fs_graphFilePath(parentDir);
      var graph = _fs_readJsonFile(graphPath) || { children: {}, edges: [] };
      var children = graph.children || {};
      var entry = children[cardPath];
      if (entry) {
        children[cardPath] = Object.assign({}, entry, { name: newName });
        graph.children = children;
        _fs_writeJsonFile(graphPath, graph);
      }
      return cardPath;
    },

    getDir: function(dirPath) {
      var d = _fs_abs(dirPath);
      if (!nodeFs.existsSync(d)) return null;
      return { nodePath: dirPath };
    },

    readFile: function(filePath) {
      var f = _fs_abs(filePath);
      if (nodeFs.existsSync(f)) return nodeFs.readFileSync(f, 'utf-8');
      return '';
    },

    writeFile: function(filePath, content) {
      var f = _fs_abs(filePath);
      _fs_ensureDir(nodePath.dirname(f));
      nodeFs.writeFileSync(f, content, 'utf-8');
    },

    deleteFile: function(filePath) {
      var f = _fs_abs(filePath);
      if (nodeFs.existsSync(f)) nodeFs.unlinkSync(f);
    },

    writeBlobFile: function(filePath, arrayBuffer) {
      var f = _fs_abs(filePath);
      _fs_ensureDir(nodePath.dirname(f));
      nodeFs.writeFileSync(f, Buffer.from(arrayBuffer));
    },

    readBlobFile: function(filePath) {
      var f = _fs_abs(filePath);
      if (!nodeFs.existsSync(f)) return null;
      var buf = nodeFs.readFileSync(f);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },

    clearAll: function() {
      var rootAbs = nodePath.resolve(_fs_rootDir);
      if (!nodeFs.existsSync(rootAbs)) { _fs_ensureDir(rootAbs); return; }
      try {
        nodeFs.readdirSync(rootAbs, { withFileTypes: true }).forEach(function(e) {
          if (e.isDirectory() && !e.name.startsWith('.')) {
            nodeFs.rmSync(nodePath.join(rootAbs, e.name), { recursive: true, force: true });
          }
        });
      } catch (e) {
        // 静默处理：目录删除失败不影响 clearAll 后续流程
      }
    },

    importKB: function(sourcePath) {
      var src = nodePath.resolve(sourcePath);
      if (!nodeFs.existsSync(src)) throw new Error('源目录不存在: ' + src);
      if (!nodeFs.existsSync(nodePath.join(src, '_graph.json'))) {
        throw new Error('不是有效的知识库目录');
      }
      var kbName = nodePath.basename(src);
      var destName = _fs_uniqueFolderName(_fs_rootDir, kbName);
      var dest = nodePath.join(_fs_rootDir, destName);
      _fs_ensureDir(dest);

      function copyDirRecursive(srcDir, destDir) {
        _fs_ensureDir(destDir);
        var entries = nodeFs.readdirSync(srcDir, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.name === 'node_modules') continue;
          var srcEntry = nodePath.join(srcDir, entry.name);
          var destEntry = nodePath.join(destDir, entry.name);
          if (entry.isDirectory()) {
            copyDirRecursive(srcEntry, destEntry);
          } else {
            _fs_ensureDir(nodePath.dirname(destEntry));
            if (/\.(json|md|txt)$/i.test(entry.name)) {
              var text = nodeFs.readFileSync(srcEntry, 'utf-8');
              nodeFs.writeFileSync(destEntry, text, 'utf-8');
            } else {
              var data = nodeFs.readFileSync(srcEntry);
              nodeFs.writeFileSync(destEntry, data);
            }
          }
        }
      }
      copyDirRecursive(src, dest);

      var existing = fileService.listChildren('');
      var maxOrder = -1;
      for (var i = 0; i < existing.length; i++) {
        var o = existing[i].order;
        if (Number.isFinite(o) && o > maxOrder) maxOrder = o;
      }
      var relDest = nodePath.relative(_fs_rootDir, dest).split(nodePath.sep).join('/');
      _fs_config.orders[relDest] = maxOrder + 1;
      _fs_saveAppConfig();
      return nodePath.relative(_fs_rootDir, dest);
    },
  };
}

// Singleton instance — internal methods use this instead of re-creating via factory
const fileService = createFileService();

export { createFileService, fileService };
export default fileService;
