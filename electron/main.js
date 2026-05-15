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
import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import nodePath from 'path';
import nodeFs from 'fs';
import { fileService } from './file-service.js';
import { dialogService } from './dialog-service.js';
import LogService from './log-service.js';

// 兼容生产运行以及 dev 模式。
const APP_PATH = app.getAppPath();
const MAIN_SCRIPT_DIR = process.argv[1] ? nodePath.dirname(nodePath.resolve(process.argv[1])) : APP_PATH;
const DIST_ELECTRON_DIR = nodeFs.existsSync(nodePath.join(APP_PATH, 'dist-electron'))
  ? nodePath.join(APP_PATH, 'dist-electron')
  : MAIN_SCRIPT_DIR;
const DIST_RENDERER_DIR = [
  nodePath.join(APP_PATH, 'dist'),
  nodePath.join(process.cwd(), 'dist'),
  nodePath.join(nodePath.dirname(DIST_ELECTRON_DIR), 'dist'),
].find((dir) => nodeFs.existsSync(nodePath.join(dir, 'index.html')))
  || nodePath.join(APP_PATH, 'dist');
const SETUP_WINDOW_WIDTH = 380;
const SETUP_WINDOW_HEIGHT = 252;
const HOME_WINDOW_WIDTH = 1400;
const HOME_WINDOW_HEIGHT = 900;
const WINDOW_BACKGROUND_COLOR = '#ffffff';
const IS_DEV = !!process.env.VITE_DEV_SERVER_URL;

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
  ipcMain.handle('fs:listKBs', function(e, rootDir) { return fileService.listKBs(rootDir); });
  ipcMain.handle('fs:readCardChildren', function(e, rootDir, p) { return fileService.readCardChildren(rootDir, p); });
  ipcMain.handle('fs:createKbsDir', function(e, rootDir, p) { return fileService.createKbsDir(rootDir, p); });
  ipcMain.handle('fs:createCardDir', function(e, rootDir, parentPath, cardName) { return fileService.createCardDir(rootDir, parentPath, cardName); });
  ipcMain.handle('fs:deleteKbsDir', function(e, rootDir, p) { fileService.deleteKbsDir(rootDir, p); });
  ipcMain.handle('fs:renameKB', function(e, rootDir, p, n) { return fileService.renameKB(rootDir, p, n); });
  ipcMain.handle('fs:readGraphMeta', function(e, rootDir, p) { return fileService.readGraphMeta(rootDir, p); });
  ipcMain.handle('fs:writeGraphMeta', function(e, rootDir, p, m) { fileService.writeGraphMeta(rootDir, p, m); });
  ipcMain.handle('fs:readFile', function(e, rootDir, p) { return fileService.readFile(rootDir, p); });
  ipcMain.handle('fs:writeFile', function(e, rootDir, p, c) { fileService.writeFile(rootDir, p, c); });
  ipcMain.handle('fs:writeAttachmentBase64', function(e, rootDir, cardPath, fileName, mimeType, base64) {
    return fileService.writeAttachmentBase64(rootDir, cardPath, fileName, mimeType, base64);
  });
  ipcMain.handle('fs:downloadAttachment', function(e, rootDir, cardPath, url) {
    return fileService.downloadAttachment(rootDir, cardPath, url);
  });
  ipcMain.handle('fs:readAttachmentDataUrl', function(e, rootDir, cardPath, attachmentRef) {
    return fileService.readAttachmentDataUrl(rootDir, cardPath, attachmentRef);
  });
  ipcMain.handle('fs:readAppConfig', function(e, rootDir) {
    return fileService.readAppConfig(rootDir);
  });
  ipcMain.handle('fs:writeAppConfig', function(e, rootDir, content) {
    return fileService.writeAppConfig(rootDir, content);
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
    var result = fileService.importKB(rootDir, sourcePath);
    LogService.write({
      level: 'INFO', module: 'Main', action: 'fs:importKB',
      message: '知识库导入成功', params: { sourcePath, importedPath: result },
    });
    return result;
  });

  // ----- App handlers -----
  ipcMain.handle('app:navigateHome', function() {
    if (win && !win.isDestroyed()) {
      win.setResizable(true);
      win.setMinimumSize(900, 600);
      win.setMaximumSize(0, 0);
      win.setContentSize(HOME_WINDOW_WIDTH, HOME_WINDOW_HEIGHT);
      buildMenu(false);
    }
  });
  ipcMain.handle('app:enterWorkDir', function(e, workDir) {
    var ok = LogService.enterWorkDir(workDir);
    if (win && !win.isDestroyed()) {
      win.setResizable(true);
      win.setMinimumSize(900, 600);
      win.setMaximumSize(0, 0);
      win.setContentSize(HOME_WINDOW_WIDTH, HOME_WINDOW_HEIGHT);
      buildMenu(false);
    }
    LogService.write({
      level: ok ? 'INFO' : 'ERROR', module: 'Main', action: 'app:enterWorkDir',
      message: ok ? '进入工作目录' : '进入工作目录失败', params: { workDir, ok },
    });
    return { ok };
  });
  ipcMain.handle('app:switchWorkDir', async function() {
    if (!win || win.isDestroyed()) return { ok: false, cancelled: true };

    const guardResult = await confirmAndFlushBeforeExit('switch-workdir');
    if (!guardResult.ok) {
      return { ok: false, cancelled: !!guardResult.cancelled };
    }

    LogService.clear();
    resetMainWindowToSetup();
    return { ok: true };
  });
  ipcMain.handle('app:openExternal', function(e, url) {
    if (typeof url !== 'string') return false;
    var target = url.trim();
    if (!/^https?:\/\//i.test(target)) return false;
    shell.openExternal(target);
    return true;
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

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-software-rasterizer');

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
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    title: 'TopoMind',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false, contextIsolation: true,
    },
  });
  if (IS_DEV) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(rendererIndexPath);
  }
  win.webContents.on('console-message', function(e, level, msg, line, src) {
    if (IS_DEV) console.log('[renderer]', msg, src || '', line || '');
  });
  win.webContents.on('did-fail-load', function(e, errorCode, errorDescription, validatedURL, isMainFrame) {
    console.error('[window:did-fail-load]', errorCode, errorDescription, validatedURL, isMainFrame);
  });
  win.webContents.on('did-finish-load', function() {
    const currentUrl = win && !win.isDestroyed() ? win.webContents.getURL() : '';
    if (IS_DEV) console.log('[window:did-finish-load]', currentUrl);
  });
  win.webContents.on('render-process-gone', function(e, details) {
    console.error('[window:render-process-gone]', JSON.stringify(details));
  });
  win.on('unresponsive', function() {
    console.error('[window:unresponsive]');
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
  win.setResizable(false);
  win.setMinimumSize(SETUP_WINDOW_WIDTH, SETUP_WINDOW_HEIGHT);
  win.setMaximumSize(SETUP_WINDOW_WIDTH, SETUP_WINDOW_HEIGHT);
  win.setContentSize(SETUP_WINDOW_WIDTH, SETUP_WINDOW_HEIGHT);
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
app.whenReady().then(function() {
  registerIPC();
  buildMenu(true);
  createWindow();
  app.on('activate', function() { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', function() { if (process.platform !== 'darwin') app.quit(); });

// Guard against re-entering the quit flow after a successful flush.
let _isQuittingAfterFlush = false;

app.on('before-quit', async function(event) {
  if (_isQuittingAfterFlush) {
    return;
  }

  event.preventDefault();
  const guardResult = await confirmAndFlushBeforeExit('quit-app');
  if (!guardResult.ok) {
    return;
  }

  _isQuittingAfterFlush = true;
  app.quit();
});
