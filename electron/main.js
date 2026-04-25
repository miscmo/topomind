/**
 * Electron 主进程入口
 *
 * 职责：
 * 1. 注册所有 IPC 通道（文件系统、Git、认证、日志、应用）
 * 2. 管理窗口生命周期（主窗口、日志监控窗口）
 * 3. 构建应用菜单
 *
 * 所有业务逻辑委托给独立模块：
 *   - file-service.js   — 文件系统操作
 *   - git-service.js    — Git 操作
 *   - git-auth.js       — Git 认证（Token / SSH）
 *   - log-service.js     — 日志服务
 */
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } from 'electron';
import nodePath from 'path';
import nodeFs from 'fs';
import { fileService } from './file-service.js';
import { gitService } from './git-service.js';
import { gitAuth } from './git-auth.js';
import LogService from './log-service.js';

// 兼容生产运行、Playwright 直接启动 dist-electron/main.js、以及 dev 模式。
const APP_PATH = app.getAppPath();
const MAIN_SCRIPT_DIR = process.argv[1] ? nodePath.dirname(nodePath.resolve(process.argv[1])) : APP_PATH;
const DIST_ELECTRON_DIR = nodeFs.existsSync(nodePath.join(APP_PATH, 'dist-electron'))
  ? nodePath.join(APP_PATH, 'dist-electron')
  : MAIN_SCRIPT_DIR;
const DIST_RENDERER_DIR = nodeFs.existsSync(nodePath.join(APP_PATH, 'dist'))
  ? nodePath.join(APP_PATH, 'dist')
  : nodePath.join(nodePath.dirname(DIST_ELECTRON_DIR), 'dist');

