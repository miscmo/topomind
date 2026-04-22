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

// 从 app.getAppPath() 推导 dist-electron/ 路径（兼容 dev 和 production）
const DIST_ELECTRON_DIR = nodePath.join(app.getAppPath(), 'dist-electron');

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
function registerIPC() {
  // ----- File system handlers -----
  ipcMain.handle('fs:init', function() {
    var result = fileService.initWorkDir();
    LogService.write({
      level: 'INFO', module: 'Main', action: 'fs:init',
      message: 'fs:init 调用', params: { valid: result.valid, error: result.error || null },
    });
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
    var absPath = nodePath.isAbsolute(dirPath) ? dirPath : nodePath.join(fileService.getRootDir(), dirPath);
    var rootDir = nodePath.normalize(fileService.getRootDir());
    if (!nodePath.normalize(absPath).startsWith(rootDir)) return;
    if (nodeFs.existsSync(absPath)) shell.openPath(absPath);
  });
  ipcMain.handle('fs:countChildren', function(e, dirPath) {
    var d = dirPath ? nodePath.join(fileService.getRootDir(), dirPath) : fileService.getRootDir();
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
  ipcMain.handle('log:write', function(e, entry) { LogService.write(entry); return true; });
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
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'TopoMind',
    webPreferences: {
      preload: nodePath.join(DIST_ELECTRON_DIR, 'preload.mjs'),
      nodeIntegration: false, contextIsolation: true,
    },
  });
  LogService.write({
    level: 'INFO',
    module: 'Main',
    action: 'window:created',
    message: '主窗口已创建',
    params: { width: 1400, height: 900, devServer: !!process.env.VITE_DEV_SERVER_URL },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(nodePath.join(DIST_ELECTRON_DIR, '..', 'dist', 'index.html'));
  }
  win.webContents.on('console-message', function(e, level, msg, line, src) {
    if (process.env.VITE_DEV_SERVER_URL) console.log('[renderer]', msg);
  });
  win.on('closed', function() {
    LogService.write({
      level: 'INFO', module: 'Main', action: 'window:closed',
      message: '主窗口已关闭',
    });
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
      preload: nodePath.join(DIST_ELECTRON_DIR, 'preload.mjs'),
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

// App ready
app.whenReady().then(function() {
  registerIPC();
  LogService.init(app.getPath('userData'));
  LogService.write({
    level: 'INFO',
    module: 'Main',
    action: 'app:ready',
    message: 'Electron 应用已就绪，开始创建主窗口',
    params: { profile: process.env.TOPOMIND_PROFILE || 'prod', platform: process.platform },
  });
  buildMenu();
  createWindow();
  LogService.write({
    level: 'INFO',
    module: 'Main',
    action: 'app:startup-complete',
    message: 'TopoMind 应用启动完成',
    params: { version: app.getVersion(), userData: app.getPath('userData') },
  });
  app.on('activate', function() { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', function() { if (process.platform !== 'darwin') app.quit(); });

// Notify renderer before quit so it can save state
app.on('before-quit', function() {
  LogService.write({
    level: 'INFO', module: 'Main', action: 'app:before-quit',
    message: '应用即将退出，开始保存状态',
  });
  if (win && !win.isDestroyed()) {
    win.webContents.send('save:before-quit');
  }
  if (monitorWin && !monitorWin.isDestroyed()) {
    monitorWin.destroy();
  }
});
