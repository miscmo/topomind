export interface PlatformDialogResult {
  valid: boolean
  selectedPath?: string | null
  error?: string
}

export interface PlatformService {
  selectDirectory: () => Promise<PlatformDialogResult>
}

function getElectronPlatformApi() {
  if (typeof window === 'undefined') {
    return null
  }
  return window.electronAPI?.platform ?? null
}

export const browserPlatformService: PlatformService = {
  async selectDirectory() {
    const electronPlatform = getElectronPlatformApi()
    if (electronPlatform) {
      return electronPlatform.selectDirectory()
    }
    return {
      valid: false,
      selectedPath: null,
      error: 'Web 版暂不支持选择本地目录',
    }
  },
}
