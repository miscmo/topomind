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
 * @description 校验目录名必须是单个且安全的名称；不允许路径片段、特殊字符或被自动修正
 * @param { string } name: 原始目录名
 * @param { string } label: 字段名
 * @returns { string } 通过校验后的目录名
 * @throws { Error } 名称非法时抛出错误
 */
function _fs_requireSafeDirName(name, label) {
  var raw = String(name || '').trim();
  var fieldLabel = label || '目录名称';
  if (!raw) {
    throw new Error(fieldLabel + '不能为空');
  }
  var safe = _fs_safeSegment(raw);
  if (raw !== safe) {
    throw new Error(fieldLabel + '包含非法字符');
  }
  return safe;
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
 * @description 读取 JSON 文件并解析，不存在时返回空对象，读取或解析失败时抛出异常
 * @param { string } filePath: JSON 文件路径
 * @returns { Object } 解析后的对象
 */
function _fs_readJsonFile(filePath) {
  if (!nodeFs.existsSync(filePath)) return {};
  var content = nodeFs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
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

function _fs_createCardDir(rootDir, parentPath, cardName) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var parent = _fs_resolveKbsPath(rootDir, parentPath);
  if (!nodeFs.existsSync(parent)) {
    throw new Error('父目录不存在: ' + String(parentPath || ''));
  }
  var finalName = _fs_safeSegment(cardName);
  if (!String(cardName || '').trim()) {
    throw new Error('卡片名称不能为空');
  }
  var d = nodePath.join(parent, finalName);
  if (nodeFs.existsSync(d)) {
    throw new Error('目录已存在: ' + _fs_relativeToKbs(rootDir, d));
  }
  _fs_ensureDir(d);
  _fs_writeJsonFile(_fs_graphFilePath(d), {});
  return _fs_relativeToKbs(rootDir, d);
}

function _fs_deleteKbsDir(rootDir, dirPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var d = _fs_resolveKbsPath(rootDir, dirPath);
  if (nodeFs.existsSync(d)) nodeFs.rmSync(d, { recursive: true, force: true });
}

function _fs_safeFileName(name) {
  var raw = String(name || 'image').trim();
  var dot = raw.lastIndexOf('.');
  var base = dot > 0 ? raw.slice(0, dot) : raw;
  var ext = dot > 0 ? raw.slice(dot + 1) : '';
  base = _fs_safeSegment(base).slice(0, 60) || 'image';
  ext = String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  return ext ? base + '.' + ext : base;
}

function _fs_extFromMime(mime) {
  var type = String(mime || '').toLowerCase().split(';')[0].trim();
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/svg+xml') return 'svg';
  if (type === 'image/bmp') return 'bmp';
  return 'bin';
}

function _fs_uniqueFilePath(dir, desiredName) {
  var safeName = _fs_safeFileName(desiredName);
  var dot = safeName.lastIndexOf('.');
  var base = dot > 0 ? safeName.slice(0, dot) : safeName;
  var ext = dot > 0 ? safeName.slice(dot) : '';
  var candidate = safeName;
  var i = 1;
  while (nodeFs.existsSync(nodePath.join(dir, candidate))) {
    candidate = base + '-' + i + ext;
    i += 1;
  }
  return nodePath.join(dir, candidate);
}

function _fs_writeAttachmentBuffer(rootDir, cardPath, fileName, buffer) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var cardDir = cardPath === '__ROOT__' ? rootDir : _fs_resolveKbsPath(rootDir, cardPath);
  var attachDir = nodePath.join(cardDir, '_attach');
  _fs_ensureDir(attachDir);
  var target = _fs_uniqueFilePath(attachDir, fileName);
  nodeFs.writeFileSync(target, buffer);
  return '_attach/' + nodePath.basename(target);
}

