/**
 * File Service - 文件系统操作服务
 * 封装工作目录、知识库、卡片和文件的基础读写能力。
 */
import nodePath from 'path';
import nodeFs from 'fs';
import nodeDns from 'dns/promises';
import nodeNet from 'net';
import { shell } from 'electron';
import { randomUUID } from 'crypto';
import {
  appConfigPath as pathGuardAppConfigPath,
  isValidWorkDir as pathGuardIsValidWorkDir,
  kbsDir as pathGuardKbsDir,
  logsDir as pathGuardLogsDir,
  requireValidWorkDir as pathGuardRequireValidWorkDir,
  validateAbsolutePath as pathGuardValidateAbsolutePath,
} from './services/path-guard.js';
import {
  createWorkDir as workspaceCreateWorkDir,
  isValidWorkDir as workspaceIsValidWorkDir,
} from './services/workspace-service.js';
import { createKbService } from './services/kb-service.js';
import { createCardService } from './services/card-service.js';
import { createGraphMetaService } from './services/graph-meta-service.js';
import { createAttachmentService } from './services/attachment-service.js';
import { createDocumentService } from './services/document-service.js';
import { createTrashService } from './services/trash-service.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_APP_CONFIG_BYTES = 256 * 1024;
const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 15000;
const BLOCKED_OPEN_ATTACHMENT_EXTENSIONS = new Set([
  '.app',
  '.bat',
  '.cmd',
  '.com',
  '.cpl',
  '.exe',
  '.hta',
  '.js',
  '.jse',
  '.lnk',
  '.msi',
  '.msp',
  '.ps1',
  '.scr',
  '.sh',
  '.url',
  '.vbe',
  '.vbs',
  '.wsf',
]);

/**
 * @description 返回工作目录下的知识库根目录路径
 * @param { string } dir: 工作目录路径
 * @returns { string } kbs 目录路径
 */
function _fs_kbsDir(dir) {
  return pathGuardKbsDir(dir);
}

/**
 * @description 返回工作目录下的日志目录路径
 * @param { string } dir: 工作目录路径
 * @returns { string } logs 目录路径
 */
function _fs_logsDir(dir) {
  return pathGuardLogsDir(dir);
}

/**
 * @description 返回工作目录下的应用配置文件路径
 * @param { string } dir: 工作目录路径
 * @returns { string } _config.json 文件路径
 */
function _fs_appConfigPath(dir) {
  return pathGuardAppConfigPath(dir);
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
  return pathGuardIsValidWorkDir(dirPath);
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

function _fs_moveToTrash(rootDir, sourcePath, category, extraMetadata) {
  if (!nodeFs.existsSync(sourcePath)) return null;
  var trashDir = nodePath.join(rootDir, '.trash', _fs_safeSegment(category || 'items'));
  _fs_ensureDir(trashDir);
  var parsed = nodePath.parse(sourcePath);
  var baseName = _fs_safeSegment(parsed.name || parsed.base || 'item');
  var ext = parsed.ext || '';
  var stamp = new Date().toISOString().replace(/[:.]/g, '-');
  var candidate = stamp + '-' + baseName + ext;
  var target = nodePath.join(trashDir, candidate);
  var i = 1;
  while (nodeFs.existsSync(target)) {
    target = nodePath.join(trashDir, stamp + '-' + baseName + '-' + i + ext);
    i += 1;
  }
  nodeFs.renameSync(sourcePath, target);
  try {
    _fs_writeJsonFile(target + '.trash.json', {
      category: category || 'items',
      originalPath: nodePath.relative(rootDir, sourcePath).split(nodePath.sep).join('/'),
      originalName: nodePath.basename(sourcePath),
      deletedAt: Date.now(),
      trashName: nodePath.basename(target),
      ...(_fs_isPlainObject(extraMetadata) ? extraMetadata : {}),
    });
  } catch {}
  return target;
}

function _fs_listTrashItems(rootDir, category) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var trashDir = nodePath.join(rootDir, '.trash', _fs_safeSegment(category));
  if (!nodeFs.existsSync(trashDir)) return [];
  return nodeFs.readdirSync(trashDir, { withFileTypes: true })
    .filter(function(entry) { return !entry.name.endsWith('.trash.json'); })
    .map(function(entry) {
      var itemPath = nodePath.join(trashDir, entry.name);
      var stat = nodeFs.statSync(itemPath);
      var meta = {};
      try {
        meta = _fs_readJsonFile(itemPath + '.trash.json');
      } catch {}
      return {
        trashName: entry.name,
        originalName: String(meta.originalName || entry.name),
        originalPath: String(meta.originalPath || ''),
        deletedAt: Number.isFinite(meta.deletedAt) ? meta.deletedAt : stat.mtimeMs,
        size: stat.size,
        isDirectory: entry.isDirectory(),
        meta: meta,
      };
    })
    .sort(function(a, b) { return b.deletedAt - a.deletedAt; });
}

function _fs_restoreTrashItem(rootDir, category, trashName, destinationParentDir) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var safeTrashName = nodePath.basename(String(trashName || '').trim());
  if (!safeTrashName || safeTrashName.endsWith('.trash.json')) throw new Error('回收站项目名称无效');
  var trashDir = nodePath.join(rootDir, '.trash', _fs_safeSegment(category));
  var source = nodePath.resolve(trashDir, safeTrashName);
  if (!isPathWithinDirCompat(trashDir, source) || !nodeFs.existsSync(source)) {
    throw new Error('回收站项目不存在');
  }
  var meta = {};
  try {
    meta = _fs_readJsonFile(source + '.trash.json');
  } catch {}
  var originalName = _fs_safeSegment(meta.originalName || safeTrashName.replace(/^\d{4}-\d{2}-\d{2}t?\d{2}-\d{2}-\d{2}-\d{3}z?-/i, ''));
  var targetParent = destinationParentDir || rootDir;
  _fs_ensureDir(targetParent);
  var target = nodePath.join(targetParent, _fs_uniqueFolderName(targetParent, originalName));
  nodeFs.renameSync(source, target);
  try {
    if (nodeFs.existsSync(source + '.trash.json')) nodeFs.rmSync(source + '.trash.json', { force: true });
  } catch {}
  return target;
}

function _fs_clearTrashItems(rootDir, category) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var trashDir = nodePath.join(rootDir, '.trash', _fs_safeSegment(category));
  if (!nodeFs.existsSync(trashDir)) return;
  nodeFs.readdirSync(trashDir).forEach(function(entryName) {
    nodeFs.rmSync(nodePath.join(trashDir, entryName), { recursive: true, force: true });
  });
}

function _fs_deleteTrashItem(rootDir, category, trashName) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var trashDir = nodePath.join(rootDir, '.trash', _fs_safeSegment(category));
  var safeTrashName = nodePath.basename(String(trashName || '').trim());
  if (!safeTrashName || safeTrashName.endsWith('.trash.json')) return;
  var target = nodePath.resolve(trashDir, safeTrashName);
  if (!isPathWithinDirCompat(trashDir, target)) return;
  nodeFs.rmSync(target, { recursive: true, force: true });
  nodeFs.rmSync(target + '.trash.json', { force: true });
}

