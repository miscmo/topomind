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
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen, protocol, net } from 'electron';
import nodePath from 'path';
import nodeFs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { fileService, _fs_attachmentRefToPath, _fs_requireValidWorkDir } from './file-service.js';
import { dialogService } from './dialog-service.js';
import LogService from './log-service.js';
import { createFileCacheService } from './services/file-cache-service.js';
import { createAttachmentUploadJobProducer } from './services/attachment-upload-job-producer.js';
import { createAttachmentUploadService } from './services/attachment-upload-service.js';
import { createImportService } from './services/import-service.js';
import { createLocalDbService } from './services/localdb-service.js';

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
const HOME_WINDOW_WIDTH = 1400;
const HOME_WINDOW_HEIGHT = 900;
const WINDOW_BACKGROUND_COLOR = '#ffffff';
const IS_DEV = !!process.env.VITE_DEV_SERVER_URL;
const DEFAULT_CLOUD_SERVER_URL = process.env.VITE_TOPOMIND_SERVER_URL || 'http://127.0.0.1:3000';
const cloudSessionState = {
  accessToken: null,
  refreshToken: null,
  userId: null,
};
const fileCacheService = createFileCacheService({
  getUserDataPath: () => app.getPath('userData'),
});
const localDbService = createLocalDbService({
  getUserDataPath: () => app.getPath('userData'),
});
const attachmentUploadJobProducer = createAttachmentUploadJobProducer({
  attachmentRefToPath: _fs_attachmentRefToPath,
  localDbService,
  writeLog: (entry) => LogService.write(entry),
});
let importService = null;
const attachmentUploadService = createAttachmentUploadService({
  localDbService,
  writeLog: (entry) => LogService.write(entry),
  commitUploadedAttachment: commitUploadedAttachmentToCloud,
  issueUploadTicket: issueAttachmentUploadTicketFromCloud,
  getCloudSessionHealth: getAttachmentCloudSessionHealth,
  onTerminalState: (attachmentJob) =>
    importService ? importService.handleAttachmentUploadJobTerminalState(attachmentJob) : null,
});
importService = createImportService({
  getCurrentWorkDir: () => LogService.getCurrentWorkDir(),
  localDbService,
  runSourceImport: (workDir, sourcePath) => fileService.importKB(requireActiveWorkDir(workDir), sourcePath),
  writeLog: (entry) => LogService.write(entry),
  wakeAttachmentUploadWorker: () => attachmentUploadService.processPendingJobs(),
});

