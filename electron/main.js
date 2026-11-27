/**
 * Electron 主进程入口
 *
 * 职责：
 * 1. 注册所有 IPC 通道（文件系统、日志、应用）
 * 2. 管理窗口生命周期（主窗口、日志监控窗口）
 * 3. 构建应用菜单
 *
 * 所有业务逻辑委托给独立模块：
 *   - file-service.js   — 文件系统操作
 *   - log-service.js     — 日志服务
 */
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen, protocol, net, crashReporter } from 'electron';
import nodePath from 'path';
import nodeFs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { fileService, _fs_attachmentRefToPath, _fs_requireValidWorkDir } from './file-service.js';
import { dialogService } from './dialog-service.js';
import LogService from './log-service.js';
import { mainLog, mainLifecycle } from './main-log.js';
import { createAiKeyStore } from './services/ai-key-store.js';
import { createAiService } from './services/ai-service.js';
import { createAiAgentStore } from './services/ai-agent-store.js';
import { createAiSessionStore } from './services/ai-session-store.js';
import { createAiIndexService } from './services/ai-index-service.js';

// 兼容生产运行以及 dev 模式。
const APP_PATH = app.getAppPath();
const CURRENT_SCRIPT_DIR = nodePath.dirname(fileURLToPath(import.meta.url));
const DIST_ELECTRON_DIR = [
  nodePath.join(APP_PATH, 'dist-electron'),
  CURRENT_SCRIPT_DIR,
  nodePath.join(CURRENT_SCRIPT_DIR, '..', 'dist-electron'),
].find((dir) => nodeFs.existsSync(nodePath.join(dir, 'preload.js')))
  || nodePath.join(APP_PATH, 'dist-electron');
const DIST_RENDERER_DIR = [
  nodePath.join(APP_PATH, 'dist'),
  nodePath.join(process.cwd(), 'dist'),
  nodePath.join(nodePath.dirname(DIST_ELECTRON_DIR), 'dist'),
  nodePath.join(CURRENT_SCRIPT_DIR, '..', 'dist'),
].find((dir) => nodeFs.existsSync(nodePath.join(dir, 'index.html')))
  || nodePath.join(APP_PATH, 'dist');
const SETUP_WINDOW_WIDTH = 680;
const SETUP_WINDOW_HEIGHT = 420;
const WORKSPACE_MIN_WIDTH = 900;
const WORKSPACE_MIN_HEIGHT = 600;
const HOME_WINDOW_WIDTH = 1400;
const HOME_WINDOW_HEIGHT = 900;
const WINDOW_BACKGROUND_COLOR = '#ffffff';
const IS_DEV = !!process.env.VITE_DEV_SERVER_URL;
const CLOSE_GUARD_REQUEST_TIMEOUT_MS = 5000;
let closeGuardRequestSeq = 0;
const pendingCloseGuardRequests = new Map();

// ----- 日志服务：app 启动即初始化（D1 兜底目录，进入工作目录后切换） -----
// TOPOMIND_LOG_FALLBACK=0 可一键回到「只在 enterWorkDir 初始化」的旧行为。
if (process.env.TOPOMIND_LOG_FALLBACK !== '0') {
  try {
    var fallbackLogDir = nodePath.join(app.getPath('userData'), 'logs');
    var crashDumpDir = nodePath.join(fallbackLogDir, 'crashes');
    var appVersion = null;
    try { appVersion = app.getVersion(); } catch { /* 版本不可读不影响日志 */ }
    try {
      // P3：crashReporter 必须在 app ready 之前 start，setPath 要在 start 之前；
      // uploadToServer:false 保证 minidump 只留本地，绝不远程上报（v3 §1 非目标）。
      nodeFs.mkdirSync(crashDumpDir, { recursive: true });
      app.setPath('crashDumps', crashDumpDir);
      crashReporter.start({
        productName: 'TopoMind',
        companyName: 'TopoMind',
        uploadToServer: false,
        compress: true,
      });
    } catch { /* minidump 不可用时 dumpRef 降级为 available:false，不阻断启动 */ }
    LogService.init({
      logDir: fallbackLogDir,
      level: IS_DEV ? 'DEBUG' : 'INFO',
      crashDumpDir: crashDumpDir,
      appVersion: appVersion,
    });
  } catch {
    // app.getPath 在极早期失败时退回进程工作目录，不让日志拖垮启动。
    LogService.init({ logDir: nodePath.join(process.cwd(), 'logs'), level: IS_DEV ? 'DEBUG' : 'INFO' });
  }
}

// ----- 主进程全局异常接管：记录后仍按原有退出策略处理，避免静默吞掉 ----- 
process.on('uncaughtException', (error) => {
  // P3：error 类已走同步落盘，这条崩溃日志在 throw 之前必定可读。
  try { mainLog.error('app', '主进程未捕获异常', {}, error, 'app.crash'); } catch { /* 日志不可用时仍要崩溃 */ }
  // 标记异常退出；下次启动据此生成 app.crash_recovered 恢复报告。
  try { LogService.markSessionCrashed(error?.message ?? 'uncaughtException'); } catch { /* 状态写入失败不阻断崩溃路径 */ }
  throw error;
});
process.on('unhandledRejection', (reason) => {
  mainLog.error('app', '主进程未处理的 Promise 拒绝', {}, reason, 'app.error');
});

