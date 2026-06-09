export function isWebOpenablePath(path: string): boolean {
  if (typeof path !== 'string' || !path.trim()) {
    return false
  }
  try {
    const url = new URL(path)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function getElectronPlatformApi() {
  if (typeof window === 'undefined') {
    return null
  }
  return window.electronAPI?.platform ?? null
}

export async function openLocalPath(path: string): Promise<void> {
  const electronPlatform = getElectronPlatformApi()
  if (electronPlatform) {
    const result = await electronPlatform.openPath(path)
    if (!result.ok) {
      throw new Error(result.error || '桌面端打开路径失败')
    }
    return
  }
  if (!isWebOpenablePath(path)) {
    throw new Error('Web 版暂不支持打开本地路径')
  }
  const url = new URL(path)
  window.open(url.toString(), '_blank', 'noopener,noreferrer')
}
