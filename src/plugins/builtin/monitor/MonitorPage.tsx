import { useEffect } from 'react'
import type { LoggingApi, LogsApi, PerformanceApi, PluginsApi } from '../../public'
import PerformanceTab from './PerformanceTab'
import { MonitorHostContext } from './hostContext'
import { Sidebar } from './components/Sidebar'
import { FilterBar } from './components/FilterBar'
import { LogList } from './components/LogList'
import { DetailPanel } from './components/DetailPanel'
import { PluginDiagnosticsPanel } from './components/PluginDiagnosticsPanel'
import { useMonitorStore } from './model/monitorStore'
import { initializeMonitorPage, subscribeMonitorDiagnostics, subscribeMonitorLogs } from './runtime'

export default function MonitorPage({
  logs,
  performance,
  plugins,
  log,
}: {
  logs: LogsApi
  performance: PerformanceApi
  plugins: PluginsApi
  log: LoggingApi
}) {
  const activeTab = useMonitorStore((s) => s.activeTab)
  const streaming = useMonitorStore((s) => s.streaming)
  const appendEntries = useMonitorStore((s) => s.appendEntries)
  const setEntries = useMonitorStore((s) => s.setEntries)
  const setAvailableDates = useMonitorStore((s) => s.setAvailableDates)
  const setLoaded = useMonitorStore((s) => s.setLoaded)
  const setPluginDiagnostics = useMonitorStore((s) => s.setPluginDiagnostics)
  const reset = useMonitorStore((s) => s.reset)

  useEffect(() => {
    reset()
    let mounted = true

    const init = async () => {
      const nextState = await initializeMonitorPage({ logs, plugins, log })
      if (!mounted) return
      setEntries(nextState.entries)
      setAvailableDates(nextState.availableDates)
      setPluginDiagnostics(nextState.pluginDiagnostics)
      setLoaded(true)
    }

    void init()

    return () => {
      mounted = false
      reset()
    }
  }, [log, logs, plugins, reset, setAvailableDates, setEntries, setLoaded, setPluginDiagnostics])

  useEffect(() => {
    if (!streaming) return

    const subscription = subscribeMonitorLogs(logs, (entry) => {
      appendEntries([entry])
    })
    return () => {
      subscription.dispose()
    }
  }, [appendEntries, logs, streaming])

  useEffect(() => {
    const subscription = subscribeMonitorDiagnostics(plugins, (diagnostics) => {
      setPluginDiagnostics(diagnostics)
    })

    return () => {
      subscription.dispose()
    }
  }, [plugins, setPluginDiagnostics])

  return (
    <MonitorHostContext.Provider value={{ logs, performance, plugins, log }}>
      <div className="flex w-full h-full bg-[var(--color-bg-app)] font-sans text-[13px] text-[var(--color-text-primary)]">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {activeTab === 'log' ? (
            <>
              <FilterBar />
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <LogList />
                <DetailPanel />
              </div>
            </>
          ) : activeTab === 'plugins' ? (
            <PluginDiagnosticsPanel />
          ) : (
            <PerformanceTab />
          )}
        </div>
      </div>
    </MonitorHostContext.Provider>
  )
}
