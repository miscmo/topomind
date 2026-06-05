export const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const
export const LEVEL_COLORS: Record<string, string> = {
  DEBUG: '#888',
  INFO: '#3498db',
  WARN: '#f39c12',
  ERROR: '#e74c3c',
}
export const LEVEL_ORDER: Record<string, number> = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 }