function isPathWithinDirCompat(parentDir, targetPath) {
  var relativePath = nodePath.relative(nodePath.resolve(parentDir), nodePath.resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..' + nodePath.sep) && relativePath !== '..' && !nodePath.isAbsolute(relativePath));
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
  if (rel === '..' || rel.startsWith('..' + nodePath.sep) || nodePath.isAbsolute(rel)) {
    throw new Error('路径越界: ' + relPath);
  }
  return result;
}

function _fs_requireSafeKbsTextFile(rootDir, relPath) {
  if (typeof relPath !== 'string') throw new Error('文件路径必须是字符串');
  var safeRelPath = relPath.trim().replace(/\\/g, '/');
  if (!safeRelPath || safeRelPath.length > 512 || /[\x00-\x1F\x7F]/.test(safeRelPath)) {
    throw new Error('文件路径无效');
  }
  if (nodePath.isAbsolute(safeRelPath)) throw new Error('文件路径必须是相对路径');
  var resolvedPath = _fs_resolveKbsPath(rootDir, safeRelPath);
  var ext = nodePath.extname(resolvedPath).toLowerCase();
  if (!['.md', '.txt', '.json', '.csv'].includes(ext)) {
    throw new Error('不支持读取或写入该类型文件');
  }
  return resolvedPath;
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
  _fs_ensureDir(nodePath.dirname(filePath));
  var tempPath = filePath + '.tmp-' + process.pid + '-' + Date.now();
  var fd = null;
  try {
    fd = nodeFs.openSync(tempPath, 'w');
    nodeFs.writeFileSync(fd, JSON.stringify(data || {}, null, 2), 'utf-8');
    nodeFs.fsyncSync(fd);
    nodeFs.closeSync(fd);
    fd = null;
    nodeFs.renameSync(tempPath, filePath);
  } catch (e) {
    if (fd !== null) {
      try {
        nodeFs.closeSync(fd);
      } catch {}
    }
    try {
      if (nodeFs.existsSync(tempPath)) nodeFs.rmSync(tempPath, { force: true });
    } catch {}
    throw e;
  }
}

function _fs_requirePlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error((label || '内容') + '必须是普通对象');
  }
  return value;
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
  return pathGuardValidateAbsolutePath(dir);
}

/**
 * @description 校验并返回可安全读写的工作目录绝对路径
 * @param { string } rootDir: 工作目录路径
 * @returns { string } 标准化后的工作目录绝对路径
 * @throws { Error } 当工作目录无效时抛出错误
 */
export function _fs_requireValidWorkDir(rootDir) {
  return pathGuardRequireValidWorkDir(rootDir);
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
  if (!String(dirPath || '').trim()) {
    throw new Error('不能删除知识库根目录');
  }
  var d = _fs_resolveKbsPath(rootDir, dirPath);
  var normalizedPath = String(dirPath || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  var kind = normalizedPath.includes('/') ? 'card' : 'kb';
  _fs_moveToTrash(rootDir, d, 'kbs', {
    kind: kind,
    kbsPath: normalizedPath,
  });
}

function _fs_kbsTrashItemKind(item) {
  var kind = item && item.meta ? String(item.meta.kind || '') : '';
  if (kind === 'kb' || kind === 'card') return kind;
  var originalPath = String(item && item.originalPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (originalPath.toLowerCase().startsWith('kbs/')) {
    originalPath = originalPath.slice(4);
  }
  return originalPath && !originalPath.includes('/') ? 'kb' : 'card';
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

function _fs_requireAttachmentSize(byteLength) {
  if (byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error('附件大小不能超过 20MB');
  }
}

function _fs_requireSafeOpenAttachment(filePath) {
  var ext = nodePath.extname(filePath).toLowerCase();
  if (BLOCKED_OPEN_ATTACHMENT_EXTENSIONS.has(ext)) {
    throw new Error('出于安全考虑，不允许直接打开该类型附件: ' + ext);
  }
}

function _fs_isPrivateIp(address) {
  if (nodeNet.isIP(address) === 4) {
    var parts = address.split('.').map(function(part) { return Number(part); });
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  var normalized = String(address || '').toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('::ffff:')) {
    return _fs_isPrivateIp(normalized.replace('::ffff:', ''));
  }
  return false;
}

async function _fs_requirePublicHttpUrl(rawUrl) {
  var parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http/https 图片链接');
  }
  var hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('不允许访问本机或内网地址');
  }
  if (nodeNet.isIP(hostname)) {
    if (_fs_isPrivateIp(hostname)) throw new Error('不允许访问本机或内网地址');
    return parsed;
  }
  var records = await nodeDns.lookup(hostname, { all: true });
  if (!records.length || records.some(function(record) { return _fs_isPrivateIp(record.address); })) {
    throw new Error('不允许访问本机或内网地址');
  }
  return parsed;
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
  _fs_requireAttachmentSize(buffer.length);
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
  var attachDir = nodePath.resolve(baseDir, '_attach');
  var target = nodePath.resolve(baseDir, normalizedRef);
  var relativePath = nodePath.relative(attachDir, target);
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith('..' + nodePath.sep) || nodePath.isAbsolute(relativePath)) {
    throw new Error('附件路径越界: ' + rawRef);
  }
  return target;
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
  var sourcePath = _fs_validateAbsolutePath(sourceFilePath);
  if (!nodeFs.existsSync(sourcePath)) {
    throw new Error('源文件不存在: ' + sourcePath);
  }
  if (nodeFs.lstatSync(sourcePath).isSymbolicLink()) {
    throw new Error('不能导入符号链接文件');
  }
  var stat = nodeFs.statSync(sourcePath);
  if (!stat.isFile()) {
    throw new Error('只能导入文件');
  }
  _fs_requireAttachmentSize(stat.size);
  
  var fileName = targetFileName || nodePath.basename(sourcePath);
  var cardDir = cardPath === '__ROOT__' ? rootDir : _fs_resolveKbsPath(rootDir, cardPath);
  var attachDir = nodePath.join(cardDir, '_attach');
  _fs_ensureDir(attachDir);
  var target = _fs_uniqueFilePath(attachDir, fileName);
  
  nodeFs.copyFileSync(sourcePath, target);
  return '_attach/' + nodePath.basename(target);
}

function _fs_deleteAttachment(rootDir, cardPath, attachmentName) {
  var filePath = _fs_attachmentRefToPath(rootDir, cardPath, attachmentName);
  _fs_moveToTrash(_fs_requireValidWorkDir(rootDir), filePath, 'attachments');
}

function _fs_attachmentDir(rootDir, cardPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var cardDir = cardPath === '__ROOT__' ? rootDir : _fs_resolveKbsPath(rootDir, cardPath);
  return nodePath.join(cardDir, '_attach');
}

function _fs_listTrashAttachments(rootDir, cardPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var attachDir = _fs_attachmentDir(rootDir, cardPath);
  var expectedOriginalDir = nodePath.relative(rootDir, attachDir).split(nodePath.sep).join('/');
  return _fs_listTrashItems(rootDir, 'attachments').filter(function(item) {
    return nodePath.dirname(item.originalPath).split(nodePath.sep).join('/') === expectedOriginalDir;
  });
}

