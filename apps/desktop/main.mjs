import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const preloadPath = path.join(__dirname, 'preload.mjs')
const rendererDistDir = path.resolve(__dirname, '../web/dist')
const devServerUrl = process.env.TOPOMIND_ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173'

let mainWindow = null
let staticServer = null

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function postDebugEvent(hypothesisId, location, msg, data) {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'electron-cloud-connect',
      runId: 'post-fix',
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {})
}

function getWindowControlsState() {
  return {
    isFocused: mainWindow ? mainWindow.isFocused() : true,
    isMaximized: mainWindow ? mainWindow.isMaximized() : false,
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

async function resolveRendererUrl() {
  if (!app.isPackaged && process.env.TOPOMIND_ELECTRON_RENDERER_URL) {
    return devServerUrl
  }

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
      const requestedPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname)
      const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '')
      let filePath = path.join(rendererDistDir, normalizedPath)

      try {
        const stat = await fs.stat(filePath)
        if (stat.isDirectory()) {
          filePath = path.join(filePath, 'index.html')
        }
      } catch {
        filePath = path.join(rendererDistDir, 'index.html')
      }

      const content = await fs.readFile(filePath)
      const ext = path.extname(filePath)
      response.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' })
      response.end(content)
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(error instanceof Error ? error.message : 'Failed to load renderer')
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  staticServer = server
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve desktop renderer address')
  }
  return `http://127.0.0.1:${address.port}`
}

async function createMainWindow() {
  const rendererUrl = await resolveRendererUrl()
  // #region debug-point C:electron-main-window
  postDebugEvent('C', 'apps/desktop/main.mjs:createMainWindow', '[DEBUG] createMainWindow resolved renderer url', {
    rendererUrl,
    isPackaged: app.isPackaged,
    preloadPath,
    platform: process.platform,
    electronVersion: process.versions.electron,
  })
  // #endregion
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1120',
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  })

  mainWindow.once('ready-to-show', () => {
    // #region debug-point C:electron-ready-to-show
    postDebugEvent('C', 'apps/desktop/main.mjs:ready-to-show', '[DEBUG] BrowserWindow ready-to-show', {
      url: mainWindow?.webContents.getURL() ?? null,
      title: mainWindow?.getTitle() ?? null,
    })
    // #endregion
    mainWindow?.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    // #region debug-point C:electron-did-finish-load
    postDebugEvent('C', 'apps/desktop/main.mjs:did-finish-load', '[DEBUG] BrowserWindow did-finish-load', {
      url: mainWindow?.webContents.getURL() ?? null,
      title: mainWindow?.getTitle() ?? null,
    })
    // #endregion
  })

  mainWindow.on('focus', () => {
    mainWindow?.webContents.send('app:window-state-change', getWindowControlsState())
  })
  mainWindow.on('blur', () => {
    mainWindow?.webContents.send('app:window-state-change', getWindowControlsState())
  })
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('app:window-state-change', getWindowControlsState())
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('app:window-state-change', getWindowControlsState())
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(rendererUrl)
}

ipcMain.handle('platform:select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { valid: false, selectedPath: null }
  }
  return { valid: true, selectedPath: result.filePaths[0] }
})

ipcMain.handle('platform:open-path', async (_event, targetPath) => {
  const normalizedPath = String(targetPath || '').trim()
  if (!normalizedPath) {
    return { ok: false, error: '路径不能为空' }
  }
  if (isHttpUrl(normalizedPath)) {
    await shell.openExternal(normalizedPath)
    return { ok: true }
  }
  const errorMessage = await shell.openPath(normalizedPath)
  return errorMessage ? { ok: false, error: errorMessage } : { ok: true }
})

ipcMain.handle('app:get-shell-info', () => ({
  isDesktop: true,
  platform: process.platform,
  electronVersion: process.versions.electron,
}))

ipcMain.handle('app:window:getState', () => getWindowControlsState())
ipcMain.handle('app:window:minimize', () => {
  mainWindow?.minimize()
  return getWindowControlsState()
})
ipcMain.handle('app:window:toggleMaximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
  return getWindowControlsState()
})
ipcMain.handle('app:window:close', () => {
  mainWindow?.close()
  return getWindowControlsState()
})

app.whenReady().then(async () => {
  await createMainWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  if (staticServer) {
    await new Promise((resolve) => staticServer.close(() => resolve()))
    staticServer = null
  }
})
