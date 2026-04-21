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
import { useAppStore } from './stores/appStore'
import { useConfirmStore } from './stores/confirmStore'
import { logAction } from './core/log-backend'

export default memo(function App() {
  const [isMonitorWindow, setIsMonitorWindow] = useState(
    typeof window !== 'undefined' && window.location.hash === '#/monitor'
  )

  const initHomeTab = useTabStore((s) => s.initHomeTab)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const removeTab = useTabStore((s) => s.removeTab)
  const confirmOpen = useConfirmStore((s) => s.open)
  const view = useAppStore((s) => s.view)

  // Init home tab on mount
  useEffect(() => {
    initHomeTab()
  }, [initHomeTab])

  useEffect(() => {
    const handleHashChange = () => {
      setIsMonitorWindow(window.location.hash === '#/monitor')
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Close tab handler: check dirty state before removing
  async function handleCloseTab(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab || tab.id === 'home') return

    if (tab.isDirty) {
      const confirmed = await confirmOpen({
        title: '关闭知识库',
        message: `知识库 "${tab.label}" 有未保存的更改，是否确认关闭？`,
      })
      if (!confirmed) return
    }

    removeTab(tabId)
    logAction('Tab:关闭', 'App', { tabId, label: tab.label, wasDirty: tab.isDirty })
  }

  // Monitor window only renders MonitorPage
  if (isMonitorWindow) {
    return <MonitorPage />
  }

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
            {activeTab?.type === 'kb' && <GraphPage key={activeTab.id} tabId={activeTab.id} />}
          </>
        )}
      </ReactFlowProvider>
    </>
  )
})