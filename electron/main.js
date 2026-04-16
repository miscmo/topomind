/**
 * Electron 主进程 - 合并版
 * 所有 electron 源码合并到单个文件，确保生产构建能正确打包
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } = require('electron');
const path = require('path');
const nodeFs = require('fs');
const { simpleGit } = require('simple-git');
const { execFile } = require('child_process');

// ============================================================
// 1. FILE-SERVICE（from electron/file-service.js）
// ============================================================
let _fs_rootDir = '';
let _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };

function _fs_appConfigPath(dir) {
  return path.join(dir || _fs_rootDir, '_config.json');
}

function _fs_loadAppConfig(dir) {
  try {
    var cfgPath = _fs_appConfigPath(dir);
    if (nodeFs.existsSync(cfgPath)) {
      var loaded = JSON.parse(nodeFs.readFileSync(cfgPath, 'utf-8')) || {};
      // Merge new structure with loaded data for backward compat
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
    // silently fail
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
    return nodeFs.existsSync(path.join(dirPath, '_config.json'));
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

function _fs_migrateAppConfig(dir) {
  var oldPath = path.join(dir, 'app-config.json');
  var newPath = path.join(dir, '_config.json');
  if (nodeFs.existsSync(oldPath) && !nodeFs.existsSync(newPath)) {
    try {
      var data = nodeFs.readFileSync(oldPath, 'utf-8');
      nodeFs.writeFileSync(newPath, data, 'utf-8');
      nodeFs.unlinkSync(oldPath);
    } catch (e) { /* ignore migration errors */ }
  }
}

// 迁移旧的 _kb_meta.json 到新结构：name -> _graph.json, order/cover -> _config.json
function _fs_migrateKbMeta(dir) {
  dir = dir || _fs_rootDir;
  var absDir = path.resolve(dir);
  var entries = [];
  try { entries = nodeFs.readdirSync(absDir, { withFileTypes: true }); } catch (e) { return; }
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'images') continue;
    var childDir = path.join(absDir, entry.name);
    _fs_migrateKbMeta(childDir);
    var kbMetaPath = path.join(childDir, '_kb_meta.json');
    if (nodeFs.existsSync(kbMetaPath)) {
      try {
        var meta = JSON.parse(nodeFs.readFileSync(kbMetaPath, 'utf-8')) || {};
        var relPath = path.relative(_fs_rootDir, childDir).split(path.sep).join('/');
        // Migrate name to _graph.json
        var graphPath = path.join(childDir, '_graph.json');
        var graph = _fs_readJsonFile(graphPath) || { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null };
        if (typeof meta.name === 'string' && meta.name.trim()) {
          graph.name = meta.name.trim();
          _fs_writeJsonFile(graphPath, graph);
        }
        // Migrate order to _config.json.orders
        if (Number.isFinite(meta.order)) {
          _fs_config.orders[relPath] = meta.order;
        }
        // Migrate cover to _config.json.covers
        if (typeof meta.cover === 'string' && meta.cover.trim()) {
          _fs_config.covers[relPath] = meta.cover.trim();
        }
        // Delete old _kb_meta.json
        nodeFs.unlinkSync(kbMetaPath);
      } catch (e) { /* ignore migration errors */ }
    }
  }
  // Save migrated orders/covers to _config.json
  if (Object.keys(_fs_config.orders).length > 0 || Object.keys(_fs_config.covers).length > 0) {
    _fs_saveAppConfig();
  }
}

function _fs_uniqueFolderName(parentDir, desiredName) {
  var base = _fs_safeSegment(desiredName);
  var candidate = base;
  var i = 1;
  while (nodeFs.existsSync(path.join(parentDir, candidate))) {
    candidate = base + '-' + i;
    i += 1;
  }
  return candidate;
}

