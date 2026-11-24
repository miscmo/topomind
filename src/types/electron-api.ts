/**
 * Electron IPC API 类型定义
 * 统一 renderer 与 preload 之间的 IPC 接口类型
 */

export interface ElectronAPI {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, data?: unknown): void
  on(channel: string, handler: (...args: unknown[]) => void): void
  off(channel: string, handler: (...args: unknown[]) => void): void
  /**
   * P2 因果链透传：渲染侧把当前 traceId 镜像给 preload 的 IPC 审计层。
   * 只改 preload 闭包变量，不发起 IPC，因此不会触发审计自放大。
   */
  setTraceContext?(traceId: string | null): void
  isElectron?: boolean
}

export interface WindowControlsState {
  isMaximized: boolean
  isFocused: boolean
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
