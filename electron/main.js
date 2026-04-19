/**
 * Electron 主进程 - 合并版
 * 所有 electron 源码合并到单个文件，确保生产构建能正确打包
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } = require('electron');
const path = require('path');
const nodeFs = require('fs');
const { simpleGit } = require('simple-git');
const { execFile } = require('child_process');
const LogService = require('./log-service.js');

// ============================================================
// 1. FILE-SERVICE（from electron/file-service.js）
// ============================================================
let _fs_rootDir = '';
let _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };

/**
 * 返回工作目录下应用配置文件 `_config.json` 的绝对路径。
 *
 * @param {string} [dir] 可选的工作目录绝对路径
 * @returns {string} 配置文件绝对路径
 */
function _fs_appConfigPath(dir) {
  return path.join(dir || _fs_rootDir, '_config.json');
}

/**
 * 从工作目录加载应用级配置，并兼容旧版本配置结构。
 * 加载失败时会回退为默认配置，避免阻塞应用启动。
 *
 * @param {string} dir 工作目录绝对路径
 * @returns {void}
 */
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

/**
 * 将当前应用配置持久化到工作目录。
 * 配置写入失败时静默忽略，不中断主流程。
 *
 * @returns {void}
 */
function _fs_saveAppConfig() {
  try {
    _fs_ensureDir(_fs_rootDir);
    nodeFs.writeFileSync(_fs_appConfigPath(), JSON.stringify(_fs_config, null, 2), 'utf-8');
  } catch (e) {
    // 静默处理：配置保存失败不影响应用运行
  }
}

/**
 * 判断目录是否不存在或为空目录。
 * 读取失败时返回 `false`，避免把异常目录误判为空。
 *
 * @param {string} dirPath 目录绝对路径
 * @returns {boolean} 是否为空目录
 */
function _fs_isDirEmpty(dirPath) {
  try {
    if (!nodeFs.existsSync(dirPath)) return true;
    return nodeFs.readdirSync(dirPath).length === 0;
  } catch (e) { return false; }
}

/**
 * 判断给定目录是否为有效的 TopoMind 工作目录。
 * 当前规则要求目录存在且包含 `_config.json`。
 *
 * @param {string} dirPath 目录绝对路径
 * @returns {boolean} 是否为有效工作目录
 */
function _fs_isValidWorkDir(dirPath) {
  try {
    if (!dirPath || !nodeFs.existsSync(dirPath)) return false;
    var stat = nodeFs.statSync(dirPath);
    if (!stat.isDirectory()) return false;
    return nodeFs.existsSync(path.join(dirPath, '_config.json'));
  } catch (e) { return false; }
}

/**
 * 确保目录存在，不存在时递归创建。
 *
 * @param {string} d 目录绝对路径
 * @returns {void}
 */
function _fs_ensureDir(d) {
  if (!nodeFs.existsSync(d)) nodeFs.mkdirSync(d, { recursive: true });
}

/**
 * 清洗单个路径片段，使其可安全作为目录名或文件名使用。
 * 会替换非法字符、去掉结尾的点和空格，并对空名称、`.`、`..` 做兜底处理。
 *
 * @param {string} name 原始名称
 * @returns {string} 清洗后的安全名称
 */
function _fs_safeSegment(name) {
  var s = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '');
  if (!s || s === '.' || s === '..') s = 'untitled';
  return s.slice(0, 80);
}

/**
 * 在指定父目录下生成一个不与现有目录重名的安全目录名。
 * 如基础名称已存在，则自动追加 `-1`、`-2` 等后缀。
 *
 * @param {string} parentDir 父目录绝对路径
 * @param {string} desiredName 期望目录名
 * @returns {string} 可用的唯一目录名
 */
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

/**
 * 将相对工作目录的路径解析为绝对路径，并阻止越界访问根目录之外的文件。
 *
 * @param {string} relPath 相对工作目录的路径
 * @returns {string} 解析后的绝对路径
 * @throws {Error} 当路径解析结果超出工作目录根路径时抛出异常
 */
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

/**
 * 读取 JSON 文件内容；文件不存在或解析失败时返回 `null`。
 *
 * @param {string} filePath JSON 文件绝对路径
 * @returns {object|null} 解析后的对象或 `null`
 */
function _fs_readJsonFile(filePath) {
  if (!nodeFs.existsSync(filePath)) return null;
  try { return JSON.parse(nodeFs.readFileSync(filePath, 'utf-8')); } catch (e) { return null; }
}

/**
 * 将对象以格式化 JSON 的形式写入指定文件。
 * 当 `data` 为空时写入空对象，保证文件结构稳定。
 *
 * @param {string} filePath JSON 文件绝对路径
 * @param {object} data 要写入的数据对象
 * @returns {void}
 */
function _fs_writeJsonFile(filePath, data) {
  nodeFs.writeFileSync(filePath, JSON.stringify(data || {}, null, 2), 'utf-8');
}

