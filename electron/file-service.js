/**
 * File Service - 文件系统操作服务
 * 封装工作目录、知识库、卡片和文件的基础读写能力。
 */
import nodePath from 'path';
import nodeFs from 'fs';

/**
 * @description 返回工作目录下的知识库根目录路径
 * @param { string } dir: 工作目录路径
 * @returns { string } kbs 目录路径
 */
function _fs_kbsDir(dir) {
  return nodePath.join(dir, 'kbs');
}

/**
 * @description 返回工作目录下的日志目录路径
 * @param { string } dir: 工作目录路径
 * @returns { string } logs 目录路径
 */
function _fs_logsDir(dir) {
  return nodePath.join(dir, 'logs');
}

/**
 * @description 返回工作目录下的应用配置文件路径
 * @param { string } dir: 工作目录路径
 * @returns { string } _config.json 文件路径
 */
function _fs_appConfigPath(dir) {
  return nodePath.join(dir, '_config.json');
}

/**
 * @description 判断目录是否为空，不存在的目录视为空目录
 * @param { string } dirPath: 目录路径
 * @returns { boolean } 是否为空目录
 */
function _fs_isDirEmpty(dirPath) {
  try {
    if (!nodeFs.existsSync(dirPath))
      return true;
    return nodeFs.readdirSync(dirPath).length === 0;
  } catch (e) { return false; }
}

/**
 * @description 验证路径是否为有效工作目录：工作目录存在且为目录 -> 存在 _config.json -> 存在 kbs 目录 -> 存在 logs 目录
 * @param { string } dirPath: 工作目录路径
 * @returns { { valid: boolean, error?: string } } 工作目录校验结果
 * @throws { Error } 路径处理异常时抛出错误
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
 * @description 确保目录存在，不存在则递归创建
 * @param { string } d: 目录路径
 * @returns { void }
 */
function _fs_ensureDir(d) {
  if (!nodeFs.existsSync(d))
    nodeFs.mkdirSync(d, { recursive: true });
}

/**
 * @description 将任意名称清洗为安全的单个目录名片段
 * @param { string } name: 原始目录名
 * @returns { string } 清洗后的目录名
 */
function _fs_safeSegment(name) {
  var s = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '');
  if (!s || s === '.' || s === '..') s = 'untitled';
  return s.slice(0, 80);
}

/**
 * @description 在父目录下生成不重名的文件夹名称
 * @param { string } parentDir: 父目录路径
 * @param { string } desiredName: 期望的目录名
 * @returns { string } 可用且唯一的目录名
 */
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

/** Note：该函数逻辑已定，不要擅自修改  --TO AI
 * @description 把 kbs 内的相对路径转换成绝对路径；禁止通过 ../ 或绝对路径访问 kbs 之外的文件
 * @param { string } rootDir: 工作目录绝对路径
 * @param { string } relPath: 相对于工作目录 kbs/ 的路径；为空时返回 kbs 根目录
 * @returns { string } kbs 内目标文件或目录的绝对路径
 * @throws { Error } relPath 指向 kbs 目录之外时抛出错误
 */
function _fs_resolveKbsPath(rootDir, relPath) {
  var resolvedRoot = nodePath.resolve(_fs_kbsDir(rootDir));
  if (!relPath) return resolvedRoot;
  var result = nodePath.resolve(resolvedRoot, relPath);
  var rel = nodePath.relative(resolvedRoot, result);
  if (rel.startsWith('..') || nodePath.isAbsolute(rel)) {
    throw new Error('路径越界: ' + relPath);
  }
  return result;
}

/**
 * @description 将 kbs 根目录下的绝对路径转换为知识库相对路径
 * @param { string } rootDir: 工作目录路径
 * @param { string } absPath: 绝对路径
 * @returns { string } 相对于 kbs 的路径
 */
function _fs_relativeToKbs(rootDir, absPath) {
  return nodePath.relative(_fs_kbsDir(rootDir), absPath).split(nodePath.sep).join('/');
}

/**
 * @description 将完整知识库路径转换为相对于知识库根节点的路径
 * @param { string } relPath: 知识库内路径
 * @returns { string } KB 相对路径
 */
function _fs_kbRelativePath(relPath) {
  var parts = String(relPath || '').split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(1).join('/');
}

/**
 * @description 将子节点路径转换为相对于父房间的路径
 * @param { string } parentPath: 父房间路径
 * @param { string } childPath: 子节点完整路径
 * @returns { string } 房间相对路径
 */
function _fs_roomRelativePath(parentPath, childPath) {
  var parentParts = String(parentPath || '').split('/').filter(Boolean);
  var childParts = String(childPath || '').split('/').filter(Boolean);
  var matchesParent = parentParts.length > 0 && parentParts.every(function(part, index) {
    return childParts[index] === part;
  });
  if (matchesParent) {
    return childParts.slice(parentParts.length).join('/');
  }
  return childParts.length ? childParts[childParts.length - 1] : '';
}

