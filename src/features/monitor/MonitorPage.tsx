/**
 * 日志性能监控页面
 * 通过菜单"视图 → 日志性能监控"打开的独立窗口
 */
import { useEffect } from 'react'
import { useMonitorStore, type LogEntry } from './model/monitorStore'
import PerformanceTab from './PerformanceTab'
import {
  logGetBuffer,
  logGetAvailableDates,
  logSubscribe,
  logUnsubscribe,
  logAction,
} from '../../core/log-backend'
import { Sidebar } from './components/Sidebar'
import { FilterBar } from './components/FilterBar'
import { LogList } from './components/LogList'
import { DetailPanel } from './components/DetailPanel'

export default function MonitorPage() {
  const activeTab = useMonitorStore((s) => s.activeTab)
  const streaming = useMonitorStore((s) => s.streaming)
  const appendEntries = useMonitorStore((s) => s.appendEntries)
  const setEntries = useMonitorStore((s) => s.setEntries)
  const setAvailableDates = useMonitorStore((s) => s.setAvailableDates)
  const setLoaded = useMonitorStore((s) => s.setLoaded)

  // 初始化：加载缓冲区 + 可用日期
  useEffect(() => {
    logAction('页面:进入监控', 'MonitorPage', { timestamp: new Date().toISOString() })
    let mounted = true

    const init = async () => {
      const [buffer, dates] = await Promise.all([logGetBuffer(), logGetAvailableDates()])
      if (!mounted) return
      setEntries(buffer as LogEntry[])
      setAvailableDates(dates)
      setLoaded(true)
    }

    init()

    return () => {
      mounted = false
    }
  }, [setAvailableDates, setEntries, setLoaded])

  // 实时订阅：仅在 streaming=true 时接收新日志
  useEffect(() => {
    if (!streaming) return

    const handleEntry = (entry: unknown) => {
      appendEntries([entry as Parameters<typeof appendEntries>[0][0]])
    }

    logSubscribe(handleEntry)
    return () => {
      logUnsubscribe(handleEntry)
    }
  }, [appendEntries, streaming])

  return (
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
        ) : (
          <PerformanceTab />
        )}
      </div>
    </div>
  )
}