function buildLocalFileUrl(absPath) {
  return pathToFileURL(absPath).href.replace(/^file:\/\//i, 'local-file://');
}

function getCloudServerBaseUrl() {
  return String(DEFAULT_CLOUD_SERVER_URL || 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
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

function sanitizeLocalPath(rawPath) {
  if (typeof rawPath !== 'string') return null;
  var target = rawPath.trim();
  if (!target || target.length > 4096 || /[\x00-\x1F\x7F]/.test(target)) return null;
  return nodePath.resolve(target);
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function detectMimeTypeFromFileName(fileName) {
  const extension = nodePath.extname(String(fileName || '')).slice(1).toLowerCase();
  const mimeByExtension = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    pdf: 'application/pdf',
  };
  return mimeByExtension[extension] || 'application/octet-stream';
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
  return attachIndex >= 0 && attachIndex < parts.length - 1;
}

function enqueueAttachmentUploadJobFromRef(rootDir, cardPath, attachmentRef, syncContext, source, uploadTicketJson) {
  const job = attachmentUploadJobProducer.enqueueFromRef(
    rootDir,
    cardPath,
    attachmentRef,
    syncContext,
    source,
    uploadTicketJson,
  );
  if (job) {
    void attachmentUploadService.processPendingJobs();
  }
  return job;
}

function setCloudSessionState(input) {
  const normalized = isPlainObject(input) ? input : {};
  const accessToken = typeof normalized.accessToken === 'string' ? normalized.accessToken.trim() : '';
  const refreshToken =
    typeof normalized.refreshToken === 'string' && normalized.refreshToken.trim()
      ? normalized.refreshToken.trim()
      : null;
  const userId =
    typeof normalized.userId === 'string' && normalized.userId.trim()
      ? normalized.userId.trim()
      : null;

  cloudSessionState.accessToken = accessToken || null;
  cloudSessionState.refreshToken = refreshToken;
  cloudSessionState.userId = userId;
  return {
    ok: true,
    hasAccessToken: Boolean(cloudSessionState.accessToken),
    hasRefreshToken: Boolean(cloudSessionState.refreshToken),
  };
}

function clearCloudSessionState() {
  cloudSessionState.accessToken = null;
  cloudSessionState.refreshToken = null;
  cloudSessionState.userId = null;
  return { ok: true };
}

function getAttachmentCloudSessionHealth() {
  return {
    hasAccessToken: Boolean(cloudSessionState.accessToken),
    hasRefreshToken: Boolean(cloudSessionState.refreshToken),
    userId: cloudSessionState.userId,
  };
}

async function requestMainProcessAccessToken() {
  if (cloudSessionState.accessToken) {
    return cloudSessionState.accessToken;
  }
  if (!cloudSessionState.refreshToken) {
    throw new Error('当前主进程没有可用的云端会话，无法为附件任务续签 upload ticket');
  }
  const refreshedAccessToken = await refreshCloudAttachmentAccessToken(
    getCloudServerBaseUrl(),
    cloudSessionState.refreshToken,
  );
  cloudSessionState.accessToken = refreshedAccessToken;
  return refreshedAccessToken;
}

async function requestMainProcessJson(pathname, options = {}) {
  const {
    method = 'GET',
    body,
    retryOnUnauthorized = true,
  } = options;
  const accessToken = await requestMainProcessAccessToken();
  const response = await fetch(`${getCloudServerBaseUrl()}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && retryOnUnauthorized && cloudSessionState.refreshToken) {
    const refreshedAccessToken = await refreshCloudAttachmentAccessToken(
      getCloudServerBaseUrl(),
      cloudSessionState.refreshToken,
    );
    cloudSessionState.accessToken = refreshedAccessToken;
    return requestMainProcessJson(pathname, {
      ...options,
      retryOnUnauthorized: false,
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {}

  if (!response.ok || !payload || payload.ok !== true) {
    const message =
      payload && payload.ok === false && payload.error && typeof payload.error.message === 'string'
        ? payload.error.message
        : `请求 ${pathname} 失败: ${response.status}`;
    throw new Error(message);
  }

  return payload.data;
}

async function issueAttachmentUploadTicketFromCloud(input) {
  return requestMainProcessJson(`/workspaces/${input.workspaceId}/attachments/upload-ticket`, {
    method: 'POST',
    body: {
      knowledgeBaseId: input.knowledgeBaseId,
      cardId: input.cardId,
      documentId: input.documentId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    },
  });
}

async function commitUploadedAttachmentToCloud(input) {
  const uploadTicketJson = isPlainObject(input?.uploadTicketJson) ? input.uploadTicketJson : {};
  const commitUrl =
    typeof uploadTicketJson.commitUrl === 'string' ? uploadTicketJson.commitUrl.trim() : '';
  if (!commitUrl) {
    throw new Error('附件任务缺少 commitUrl，无法提交云端元数据');
  }

  const response = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      attachmentJobId: input.attachmentJobId,
      workspaceId: input.workspaceId,
      knowledgeBaseId: input.knowledgeBaseId,
      cardId: input.cardId,
      documentId: input.documentId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: input.storageKey,
      sha256: input.sha256,
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {}

  if (!response.ok) {
    const message =
      payload && payload.ok === false && payload.error && typeof payload.error.message === 'string'
        ? payload.error.message
        : `附件 commit 失败: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function sanitizeAttachmentCacheFileName(fileName) {
  const normalized = String(fileName || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  return normalized || 'attachment.bin';
}

function getCloudAttachmentCachePath(workspaceId, attachmentId, fileName) {
  const cachePaths = fileCacheService.getPaths();
  const safeWorkspaceId = String(workspaceId || '').trim() || 'workspace';
  const safeAttachmentId = String(attachmentId || '').trim() || 'attachment';
  const safeFileName = sanitizeAttachmentCacheFileName(fileName);
  return nodePath.join(cachePaths.attachmentsDir, safeWorkspaceId, safeAttachmentId, safeFileName);
}

async function refreshCloudAttachmentAccessToken(baseUrl, refreshToken) {
  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok || !payload || payload.ok !== true || !payload.data?.accessToken) {
    throw new Error('刷新云端附件访问令牌失败');
  }
  return String(payload.data.accessToken);
}

async function fetchCloudAttachmentResponse(input, accessToken) {
  return fetch(
    `${String(input.baseUrl || '').replace(/\/+$/, '')}/workspaces/${input.workspaceId}/attachments/${input.attachmentId}/content`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
}

function normalizeCloudAttachmentCacheInput(input) {
  if (!isPlainObject(input)) {
    throw new Error('云附件缓存参数无效');
  }
  const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId.trim() : '';
  const attachmentId = typeof input.attachmentId === 'string' ? input.attachmentId.trim() : '';
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
  const refreshToken = typeof input.refreshToken === 'string' ? input.refreshToken.trim() : '';
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim().replace(/\/+$/, '') : '';
  if (!workspaceId || !attachmentId || !fileName || !accessToken || !baseUrl) {
    throw new Error('云附件缓存参数不完整');
  }
  return {
    workspaceId,
    attachmentId,
    fileName,
    accessToken,
    refreshToken: refreshToken || null,
    baseUrl,
  };
}

async function ensureCloudAttachmentCached(input) {
  const normalized = normalizeCloudAttachmentCacheInput(input);
  fileCacheService.ensureReady();
  const targetPath = getCloudAttachmentCachePath(
    normalized.workspaceId,
    normalized.attachmentId,
    normalized.fileName,
  );
  if (nodeFs.existsSync(targetPath) && nodeFs.statSync(targetPath).isFile()) {
    return {
      absolutePath: targetPath,
      url: buildLocalFileUrl(targetPath),
    };
  }

  nodeFs.mkdirSync(nodePath.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.downloading`;
  let token = normalized.accessToken;
  let response = await fetchCloudAttachmentResponse(normalized, token);
  if (response.status === 401 && normalized.refreshToken) {
    token = await refreshCloudAttachmentAccessToken(normalized.baseUrl, normalized.refreshToken);
    response = await fetchCloudAttachmentResponse(normalized, token);
  }

  if (!response.ok) {
    throw new Error(`下载云附件失败: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  nodeFs.writeFileSync(tempPath, buffer);
  nodeFs.renameSync(tempPath, targetPath);
  return {
    absolutePath: targetPath,
    url: buildLocalFileUrl(targetPath),
  };
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

// ============================================================
// IPC HANDLERS
// ============================================================

/**
 * 注册渲染进程与主进程之间的所有 IPC 通道。
 */
async function readRendererDirtyState() {
  if (!win || win.isDestroyed()) return { hasDirty: false, dirtyTabIds: [] };
  try {
    const result = await win.webContents.executeJavaScript(`(() => {
      const guard = window.__topomindCloseGuard;
      return guard ? guard.getDirtyState() : { hasDirty: false, dirtyTabIds: [] };
    })()`);
    return result || { hasDirty: false, dirtyTabIds: [] };
  } catch (e) {
    return { hasDirty: false, dirtyTabIds: [] };
  }
}

async function flushRendererDirtyTabs() {
  if (!win || win.isDestroyed()) return { ok: true, hasDirty: false };
  try {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const guard = window.__topomindCloseGuard;
      if (!guard) return { ok: true, hasDirty: false };
      const state = guard.getDirtyState();
      if (!state.hasDirty) return { ok: true, hasDirty: false };
      const flushResult = await guard.flushAllDirtyTabs();
      return { ok: !!flushResult.ok, hasDirty: true, failedTabId: flushResult.failedTabId || null };
    })()`);
    return result || { ok: true, hasDirty: false };
  } catch (e) {
    return { ok: false, hasDirty: true };
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
    await dialog.showMessageBox(win, {
      type: 'error',
      buttons: ['知道了'],
      defaultId: 0,
      title: '保存失败',
      message: '存在修改未能成功写入磁盘，本次操作已取消。',
    });
    return { ok: false, failed: true };
  }

  return { ok: true, hasDirty: true };
}

function registerIPC() {
  // ----- File system handlers -----
  ipcMain.handle('fs:listKBs', function(e, rootDir) { return fileService.listKBs(requireActiveWorkDir(rootDir)); });
  ipcMain.handle('fs:listTrashKBs', function(e, rootDir) { return fileService.listTrashKBs(requireActiveWorkDir(rootDir)); });
  ipcMain.handle('fs:restoreTrashKB', function(e, rootDir, trashName) { return fileService.restoreTrashKB(requireActiveWorkDir(rootDir), trashName); });
  ipcMain.handle('fs:clearTrashKBs', function(e, rootDir) { return fileService.clearTrashKBs(requireActiveWorkDir(rootDir)); });
  ipcMain.handle('fs:readCardChildren', function(e, rootDir, p) { return fileService.readCardChildren(requireActiveWorkDir(rootDir), p); });
  ipcMain.handle('fs:createKbsDir', function(e, rootDir, p) { return fileService.createKbsDir(requireActiveWorkDir(rootDir), p); });
  ipcMain.handle('fs:createCardDir', function(e, rootDir, parentPath, cardName) { return fileService.createCardDir(requireActiveWorkDir(rootDir), parentPath, cardName); });
  ipcMain.handle('fs:deleteKbsDir', function(e, rootDir, p) { fileService.deleteKbsDir(requireActiveWorkDir(rootDir), p); });
  ipcMain.handle('fs:renameKB', function(e, rootDir, p, n) { return fileService.renameKB(requireActiveWorkDir(rootDir), p, n); });
  ipcMain.handle('fs:readGraphMeta', function(e, rootDir, p) { return fileService.readGraphMeta(requireActiveWorkDir(rootDir), p); });
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
  ipcMain.handle('fs:readTopoDocument', function(e, rootDir, cardPath, documentId) {
    return fileService.readTopoDocument(requireActiveWorkDir(rootDir), cardPath, documentId);
  });
  ipcMain.handle('fs:writeTopoDocument', function(e, rootDir, cardPath, documentId, content) {
    return fileService.writeTopoDocument(requireActiveWorkDir(rootDir), cardPath, documentId, content);
  });
  ipcMain.handle('fs:renameTopoDocument', function(e, rootDir, cardPath, documentId, title) {
    return fileService.renameTopoDocument(requireActiveWorkDir(rootDir), cardPath, documentId, title);
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
  ipcMain.handle('fs:listAttachments', function(e, rootDir, cardPath) {
    return fileService.listAttachments(requireActiveWorkDir(rootDir), cardPath);
  });
  ipcMain.handle('fs:importAttachment', function(e, rootDir, cardPath, sourceFilePath, targetFileName, syncContext, uploadTicketJson) {
    const activeRootDir = requireActiveWorkDir(rootDir);
    const attachmentRef = fileService.importAttachment(activeRootDir, cardPath, sourceFilePath, targetFileName);
    enqueueAttachmentUploadJobFromRef(
      activeRootDir,
      cardPath,
      attachmentRef,
      syncContext,
      'fs:importAttachment',
      uploadTicketJson,
    );
    return attachmentRef;
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
    } catch (err) {
      return null;
    }
  });
  ipcMain.handle('fs:showAttachmentInFolder', async function(e, rootDir, cardPath, attachmentRef) {
    return fileService.showAttachmentInFolder(requireActiveWorkDir(rootDir), cardPath, attachmentRef);
  });
  ipcMain.handle('fs:openAttachment', async function(e, rootDir, cardPath, attachmentRef) {
    return fileService.openAttachment(requireActiveWorkDir(rootDir), cardPath, attachmentRef);
  });
  ipcMain.handle('fs:writeAttachmentBase64', function(e, rootDir, cardPath, fileName, mimeType, base64, syncContext, uploadTicketJson) {
    const activeRootDir = requireActiveWorkDir(rootDir);
    const attachmentRef = fileService.writeAttachmentBase64(activeRootDir, cardPath, fileName, mimeType, base64);
    enqueueAttachmentUploadJobFromRef(
      activeRootDir,
      cardPath,
      attachmentRef,
      syncContext,
      'fs:writeAttachmentBase64',
      uploadTicketJson,
    );
    return attachmentRef;
  });
  ipcMain.handle('fs:downloadAttachment', async function(e, rootDir, cardPath, url, targetFileName, syncContext, uploadTicketJson) {
    const activeRootDir = requireActiveWorkDir(rootDir);
    const attachmentRef = await fileService.downloadAttachment(activeRootDir, cardPath, url, targetFileName);
    enqueueAttachmentUploadJobFromRef(
      activeRootDir,
      cardPath,
      attachmentRef,
      syncContext,
      'fs:downloadAttachment',
      uploadTicketJson,
    );
    return attachmentRef;
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
    LogService.write({
      level: result.valid ? 'INFO' : 'ERROR', module: 'Main', action: 'fs:isValidWorkDir',
      message: result.valid ? '工作目录校验成功' : '工作目录校验失败', params: { dirPath, valid: result.valid, error: result.error || null },
    });
    return result;
  });
  ipcMain.handle('fs:selectDirectory', function() {
    var result = dialogService.selectDirectory();
    LogService.write({
      level: 'INFO', module: 'Main', action: 'fs:selectDirectory',
      message: '文件对话框已关闭', params: { valid: result.valid, path: result.nodePath || null, error: result.error || null },
    });
    return result;
  });
  ipcMain.handle('fs:createWorkDir', function(e, dirPath) {
    var result = fileService.createWorkDir(dirPath);
    LogService.write({
      level: result.valid ? 'INFO' : 'ERROR', module: 'Main', action: 'fs:createWorkDir',
      message: result.valid ? '工作目录创建成功' : '工作目录创建失败', params: { dirPath, valid: result.valid, error: result.error || null },
    });
    return result;
  });
  ipcMain.handle('fs:importKB', function(e, rootDir, sourcePath) {
    var result = fileService.importKB(requireActiveWorkDir(rootDir), sourcePath);
    LogService.write({
      level: 'INFO', module: 'Main', action: 'fs:importKB',
      message: '知识库导入成功', params: { sourcePath, importedPath: result },
    });
    return result;
  });

  // ----- Local cache skeleton handlers -----
  ipcMain.handle('localdb:init', function() {
    return localDbService.init();
  });
  ipcMain.handle('localdb:health', function() {
    return localDbService.healthCheck();
  });
  ipcMain.handle('localdb:getPaths', function() {
    return localDbService.getPaths();
  });
  ipcMain.handle('localdb:applyBootstrap', function(e, snapshot) {
    return localDbService.applyBootstrap(snapshot);
  });
  ipcMain.handle('localdb:applySyncPull', function(e, payload) {
    return localDbService.applySyncPull(payload);
  });
  ipcMain.handle('localdb:applySyncPushResult', function(e, input) {
    const snapshot = localDbService.applySyncPushResult(input);
    void importService.processPendingJobs();
    return snapshot;
  });
  ipcMain.handle('localdb:getWorkspaceSnapshot', function(e, workspaceId) {
    return localDbService.getWorkspaceSnapshot(workspaceId);
  });
  ipcMain.handle('localdb:listKnowledgeBases', function(e, workspaceId) {
    return localDbService.listKnowledgeBases(workspaceId);
  });
  ipcMain.handle('localdb:updateKnowledgeBase', function(e, input) {
    return localDbService.updateKnowledgeBase(input);
  });
  ipcMain.handle('localdb:deleteKnowledgeBase', function(e, input) {
    return localDbService.deleteKnowledgeBase(input);
  });
  ipcMain.handle('localdb:restoreKnowledgeBase', function(e, input) {
    return localDbService.restoreKnowledgeBase(input);
  });
  ipcMain.handle('localdb:purgeKnowledgeBase', function(e, input) {
    return localDbService.purgeKnowledgeBase(input);
  });
  ipcMain.handle('localdb:createCard', function(e, input) {
    return localDbService.createCard(input);
  });
  ipcMain.handle('localdb:getCard', function(e, cardId) {
    return localDbService.getCard(cardId);
  });
  ipcMain.handle('localdb:updateCard', function(e, input) {
    return localDbService.updateCard(input);
  });
  ipcMain.handle('localdb:deleteCard', function(e, input) {
    return localDbService.deleteCard(input);
  });
  ipcMain.handle('localdb:restoreCard', function(e, input) {
    return localDbService.restoreCard(input);
  });
  ipcMain.handle('localdb:purgeCard', function(e, input) {
    return localDbService.purgeCard(input);
  });
  ipcMain.handle('localdb:createDocument', function(e, input) {
    return localDbService.createDocument(input);
  });
  ipcMain.handle('localdb:getDocument', function(e, documentId) {
    return localDbService.getDocument(documentId);
  });
  ipcMain.handle('localdb:updateDocument', function(e, input) {
    return localDbService.updateDocument(input);
  });
  ipcMain.handle('localdb:deleteDocument', function(e, input) {
    return localDbService.deleteDocument(input);
  });
  ipcMain.handle('localdb:restoreDocument', function(e, input) {
    return localDbService.restoreDocument(input);
  });
  ipcMain.handle('localdb:purgeDocument', function(e, input) {
    return localDbService.purgeDocument(input);
  });
  ipcMain.handle('localdb:deleteAttachment', function(e, input) {
    return localDbService.deleteAttachment(input);
  });
  ipcMain.handle('localdb:restoreAttachment', function(e, input) {
    return localDbService.restoreAttachment(input);
  });
  ipcMain.handle('localdb:purgeAttachment', function(e, input) {
    return localDbService.purgeAttachment(input);
  });
  ipcMain.handle('localdb:listAttachmentsByCard', function(e, workspaceId, cardId) {
    return localDbService.listAttachmentsByCard(workspaceId, cardId);
  });
  ipcMain.handle('localdb:listPendingOutbox', function(e, workspaceId, limit) {
    return localDbService.listPendingOutbox(workspaceId, limit);
  });
  ipcMain.handle('localdb:markOutboxItemSending', function(e, outboxId) {
    return localDbService.markOutboxItemSending(outboxId);
  });
  ipcMain.handle('localdb:markOutboxItemFailed', function(e, input) {
    return localDbService.markOutboxItemFailed(input);
  });
  ipcMain.handle('localdb:recordSyncPushConflict', function(e, input) {
    return localDbService.recordSyncPushConflict(input);
  });
  ipcMain.handle('localdb:listSyncConflicts', function(e, workspaceId, limit) {
    return localDbService.listSyncConflicts(workspaceId, limit);
  });
  ipcMain.handle('localdb:updateDocumentContent', function(e, input) {
    return localDbService.updateDocumentContent(input);
  });
  ipcMain.handle('localdb:getGraphLayout', function(e, layoutId) {
    return localDbService.getGraphLayout(layoutId);
  });
  ipcMain.handle('localdb:updateGraphLayout', function(e, input) {
    return localDbService.updateGraphLayout(input);
  });
  ipcMain.handle('filecache:init', function() {
    return fileCacheService.ensureReady();
  });
  ipcMain.handle('filecache:health', function() {
    return fileCacheService.healthCheck();
  });
  ipcMain.handle('cloud:setSession', function(e, input) {
    return setCloudSessionState(input);
  });
  ipcMain.handle('cloud:clearSession', function() {
    return clearCloudSessionState();
  });
  ipcMain.handle('filecache:getCloudAttachmentLocalUrl', async function(e, input) {
    const cached = await ensureCloudAttachmentCached(input);
    return cached.url;
  });
  ipcMain.handle('filecache:openCloudAttachment', async function(e, input) {
    const cached = await ensureCloudAttachmentCached(input);
    const error = await shell.openPath(cached.absolutePath);
    return error === '';
  });
  ipcMain.handle('filecache:showCloudAttachmentInFolder', async function(e, input) {
    const cached = await ensureCloudAttachmentCached(input);
    shell.showItemInFolder(cached.absolutePath);
    return true;
  });
  ipcMain.handle('attachment:health', function() {
    return attachmentUploadService.healthCheck();
  });
  ipcMain.handle('import:health', function() {
    return importService.healthCheck();
  });
  ipcMain.handle('import:startImportJob', function(e, input) {
    return importService.startImportJob(input);
  });
  ipcMain.handle('import:getImportJob', function(e, importJobId) {
    return importService.getImportJob(importJobId);
  });
  ipcMain.handle('sync-debug:health', function() {
    return {
      ready: true,
      stage: 'skeleton',
      localdb: localDbService.healthCheck(),
      filecache: fileCacheService.healthCheck(),
    };
  });
  ipcMain.handle('sync-debug:getSnapshot', function(e, workspaceId) {
    return {
      health: {
        ready: true,
        stage: 'mvp',
        localdb: localDbService.healthCheck(),
        filecache: fileCacheService.healthCheck(),
      },
      sync: localDbService.getSyncDebugSnapshot(workspaceId),
    };
  });
  ipcMain.handle('sync-debug:listOutboxItems', function(e, input) {
    return localDbService.listSyncDebugOutboxItems(input);
  });
  ipcMain.handle('sync-debug:listConflicts', function(e, input) {
    return localDbService.listSyncDebugConflicts(input);
  });
  ipcMain.handle('sync-debug:listAttachmentJobs', function(e, input) {
    return localDbService.listSyncDebugAttachmentJobs(input);
  });
  ipcMain.handle('sync-debug:listImportJobs', function(e, input) {
    return localDbService.listSyncDebugImportJobs(input);
  });
  ipcMain.handle('sync-debug:retryAttachmentJob', function(e, input) {
    const job = localDbService.retrySyncDebugAttachmentJob(input);
    void attachmentUploadService.processPendingJobs();
    return job;
  });
  ipcMain.handle('sync-debug:resumeImportJob', function(e, input) {
    const job = localDbService.resumeSyncDebugImportJob(input);
    void importService.processPendingJobs();
    return job;
  });
  ipcMain.handle('sync-debug:retryOutboxItem', function(e, input) {
    return localDbService.retrySyncDebugOutboxItem(input);
  });
  ipcMain.handle('sync-debug:resolveConflictUseLocal', function(e, input) {
    return localDbService.resolveSyncDebugConflictUseLocal(input);
  });

  // ----- App handlers -----
  ipcMain.handle('app:getFileInfo', function(e, targetPath) {
    const absolutePath = nodePath.resolve(String(targetPath || ''));
    if (!absolutePath || !nodePath.isAbsolute(absolutePath) || !nodeFs.existsSync(absolutePath)) {
      throw new Error('文件不存在');
    }
    const fileStat = nodeFs.statSync(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error('目标不是文件');
    }
    return {
      fileName: nodePath.basename(absolutePath),
      sizeBytes: fileStat.size,
      mimeType: detectMimeTypeFromFileName(absolutePath),
    };
  });
  ipcMain.handle('app:navigateHome', function() {
    if (win && !win.isDestroyed()) {
      win.setResizable(true);
      win.setMinimumSize(900, 600);
      win.setMaximumSize(0, 0);

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
      LogService.write({
        level: 'ERROR', module: 'Main', action: 'app:enterWorkDir',
        message: '进入工作目录失败', params: { workDir, ok: false, error: err && err.message ? err.message : String(err) },
      });
      return { ok: false, error: err && err.message ? err.message : '工作目录无效' };
    }
    var ok = LogService.enterWorkDir(normalizedWorkDir);
    if (win && !win.isDestroyed()) {
      win.setResizable(true);
      win.setMinimumSize(900, 600);
      win.setMaximumSize(0, 0);

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
    LogService.write({
      level: ok ? 'INFO' : 'ERROR', module: 'Main', action: 'app:enterWorkDir',
      message: ok ? '进入工作目录' : '进入工作目录失败', params: { workDir: normalizedWorkDir, ok },
    });
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
  ipcMain.handle('app:openPath', async function(e, rawPath) {
    var target = sanitizeLocalPath(rawPath);
    if (!target || !nodeFs.existsSync(target)) {
      throw new Error('目标路径不存在，无法打开。');
    }
    var error = await shell.openPath(target);
    if (error) {
      throw new Error(error);
    }
    return true;
  });
  ipcMain.handle('app:showItemInFolder', async function(e, rawPath) {
    var target = sanitizeLocalPath(rawPath);
    if (!target || !nodeFs.existsSync(target)) {
      throw new Error('目标路径不存在，无法定位。');
    }
    var stat = nodeFs.statSync(target);
    if (stat.isDirectory()) {
      var error = await shell.openPath(target);
      if (error) {
        throw new Error(error);
      }
      return true;
    }
    shell.showItemInFolder(target);
    return true;
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

  // ----- Log handlers -----
  ipcMain.handle('log:write', function(e, entry) { return LogService.write(entry); });
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
    const guardResult = await confirmAndFlushBeforeExit(reason || 'quit-app');
    if (!guardResult.ok) {
      return guardResult;
    }
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
  const rendererIndexPath = nodePath.join(DIST_RENDERER_DIR, 'index.html');

  win = new BrowserWindow({
    width: HOME_WINDOW_WIDTH, height: HOME_WINDOW_HEIGHT,
    useContentSize: true,
    frame: false,
    center: true,
    show: false,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    title: 'TopoMind',
    icon: nodePath.join(APP_PATH, 'build', 'icon.png'),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  if (IS_DEV) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(rendererIndexPath);
  }
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Browser Console] ${level} ${message} (${sourceId}:${line})`);
  });
  // Open the DevTools.
  // win.webContents.openDevTools()
  win.webContents.on('did-fail-load', function(e, errorCode, errorDescription, validatedURL, isMainFrame) {
    console.error('[window:did-fail-load]', errorCode, errorDescription, validatedURL, isMainFrame);
  });
  win.webContents.on('did-finish-load', function() {
    const currentUrl = win && !win.isDestroyed() ? win.webContents.getURL() : '';
    if (IS_DEV) console.log('[window:did-finish-load]', currentUrl);
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
    console.error('[window:render-process-gone]', JSON.stringify(details));
  });
  win.on('unresponsive', function() {
    console.error('[window:unresponsive]');
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
    win = null;
  });
}

function toggleMonitorWindow() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:menu-action', 'open-monitor');
  }
}

function resetMainWindowToSetup() {
  if (!win || win.isDestroyed()) return;

  win.setResizable(true);
  win.setMinimumSize(0, 0);
  win.setMaximumSize(0, 0);
  
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

// App ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { standard: true, supportFetchAPI: true, secure: true, stream: true } }
]);

app.whenReady().then(function() {
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

  fileCacheService.ensureReady();
  localDbService.init();
  void attachmentUploadService.processPendingJobs();
  void importService.processPendingJobs();
  registerIPC();
  buildMenu(true);
  createWindow();
  app.on('activate', function() { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', function() { if (process.platform !== 'darwin') app.quit(); });

app.on('before-quit', async function(event) {
  if (_isQuittingAfterFlush) {
    localDbService.close();
    return;
  }

  event.preventDefault();
  await requestSafeQuit('quit-app');
});