function _fs_abs(relPath) {
  if (!relPath) return _fs_rootDir;
  var resolvedRoot = path.resolve(_fs_rootDir);
  var result = path.resolve(resolvedRoot, relPath);
  var rel = path.relative(resolvedRoot, result);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
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

function _fs_stripGraphFields(meta) {
  var base = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  var kbMeta = {};
  Object.keys(base).forEach(function(key) {
    if (['children', 'edges', 'zoom', 'pan', 'canvasBounds'].indexOf(key) !== -1) return;
    kbMeta[key] = base[key];
  });
  return kbMeta;
}

function _fs_metaFilePath(dir, kind) {
  return path.join(dir, kind === 'graph' ? '_graph.json' : '_kb_meta.json');
}

// Public file-service API
var fileService = {
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
    var dir = path.resolve(dirPath);
    if (nodeFs.existsSync(dir) && !_fs_isDirEmpty(dir)) {
      throw new Error('工作目录必须是空目录');
    }
    _fs_ensureDir(dir);
    _fs_rootDir = dir;
    _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };
    _fs_saveAppConfig();
    return { valid: true, path: _fs_rootDir };
  },
  selectWorkDirCandidate: function() {
    var result = dialog.showOpenDialogSync({
      title: '选择工作目录',
      properties: ['openDirectory'],
    });
    if (!result || !result[0]) return { valid: false, path: null, error: '已取消选择' };
    return { valid: true, path: path.resolve(result[0]) };
  },
  selectExistingWorkDir: function(dirPath) {
    var dir = dirPath;
    if (!dir) {
      var picked = fileService.selectWorkDirCandidate();
      if (!picked.valid) return picked;
      dir = picked.path;
    }
    dir = path.resolve(dir);
    _fs_migrateAppConfig(dir);
    if (!_fs_isValidWorkDir(dir)) {
      return { valid: false, path: dir, error: '不是有效的工作目录（缺少 _config.json）' };
    }
    _fs_rootDir = dir;
    _fs_loadAppConfig(dir);
    _fs_migrateKbMeta(_fs_rootDir);
    return { valid: true, path: _fs_rootDir };
  },
  initWorkDir: function() {
    if (!_fs_rootDir) return { valid: false, path: null, error: '未选择工作目录' };
    _fs_ensureDir(_fs_rootDir);
    _fs_migrateAppConfig(_fs_rootDir);
    _fs_migrateKbMeta(_fs_rootDir);
    if (!nodeFs.existsSync(_fs_appConfigPath())) {
      _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };
      _fs_saveAppConfig();
    }
    return { valid: true, path: _fs_rootDir };
  },
  listChildren: function(parentPath) {
    var dir = _fs_abs(parentPath);
    _fs_ensureDir(dir);
    // Read parent graph for child display names
    var parentGraph = _fs_readJsonFile(_fs_metaFilePath(dir, 'graph')) || { children: {} };
    var parentChildren = parentGraph.children || {};
    var children = nodeFs.readdirSync(dir, { withFileTypes: true })
      .filter(function(e) { return e.isDirectory() && !e.name.startsWith('.') && e.name !== 'images'; })
      .map(function(e) {
        var childPath = parentPath ? parentPath + '/' + e.name : e.name;
        var childGraphEntry = parentChildren[childPath];
        var safeName = (childGraphEntry && typeof childGraphEntry.name === 'string' && childGraphEntry.name.trim())
          ? childGraphEntry.name.trim()
          : e.name;
        // Hardcoded cover path
        var cover = 'images/cover.png';
        // Order from _config.json.orders
        var order = Number.isFinite(_fs_config.orders[childPath]) ? _fs_config.orders[childPath] : Infinity;
        return {
          path: childPath,
          name: safeName,
          cover: cover,
          order: order,
        };
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
    var parent = customRootDir ? path.resolve(customRootDir) : _fs_rootDir;
    _fs_ensureDir(parent);
    var segments = (dirPath || '').split('/').filter(Boolean);
    if (segments.length === 0) return parent;
    for (var i = 0; i < segments.length - 1; i++) {
      parent = path.join(parent, _fs_safeSegment(segments[i]));
      _fs_ensureDir(parent);
    }
    var finalName = _fs_uniqueFolderName(parent, segments[segments.length - 1]);
    var d = path.join(parent, finalName);
    _fs_ensureDir(d);
    // Only write _graph.json; name/order are stored in parent's _graph.json and _config.json
    if (!nodeFs.existsSync(_fs_metaFilePath(d, 'graph'))) {
      _fs_writeJsonFile(_fs_metaFilePath(d, 'graph'), { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null });
    }
    return d;
  },
  rmDir: function(dirPath) {
    var d = _fs_abs(dirPath);
    if (nodeFs.existsSync(d)) nodeFs.rmSync(d, { recursive: true, force: true });
  },
  readMeta: function(dirPath) {
    var d = _fs_abs(dirPath);
    // Primary: read name from _graph.json
    var graph = _fs_readJsonFile(_fs_metaFilePath(d, 'graph'));
    if (graph && typeof graph.name === 'string' && graph.name.trim()) {
      return { name: graph.name.trim() };
    }
    // Fallback: read from _kb_meta.json for backward compat
    var kbMeta = _fs_readJsonFile(_fs_metaFilePath(d, 'kb'));
    if (kbMeta) return kbMeta;
    return {};
  },
  writeMeta: function(dirPath, meta) {
    var d = _fs_abs(dirPath);
    _fs_ensureDir(d);
    // Write name to _graph.json
    var graph = _fs_readJsonFile(_fs_metaFilePath(d, 'graph')) || { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null };
    if (meta && typeof meta === 'object') {
      if (typeof meta.name === 'string' && meta.name.trim()) {
        graph.name = meta.name.trim();
      }
    }
    _fs_writeJsonFile(_fs_metaFilePath(d, 'graph'), graph);
  },
  writeKBName: function(kbPath, name) {
    var d = _fs_abs(kbPath);
    _fs_ensureDir(d);
    var graph = _fs_readJsonFile(_fs_metaFilePath(d, 'graph')) || { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null };
    graph.name = String(name || '').trim();
    _fs_writeJsonFile(_fs_metaFilePath(d, 'graph'), graph);
  },
  saveKBOrder: function(kbPath, order) {
    var relPath = path.relative(_fs_rootDir, kbPath).split(path.sep).join('/');
    _fs_config.orders[relPath] = Number.isFinite(order) ? order : 0;
    _fs_saveAppConfig();
  },
  readGraphMeta: function(dirPath) {
    var d = _fs_abs(dirPath);
    var graph = _fs_readJsonFile(_fs_metaFilePath(d, 'graph'));
    if (graph) return graph;
    return { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null };
  },
  // 创建卡片目录和 _graph.json（惰性创建，由 writeGraphMeta/addChildCard 调用）
  ensureCardDir: function(cardPath) {
    if (!cardPath) return;
    var d = _fs_abs(cardPath);
    if (nodeFs.existsSync(d)) return; // already exists
    var segments = cardPath.split('/').filter(Boolean);
    var parent = _fs_rootDir;
    for (var i = 0; i < segments.length - 1; i++) {
      parent = path.join(parent, _fs_safeSegment(segments[i]));
      _fs_ensureDir(parent);
    }
    var finalName = _fs_uniqueFolderName(parent, segments[segments.length - 1]);
    d = path.join(parent, finalName);
    _fs_ensureDir(d);
    if (!nodeFs.existsSync(_fs_metaFilePath(d, 'graph'))) {
      _fs_writeJsonFile(_fs_metaFilePath(d, 'graph'), { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null });
    }
  },
  writeGraphMeta: function(dirPath, meta) {
    var d = _fs_abs(dirPath);
    // 惰性创建：目录不存在时先创建（_graph.json 由下面直接写入）
    if (!nodeFs.existsSync(d)) {
      var segments = dirPath.split('/').filter(Boolean);
      var parent = _fs_rootDir;
      for (var i = 0; i < segments.length - 1; i++) {
        parent = path.join(parent, _fs_safeSegment(segments[i]));
        _fs_ensureDir(parent);
      }
      _fs_ensureDir(d);
    }
    var graphMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
    _fs_writeJsonFile(_fs_metaFilePath(d, 'graph'), graphMeta);
  },
  updateCardMeta: function(cardPath, newName) {
    var d = _fs_abs(cardPath);
    if (!nodeFs.existsSync(d)) return null;
    var parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : '';
    var parentDir = _fs_abs(parentPath);
    var newSafeName = _fs_safeSegment(newName);
    var newDirName = _fs_uniqueFolderName(parentDir, newSafeName);
    var oldDirName = path.basename(d);
    var newDir = path.join(parentDir, newDirName);

    // Rename directory in place
    if (oldDirName !== newDirName) {
      nodeFs.renameSync(d, newDir);
    }

    // Update parent's _graph.json: update path key and name
    var graphPath = _fs_metaFilePath(parentDir, 'graph');
    var graph = _fs_readJsonFile(graphPath) || { children: {}, edges: [] };
    var children = graph.children || {};
    var entry = children[cardPath];
    if (entry) {
      var newCardPath = parentPath ? parentPath + '/' + newDirName : newDirName;
      delete children[cardPath];
      children[newCardPath] = Object.assign({}, entry, { name: newSafeName });
      graph.children = children;
      _fs_writeJsonFile(graphPath, graph);
      return newCardPath;
    }
    return cardPath;
  },
  getDir: function(dirPath) {
    var d = _fs_abs(dirPath);
    if (!nodeFs.existsSync(d)) return null;
    var meta = fileService.readMeta(dirPath);
    return Object.assign({ path: dirPath }, meta);
  },
  readFile: function(filePath) {
    var f = _fs_abs(filePath);
    if (nodeFs.existsSync(f)) return nodeFs.readFileSync(f, 'utf-8');
    return '';
  },
  writeFile: function(filePath, content) {
    var f = _fs_abs(filePath);
    _fs_ensureDir(path.dirname(f));
    nodeFs.writeFileSync(f, content, 'utf-8');
  },
  deleteFile: function(filePath) {
    var f = _fs_abs(filePath);
    if (nodeFs.existsSync(f)) nodeFs.unlinkSync(f);
  },
  writeBlobFile: function(filePath, arrayBuffer) {
    var f = _fs_abs(filePath);
    _fs_ensureDir(path.dirname(f));
    nodeFs.writeFileSync(f, Buffer.from(arrayBuffer));
  },
  readBlobFile: function(filePath) {
    var f = _fs_abs(filePath);
    if (!nodeFs.existsSync(f)) return null;
    var buf = nodeFs.readFileSync(f);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  },
  clearAll: function() {
    var rootAbs = path.resolve(_fs_rootDir);
    if (!nodeFs.existsSync(rootAbs)) { _fs_ensureDir(rootAbs); return; }
    nodeFs.readdirSync(rootAbs, { withFileTypes: true }).forEach(function(e) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        nodeFs.rmSync(path.join(rootAbs, e.name), { recursive: true, force: true });
      }
    });
  },
  importKB: function(sourcePath) {
    var src = path.resolve(sourcePath);
    if (!nodeFs.existsSync(src)) throw new Error('源目录不存在: ' + src);
    if (!nodeFs.existsSync(path.join(src, '_kb_meta.json')) &&
        !nodeFs.existsSync(path.join(src, '_meta.json')) &&
        !nodeFs.existsSync(path.join(src, '_graph.json'))) {
      throw new Error('不是有效的知识库目录');
    }
    var meta = _fs_readJsonFile(path.join(src, '_kb_meta.json')) ||
               _fs_readJsonFile(path.join(src, '_meta.json')) || {};
    var kbName = (meta.name && typeof meta.name === 'string' && meta.name.trim())
      ? meta.name.trim()
      : path.basename(src);
    var destName = _fs_uniqueFolderName(_fs_rootDir, kbName);
    var dest = path.join(_fs_rootDir, destName);
    _fs_ensureDir(dest);

    function copyDirRecursive(srcDir, destDir) {
      _fs_ensureDir(destDir);
      var entries = nodeFs.readdirSync(srcDir, { withFileTypes: true });
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.name === 'node_modules') continue;
        var srcEntry = path.join(srcDir, entry.name);
        var destEntry = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
          copyDirRecursive(srcEntry, destEntry);
        } else {
          _fs_ensureDir(path.dirname(destEntry));
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

    // 迁移旧 _meta.json 格式到 _graph.json（_kb_meta.json 不再使用）
    function migrateLegacyMeta(dir) {
      var entries = [];
      try { entries = nodeFs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        migrateLegacyMeta(path.join(dir, entry.name));
      }
      var metaFile = path.join(dir, '_meta.json');
      if (nodeFs.existsSync(metaFile)) {
        var legacy = _fs_readJsonFile(metaFile);
        if (legacy) {
          var graphMeta = {
            children: legacy.children || {},
            edges: legacy.edges || [],
            zoom: legacy.zoom || null,
            pan: legacy.pan || null,
            canvasBounds: legacy.canvasBounds || null,
          };
          if (legacy.name) graphMeta.name = legacy.name;
          _fs_writeJsonFile(_fs_metaFilePath(dir, 'graph'), graphMeta);
          // _kb_meta.json is no longer used — name is stored in _graph.json, order in _config.json
          try { nodeFs.unlinkSync(metaFile); } catch (e) { /* ignore */ }
        }
      }
    }
    migrateLegacyMeta(dest);

    // 分配 sortOrder 写入 _config.json.orders
    var existing = fileService.listChildren('');
    var maxOrder = -1;
    for (var i = 0; i < existing.length; i++) {
      var o = existing[i].order;
      if (Number.isFinite(o) && o > maxOrder) maxOrder = o;
    }
    var relDest = path.relative(_fs_rootDir, dest).split(path.sep).join('/');
    _fs_config.orders[relDest] = maxOrder + 1;
    _fs_saveAppConfig();
    return path.relative(_fs_rootDir, dest);
  },
};