function buildLocalFileUrl(absPath) {
  return pathToFileURL(absPath).href.replace(/^file:\/\//i, 'local-file://');
}

function sanitizeOpenFileDialogOptions(options) {
  var input = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  var allowedProperties = new Set(['openFile', 'multiSelections']);
  var properties = Array.isArray(input.properties)
    ? input.properties.filter(function(item) { return allowedProperties.has(item); })
    : ['openFile'];
  if (properties.length === 0) properties = ['openFile'];
  var filters = Array.isArray(input.filters) ? input.filters.slice(0, 12).map(function(filter) {
    var safeFilter = filter && typeof filter === 'object' && !Array.isArray(filter) ? filter : {};
    var extensions = Array.isArray(safeFilter.extensions)
      ? safeFilter.extensions.map(function(ext) { return String(ext || '').replace(/[^a-z0-9*]/gi, '').slice(0, 16); }).filter(Boolean).slice(0, 20)
      : ['*'];
    if (extensions.length === 0) extensions = ['*'];
    return {
      name: typeof safeFilter.name === 'string' ? safeFilter.name.slice(0, 40) : 'Files',
      extensions,
    };
  }) : undefined;
  return {
    title: typeof input.title === 'string' ? input.title.slice(0, 80) : undefined,
    properties,
    filters,
  };
}

function sanitizeExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  var target = rawUrl.trim();
  // eslint-disable-next-line no-control-regex -- 安全校验：有意拒绝含控制字符的外部 URL
  if (!target || target.length > 2048 || /[\x00-\x1F\x7F]/.test(target)) return null;
  try {
    var parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function openExternalSafely(target) {
  try {
    await shell.openExternal(target);
    return true;
  } catch (e) {
    console.error('[openExternal]', e && e.message ? e.message : e);
    return false;
  }
}

function parseLocalFileUrl(urlString) {
  const url = new URL(urlString);
  let pathname = url.pathname || '';
  // Fully decode to handle any potential double-encoding by the browser
  while (pathname.includes('%')) {
    try {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    } catch {
      break;
    }
  }
  let host = url.host || '';
  while (host.includes('%')) {
    try {
      const decoded = decodeURIComponent(host);
      if (decoded === host) break;
      host = decoded;
    } catch {
      break;
    }
  }
  if (/^[A-Za-z]$/.test(host) && pathname.startsWith('/')) {
    return nodePath.normalize(host + ':' + pathname);
  }
  return nodePath.normalize(pathname.replace(/^\/([A-Za-z]:)/, '$1'));
}

function isPathWithinDir(parentDir, targetPath) {
  const relativePath = nodePath.relative(nodePath.resolve(parentDir), nodePath.resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..' + nodePath.sep) && relativePath !== '..' && !nodePath.isAbsolute(relativePath));
}

function normalizedPathForCompare(absPath) {
  var resolved = nodePath.resolve(absPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function requireActiveWorkDir(rootDir) {
  var requested = _fs_requireValidWorkDir(rootDir);
  var active = LogService.getCurrentWorkDir();
  if (!active) throw new Error('尚未进入工作目录');
  var activeRoot = _fs_requireValidWorkDir(active);
  if (normalizedPathForCompare(requested) !== normalizedPathForCompare(activeRoot)) {
    throw new Error('工作目录与当前会话不一致');
  }
  return activeRoot;
}

/**
 * AI 配置与密钥都按「当前会话的工作目录」隔离。渲染层不传目录参数，
 * 因此不存在跨工作区读写或会话切换后残留配置的窗口。
 */
function currentAiWorkDir() {
  var active = LogService.getCurrentWorkDir();
  if (!active) throw new Error('尚未进入工作目录');
  return _fs_requireValidWorkDir(active);
}

function isAllowedLocalFilePath(workDir, targetPath) {
  const resolvedWorkDir = nodePath.resolve(workDir);
  const resolvedTargetPath = nodePath.resolve(targetPath);
  if (!isPathWithinDir(resolvedWorkDir, resolvedTargetPath)) return false;
  const realWorkDir = nodeFs.realpathSync(resolvedWorkDir);
  if (!nodeFs.existsSync(resolvedTargetPath)) return false;
  const targetStat = nodeFs.lstatSync(resolvedTargetPath);
  if (targetStat.isSymbolicLink() || !targetStat.isFile()) return false;
  const realTargetPath = nodeFs.realpathSync(resolvedTargetPath);
  if (!isPathWithinDir(realWorkDir, realTargetPath)) return false;
  const relativePath = nodePath.relative(realWorkDir, realTargetPath);
  const parts = relativePath.split(nodePath.sep).filter(Boolean);
  const attachIndex = parts.indexOf('_attach');
  if (attachIndex >= 0 && attachIndex < parts.length - 1) return true;
  // 容器媒体资源（CardSpec 组件、图片容器）：<card>/_docs/assets/<file>。
  // 只放行 _docs 的直接 assets 子目录里的单个文件，绝不通读 tree.json / 文档正文，
  // 也不允许 assets/ 下的子目录，保持 local-file 协议的最小暴露面。
  const docsIndex = parts.indexOf('_docs');
  return docsIndex >= 0
    && parts[docsIndex + 1] === 'assets'
    && docsIndex + 2 === parts.length - 1;
}

function isTrustedAppUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const devOrigin = process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : '';
    if (IS_DEV && devOrigin && parsed.origin === devOrigin) return true;
    return parsed.protocol === 'file:' && isPathWithinDir(DIST_RENDERER_DIR, fileURLToPath(rawUrl));
  } catch {
    return false;
  }
}

function sanitizeCloseGuardDirtyState(result) {
  const dirtyTabIds = Array.isArray(result && result.dirtyTabIds)
    ? result.dirtyTabIds.filter(function(tabId) { return typeof tabId === 'string'; })
    : [];
  return {
    hasDirty: !!(result && result.hasDirty),
    dirtyTabIds,
  };
}

function sanitizeCloseGuardFlushResult(result) {
  return {
    ok: !!(result && result.ok),
    hasDirty: result && typeof result.hasDirty === 'boolean' ? result.hasDirty : true,
    failedTabId: result && typeof result.failedTabId === 'string' ? result.failedTabId : null,
    error: result && typeof result.error === 'string' ? result.error : null,
  };
}

function resolveCloseGuardRequest(requestId, payload) {
  const pending = pendingCloseGuardRequests.get(requestId);
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  pendingCloseGuardRequests.delete(requestId);
  pending.resolve(payload);
}

function requestRendererCloseGuard(type) {
  if (!win || win.isDestroyed()) {
    if (type === 'get-dirty-state') {
      return Promise.resolve({ hasDirty: false, dirtyTabIds: [] });
    }
    return Promise.resolve({ ok: true, hasDirty: false, failedTabId: null, error: null });
  }

  const requestId = 'close-guard-' + (++closeGuardRequestSeq);
  return new Promise(function(resolve) {
    const timer = setTimeout(function() {
      pendingCloseGuardRequests.delete(requestId);
      if (type === 'get-dirty-state') {
        resolve({ hasDirty: true, dirtyTabIds: [] });
        return;
      }
      resolve({ ok: false, hasDirty: true, failedTabId: null, error: 'close-guard-timeout' });
    }, CLOSE_GUARD_REQUEST_TIMEOUT_MS);

    pendingCloseGuardRequests.set(requestId, { resolve, timer, type });
    win.webContents.send('app:close-guard:request', { requestId, type });
  });
}

// ============================================================
// IPC HANDLERS
// ============================================================

/**
 * 注册渲染进程与主进程之间的所有 IPC 通道。
 */
async function readRendererDirtyState() {
  try {
    const result = await requestRendererCloseGuard('get-dirty-state');
    return sanitizeCloseGuardDirtyState(result);
  } catch {
    return { hasDirty: true, dirtyTabIds: [] };
  }
}

async function flushRendererDirtyTabs() {
  try {
    const dirtyState = await readRendererDirtyState();
    if (!dirtyState.hasDirty) {
      return { ok: true, hasDirty: false, failedTabId: null, error: null };
    }
    const result = await requestRendererCloseGuard('flush-dirty-tabs');
    return sanitizeCloseGuardFlushResult({ ...result, hasDirty: true });
  } catch (e) {
    return { ok: false, hasDirty: true, failedTabId: null, error: e && e.message ? e.message : String(e) };
  }
}

async function confirmAndFlushBeforeExit(reason) {
  if (!win || win.isDestroyed()) return { ok: true };

  const dirtyState = await readRendererDirtyState();

  if (!dirtyState?.hasDirty) {
    return { ok: true, hasDirty: false };
  }

  const message = reason === 'switch-workdir'
    ? '当前有未保存修改，确认后会先保存所有改动，再切换工作目录。是否继续？'
    : '当前有未保存修改，确认后会先保存所有改动，再关闭应用。是否继续？';

  const response = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['确认继续', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: reason === 'switch-workdir' ? '切换工作目录' : '关闭应用',
    message,
    detail: '只有所有修改成功写入磁盘后，操作才会继续。',
  });

  if (response.response !== 0) {
    return { ok: false, cancelled: true };
  }

  const flushResult = await flushRendererDirtyTabs();
  if (!flushResult.ok) {
    const errorResponse = await dialog.showMessageBox(win, {
      type: 'error',
      buttons: ['取消', '强制退出(可能丢失修改)'],
      defaultId: 0,
      cancelId: 0,
      title: '保存失败',
      message: `存在修改未能成功写入磁盘。\n\n错误信息: ${flushResult.error || '未知错误'}`,
    });
    if (errorResponse.response === 1) {
      return { ok: true, hasDirty: true };
    }
    return { ok: false, failed: true };
  }

  return { ok: true, hasDirty: true };
}

function registerIPC() {
  ipcMain.on('app:close-guard:response', function(event, payload) {
    if (!win || win.isDestroyed()) return;
    if (event.sender.id !== win.webContents.id) return;
    if (!payload || typeof payload !== 'object') return;
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    if (!requestId) return;
    const pending = pendingCloseGuardRequests.get(requestId);
    if (!pending) return;
    if (pending.type === 'get-dirty-state') {
      resolveCloseGuardRequest(requestId, sanitizeCloseGuardDirtyState(payload.result));
      return;
    }
    resolveCloseGuardRequest(requestId, sanitizeCloseGuardFlushResult(payload.result));
  });

  // ----- File system handlers -----
  ipcMain.handle('fs:listKBs', function(e, rootDir) { return fileService.listKBs(requireActiveWorkDir(rootDir)); });
  ipcMain.handle('fs:listTrashKBs', function(e, rootDir) { return fileService.listTrashKBs(requireActiveWorkDir(rootDir)); });
  ipcMain.handle('fs:restoreTrashKB', function(e, rootDir, trashName) { return fileService.restoreTrashKB(requireActiveWorkDir(rootDir), trashName); });
  ipcMain.handle('fs:clearTrashKBs', function(e, rootDir) { return fileService.clearTrashKBs(requireActiveWorkDir(rootDir)); });
  ipcMain.handle('fs:readCardChildren', function(e, rootDir, p) { return fileService.readCardChildren(requireActiveWorkDir(rootDir), p); });
  ipcMain.handle('fs:createKbsDir', function(e, rootDir, p) { return fileService.createKbsDir(requireActiveWorkDir(rootDir), p); });
  ipcMain.handle('fs:deleteKbsDir', function(e, rootDir, p, options) { fileService.deleteKbsDir(requireActiveWorkDir(rootDir), p, options); });
  ipcMain.handle('fs:renameKB', function(e, rootDir, p, n) { return fileService.renameKB(requireActiveWorkDir(rootDir), p, n); });
  ipcMain.handle('fs:readGraphMeta', function(e, rootDir, p) { return fileService.readGraphMeta(requireActiveWorkDir(rootDir), p); });
  ipcMain.handle('fs:readRoomNodeSummaries', function(e, rootDir, roomPaths) {
    return fileService.readRoomNodeSummaries(requireActiveWorkDir(rootDir), roomPaths);
  });
  ipcMain.handle('fs:writeGraphMeta', function(e, rootDir, p, m) { fileService.writeGraphMeta(requireActiveWorkDir(rootDir), p, m); });
  ipcMain.handle('fs:listTopoDocuments', function(e, rootDir, cardPath) {
    return fileService.listTopoDocuments(requireActiveWorkDir(rootDir), cardPath);
  });
  ipcMain.handle('fs:createTopoDocument', function(e, rootDir, cardPath, input) {
    return fileService.createTopoDocument(requireActiveWorkDir(rootDir), cardPath, input);
  });
  ipcMain.handle('fs:moveTopoDocument', function(e, rootDir, cardPath, documentId, newParentId, newSortOrder) {
    return fileService.moveTopoDocument(requireActiveWorkDir(rootDir), cardPath, documentId, newParentId, newSortOrder);
  });
  ipcMain.handle('fs:moveTopoDocumentToCard', function(e, rootDir, sourceCardPath, documentId, targetCardPath) {
    return fileService.moveTopoDocumentToCard(requireActiveWorkDir(rootDir), sourceCardPath, documentId, targetCardPath);
  });
  ipcMain.handle('fs:moveTopoNodesToRoom', function(e, rootDir, sourceRoomPath, nodeIds, targetRoomPath, options) {
    return fileService.moveTopoNodesToRoom(requireActiveWorkDir(rootDir), sourceRoomPath, nodeIds, targetRoomPath, options);
  });
  ipcMain.handle('fs:listRoomNodeTargets', function(e, rootDir) {
    return fileService.listRoomNodeTargets(requireActiveWorkDir(rootDir));
  });
  ipcMain.handle('fs:readTopoDocument', function(e, rootDir, cardPath, documentId) {
    return fileService.readTopoDocument(requireActiveWorkDir(rootDir), cardPath, documentId);
  });
  ipcMain.handle('fs:writeTopoDocument', function(e, rootDir, cardPath, documentId, content) {
    return fileService.writeTopoDocument(requireActiveWorkDir(rootDir), cardPath, documentId, content);
  });
  ipcMain.handle('fs:renameTopoDocument', function(e, rootDir, cardPath, documentId, title) {
    return fileService.renameTopoDocument(requireActiveWorkDir(rootDir), cardPath, documentId, title);
  });
  ipcMain.handle('fs:updateTopoDocumentMeta', function(e, rootDir, cardPath, documentId, patch) {
    return fileService.updateTopoDocumentMeta(requireActiveWorkDir(rootDir), cardPath, documentId, patch);
  });
  ipcMain.handle('fs:deleteTopoDocument', function(e, rootDir, cardPath, documentId) {
    return fileService.deleteTopoDocument(requireActiveWorkDir(rootDir), cardPath, documentId);
  });
  ipcMain.handle('fs:listTrashTopoDocuments', function(e, rootDir, cardPath) {
    return fileService.listTrashTopoDocuments(requireActiveWorkDir(rootDir), cardPath);
  });
  ipcMain.handle('fs:restoreTrashTopoDocument', function(e, rootDir, cardPath, trashName) {
    return fileService.restoreTrashTopoDocument(requireActiveWorkDir(rootDir), cardPath, trashName);
  });
  // CardSpec 容器媒体资源：路径在主进程校验（拒绝 .. / 绝对路径 / 符号链接逃逸），
  // 渲染层只拿 file:// URL，永不直接接触绝对路径。
  ipcMain.handle('fs:resolveCardAssetUrl', function(e, rootDir, cardPath, relPath) {
    var absolute = fileService.resolveCardAsset(requireActiveWorkDir(rootDir), cardPath, relPath);
    // CSP 的 img-src 只放行 local-file:（vite.config.js DEV/PROD_CSP）。
    // 直接返回 file:// 会被拦成 <img complete=true 但 naturalWidth=0>，
    // 图片容器与 CardSpec 媒体组件共用这条链路，必须走已注册的自定义协议。
    return absolute ? buildLocalFileUrl(absolute) : null;
  });
  ipcMain.handle('fs:importCardAsset', async function(e, rootDir, cardPath) {
    var workDir = requireActiveWorkDir(rootDir);
    var result = await dialog.showOpenDialog({
      title: '选择媒体文件',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
        { name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] },
        { name: '视频', extensions: ['mp4', 'webm', 'mov'] },
      ],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
    var src = fileService.importCardAsset(workDir, cardPath, result.filePaths[0]);
    return { src: src };
  });
  // 图片容器：只弹图片过滤器，主进程 importImageAsset 再校验一次扩展名，
  // 避免把音频/视频复制进节点 _docs/assets/。取消返回 null，容器保留空态。
  ipcMain.handle('fs:importImageAsset', async function(e, rootDir, cardPath) {
    var workDir = requireActiveWorkDir(rootDir);
    var result = await dialog.showOpenDialog({
      title: '选择图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      ],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
    var src = fileService.importImageAsset(workDir, cardPath, result.filePaths[0]);
    return { src: src };
  });
  ipcMain.handle('fs:clearTrashTopoDocuments', function(e, rootDir, cardPath) {
    return fileService.clearTrashTopoDocuments(requireActiveWorkDir(rootDir), cardPath);
  });
  ipcMain.handle('fs:repairTopoDocuments', function(e, rootDir, cardPath) {
    return fileService.repairTopoDocuments(requireActiveWorkDir(rootDir), cardPath);
  });
  ipcMain.handle('fs:exportTopoDocument', function(e, rootDir, cardPath, documentId) {
    return fileService.exportTopoDocument(requireActiveWorkDir(rootDir), cardPath, documentId);
  });
  ipcMain.handle('fs:openTopoDocumentFolder', function(e, rootDir, cardPath, documentId) {
    return fileService.openTopoDocumentFolder(requireActiveWorkDir(rootDir), cardPath, documentId);
  });
  ipcMain.handle('fs:listDocumentCandidates', function(e, rootDir) {
    return fileService.listDocumentCandidates(requireActiveWorkDir(rootDir));
  });
  ipcMain.handle('fs:listUnifiedTreeLevel', function(e, rootDir, parentKey) {
    return fileService.listUnifiedTreeLevel(requireActiveWorkDir(rootDir), parentKey);
  });
  ipcMain.handle('fs:searchUnifiedDocuments', function(e, rootDir, query, options) {
    return fileService.searchUnifiedDocuments(requireActiveWorkDir(rootDir), query, options);
  });
  ipcMain.handle('fs:resolveUnifiedDocumentPath', function(e, rootDir, docId) {
    return fileService.resolveUnifiedDocumentPath(requireActiveWorkDir(rootDir), docId);
  });
  ipcMain.handle('fs:resolveDocumentById', function(e, rootDir, docId, cardRef) {
    return fileService.resolveDocumentById(requireActiveWorkDir(rootDir), docId, cardRef);
  });
  ipcMain.handle('fs:listDocumentBacklinks', function(e, rootDir, docId) {
    return fileService.listDocumentBacklinks(requireActiveWorkDir(rootDir), docId);
  });
  ipcMain.handle('fs:listDocumentRelations', function(e, rootDir, docId, force) {
    return fileService.listDocumentRelations(requireActiveWorkDir(rootDir), docId, force);
  });
  ipcMain.handle('fs:updateNodeLinkedDocuments', function(e, rootDir, nodePath, links) {
    return fileService.updateNodeLinkedDocuments(requireActiveWorkDir(rootDir), nodePath, links);
  });
  ipcMain.handle('fs:listAttachments', function(e, rootDir, cardPath) {
    return fileService.listAttachments(requireActiveWorkDir(rootDir), cardPath);
  });
  ipcMain.handle('fs:importAttachment', function(e, rootDir, cardPath, sourceFilePath, targetFileName) {
    return fileService.importAttachment(requireActiveWorkDir(rootDir), cardPath, sourceFilePath, targetFileName);
  });
  ipcMain.handle('fs:deleteAttachment', function(e, rootDir, cardPath, attachmentName) {
    return fileService.deleteAttachment(requireActiveWorkDir(rootDir), cardPath, attachmentName);
  });
  ipcMain.handle('fs:listTrashAttachments', function(e, rootDir, cardPath) {
    return fileService.listTrashAttachments(requireActiveWorkDir(rootDir), cardPath);
  });
  ipcMain.handle('fs:restoreTrashAttachment', function(e, rootDir, cardPath, trashName) {
    return fileService.restoreTrashAttachment(requireActiveWorkDir(rootDir), cardPath, trashName);
  });
  ipcMain.handle('fs:clearTrashAttachments', function(e, rootDir, cardPath) {
    return fileService.clearTrashAttachments(requireActiveWorkDir(rootDir), cardPath);
  });
  ipcMain.handle('fs:getAttachmentAbsoluteUrl', function(e, rootDir, cardPath, attachmentRef) {
    try {
      const absPath = _fs_attachmentRefToPath(requireActiveWorkDir(rootDir), cardPath, attachmentRef);
      return buildLocalFileUrl(absPath);
    } catch {
      return null;
    }
  });
  ipcMain.handle('fs:showAttachmentInFolder', async function(e, rootDir, cardPath, attachmentRef) {
    return fileService.showAttachmentInFolder(requireActiveWorkDir(rootDir), cardPath, attachmentRef);
  });
  ipcMain.handle('fs:openAttachment', async function(e, rootDir, cardPath, attachmentRef) {
    return fileService.openAttachment(requireActiveWorkDir(rootDir), cardPath, attachmentRef);
  });
  ipcMain.handle('fs:writeAttachmentBase64', function(e, rootDir, cardPath, fileName, mimeType, base64) {
    return fileService.writeAttachmentBase64(requireActiveWorkDir(rootDir), cardPath, fileName, mimeType, base64);
  });
  ipcMain.handle('fs:downloadAttachment', function(e, rootDir, cardPath, url, targetFileName) {
    return fileService.downloadAttachment(requireActiveWorkDir(rootDir), cardPath, url, targetFileName);
  });
  ipcMain.handle('fs:readAttachmentDataUrl', function(e, rootDir, cardPath, attachmentRef) {
    return fileService.readAttachmentDataUrl(requireActiveWorkDir(rootDir), cardPath, attachmentRef);
  });
  ipcMain.handle('fs:readAppConfig', function(e, rootDir) {
    return fileService.readAppConfig(requireActiveWorkDir(rootDir));
  });
  ipcMain.handle('fs:writeAppConfig', function(e, rootDir, content) {
    return fileService.writeAppConfig(requireActiveWorkDir(rootDir), content);
  });
  ipcMain.handle('fs:readLearningStatsData', function(e, rootDir, dateStr) {
    return fileService.readLearningStatsData(requireActiveWorkDir(rootDir), dateStr);
  });
  ipcMain.handle('fs:readAllLearningStatsData', function(e, rootDir) {
    return fileService.readAllLearningStatsData(requireActiveWorkDir(rootDir));
  });
  ipcMain.handle('fs:readLearningStatsSummary', function(e, rootDir, days) {
    return fileService.readLearningStatsSummary(requireActiveWorkDir(rootDir), days);
  });
  ipcMain.handle('fs:writeLearningStatsData', function(e, rootDir, dateStr, content) {
    return fileService.writeLearningStatsData(requireActiveWorkDir(rootDir), dateStr, content);
  });
  ipcMain.handle('fs:isValidWorkDir', function(e, dirPath) {
    var result = fileService.isValidWorkDir(dirPath);
    if (result.valid) {
      mainLog.info('workspace', '工作目录校验成功', { dirPath, valid: true }, 'workspace.select');
    } else {
      mainLog.error('workspace', '工作目录校验失败', { dirPath, valid: false }, result.error, 'workspace.open_failed');
    }
    return result;
  });
  ipcMain.handle('fs:selectDirectory', function() {
    var result = dialogService.selectDirectory();
    mainLog.info('workspace', '文件对话框已关闭', {
      valid: result.valid, path: result.nodePath || null, error: result.error || null,
    }, 'workspace.select');
    return result;
  });
  ipcMain.handle('fs:createWorkDir', function(e, dirPath) {
    var result = fileService.createWorkDir(dirPath);
    if (result.valid) {
      mainLog.info('workspace', '工作目录创建成功', { dirPath, valid: true });
    } else {
      mainLog.error('workspace', '工作目录创建失败', { dirPath, valid: false }, result.error, 'workspace.create_failed');
    }
    return result;
  });
  ipcMain.handle('fs:importKB', function(e, rootDir, sourcePath) {
    var result = fileService.importKB(requireActiveWorkDir(rootDir), sourcePath);
    mainLog.info('kb', '知识库导入成功', { sourcePath, importedPath: result }, 'kb.import');
    return result;
  });

  ipcMain.handle('fs:listAllTrashItems', function(e, rootDir) { return fileService.listAllTrashItems(requireActiveWorkDir(rootDir)); });
  ipcMain.handle('fs:restoreGlobalTrashItem', function(e, rootDir, category, trashName) { return fileService.restoreGlobalTrashItem(requireActiveWorkDir(rootDir), category, trashName); });
  ipcMain.handle('fs:clearAllTrashItems', function(e, rootDir) { return fileService.clearAllTrashItems(requireActiveWorkDir(rootDir)); });

  // ----- App handlers -----
  ipcMain.handle('app:navigateHome', function() {
    if (win && !win.isDestroyed()) {
      applyWorkspaceWindowConstraints();

      // 如果有工作目录，尝试读取其保存的状态
      let state = null;
      try {
        const currentWorkDir = LogService.getCurrentWorkDir();
        if (currentWorkDir) {
          state = fileService.readWindowState(currentWorkDir);
        }
      } catch (err) {
        console.error('[window-state] Failed to read window state in navigateHome:', err);
      }

      if (state && typeof state.width === 'number' && typeof state.height === 'number') {
        const displays = screen.getAllDisplays();
        const isVisible = displays.some(display => {
          const bounds = display.bounds;
          // 修改越界判断：只要窗口有 100x100 的区域在屏幕内就认为可见，不要要求整个窗口都在屏幕内
          return (
            state.x + state.width > bounds.x + 100 &&
            state.x < bounds.x + bounds.width - 100 &&
            state.y + state.height > bounds.y + 100 &&
            state.y < bounds.y + bounds.height - 100
          );
        });

        if (isVisible) {
          win.setBounds({
            x: state.x,
            y: state.y,
            width: state.width,
            height: state.height
          });
        } else {
          win.setContentSize(state.width, state.height);
          win.center();
        }

        if (state.isMaximized) {
          win.maximize();
        }
      } else {
        win.setContentSize(HOME_WINDOW_WIDTH, HOME_WINDOW_HEIGHT);
        win.center();
      }

      buildMenu(false);
    }
  });
  ipcMain.handle('app:enterWorkDir', function(e, workDir) {
    var normalizedWorkDir;
    try {
      normalizedWorkDir = _fs_requireValidWorkDir(workDir);
    } catch (err) {
      mainLog.error('workspace', '进入工作目录失败', { workDir, ok: false }, err, 'workspace.open_failed');
      return { ok: false, error: err && err.message ? err.message : '工作目录无效' };
    }
    var ok = LogService.enterWorkDir(normalizedWorkDir);
    // D5：minidump 尽量跟随当前工作目录。Electron 在 crashReporter.start 之后
    // 切换 crashDumps 不保证对所有后续 dump 生效，故诊断包会汇总两个目录。
    try {
      var workCrashDumps = nodePath.join(normalizedWorkDir, 'logs', 'crashes');
      nodeFs.mkdirSync(workCrashDumps, { recursive: true });
      app.setPath('crashDumps', workCrashDumps);
    } catch { /* 目标不可写时保留启动兜底目录 */ }
    if (win && !win.isDestroyed()) {
      applyWorkspaceWindowConstraints();

      // 尝试读取已保存的窗口状态
      let state = null;
      try {
        state = fileService.readWindowState(normalizedWorkDir);
      } catch (err) {
        console.error('[window-state] Failed to read window state:', err);
      }

      if (state && typeof state.width === 'number' && typeof state.height === 'number') {
        // 验证坐标是否在可见屏幕范围内（防止多屏断开导致窗口丢失）
        const displays = screen.getAllDisplays();
        const isVisible = displays.some(display => {
          const bounds = display.bounds;
          // 修改越界判断：只要窗口有 100x100 的区域在屏幕内就认为可见，不要要求整个窗口都在屏幕内
          return (
            state.x + state.width > bounds.x + 100 &&
            state.x < bounds.x + bounds.width - 100 &&
            state.y + state.height > bounds.y + 100 &&
            state.y < bounds.y + bounds.height - 100
          );
        });

        if (isVisible) {
          win.setBounds({
            x: state.x,
            y: state.y,
            width: state.width,
            height: state.height
          });
        } else {
          // 状态存在但坐标不可见（越界），仅恢复大小并居中
          win.setContentSize(state.width, state.height);
          win.center();
        }

        if (state.isMaximized) {
          win.maximize();
        }
      } else {
        // 首次打开或无状态：设置默认大小并居中
        win.setContentSize(HOME_WINDOW_WIDTH, HOME_WINDOW_HEIGHT);
        win.center();
      }

      buildMenu(false);
    }
    // enterWorkDir 内部已写 workspace.enter，这里不再重复记录。
    return { ok };
  });
  ipcMain.handle('app:switchWorkDir', async function() {
    if (!win || win.isDestroyed()) return { ok: false, cancelled: true };

    const guardResult = await confirmAndFlushBeforeExit('switch-workdir');
    if (!guardResult.ok) {
      return { ok: false, cancelled: !!guardResult.cancelled };
    }

    LogService.leaveWorkDir();
    resetMainWindowToSetup();
    return { ok: true };
  });
  ipcMain.handle('app:openFileDialog', async function(e, options) {
    if (!win || win.isDestroyed()) return undefined;
    const result = await dialog.showOpenDialog(win, sanitizeOpenFileDialogOptions(options));
    return result.canceled ? undefined : result.filePaths;
  });
  ipcMain.handle('app:openExternal', async function(e, url) {
    var target = sanitizeExternalUrl(url);
    if (!target) return false;
    return openExternalSafely(target);
  });
  ipcMain.handle('app:window:getState', function() {
    return getWindowControlsState();
  });
  ipcMain.handle('app:window:minimize', function() {
    if (win && !win.isDestroyed()) win.minimize();
    return getWindowControlsState();
  });
  ipcMain.handle('app:window:toggleMaximize', function() {
    if (win && !win.isDestroyed()) {
      // macOS 在 resizable:false 时 maximize() 会静默失败。工作区本应已由
      // applyWorkspaceWindowConstraints() 打开，这里再兜一次底，避免切换工作目录
      // 等路径残留的尺寸锁让最大化按钮点了没反应。setup 视图不兜底，保持固定窗口。
      if (LogService.getCurrentWorkDir() && !win.isResizable()) {
        win.setResizable(true);
      }
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
    return getWindowControlsState();
  });
  ipcMain.handle('app:window:toggleDevTools', function() {
    if (win && !win.isDestroyed()) {
      win.webContents.toggleDevTools();
    }
  });
  ipcMain.handle('app:window:close', async function() {
    await requestSafeQuit('quit-app');
    return getWindowControlsState();
  });

  // ----- Log handlers -----（参数与日期校验统一在 log-service.js 内）
  ipcMain.handle('log:write', function(e, entry) { return LogService.write(entry); });
  ipcMain.handle('log:getBuffer', function() { return LogService.getBuffer(); });
  ipcMain.handle('log:query', function(e, opts) { return LogService.query(opts || {}); });
  ipcMain.handle('log:setLevel', function(e, level) { return LogService.setLevel(level); });
  ipcMain.handle('log:getLevel', function() { return LogService.getLevel(); });
  ipcMain.handle('log:clearBuffer', function() { return LogService.clearBuffer(); });
  ipcMain.handle('log:getAvailableDates', function() { return LogService.getAvailableDates(); });
  ipcMain.handle('log:getLogDir', function() { return LogService.getLogDir(); });
  ipcMain.handle('log:export', function(e, date) { return LogService.exportJsonl(date); });
  // P3：一键诊断包（主进程已完成二次脱敏与双目录汇总，返回 JSON 字符串）。
  ipcMain.handle('log:exportBundle', function() { return LogService.exportDiagnosticBundle(); });

  // ----- AI handlers（P0）-----
  // 生产 CSP connect-src 'self' + renderer sandbox:true，模型请求只能在主进程发起；
  // 增量 token 用 webContents.send 推回，不走高频 invoke。密钥只在本进程解密。
  const aiKeyStore = createAiKeyStore({ getWorkDir: currentAiWorkDir });
  const aiEmit = function(event, payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    if (event === 'error') {
      // 只记 taskId 与错误码，不记密钥、不记对话正文。
      mainLog.warn('app', 'AI 会话失败', { taskId: data.taskId, code: data.code }, undefined, 'ai.chat_failed');
    }
    if (win && !win.isDestroyed()) win.webContents.send(`ai:chat:${event}`, data);
  };
  const aiService = createAiService({ keyStore: aiKeyStore, emit: aiEmit });
  const aiAgentStore = createAiAgentStore({ getWorkDir: currentAiWorkDir });
  // P4-S：历史会话独立存 .topomind/ai/sessions.json；按当前工作目录隔离。
  // handler 不写日志：会话正文不入日志，IPC 调用本身由 preload 单点审计覆盖。
  const aiSessionStore = createAiSessionStore({ getWorkDir: currentAiWorkDir });
  // P3 / D：简版 RAG 索引。只在 kb.ask 首次问答时惰性建索引，不在启动时扫描业务文件；
  // 只写 .topomind/ai-index/，绝不改写业务文件；正文不入日志。
  const aiIndexService = createAiIndexService({ getWorkDir: currentAiWorkDir });

  ipcMain.handle('ai:config:get', function() { return aiKeyStore.getPublicConfig(); });
  ipcMain.handle('ai:config:save', function(e, patch) {
    const publicConfig = aiKeyStore.saveConfig(patch);
    mainLog.info('app', 'AI 助手配置已保存', { model: publicConfig.model }, 'ai.config_save');
    return publicConfig;
  });
  // S1：Agent 定义独立存 .topomind/ai/agents.json，不混进 config.json。
  // 日志只记数量，绝不记系统提示词正文（§15.4）。
  ipcMain.handle('ai:agents:get', function() { return aiAgentStore.getConfig(); });
  ipcMain.handle('ai:agents:set', function(e, payload) {
    const next = aiAgentStore.saveConfig(payload);
    mainLog.info('app', 'AI 智能体配置已保存', { count: next.agents.length }, undefined, 'ai.agent_save');
    return next;
  });
  ipcMain.handle('ai:sessions:list', function() { return aiSessionStore.list(); });
  ipcMain.handle('ai:sessions:get', function(e, id) { return aiSessionStore.get(id); });
  ipcMain.handle('ai:sessions:upsert', function(e, payload) { return aiSessionStore.upsert(payload); });
  ipcMain.handle('ai:sessions:delete', function(e, id) { return aiSessionStore.remove(id); });
  // P5：测试连接可指定模型 id；空串由主进程回退到全局默认模型。
  ipcMain.handle('ai:chat:test', function(e, modelId) {
    return aiService.testConnection(typeof modelId === 'string' ? modelId.slice(0, 80) : '');
  });
  ipcMain.handle('ai:chat:start', function(e, payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const taskId = typeof data.taskId === 'string' ? data.taskId.slice(0, 80) : '';
    if (!taskId) return { ok: false, code: 'invalid_config', message: '缺少会话标识' };
    // S2：agent 只含渲染后的最终 prompt 与已钳制的参数，不含密钥；日志只记 id。
    const agent = data.agent && typeof data.agent === 'object' ? data.agent : null;
    // P5：modelId 只是本轮选中的模型配置 id，不含任何密钥；agent payload 里已快照，
    // 顶层字段是无 agent 请求的兜底。日志只记 id，不记服务地址 / 模型名。
    const modelId = typeof data.modelId === 'string' ? data.modelId.slice(0, 80)
      : (typeof agent?.modelId === 'string' ? agent.modelId.slice(0, 80) : '');
    // P2：只记工具数量，不记 schema / 参数 / 对话正文（C10 / C15）。
    const toolCount = Array.isArray(data.tools) ? data.tools.length : 0;
    // S3：子调用登记父任务 id，cancel 时由 ai-service 级联 abort 全部后代。
    const parentTaskId = typeof data.parentTaskId === 'string' ? data.parentTaskId.slice(0, 80) : '';
    mainLog.info('app', 'AI 会话开始', { taskId, agentId: agent?.agentId ?? null, toolCount, hasParent: Boolean(parentTaskId), modelId }, 'ai.chat');
    // 立即返回，让流式长连接不阻塞 IPC invoke。
    void aiService.startChat({ taskId, messages: data.messages, agent, tools: data.tools, parentTaskId, modelId });
    return { ok: true, taskId };
  });
  ipcMain.on('ai:chat:cancel', function(e, taskId) { aiService.cancel(taskId); });
  // P3 / D：本地倒排检索（invoke 通道，不新增流式通道）。返回片段带 docId / cardPath /
  // charRange，由渲染层 buildContextEnvelope() 统一组装后才允许外发给模型。
  ipcMain.handle('ai:index:query', function(e, payload) { return aiIndexService.query(payload); });

  ipcMain.handle('monitor:open', function() {
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:menu-action', 'monitor.open');
    }
  });
}

// ============================================================
// APP LIFECYCLE
// ============================================================
var win = null;
var windowStateSaveTimeout = null;
let _isQuittingAfterFlush = false;
let _isSafeQuitInProgress = false;

async function requestSafeQuit(reason) {
  if (_isSafeQuitInProgress) {
    return { ok: false, inProgress: true };
  }
  _isSafeQuitInProgress = true;
  try {
    mainLifecycle('quit.requested', { reason: reason || 'quit-app' }, 'app.quit');
    const guardResult = await confirmAndFlushBeforeExit(reason || 'quit-app');
    mainLifecycle('close-guard.done', { ok: Boolean(guardResult.ok) });
    if (!guardResult.ok) {
      return guardResult;
    }
    // 必须在 drain() 之前写完最后一条生命周期日志：drain 之后进程随即退出，
    // 新日志来不及进写队列（P2 关闭链路埋点约束）。
    mainLifecycle('quit.approved', { reason: reason || 'quit-app' }, 'app.quit');
    // 退出前确认日志写队列已排空，避免「accepted:true 但进程已经没了」。
    try { await LogService.drain(); } catch { /* 日志落盘失败不阻断退出 */ }
    // P3：drain 之后才把 session.json 标记为 clean，否则异常退出会被误判。
    try { LogService.markSessionClean(); } catch { /* 状态写入失败不阻断退出 */ }
    _isQuittingAfterFlush = true;
    app.quit();
    return { ok: true };
  } finally {
    _isSafeQuitInProgress = false;
  }
}

function getWindowControlsState() {
  if (!win || win.isDestroyed()) {
    return { isMaximized: false, isFocused: false };
  }
  return {
    isMaximized: win.isMaximized(),
    isFocused: win.isFocused(),
  };
}

function sendWindowControlsState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('app:window-state-change', getWindowControlsState());
}

function saveWindowStateDebounced() {
  if (!win || win.isDestroyed()) return;
  const currentWorkDir = LogService.getCurrentWorkDir();
  if (!currentWorkDir) return;

  if (windowStateSaveTimeout) {
    clearTimeout(windowStateSaveTimeout);
  }

  windowStateSaveTimeout = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    try {
      const bounds = win.getBounds();
      const isMaximized = win.isMaximized();
      fileService.writeWindowState(currentWorkDir, {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized
      });
    } catch (e) {
      console.error('[window-state] Failed to save window state:', e);
    }
  }, 1000);
}

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

if (process.env.TOPOMIND_PROFILE && process.env.TOPOMIND_PROFILE !== 'prod') {
  app.setName('TopoMind-' + process.env.TOPOMIND_PROFILE);
}

function createWindow() {
  const preloadPath = nodePath.join(DIST_ELECTRON_DIR, 'preload.js');
  const isMac = process.platform === 'darwin';

  win = new BrowserWindow({
    width: SETUP_WINDOW_WIDTH, height: SETUP_WINDOW_HEIGHT,
    useContentSize: true,
    // setup 阶段固定窗口只用 resizable:false 表达。绝不要用 minWidth===maxWidth、
    // minHeight===maxHeight 去"锁"尺寸：AppKit 会把窗口尺寸夹死，导致工作区里
    // 鼠标拖边缘看似无效、win.maximize() 也被夹回 setup 尺寸（macOS 尤其明显）。
    // 进入工作区时由 applyWorkspaceWindowConstraints() 打开 resizable 并设最小尺寸。
    resizable: false,
    // macOS: frame:false 无边框窗口没有原生 resize handle；用 hidden 标题栏保留
    // 原生窗口边框的 resize/zoom 能力，视觉上仍无标题栏。Windows/Linux 维持原样。
    ...(isMac
      ? { titleBarStyle: 'hidden' }
      : { frame: false }),
    center: true,
    show: false,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    title: 'TopoMind',
    icon: nodePath.join(APP_PATH, 'build', 'icon.png'),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      // 开启渲染进程 OS 级沙箱：即使渲染进程出现 XSS，也无法借 preload 暴露的
      // fs:* IPC 越权读写本地文件。preload 仅使用 contextBridge/ipcRenderer，
      // 二者在沙箱内可用，故不影响现有 IPC 桥。若启动白屏请移除此项回滚。
      sandbox: true,
    },
  });

  // titleBarStyle:'hidden' 下 macOS 仍会显示原生红绿灯，它会盖住自定义标题栏左上角的
  // logo/菜单。窗口控制已由 CustomTitleBar 的三个按钮 + 双击标题栏接管，故隐藏原生按钮。
  if (isMac && typeof win.setWindowButtonVisibility === 'function') {
    win.setWindowButtonVisibility(false);
  }

  if (IS_DEV) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // 用自定义特权协议加载，规避 file:// 下 ES module (crossorigin) 被 CORS 拦截导致的白屏。
    win.loadURL(`${RENDERER_SCHEME}://./index.html`);
  }
  // 渲染进程 console 输出量大：只在开发构建接回日志，并按秒节流，避免自我放大。
  let consoleLogWindowStart = 0;
  let consoleLogCount = 0;
  win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (!IS_DEV) return;
    const now = Date.now();
    if (now - consoleLogWindowStart > 1000) { consoleLogWindowStart = now; consoleLogCount = 0; }
    if (consoleLogCount++ > 20) return;
    mainLog.debug('app', `[Browser Console] ${message}`, { level, sourceId, lineNumber });
  });
  win.webContents.on('did-fail-load', function(e, errorCode, errorDescription, validatedURL, isMainFrame) {
    mainLog.error('app', '页面加载失败', { errorCode, errorDescription, validatedURL, isMainFrame }, null, 'app.error');
  });
  win.webContents.on('did-finish-load', function() {
    const currentUrl = win && !win.isDestroyed() ? win.webContents.getURL() : '';
    mainLog.debug('app', '页面加载完成', { url: currentUrl });
  });
  win.webContents.setWindowOpenHandler(function(details) {
    var target = sanitizeExternalUrl(details.url);
    if (target) {
      void openExternalSafely(target);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', function(event, targetUrl) {
    if (isTrustedAppUrl(targetUrl)) return;
    event.preventDefault();
    var target = sanitizeExternalUrl(targetUrl);
    if (target) {
      void openExternalSafely(target);
    }
  });
  win.once('ready-to-show', function() {
    if (win && !win.isDestroyed()) {
      win.show();
    }
  });
  win.webContents.on('render-process-gone', function(e, details) {
    mainLog.error('app', '渲染进程退出', { reason: details?.reason, exitCode: details?.exitCode }, null, 'app.crash');
  });
  win.on('unresponsive', function() {
    mainLog.error('app', '窗口无响应', {}, null, 'app.error');
  });

  win.on('resize', saveWindowStateDebounced);
  win.on('move', saveWindowStateDebounced);
  win.on('maximize', saveWindowStateDebounced);
  win.on('unmaximize', saveWindowStateDebounced);
  win.on('maximize', sendWindowControlsState);
  win.on('unmaximize', sendWindowControlsState);
  win.on('restore', sendWindowControlsState);
  win.on('focus', sendWindowControlsState);
  win.on('blur', sendWindowControlsState);

  win.on('close', function(event) {
    if (!_isQuittingAfterFlush) {
      event.preventDefault();
      void requestSafeQuit('quit-app');
      return;
    }

    if (!win || win.isDestroyed()) return;
    const currentWorkDir = LogService.getCurrentWorkDir();
    if (currentWorkDir) {
      if (windowStateSaveTimeout) {
        clearTimeout(windowStateSaveTimeout);
      }
      try {
        const bounds = win.getBounds();
        const isMaximized = win.isMaximized();
        fileService.writeWindowState(currentWorkDir, {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          isMaximized
        });
      } catch (e) {
        console.error('[window-state] Failed to save window state on close:', e);
      }
    }
  });

  win.on('closed', function() {
    for (const requestId of pendingCloseGuardRequests.keys()) {
      resolveCloseGuardRequest(requestId, { ok: false, hasDirty: true, failedTabId: null, error: 'window-closed' });
    }
    win = null;
  });
}