function _fs_restoreTrashAttachment(rootDir, cardPath, trashName) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var attachDir = _fs_attachmentDir(rootDir, cardPath);
  var allowed = _fs_listTrashAttachments(rootDir, cardPath).some(function(item) {
    return item.trashName === trashName;
  });
  if (!allowed) throw new Error('附件不属于当前文档回收站');
  var safeTrashName = nodePath.basename(String(trashName || '').trim());
  var trashDir = nodePath.join(rootDir, '.trash', 'attachments');
  var source = nodePath.resolve(trashDir, safeTrashName);
  if (!isPathWithinDirCompat(trashDir, source) || !nodeFs.existsSync(source)) {
    throw new Error('回收站附件不存在');
  }
  var meta = {};
  try {
    meta = _fs_readJsonFile(source + '.trash.json');
  } catch {}
  var fileName = _fs_safeFileName(meta.originalName || safeTrashName);
  _fs_ensureDir(attachDir);
  var target = _fs_uniqueFilePath(attachDir, fileName);
  nodeFs.copyFileSync(source, target);
  try {
    if (nodeFs.existsSync(source)) nodeFs.rmSync(source, { force: true });
    if (nodeFs.existsSync(source + '.trash.json')) nodeFs.rmSync(source + '.trash.json', { force: true });
  } catch {}
  return '_attach/' + nodePath.basename(target);
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
  if (rel === '..' || rel.startsWith('..' + nodePath.sep) || nodePath.isAbsolute(rel)) {
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
          if (typeof item.icon === 'string' && item.icon.trim()) documents[id].icon = item.icon.slice(0, 32);
          if (typeof item.color === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(item.color)) documents[id].color = item.color;
          if (item.originalParentId) documents[id].originalParentId = String(item.originalParentId);
          if (item.originalDocumentId) documents[id].originalDocumentId = String(item.originalDocumentId);
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
          if (typeof item.icon === 'string' && item.icon.trim()) documents[id].icon = item.icon.slice(0, 32);
          if (typeof item.color === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(item.color)) documents[id].color = item.color;
          if (item.originalParentId) documents[id].originalParentId = String(item.originalParentId);
          if (item.originalDocumentId) documents[id].originalDocumentId = String(item.originalDocumentId);
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
      var extension = TOPO_DOCUMENT_EXTENSIONS[type];
      var id = previous ? previous.id : (fileName.endsWith(extension) ? fileName.slice(0, -extension.length) : 'doc_' + randomUUID().replace(/-/g, ''));
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
      if (previous && typeof previous.icon === 'string' && previous.icon) documents[id].icon = previous.icon;
      if (previous && typeof previous.color === 'string' && previous.color) documents[id].color = previous.color;
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
  var found;
  try {
    found = _fs_findTopoDocument(rootDir, cardPath, documentId);
  } catch (e) {
    if (e.message.indexOf('文档不存在') !== -1) {
      return null;
    }
    throw e;
  }
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

function _fs_updateTopoDocumentMeta(rootDir, cardPath, documentId, patch) {
  var found = _fs_findTopoDocument(rootDir, cardPath, documentId);
  if (!_fs_isPlainObject(patch)) throw new Error('元数据参数不合法');
  var now = Date.now();
  if (Object.prototype.hasOwnProperty.call(patch, 'icon')) {
    var nextIcon = patch.icon === null ? '' : String(patch.icon || '');
    if (nextIcon.trim()) {
      found.item.icon = nextIcon.trim().slice(0, 32);
    } else {
      delete found.item.icon;
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'color')) {
    var nextColor = patch.color === null ? '' : String(patch.color || '');
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(nextColor)) {
      found.item.color = nextColor;
    } else {
      delete found.item.color;
    }
  }
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
    _fs_moveToTrash(_fs_requireValidWorkDir(rootDir), filePath, 'topo-documents', {
      cardPath: String(cardPath || ''),
      topoDocumentItem: item,
    });
    delete found.manifest.documents[id];
  });
  
  _fs_writeTopoDocumentManifest(rootDir, cardPath, found.manifest);
}

function _fs_listTrashTopoDocuments(rootDir, cardPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  return _fs_listTrashItems(rootDir, 'topo-documents').filter(function(item) {
    return item.meta && item.meta.cardPath === String(cardPath || '');
  }).map(function(item) {
    var topoItem = item.meta && item.meta.topoDocumentItem;
    var type = 'smart';
    try {
      type = _fs_normalizeTopoDocumentType(topoItem && topoItem.type);
    } catch {}
    return {
      trashName: item.trashName,
      originalName: item.originalName,
      originalPath: item.originalPath,
      deletedAt: item.deletedAt,
      size: item.size,
      isDirectory: item.isDirectory,
      documentId: topoItem && topoItem.id ? String(topoItem.id) : '',
      title: topoItem && topoItem.title ? String(topoItem.title) : item.originalName,
      type: type,
    };
  });
}

function _fs_relinkRestoredTopoDocumentChildren(manifest, originalParentId, restoredParentId) {
  if (!originalParentId || !restoredParentId) return;
  Object.keys(manifest.documents).forEach(function(id) {
    var item = manifest.documents[id];
    if (!item || item.id === restoredParentId) return;
    if (item.parentId !== null) return;
    if (item.originalParentId !== String(originalParentId)) return;
    item.parentId = String(restoredParentId);
    item.updatedAt = Date.now();
    delete item.originalParentId;
    manifest.documents[id] = item;
  });
}

function _fs_restoreTrashTopoDocument(rootDir, cardPath, trashName) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var trashItems = _fs_listTrashItems(rootDir, 'topo-documents');
  var item = trashItems.find(function(candidate) {
    return candidate.trashName === trashName && candidate.meta && candidate.meta.cardPath === String(cardPath || '');
  });
  if (!item) throw new Error('回收站文档不存在');
  var topoItem = item.meta.topoDocumentItem;
  if (!_fs_isPlainObject(topoItem)) throw new Error('回收站文档元数据损坏');
  var type = _fs_normalizeTopoDocumentType(topoItem.type);
  var docsDir = _fs_topoDocumentsDir(rootDir, cardPath);
  var manifest = _fs_readTopoDocumentManifest(rootDir, cardPath);
  var nextId = String(topoItem.id || '');
  if (!nextId || manifest.documents[nextId]) {
    nextId = 'doc_' + randomUUID().replace(/-/g, '');
  }
  var safePath = _fs_normalizeTopoDocumentPath(type, topoItem.path || (nextId + TOPO_DOCUMENT_EXTENSIONS[type]));
  if (manifest.documents[nextId] || Object.values(manifest.documents).some(function(existing) { return existing.path === safePath; })) {
    safePath = nextId + TOPO_DOCUMENT_EXTENSIONS[type];
  }
  _fs_ensureDir(docsDir);
  var trashDir = nodePath.join(rootDir, '.trash', 'topo-documents');
  var source = nodePath.resolve(trashDir, nodePath.basename(String(trashName || '')));
  if (!isPathWithinDirCompat(trashDir, source) || !nodeFs.existsSync(source)) throw new Error('回收站文档文件不存在');
  var target = nodePath.join(docsDir, safePath);
  if (nodeFs.existsSync(target)) target = _fs_uniqueFilePath(docsDir, safePath);
  nodeFs.copyFileSync(source, target);
  var restoredPath = nodePath.basename(target);
  var originalDocumentId = topoItem.id ? String(topoItem.id) : null;
  var originalParentId = topoItem.parentId ? String(topoItem.parentId) : null;
  var restoredParentId = null;
  if (originalParentId) {
    if (manifest.documents[originalParentId]) {
      restoredParentId = originalParentId;
    } else {
      var restoredParentItem = Object.values(manifest.documents).find(function(existing) {
        return existing && existing.originalDocumentId === originalParentId;
      });
      restoredParentId = restoredParentItem ? restoredParentItem.id : null;
    }
  }
  var restoredItem = {
    id: nextId,
    type: type,
    title: String(topoItem.title || item.originalName || '未命名文档'),
    path: restoredPath,
    parentId: restoredParentId,
    sortOrder: Object.keys(manifest.documents).length + 1,
    createdAt: Number.isFinite(topoItem.createdAt) ? topoItem.createdAt : Date.now(),
    updatedAt: Date.now(),
    version: Number.isFinite(topoItem.version) ? topoItem.version : 1,
  };
  if (typeof topoItem.icon === 'string' && topoItem.icon.trim()) restoredItem.icon = topoItem.icon.slice(0, 32);
  if (typeof topoItem.color === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(topoItem.color)) restoredItem.color = topoItem.color;
  if (originalDocumentId && nextId !== originalDocumentId) {
    restoredItem.originalDocumentId = originalDocumentId;
  }
  if (originalParentId && !restoredParentId) {
    restoredItem.originalParentId = originalParentId;
  }
  try {
    manifest.documents[nextId] = restoredItem;
    _fs_relinkRestoredTopoDocumentChildren(manifest, topoItem.id, nextId);
    _fs_writeTopoDocumentManifest(rootDir, cardPath, manifest);
  } catch (e) {
    try {
      if (nodeFs.existsSync(target)) nodeFs.rmSync(target, { force: true });
    } catch {}
    throw e;
  }
  try {
    if (nodeFs.existsSync(source)) nodeFs.rmSync(source, { force: true });
    if (nodeFs.existsSync(source + '.trash.json')) nodeFs.rmSync(source + '.trash.json', { force: true });
  } catch {}
  return restoredItem;
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

