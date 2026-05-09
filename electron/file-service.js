/**
 * File Service - 文件系统操作服务
 * 封装工作目录、知识库、卡片和文件的基础读写能力。
 */
import nodePath from 'path';
import nodeFs from 'fs';
import { dialog } from 'electron';

// _config.json配置文件对象配置
let _fs_config = {
  defaultEdgeStyle: {
    lineMode: 'smoothstep', 
    lineStyle: 'solid', 
    color: '#7f8c8d', 
    arrow: true 
  } 
};

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

/**
* @description 加载根目录_config.json配置
* @returns { void }
* @param { string } dir: 工作目录路径
* @throws { Error } 路径为相对路径时抛出错误
*/
function _fs_loadAppConfig(dir) {
  try {
    var cfgPath = _fs_appConfigPath(dir);
    if (nodeFs.existsSync(cfgPath)) {
      var loaded = JSON.parse(nodeFs.readFileSync(cfgPath, 'utf-8')) || {};
      _fs_config = {
        defaultEdgeStyle: (loaded.defaultEdgeStyle && typeof loaded.defaultEdgeStyle === 'object')
          ? loaded.defaultEdgeStyle
          : { lineMode: 'smoothstep', lineStyle: 'solid', color: '#7f8c8d', arrow: true },
      };
    } else {
      _fs_config = { defaultEdgeStyle: { lineMode: 'smoothstep', lineStyle: 'solid', color: '#7f8c8d', arrow: true } };
    }
  } catch (e) {
    _fs_config = { defaultEdgeStyle: { lineMode: 'smoothstep', lineStyle: 'solid', color: '#7f8c8d', arrow: true } };
  }
}

