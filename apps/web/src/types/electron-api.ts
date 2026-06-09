export interface ElectronPlatformDialogResult {
  valid: boolean
  selectedPath?: string | null
  error?: string
}

export interface ElectronOpenPathResult {
  ok: boolean
  error?: string
}

export interface ElectronShellInfo {
  isDesktop: boolean
  platform: string
  electronVersion: string
}

export interface ElectronWindowControlsState {
  isFocused: boolean
  isMaximized: boolean
}

export interface ElectronWindowControlsApi {
  getState: () => Promise<ElectronWindowControlsState>
  minimize: () => Promise<ElectronWindowControlsState>
  toggleMaximize: () => Promise<ElectronWindowControlsState>
  close: () => Promise<ElectronWindowControlsState>
  onStateChange: (listener: (state: ElectronWindowControlsState) => void) => () => void
}

export interface ElectronApi {
  platform: {
    isDesktop: boolean
    selectDirectory: () => Promise<ElectronPlatformDialogResult>
    openPath: (targetPath: string) => Promise<ElectronOpenPathResult>
  }
  app: {
    getShellInfo: () => Promise<ElectronShellInfo>
    window: ElectronWindowControlsApi
  }
}

declare global {
  interface Window {
    electronAPI?: ElectronApi
  }
}

export {}
