/**
 * File Service - 文件系统操作服务
 * 封装工作目录、知识库、卡片和文件的基础读写能力。
 */
import nodePath from 'path';
import nodeFs from 'fs';
import { shell } from 'electron';
import { randomUUID } from 'crypto';

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
export function _fs_requireValidWorkDir(rootDir) {
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

export function _fs_attachmentRefToPath(rootDir, cardPath, attachmentRef) {
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

function _fs_listAttachments(rootDir, cardPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var cardDir = cardPath === '__ROOT__' ? rootDir : _fs_resolveKbsPath(rootDir, cardPath);
  var attachDir = nodePath.join(cardDir, '_attach');
  if (!nodeFs.existsSync(attachDir)) return [];
  
  return nodeFs.readdirSync(attachDir, { withFileTypes: true })
    .filter(function(entry) { return entry.isFile(); })
    .map(function(entry) {
      var ext = nodePath.extname(entry.name).slice(1).toLowerCase();
      var isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
      var stat = nodeFs.statSync(nodePath.join(attachDir, entry.name));
      return {
        name: entry.name,
        path: '_attach/' + entry.name,
        isImage: isImage,
        size: stat.size,
        mtime: stat.mtimeMs
      };
    })
    .sort(function(a, b) { return b.mtime - a.mtime; }); // 按修改时间降序
}

function _fs_importAttachment(rootDir, cardPath, sourceFilePath, targetFileName) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  if (!nodeFs.existsSync(sourceFilePath)) {
    throw new Error('源文件不存在: ' + sourceFilePath);
  }
  var stat = nodeFs.statSync(sourceFilePath);
  if (!stat.isFile()) {
    throw new Error('只能导入文件');
  }
  
  var fileName = targetFileName || nodePath.basename(sourceFilePath);
  var cardDir = cardPath === '__ROOT__' ? rootDir : _fs_resolveKbsPath(rootDir, cardPath);
  var attachDir = nodePath.join(cardDir, '_attach');
  _fs_ensureDir(attachDir);
  var target = _fs_uniqueFilePath(attachDir, fileName);
  
  nodeFs.copyFileSync(sourceFilePath, target);
  return '_attach/' + nodePath.basename(target);
}

function _fs_deleteAttachment(rootDir, cardPath, attachmentName) {
  var filePath = _fs_attachmentRefToPath(rootDir, cardPath, attachmentName);
  if (nodeFs.existsSync(filePath)) {
    nodeFs.rmSync(filePath, { force: true });
  }
}

const TOPO_DOCUMENT_DIR = '_docs';
const TOPO_DOCUMENT_MANIFEST = 'tree.json';
const TOPO_DOCUMENT_EXTENSIONS = {
  smart: '.tdoc.json',
  mindmap: '.tmind.json',
  flowchart: '.tflow.json',
};
const TOPO_DOCUMENT_SCHEMAS = {
  smart: 'topomind.smart-document',
  mindmap: 'topomind.mindmap-document',
  flowchart: 'topomind.flowchart-document',
};

function _fs_isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function _fs_normalizeTopoDocumentType(type) {
  var normalized = String(type || '').trim();
  if (!Object.prototype.hasOwnProperty.call(TOPO_DOCUMENT_EXTENSIONS, normalized)) {
    throw new Error('不支持的文档类型: ' + normalized);
  }
  return normalized;
}

function _fs_topoDocumentsDir(rootDir, cardPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var cardDir = _fs_resolveKbsPath(rootDir, cardPath);
  return nodePath.join(cardDir, TOPO_DOCUMENT_DIR);
}

function _fs_topoDocumentManifestPath(rootDir, cardPath) {
  return nodePath.join(_fs_topoDocumentsDir(rootDir, cardPath), TOPO_DOCUMENT_MANIFEST);
}

function _fs_normalizeTopoDocumentPath(type, documentPath) {
  var normalizedType = _fs_normalizeTopoDocumentType(type);
  var raw = String(documentPath || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');
  var fileName = nodePath.basename(raw);
  var extension = TOPO_DOCUMENT_EXTENSIONS[normalizedType];
  if (!fileName.endsWith(extension)) {
    throw new Error('文档扩展名不合法: ' + fileName);
  }
  return fileName;
}

function _fs_topoDocumentAbsolutePath(rootDir, cardPath, item) {
  var docsDir = _fs_topoDocumentsDir(rootDir, cardPath);
  var normalizedPath = _fs_normalizeTopoDocumentPath(item.type, item.path);
  var resolvedPath = nodePath.resolve(docsDir, normalizedPath);
  var rel = nodePath.relative(docsDir, resolvedPath);
  if (rel.startsWith('..') || nodePath.isAbsolute(rel)) {
    throw new Error('文档路径越界: ' + item.path);
  }
  return resolvedPath;
}

function _fs_topoDocumentPathKey(item) {
  return item.type + ':' + item.path;
}

function _fs_topoDocumentTitleFromFile(type, filePath, fileName) {
  var extension = TOPO_DOCUMENT_EXTENSIONS[type];
  var fallback = fileName.endsWith(extension) ? fileName.slice(0, -extension.length) : fileName;
  try {
    var content = _fs_readJsonFile(filePath);
    if (_fs_isPlainObject(content) && typeof content.title === 'string' && content.title.trim()) {
      return content.title.trim();
    }
  } catch {
  }
  return fallback || '未命名文档';
}

function _fs_normalizeTopoDocumentManifest(raw) {
  var documents = {};
  if (_fs_isPlainObject(raw)) {
    if (raw.version === 2 && _fs_isPlainObject(raw.documents)) {
      Object.keys(raw.documents).forEach(function(id) {
        var item = raw.documents[id];
        if (!_fs_isPlainObject(item)) return;
        try {
          var type = _fs_normalizeTopoDocumentType(item.type);
          var path = _fs_normalizeTopoDocumentPath(type, item.path);
          documents[id] = {
            id: id,
            type: type,
            title: String(item.title || '').trim() || '未命名文档',
            path: path,
            parentId: item.parentId ? String(item.parentId) : null,
            sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : 0,
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
            updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
            version: Number.isFinite(item.version) ? item.version : 1
          };
        } catch (e) {}
      });
    } else if (Array.isArray(raw.documents)) {
      // v1 array migration
      raw.documents.forEach(function(item, index) {
        if (!_fs_isPlainObject(item)) return;
        try {
          var type = _fs_normalizeTopoDocumentType(item.type);
          var id = String(item.id || '').trim();
          var path = _fs_normalizeTopoDocumentPath(type, item.path);
          if (!id || documents[id]) return;
          documents[id] = {
            id: id,
            type: type,
            title: String(item.title || '').trim() || '未命名文档',
            path: path,
            parentId: null,
            sortOrder: index,
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
            updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
            version: Number.isFinite(item.version) ? item.version : 1
          };
        } catch (e) {}
      });
    }
  }
  return { version: 2, documents: documents };
}

function _fs_scanTopoDocumentFiles(rootDir, cardPath, previousManifest) {
  var docsDir = _fs_topoDocumentsDir(rootDir, cardPath);
  if (!nodeFs.existsSync(docsDir)) return {};
  var previousByPath = new Map();
  Object.keys(previousManifest.documents).forEach(function(id) {
    var item = previousManifest.documents[id];
    previousByPath.set(_fs_topoDocumentPathKey(item), item);
  });
  var documents = {};
  var maxSortOrder = 0;
  Object.keys(previousManifest.documents).forEach(function(id) {
    if (previousManifest.documents[id].sortOrder > maxSortOrder) {
      maxSortOrder = previousManifest.documents[id].sortOrder;
    }
  });

  nodeFs.readdirSync(docsDir, { withFileTypes: true })
    .filter(function(entry) { return entry.isFile(); })
    .sort(function(a, b) { return a.name.localeCompare(b.name, 'zh-CN'); })
    .forEach(function(entry) {
      var fileName = entry.name;
      if (fileName === TOPO_DOCUMENT_MANIFEST || fileName === 'manifest.json' || fileName.startsWith('tree.json')) return;

      var type = null;
      Object.keys(TOPO_DOCUMENT_EXTENSIONS).forEach(function(extType) {
        if (fileName.endsWith(TOPO_DOCUMENT_EXTENSIONS[extType])) {
          type = extType;
        }
      });
      if (!type) return;

      var filePath = nodePath.join(docsDir, fileName);
      var stat = nodeFs.statSync(filePath);
      var previous = previousByPath.get(type + ':' + fileName);
      var id = previous ? previous.id : 'doc_' + randomUUID().replace(/-/g, '');
      documents[id] = {
        id: id,
        type: type,
        title: previous ? previous.title : _fs_topoDocumentTitleFromFile(type, filePath, fileName),
        path: fileName,
        parentId: previous ? previous.parentId : null,
        sortOrder: previous ? previous.sortOrder : (++maxSortOrder),
        createdAt: previous ? previous.createdAt : stat.birthtimeMs,
        updatedAt: previous ? Math.max(previous.updatedAt, stat.mtimeMs) : stat.mtimeMs,
        version: previous ? previous.version : 1
      };
    });
  return documents;
}

function _fs_reconcileTopoDocumentManifest(rootDir, cardPath, manifest) {
  var normalized = _fs_normalizeTopoDocumentManifest(manifest);
  var scanned = _fs_scanTopoDocumentFiles(rootDir, cardPath, normalized);
  var scannedByPath = new Map();
  Object.keys(scanned).forEach(function(id) {
    var item = scanned[id];
    scannedByPath.set(_fs_topoDocumentPathKey(item), item);
  });
  var usedPaths = new Set();
  var documents = {};
  var removed = 0;
  Object.keys(normalized.documents).forEach(function(id) {
    var item = normalized.documents[id];
    var key = _fs_topoDocumentPathKey(item);
    var scannedItem = scannedByPath.get(key);
    if (!scannedItem) {
      removed += 1;
      return;
    }
    usedPaths.add(key);
    documents[id] = Object.assign({}, scannedItem, item, {
      updatedAt: Math.max(item.updatedAt, scannedItem.updatedAt),
    });
  });
  var added = 0;
  Object.keys(scanned).forEach(function(id) {
    var item = scanned[id];
    var key = _fs_topoDocumentPathKey(item);
    if (usedPaths.has(key)) return;
    added += 1;
    documents[id] = item;
  });
  var repaired = { version: 2, documents: documents };
  return {
    manifest: repaired,
    added: added,
    removed: removed,
    changed: added > 0 || removed > 0 || JSON.stringify(repaired) !== JSON.stringify(normalized),
  };
}

function _fs_loadTopoDocumentManifest(rootDir, cardPath) {
  var treePath = _fs_topoDocumentManifestPath(rootDir, cardPath);
  var docsDir = _fs_topoDocumentsDir(rootDir, cardPath);
  var oldManifestPath = nodePath.join(docsDir, 'manifest.json');
  
  if (!nodeFs.existsSync(treePath) && nodeFs.existsSync(oldManifestPath)) {
    try {
      nodeFs.renameSync(oldManifestPath, treePath);
    } catch(e) {}
  }
  
  if (!nodeFs.existsSync(treePath)) return { manifest: { version: 2, documents: {} }, corrupted: false, normalized: false };
  try {
    var raw = _fs_readJsonFile(treePath);
    var manifest = _fs_normalizeTopoDocumentManifest(raw);
    return { manifest: manifest, corrupted: false, normalized: JSON.stringify(raw) !== JSON.stringify(manifest) };
  } catch {
    var backupPath = treePath + '.broken-' + Date.now();
    try {
      nodeFs.copyFileSync(treePath, backupPath);
    } catch {
    }
    return { manifest: { version: 2, documents: {} }, corrupted: true, normalized: true };
  }
}

function _fs_readTopoDocumentManifest(rootDir, cardPath) {
  var treePath = _fs_topoDocumentManifestPath(rootDir, cardPath);
  var loaded = _fs_loadTopoDocumentManifest(rootDir, cardPath);
  var reconciled = _fs_reconcileTopoDocumentManifest(rootDir, cardPath, loaded.manifest);
  if (loaded.corrupted || loaded.normalized || reconciled.changed) {
    if (nodeFs.existsSync(_fs_topoDocumentsDir(rootDir, cardPath)) || nodeFs.existsSync(treePath)) {
      _fs_writeTopoDocumentManifest(rootDir, cardPath, reconciled.manifest);
    }
  }
  return reconciled.manifest;
}

function _fs_writeTopoDocumentManifest(rootDir, cardPath, manifest) {
  var manifestPath = _fs_topoDocumentManifestPath(rootDir, cardPath);
  _fs_ensureDir(nodePath.dirname(manifestPath));
  _fs_writeJsonFile(manifestPath, _fs_normalizeTopoDocumentManifest(manifest));
}

function _fs_findTopoDocument(rootDir, cardPath, documentId) {
  var manifest = _fs_readTopoDocumentManifest(rootDir, cardPath);
  var id = String(documentId || '').trim();
  var item = manifest.documents[id];
  if (!item) {
    throw new Error('文档不存在: ' + id);
  }
  return { manifest: manifest, item: item };
}

function _fs_createTopoDocumentInitialContent(type, title, timestamp) {
  if (type === 'smart') {
    return {
      schema: TOPO_DOCUMENT_SCHEMAS.smart,
      version: 1,
      title: title,
      blocks: [],
      metadata: { createdAt: timestamp, updatedAt: timestamp },
    };
  }
  if (type === 'mindmap') {
    return {
      schema: TOPO_DOCUMENT_SCHEMAS.mindmap,
      version: 2,
      title: title,
      root: {
        data: { text: title || '中心主题', expandState: 'expand' },
        children: []
      },
      theme: 'default',
      layout: 'logicalStructure',
      metadata: { createdAt: timestamp, updatedAt: timestamp, editor: 'simple-mind-map' }
    };
  }
  if (type === 'flowchart') {
    return {
      schema: TOPO_DOCUMENT_SCHEMAS.flowchart,
      version: 2,
      title: title,
      cells: [
        {
          id: 'start-node',
          shape: 'rect',
          x: 240,
          y: 100,
          width: 120,
          height: 50,
          attrs: { 
            body: {
              fill: '#dcfce7',
              stroke: '#16a34a',
              strokeWidth: 2,
              rx: 25,
              ry: 25,
            },
            label: { 
              text: '开始',
              fill: '#1e293b',
              fontSize: 14,
              fontWeight: 'bold',
            } 
          },
          data: { kind: 'start' }
        }
      ],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
      metadata: { createdAt: timestamp, updatedAt: timestamp, editor: 'x6' },
    };
  }
  throw new Error('不支持的文档类型: ' + type);
}

function _fs_writeTopoDocumentContent(filePath, type, content) {
  _fs_ensureDir(nodePath.dirname(filePath));
  if (!_fs_isPlainObject(content)) {
    throw new Error('结构化文档内容必须是对象');
  }
  var expectedSchema = TOPO_DOCUMENT_SCHEMAS[type];
  if (expectedSchema && content.schema && content.schema !== expectedSchema) {
    throw new Error('文档 schema 与类型不匹配');
  }
  var normalizedContent = Object.assign({}, content);
  if (expectedSchema && !normalizedContent.schema) {
    normalizedContent.schema = expectedSchema;
  }
  if (!Number.isFinite(normalizedContent.version)) {
    normalizedContent.version = 1;
  }
  _fs_writeJsonFile(filePath, normalizedContent);
}

function _fs_listTopoDocuments(rootDir, cardPath) {
  var manifest = _fs_readTopoDocumentManifest(rootDir, cardPath);
  return Object.keys(manifest.documents).map(function(id) {
    return manifest.documents[id];
  });
}

function _fs_repairTopoDocuments(rootDir, cardPath) {
  var loaded = _fs_loadTopoDocumentManifest(rootDir, cardPath);
  var reconciled = _fs_reconcileTopoDocumentManifest(rootDir, cardPath, loaded.manifest);
  _fs_writeTopoDocumentManifest(rootDir, cardPath, reconciled.manifest);
  return {
    repaired: loaded.corrupted || loaded.normalized || reconciled.changed,
    corrupted: loaded.corrupted,
    added: reconciled.added,
    removed: reconciled.removed,
    documents: Object.keys(reconciled.manifest.documents).map(function(id) { return reconciled.manifest.documents[id]; }),
  };
}

function _fs_exportTopoDocument(rootDir, cardPath, documentId) {
  var found = _fs_findTopoDocument(rootDir, cardPath, documentId);
  var filePath = _fs_topoDocumentAbsolutePath(rootDir, cardPath, found.item);
  var fileName = nodePath.basename(found.item.path);
  return {
    fileName: fileName,
    type: found.item.type,
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify(nodeFs.existsSync(filePath) ? _fs_readJsonFile(filePath) : _fs_createTopoDocumentInitialContent(found.item.type, found.item.title, Date.now()), null, 2),
  };
}

async function _fs_openTopoDocumentFolder(rootDir, cardPath, documentId) {
  var found = _fs_findTopoDocument(rootDir, cardPath, documentId);
  var filePath = _fs_topoDocumentAbsolutePath(rootDir, cardPath, found.item);
  var folderPath = nodePath.dirname(filePath);
  if (!nodeFs.existsSync(folderPath)) return false;
  var err = await shell.openPath(folderPath);
  return err === '';
}

function _fs_createTopoDocument(rootDir, cardPath, input) {
  var type = _fs_normalizeTopoDocumentType(input && input.type);
  var title = String(input && input.title || '').trim();
  if (!title) throw new Error('文档名称不能为空');
  var now = Date.now();
  var docsDir = _fs_topoDocumentsDir(rootDir, cardPath);
  _fs_ensureDir(docsDir);
  var manifest = _fs_readTopoDocumentManifest(rootDir, cardPath);
  var id = 'doc_' + randomUUID().replace(/-/g, '');
  var fileName = id + TOPO_DOCUMENT_EXTENSIONS[type];
  var filePath = nodePath.join(docsDir, fileName);
  
  var maxSortOrder = 0;
  var parentId = (input && input.parentId) ? String(input.parentId) : null;
  if (parentId && !manifest.documents[parentId]) {
    throw new Error('父文档不存在');
  }
  Object.keys(manifest.documents).forEach(function(did) {
    if (manifest.documents[did].parentId === parentId && manifest.documents[did].sortOrder > maxSortOrder) {
      maxSortOrder = manifest.documents[did].sortOrder;
    }
  });

  var item = {
    id: id,
    type: type,
    title: title,
    path: fileName,
    parentId: parentId,
    sortOrder: ++maxSortOrder,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  var initialContent = _fs_createTopoDocumentInitialContent(type, title, now);
  _fs_writeTopoDocumentContent(filePath, type, initialContent);
  manifest.documents[id] = item;
  _fs_writeTopoDocumentManifest(rootDir, cardPath, manifest);
  return item;
}

function _fs_readTopoDocument(rootDir, cardPath, documentId) {
  var found = _fs_findTopoDocument(rootDir, cardPath, documentId);
  var filePath = _fs_topoDocumentAbsolutePath(rootDir, cardPath, found.item);
  if (!nodeFs.existsSync(filePath)) {
    return _fs_createTopoDocumentInitialContent(found.item.type, found.item.title, Date.now());
  }
  return _fs_readJsonFile(filePath);
}

function _fs_writeTopoDocument(rootDir, cardPath, documentId, content) {
  var found = _fs_findTopoDocument(rootDir, cardPath, documentId);
  var filePath = _fs_topoDocumentAbsolutePath(rootDir, cardPath, found.item);
  _fs_writeTopoDocumentContent(filePath, found.item.type, content);
  var now = Date.now();
  found.item.updatedAt = now;
  found.manifest.documents[found.item.id] = found.item;
  _fs_writeTopoDocumentManifest(rootDir, cardPath, found.manifest);
}

function _fs_renameTopoDocument(rootDir, cardPath, documentId, title) {
  var nextTitle = String(title || '').trim();
  if (!nextTitle) throw new Error('文档名称不能为空');
  var found = _fs_findTopoDocument(rootDir, cardPath, documentId);
  var now = Date.now();
  found.item.title = nextTitle;
  found.item.updatedAt = now;
  found.manifest.documents[found.item.id] = found.item;
  _fs_writeTopoDocumentManifest(rootDir, cardPath, found.manifest);
  return found.item;
}

function _fs_deleteTopoDocument(rootDir, cardPath, documentId) {
  var found = _fs_findTopoDocument(rootDir, cardPath, documentId);
  
  var toDelete = [found.item.id];
  var collectChildren = function(parentId) {
    Object.keys(found.manifest.documents).forEach(function(id) {
      if (found.manifest.documents[id].parentId === parentId) {
        toDelete.push(id);
        collectChildren(id);
      }
    });
  };
  collectChildren(found.item.id);
  
  toDelete.forEach(function(id) {
    var item = found.manifest.documents[id];
    var filePath = _fs_topoDocumentAbsolutePath(rootDir, cardPath, item);
    if (nodeFs.existsSync(filePath)) {
      nodeFs.rmSync(filePath, { force: true });
    }
    delete found.manifest.documents[id];
  });
  
  _fs_writeTopoDocumentManifest(rootDir, cardPath, found.manifest);
}

function _fs_moveTopoDocument(rootDir, cardPath, documentId, newParentId, newSortOrder) {
  var found = _fs_findTopoDocument(rootDir, cardPath, documentId);
  var nextParentId = newParentId ? String(newParentId) : null;
  if (nextParentId && !found.manifest.documents[nextParentId]) {
    throw new Error('父文档不存在');
  }
  // Optional: check cycle
  var checkCycle = function(parentId) {
    var current = parentId;
    while (current) {
      if (current === found.item.id) throw new Error('不能将文档移动到其子文档中');
      current = found.manifest.documents[current] ? found.manifest.documents[current].parentId : null;
    }
  };
  checkCycle(nextParentId);
  
  found.item.parentId = nextParentId;
  found.item.sortOrder = newSortOrder || 0;
  found.item.updatedAt = Date.now();
  found.manifest.documents[found.item.id] = found.item;
  _fs_writeTopoDocumentManifest(rootDir, cardPath, found.manifest);
  return found.item;
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

    listTopoDocuments: function(rootDir, cardPath) {
      return _fs_listTopoDocuments(rootDir, cardPath);
    },

    createTopoDocument: function(rootDir, cardPath, input) {
      return _fs_createTopoDocument(rootDir, cardPath, input);
    },

    readTopoDocument: function(rootDir, cardPath, documentId) {
      return _fs_readTopoDocument(rootDir, cardPath, documentId);
    },

    writeTopoDocument: function(rootDir, cardPath, documentId, content) {
      return _fs_writeTopoDocument(rootDir, cardPath, documentId, content);
    },

    renameTopoDocument: function(rootDir, cardPath, documentId, title) {
      return _fs_renameTopoDocument(rootDir, cardPath, documentId, title);
    },

    deleteTopoDocument: function(rootDir, cardPath, documentId) {
      return _fs_deleteTopoDocument(rootDir, cardPath, documentId);
    },

    moveTopoDocument: function(rootDir, cardPath, documentId, newParentId, newSortOrder) {
      return _fs_moveTopoDocument(rootDir, cardPath, documentId, newParentId, newSortOrder);
    },

    repairTopoDocuments: function(rootDir, cardPath) {
      return _fs_repairTopoDocuments(rootDir, cardPath);
    },

    exportTopoDocument: function(rootDir, cardPath, documentId) {
      return _fs_exportTopoDocument(rootDir, cardPath, documentId);
    },

    openTopoDocumentFolder: async function(rootDir, cardPath, documentId) {
      return _fs_openTopoDocumentFolder(rootDir, cardPath, documentId);
    },

    listAttachments: function(rootDir, cardPath) {
      return _fs_listAttachments(rootDir, cardPath);
    },

    importAttachment: function(rootDir, cardPath, sourceFilePath, targetFileName) {
      return _fs_importAttachment(rootDir, cardPath, sourceFilePath, targetFileName);
    },

    deleteAttachment: function(rootDir, cardPath, attachmentName) {
      return _fs_deleteAttachment(rootDir, cardPath, attachmentName);
    },

    openAttachment: async function(rootDir, cardPath, attachmentRef) {
      var filePath = _fs_attachmentRefToPath(rootDir, cardPath, attachmentRef);
      if (!nodeFs.existsSync(filePath)) return false;
      var err = await shell.openPath(filePath);
      return err === '';
    },

    writeAttachmentBase64: function(rootDir, cardPath, fileName, mimeType, base64) {
      var ext = _fs_extFromMime(mimeType);
      var safeName = _fs_safeFileName(fileName || ('image.' + ext));
      if (safeName.indexOf('.') < 0) safeName += '.' + ext;
      return _fs_writeAttachmentBuffer(rootDir, cardPath, safeName, Buffer.from(String(base64 || ''), 'base64'));
    },

    downloadAttachment: async function(rootDir, cardPath, url, targetFileName) {
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
      var fileName = targetFileName || nodePath.basename(urlPath) || ('image.' + _fs_extFromMime(mimeType));
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
            if (/\.(json|txt)$/i.test(entry.name)) {
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