/**
 * @description 读取 JSON 文件并解析，失败时返回 null
 * @param { string } filePath: JSON 文件路径
 * @returns { Object | null } 解析后的对象
 */
function _fs_readJsonFile(filePath) {
  if (!nodeFs.existsSync(filePath)) return null;
  try { return JSON.parse(nodeFs.readFileSync(filePath, 'utf-8')); } catch (e) { return null; }
}

/**
 * @description 将对象写入 JSON 文件，使用 2 空格缩进
 * @param { string } filePath: JSON 文件路径
 * @param { Object } data: 要写入的数据
 * @returns { void }
 */
function _fs_writeJsonFile(filePath, data) {
  nodeFs.writeFileSync(filePath, JSON.stringify(data || {}, null, 2), 'utf-8');
}

/**
 * @description 返回目录下 _graph.json 文件路径
 * @param { string } dir: 目录路径
 * @returns { string } _graph.json 文件路径
 */
function _fs_graphFilePath(dir) {
  return nodePath.join(dir, '_graph.json');
}

/**
 * @description 验证路径必须是绝对路径，否则抛出错误，并返回标准化后的绝对路径
 * @param { string } dir: 传入的路径
 * @returns { string } 标准化后的绝对路径
 * @throws { Error } 路径为相对路径时抛出错误
 */
function _fs_validateAbsolutePath(dir) {
  if (!nodePath.isAbsolute(dir)) {
    throw new Error('路径必须是绝对路径');
  }
  return nodePath.resolve(dir);
}

/**
 * @description 校验并返回可安全读写的工作目录绝对路径
 * @param { string } rootDir: 工作目录路径
 * @returns { string } 标准化后的工作目录绝对路径
 * @throws { Error } 当工作目录无效时抛出错误
 */
function _fs_requireValidWorkDir(rootDir) {
  var dir = _fs_validateAbsolutePath(rootDir);
  var validation = _fs_isValidWorkDir(dir);
  if (!validation.valid) {
    throw new Error(validation.error || '不是有效的工作目录');
  }
  return dir;
}

function _fs_createKbsDir(rootDir, dirPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var parent = _fs_kbsDir(rootDir);

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
  return _fs_relativeToKbs(rootDir, d);
}

function _fs_deleteKbsDir(rootDir, dirPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var d = _fs_resolveKbsPath(rootDir, dirPath);
  if (nodeFs.existsSync(d)) nodeFs.rmSync(d, { recursive: true, force: true });
}