function _fs_attachmentRefToPath(rootDir, cardPath, attachmentRef) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var rawRef = String(attachmentRef || '').trim();
  if (!rawRef) throw new Error('附件路径为空');
  if (/^[a-z]+:/i.test(rawRef) || rawRef.startsWith('/') || rawRef.startsWith('\\')) {
    throw new Error('不支持的附件路径: ' + rawRef);
  }
  var normalizedRef = rawRef.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalizedRef.startsWith('_attach/')) {
    normalizedRef = '_attach/' + nodePath.basename(normalizedRef);
  }
  var baseDir = cardPath === '__ROOT__' ? rootDir : _fs_resolveKbsPath(rootDir, String(cardPath || ''));
  return nodePath.resolve(baseDir, normalizedRef);
}

const DEFAULT_DETAIL_DOCUMENT = '_content.md';
const DETAIL_DOCUMENT_DIR = '_content';

function _fs_normalizeDetailDocumentPath(documentPath) {
  var raw = String(documentPath || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');
  if (!raw) return DEFAULT_DETAIL_DOCUMENT;
  if (raw === DEFAULT_DETAIL_DOCUMENT) return DEFAULT_DETAIL_DOCUMENT;
  if (!raw.startsWith(DETAIL_DOCUMENT_DIR + '/')) {
    throw new Error('文档路径不合法: ' + raw);
  }
  var relativeName = raw.slice((DETAIL_DOCUMENT_DIR + '/').length);
  if (!relativeName || relativeName.includes('/')) {
    throw new Error('仅支持 _content 目录下的一级 Markdown 文档');
  }
  if (!/\.md$/i.test(relativeName)) {
    throw new Error('仅支持 Markdown 文档');
  }
  return DETAIL_DOCUMENT_DIR + '/' + relativeName;
}

function _fs_detailDocumentAbsolutePath(rootDir, cardPath, documentPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var cardDir = _fs_resolveKbsPath(rootDir, cardPath);
  var normalizedDocumentPath = _fs_normalizeDetailDocumentPath(documentPath);
  return nodePath.join(cardDir, normalizedDocumentPath);
}

function _fs_normalizeDetailDocumentName(name) {
  var raw = String(name || '').trim();
  if (!raw) throw new Error('文档名称不能为空');
  if (raw.includes('/') || raw.includes('\\')) throw new Error('文档名称不能包含路径');
  var dot = raw.toLowerCase().endsWith('.md') ? raw.lastIndexOf('.') : -1;
  var base = dot > 0 ? raw.slice(0, dot) : raw;
  var safeBase = _fs_safeSegment(base);
  if (!safeBase || safeBase === 'untitled' && base !== 'untitled') {
    throw new Error('文档名称包含非法字符');
  }
  return safeBase + '.md';
}

function _fs_detailDocumentItem(documentPath) {
  var normalizedPath = _fs_normalizeDetailDocumentPath(documentPath);
  var baseName = nodePath.basename(normalizedPath, '.md');
  var isDefault = normalizedPath === DEFAULT_DETAIL_DOCUMENT;
  return {
    path: normalizedPath,
    name: isDefault ? '卡片详情' : baseName,
    isDefault: isDefault,
  };
}

function _fs_listDetailDocuments(rootDir, cardPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var cardDir = _fs_resolveKbsPath(rootDir, cardPath);
  var contentDir = nodePath.join(cardDir, DETAIL_DOCUMENT_DIR);
  var documents = [_fs_detailDocumentItem(DEFAULT_DETAIL_DOCUMENT)];
  if (nodeFs.existsSync(contentDir)) {
    nodeFs.readdirSync(contentDir, { withFileTypes: true })
      .filter(function(entry) { return entry.isFile() && /\.md$/i.test(entry.name); })
      .sort(function(a, b) { return a.name.localeCompare(b.name, 'zh-CN'); })
      .forEach(function(entry) {
        documents.push(_fs_detailDocumentItem(DETAIL_DOCUMENT_DIR + '/' + entry.name));
      });
  }
  return documents;
}

function _fs_createDetailDocument(rootDir, cardPath, name) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var cardDir = _fs_resolveKbsPath(rootDir, cardPath);
  var contentDir = nodePath.join(cardDir, DETAIL_DOCUMENT_DIR);
  _fs_ensureDir(contentDir);
  var fileName = _fs_normalizeDetailDocumentName(name);
  var targetPath = nodePath.join(contentDir, fileName);
  if (nodeFs.existsSync(targetPath)) {
    throw new Error('文档已存在: ' + fileName);
  }
  nodeFs.writeFileSync(targetPath, '', 'utf-8');
  return _fs_detailDocumentItem(DETAIL_DOCUMENT_DIR + '/' + fileName);
}

