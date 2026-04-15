/**
 * Electron 主进程
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('./file-service');
const nfs = require('fs');
const gitIPC = require('./git-ipc');

let win = null;

// 禁用 GPU shader cache，避免 Windows 多进程争抢缓存目录导致的 ERROR
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-software-rasterizer');

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'TopoMind',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    }
  });
  // 开发模式加载 Vite dev server，生产模式加载打包文件
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  // 转发渲染进程日志到 stdout
  win.webContents.on('console-message', function(e, level, msg, line, src) {
    console.log('[renderer]', msg);
  });
}

// ===== IPC 注册（与 file-service 一一对应） =====
function registerIPC() {
  ipcMain.handle('fs:init',           function()       { fs.ensureDir(fs.getRootDir()); return fs.getRootDir(); });
  ipcMain.handle('fs:listChildren',   function(e, p)   { return fs.listChildren(p); });
  ipcMain.handle('fs:mkDir',          function(e, p, m){
    var abs = fs.mkDir(p, m);
    var rel = path.relative(fs.getRootDir(), abs);
    return rel;
  });
  ipcMain.handle('fs:rmDir',          function(e, p)   { fs.rmDir(p); });
  ipcMain.handle('fs:readMeta',       function(e, p)   { return fs.readMeta(p); });
  ipcMain.handle('fs:writeMeta',      function(e, p, m){ fs.writeMeta(p, m); });
  ipcMain.handle('fs:readGraphMeta',   function(e, p)   { return fs.readGraphMeta(p); });
  ipcMain.handle('fs:writeGraphMeta',  function(e, p, m){ fs.writeGraphMeta(p, m); });
  ipcMain.handle('fs:getDir',         function(e, p)   { return fs.getDir(p); });
  ipcMain.handle('fs:readFile',       function(e, p)   { return fs.readFile(p); });
  ipcMain.handle('fs:writeFile',      function(e, p, c){ fs.writeFile(p, c); });
  ipcMain.handle('fs:deleteFile',     function(e, p)   { fs.deleteFile(p); });
  ipcMain.handle('fs:writeBlobFile',  function(e, p, b){ fs.writeBlobFile(p, b); });
  ipcMain.handle('fs:readBlobFile',   function(e, p)   { return fs.readBlobFile(p); });
  ipcMain.handle('fs:clearAll',       function()       { fs.clearAll(); });
  ipcMain.handle('fs:openInFinder', function(e, dirPath) {
    var absPath = dirPath.startsWith('/') ? dirPath : path.join(fs.getRootDir(), dirPath);
    if (nfs.existsSync(absPath)) shell.openPath(absPath);
  });
  ipcMain.handle('fs:countChildren', function(e, dirPath) {
    var d = dirPath ? path.join(fs.getRootDir(), dirPath) : fs.getRootDir();
    if (!nfs.existsSync(d)) return 0;
    try {
      return nfs.readdirSync(d, { withFileTypes: true })
        .filter(function(e) { return e.isDirectory() && !e.name.startsWith('.') && e.name !== 'images'; }).length;
    } catch(err) { return 0; }
  });
  ipcMain.handle('fs:getRootDir', function() { return fs.getRootDir(); });
  ipcMain.handle('fs:getLastOpenedKB', function() { return fs.getLastOpenedKB(); });
  ipcMain.handle('fs:setLastOpenedKB', function(e, kbPath) { fs.setLastOpenedKB(kbPath); });
  ipcMain.handle('fs:selectExistingKB', function() { return fs.selectExistingKB(); });
  ipcMain.handle('fs:importKB', function(e, sourcePath) { return fs.importKB(sourcePath); });

  ipcMain.handle('app:openExternal', function(e, url) {
    if (typeof url !== 'string') return false;
    var target = url.trim();
    if (!/^https?:\/\//i.test(target)) return false;
    shell.openExternal(target);
    return true;
  });

  // ===== 同步保存（beforeunload 时使用）=====
  ipcMain.on('save:layout', function(event, dirPath, meta) {
    try {
      fs.writeGraphMeta(dirPath, meta);
      event.returnValue = true;
    } catch (e) {
      console.error('[main] save:layout 失败:', e);
      event.returnValue = false;
    }
  });
}

// ===== 菜单 =====
function buildMenu() {
  var tpl = [
    { label: '文件', submenu: [
      { role: 'quit', label: '退出' }
    ]},
    { label: '编辑', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]},
    { label: '视图', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      { type: 'separator' }, { role: 'togglefullscreen' }
    ]}
  ];
  if (process.platform === 'darwin') {
    tpl.unshift({ label: app.getName(), submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'hide' },
      { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
    ]});
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ===== 生命周期 =====
app.whenReady().then(function() {
  registerIPC();
  gitIPC.registerGitIPC(ipcMain, function() { return fs; });
  buildMenu();
  createWindow();
  app.on('activate', function() { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', function() { if (process.platform !== 'darwin') app.quit(); });

// ===== 退出前通知渲染进程保存 =====
app.on('before-quit', function() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('save:before-quit');
  }
});