function toggleMonitorWindow() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:menu-action', 'monitor.open');
  }
}

function openLearningStatisticsWindow() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:menu-action', 'learning.open');
  }
}

/**
 * 进入工作区时解除 setup 窗口的尺寸锁。
 *
 * 只做两件确定的事：打开 resizable、设置工作区最小尺寸。全程不调用
 * setMaximumSize —— 旧实现靠 setMaximumSize(0, 0) 去"解除"构造时写死的
 * maxWidth/maxHeight，这个 0 是否被 AppKit 当作「无限制」是平台/版本相关的
 * 隐式行为，正是 macOS 上拖不动、maximize() 无效的根因。现在构造时根本不设
 * 最大尺寸，也就没有任何需要解除的约束。
 */
function applyWorkspaceWindowConstraints() {
  if (!win || win.isDestroyed()) return;
  win.setResizable(true);
  win.setMinimumSize(WORKSPACE_MIN_WIDTH, WORKSPACE_MIN_HEIGHT);
  if (IS_DEV) {
    console.log('[window:constraints] workspace', {
      platform: process.platform,
      resizable: win.isResizable(),
      minSize: win.getMinimumSize(),
      maxSize: typeof win.getMaximumSize === 'function' ? win.getMaximumSize() : null,
      maximizable: typeof win.isMaximizable === 'function' ? win.isMaximizable() : null,
    });
  }
}

