/**
 * Electron IPC API 类型定义
 * 统一 renderer 与 preload 之间的 IPC 接口类型
 */

export interface ElectronAPI {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, data?: unknown): void
  on(channel: string, handler: (...args: unknown[]) => void): void
  off(channel: string, handler: (...args: unknown[]) => void): void
  isElectron?: boolean
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
