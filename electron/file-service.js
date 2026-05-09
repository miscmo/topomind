/**
 * File Service - 文件系统操作服务
 * 封装工作目录、知识库、卡片和文件的基础读写能力。
 */
import nodePath from 'path';
import nodeFs from 'fs';

function _fs_defaultAppConfig() {
  return { defaultEdgeStyle: { lineMode: 'smoothstep', lineStyle: 'solid', color: '#7f8c8d', arrow: true } };
}

// 返回dir/kbs知识库目录
function _fs_kbsDir(dir) {
  return nodePath.join(dir, 'kbs');
}

// 返回dir/logs日志目录
function _fs_logsDir(dir) {
  return nodePath.join(dir, 'logs');
}

// 返回dir/_config.json配置文件路径
function _fs_appConfigPath(dir) {
  return nodePath.join(dir, '_config.json');
}

function _fs_isDirEmpty(dirPath) {
  try {
    if (!nodeFs.existsSync(dirPath))
      return true;
    return nodeFs.readdirSync(dirPath).length === 0;
  } catch (e) { return false; }
}

/**
* @description 验证路径是否为有效工作目录：工作目录存在且为目录  -> 存在_config.json -> 存在kbs目录 -> 存在logs目录
* @returns { { valid: boolean, error?: string } } 工作目录校验结果
* @param { string } dirPath: 工作目录路径
* @throws { Error } 路径为相对路径时抛出错误
*/
function _fs_isValidWorkDir(dirPath) {
  try {
    if (!dirPath) return { valid: false, error: '工作目录路径为空' };
    if (!nodeFs.existsSync(dirPath)) return { valid: false, error: '工作目录不存在' };
    if (!nodeFs.statSync(dirPath).isDirectory()) return { valid: false, error: '工作目录路径不是文件夹' };
    if (!nodeFs.existsSync(nodePath.join(dirPath, '_config.json'))) return { valid: false, error: '缺少工作目录配置文件 _config.json' };
    if (!nodeFs.existsSync(_fs_kbsDir(dirPath))) return { valid: false, error: '缺少知识库目录 kbs' };
    if (!nodeFs.existsSync(_fs_logsDir(dirPath))) return { valid: false, error: '缺少日志目录 logs' };
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e && e.message ? e.message : '工作目录校验失败' };
  }
}

/**
 * @description 确保目录存在
 * @param { string } d: 目录路径
 * @returns { void }
 */
