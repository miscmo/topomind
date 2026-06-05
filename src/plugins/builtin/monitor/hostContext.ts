import { createContext, useContext } from 'react'

import type { LoggingApi, LogsApi, PerformanceApi, PluginsApi } from '../../public'

export interface MonitorHostContextValue {
  logs: LogsApi
  performance: PerformanceApi
  plugins: PluginsApi
  log: LoggingApi
}

export const MonitorHostContext = createContext<MonitorHostContextValue | null>(null)

export function useMonitorHost(): MonitorHostContextValue {
  const value = useContext(MonitorHostContext)
  if (!value) {
    throw new Error('MonitorHostContext is not available')
  }
  return value
}
