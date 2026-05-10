/// <reference types="vite/client" />

// CSS Modules
declare module '*.module.css' {
  const classes: { [key: string]: string }
  export default classes
}

// Electron preload API — provided by preload.ts at runtime
declare global {
  interface Window {
    electronAPI?: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>
      send(channel: string, data?: unknown): void
      on(channel: string, handler: (...args: unknown[]) => void): void
      off(channel: string, handler: (...args: unknown[]) => void): void
    }
  }
}

export {}