function resetMainWindowToSetup() {
  if (!win || win.isDestroyed()) return;
  
  if (win.isMaximized()) {
    win.unmaximize();
  }
  
  win.setResizable(false);
  win.setMinimumSize(SETUP_WINDOW_WIDTH, SETUP_WINDOW_HEIGHT);
  win.setContentSize(SETUP_WINDOW_WIDTH, SETUP_WINDOW_HEIGHT);
  win.center();
  
  buildMenu(true);
  win.webContents.send('app:reset-session');
}

function buildMenu(isSetupView) {
  if (isSetupView) {
    Menu.setApplicationMenu(null);
    return;
  }

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
      { label: '系统日志', click: function() { toggleMonitorWindow(); } },
      { label: '学习统计', click: function() { openLearningStatisticsWindow(); } },
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

// App ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, supportFetchAPI: true, secure: true, stream: true } },
  // 渲染进程主协议：用自定义特权协议提供 dist/，规避 file:// 下 ES module (crossorigin)
  // 被 CORS 拦截导致白屏（dev 用 http://localhost 无此问题）。standard+secure 让模块按同源加载。
  { scheme: 'topomind', privileges: { standard: true, supportFetchAPI: true, secure: true, stream: true, bypassCSP: false } },
]);

const RENDERER_SCHEME = 'topomind';

