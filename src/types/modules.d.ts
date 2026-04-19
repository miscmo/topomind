/**
 * Global type declarations for plain JS modules imported by TS files.
 * These modules don't ship their own .d.ts — declare them here so TS is happy.
 *
 * Note: FSB, Store, GitBackend, and GitCache are declared in their respective
 * per-module .d.ts files (src/core/fs-backend.d.ts, etc.) with full interfaces.
 * Only keep additional/shared declarations here.
 */
declare module '../core/log-backend' {
  export function logWrite(entry: object): Promise<boolean>
  export function logGetBuffer(): Promise<object[]>
  export function logQuery(opts?: object): Promise<object[]>
  export function logSetLevel(level: string | number): Promise<boolean>
  export function logClear(): Promise<boolean>
  export function logGetAvailableDates(): Promise<string[]>
  export function logGetLogDir(): Promise<string | null>
  export function logSubscribe(callback: (entry: object) => void): void
  export function logUnsubscribe(callback: (entry: object) => void): void
  export function logAction(action: string, module?: string, params?: object): Promise<boolean>
}
