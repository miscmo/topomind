import { createElement, lazy, Suspense } from 'react'
import type { ComponentType } from 'react'

import type { LoggingApi, LogsApi, PerformanceApi, PluginsApi } from '../../public'

type MonitorPageProps = {
  logs: LogsApi
  performance: PerformanceApi
  plugins: PluginsApi
  log: LoggingApi
}

export async function loadMonitorPageModule() {
  const module = await import('./MonitorPage.tsx')
  return {
    default: module.default as ComponentType<MonitorPageProps>,
  }
}

const LazyMonitorPage = lazy(loadMonitorPageModule)

export function MonitorPageEntry(props: MonitorPageProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement('div', { className: 'h-full w-full' }),
    },
    createElement(LazyMonitorPage, props),
  )
}
