export declare const logger: {
  setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void
  getLevel(): string
  debug(module: string, ...args: unknown[]): void
  info(module: string, ...args: unknown[]): void
  warn(module: string, ...args: unknown[]): void
  error(module: string, ...args: unknown[]): void
  catch(module: string, context: string, err: unknown): void
}