function mimeFromPath(p) {
  const ext = nodePath.extname(p).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.cjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.map': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
  };
  return map[ext] || 'application/octet-stream';
}

function handleRendererSchemeRequest(request) {
  try {
    const url = new URL(request.url);
    let rel = url.pathname || '';
    // 去掉开头的一个或多个斜杠；保留 './' 形式（loadURL 用 topomind://./index.html）
    rel = rel.replace(/^\/+/, '');
    if (rel.startsWith('./')) rel = rel.slice(2);
    if (!rel) rel = 'index.html';
    const target = nodePath.join(DIST_RENDERER_DIR, rel);
    const resolvedTarget = nodePath.normalize(target);
    const resolvedRoot = nodePath.resolve(DIST_RENDERER_DIR);
    // 防御路径穿越
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + nodePath.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!nodeFs.existsSync(resolvedTarget) || !nodeFs.statSync(resolvedTarget).isFile()) {
      return new Response('Not found', { status: 404 });
    }
    // nodeFs 支持 asar，打包后也能读到 app.asar/dist 下的资源。
    const data = nodeFs.readFileSync(resolvedTarget);
    // 关键修复：Node 对 <8KB 小文件（恰是 index.html 与若干小 chunk）的
    // readFileSync 会复用内部 Buffer 内存池（byteOffset≠0，buffer 远大于内容）。
    // 直接把 Buffer 当 Response body 交给 protocol.handle 跨进程序列化时，
    // Chromium 按整个 pool buffer 取字节而非视图范围，导致 body 错乱/为空 → 白屏。
    // 用 new Uint8Array(data) 拷贝成独立 ArrayBuffer（offset 0、长度精确）即可稳定。
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': mimeFromPath(resolvedTarget),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    console.error('[topomind protocol] error', err);
    return new Response('Not found', { status: 404 });
  }
}