// ===== 跨节点移动文档（含整棵子文档子树与附件） =====

// 从文档内容（任意结构化对象）中提取所有 `_attach/<name>` 引用，去重返回。
// 采用 JSON 序列化后扫描，确保覆盖所有块类型（image/file/video/audio 等）
// 以及富文本内联引用，避免漏改导致图裂。
function _fs_extractAttachmentRefs(content) {
  var refs = {};
  var text;
  try {
    text = JSON.stringify(content == null ? '' : content);
  } catch (e) {
    return [];
  }
  var re = /_attach\/[^"'\\\s]+/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    refs[m[0]] = true;
  }
  return Object.keys(refs);
}

// 用 { 旧ref: 新ref } 映射表重写内容中的 `_attach` 引用。
// 按 JSON 引号边界替换（"_attach/foo.png" -> "_attach/foo-1.png"），
// 避免把更长文件名的前缀误伤成另一个引用。
function _fs_rewriteAttachmentRefsInContent(content, refMap) {
  if (!refMap || !Object.keys(refMap).length) return content;
  var text;
  try {
    text = JSON.stringify(content == null ? '' : content);
  } catch (e) {
    return content;
  }
  Object.keys(refMap).forEach(function(oldRef) {
    var newRef = refMap[oldRef];
    if (!newRef || newRef === oldRef) return;
    var quotedOld = JSON.stringify(oldRef);
    var quotedNew = JSON.stringify(newRef);
    text = text.split(quotedOld).join(quotedNew);
  });
  try {
    return JSON.parse(text);
  } catch (e) {
    return content;
  }
}

// 将一篇文档的附件从源节点复制到目标节点，返回 { 旧ref: 新ref } 映射。
// 源附件缺失时跳过改写（避免图裂），复制/导入失败也跳过（不阻断移动主流程）。
function _fs_copyDocumentAttachmentsToCard(rootDir, sourceCardPath, targetCardPath, content) {
  var refMap = {};
  var refs = _fs_extractAttachmentRefs(content);
  refs.forEach(function(ref) {
    if (refMap[ref]) return;
    var sourcePath;
    try {
      sourcePath = _fs_attachmentRefToPath(rootDir, sourceCardPath, ref);
    } catch (e) {
      return;
    }
    if (!nodeFs.existsSync(sourcePath)) return;
    var fileName = nodePath.basename(sourcePath);
    var newRef;
    try {
      newRef = _fs_importAttachment(rootDir, targetCardPath, sourcePath, fileName);
    } catch (e) {
      return;
    }
    if (newRef) refMap[ref] = newRef;
  });
  return refMap;
}

// 跨节点移动一篇文档及其全部子文档，并迁移对应附件。
// 返回 { moved: [...], targetCardPath, movedCount, attachmentCount, attachmentCleaned }。
// 策略：先把整棵子树（含附件）写入目标节点，再删除源（进回收站）。
// 写入失败不影响源数据；删除失败也不影响已写入的目标。
// 删除源后，再清理源节点中「被移动文档引用、且其他活动文档不再引用」的孤儿附件（进附件回收站，可撤销）。
function _fs_moveTopoDocumentToCard(rootDir, sourceCardPath, documentId, targetCardPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  if (!targetCardPath || !String(targetCardPath).trim()) {
    throw new Error('目标节点不能为空');
  }
  var sourceManifest = _fs_readTopoDocumentManifest(rootDir, sourceCardPath);
  var sourceKey = String(documentId || '');
  var sourceItem = sourceManifest.documents[sourceKey];
  if (!sourceItem) throw new Error('源文档不存在: ' + documentId);

  // 同节点内移动：直接复用既有 reparent 逻辑（不产生副本、不动附件）。
  if (String(sourceCardPath) === String(targetCardPath)) {
    return _fs_moveTopoDocument(rootDir, sourceCardPath, documentId, null, 0);
  }

  // 提前校验目标节点目录合法（不存在则抛错，避免写到无效位置）。
  var targetCardDir = targetCardPath === '__ROOT__' ? rootDir : _fs_resolveKbsPath(rootDir, targetCardPath);

  // 收集整棵子树（深度优先，含自身）。
  var subtreeIds = [];
  (function collect(id) {
    subtreeIds.push(id);
    Object.keys(sourceManifest.documents).forEach(function(did) {
      if (sourceManifest.documents[did].parentId === id) collect(did);
    });
  })(sourceKey);

  // 为子树每个文档分配新 id（避免与目标节点已有 id 冲突），并保持父子映射。
  var idRemap = {};
  subtreeIds.forEach(function(id) {
    idRemap[id] = 'doc_' + randomUUID().replace(/-/g, '');
  });

  var targetManifest = _fs_readTopoDocumentManifest(rootDir, targetCardPath);
  var targetDocsDir = _fs_topoDocumentsDir(rootDir, targetCardPath);
  _fs_ensureDir(targetDocsDir);
  var maxSortOrder = 0;
  Object.keys(targetManifest.documents).forEach(function(did) {
    if (targetManifest.documents[did].sortOrder > maxSortOrder) maxSortOrder = targetManifest.documents[did].sortOrder;
  });

  var movedItems = [];
  var attachmentCount = 0;
  var movedAttachmentRefs = {};

  subtreeIds.forEach(function(oldId) {
    var item = sourceManifest.documents[oldId];
    var content = _fs_readTopoDocument(rootDir, sourceCardPath, oldId);
    var refMap = _fs_copyDocumentAttachmentsToCard(rootDir, sourceCardPath, targetCardPath, content);
    attachmentCount += Object.keys(refMap).length;
    Object.keys(refMap).forEach(function(r) { movedAttachmentRefs[r] = true; });
    if (Object.keys(refMap).length) {
      content = _fs_rewriteAttachmentRefsInContent(content, refMap);
    }
    // 根文档在目标节点置为顶层（parentId=null）；子文档的 parentId 指向
    // 同子树中已被移动文档的新 id。
    var newParentId = (oldId === sourceKey)
      ? null
      : (item.parentId && idRemap[item.parentId] ? idRemap[item.parentId] : null);
    var newId = idRemap[oldId];
    var fileName = newId + TOPO_DOCUMENT_EXTENSIONS[item.type];
    var filePath = nodePath.join(targetDocsDir, fileName);
    _fs_writeTopoDocumentContent(filePath, item.type, content);
    var now = Date.now();
    var newItem = {
      id: newId,
      type: item.type,
      title: item.title,
      path: fileName,
      parentId: newParentId,
      sortOrder: ++maxSortOrder,
      createdAt: item.createdAt || now,
      updatedAt: now,
      version: item.version || 1,
    };
    if (typeof item.icon === 'string' && item.icon) newItem.icon = item.icon;
    if (typeof item.color === 'string' && item.color) newItem.color = item.color;
    targetManifest.documents[newId] = newItem;
    movedItems.push(newItem);
  });

  // 先提交目标清单，再删除源子树（进回收站，便于撤销/恢复）。
  _fs_writeTopoDocumentManifest(rootDir, targetCardPath, targetManifest);
  _fs_deleteTopoDocument(rootDir, sourceCardPath, documentId);

  // 清理源节点孤儿附件：被移动文档引用、且源节点其他活动文档不再引用的附件，
  // 移入附件回收站（与文档回收站一致，可撤销）。被共用的附件保留不动。
  var attachmentCleaned = 0;
  if (movedAttachmentRefs && Object.keys(movedAttachmentRefs).length) {
    var stillReferenced = {};
    try {
      var remainingManifest = _fs_readTopoDocumentManifest(rootDir, sourceCardPath);
      Object.keys(remainingManifest.documents).forEach(function(rid) {
        try {
          var c = _fs_readTopoDocument(rootDir, sourceCardPath, rid);
          _fs_extractAttachmentRefs(c).forEach(function(r) { stillReferenced[r] = true; });
        } catch (e) {}
      });
    } catch (e) {}
    Object.keys(movedAttachmentRefs).forEach(function(ref) {
      if (stillReferenced[ref]) return; // 仍被源节点其他文档引用，保留
      try {
        _fs_deleteAttachment(rootDir, sourceCardPath, ref);
        attachmentCleaned += 1;
      } catch (e) {}
    });
  }

  return {
    moved: movedItems,
    targetCardPath: targetCardPath,
    movedCount: movedItems.length,
    attachmentCount: attachmentCount,
    attachmentCleaned: attachmentCleaned,
  };
}

