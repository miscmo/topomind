/**
 * Electron 主进程
 */
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fileService = require('./file-service');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'TopoMind — 拓扑知识大脑',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  // 开发模式打开 DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

// ===== 应用菜单 =====
function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '选择工作目录...', click: function() { handleSelectWorkDir(); } },
        { type: 'separator' },
        { label: '导出数据...', click: function() { mainWindow.webContents.send('menu:export'); } },
        { label: '导入数据...', click: function() { handleImportJson(); } },
        { type: 'separator' },
        { label: '重置为默认', click: function() { mainWindow.webContents.send('menu:reset'); } },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '重置缩放' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 TopoMind', click: function() {
          dialog.showMessageBox(mainWindow, {
            type: 'info', title: '关于 TopoMind',
            message: 'TopoMind — 可漫游拓扑知识大脑',
            detail: '版本 3.0.0\n纯前端知识图谱工具\n支持无限嵌套知识卡片'
          });
        }}
      ]
    }
  ];

  // macOS 特殊菜单
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about', label: '关于 TopoMind' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ===== IPC 注册 =====
function registerIPC() {
  // Markdown
  ipcMain.handle('fs:readMarkdown', function(e, nodeId) { return fileService.readMarkdown(nodeId); });
  ipcMain.handle('fs:writeMarkdown', function(e, nodeId, content) { fileService.writeMarkdown(nodeId, content); });
  ipcMain.handle('fs:deleteMarkdown', function(e, nodeId) { fileService.deleteMarkdownFile(nodeId); });
  ipcMain.handle('fs:listMarkdownFiles', function() { return fileService.listMarkdownFiles(); });

  // 图片
  ipcMain.handle('fs:writeImage', function(e, filename, arrayBuffer) {
    fileService.writeImage(filename, arrayBuffer);
    return true;
  });
  ipcMain.handle('fs:readImage', function(e, filename) {
    var buf = fileService.readImage(filename);
    if (!buf) return null;
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
  ipcMain.handle('fs:deleteImage', function(e, filename) { fileService.deleteImage(filename); });
  ipcMain.handle('fs:listImages', function() { return fileService.listImages(); });

  // 工作目录
  ipcMain.handle('fs:getWorkDir', function() { return fileService.getWorkDir(); });
  ipcMain.handle('fs:selectWorkDir', function() { return handleSelectWorkDir(); });

  // 导入/导出
  ipcMain.handle('fs:exportJson', function(e, data) {
    var result = dialog.showSaveDialogSync(mainWindow, {
      title: '导出数据', defaultPath: 'topomind-data.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result) {
      require('fs').writeFileSync(result, JSON.stringify(data, null, 2), 'utf-8');
      return result;
    }
    return null;
  });
  ipcMain.handle('fs:importJson', function() { return handleImportJson(); });

  // 窗口
  ipcMain.on('win:setTitle', function(e, title) {
    if (mainWindow) mainWindow.setTitle(title);
  });
}

function handleSelectWorkDir() {
  var dir = fileService.selectDirectory(dialog);
  if (dir && mainWindow) {
    mainWindow.webContents.send('workdir:changed', dir);
  }
  return dir;
}

function handleImportJson() {
  var result = dialog.showOpenDialogSync(mainWindow, {
    title: '导入数据', filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result && result[0]) {
    return fileService.readJsonFile(result[0]);
  }
  return null;
}

// ===== 生命周期 =====
app.whenReady().then(function() {
  fileService.ensureDirs();
  registerIPC();
  buildMenu();
  createWindow();

  app.on('activate', function() {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') app.quit();
});
