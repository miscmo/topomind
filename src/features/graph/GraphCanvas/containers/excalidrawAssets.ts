/**
 * Excalidraw 字体/语言包自托管。
 *
 * Electron 生产环境是 file:// 页面，Excalidraw 的 normalizeBaseUrl 会把 '/...' 拼到
 * window.location.origin（file:// 下是 "null"）而报错，也会回落到 esm.sh CDN 导致离线缺字。
 * 因此必须给一个带 scheme 的绝对 URL：dev 下是 http://localhost:5173/excalidraw-assets/，
 * 生产下是 file:///.../dist/excalidraw-assets/。资源由 public/excalidraw-assets 提供。
 */
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

export const EXCALIDRAW_ASSET_DIR = 'excalidraw-assets/'

export function ensureExcalidrawAssets(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (window.EXCALIDRAW_ASSET_PATH) return
  try {
    window.EXCALIDRAW_ASSET_PATH = new URL(EXCALIDRAW_ASSET_DIR, document.baseURI).href
  } catch {
    // 极少数环境 baseURI 不可用时留给 Excalidraw 的 CDN 兜底，不阻断编辑。
  }
}