// 跨房间移动一批节点（含其整棵子目录树：子房间/文档/附件），并重分配房间级连线。
// 磁盘 _graph.json 真实格式：{ children: { [basename]: {...} }, edges: [{ id, source, target, ... }], zoom, pan }。
// 节点 key 与 edge 的 source/target 均为 room 相对 basename。
// 规则：
//  - 移动 = 从源房间 children 移除 + 整个节点目录树物理 relocate 到目标房间目录 + 写入目标 children。
//  - 连线边界集合运算：两端都在被移动集合内 → 保留并随迁入目标房间（内部连线，含改名后引用）；
//    一端在集合内、一端在源房间其余节点 → 丢弃（与源房间的连线不保留）；两端都不在集合内 → 留源房间。
//  - 目标房间同名节点自动重命名（foo → foo-1），并同步改写 intra-batch 连线引用。
//  - 防环：目标房间不能等于任一被移动节点路径，也不能是其后代子房间。
// 返回 { moved:[新basename], keptEdges, droppedEdges, targetRoomPath, sourceRoomPath, renamed:{old:new} }。
function _fs_moveTopoNodesToRoom(rootDir, sourceRoomPath, nodeIds, targetRoomPath) {
  rootDir = _fs_requireValidWorkDir(rootDir);
  var norm = function (ref) {
    return String(ref || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  };
  var joinp = function (a, b) {
    var na = norm(a); var nb = norm(b);
    if (!nb) return na;
    if (!na) return nb;
    if (nb === na || nb.indexOf(na + '/') === 0) return nb;
    return na + '/' + nb;
  };
  sourceRoomPath = norm(sourceRoomPath);
  targetRoomPath = norm(targetRoomPath);
  if (!sourceRoomPath) throw new Error('源房间不能为空');
  if (!targetRoomPath) throw new Error('目标房间不能为空');
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) throw new Error('未选择要移动的节点');
  if (targetRoomPath === sourceRoomPath) throw new Error('目标房间不能与源房间相同');

  var sourceDir = _fs_resolveKbsPath(rootDir, sourceRoomPath);
  var targetDir = _fs_resolveKbsPath(rootDir, targetRoomPath);
  if (!nodeFs.existsSync(sourceDir)) throw new Error('源房间不存在: ' + sourceRoomPath);
  if (!nodeFs.existsSync(targetDir)) throw new Error('目标房间不存在: ' + targetRoomPath);

  var graphFileOf = function (roomDir) { return nodePath.join(roomDir, '_graph.json'); };
  var sourceMeta = _fs_readJsonFile(graphFileOf(sourceDir));
  var sourceChildren = (sourceMeta && sourceMeta.children && typeof sourceMeta.children === 'object' && !Array.isArray(sourceMeta.children)) ? sourceMeta.children : {};
  var sourceEdges = Array.isArray(sourceMeta && sourceMeta.edges) ? sourceMeta.edges : [];

  // 被移动集合（仅保留源房间中真实存在的节点）
  var movedSet = {};
  var movedList = [];
  nodeIds.map(norm).forEach(function (id) {
    if (!id || movedSet[id] || !sourceChildren[id]) return;
    movedSet[id] = true;
    movedList.push(id);
  });
  if (movedList.length === 0) throw new Error('所选节点均不在源房间中');

  // 防环：目标不能等于任一被移动节点路径，也不能是其后代
  for (var c = 0; c < movedList.length; c += 1) {
    var movedPath = joinp(sourceRoomPath, movedList[c]);
    if (targetRoomPath === movedPath) throw new Error('不能把节点移动到其自身内部');
    if (targetRoomPath.indexOf(movedPath + '/') === 0) throw new Error('不能把节点移动到其自身的子房间内');
  }

  var targetMetaRaw = _fs_readJsonFile(graphFileOf(targetDir));
  var targetChildren = (targetMetaRaw && targetMetaRaw.children && typeof targetMetaRaw.children === 'object' && !Array.isArray(targetMetaRaw.children)) ? targetMetaRaw.children : {};
  var targetEdges = Array.isArray(targetMetaRaw && targetMetaRaw.edges) ? targetMetaRaw.edges : [];

  // 同名冲突 → 自动重命名，并建立 old→new 映射
  function uniqueChildKey(base) {
    var candidate = base; var n = 1;
    while (targetChildren[candidate] || newChildren[candidate]) { candidate = base + '-' + n; n += 1; }
    return candidate;
  }
  var renameMap = {};
  var newChildren = {};
  movedList.forEach(function (oldId) {
    var newId = uniqueChildKey(oldId);
    renameMap[oldId] = newId;
    newChildren[newId] = Object.assign({}, sourceChildren[oldId]);
  });

  // 物理 relocate：源目录 → 目标目录（使用新 basename）。
  // 若某被移动节点是另一被移动节点的后代，其目录已随祖先一起搬走（srcNodeDir 不存在），
  // 此时跳过 rename 但仍计入 movedBasenames（它已作为子树的一部分迁移）。
  var movedBasenames = [];
  movedList.forEach(function (oldId) {
    var newId = renameMap[oldId];
    var srcNodeDir = nodePath.join(sourceDir, oldId);
    var dstNodeDir = nodePath.join(targetDir, newId);
    if (nodeFs.existsSync(srcNodeDir)) {
      _fs_ensureDir(targetDir);
      nodeFs.renameSync(srcNodeDir, dstNodeDir);
    }
    movedBasenames.push(newId);
  });
  if (movedBasenames.length === 0) throw new Error('没有可移动的节点目录');

  function uniqueEdgeId(existing, preferred) {
    if (!existing.some(function (e) { return e && e.id === preferred; })) return preferred;
    var i = 1;
    while (existing.some(function (e) { return e && e.id === preferred + '-' + i; })) i += 1;
    return preferred + '-' + i;
  }

  function applyRename(ref) {
    var key = norm(ref);
    return renameMap[key] || key;
  }

  var keptEdges = [];
  var droppedEdges = 0;
  var newSourceEdges = [];
  sourceEdges.forEach(function (edge) {
    var s = norm(edge.source);
    var t = norm(edge.target);
    var sIn = !!movedSet[s];
    var tIn = !!movedSet[t];
    if (sIn && tIn) {
      var ne = Object.assign({}, edge);
      ne.source = applyRename(s);
      ne.target = applyRename(t);
      ne.id = uniqueEdgeId(targetEdges.concat(keptEdges), edge.id);
      keptEdges.push(ne);
    } else if (sIn || tIn) {
      droppedEdges += 1; // 跨边界 → 丢弃
    } else {
      newSourceEdges.push(edge); // 与移动无关 → 留源
    }
  });

  var newSourceChildren = {};
  Object.keys(sourceChildren).forEach(function (k) { if (!movedSet[k]) newSourceChildren[k] = sourceChildren[k]; });
  var newTargetChildren = Object.assign({}, targetChildren, newChildren);
  var newTargetEdges = targetEdges.concat(keptEdges);

  var newSourceMeta = Object.assign({}, sourceMeta, { children: newSourceChildren, edges: newSourceEdges });
  var newTargetMeta = Object.assign({}, targetMetaRaw, { children: newTargetChildren, edges: newTargetEdges });

  // 先写目标，再写源；任一步失败尽量回滚（恢复旧 meta + 搬回目录）
  try {
    _fs_writeJsonFile(graphFileOf(targetDir), newTargetMeta);
    _fs_writeJsonFile(graphFileOf(sourceDir), newSourceMeta);
  } catch (e) {
    try { _fs_writeJsonFile(graphFileOf(targetDir), targetMetaRaw); } catch (_) {}
    try { _fs_writeJsonFile(graphFileOf(sourceDir), sourceMeta); } catch (_) {}
    movedBasenames.forEach(function (newId) {
      var oldId = null;
      Object.keys(renameMap).forEach(function (k) { if (renameMap[k] === newId) oldId = k; });
      try { nodeFs.renameSync(nodePath.join(targetDir, newId), nodePath.join(sourceDir, oldId)); } catch (_) {}
    });
    throw e;
  }

  return {
    moved: movedBasenames,
    keptEdges: keptEdges.length,
    droppedEdges: droppedEdges,
    targetRoomPath: targetRoomPath,
    sourceRoomPath: sourceRoomPath,
    renamed: renameMap,
  };
}

