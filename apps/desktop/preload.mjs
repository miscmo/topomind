import { contextBridge, ipcRenderer } from 'electron'

// #region debug-point C:preload-bootstrap
fetch('http://127.0.0.1:7777/event', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: 'electron-cloud-connect',
    runId: 'post-fix',
    hypothesisId: 'C',
    location: 'apps/desktop/preload.mjs:bootstrap',
    msg: '[DEBUG] preload bootstrap',
    data: {
      hasContextBridge: Boolean(contextBridge),
      hasIpcRenderer: Boolean(ipcRenderer),
    },
    ts: Date.now(),
  }),
}).catch(() => {})
// #endregion

function onWindowStateChange(listener) {
  if (typeof listener !== 'function') {
    return () => {}
  }
  const wrapped = (_event, state) => listener(state)
  ipcRenderer.on('app:window-state-change', wrapped)
  return () => {
    ipcRenderer.off('app:window-state-change', wrapped)
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: {
    isDesktop: true,
    selectDirectory: () => ipcRenderer.invoke('platform:select-directory'),
    openPath: (targetPath) => ipcRenderer.invoke('platform:open-path', targetPath),
  },
  app: {
    getShellInfo: () => ipcRenderer.invoke('app:get-shell-info'),
    window: {
      getState: () => ipcRenderer.invoke('app:window:getState'),
      minimize: () => ipcRenderer.invoke('app:window:minimize'),
      toggleMaximize: () => ipcRenderer.invoke('app:window:toggleMaximize'),
      close: () => ipcRenderer.invoke('app:window:close'),
      onStateChange: (listener) => onWindowStateChange(listener),
    },
  },
})
