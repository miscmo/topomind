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
