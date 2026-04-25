/**
 * Electron IPC API 类型定义
 * 统一 renderer 与 preload 之间的 IPC 接口类型
 */

export interface ElectronAPI {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, data?: unknown): void
  on(channel: string, handler: (...args: unknown[]) => void): void
  off(channel: string, handler: (...args: unknown[]) => void): void
  sendSync?(channel: string, ...args: unknown[]): unknown
  isElectron?: boolean
}

/** E2E 测试模式下暴露的 API 对象 */
export type E2EApi = ElectronAPI

declare global {
  interface Window {
    electronAPI?: ElectronAPI
    __E2E_ELECTRON_API__?: ElectronAPI
  }
}