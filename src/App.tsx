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
import { useTabStore, tabStore } from './stores/tabStore'
import { useAppStore } from './stores/appStore'
import { useConfirmStore } from './stores/confirmStore'
import { logAction } from './core/log-backend'
import { useStorage } from './hooks/useStorage'

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
  const showHome = useAppStore((s) => s.showHome)
  const storage = useStorage()

  // Init home tab on mount
  useEffect(() => {
    initHomeTab()
  }, [initHomeTab])

  // Listen for main-process navigation trigger (E2E test harness)
  useEffect(() => {
    function onNavigateHome() {
      showHome()
    }
    window.electronAPI?.on('app:navigate-home', onNavigateHome)
    return () => window.electronAPI?.off('app:navigate-home', onNavigateHome)
  }, [])

  // Auto-navigate to home if work directory is already initialized (e.g., via E2E env var)
  useEffect(() => {
    let cancelled = false
    async function checkAndNavigate() {
      try {
        const rootDir = await storage.getRootDir()
        if (rootDir && !cancelled) {
          const initResult = await storage.init()
          const valid = typeof initResult === 'object' && (initResult as { valid?: boolean }).valid
          if (!cancelled && valid) {
            showHome()
            logAction('App:auto-navigate-home', 'App', { rootDir })
          }
        }
      } catch {
        // Ignore — stay on setup page
      }
    }
    checkAndNavigate()
    return () => { cancelled = true }
  }, [initHomeTab, showHome, storage])

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