function _fs_renameDetailDocument(rootDir, cardPath, documentPath, nextName) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var normalizedDocumentPath = _fs_normalizeDetailDocumentPath(documentPath);
  if (normalizedDocumentPath === DEFAULT_DETAIL_DOCUMENT) {
    throw new Error('默认文档不允许重命名');
  }
  var currentPath = _fs_detailDocumentAbsolutePath(rootDir, cardPath, normalizedDocumentPath);
  if (!nodeFs.existsSync(currentPath)) {
    throw new Error('文档不存在: ' + normalizedDocumentPath);
  }
  var fileName = _fs_normalizeDetailDocumentName(nextName);
  var nextPath = _fs_detailDocumentAbsolutePath(rootDir, cardPath, DETAIL_DOCUMENT_DIR + '/' + fileName);
  if (currentPath !== nextPath && nodeFs.existsSync(nextPath)) {
    throw new Error('文档已存在: ' + fileName);
  }
  if (currentPath !== nextPath) {
    nodeFs.renameSync(currentPath, nextPath);
  }
  return _fs_detailDocumentItem(DETAIL_DOCUMENT_DIR + '/' + fileName);
}

function _fs_deleteDetailDocument(rootDir, cardPath, documentPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var normalizedDocumentPath = _fs_normalizeDetailDocumentPath(documentPath);
  if (normalizedDocumentPath === DEFAULT_DETAIL_DOCUMENT) {
    throw new Error('默认文档不允许删除');
  }
  var filePath = _fs_detailDocumentAbsolutePath(rootDir, cardPath, normalizedDocumentPath);
  if (nodeFs.existsSync(filePath)) {
    nodeFs.rmSync(filePath, { force: true });
  }
}