/**
 * 解析 macOS Dock 图标路径。
 * - dev: APP_PATH 指向仓库根，build/icon.png 可直接读取。
 * - packaged: build/ 不进 asar，electron-builder 会把图标落到 Contents/Resources。
 * 找不到就返回 null（打包后 .app bundle 自带图标，无需运行时再设）。
 */
function resolveDockIconPath() {
  const resourceDir = process.resourcesPath || '';
  const candidates = [
    nodePath.join(APP_PATH, 'build', 'icon.png'),
    nodePath.join(resourceDir, 'icon.png'),
    nodePath.join(resourceDir, 'icon.icns'),
    nodePath.join(resourceDir, 'electron.icns'),
  ];
  return candidates.find((p) => p && nodeFs.existsSync(p)) || null;
}

app.whenReady().then(function() {
  // BrowserWindow.icon 在 macOS 上被 Electron 忽略；dev 模式跑的是 Electron 自带 bundle，
  // Dock 默认显示 Electron 图标。必须显式设置运行时 Dock 图标才会显示自定义图标。
  if (process.platform === 'darwin' && app.dock && typeof app.dock.setIcon === 'function') {
    const dockIconPath = resolveDockIconPath();
    if (dockIconPath) {
      try {
        app.dock.setIcon(dockIconPath);
      } catch (err) {
        console.error('[app:dock-icon] failed to set dock icon:', err);
      }
    }
  }

  protocol.handle('local-file', async (request) => {
    try {
      const filePath = parseLocalFileUrl(request.url);
      // Validate that it's within current workspace
      const currentWorkDir = LogService.getCurrentWorkDir();
      if (currentWorkDir && isAllowedLocalFilePath(currentWorkDir, filePath)) {
        try {
          const res = await net.fetch(pathToFileURL(filePath).href);
          return res;
        } catch (fetchErr) {
          console.error('net.fetch error on local-file:', fetchErr);
          return new Response('Not found', { status: 404 });
        }
      }
      return new Response('Access denied', { status: 403 });
    } catch (err) {
      console.error('local-file protocol error', err);
      return new Response('Not found', { status: 404 });
    }
  });

  // 渲染进程主协议：以 topomind:// 提供 dist/ 资源（同源、按标准 web origin 加载 ES module）。
  protocol.handle(RENDERER_SCHEME, (request) => handleRendererSchemeRequest(request));

  mainLifecycle('app.ready');
  registerIPC();
  buildMenu(true);
  mainLifecycle('ipc.registered');
  createWindow();
  mainLifecycle('window.created');
  app.on('activate', function() { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// P3：GPU / utility 子进程异常退出也纳入崩溃监控（error 类同步落盘 + dumpRef）。
app.on('child-process-gone', function(_event, details) {
  mainLog.error('app', '子进程异常退出', {
    type: details?.type ?? 'unknown',
    reason: details?.reason ?? 'unknown',
    exitCode: details?.exitCode ?? null,
  }, null, 'app.crash');
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', function() {
  mainLifecycle('window.all-closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async function(event) {
  if (_isQuittingAfterFlush) {
    return;
  }

  event.preventDefault();
  mainLifecycle('quit.before-quit');
  await requestSafeQuit('quit-app');
});