// TODO：这个函数感觉并不需要，保存应该做一个更通用的接口
function _fs_saveAppConfig() {
  try {
    _fs_ensureDir();
    _fs_ensureDir(_fs_kbsDir());
    _fs_ensureDir(_fs_logsDir());
    nodeFs.writeFileSync(_fs_appConfigPath(), JSON.stringify(_fs_config, null, 2), 'utf-8');
  } catch (e) {
    // 静默处理：配置保存失败不影响应用运行
  }
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
* @returns { boolean } 是否为有效工作目录
* @param { string } dirPath: 工作目录路径
* @throws { Error } 路径为相对路径时抛出错误
*/
function _fs_isValidWorkDir(dirPath) {
  try {
    return dirPath
      && nodeFs.existsSync(dirPath)
      && nodeFs.statSync(dirPath).isDirectory()
      && nodeFs.existsSync(nodePath.join(dirPath, '_config.json'))
      && nodeFs.existsSync(_fs_kbsDir(dirPath))
      && nodeFs.existsSync(_fs_logsDir(dirPath));
  } catch (e) { return false; }
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

function _fs_abs(relPath) {
  var resolvedRoot = nodePath.resolve(_fs_kbsDir());
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

function createFileService() {
  return {
    readAppConfig: function() {
      return _fs_readJsonFile(_fs_appConfigPath()) || { defaultEdgeStyle: { lineMode: 'smoothstep', lineStyle: 'solid', color: '#7f8c8d', arrow: true } };
    },

    writeAppConfig: function(content) {
      var data = content;
      if (typeof content === 'string') {
        try { data = JSON.parse(content); } catch (e) { data = {}; }
      }
      _fs_config = {
        defaultEdgeStyle: (data.defaultEdgeStyle && typeof data.defaultEdgeStyle === 'object')
          ? data.defaultEdgeStyle
          : { lineMode: 'smoothstep', lineStyle: 'solid', color: '#7f8c8d', arrow: true },
      };
      _fs_saveAppConfig();
      return _fs_config;
    },

    createWorkDir: function(dirPath) {
      var dir = nodePath.resolve(dirPath);
      if (nodeFs.existsSync(dir) && !_fs_isDirEmpty(dir)) {
        throw new Error('工作目录必须是空目录');
      }
      _fs_ensureDir(dir);
      _fs_ensureDir(_fs_kbsDir(dir));
      _fs_ensureDir(_fs_logsDir(dir));
      _fs_rootDir = dir;
      _fs_config = { defaultEdgeStyle: { lineMode: 'smoothstep', lineStyle: 'solid', color: '#7f8c8d', arrow: true } };
      _fs_saveAppConfig();
      return { valid: true, nodePath: _fs_rootDir };
    },


    /**
    * @description 选择工作目录候选者
    * @returns { valid: boolean, nodePath: string | null, error?: string }
    * @param { boolean } valid: 是否选择成功
    * @param { string | null } nodePath: 选择的工作目录路径
    * @param { string | null } error: 选择失败的原因
    */
    selectWorkDirCandidate: function() {
      var result = dialog.showOpenDialogSync({
        title: '选择工作目录',
        properties: ['openDirectory'],
      });
      if (!result || !result[0]) return { valid: false, nodePath: null, error: '已取消选择' };
      return { valid: true, nodePath: nodePath.resolve(result[0]) };
    },

    /** 
    * @description 设置工作目录：检查目录是否存在 -> 是否为有效工作目录 -> 加载根目录_config.json配置
    * @returns { valid: boolean, nodePath: string | null, error?: string }
    * @param { string } dirPath: 工作目录路径
    * @param { boolean } valid: 是否设置成功
    * @param { string | null } nodePath: 设置的工作目录路径
    * @param { string | null } error: 设置失败的原因
    */
    setWorkDir: function(dirPath) {
      var dir = dirPath;
      if (!dir) {
        return { valid: false, nodePath: null, error: '工作目录路径为空' };      }
      dir = _fs_validateAbsolutePath(dir);
      if (!_fs_isValidWorkDir(dir)) {
        return { valid: false, nodePath: dir, error: '不是有效的工作目录' };
      }
      _fs_loadAppConfig(dir);
      return { valid: true, nodePath: _fs_rootDir };
    },

    initWorkDir: function() {
      if (!_fs_rootDir) return { valid: false, nodePath: null, error: '未选择工作目录' };
      _fs_ensureDir(_fs_rootDir);
      _fs_ensureDir(_fs_kbsDir());
      _fs_ensureDir(_fs_logsDir());
      if (!nodeFs.existsSync(_fs_appConfigPath())) {
        _fs_config = { defaultEdgeStyle: { lineMode: 'smoothstep', lineStyle: 'solid', color: '#7f8c8d', arrow: true } };
        _fs_saveAppConfig();
      }
      return { valid: true, nodePath: _fs_rootDir };
    },

    listChildren: function(parentPath) {
      var dir = _fs_abs(parentPath);
      _fs_ensureDir(_fs_kbsDir());
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

    mkDir: function(dirPath, _meta, customRootDir) {
      var parent = customRootDir ? nodePath.resolve(customRootDir) : _fs_kbsDir();
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

    renameKB: function(kbPath, newName) {
      var d = _fs_abs(kbPath);
      if (!nodeFs.existsSync(d)) return null;
      var parentDir = _fs_kbsDir();
      var newSafeName = _fs_safeSegment(newName);
      var newDirName = _fs_uniqueFolderName(parentDir, newSafeName);
      var oldDirName = nodePath.basename(d);
      var newDir = nodePath.join(parentDir, newDirName);
      if (oldDirName !== newDirName) {
        nodeFs.renameSync(d, newDir);
      }
      var newRelPath = nodePath.relative(_fs_kbsDir(), newDir).split(nodePath.sep).join('/');
      return newRelPath;
    },

    readGraphMeta: function(dirPath) {
      var d = _fs_abs(dirPath);
      var graph = _fs_readJsonFile(_fs_graphFilePath(d));
      if (graph) return graph;
      return { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null };
    },

    writeGraphMeta: function(dirPath, meta) {
      var d = _fs_abs(dirPath);
      if (!nodeFs.existsSync(d)) {
        var segments = dirPath.split('/').filter(Boolean);
        var parent = _fs_kbsDir();
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

    importKB: function(sourcePath) {
      var src = nodePath.resolve(sourcePath);
      if (!nodeFs.existsSync(src)) throw new Error('源目录不存在: ' + src);
      if (!nodeFs.existsSync(nodePath.join(src, '_graph.json'))) {
        throw new Error('不是有效的知识库目录');
      }
      var kbName = nodePath.basename(src);
      _fs_ensureDir(_fs_kbsDir());
      var destName = _fs_uniqueFolderName(_fs_kbsDir(), kbName);
      var dest = nodePath.join(_fs_kbsDir(), destName);
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

      return nodePath.relative(_fs_kbsDir(), dest).split(nodePath.sep).join('/');
    },
  };
}

// Singleton instance — internal methods use this instead of re-creating via factory
const fileService = createFileService();

export { createFileService, fileService };
export default fileService;
