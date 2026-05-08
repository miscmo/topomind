export interface ILogStorage {
  readLogs: () => Promise<unknown>
  writeLogs: (content: unknown) => Promise<unknown>
}
