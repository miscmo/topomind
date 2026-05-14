/**
 * TopoMind React 根组件
 * Tab-based routing: home tab + multiple KB tabs
 * Monitor window via hash (#/monitor) renders independently
 */
import { memo, useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import SetupPage from './components/SetupPage'
import HomePage from './components/HomePage'
import GraphPage from './components/GraphPage'
import MonitorPage from './components/MonitorPage/MonitorPage'
import PromptModal from './components/PromptModal/PromptModal'
import ConfirmModal from './components/ConfirmModal/ConfirmModal'
import TabBar from './components/TabBar/TabBar'
import { useTabStore } from './stores/tabStore'
import { useWorkspaceStore } from './stores/workspaceStore'
import { useConfirmStore } from './stores/confirmStore'
import { logAction } from './core/log-backend'
import { resetClientSession } from './core/session-reset'

export default memo(function App() {
  const [isMonitorWindow, setIsMonitorWindow] = useState(
    typeof window !== 'undefined' && window.location.hash === '#/monitor'
  )

  const initHomeTab = useTabStore((s) => s.initHomeTab)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const confirmOpen = useConfirmStore((s) => s.open)
  const view = useWorkspaceStore((s) => s.view)

  useEffect(() => { initHomeTab() }, [initHomeTab])

  useEffect(() => {
    function onResetSession() { resetClientSession() }
    window.electronAPI?.on('app:reset-session', onResetSession)
    return () => {
      window.electronAPI?.off('app:reset-session', onResetSession)
    }
  }, [])

  useEffect(() => {
    const handleHashChange = () => setIsMonitorWindow(window.location.hash === '#/monitor')
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  async function handleCloseTab(tabId: string) {
    const tab = useTabStore.getState().closeTab(tabId)
    if (!tab) return

    logAction('Tab:关闭', 'App', { tab })
  }

  if (isMonitorWindow) return <MonitorPage />

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isSetup = view === 'setup'
  return (
    <>
      <ConfirmModal />
      <PromptModal />
      <ReactFlowProvider>
        {isSetup ? (
          <SetupPage />
        ) : (
          <>
            <TabBar onCloseTab={handleCloseTab} />
            {activeTab?.type === 'home' && <HomePage />}
            {activeTab?.type === 'kb' && (
              <GraphPage key={activeTab.id} tabId={activeTab.id} />
            )}
          </>
        )}
      </ReactFlowProvider>
    </>
  )
})