function _fs_ensureDir(d) {
  if (!nodeFs.existsSync(d))
    nodeFs.mkdirSync(d, { recursive: true });
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

function _fs_abs(rootDir, relPath) {
  var resolvedRoot = nodePath.resolve(_fs_kbsDir(rootDir));
  if (!relPath) return resolvedRoot;
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

/**
 * 验证路径必须是绝对路径，否则抛出错误，返回标准化后的绝对路径
 * @param {string} dir - 传入的路径
 * @returns {string} 标准化后的绝对路径
 * @throws {Error} 路径为相对路径时抛出错误
 */
function _fs_validateAbsolutePath(dir) {
  if (!nodePath.isAbsolute(dir)) {
    throw new Error('路径必须是绝对路径');
  }
  // 消除路径中的./ ../ 多余斜杠，标准化绝对路径
  return nodePath.resolve(dir);
}

const fileService = {
    readAppConfig: function(rootDir) {
      return _fs_readJsonFile(_fs_appConfigPath(rootDir)) || _fs_defaultAppConfig();
    },

    writeAppConfig: function(rootDir, content) {
      var data = content;
      if (typeof content === 'string') {
        try { data = JSON.parse(content); } catch (e) { data = {}; }
      }
      var config = {
        defaultEdgeStyle: (data.defaultEdgeStyle && typeof data.defaultEdgeStyle === 'object')
          ? data.defaultEdgeStyle
          : _fs_defaultAppConfig().defaultEdgeStyle,
      };
      _fs_ensureDir(rootDir);
      nodeFs.writeFileSync(_fs_appConfigPath(rootDir), JSON.stringify(config, null, 2), 'utf-8');
      return config;
    },

    createWorkDir: function(dirPath) {
      var dir = nodePath.resolve(dirPath);
      if (nodeFs.existsSync(dir) && !_fs_isDirEmpty(dir)) {
        throw new Error('工作目录必须是空目录');
      }
      _fs_ensureDir(dir);
      _fs_ensureDir(_fs_kbsDir(dir));
      _fs_ensureDir(_fs_logsDir(dir));
      nodeFs.writeFileSync(_fs_appConfigPath(dir), JSON.stringify(_fs_defaultAppConfig(), null, 2), 'utf-8');
      return { valid: true, nodePath: dir };
    },

    /**
    * @description 校验工作目录：检查目录是否存在且为有效工作目录
    * @returns { valid: boolean, nodePath: string | null, error?: string }
    * @param { string } dirPath: 工作目录路径
    * @param { boolean } valid: 是否校验成功
    * @param { string | null } nodePath: 校验的工作目录路径
    * @param { string | null } error: 校验失败的原因
    */
    isValidWorkDir: function(dirPath) {
      var dir = dirPath;
      if (!dir) {
        return { valid: false, nodePath: null, error: '工作目录路径为空' };
      }
      dir = _fs_validateAbsolutePath(dir);
      var validation = _fs_isValidWorkDir(dir);
      if (!validation.valid) {
        return { valid: false, nodePath: dir, error: validation.error || '不是有效的工作目录' };
      }
      return { valid: true, nodePath: dir };
    },

    listChildren: function(rootDir, parentPath) {
      var dir = _fs_abs(rootDir, parentPath);
      _fs_ensureDir(_fs_kbsDir(rootDir));
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
          return { path: childPath, name: safeName, isDir: true };
        });
      children.sort(function(a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      });
      return children;
    },

    mkDir: function(rootDir, dirPath, _meta) {
      var parent = _fs_kbsDir(rootDir);
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

    rmDir: function(rootDir, dirPath) {
      var d = _fs_abs(rootDir, dirPath);
      if (nodeFs.existsSync(d)) nodeFs.rmSync(d, { recursive: true, force: true });
    },

    renameKB: function(rootDir, kbPath, newName) {
      var d = _fs_abs(rootDir, kbPath);
      if (!nodeFs.existsSync(d)) return null;
      var parentDir = _fs_kbsDir(rootDir);
      var newSafeName = _fs_safeSegment(newName);
      var newDirName = _fs_uniqueFolderName(parentDir, newSafeName);
      var oldDirName = nodePath.basename(d);
      var newDir = nodePath.join(parentDir, newDirName);
      if (oldDirName !== newDirName) {
        nodeFs.renameSync(d, newDir);
      }
      var newRelPath = nodePath.relative(_fs_kbsDir(rootDir), newDir).split(nodePath.sep).join('/');
      return newRelPath;
    },

    readGraphMeta: function(rootDir, dirPath) {
      var d = _fs_abs(rootDir, dirPath);
      var graph = _fs_readJsonFile(_fs_graphFilePath(d));
      if (graph) return graph;
      return { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null };
    },

    writeGraphMeta: function(rootDir, dirPath, meta) {
      var d = _fs_abs(rootDir, dirPath);
      if (!nodeFs.existsSync(d)) {
        var segments = dirPath.split('/').filter(Boolean);
        var parent = _fs_kbsDir(rootDir);
        for (var i = 0; i < segments.length - 1; i++) {
          parent = nodePath.join(parent, _fs_safeSegment(segments[i]));
          _fs_ensureDir(parent);
        }
        _fs_ensureDir(d);
      }
      var graphMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
      _fs_writeJsonFile(_fs_graphFilePath(d), graphMeta);
    },

    updateCardMeta: function(rootDir, cardPath, newName) {
      var parentPath = cardPath.includes('/') ? cardPath.slice(0, cardPath.lastIndexOf('/')) : '';
      var parentDir = _fs_abs(rootDir, parentPath);
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

    getDir: function(rootDir, dirPath) {
      var d = _fs_abs(rootDir, dirPath);
      if (!nodeFs.existsSync(d)) return null;
      return { nodePath: dirPath };
    },

    readFile: function(rootDir, filePath) {
      var f = _fs_abs(rootDir, filePath);
      if (nodeFs.existsSync(f)) return nodeFs.readFileSync(f, 'utf-8');
      return '';
    },

    writeFile: function(rootDir, filePath, content) {
      var f = _fs_abs(rootDir, filePath);
      _fs_ensureDir(nodePath.dirname(f));
      nodeFs.writeFileSync(f, content, 'utf-8');
    },

    deleteFile: function(rootDir, filePath) {
      var f = _fs_abs(rootDir, filePath);
      if (nodeFs.existsSync(f)) nodeFs.unlinkSync(f);
    },

    importKB: function(rootDir, sourcePath) {
      var src = nodePath.resolve(sourcePath);
      if (!nodeFs.existsSync(src)) throw new Error('源目录不存在: ' + src);
      if (!nodeFs.existsSync(nodePath.join(src, '_graph.json'))) {
        throw new Error('不是有效的知识库目录');
      }
      var kbName = nodePath.basename(src);
      _fs_ensureDir(_fs_kbsDir(rootDir));
      var destName = _fs_uniqueFolderName(_fs_kbsDir(rootDir), kbName);
      var dest = nodePath.join(_fs_kbsDir(rootDir), destName);
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

      return nodePath.relative(_fs_kbsDir(rootDir), dest).split(nodePath.sep).join('/');
    },
  };

export { fileService };
export default fileService;