// ============================================================
// 2. GIT-SERVICE（from electron/git-service.js）
// ============================================================
var _gitAvailable = null;

function _git_checkAvailable() {
  if (_gitAvailable !== null) return Promise.resolve(_gitAvailable);
  return new Promise(function(resolve) {
    execFile('git', ['--version'], { timeout: 5000 }, function(err, stdout) {
      if (err) { _gitAvailable = false; resolve(false); }
      else { _gitAvailable = true; resolve(true); }
    });
  });
}

function _git_withTimeout(promise, ms, operation) {
  var timeout = new Promise(function(_, reject) {
    setTimeout(function() {
      reject(new Error((operation || 'git') + ' 超时（' + (ms / 1000) + 's）'));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

function _git_toGitPath(p) {
  return p.split(path.sep).join('/');
}

function _git_sg(absPath, env) {
  return simpleGit(absPath).env(Object.assign({}, process.env, env || {}));
}

var gitService = {
  checkGitAvailable: function() { return _git_checkAvailable(); },

  initRepo: function(absKbPath) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath);
      return git.checkIsRepo().catch(function() { return false; })
        .then(function(isRepo) {
          if (isRepo) return { ok: true, alreadyInit: true };
          return git.init()
            .then(function() {
              var gitignorePath = path.join(absKbPath, '.gitignore');
              if (!nodeFs.existsSync(gitignorePath)) {
                nodeFs.writeFileSync(gitignorePath, [
                  '# TopoMind auto-generated', '.DS_Store', 'Thumbs.db', '*.tmp', '.git-credentials',
                ].join('\n'), 'utf-8');
              }
              return git.add('.');
            })
            .then(function() { return git.status(); })
            .then(function(status) {
              if (!status.isClean()) return git.commit('init: initialize TopoMind knowledge base');
              return null;
            })
            .then(function() { return { ok: true, alreadyInit: false }; });
        });
    });
  },

  getStatus: function(absKbPath) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { state: 'git-unavailable', ahead: 0, behind: 0 };
      var git = _git_sg(absKbPath);
      return git.checkIsRepo().catch(function() { return false; })
        .then(function(isRepo) {
          if (!isRepo) return { state: 'uninit', ahead: 0, behind: 0 };
          return git.raw(['rev-list', '--count', 'HEAD'])
            .then(function(o) { return parseInt(o.trim()) > 0; })
            .catch(function() { return false; });
        })
        .then(function(hasCommits) {
          if (!hasCommits) return { state: 'uninit', ahead: 0, behind: 0 };
          return git.status().then(function(status) {
            var conflictFiles = status.conflicted || [];
            var dirtyFiles = status.files.length;
            var hasUncommitted = !status.isClean();
            if (conflictFiles.length > 0) {
              return { state: 'conflict', ahead: 0, behind: 0, hasUncommitted: true,
                       dirtyFiles: dirtyFiles, conflictFiles: conflictFiles };
            }
            if (hasUncommitted) {
              return _git_getRemoteState(git).then(function(remoteState) {
                return Object.assign({ state: 'dirty', dirtyFiles: dirtyFiles,
                               hasUncommitted: true, conflictFiles: [] }, remoteState);
              });
            }
            return git.getRemotes(false).catch(function() { return []; })
              .then(function(remotes) {
                if (remotes.length === 0) {
                  return { state: 'no-remote', ahead: 0, behind: 0, hasUncommitted: false,
                           dirtyFiles: 0, conflictFiles: [] };
                }
                return git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
                  .catch(function() { return ''; })
                  .then(function(tracking) {
                    if (!tracking.trim()) {
                      return { state: 'no-remote', ahead: 0, behind: 0, hasUncommitted: false,
                               dirtyFiles: 0, conflictFiles: [] };
                    }
                    return _git_getRemoteState(git).then(function(remoteState) {
                      var state;
                      if (remoteState.ahead > 0 && remoteState.behind > 0) state = 'diverged';
                      else if (remoteState.ahead > 0) state = 'ahead';
                      else if (remoteState.behind > 0) state = 'behind';
                      else state = 'clean';
                      return Object.assign({ state: state, hasUncommitted: false,
                                     dirtyFiles: 0, conflictFiles: [] }, remoteState);
                    });
                  });
              });
          });
        });
    });
  },

  getStatusBatch: function(absKbPaths) {
    var results = {};
    var CONCURRENCY = 3;
    var process = function(i) {
      if (i >= absKbPaths.length) return Promise.resolve();
      var chunk = absKbPaths.slice(i, i + CONCURRENCY);
      return Promise.allSettled(
        chunk.map(function(p) {
          return gitService.getStatus(p).then(function(s) { return [p, s]; });
        })
      ).then(function(chunkResults) {
        chunkResults.forEach(function(r) {
          if (r.status === 'fulfilled') {
            results[r.value[0]] = r.value[1];
          }
        });
        return process(i + CONCURRENCY);
      });
    };
    return process(0).then(function() { return results; });
  },

  isDirty: function(absKbPath) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return false;
      var git = _git_sg(absKbPath);
      return git.checkIsRepo().catch(function() { return false; })
        .then(function(isRepo) {
          if (!isRepo) return false;
          return git.status().catch(function() { return { isClean: function() { return true; } }; })
            .then(function(status) { return !status.isClean(); });
        });
    });
  },

  commit: function(absKbPath, message) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath);
      return git.checkIsRepo().catch(function() { return false; })
        .then(function(isRepo) {
          if (!isRepo) return { ok: false, code: 'NOT_GIT_REPO', error: '尚未初始化 Git，请先初始化。' };
          return git.status().then(function(status) {
            if (status.isClean()) return { ok: true, skipped: true, message: '无变更可提交' };
            var kbName = path.basename(absKbPath);
            var msg = message || _git_generateCommitMessage(kbName, status);
            return git.add('.').then(function() {
              return git.commit(msg);
            }).then(function(result) {
              return { ok: true, hash: result.commit, message: msg };
            });
          });
        });
    });
  },

  getDiff: function(absKbPath, opts) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      opts = opts || {};
      var git = _git_sg(absKbPath);
      var args = [];
      if (opts.from && opts.to) {
        args.push(opts.from + '..' + opts.to);
      } else {
        args.push('HEAD');
      }
      if (opts.file) args.push('--', _git_toGitPath(opts.file));
      return git.diff(args).catch(function() { return ''; })
        .then(function(diffText) {
          if (!opts.from && !opts.to) {
            return git.diff(['--cached'].concat(args.slice(1))).catch(function() { return ''; })
              .then(function(untrackedDiff) {
                return { ok: true, diff: (untrackedDiff + '\n' + diffText).trim() };
              });
          }
          return { ok: true, diff: diffText };
        });
    });
  },

  getDiffStat: function(absKbPath, opts) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      opts = opts || {};
      var git = _git_sg(absKbPath);
      var args = ['--stat'];
      if (opts.from && opts.to) args.unshift(opts.from + '..' + opts.to);
      else args.unshift('HEAD');
      return git.diff(args).catch(function() { return ''; })
        .then(function(stat) {
          return git.diff(['--cached', '--stat', opts.from || 'HEAD']).catch(function() { return ''; })
            .then(function(statCached) {
              return { ok: true, stat: (statCached + '\n' + stat).trim() };
            });
        });
    });
  },

  getDiffFiles: function(absKbPath, opts) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      opts = opts || {};
      var git = _git_sg(absKbPath);
      var args = ['--numstat'];
      if (opts.from && opts.to) args.unshift(opts.from + '..' + opts.to);
      else args.unshift('HEAD');
      return git.diff(args).catch(function() { return ''; })
        .then(function(numstat) {
          return git.diff(['--cached', '--numstat', opts.from || 'HEAD']).catch(function() { return ''; })
            .then(function(numstatCached) {
              var combined = (numstatCached + '\n' + numstat).trim();
              if (!combined) return { ok: true, files: [] };
              var files = [];
              var seen = {};
              combined.split('\n').forEach(function(line) {
                line = line.trim();
                if (!line) return;
                var parts = line.split('\t');
                if (parts.length < 3) return;
                var ins = parseInt(parts[0]) || 0;
                var del = parseInt(parts[1]) || 0;
                var fp = parts[2];
                if (seen[fp]) {
                  seen[fp].insertions += ins;
                  seen[fp].deletions += del;
                  return;
                }
                var fileInfo = {
                  path: fp, insertions: ins, deletions: del,
                  isMeta: fp.endsWith('_meta.json'),
                  isDoc: fp.endsWith('README.md'),
                  isImage: /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fp),
                };
                seen[fp] = fileInfo;
                files.push(fileInfo);
              });
              return git.status().then(function(status) {
                (status.not_added || []).forEach(function(fp) {
                  if (!seen[fp]) {
                    var fileInfo = {
                      path: fp, insertions: 0, deletions: 0, isNew: true,
                      isMeta: fp.endsWith('_meta.json'),
                      isDoc: fp.endsWith('README.md'),
                      isImage: /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fp),
                    };
                    seen[fp] = fileInfo;
                    files.push(fileInfo);
                  }
                });
                return { ok: true, files: files };
              });
            });
        });
    });
  },

  getLog: function(absKbPath, opts) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      opts = opts || {};
      var git = _git_sg(absKbPath);
      return git.checkIsRepo().catch(function() { return false; })
        .then(function(isRepo) {
          if (!isRepo) return { ok: true, commits: [] };
          return git.raw(['rev-list', '--count', 'HEAD'])
            .then(function(o) { return parseInt(o.trim()) > 0; })
            .catch(function() { return false; });
        })
        .then(function(hasCommits) {
          if (!hasCommits) return { ok: true, commits: [] };
          return git.log({ maxCount: opts.limit || 20 }).then(function(log) {
            return {
              ok: true,
              commits: (log.all || []).map(function(c) {
                return {
                  hash: c.hash, shortHash: c.hash.slice(0, 7),
                  message: c.message, date: c.date, author: c.author_name,
                };
              })
            };
          });
        });
    });
  },

  getCommitDiffFiles: function(absKbPath, hash) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath);
      return git.raw(['diff', '--numstat', hash + '^', hash])
        .catch(function() {
          return git.raw(['show', '--numstat', '--format=', hash]).catch(function() { return ''; });
        })
        .then(function(numstat) {
          var files = [];
          (numstat || '').trim().split('\n').forEach(function(line) {
            line = line.trim();
            if (!line) return;
            var parts = line.split('\t');
            if (parts.length < 3) return;
            files.push({
              path: parts[2],
              insertions: parseInt(parts[0]) || 0,
              deletions: parseInt(parts[1]) || 0,
              isMeta: parts[2].endsWith('_meta.json'),
              isDoc: parts[2].endsWith('README.md'),
              isImage: /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(parts[2]),
            });
          });
          return { ok: true, files: files };
        });
    });
  },

  getCommitFileDiff: function(absKbPath, hash, filePath) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath);
      return git.raw(['diff', hash + '^', hash, '--', _git_toGitPath(filePath)])
        .catch(function() {
          return git.raw(['show', hash, '--', _git_toGitPath(filePath)]).catch(function() { return ''; });
        })
        .then(function(diffText) { return { ok: true, diff: diffText }; });
    });
  },

  getRemote: function(absKbPath) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath);
      return git.getRemotes(true).catch(function() { return []; })
        .then(function(remotes) {
          var origin = remotes.find(function(r) { return r.name === 'origin'; });
          return { ok: true, url: origin ? (origin.fs.fetch || origin.fs.push || '') : '' };
        });
    });
  },

  setRemote: function(absKbPath, url) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath);
      return git.getRemotes(false).catch(function() { return []; })
        .then(function(remotes) {
          var hasOrigin = remotes.some(function(r) { return r.name === 'origin'; });
          if (hasOrigin) return git.remote(['set-url', 'origin', url]);
          return git.addRemote('origin', url);
        })
        .then(function() { return { ok: true }; });
    });
  },

  fetchRemote: function(absKbPath, env) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath, env || {});
      return _git_withTimeout(git.fetch(), 15000, 'git fetch')
        .then(function() { return { ok: true }; })
        .catch(function(e) {
          if (e.message.includes('超时')) return { ok: false, code: 'TIMEOUT', error: e.message };
          if (/Authentication|authentication|auth/i.test(e.message)) {
            return { ok: false, code: 'AUTH_FAILED', error: '认证失败，请检查 Token 是否有效。' };
          }
          return { ok: false, code: 'FETCH_ERROR', error: e.message };
        });
    });
  },

  push: function(absKbPath, env) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath, env || {});
      return git.raw(['symbolic-ref', '--short', 'HEAD'])
        .catch(function() { return 'main'; })
        .then(function(branch) {
          branch = branch.trim();
          return _git_withTimeout(git.push('origin', branch, ['--set-upstream']), 60000, 'git push');
        })
        .then(function() { return { ok: true }; })
        .catch(function(e) {
          if (e.message.includes('超时')) return { ok: false, code: 'TIMEOUT', error: e.message };
          if (/rejected|non-fast-forward/i.test(e.message)) {
            return { ok: false, code: 'PUSH_REJECTED', error: '推送被拒绝，远程有新提交，请先拉取再推送。' };
          }
          if (/Authentication|authentication|auth/i.test(e.message)) {
            return { ok: false, code: 'AUTH_FAILED', error: '认证失败，请检查 Token 或 SSH 密钥。' };
          }
          return { ok: false, code: 'PUSH_ERROR', error: e.message };
        });
    });
  },

  pull: function(absKbPath, env) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath, env || {});
      return _git_withTimeout(git.pull(), 60000, 'git pull')
        .then(function() { return { ok: true }; })
        .catch(function(e) {
          if (e.message.includes('超时')) return { ok: false, code: 'TIMEOUT', error: e.message };
          if (/CONFLICT|conflict/i.test(e.message)) {
            return { ok: false, code: 'CONFLICT', error: '拉取后出现冲突，请手动解决。' };
          }
          if (/Authentication|authentication|auth/i.test(e.message)) {
            return { ok: false, code: 'AUTH_FAILED', error: '认证失败，请检查 Token 或 SSH 密钥。' };
          }
          return { ok: false, code: 'PULL_ERROR', error: e.message };
        });
    });
  },

  getConflictList: function(absKbPath) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath);
      return git.status().then(function(status) {
        return { ok: true, files: status.conflicted || [] };
      });
    });
  },

  getConflictContent: function(absKbPath, filePath) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath);
      var gitFp = _git_toGitPath(filePath);
      var absFilePath = path.join(absKbPath, filePath);
      var isBinary = /\.(png|jpg|jpeg|gif|webp|svg|pdf|zip|mp4|mp3)$/i.test(filePath);
      var ours = '', theirs = '', current = '';
      if (!isBinary) {
        return git.show(['HEAD:' + gitFp]).catch(function() { return ''; })
          .then(function(oursVal) {
            ours = oursVal;
            return git.show(['MERGE_HEAD:' + gitFp]).catch(function() { return ''; });
          })
          .then(function(theirsVal) {
            theirs = theirsVal;
            return new Promise(function(resolve) {
              fs.readFile(absFilePath, 'utf-8', function(err, data) { resolve(err ? '' : data); });
            });
          })
          .then(function(currentVal) {
            current = currentVal;
            return { ok: true, ours: ours, theirs: theirs, current: current, isBinary: isBinary };
          });
      }
      return Promise.resolve({ ok: true, ours: ours, theirs: theirs, current: current, isBinary: isBinary });
    });
  },

  resolveConflict: function(absKbPath, filePath, resolvedContent) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var absFilePath = path.join(absKbPath, filePath);
      nodeFs.writeFileSync(absFilePath, resolvedContent, 'utf-8');
      var git = _git_sg(absKbPath);
      return git.add(_git_toGitPath(filePath)).then(function() { return { ok: true }; });
    });
  },

  completeConflictResolution: function(absKbPath) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath);
      return git.status().then(function(status) {
        if (status.conflicted.length > 0) {
          return { ok: false, code: 'STILL_CONFLICTED', error: '还有 ' + status.conflicted.length + ' 个文件未解决。' };
        }
        return git.commit('merge: resolve conflicts manually')
          .then(function(result) { return { ok: true, hash: result.commit }; });
      });
    });
  },

  autoMergeMetaJson: function(oursStr, theirsStr) {
    try {
      var ours = JSON.parse(oursStr);
      var theirs = JSON.parse(theirsStr);
      var mergedChildren = Object.assign({}, theirs.children || {}, ours.children || {});
      var edgeMap = {};
      function addEdges(edges) {
        (edges || []).forEach(function(e) {
          var key = (e.source || e.from) + '::' + (e.target || e.to);
          if (!edgeMap[key]) edgeMap[key] = e;
        });
      }
      addEdges(theirs.edges);
      addEdges(ours.edges);
      var mergedEdges = Object.values(edgeMap);
      var cb = ours.canvasBounds || theirs.canvasBounds || null;
      if (ours.canvasBounds && theirs.canvasBounds) {
        cb = {
          x: Math.min(ours.canvasBounds.x, theirs.canvasBounds.x),
          y: Math.min(ours.canvasBounds.y, theirs.canvasBounds.y),
          w: Math.max(ours.canvasBounds.w, theirs.canvasBounds.w),
          h: Math.max(ours.canvasBounds.h, theirs.canvasBounds.h),
        };
      }
      var merged = Object.assign({}, theirs, ours, {
        children: mergedChildren, edges: mergedEdges, canvasBounds: cb,
        zoom: ours.zoom !== undefined ? ours.zoom : theirs.zoom,
        pan: ours.pan !== undefined ? ours.pan : theirs.pan,
      });
      return { ok: true, merged: JSON.stringify(merged, null, 2) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};

function _git_getRemoteState(git) {
  return git.raw(['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
    .then(function(out) {
      var parts = out.trim().split(/\s+/);
      return { ahead: parseInt(parts[0]) || 0, behind: parseInt(parts[1]) || 0 };
    })
    .catch(function() { return { ahead: 0, behind: 0 }; });
}

function _git_generateCommitMessage(kbName, status) {
  var created = (status.not_added || []).filter(function(f) { return f.endsWith('README.md'); });
  var deleted = (status.deleted || []).filter(function(f) { return f.endsWith('README.md'); });
  var modified = status.modified || [];
  var renamed = status.renamed || [];
  if (created.length > 0 && deleted.length === 0) {
    if (created.length === 1) {
      var name = created[0].split('/').slice(-2, -1)[0] || created[0];
      return 'feat: 新增「' + name + '」';
    }
    return 'feat: 新增 ' + created.length + ' 张卡片';
  }
  if (deleted.length > 0 && created.length === 0) {
    if (deleted.length === 1) {
      var name2 = deleted[0].split('/').slice(-2, -1)[0] || deleted[0];
      return 'chore: 删除「' + name2 + '」';
    }
    return 'chore: 删除 ' + deleted.length + ' 张卡片';
  }
  var onlyDocs = (status.files || []).every(function(f) { return f.path.endsWith('README.md'); });
  if (onlyDocs && modified.length > 0) {
    var docNames = modified.slice(0, 2).map(function(f) { return '「' + (f.split('/').slice(-2, -1)[0] || f) + '」'; });
    var suffix = modified.length > 2 ? ' 等 ' + modified.length + ' 个' : '';
    return 'docs: 更新 ' + docNames.join('、') + suffix;
  }
  var onlyMeta = (status.files || []).every(function(f) { return f.path.endsWith('_meta.json'); });
  if (onlyMeta) {
    return 'chore: 调整节点布局（' + (status.files || []).length + ' 处）';
  }
  if (renamed.length > 0) {
    var r = renamed[0];
    var fromName = (r.from || '').split('/').slice(-2, -1)[0] || r.from;
    var toName = (r.to || '').split('/').slice(-2, -1)[0] || r.to;
    return 'refactor: 重命名「' + fromName + '」→「' + toName + '」';
  }
  var parts = [];
  if ((status.not_added || []).length) parts.push('+' + status.not_added.length);
  if (modified.length) parts.push('~' + modified.length);
  if ((status.deleted || []).length) parts.push('-' + status.deleted.length);
  return 'update: ' + parts.join(' ') + ' 个文件';
}

// ============================================================
// 3. GIT-AUTH（from electron/git-auth.js）
// ============================================================
var _ga_storePath = null;
var _ga_store = null;

function _ga_getStorePath() {
  if (!_ga_storePath) _ga_storePath = path.join(app.getPath('userData'), 'git-auth.json');
  return _ga_storePath;
}

function _ga_loadStore() {
  if (_ga_store) return _ga_store;
  try {
    var data = nodeFs.readFileSync(_ga_getStorePath(), 'utf-8');
    _ga_store = JSON.parse(data);
  } catch (e) { _ga_store = {}; }
  return _ga_store;
}

function _ga_saveStore() {
  nodeFs.writeFileSync(_ga_getStorePath(), JSON.stringify(_ga_store || {}, null, 2), 'utf-8');
}

var gitAuth = {
  saveToken: function(kbPath, token) {
    return Promise.resolve().then(function() {
      var store = _ga_loadStore();
      if (!store[kbPath]) store[kbPath] = {};
      if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, error: '系统安全存储不可用，无法保存 Token。请确保系统密钥链服务正常运行。' };
      }
      try {
        store[kbPath].token = safeStorage.encryptString(token).toString('base64');
        store[kbPath].tokenEncrypted = true;
        _ga_saveStore();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: '加密 Token 失败: ' + e.message };
      }
    });
  },

  getToken: function(kbPath) {
    return Promise.resolve().then(function() {
      var store = _ga_loadStore();
      var entry = store[kbPath];
      if (!entry || !entry.token) return null;
      try {
        if (entry.tokenEncrypted && safeStorage.isEncryptionAvailable()) {
          return safeStorage.decryptString(Buffer.from(entry.token, 'base64'));
        }
        if (!entry.tokenEncrypted) {
          return null;
        }
        return null;
      } catch (e) { return null; }
    });
  },

  setAuthType: function(kbPath, authType) {
    return Promise.resolve().then(function() {
      var store = _ga_loadStore();
      if (!store[kbPath]) store[kbPath] = {};
      store[kbPath].authType = authType;
      _ga_saveStore();
      return { ok: true };
    });
  },

  getAuthType: function(kbPath) {
    return Promise.resolve().then(function() {
      var store = _ga_loadStore();
      var entry = store[kbPath];
      return { ok: true, authType: entry ? (entry.authType || 'token') : 'token' };
    });
  },

  ensureSSHKey: function() {
    var privPath = path.join(app.getPath('userData'), 'topomind-git-key');
    var pubPath = privPath + '.pub';
    if (nodeFs.existsSync(privPath) && nodeFs.existsSync(pubPath)) {
      return Promise.resolve({ privPath: privPath, pubPath: pubPath });
    }
    return new Promise(function(resolve, reject) {
      execFile('ssh-keygen', [
        '-t', 'ed25519',
        '-C', 'topomind-sync@' + require('os').hostname(),
        '-f', privPath,
        '-N', '',
      ], function(err) {
        if (err) reject(err);
        else resolve({ privPath: privPath, pubPath: pubPath });
      });
    });
  },

  getSSHPublicKey: function() {
    return gitAuth.ensureSSHKey()
      .then(function(paths) {
        var pub = nodeFs.readFileSync(paths.pubPath, 'utf-8').trim();
        return { ok: true, publicKey: pub };
      })
      .catch(function(e) { return { ok: false, error: e.message }; });
  },

  buildGitEnv: function(kbPath, remoteUrl) {
    return Promise.resolve().then(function() {
      if (!remoteUrl) return {};
      var isSSH = remoteUrl.startsWith('git@') || remoteUrl.startsWith('ssh://');
      var store = _ga_loadStore();
      var entry = store[kbPath] || {};
      var authType = entry.authType || (isSSH ? 'ssh' : 'token');
      if (authType === 'ssh' || isSSH) {
        return gitAuth.ensureSSHKey()
          .then(function(paths) {
            return {
              GIT_SSH_COMMAND: 'ssh -i "' + paths.privPath + '" -o StrictHostKeyChecking=accept-new -o BatchMode=yes',
            };
          })
          .catch(function() { return {}; });
      }
      return gitAuth.getToken(kbPath).then(function(token) {
        if (token) {
          return { GIT_ASKPASS: 'echo', GIT_USERNAME: 'oauth2', GIT_PASSWORD: token };
        }
        return {};
      });
    });
  },
};

// ============================================================
// 4. IPC HANDLERS
// ============================================================
var fs = fileService;

function registerIPC() {
  ipcMain.handle('fs:init',           function()        { return fs.initWorkDir(); });
  ipcMain.handle('fs:listChildren',   function(e, p)   { return fs.listChildren(p); });
  ipcMain.handle('fs:mkDir',          function(e, p, m) {
    var abs = fs.mkDir(p, m);
    return path.relative(fs.getRootDir(), abs);
  });
  ipcMain.handle('fs:rmDir',          function(e, p)    { fs.rmDir(p); });
  ipcMain.handle('fs:readMeta',       function(e, p)    { return fs.readMeta(p); });
  ipcMain.handle('fs:writeMeta',      function(e, p, m){ fs.writeMeta(p, m); });
  ipcMain.handle('fs:writeKBName',     function(e, p, n){ fs.writeKBName(p, n); });
  ipcMain.handle('fs:saveKBOrder',     function(e, p, o){ fs.saveKBOrder(p, o); });
  ipcMain.handle('fs:readGraphMeta',   function(e, p)   { return fs.readGraphMeta(p); });
  ipcMain.handle('fs:writeGraphMeta',  function(e, p, m){ fs.writeGraphMeta(p, m); });
  ipcMain.handle('fs:ensureCardDir',  function(e, p)    { fs.ensureCardDir(p); });
  ipcMain.handle('fs:getDir',         function(e, p)   { return fs.getDir(p); });
  ipcMain.handle('fs:updateCardMeta',  function(e, p, n){ return fs.updateCardMeta(p, n); });
  ipcMain.handle('fs:readFile',       function(e, p)   { return fs.readFile(p); });
  ipcMain.handle('fs:writeFile',      function(e, p, c){ fs.writeFile(p, c); });
  ipcMain.handle('fs:deleteFile',     function(e, p)    { fs.deleteFile(p); });
  ipcMain.handle('fs:writeBlobFile',  function(e, p, b){ fs.writeBlobFile(p, b); });
  ipcMain.handle('fs:readBlobFile',   function(e, p)   { return fs.readBlobFile(p); });
  ipcMain.handle('fs:clearAll',       function()        { fs.clearAll(); });
  ipcMain.handle('fs:openInFinder', function(e, dirPath) {
    var absPath = path.isAbsolute(dirPath) ? dirPath : path.join(fs.getRootDir(), dirPath);
    var rootDir = path.normalize(fs.getRootDir());
    if (!path.normalize(absPath).startsWith(rootDir)) return;
    if (nodeFs.existsSync(absPath)) shell.openPath(absPath);
  });
  ipcMain.handle('fs:countChildren', function(e, dirPath) {
    var d = dirPath ? path.join(fs.getRootDir(), dirPath) : fs.getRootDir();
    if (!nodeFs.existsSync(d)) return 0;
    try {
      return nodeFs.readdirSync(d, { withFileTypes: true })
        .filter(function(e) { return e.isDirectory() && !e.name.startsWith('.') && e.name !== 'images'; }).length;
    } catch(err) { return 0; }
  });
  ipcMain.handle('fs:getRootDir', function() { return fs.getRootDir(); });
  ipcMain.handle('fs:getLastOpenedKB', function() { return fs.getLastOpenedKB(); });
  ipcMain.handle('fs:setLastOpenedKB', function(e, kbPath) { fs.setLastOpenedKB(kbPath); });
  ipcMain.handle('fs:selectExistingWorkDir', function(e, dirPath) { return fs.selectExistingWorkDir(dirPath); });
  ipcMain.handle('fs:selectWorkDirCandidate', function() { return fs.selectWorkDirCandidate(); });
  ipcMain.handle('fs:createWorkDir', function(e, dirPath) { return fs.createWorkDir(dirPath); });
  ipcMain.handle('fs:importKB', function(e, sourcePath) { return fs.importKB(sourcePath); });

  ipcMain.handle('app:openExternal', function(e, url) {
    if (typeof url !== 'string') return false;
    var target = url.trim();
    if (!/^https?:\/\//i.test(target)) return false;
    shell.openExternal(target);
    return true;
  });

  ipcMain.on('save:layout', function(event, dirPath, meta) {
    try {
      fs.writeGraphMeta(dirPath, meta);
      event.returnValue = true;
    } catch (e) {
      event.returnValue = false;
    }
  });

  // ===== Git handlers =====
  function absKbPath(kbPath) {
    var root = fs.getRootDir();
    if (!kbPath) return root;
    return path.resolve(root, kbPath);
  }

  ipcMain.handle('git:checkAvailable', function() {
    return gitService.checkGitAvailable().then(function(available) { return { ok: true, available: available }; });
  });
  ipcMain.handle('git:init', function(e, kbPath) { return gitService.initRepo(absKbPath(kbPath)); });
  ipcMain.handle('git:status', function(e, kbPath) { return gitService.getStatus(absKbPath(kbPath)); });
  ipcMain.handle('git:statusBatch', function(e, kbPaths) {
    var absPaths = (kbPaths || []).map(function(p) { return absKbPath(p); });
    return gitService.getStatusBatch(absPaths)
      .then(function(results) {
        var out = {};
        kbPaths.forEach(function(rel, i) { out[rel] = results[absPaths[i]] || { state: 'uninit', ahead: 0, behind: 0 }; });
        return out;
      });
  });
  ipcMain.handle('git:isDirty', function(e, kbPath) {
    return gitService.isDirty(absKbPath(kbPath)).then(function(dirty) { return { ok: true, dirty: dirty }; });
  });
  ipcMain.handle('git:commit', function(e, kbPath, message) { return gitService.commit(absKbPath(kbPath), message); });
  ipcMain.handle('git:diff', function(e, kbPath, opts) { return gitService.getDiff(absKbPath(kbPath), opts); });
  ipcMain.handle('git:diffFiles', function(e, kbPath, opts) { return gitService.getDiffFiles(absKbPath(kbPath), opts); });
  ipcMain.handle('git:log', function(e, kbPath, opts) { return gitService.getLog(absKbPath(kbPath), opts); });
  ipcMain.handle('git:commitDiffFiles', function(e, kbPath, hash) { return gitService.getCommitDiffFiles(absKbPath(kbPath), hash); });
  ipcMain.handle('git:commitFileDiff', function(e, kbPath, hash, filePath) { return gitService.getCommitFileDiff(absKbPath(kbPath), hash, filePath); });
  ipcMain.handle('git:remote:get', function(e, kbPath) { return gitService.getRemote(absKbPath(kbPath)); });
  ipcMain.handle('git:remote:set', function(e, kbPath, url) { return gitService.setRemote(absKbPath(kbPath), url); });
  ipcMain.handle('git:fetch', function(e, kbPath) {
    return gitService.getRemote(absKbPath(kbPath))
      .then(function(r) { return gitAuth.buildGitEnv(kbPath, r.url || ''); })
      .then(function(env) { return gitService.fetchRemote(absKbPath(kbPath), env); });
  });
  ipcMain.handle('git:push', function(e, kbPath) {
    return gitService.getRemote(absKbPath(kbPath))
      .then(function(r) { return gitAuth.buildGitEnv(kbPath, r.url || ''); })
      .then(function(env) { return gitService.push(absKbPath(kbPath), env); });
  });
  ipcMain.handle('git:pull', function(e, kbPath) {
    return gitService.getRemote(absKbPath(kbPath))
      .then(function(r) { return gitAuth.buildGitEnv(kbPath, r.url || ''); })
      .then(function(env) { return gitService.pull(absKbPath(kbPath), env); });
  });
  ipcMain.handle('git:conflict:list', function(e, kbPath) { return gitService.getConflictList(absKbPath(kbPath)); });
  ipcMain.handle('git:conflict:show', function(e, kbPath, filePath) {
    return gitService.getConflictContent(absKbPath(kbPath), filePath)
      .then(function(result) {
        if (result.ok && !result.isBinary && filePath.endsWith('_meta.json')) {
          var autoMerge = gitService.autoMergeMetaJson(result.ours, result.theirs);
          result.autoMerge = autoMerge.ok ? autoMerge.merged : null;
        }
        return result;
      });
  });
  ipcMain.handle('git:conflict:resolve', function(e, kbPath, filePath, content) {
    return gitService.resolveConflict(absKbPath(kbPath), filePath, content);
  });
  ipcMain.handle('git:conflict:complete', function(e, kbPath) {
    return gitService.completeConflictResolution(absKbPath(kbPath));
  });
  ipcMain.handle('git:auth:setToken', function(e, kbPath, token) { return gitAuth.saveToken(kbPath, token); });
  ipcMain.handle('git:auth:getSSHKey', function() { return gitAuth.getSSHPublicKey(); });
  ipcMain.handle('git:auth:setAuthType', function(e, kbPath, authType) { return gitAuth.setAuthType(kbPath, authType); });
  ipcMain.handle('git:auth:getAuthType', function(e, kbPath) { return gitAuth.getAuthType(kbPath); });
}

// ============================================================
// 5. APP LIFECYCLE
// ============================================================
var win = null;

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-software-rasterizer');

if (process.env.TOPOMIND_PROFILE && process.env.TOPOMIND_PROFILE !== 'prod') {
  app.setName('TopoMind-' + process.env.TOPOMIND_PROFILE);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'TopoMind',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  win.webContents.on('console-message', function(e, level, msg, line, src) {
    if (process.env.VITE_DEV_SERVER_URL) console.log('[renderer]', msg);
  });
}

function buildMenu() {
  var tpl = [
    { label: '文件', submenu: [{ role: 'quit', label: '退出' }] },
    { label: '编辑', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ]},
    { label: '视图', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ]},
  ];
  if (process.platform === 'darwin') {
    tpl.unshift({ label: app.getName(), submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'hide' },
      { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ]});
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(function() {
  registerIPC();
  buildMenu();
  createWindow();
  app.on('activate', function() { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', function() { if (process.platform !== 'darwin') app.quit(); });

app.on('before-quit', function() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('save:before-quit');
  }
});
