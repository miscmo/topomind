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
const CLOSE_GUARD_REQUEST_TIMEOUT_MS = 5000;
let closeGuardRequestSeq = 0;
const pendingCloseGuardRequests = new Map();

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
  } catch (e) {
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
  ipcMain.handle('fs:createCardDir', function(e, rootDir, parentPath, cardName) { return fileService.createCardDir(requireActiveWorkDir(rootDir), parentPath, cardName); });
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

  ipcMain.handle('fs:listAllTrashItems', function(e, rootDir) { return fileService.listAllTrashItems(requireActiveWorkDir(rootDir)); });
  ipcMain.handle('fs:restoreGlobalTrashItem', function(e, rootDir, category, trashName) { return fileService.restoreGlobalTrashItem(requireActiveWorkDir(rootDir), category, trashName); });
  ipcMain.handle('fs:clearAllTrashItems', function(e, rootDir) { return fileService.clearAllTrashItems(requireActiveWorkDir(rootDir)); });

  // ----- App handlers -----
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
    width: SETUP_WINDOW_WIDTH, height: SETUP_WINDOW_HEIGHT,
    minWidth: SETUP_WINDOW_WIDTH, minHeight: SETUP_WINDOW_HEIGHT,
    maxWidth: SETUP_WINDOW_WIDTH, maxHeight: SETUP_WINDOW_HEIGHT,
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
  win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    console.log(`[Browser Console] ${level} ${message} (${sourceId}:${lineNumber})`);
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

function resetMainWindowToSetup() {
  if (!win || win.isDestroyed()) return;
  
  if (win.isMaximized()) {
    win.unmaximize();
  }
  
  win.setResizable(false);
  win.setMinimumSize(SETUP_WINDOW_WIDTH, SETUP_WINDOW_HEIGHT);
  win.setMaximumSize(SETUP_WINDOW_WIDTH, SETUP_WINDOW_HEIGHT);
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

  registerIPC();
  buildMenu(true);
  createWindow();
  app.on('activate', function() { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', function() { if (process.platform !== 'darwin') app.quit(); });

app.on('before-quit', async function(event) {
  if (_isQuittingAfterFlush) {
    return;
  }

  event.preventDefault();
  await requestSafeQuit('quit-app');
});