const fileService = {
    /**
     * @description 读取工作目录应用配置
     * @param { string } rootDir: 工作目录路径
     * @returns { Object } 应用配置对象
     */
    readAppConfig: function(rootDir) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      return _fs_readJsonFile(_fs_appConfigPath(rootDir)) || {};
    },

    /**
     * @description 写入工作目录应用配置，支持对象或 JSON 字符串
     * @param { string } rootDir: 工作目录路径
     * @param { Object | string } content: 配置内容
     * @returns { Object } 最终写入的配置对象
     */
    writeAppConfig: function(rootDir, content) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var data = content;
      if (typeof content === 'string') {
        try { data = JSON.parse(content); } catch (e) { data = {}; }
      }
      _fs_ensureDir(rootDir);
      _fs_writeJsonFile(_fs_appConfigPath(rootDir), data);
      return data;
    },

    /**
     * @description 创建一个新的工作目录并初始化必要结构
     * @param { string } dirPath: 工作目录绝对路径
     * @returns { { valid: boolean, nodePath: string | null, error?: string } } 创建结果
     */
    createWorkDir: function(dirPath) {
      var dir = dirPath || null;
      try {
        if (!dir) {
          return { valid: false, nodePath: null, error: '工作目录路径为空' };
        }
        dir = _fs_validateAbsolutePath(dir);
        if (nodeFs.existsSync(dir) && !_fs_isDirEmpty(dir)) {
          return { valid: false, nodePath: dir, error: '工作目录必须是空目录' };
        }
        _fs_ensureDir(dir);
        _fs_ensureDir(_fs_kbsDir(dir));
        _fs_ensureDir(_fs_logsDir(dir));
        _fs_writeJsonFile(_fs_appConfigPath(dir), {});
        return { valid: true, nodePath: dir };
      } catch (e) {
        return { valid: false, nodePath: dir, error: e && e.message ? e.message : '创建工作目录失败' };
      }
    },

    /**
     * @description 校验工作目录：检查目录是否存在且为有效工作目录
     * @param { string } dirPath: 工作目录路径
     * @returns { { valid: boolean, nodePath: string | null, error?: string } } 校验结果
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

    /**
     * @description 列出工作目录下的所有顶层知识库列表
     * @param { string } rootDir: 工作目录路径
     * @returns { Array<{ name: string }> } 知识库列表
     */
    listKBs: function(rootDir) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var dir = _fs_kbsDir(rootDir);
      var children = nodeFs.readdirSync(dir, { withFileTypes: true })
        .filter(function(e) { return e.isDirectory() && !e.name.startsWith('.') && e.name !== 'images'; })
        .map(function(e) {
          return { name: e.name };
        });
      // 默认按照名字排序，后续再优化
      children.sort(function(a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      });
      return children;
    },

    /**
     * @description 读取指定父卡片的 _graph.json.children 原始内容
     * @param { string } rootDir: 工作目录路径
     * @param { string } cardPath: 卡片相对于 kbs/ 的路径
     * @returns { Object } _graph.json.children 原始映射表
     */
    readCardChildren: function(rootDir, cardPath) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var dir = _fs_resolveKbsPath(rootDir, cardPath);
      var parentGraph = _fs_readJsonFile(_fs_graphFilePath(dir)) || { children: {} };
      return parentGraph.children || {};
    },

    /**
     * @description 创建 kbs/ 下的目录，并初始化默认文件
     * @param { string } rootDir: 工作目录路径
     * @param { string } dirPath: 相对于 kbs/ 的目录路径
     * @returns { string } 创建后的目录相对路径
     */
    createKbsDir: function(rootDir, dirPath) {
      return _fs_createKbsDir(rootDir, dirPath);
    },

    /**
     * @description 删除 kbs/ 下的目录及其所有内容
     * @param { string } rootDir: 工作目录路径
     * @param { string } dirPath: 相对于 kbs/ 的目录路径
     * @returns { void }
     */
    deleteKbsDir: function(rootDir, dirPath) {
      _fs_deleteKbsDir(rootDir, dirPath);
    },

    /**
     * @description 重命名知识库目录，并返回新的相对路径
     * @param { string } rootDir: 工作目录路径
     * @param { string } kbPath: 知识库相对路径
     * @param { string } newName: 新名称
     * @returns { string | null } 重命名后的路径，知识库不存在时返回 null
     */
    renameKB: function(rootDir, kbPath, newName) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var d = _fs_resolveKbsPath(rootDir, kbPath);
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

    /**
     * @description 读取指定目录的图元数据，不存在时返回默认结构
     * @param { string } rootDir: 工作目录路径
     * @param { string } dirPath: 目录相对路径
     * @returns { Object } 图元数据对象
     */
    readGraphMeta: function(rootDir, dirPath) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var d = _fs_resolveKbsPath(rootDir, dirPath);
      var graph = _fs_readJsonFile(_fs_graphFilePath(d));
      if (graph) return graph;
      return { children: {}, edges: [], zoom: null, pan: null, canvasBounds: null };
    },

    /**
     * @description 写入指定目录的图元数据，不存在时先创建目录结构
     * @param { string } rootDir: 工作目录路径
     * @param { string } dirPath: 目录相对路径
     * @param { Object } meta: 图元数据
     * @returns { void }
     */
    writeGraphMeta: function(rootDir, dirPath, meta) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var d = _fs_resolveKbsPath(rootDir, dirPath);
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

    /**
     * @description 读取文本文件内容，不存在时返回空字符串
     * @param { string } rootDir: 工作目录路径
     * @param { string } filePath: 文件相对路径
     * @returns { string } 文件内容
     */
    readFile: function(rootDir, filePath) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var f = _fs_resolveKbsPath(rootDir, filePath);
      if (nodeFs.existsSync(f)) return nodeFs.readFileSync(f, 'utf-8');
      return '';
    },

    /**
     * @description 写入文本文件，不存在时先创建父目录
     * @param { string } rootDir: 工作目录路径
     * @param { string } filePath: 文件相对路径
     * @param { string } content: 文件内容
     * @returns { void }
     */
    writeFile: function(rootDir, filePath, content) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var f = _fs_resolveKbsPath(rootDir, filePath);
      _fs_ensureDir(nodePath.dirname(f));
      nodeFs.writeFileSync(f, content, 'utf-8');
    },

    /**
     * @description 导入外部知识库目录到当前工作目录
     * @param { string } rootDir: 工作目录路径
     * @param { string } sourcePath: 外部知识库绝对或相对路径
     * @returns { string } 导入后知识库的相对路径
     * @throws { Error } 源目录不存在或不是有效知识库时抛出错误
     */
    importKB: function(rootDir, sourcePath) {
      rootDir = _fs_requireValidWorkDir(rootDir);
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

      /**
       * @description 递归复制目录内容到目标目录
       * @param { string } srcDir: 源目录路径
       * @param { string } destDir: 目标目录路径
       * @returns { void }
       */
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
