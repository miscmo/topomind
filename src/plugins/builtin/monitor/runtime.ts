import type {
  Disposable,
  LogEntrySnapshot,
  LoggingApi,
  LogsApi,
  PluginDiagnosticsSnapshot,
  PluginsApi,
} from '../../public'
import { normalizeLogEntry, type LogEntry } from './model/monitorStore.ts'

export interface LoadedMonitorPageData {
  entries: LogEntry[]
  availableDates: string[]
  pluginDiagnostics: PluginDiagnosticsSnapshot[]
}

export async function initializeMonitorPage(input: {
  logs: LogsApi
  plugins: PluginsApi
  log: LoggingApi
  now?: () => Date
}): Promise<LoadedMonitorPageData> {
  input.log.info('open monitor page', {
    timestamp: (input.now ?? (() => new Date()))().toISOString(),
  })

  const [buffer, availableDates] = await Promise.all([
    input.logs.getBuffer(),
    input.logs.getAvailableDates(),
  ])

  return {
    entries: buffer.map(normalizeLogEntry),
    availableDates,
    pluginDiagnostics: input.plugins.listDiagnostics(),
  }
}

export function subscribeMonitorLogs(
  logs: LogsApi,
  listener: (entry: LogEntry) => void,
): Disposable {
  return logs.subscribe((entry: LogEntrySnapshot) => {
    listener(normalizeLogEntry(entry))
  })
}

export function subscribeMonitorDiagnostics(
  plugins: PluginsApi,
  listener: (diagnostics: PluginDiagnosticsSnapshot[]) => void,
): Disposable {
  return plugins.subscribeDiagnostics(listener)
}