// E2E 测试：尝试从工作目录根目录的 .env 文件加载环境变量。
// global-setup.ts 会将 TOPOMIND_E2E_WORKDIR 写入项目根目录的 .env。
// 注意：此代码在 import { fileService } 之后执行，
// 如果 vite-plugin-electron 已经通过 spawn options 传递了 env var，
// 则此处的 .env 加载会跳过（因为 process.env[key] 已存在）。
const E2E_ENV_FILE = nodePath.join(process.cwd(), '.env');
if (nodeFs.existsSync(E2E_ENV_FILE)) {
  for (const line of nodeFs.readFileSync(E2E_ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (key && !Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = val;
    }
  }
}

// ============================================================
// IPC HANDLERS
// ============================================================

/**
 * 将知识库相对路径解析为工作目录下的绝对路径。
 * 未传入路径时返回当前工作目录本身。
 *
 * @param {string} [kbPath] 知识库相对路径
 * @returns {string} 知识库绝对路径
 */
function absKbPath(kbPath) {
  var root = fileService.getRootDir();
  if (!kbPath) return root;
  return nodePath.resolve(root, kbPath);
}

/**
 * 注册渲染进程与主进程之间的所有 IPC 通道。
 */
async function askRendererToFlushAllDirtyTabs() {
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

  let dirtyState;
  try {
    dirtyState = await win.webContents.executeJavaScript(`(() => {
      const guard = window.__topomindCloseGuard;
      return guard ? guard.getDirtyState() : { hasDirty: false, dirtyTabIds: [] };
    })()`);
  } catch (e) {
    dirtyState = { hasDirty: false, dirtyTabIds: [] };
  }

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

  const flushResult = await askRendererToFlushAllDirtyTabs();
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
  ipcMain.handle('fs:init', function() {
    var result = fileService.initWorkDir();
    if (result && result.valid) {
      LogService.init(fileService.getRootDir());
      LogService.write({
        level: 'INFO', module: 'Main', action: 'fs:init',
        message: 'fs:init 调用', params: { valid: result.valid, error: result.error || null },
      });
    }
    return result;
  });
  ipcMain.handle('fs:listChildren', function(e, p) { return fileService.listChildren(p); });
  ipcMain.handle('fs:mkDir', function(e, p, m) {
    var abs = fileService.mkDir(p, m);
    return nodePath.relative(fileService.getRootDir(), abs);
  });
  ipcMain.handle('fs:rmDir', function(e, p) { fileService.rmDir(p); });
  ipcMain.handle('fs:saveKBOrder', function(e, p, o) { fileService.saveKBOrder(p, o); });
  ipcMain.handle('fs:getKBCover', function(e, p) { return fileService.getKBCover(p); });
  ipcMain.handle('fs:saveKBCover', function(e, p, c) { fileService.saveKBCover(p, c); });
  ipcMain.handle('fs:renameKB', function(e, p, n) { return fileService.renameKB(p, n); });
  ipcMain.handle('fs:readGraphMeta', function(e, p) { return fileService.readGraphMeta(p); });
  ipcMain.handle('fs:writeGraphMeta', function(e, p, m) { fileService.writeGraphMeta(p, m); });
  ipcMain.handle('fs:ensureCardDir', function(e, p) { fileService.ensureCardDir(p); });
  ipcMain.handle('fs:getDir', function(e, p) { return fileService.getDir(p); });
  ipcMain.handle('fs:updateCardMeta', function(e, p, n) { return fileService.updateCardMeta(p, n); });
  ipcMain.handle('fs:readFile', function(e, p) { return fileService.readFile(p); });
  ipcMain.handle('fs:writeFile', function(e, p, c) { fileService.writeFile(p, c); });
  ipcMain.handle('fs:deleteFile', function(e, p) { fileService.deleteFile(p); });
  ipcMain.handle('fs:writeBlobFile', function(e, p, b) { fileService.writeBlobFile(p, b); });
  ipcMain.handle('fs:readBlobFile', function(e, p) { return fileService.readBlobFile(p); });
  ipcMain.handle('fs:clearAll', function() { fileService.clearAll(); });
  ipcMain.handle('fs:openInFinder', function(e, dirPath) {
    var kbRoot = nodePath.join(fileService.getRootDir(), 'kbs');
    var absPath = nodePath.isAbsolute(dirPath) ? dirPath : nodePath.join(kbRoot, dirPath);
    var rootDir = nodePath.normalize(fileService.getRootDir());
    if (!nodePath.normalize(absPath).startsWith(rootDir)) return;
    if (nodeFs.existsSync(absPath)) shell.openPath(absPath);
  });
  ipcMain.handle('fs:countChildren', function(e, dirPath) {
    var kbRoot = nodePath.join(fileService.getRootDir(), 'kbs');
    var d = dirPath ? nodePath.join(kbRoot, dirPath) : kbRoot;
    if (!nodeFs.existsSync(d)) return 0;
    try {
      return nodeFs.readdirSync(d, { withFileTypes: true })
        .filter(function(e) { return e.isDirectory() && !e.name.startsWith('.') && e.name !== 'images'; }).length;
    } catch(err) { return 0; }
  });
  ipcMain.handle('fs:getRootDir', function() {
    var root = fileService.getRootDir();
    LogService.write({
      level: 'DEBUG', module: 'Main', action: 'fs:getRootDir',
      message: '获取根目录', params: { rootDir: root },
    });
    return root;
  });
  ipcMain.handle('fs:readAppConfig', function() {
    return fileService.readAppConfig();
  });
  ipcMain.handle('fs:writeAppConfig', function(e, content) {
    return fileService.writeAppConfig(content);
  });
  ipcMain.handle('fs:getLastOpenedKB', function() {
    var kb = fileService.getLastOpenedKB();
    LogService.write({
      level: 'DEBUG', module: 'Main', action: 'fs:getLastOpenedKB',
      message: '获取上次打开的知识库', params: { lastOpenedKB: kb },
    });
    return kb;
  });
  ipcMain.handle('fs:setLastOpenedKB', function(e, kbPath) {
    fileService.setLastOpenedKB(kbPath);
    LogService.write({
      level: 'INFO', module: 'Main', action: 'fs:setLastOpenedKB',
      message: '设置上次打开的知识库', params: { kbPath },
    });
  });
  ipcMain.handle('fs:setWorkDir', function(e, dirPath) {
    var result = fileService.setWorkDir(dirPath);
    if (result.valid) {
      LogService.clear();
      LogService.init(fileService.getRootDir());
    }
    LogService.write({
      level: result.valid ? 'INFO' : 'ERROR', module: 'Main', action: 'fs:setWorkDir',
      message: result.valid ? '工作目录已切换' : '工作目录切换失败', params: { dirPath, valid: result.valid, error: result.error || null },
    });
    return result;
  });
  ipcMain.handle('fs:selectWorkDirCandidate', function() {
    var result = fileService.selectWorkDirCandidate();
    LogService.write({
      level: 'INFO', module: 'Main', action: 'fs:selectWorkDirCandidate',
      message: '文件对话框已关闭', params: { valid: result.valid, path: result.nodePath || null, error: result.error || null },
    });
    return result;
  });
  ipcMain.handle('fs:createWorkDir', function(e, dirPath) {
    var result = fileService.createWorkDir(dirPath);
    if (result.valid) {
      LogService.clear();
      LogService.init(fileService.getRootDir());
    }
    LogService.write({
      level: result.valid ? 'INFO' : 'ERROR', module: 'Main', action: 'fs:createWorkDir',
      message: result.valid ? '工作目录创建成功' : '工作目录创建失败', params: { dirPath, valid: result.valid, error: result.error || null },
    });
    return result;
  });
  ipcMain.handle('fs:importKB', function(e, sourcePath) {
    var result = fileService.importKB(sourcePath);
    LogService.write({
      level: result.valid ? 'INFO' : 'ERROR', module: 'Main', action: 'fs:importKB',
      message: result.valid ? '知识库导入成功' : '知识库导入失败', params: { sourcePath, valid: result.valid, error: result.error || null },
    });
    return result;
  });

  // ----- App handlers -----
  ipcMain.handle('app:navigateHome', function() {
    if (win && !win.isDestroyed()) {
      win.setResizable(true);
      win.setMinimumSize(900, 600);
      win.setMaximumSize(0, 0);
      win.setBounds({ width: 1400, height: 900 });
      buildMenu(false);
      win.webContents.send('app:navigate-home');
    }
  });
  ipcMain.handle('app:getE2EState', function() {
    return {
      rootDir: fileService.getRootDir(),
      valid: !!fileService.getRootDir(),
      workDirConfigured: !!process.env.TOPOMIND_E2E_WORKDIR,
      windowReady: !!(win && !win.isDestroyed()),
      ipcRegistered: true,
    };
  });
  ipcMain.handle('app:switchWorkDir', async function() {
    if (!win || win.isDestroyed()) return { ok: false, cancelled: true };

    const guardResult = await confirmAndFlushBeforeExit('switch-workdir');
    if (!guardResult.ok) {
      return { ok: false, cancelled: !!guardResult.cancelled };
    }

    if (monitorWin && !monitorWin.isDestroyed()) {
      monitorWin.destroy();
      monitorWin = null;
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

  // ----- Synchronous save handler -----
  ipcMain.on('save:layout', function(event, dirPath, meta) {
    try {
      fileService.writeGraphMeta(dirPath, meta);
      event.returnValue = true;
    } catch (e) {
      event.returnValue = false;
    }
  });

  // ----- Git handlers -----
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

  // ----- Git auth handlers -----
  ipcMain.handle('git:auth:setToken', function(e, kbPath, token) { return gitAuth.saveToken(kbPath, token); });
  ipcMain.handle('git:auth:getSSHKey', function() { return gitAuth.getSSHPublicKey(); });
  ipcMain.handle('git:auth:setAuthType', function(e, kbPath, authType) { return gitAuth.setAuthType(kbPath, authType); });
  ipcMain.handle('git:auth:getAuthType', function(e, kbPath) { return gitAuth.getAuthType(kbPath); });

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
var monitorWin = null;

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-software-rasterizer');

if (process.env.TOPOMIND_PROFILE && process.env.TOPOMIND_PROFILE !== 'prod') {
  app.setName('TopoMind-' + process.env.TOPOMIND_PROFILE);
}

function createWindow() {
  const preloadPath = nodePath.join(DIST_ELECTRON_DIR, 'preload.js');
  const rendererIndexPath = nodePath.join(DIST_RENDERER_DIR, 'index.html');

  win = new BrowserWindow({
    width: 520, height: 420, minWidth: 520, minHeight: 420, maxWidth: 520, maxHeight: 420,
    title: 'TopoMind',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false, contextIsolation: true,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(rendererIndexPath);
  }
  win.webContents.on('console-message', function(e, level, msg, line, src) {
    console.log('[renderer]', msg, src || '', line || '');
  });
  win.webContents.on('did-fail-load', function(e, errorCode, errorDescription, validatedURL, isMainFrame) {
    console.error('[window:did-fail-load]', errorCode, errorDescription, validatedURL, isMainFrame);
  });
  win.webContents.on('did-finish-load', function() {
    const currentUrl = win && !win.isDestroyed() ? win.webContents.getURL() : '';
    console.log('[window:did-finish-load]', currentUrl);
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

function createMonitorWindow() {
  LogService.write({
    level: 'INFO', module: 'Main', action: 'monitor:will-open',
    message: '即将打开日志监控窗口',
  });
  if (monitorWin && !monitorWin.isDestroyed()) {
    monitorWin.focus();
    LogService.write({
      level: 'INFO', module: 'Main', action: 'monitor:focus-existing',
      message: '聚焦已有监控窗口',
    });
    return;
  }
  monitorWin = new BrowserWindow({
    width: 1200, height: 700, minWidth: 800, minHeight: 500,
    title: '日志性能监控 - TopoMind',
    webPreferences: {
      preload: nodePath.join(DIST_ELECTRON_DIR, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
  });
  var monitorUrl = process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL + '#/monitor'
    : 'file://' + nodePath.join(DIST_ELECTRON_DIR, '..', 'dist', 'index.html') + '#/monitor';
  monitorWin.loadURL(monitorUrl);
  LogService.write({
    level: 'INFO', module: 'Main', action: 'monitor:created',
    message: '监控窗口已创建', params: { url: monitorUrl },
  });
  monitorWin.on('closed', function() {
    LogService.write({
      level: 'INFO', module: 'Main', action: 'monitor:closed',
      message: '监控窗口已关闭',
    });
    monitorWin = null;
  });
}

function toggleMonitorWindow() {
  if (monitorWin && !monitorWin.isDestroyed()) {
    LogService.write({
      level: 'INFO', module: 'Main', action: 'monitor:close-toggled',
      message: '关闭监控窗口',
    });
    monitorWin.close();
    monitorWin = null;
  } else {
    LogService.write({
      level: 'INFO', module: 'Main', action: 'monitor:open-toggled',
      message: '创建监控窗口',
    });
    createMonitorWindow();
  }
}

function resetMainWindowToSetup() {
  if (!win || win.isDestroyed()) return;
  win.setResizable(false);
  win.setMinimumSize(520, 420);
  win.setMaximumSize(520, 420);
  win.setBounds({ width: 520, height: 420 });
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

// Notify renderer before quit so it can save state
let _isQuittingAfterFlush = false;

app.on('before-quit', async function(event) {
  if (_isQuittingAfterFlush) {
    if (monitorWin && !monitorWin.isDestroyed()) {
      monitorWin.destroy();
    }
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
