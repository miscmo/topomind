import { memo, Suspense, lazy, useEffect } from 'react'
import { useCloudBootstrapSync, useCloudSessionBridge, useCloudSyncEngine, useCloudWorkspaceSelection } from './application/cloud'
import { useConfigBootstrap } from './application/config/useConfigBootstrap'
import { StorageProvider } from './core/storage'
import { useCloudSessionStore } from './stores/cloudSessionStore'
import { useTabStore } from './stores/tabs/tabStore'
import { useWorkspaceStore } from './stores/workspaceStore'
import CustomTitleBar from './features/layout/CustomTitleBar/CustomTitleBar'

const SetupPage = lazy(() => import('./features/setup/SetupPage'))
const HomePage = lazy(() => import('./features/kb/HomePage'))
const GraphPage = lazy(() => import('./features/graph/GraphPage/GraphPage'))
const MonitorPage = lazy(() => import('./features/monitor/MonitorPage'))
const LearningStatisticsPage = lazy(() => import('./features/learning-tracker/pages/LearningStatisticsPage'))

function AppRuntime() {
  useCloudSessionBridge()
  useCloudWorkspaceSelection()
  useCloudBootstrapSync()
  useCloudSyncEngine()
  useConfigBootstrap()
  return null
}

function WorkspaceContent() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const initHomeTab = useTabStore((s) => s.initHomeTab)

  useEffect(() => {
    initHomeTab()
  }, [initHomeTab])

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  if (!activeTab || activeTab.type === 'home') {
    return <HomePage />
  }
  if (activeTab.type === 'kb') {
    return <GraphPage tabId={activeTab.id} />
  }
  if (activeTab.type === 'monitor') {
    return <MonitorPage />
  }
  return <LearningStatisticsPage />
}

export default memo(function App() {
  const accessToken = useCloudSessionStore((s) => s.accessToken)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const view = useWorkspaceStore((s) => s.view)
  const showWorkspaceContent = view === 'workspace' && (!accessToken || !!currentWorkspaceId)
  const titleBarMode = showWorkspaceContent ? 'workspace' : 'setup'

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-app)] text-[13px] text-[var(--color-text-muted)]">页面加载中...</div>}>
      <StorageProvider>
        <AppRuntime />
        <div className="flex min-h-screen flex-col overflow-hidden bg-[var(--color-bg-app)]">
          <CustomTitleBar mode={titleBarMode} />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {showWorkspaceContent ? <WorkspaceContent /> : <SetupPage />}
          </div>
        </div>
      </StorageProvider>
    </Suspense>
  )
})