const trashService = createTrashService({
  clearTrashItems: _fs_clearTrashItems,
  deleteTrashItem: _fs_deleteTrashItem,
  listTrashItems: _fs_listTrashItems,
  moveToTrash: _fs_moveToTrash,
  restoreTrashItem: _fs_restoreTrashItem,
});

const kbService = createKbService({
  clearTrashItems: trashService.clearTrashItems,
  ensureDir: _fs_ensureDir,
  kbsDir: _fs_kbsDir,
  kbsTrashItemKind: _fs_kbsTrashItemKind,
  listTrashItems: trashService.listTrashItems,
  moveToTrash: trashService.moveToTrash,
  relativeToKbs: _fs_relativeToKbs,
  requireSafeDirName: _fs_requireSafeDirName,
  requireValidWorkDir: _fs_requireValidWorkDir,
  resolveKbsPath: _fs_resolveKbsPath,
  restoreTrashItem: trashService.restoreTrashItem,
  safeSegment: _fs_safeSegment,
  uniqueFolderName: _fs_uniqueFolderName,
  validateAbsolutePath: _fs_validateAbsolutePath,
});

const cardService = createCardService({
  ensureDir: _fs_ensureDir,
  graphFilePath: _fs_graphFilePath,
  readJsonFile: _fs_readJsonFile,
  relativeToKbs: _fs_relativeToKbs,
  requireValidWorkDir: _fs_requireValidWorkDir,
  resolveKbsPath: _fs_resolveKbsPath,
  safeSegment: _fs_safeSegment,
  writeJsonFile: _fs_writeJsonFile,
});

const graphMetaService = createGraphMetaService({
  ensureDir: _fs_ensureDir,
  graphFilePath: _fs_graphFilePath,
  readJsonFile: _fs_readJsonFile,
  requireValidWorkDir: _fs_requireValidWorkDir,
  resolveKbsPath: _fs_resolveKbsPath,
  writeJsonFile: _fs_writeJsonFile,
});

const attachmentService = createAttachmentService({
  attachmentDir: _fs_attachmentDir,
  attachmentDownloadTimeoutMs: ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
  attachmentRefToPath: _fs_attachmentRefToPath,
  deleteTrashItem: trashService.deleteTrashItem,
  ensureDir: _fs_ensureDir,
  extFromMime: _fs_extFromMime,
  listTrashItems: trashService.listTrashItems,
  moveToTrash: trashService.moveToTrash,
  readJsonFile: _fs_readJsonFile,
  requireAttachmentSize: _fs_requireAttachmentSize,
  requirePublicHttpUrl: _fs_requirePublicHttpUrl,
  requireSafeOpenAttachment: _fs_requireSafeOpenAttachment,
  requireValidWorkDir: _fs_requireValidWorkDir,
  resolveKbsPath: _fs_resolveKbsPath,
  safeFileName: _fs_safeFileName,
  shell,
  trashPathWithinDir: isPathWithinDirCompat,
  uniqueFilePath: _fs_uniqueFilePath,
  validateAbsolutePath: _fs_validateAbsolutePath,
  writeAttachmentBuffer: _fs_writeAttachmentBuffer,
});

const documentService = createDocumentService({
  clearTrashTopoDocuments: function(rootDir, cardPath) {
    rootDir = _fs_requireValidWorkDir(rootDir);
    trashService.listTrashItems(rootDir, 'topo-documents')
      .filter(function(item) {
        return item.meta && item.meta.cardPath === String(cardPath || '');
      })
      .forEach(function(item) {
        trashService.deleteTrashItem(rootDir, 'topo-documents', item.trashName);
      });
  },
  createTopoDocument: _fs_createTopoDocument,
  deleteTopoDocument: _fs_deleteTopoDocument,
  exportTopoDocument: _fs_exportTopoDocument,
  listTopoDocuments: _fs_listTopoDocuments,
  listTrashTopoDocuments: _fs_listTrashTopoDocuments,
  moveTopoDocument: _fs_moveTopoDocument,
  moveTopoDocumentToCard: _fs_moveTopoDocumentToCard,
  openTopoDocumentFolder: _fs_openTopoDocumentFolder,
  readTopoDocument: _fs_readTopoDocument,
  renameTopoDocument: _fs_renameTopoDocument,
  updateTopoDocumentMeta: _fs_updateTopoDocumentMeta,
  repairTopoDocuments: _fs_repairTopoDocuments,
  restoreTrashTopoDocument: _fs_restoreTrashTopoDocument,
  writeTopoDocument: _fs_writeTopoDocument,
});