/**
 * 返回目录下图数据文件 `_graph.json` 的绝对路径。
 *
 * @param {string} dir 目录绝对路径
 * @returns {string} 图数据文件绝对路径
 */
function _fs_graphFilePath(dir) {
  return path.join(dir, '_graph.json');
}

// Public file-service API
var fileService = {
  /**
   * 设置当前工作目录并初始化默认应用配置。
   *
   * @param {string} dir 工作目录绝对路径
   * @returns {void}
   */
  setRootDir: function(dir) {
    _fs_rootDir = dir;
    _fs_ensureDir(_fs_rootDir);
    _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };
    _fs_saveAppConfig();
  },

  /**
   * 获取当前工作目录绝对路径。
   *
   * @returns {string} 工作目录绝对路径
   */
  getRootDir: function() { return _fs_rootDir; },

  /**
   * 获取上次打开的知识库路径。
   *
   * @returns {string|null} 上次打开的知识库路径
   */
  getLastOpenedKB: function() { return _fs_config.lastOpenedKB || null; },

  /**
   * 记录上次打开的知识库路径并持久化。
   *
   * @param {string|null} kbPath 知识库路径
   * @returns {void}
   */
  setLastOpenedKB: function(kbPath) {
    _fs_config.lastOpenedKB = kbPath || null;
    _fs_saveAppConfig();
  },

  /**
   * 创建新的工作目录，并初始化应用配置文件。
   * 目标目录若已存在，则必须为空目录。
   *
   * @param {string} dirPath 目标工作目录路径
   * @returns {{valid: boolean, path: string}} 创建结果
   * @throws {Error} 当目标目录非空时抛出异常
   */
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

  /**
   * 弹出系统目录选择框，供用户挑选工作目录候选路径。
   *
   * @returns {{valid: boolean, path: string|null, error?: string}} 选择结果
   */
  selectWorkDirCandidate: function() {
    var result = dialog.showOpenDialogSync({
      title: '选择工作目录',
      properties: ['openDirectory'],
    });
    if (!result || !result[0]) return { valid: false, path: null, error: '已取消选择' };
    return { valid: true, path: path.resolve(result[0]) };
  },

  /**
   * 选择并校验已有工作目录；未传入路径时会先弹出目录选择框。
   *
   * @param {string} [dirPath] 目标工作目录路径
   * @returns {{valid: boolean, path: string|null, error?: string}} 校验结果
   */
  selectExistingWorkDir: function(dirPath) {
    var dir = dirPath;
    if (!dir) {
      var picked = fileService.selectWorkDirCandidate();
      if (!picked.valid) return picked;
      dir = picked.path;
    }
    dir = path.resolve(dir);
    if (!_fs_isValidWorkDir(dir)) {
      return { valid: false, path: dir, error: '不是有效的工作目录（缺少 _config.json）' };
    }
    _fs_rootDir = dir;
    _fs_loadAppConfig(dir);
    return { valid: true, path: _fs_rootDir };
  },

  /**
   * 初始化当前工作目录；若缺少配置文件则补写默认配置。
   *
   * @returns {{valid: boolean, path: string|null, error?: string}} 初始化结果
   */
  initWorkDir: function() {
    if (!_fs_rootDir) return { valid: false, path: null, error: '未选择工作目录' };
    _fs_ensureDir(_fs_rootDir);
    if (!nodeFs.existsSync(_fs_appConfigPath())) {
      _fs_config = { lastOpenedKB: null, orders: {}, covers: {} };
      _fs_saveAppConfig();
    }
    return { valid: true, path: _fs_rootDir };
  },

  /**
   * 列出指定目录下的直接子目录，并附带名称、封面和排序信息。
   * 子项显示名称优先读取父级 `_graph.json` 中的 children 元数据。
   *
   * @param {string} parentPath 相对工作目录的父级路径
   * @returns {Array<{path: string, name: string, cover: string, order: number}>} 子目录列表
   */
  listChildren: function(parentPath) {
    var dir = _fs_abs(parentPath);
    _fs_ensureDir(dir);
    // Read parent graph for child display names
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

  /**
   * 在工作目录或自定义根目录下创建目录，并初始化默认 `_graph.json`。
   * 中间层级会按安全路径片段逐级创建，最终目录名会自动避让重名。
   *
   * @param {string} dirPath 相对路径
   * @param {object} meta 当前未使用，保留给未来扩展
   * @param {string} [customRootDir] 可选的自定义根目录绝对路径
   * @returns {string} 创建后的目录绝对路径
   */
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
    if (!nodeFs.existsSync(_fs_graphFilePath(d))) {
      _fs_writeJsonFile(_fs_graphFilePath(d), { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null });
    }
    return d;
  },

  /**
   * 删除指定相对路径目录及其全部内容。
   * 目录不存在时不报错。
   *
   * @param {string} dirPath 相对工作目录的目录路径
   * @returns {void}
   */
  rmDir: function(dirPath) {
    var d = _fs_abs(dirPath);
    if (nodeFs.existsSync(d)) nodeFs.rmSync(d, { recursive: true, force: true });
  },

  /**
   * 保存知识库的排序值到应用配置中。
   *
   * @param {string} kbPath 知识库绝对路径
   * @param {number} order 排序值
   * @returns {void}
   */
  saveKBOrder: function(kbPath, order) {
    var relPath = path.relative(_fs_rootDir, kbPath).split(path.sep).join('/');
    _fs_config.orders[relPath] = Number.isFinite(order) ? order : 0;
    _fs_saveAppConfig();
  },

  /**
   * 获取知识库封面路径配置。
   *
   * @param {string} kbPath 知识库绝对路径
   * @returns {string|null} 封面相对路径或 `null`
   */
  getKBCover: function(kbPath) {
    var relPath = path.relative(_fs_rootDir, kbPath).split(path.sep).join('/');
    return _fs_config.covers[relPath] || null;
  },

  /**
   * 保存或清除知识库封面路径配置。
   * 传入空值时会删除已有封面配置。
   *
   * @param {string} kbPath 知识库绝对路径
   * @param {string|null} coverPath 封面相对路径
   * @returns {void}
   */
  saveKBCover: function(kbPath, coverPath) {
    var relPath = path.relative(_fs_rootDir, kbPath).split(path.sep).join('/');
    if (coverPath) {
      _fs_config.covers[relPath] = coverPath;
    } else {
      delete _fs_config.covers[relPath];
    }
    _fs_saveAppConfig();
  },

  /**
   * 重命名知识库目录，并同步更新配置中的排序和最近打开记录。
   * 若目标名称与现有目录冲突，会自动生成唯一目录名。
   *
   * @param {string} kbPath 相对工作目录的知识库路径
   * @param {string} newName 新的知识库名称
   * @returns {string|null} 重命名后的相对路径；目录不存在时返回 `null`
   */
  renameKB: function(kbPath, newName) {
    var d = _fs_abs(kbPath);
    if (!nodeFs.existsSync(d)) return null;
    var parentDir = _fs_rootDir;
    var newSafeName = _fs_safeSegment(newName);
    var newDirName = _fs_uniqueFolderName(parentDir, newSafeName);
    var oldDirName = path.basename(d);
    var newDir = path.join(parentDir, newDirName);
    var oldRelPath = path.relative(_fs_rootDir, d).split(path.sep).join('/');
    // Rename directory in place
    if (oldDirName !== newDirName) {
      nodeFs.renameSync(d, newDir);
    }
    // Update _config.json.orders with new relative path
    var newRelPath = path.relative(_fs_rootDir, newDir).split(path.sep).join('/');
    if (oldRelPath !== newRelPath) {
      var orderVal = _fs_config.orders[oldRelPath];
      delete _fs_config.orders[oldRelPath];
      _fs_config.orders[newRelPath] = orderVal;
      if (_fs_config.lastOpenedKB) {
        var lastRel = path.relative(_fs_rootDir, _fs_abs(_fs_config.lastOpenedKB)).split(path.sep).join('/');
        if (lastRel === oldRelPath) {
          _fs_config.lastOpenedKB = newDir;
        }
      }
      _fs_saveAppConfig();
    }
    return newRelPath;
  },
  /**
   * 读取指定目录的图元数据；若文件不存在则返回默认空图结构。
   *
   * @param {string} dirPath 相对工作目录的目录路径
   * @returns {{children: object, edges: Array, zoom: number|null, pan: object|null, canvasBounds: object|null}} 图元数据
   */
  readGraphMeta: function(dirPath) {
    var d = _fs_abs(dirPath);
    var graph = _fs_readJsonFile(_fs_graphFilePath(d));
    if (graph) return graph;
    return { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null };
  },

  /**
   * 惰性创建卡片目录及其默认 `_graph.json`。
   * 当目录已存在时直接返回，不重复写入。
   *
   * @param {string} cardPath 相对工作目录的卡片路径
   * @returns {void}
   */
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
    if (!nodeFs.existsSync(_fs_graphFilePath(d))) {
      _fs_writeJsonFile(_fs_graphFilePath(d), { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null });
    }
  },

  /**
   * 写入目录对应的图元数据；目录不存在时会先按层级惰性创建。
   * 非对象类型的 `meta` 会被回退为 `{}`。
   *
   * @param {string} dirPath 相对工作目录的目录路径
   * @param {object} meta 图元数据对象
   * @returns {void}
   */
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
    _fs_writeJsonFile(_fs_graphFilePath(d), graphMeta);
  },

  /**
   * 更新父级 `_graph.json` 中记录的卡片显示名称。
   * 仅更新元数据，不会真正重命名目录。
   *
   * @param {string} cardPath 相对工作目录的卡片路径
   * @param {string} newName 新显示名称
   * @returns {string} 原卡片路径
   */
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
  /**
   * 查询目录是否存在；存在时返回其相对路径描述对象。
   *
   * @param {string} dirPath 相对工作目录的目录路径
   * @returns {{path: string}|null} 目录描述对象或 `null`
   */
  getDir: function(dirPath) {
    var d = _fs_abs(dirPath);
    if (!nodeFs.existsSync(d)) return null;
    return { path: dirPath };
  },

  /**
   * 以 UTF-8 读取文本文件；文件不存在时返回空字符串。
   *
   * @param {string} filePath 相对工作目录的文件路径
   * @returns {string} 文件内容
   */
  readFile: function(filePath) {
    var f = _fs_abs(filePath);
    if (nodeFs.existsSync(f)) return nodeFs.readFileSync(f, 'utf-8');
    return '';
  },

  /**
   * 以 UTF-8 写入文本文件，必要时自动创建父目录。
   *
   * @param {string} filePath 相对工作目录的文件路径
   * @param {string} content 文本内容
   * @returns {void}
   */
  writeFile: function(filePath, content) {
    var f = _fs_abs(filePath);
    _fs_ensureDir(path.dirname(f));
    nodeFs.writeFileSync(f, content, 'utf-8');
  },

  /**
   * 删除指定文件；文件不存在时不报错。
   *
   * @param {string} filePath 相对工作目录的文件路径
   * @returns {void}
   */
  deleteFile: function(filePath) {
    var f = _fs_abs(filePath);
    if (nodeFs.existsSync(f)) nodeFs.unlinkSync(f);
  },

  /**
   * 将二进制数据写入指定文件，必要时自动创建父目录。
   *
   * @param {string} filePath 相对工作目录的文件路径
   * @param {ArrayBuffer} arrayBuffer 二进制数据
   * @returns {void}
   */
  writeBlobFile: function(filePath, arrayBuffer) {
    var f = _fs_abs(filePath);
    _fs_ensureDir(path.dirname(f));
    nodeFs.writeFileSync(f, Buffer.from(arrayBuffer));
  },

  /**
   * 读取二进制文件并返回 `ArrayBuffer` 视图；文件不存在时返回 `null`。
   *
   * @param {string} filePath 相对工作目录的文件路径
   * @returns {ArrayBuffer|null} 文件二进制内容
   */
  readBlobFile: function(filePath) {
    var f = _fs_abs(filePath);
    if (!nodeFs.existsSync(f)) return null;
    var buf = nodeFs.readFileSync(f);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  },

  /**
   * 清空工作目录下的所有非隐藏子目录，保留根目录本身。
   *
   * @returns {void}
   */
  clearAll: function() {
    var rootAbs = path.resolve(_fs_rootDir);
    if (!nodeFs.existsSync(rootAbs)) { _fs_ensureDir(rootAbs); return; }
    try {
      nodeFs.readdirSync(rootAbs, { withFileTypes: true }).forEach(function(e) {
        if (e.isDirectory() && !e.name.startsWith('.')) {
          nodeFs.rmSync(path.join(rootAbs, e.name), { recursive: true, force: true });
        }
      });
    } catch (e) {
      // 静默处理：目录删除失败不影响 clearAll 后续流程
    }
  },
  /**
   * 将已有知识库目录复制到当前工作目录下，并为其分配新的展示顺序。
   * 要求源目录至少包含 `_graph.json`，否则视为无效知识库。
   *
   * @param {string} sourcePath 源知识库目录路径
   * @returns {string} 导入后知识库相对于工作目录的路径
   * @throws {Error} 当源目录不存在或不符合知识库结构时抛出异常
   */
  importKB: function(sourcePath) {
    var src = path.resolve(sourcePath);
    if (!nodeFs.existsSync(src)) throw new Error('源目录不存在: ' + src);
    if (!nodeFs.existsSync(path.join(src, '_graph.json'))) {
      throw new Error('不是有效的知识库目录');
    }
    var kbName = path.basename(src);
    var destName = _fs_uniqueFolderName(_fs_rootDir, kbName);
    var dest = path.join(_fs_rootDir, destName);
    _fs_ensureDir(dest);

    /**
     * 递归复制知识库目录内容，跳过 `node_modules` 目录。
     * 文本文件按 UTF-8 读写，其余文件按二进制复制。
     *
     * @param {string} srcDir 当前源目录
     * @param {string} destDir 当前目标目录
     * @returns {void}
     */
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

/**
 * 检查当前运行环境是否可用 `git` 命令，并缓存结果避免重复探测。
 *
 * @returns {Promise<boolean>} Git 是否可用
 */
function _git_checkAvailable() {
  if (_gitAvailable !== null) return Promise.resolve(_gitAvailable);
  return new Promise(function(resolve) {
    execFile('git', ['--version'], { timeout: 5000 }, function(err, stdout) {
      if (err) { _gitAvailable = false; resolve(false); }
      else { _gitAvailable = true; resolve(true); }
    });
  });
}

/**
 * 为异步 Git 操作添加超时保护，避免主进程无限等待。
 *
 * @param {Promise<any>} promise 原始异步操作
 * @param {number} ms 超时时间，单位毫秒
 * @param {string} [operation] 操作名称，用于错误提示
 * @returns {Promise<any>} 带超时保护的 Promise
 */
function _git_withTimeout(promise, ms, operation) {
  var timeout = new Promise(function(_, reject) {
    setTimeout(function() {
      reject(new Error((operation || 'git') + ' 超时（' + (ms / 1000) + 's）'));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

/**
 * 将系统路径分隔符统一转换为 Git 兼容的正斜杠路径。
 *
 * @param {string} p 文件路径
 * @returns {string} Git 风格路径
 */
function _git_toGitPath(p) {
  return p.split(path.sep).join('/');
}

/**
 * 基于知识库绝对路径创建 simple-git 实例，并附加额外环境变量。
 *
 * @param {string} absPath 知识库绝对路径
 * @param {object} [env] 额外环境变量
 * @returns {import('simple-git').SimpleGit} simple-git 实例
 * @throws {Error} 当目录不存在时抛出异常
 */
function _git_sg(absPath, env) {
  if (!nodeFs.existsSync(absPath)) {
    throw new Error('Directory does not exist: ' + absPath);
  }
  return simpleGit(absPath).env(Object.assign({}, process.env, env || {}));
}

var gitService = {
  /**
   * 检查当前环境是否支持 Git 操作。
   *
   * @returns {Promise<boolean>} Git 是否可用
   */
  checkGitAvailable: function() { return _git_checkAvailable(); },

  /**
   * 在知识库目录中初始化 Git 仓库，并在首次初始化时生成默认提交。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @returns {Promise<{ok: boolean, code?: string, alreadyInit?: boolean}>} 初始化结果
   */
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

  /**
   * 获取知识库仓库状态，包括是否初始化、是否有未提交变更、冲突和远程同步关系。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @returns {Promise<object>} 仓库状态对象
   */
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

  /**
   * 批量获取多个知识库的 Git 状态，并限制并发数以降低资源占用。
   *
   * @param {string[]} absKbPaths 知识库绝对路径列表
   * @returns {Promise<Record<string, object>>} 以绝对路径为键的状态映射
   */
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

  /**
   * 判断知识库仓库是否存在未提交变更。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @returns {Promise<boolean>} 是否存在未提交变更
   */
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

  /**
   * 将当前知识库目录中的所有变更加入暂存区并提交。
   * 未提供提交信息时会根据改动内容自动生成消息。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {string} [message] 可选的提交信息
   * @returns {Promise<object>} 提交结果
   */
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

  /**
   * 获取工作区或指定提交范围的文本差异，可按文件进一步过滤。
   * 默认会合并 staged 与 unstaged 的变更结果。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {{from?: string, to?: string, file?: string}} [opts] Diff 选项
   * @returns {Promise<{ok: boolean, code?: string, diff?: string}>} 差异结果
   */
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

  /**
   * 获取工作区或指定提交范围的 diff 统计摘要。
   * 默认会合并 staged 与 unstaged 的统计信息。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {{from?: string, to?: string}} [opts] Diff 选项
   * @returns {Promise<{ok: boolean, code?: string, stat?: string}>} 统计结果
   */
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

  /**
   * 获取工作区或指定提交范围内涉及的文件列表及增删统计。
   * 会补充标记元数据文件、文档文件和图片文件类型。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {{from?: string, to?: string}} [opts] Diff 选项
   * @returns {Promise<{ok: boolean, code?: string, files?: Array<object>}>} 文件列表结果
   */
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
                  isMeta: fp.endsWith('_graph.json'),
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
                      isMeta: fp.endsWith('_graph.json'),
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

  /**
   * 获取知识库最近的提交历史。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {{limit?: number}} [opts] 查询选项
   * @returns {Promise<{ok: boolean, code?: string, commits?: Array<object>}>} 提交历史结果
   */
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

  /**
   * 获取指定提交涉及的文件列表及增删统计。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {string} hash 提交哈希
   * @returns {Promise<{ok: boolean, code?: string, files?: Array<object>}>} 文件列表结果
   */
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
              isMeta: parts[2].endsWith('_graph.json'),
              isDoc: parts[2].endsWith('README.md'),
              isImage: /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(parts[2]),
            });
          });
          return { ok: true, files: files };
        });
    });
  },

  /**
   * 获取指定提交中某个文件的 diff 文本。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {string} hash 提交哈希
   * @param {string} filePath 文件相对路径
   * @returns {Promise<{ok: boolean, code?: string, diff?: string}>} 文件差异结果
   */
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

  /**
   * 获取仓库的 `origin` 远程地址。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @returns {Promise<{ok: boolean, code?: string, url?: string}>} 远程地址结果
   */
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

  /**
   * 设置仓库的 `origin` 远程地址；若不存在则自动添加。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {string} url 远程仓库地址
   * @returns {Promise<{ok: boolean, code?: string}>} 设置结果
   */
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

  /**
   * 从远程仓库抓取最新引用信息，不会直接修改工作区内容。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {object} [env] 认证相关环境变量
   * @returns {Promise<{ok: boolean, code?: string, error?: string}>} 抓取结果
   */
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

  /**
   * 将当前分支推送到 `origin`，并在首次推送时设置上游分支。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {object} [env] 认证相关环境变量
   * @returns {Promise<{ok: boolean, code?: string, error?: string}>} 推送结果
   */
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

  /**
   * 从远程拉取并合并当前分支的最新提交。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {object} [env] 认证相关环境变量
   * @returns {Promise<{ok: boolean, code?: string, error?: string}>} 拉取结果
   */
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

  /**
   * 获取当前仓库中处于冲突状态的文件列表。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @returns {Promise<{ok: boolean, code?: string, files?: string[]}>} 冲突文件列表
   */
  getConflictList: function(absKbPath) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var git = _git_sg(absKbPath);
      return git.status().then(function(status) {
        return { ok: true, files: status.conflicted || [] };
      });
    });
  },

  /**
   * 读取冲突文件的三方内容：本地版本、远端版本和当前工作区内容。
   * 二进制文件不会读取文本内容，仅返回冲突元信息。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {string} filePath 冲突文件相对路径
   * @returns {Promise<object>} 冲突内容结果
   */
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

  /**
   * 使用给定内容覆盖冲突文件，并将其加入暂存区，标记为已解决。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @param {string} filePath 冲突文件相对路径
   * @param {string} resolvedContent 解决后的文件内容
   * @returns {Promise<{ok: boolean, code?: string}>} 解决结果
   */
  resolveConflict: function(absKbPath, filePath, resolvedContent) {
    return _git_checkAvailable().then(function(available) {
      if (!available) return { ok: false, code: 'GIT_NOT_FOUND' };
      var absFilePath = path.join(absKbPath, filePath);
      nodeFs.writeFileSync(absFilePath, resolvedContent, 'utf-8');
      var git = _git_sg(absKbPath);
      return git.add(_git_toGitPath(filePath)).then(function() { return { ok: true }; });
    });
  },

  /**
   * 在确认所有冲突已解决后，创建一次合并完成提交。
   *
   * @param {string} absKbPath 知识库绝对路径
   * @returns {Promise<{ok: boolean, code?: string, error?: string, hash?: string}>} 完成结果
   */
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

  /**
   * 尝试自动合并两个 `_graph.json` 内容，合并 children、edges 和画布边界。
   *
   * @param {string} oursStr 本地版本 JSON 字符串
   * @param {string} theirsStr 远端版本 JSON 字符串
   * @returns {{ok: boolean, merged?: string, error?: string}} 自动合并结果
   */
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