const fileService = {
    /**
     * @description 读取工作目录应用配置
     * @param { string } rootDir: 工作目录路径
     * @returns { Object } 应用配置对象
     */
    readAppConfig: function(rootDir) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      return _fs_readJsonFile(_fs_appConfigPath(rootDir));
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
      var parentGraph = _fs_readJsonFile(_fs_graphFilePath(dir));
      return parentGraph.children || {};
    },

    /** 不能再改这部分代码了  --to ai
     * @description 在 kbs/ 根目录下创建知识库目录，并初始化默认文件
     * @param { string } rootDir: 工作目录路径
     * @param { string } kbName: 知识库目录名，只允许单个安全目录名
     * @returns { void }
     */
    createKbsDir: function(rootDir, kbName) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var finalName = _fs_requireSafeDirName(kbName, '知识库名称');
      var d = nodePath.join(_fs_kbsDir(rootDir), finalName);
      if (nodeFs.existsSync(d)) {
        throw new Error('目录已存在: ' + _fs_relativeToKbs(rootDir, d));
      }
      _fs_ensureDir(d);
    },

    /**
     * @description 在指定父目录下创建卡片目录，并初始化默认文件
     * @param { string } rootDir: 工作目录路径
     * @param { string } parentPath: 父目录相对于 kbs/ 的路径
     * @param { string } cardName: 卡片目录名
     * @returns { string } 创建后的目录相对路径
     */
    createCardDir: function(rootDir, parentPath, cardName) {
      return _fs_createCardDir(rootDir, parentPath, cardName);
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
     * @description 读取房间的图元数据，不存在时返回空对象
     * @param { string } rootDir: 工作目录路径
     * @param { string } roomPath: 房间相对路径
     * @returns { Object } 图元数据对象
     */
    readGraphMeta: function(rootDir, roomPath) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var d = _fs_resolveKbsPath(rootDir, roomPath);
      return _fs_readJsonFile(_fs_graphFilePath(d));
    },

    /**
     * @description 写入房间的图元数据，不存在时先创建目录结构
     * @param { string } rootDir: 工作目录路径
     * @param { string } roomPath: 房间相对路径
     * @param { Object } meta: 图元数据
     * @returns { void }
     */
    writeGraphMeta: function(rootDir, roomPath, meta) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var d = _fs_resolveKbsPath(rootDir, roomPath);
      _fs_ensureDir(d);
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        throw new Error('writeGraphMeta: meta 必须是普通对象');
      }
      _fs_writeJsonFile(_fs_graphFilePath(d), meta);
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

    listDetailDocuments: function(rootDir, cardPath) {
      return _fs_listDetailDocuments(rootDir, cardPath);
    },

    createDetailDocument: function(rootDir, cardPath, name) {
      return _fs_createDetailDocument(rootDir, cardPath, name);
    },

    renameDetailDocument: function(rootDir, cardPath, documentPath, nextName) {
      return _fs_renameDetailDocument(rootDir, cardPath, documentPath, nextName);
    },

    deleteDetailDocument: function(rootDir, cardPath, documentPath) {
      return _fs_deleteDetailDocument(rootDir, cardPath, documentPath);
    },

    writeAttachmentBase64: function(rootDir, cardPath, fileName, mimeType, base64) {
      var ext = _fs_extFromMime(mimeType);
      var safeName = _fs_safeFileName(fileName || ('image.' + ext));
      if (safeName.indexOf('.') < 0) safeName += '.' + ext;
      return _fs_writeAttachmentBuffer(rootDir, cardPath, safeName, Buffer.from(String(base64 || ''), 'base64'));
    },

    downloadAttachment: async function(rootDir, cardPath, url) {
      var targetUrl = String(url || '').trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        throw new Error('只支持 http/https 图片链接');
      }
      var response = await fetch(targetUrl);
      if (!response.ok) {
        throw new Error('下载失败: ' + response.status);
      }
      var mimeType = response.headers.get('content-type') || '';
      if (!/^image\//i.test(mimeType)) {
        throw new Error('链接不是图片: ' + mimeType);
      }
      var urlPath = new URL(targetUrl).pathname;
      var fileName = nodePath.basename(urlPath) || ('image.' + _fs_extFromMime(mimeType));
      if (fileName.indexOf('.') < 0) fileName += '.' + _fs_extFromMime(mimeType);
      var arrayBuffer = await response.arrayBuffer();
      return _fs_writeAttachmentBuffer(rootDir, cardPath, fileName, Buffer.from(arrayBuffer));
    },

    readAttachmentDataUrl: function(rootDir, cardPath, attachmentRef) {
      var filePath = _fs_attachmentRefToPath(rootDir, cardPath, attachmentRef);
      if (!nodeFs.existsSync(filePath)) return '';
      var ext = nodePath.extname(filePath).slice(1).toLowerCase();
      var mimeMap = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
      };
      var mimeType = mimeMap[ext] || 'application/octet-stream';
      return 'data:' + mimeType + ';base64,' + nodeFs.readFileSync(filePath).toString('base64');
    },

    /**
     * @description 读取 _config.json 中的 windowState
     * @param { string } rootDir: 工作目录路径
     * @returns { Object|null } windowState 对象或 null
     */
    readWindowState: function(rootDir) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var configPath = _fs_appConfigPath(rootDir);
      var config = _fs_readJsonFile(configPath);
      return config.windowState || null;
    },

    /**
     * @description 写入 windowState 到 _config.json
     * @param { string } rootDir: 工作目录路径
     * @param { Object } state: windowState 对象 (x, y, width, height, isMaximized)
     * @returns { void }
     */
    writeWindowState: function(rootDir, state) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var configPath = _fs_appConfigPath(rootDir);
      var config = _fs_readJsonFile(configPath);
      config.windowState = state;
      _fs_writeJsonFile(configPath, config);
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