const fileService = {
  readLearningStatsData: function(rootDir, dateStr) {
    rootDir = _fs_requireValidWorkDir(rootDir);
    var d = nodePath.join(rootDir, 'learning_stats');
    _fs_ensureDir(d);
    if (!dateStr) {
      return _fs_readJsonFile(nodePath.join(d, 'meta.json'));
    } else {
      var safeDate = String(dateStr).replace(/[^0-9-]/g, '').slice(0, 10);
      return _fs_readJsonFile(nodePath.join(d, safeDate + '.json'));
    }
  },

  readAllLearningStatsData: function(rootDir) {
    rootDir = _fs_requireValidWorkDir(rootDir);
    var d = nodePath.join(rootDir, 'learning_stats');
    if (!nodeFs.existsSync(d)) return {};

    var result = {};
    nodeFs.readdirSync(d, { withFileTypes: true }).forEach(function(entry) {
      if (!entry.isFile()) return;
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) return;

      var dateStr = entry.name.slice(0, 10);
      try {
        var data = _fs_readJsonFile(nodePath.join(d, entry.name));
        if (data && typeof data === 'object') {
          result[dateStr] = data;
        }
      } catch (e) {}
    });

    return result;
  },

  readLearningStatsSummary: function(rootDir, days) {
    rootDir = _fs_requireValidWorkDir(rootDir);
    var d = nodePath.join(rootDir, 'learning_stats');
    if (!nodeFs.existsSync(d)) return {};
    
    var result = {};
    var today = new Date();
    for (var i = 0; i < days; i++) {
      var date = new Date(today);
      date.setDate(today.getDate() - i);
      var year = date.getFullYear();
      var month = String(date.getMonth() + 1).padStart(2, '0');
      var day = String(date.getDate()).padStart(2, '0');
      var dateStr = year + '-' + month + '-' + day;
      
      var filePath = nodePath.join(d, dateStr + '.json');
      try {
        if (nodeFs.existsSync(filePath)) {
          var data = _fs_readJsonFile(filePath);
          if (data && typeof data.totalDuration === 'number') {
            result[dateStr] = data.totalDuration;
          }
        }
      } catch(e) {}
    }
    return result;
  },
  writeLearningStatsData: function(rootDir, dateStr, content) {
    rootDir = _fs_requireValidWorkDir(rootDir);
    var d = nodePath.join(rootDir, 'learning_stats');
    _fs_ensureDir(d);
    var safeContent = typeof content === 'string' ? JSON.parse(content) : content;
    if (!dateStr) {
      _fs_writeJsonFile(nodePath.join(d, 'meta.json'), safeContent);
    } else {
      var safeDate = String(dateStr).replace(/[^0-9-]/g, '').slice(0, 10);
      _fs_writeJsonFile(nodePath.join(d, safeDate + '.json'), safeContent);
    }
  },

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
      var data = _fs_requirePlainObject(content, '配置内容');
      var serialized = JSON.stringify(data);
      if (Buffer.byteLength(serialized, 'utf-8') > MAX_APP_CONFIG_BYTES) {
        throw new Error('配置内容过大，拒绝写入');
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
      return workspaceCreateWorkDir(dirPath);
    },

    /**
     * @description 校验工作目录：检查目录是否存在且为有效工作目录
     * @param { string } dirPath: 工作目录路径
     * @returns { { valid: boolean, nodePath: string | null, error?: string } } 校验结果
     */
    isValidWorkDir: function(dirPath) {
      return workspaceIsValidWorkDir(dirPath);
    },

    /**
     * @description 列出工作目录下的所有顶层知识库列表
     * @param { string } rootDir: 工作目录路径
     * @returns { Array<{ name: string }> } 知识库列表
     */
    listKBs: function(rootDir) {
      return kbService.listKBs(rootDir);
    },

    listTrashKBs: function(rootDir) {
      return kbService.listTrashKBs(rootDir);
    },

    restoreTrashKB: function(rootDir, trashName) {
      return kbService.restoreTrashKB(rootDir, trashName);
    },

    clearTrashKBs: function(rootDir) {
      return kbService.clearTrashKBs(rootDir);
    },

    /**
     * @description 读取指定父卡片的 _graph.json.children 原始内容
     * @param { string } rootDir: 工作目录路径
     * @param { string } cardPath: 卡片相对于 kbs/ 的路径
     * @returns { Object } _graph.json.children 原始映射表
     */
    readCardChildren: function(rootDir, cardPath) {
      return cardService.readCardChildren(rootDir, cardPath);
    },

    /** 不能再改这部分代码了  --to ai
     * @description 在 kbs/ 根目录下创建知识库目录，并初始化默认文件
     * @param { string } rootDir: 工作目录路径
     * @param { string } kbName: 知识库目录名，只允许单个安全目录名
     * @returns { void }
     */
    createKbsDir: function(rootDir, kbName) {
      return kbService.createKbsDir(rootDir, kbName);
    },

    /**
     * @description 在指定父目录下创建卡片目录，并初始化默认文件
     * @param { string } rootDir: 工作目录路径
     * @param { string } parentPath: 父目录相对于 kbs/ 的路径
     * @param { string } cardName: 卡片目录名
     * @returns { string } 创建后的目录相对路径
     */
    createCardDir: function(rootDir, parentPath, cardName) {
      return cardService.createCardDir(rootDir, parentPath, cardName);
    },

    /**
     * @description 删除 kbs/ 下的目录及其所有内容
     * @param { string } rootDir: 工作目录路径
     * @param { string } dirPath: 相对于 kbs/ 的目录路径
     * @returns { void }
     */
    deleteKbsDir: function(rootDir, dirPath, options) {
      kbService.deleteKbsDir(rootDir, dirPath, options);
    },

    /**
     * @description 重命名知识库目录，并返回新的相对路径
     * @param { string } rootDir: 工作目录路径
     * @param { string } kbPath: 知识库相对路径
     * @param { string } newName: 新名称
     * @returns { string | null } 重命名后的路径，知识库不存在时返回 null
     */
    renameKB: function(rootDir, kbPath, newName) {
      return kbService.renameKB(rootDir, kbPath, newName);
    },

    /**
     * @description 读取房间的图元数据，不存在时返回空对象
     * @param { string } rootDir: 工作目录路径
     * @param { string } roomPath: 房间相对路径
     * @returns { Object } 图元数据对象
     */
    readGraphMeta: function(rootDir, roomPath) {
      return graphMetaService.readGraphMeta(rootDir, roomPath);
    },

    readRoomNodeSummaries: function(rootDir, roomPaths) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      if (!Array.isArray(roomPaths)) throw new Error('房间路径列表必须是数组');
      if (roomPaths.length > 20000) throw new Error('单次读取的房间数量过多');

      var summaries = {};
      Array.from(new Set(roomPaths.map(function(roomPath) { return String(roomPath || ''); })))
        .forEach(function(roomPath) {
          try {
            var meta = graphMetaService.readGraphMeta(rootDir, roomPath);
            var children = meta && meta.children && typeof meta.children === 'object' && !Array.isArray(meta.children)
              ? meta.children
              : {};
            var pan = meta && meta.pan;
            var documents = documentService.listTopoDocuments(rootDir, roomPath);
            summaries[roomPath] = {
              position: pan && Number.isFinite(pan.x) && Number.isFinite(pan.y)
                ? { x: pan.x, y: pan.y }
                : undefined,
              childCount: Object.keys(children).length,
              hasDetail: documents.length > 0,
            };
          } catch (_) {
            summaries[roomPath] = { childCount: 0, hasDetail: false };
          }
        });
      return summaries;
    },

    /**
     * @description 写入房间的图元数据，不存在时先创建目录结构
     * @param { string } rootDir: 工作目录路径
     * @param { string } roomPath: 房间相对路径
     * @param { Object } meta: 图元数据
     * @returns { void }
     */
    writeGraphMeta: function(rootDir, roomPath, meta) {
      return graphMetaService.writeGraphMeta(rootDir, roomPath, meta);
    },

    /**
     * @description 读取文本文件内容，不存在时返回空字符串
     * @param { string } rootDir: 工作目录路径
     * @param { string } filePath: 文件相对路径
     * @returns { string } 文件内容
     */
    readFile: function(rootDir, filePath) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var f = _fs_requireSafeKbsTextFile(rootDir, filePath);
      if (nodeFs.existsSync(f)) {
        var stat = nodeFs.statSync(f);
        if (!stat.isFile()) throw new Error('读取目标不是文件');
        if (stat.size > MAX_TEXT_FILE_BYTES) throw new Error('文件过大，拒绝读取');
        return nodeFs.readFileSync(f, 'utf-8');
      }
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
      if (typeof content !== 'string') throw new Error('文件内容必须是字符串');
      if (Buffer.byteLength(content, 'utf-8') > MAX_TEXT_FILE_BYTES) throw new Error('文件过大，拒绝写入');
      var f = _fs_requireSafeKbsTextFile(rootDir, filePath);
      _fs_ensureDir(nodePath.dirname(f));
      nodeFs.writeFileSync(f, content, 'utf-8');
    },

    listTopoDocuments: function(rootDir, cardPath) {
      return documentService.listTopoDocuments(rootDir, cardPath);
    },

    createTopoDocument: function(rootDir, cardPath, input) {
      return documentService.createTopoDocument(rootDir, cardPath, input);
    },

    readTopoDocument: function(rootDir, cardPath, documentId) {
      return documentService.readTopoDocument(rootDir, cardPath, documentId);
    },

    writeTopoDocument: function(rootDir, cardPath, documentId, content) {
      return documentService.writeTopoDocument(rootDir, cardPath, documentId, content);
    },

    renameTopoDocument: function(rootDir, cardPath, documentId, title) {
      return documentService.renameTopoDocument(rootDir, cardPath, documentId, title);
    },

    updateTopoDocumentMeta: function(rootDir, cardPath, documentId, patch) {
      return documentService.updateTopoDocumentMeta(rootDir, cardPath, documentId, patch);
    },

    deleteTopoDocument: function(rootDir, cardPath, documentId) {
      return documentService.deleteTopoDocument(rootDir, cardPath, documentId);
    },

    listTrashTopoDocuments: function(rootDir, cardPath) {
      return documentService.listTrashTopoDocuments(rootDir, cardPath);
    },

    restoreTrashTopoDocument: function(rootDir, cardPath, trashName) {
      return documentService.restoreTrashTopoDocument(rootDir, cardPath, trashName);
    },

    clearTrashTopoDocuments: function(rootDir, cardPath) {
      return documentService.clearTrashTopoDocuments(rootDir, cardPath);
    },

    moveTopoDocument: function(rootDir, cardPath, documentId, newParentId, newSortOrder) {
      return documentService.moveTopoDocument(rootDir, cardPath, documentId, newParentId, newSortOrder);
    },

    moveTopoDocumentToCard: function(rootDir, sourceCardPath, documentId, targetCardPath) {
      return documentService.moveTopoDocumentToCard(rootDir, sourceCardPath, documentId, targetCardPath);
    },

    moveTopoNodesToRoom: function(rootDir, sourceRoomPath, nodeIds, targetRoomPath) {
      return _fs_moveTopoNodesToRoom(rootDir, sourceRoomPath, nodeIds, targetRoomPath);
    },

    repairTopoDocuments: function(rootDir, cardPath) {
      return documentService.repairTopoDocuments(rootDir, cardPath);
    },

    exportTopoDocument: function(rootDir, cardPath, documentId) {
      return documentService.exportTopoDocument(rootDir, cardPath, documentId);
    },

    openTopoDocumentFolder: async function(rootDir, cardPath, documentId) {
      return documentService.openTopoDocumentFolder(rootDir, cardPath, documentId);
    },

    listAttachments: function(rootDir, cardPath) {
      return attachmentService.listAttachments(rootDir, cardPath);
    },

    importAttachment: function(rootDir, cardPath, sourceFilePath, targetFileName) {
      return attachmentService.importAttachment(rootDir, cardPath, sourceFilePath, targetFileName);
    },

    deleteAttachment: function(rootDir, cardPath, attachmentName) {
      return attachmentService.deleteAttachment(rootDir, cardPath, attachmentName);
    },

    listTrashAttachments: function(rootDir, cardPath) {
      return attachmentService.listTrashAttachments(rootDir, cardPath);
    },

    restoreTrashAttachment: function(rootDir, cardPath, trashName) {
      return attachmentService.restoreTrashAttachment(rootDir, cardPath, trashName);
    },

    clearTrashAttachments: function(rootDir, cardPath) {
      return attachmentService.clearTrashAttachments(rootDir, cardPath);
    },

    showAttachmentInFolder: async function(rootDir, cardPath, attachmentRef) {
      return attachmentService.showAttachmentInFolder(rootDir, cardPath, attachmentRef);
    },

    openAttachment: async function(rootDir, cardPath, attachmentRef) {
      return attachmentService.openAttachment(rootDir, cardPath, attachmentRef);
    },

    writeAttachmentBase64: function(rootDir, cardPath, fileName, mimeType, base64) {
      return attachmentService.writeAttachmentBase64(rootDir, cardPath, fileName, mimeType, base64);
    },

    downloadAttachment: async function(rootDir, cardPath, url, targetFileName) {
      return attachmentService.downloadAttachment(rootDir, cardPath, url, targetFileName);
    },

    readAttachmentDataUrl: function(rootDir, cardPath, attachmentRef) {
      return attachmentService.readAttachmentDataUrl(rootDir, cardPath, attachmentRef);
    },

    listAllTrashItems: function(rootDir) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      var kbs = trashService.listTrashItems(rootDir, 'kbs').map(item => {
        var isCard = item.meta && item.meta.kind === 'card';
        var businessName = item.originalName;
        if (isCard && item.meta.label) {
          businessName = item.meta.label;
        }
        return { ...item, category: 'kbs', businessName: businessName };
      });
      var docs = trashService.listTrashItems(rootDir, 'topo-documents').map(item => {
        var topoItem = item.meta && item.meta.topoDocumentItem;
        var businessName = topoItem && topoItem.title ? String(topoItem.title) : item.originalName;
        return { ...item, category: 'topo-documents', businessName: businessName };
      });
      var attachments = trashService.listTrashItems(rootDir, 'attachments').map(item => {
        var ext = nodePath.extname(item.originalName).slice(1).toLowerCase();
        var isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
        var previewUrl = null;
        if (isImage) {
          previewUrl = 'local-file://' + nodePath.join(rootDir, '.trash', 'attachments', item.trashName).replace(/\\/g, '/');
        }
        return { ...item, category: 'attachments', businessName: item.originalName, isImage: isImage, previewUrl: previewUrl };
      });
      return kbs.concat(docs, attachments).sort((a, b) => b.deletedAt - a.deletedAt);
    },

    restoreGlobalTrashItem: function(rootDir, category, trashName) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      
      const handlers = {
        'kbs': () => kbService.restoreTrashKB(rootDir, trashName),
        'topo-documents': () => {
          var item = trashService.listTrashItems(rootDir, 'topo-documents').find(i => i.trashName === trashName);
          if (!item) throw new Error('回收站文档不存在');
          return documentService.restoreTrashTopoDocument(rootDir, item.meta?.cardPath || '', trashName);
        },
        'attachments': () => {
          var item = trashService.listTrashItems(rootDir, 'attachments').find(i => i.trashName === trashName);
          if (!item) throw new Error('回收站附件不存在');
          return attachmentService.restoreTrashAttachment(rootDir, item.meta?.cardPath || '', trashName);
        }
      };

      const handler = handlers[category];
      if (!handler) throw new Error('未知的回收站分类: ' + category);
      return handler();
    },

    clearAllTrashItems: function(rootDir) {
      rootDir = _fs_requireValidWorkDir(rootDir);
      trashService.clearTrashItems(rootDir, 'kbs');
      trashService.clearTrashItems(rootDir, 'topo-documents');
      trashService.clearTrashItems(rootDir, 'attachments');
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
      return kbService.importKB(rootDir, sourcePath);
    },
  };

export { fileService };
export default fileService;