/**
 * 获取当前分支相对上游分支的 ahead / behind 数量。
 * 未配置上游分支时回退为 `0/0`。
 *
 * @param {import('simple-git').SimpleGit} git simple-git 实例
 * @returns {Promise<{ahead: number, behind: number}>} 远程同步状态
 */
function _git_getRemoteState(git) {
  return git.raw(['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
    .then(function(out) {
      var parts = out.trim().split(/\s+/);
      return { ahead: parseInt(parts[0]) || 0, behind: parseInt(parts[1]) || 0 };
    })
    .catch(function(e) {
      // 静默处理：分支未配置上游时无需报告错误
      return { ahead: 0, behind: 0 };
    });
}

/**
 * 根据知识库改动类型自动生成默认提交信息。
 *
 * @param {string} kbName 知识库名称
 * @param {object} status Git 状态对象
 * @returns {string} 自动生成的提交信息
 */
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
  var onlyMeta = (status.files || []).every(function(f) { return f.path.endsWith('_graph.json'); });
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

/**
 * 返回 Git 认证信息存储文件的绝对路径。
 *
 * @returns {string} 认证存储文件路径
 */
function _ga_getStorePath() {
  if (!_ga_storePath) _ga_storePath = path.join(app.getPath('userData'), 'git-auth.json');
  return _ga_storePath;
}

/**
 * 加载本地 Git 认证存储；读取失败时回退为空对象。
 *
 * @returns {object} 认证存储对象
 */
function _ga_loadStore() {
  if (_ga_store) return _ga_store;
  try {
    var data = nodeFs.readFileSync(_ga_getStorePath(), 'utf-8');
    _ga_store = JSON.parse(data);
  } catch (e) { _ga_store = {}; }
  return _ga_store;
}

/**
 * 将当前 Git 认证存储写回磁盘。
 *
 * @returns {void}
 */
function _ga_saveStore() {
  nodeFs.writeFileSync(_ga_getStorePath(), JSON.stringify(_ga_store || {}, null, 2), 'utf-8');
}

var gitAuth = {
  /**
   * 使用系统安全存储加密保存知识库对应的访问 Token。
   *
   * @param {string} kbPath 知识库路径
   * @param {string} token 访问 Token
   * @returns {Promise<{ok: boolean, error?: string}>} 保存结果
   */
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

  /**
   * 读取并解密知识库对应的访问 Token。
   * 无 Token、未加密或解密失败时返回 `null`。
   *
   * @param {string} kbPath 知识库路径
   * @returns {Promise<string|null>} 解密后的 Token
   */
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

  /**
   * 设置知识库的认证方式，如 `token` 或 `ssh`。
   *
   * @param {string} kbPath 知识库路径
   * @param {string} authType 认证方式
   * @returns {Promise<{ok: boolean}>} 设置结果
   */
  setAuthType: function(kbPath, authType) {
    return Promise.resolve().then(function() {
      var store = _ga_loadStore();
      if (!store[kbPath]) store[kbPath] = {};
      store[kbPath].authType = authType;
      _ga_saveStore();
      return { ok: true };
    });
  },

  /**
   * 获取知识库当前配置的认证方式，默认为 `token`。
   *
   * @param {string} kbPath 知识库路径
   * @returns {Promise<{ok: boolean, authType: string}>} 认证方式结果
   */
  getAuthType: function(kbPath) {
    return Promise.resolve().then(function() {
      var store = _ga_loadStore();
      var entry = store[kbPath];
      return { ok: true, authType: entry ? (entry.authType || 'token') : 'token' };
    });
  },

  /**
   * 确保用于 SSH 认证的密钥对存在，不存在时自动生成。
   *
   * @returns {Promise<{privPath: string, pubPath: string}>} SSH 密钥路径
   */
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

  /**
   * 获取当前应用维护的 SSH 公钥内容，供用户配置远程仓库。
   *
   * @returns {Promise<{ok: boolean, publicKey?: string, error?: string}>} 公钥结果
   */
  getSSHPublicKey: function() {
    return gitAuth.ensureSSHKey()
      .then(function(paths) {
        var pub = nodeFs.readFileSync(paths.pubPath, 'utf-8').trim();
        return { ok: true, publicKey: pub };
      })
      .catch(function(e) { return { ok: false, error: e.message }; });
  },

  /**
   * 根据远程地址和当前认证配置构建 Git 操作所需环境变量。
   * SSH 模式会注入 `GIT_SSH_COMMAND`，Token 模式会注入认证凭据。
   *
   * @param {string} kbPath 知识库路径
   * @param {string} remoteUrl 远程仓库地址
   * @returns {Promise<object>} Git 环境变量对象
   */
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

/**
 * 注册渲染进程与主进程之间的 IPC 通道。
 * 负责暴露文件系统、外部链接和 Git 相关能力。
 *
 * @returns {void}
 */
function registerIPC() {
  // ===== File system handlers =====
  // 提供工作目录、知识库、卡片、文本文件和二进制文件的基础读写能力。
  ipcMain.handle('fs:init',           function()        { return fs.initWorkDir(); });
  ipcMain.handle('fs:listChildren',   function(e, p)   { return fs.listChildren(p); });
  ipcMain.handle('fs:mkDir',          function(e, p, m) {
    var abs = fs.mkDir(p, m);
    return path.relative(fs.getRootDir(), abs);
  });
  ipcMain.handle('fs:rmDir',          function(e, p)    { fs.rmDir(p); });
  ipcMain.handle('fs:saveKBOrder',     function(e, p, o){ fs.saveKBOrder(p, o); });
  ipcMain.handle('fs:getKBCover',      function(e, p)    { return fs.getKBCover(p); });
  ipcMain.handle('fs:saveKBCover',     function(e, p, c){ fs.saveKBCover(p, c); });
  ipcMain.handle('fs:renameKB',        function(e, p, n){ return fs.renameKB(p, n); });
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

  // ===== App handlers =====
  // 暴露少量应用级能力，例如安全打开外部链接。
  ipcMain.handle('app:openExternal', function(e, url) {
    if (typeof url !== 'string') return false;
    var target = url.trim();
    if (!/^https?:\/\//i.test(target)) return false;
    shell.openExternal(target);
    return true;
  });

  // ===== Synchronous save handler =====
  // 处理应用退出前的同步布局保存，确保渲染进程可立即获得成功/失败结果。
  ipcMain.on('save:layout', function(event, dirPath, meta) {
    try {
      fs.writeGraphMeta(dirPath, meta);
      event.returnValue = true;
    } catch (e) {
      event.returnValue = false;
    }
  });

  // ===== Git handlers =====
  /**
   * 将知识库相对路径解析为工作目录下的绝对路径。
   * 未传入路径时返回当前工作目录本身。
   *
   * @param {string} [kbPath] 知识库相对路径
   * @returns {string} 知识库绝对路径
   */
  function absKbPath(kbPath) {
    var root = fs.getRootDir();
    if (!kbPath) return root;
    return path.resolve(root, kbPath);
  }

  // 基础 Git 能力：仓库初始化、状态、提交、diff、日志和远程同步。
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
  // 冲突处理：列出冲突、展示三方内容、写回解决结果并完成合并提交。
  ipcMain.handle('git:conflict:list', function(e, kbPath) { return gitService.getConflictList(absKbPath(kbPath)); });
  ipcMain.handle('git:conflict:show', function(e, kbPath, filePath) {
    return gitService.getConflictContent(absKbPath(kbPath), filePath)
      .then(function(result) {
        if (result.ok && !result.isBinary && filePath.endsWith('_graph.json')) {
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
  // Git 认证：管理 Token、SSH 公钥和认证方式。
  ipcMain.handle('git:auth:setToken', function(e, kbPath, token) { return gitAuth.saveToken(kbPath, token); });
  ipcMain.handle('git:auth:getSSHKey', function() { return gitAuth.getSSHPublicKey(); });
  ipcMain.handle('git:auth:setAuthType', function(e, kbPath, authType) { return gitAuth.setAuthType(kbPath, authType); });
  ipcMain.handle('git:auth:getAuthType', function(e, kbPath) { return gitAuth.getAuthType(kbPath); });

  // ===== Log handlers =====
  ipcMain.handle('log:write', function(e, entry) {
    LogService.write(entry);
    return true;
  });
  ipcMain.handle('log:getBuffer', function() { return LogService.getBuffer(); });
  ipcMain.handle('log:query', function(e, opts) { return LogService.query(opts); });
  ipcMain.handle('log:setLevel', function(e, level) { return LogService.setLevel(level); });
  ipcMain.handle('log:clear', function() { return LogService.clear(); });
  ipcMain.handle('log:getAvailableDates', function() { return LogService.getAvailableDates(); });
  ipcMain.handle('log:getLogDir', function() { return LogService.getLogDir(); });
  ipcMain.handle('monitor:open', function() {
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:menu-action', 'open-monitor');
    }
  });
}

// ============================================================
// 5. APP LIFECYCLE
// ============================================================
var win = null;
var monitorWin = null;

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-software-rasterizer');

if (process.env.TOPOMIND_PROFILE && process.env.TOPOMIND_PROFILE !== 'prod') {
  app.setName('TopoMind-' + process.env.TOPOMIND_PROFILE);
}

/**
 * 创建应用主窗口，并根据运行环境加载开发服务器或生产构建页面。
 *
 * @returns {void}
 */
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

function createMonitorWindow() {
  if (monitorWin && !monitorWin.isDestroyed()) {
    monitorWin.focus();
    return;
  }
  monitorWin = new BrowserWindow({
    width: 1200, height: 700, minWidth: 800, minHeight: 500,
    title: '日志性能监控 - TopoMind',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
  });
  var monitorUrl = process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL + '#/monitor'
    : 'file://' + path.join(__dirname, '..', 'dist', 'index.html') + '#/monitor';
  monitorWin.loadURL(monitorUrl);
  monitorWin.on('closed', function() { monitorWin = null; });
}

function toggleMonitorWindow() {
  if (monitorWin && !monitorWin.isDestroyed()) {
    monitorWin.close();
    monitorWin = null;
  } else {
    createMonitorWindow();
  }
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
      { type: 'separator' },
      { label: '日志性能监控', click: function() { toggleMonitorWindow(); } },
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

/**
 * 应用就绪后注册 IPC、构建菜单并创建主窗口。
 * 在 macOS 上点击 Dock 图标时，如无窗口则重新创建。
 */
app.whenReady().then(function() {
  registerIPC();
  LogService.init(app.getPath('userData'));
  buildMenu();
  createWindow();
  app.on('activate', function() { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

/**
 * 处理所有窗口关闭后的退出行为。
 * macOS 保持应用存活，其余平台直接退出。
 */
app.on('window-all-closed', function() { if (process.platform !== 'darwin') app.quit(); });

/**
 * 应用退出前通知渲染进程执行同步保存。
 */
app.on('before-quit', function() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('save:before-quit');
  }
  if (monitorWin && !monitorWin.isDestroyed()) {
    monitorWin.destroy();
  }
});
