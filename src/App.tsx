/**
 * TopoMind React 根组件
 * Tab-based routing: home tab + multiple KB tabs
 * Monitor window via hash (#/monitor) renders independently
 */
import { memo, useEffect, lazy, Suspense } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import SetupPage from './components/SetupPage'
import PromptModal from './components/PromptModal/PromptModal'
import ConfirmModal from './components/ConfirmModal/ConfirmModal'
import CustomTitleBar from './components/CustomTitleBar/CustomTitleBar'
import TabBar from './components/TabBar/TabBar'
import { useTabStore } from './stores/tabStore'
import { useWorkspaceStore } from './stores/workspaceStore'
import { useConfirmStore } from './stores/confirmStore'
import { GraphStoreProvider } from './stores/graphStore'
import { logAction } from './core/log-backend'
import { resetClientSession } from './core/session-reset'
import styles from './App.module.css'

const HomePage = lazy(() => import('./components/HomePage'))
const GraphPage = lazy(() => import('./components/GraphPage'))
const MonitorPage = lazy(() => import('./components/MonitorPage/MonitorPage'))

export default memo(function App() {
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
    function onMenuAction(...args: unknown[]) {
      const action = args[0]
      if (action === 'open-monitor') {
        useTabStore.getState().openMonitorTab()
      }
    }
    window.electronAPI?.on('app:menu-action', onMenuAction)
    return () => {
      window.electronAPI?.off('app:menu-action', onMenuAction)
    }
  }, [])

  async function handleCloseTab(tabId: string) {
    const tab = useTabStore.getState().closeTab(tabId)
    if (!tab) return

    logAction('Tab:关闭', 'App', { tab })
  }

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isSetup = view === 'setup'
  return (
    <div className={styles.appShell}>
      <ConfirmModal />
      <PromptModal />
      {isSetup ? (
        <>
          <CustomTitleBar mode="setup" />
          <div className={styles.setupContent}>
            <SetupPage />
          </div>
        </>
      ) : (
        <div className={styles.workspaceShell}>
          <CustomTitleBar mode="workspace" />
          <TabBar onCloseTab={handleCloseTab} />
          <div className={styles.workspaceContent}>
            <div
              className={styles.tabSurface}
              inert={activeTab?.type === 'home' ? undefined : ""}
              style={{
                visibility: activeTab?.type === 'home' ? 'visible' : 'hidden',
                opacity: activeTab?.type === 'home' ? 1 : 0,
                pointerEvents: activeTab?.type === 'home' ? 'auto' : 'none',
                zIndex: activeTab?.type === 'home' ? 5 : -1,
              }}
            >
              <Suspense fallback={<div className={styles.contentFallback}>加载首页中...</div>}>
                <HomePage />
              </Suspense>
            </div>
            <div
              className={styles.tabSurface}
              inert={activeTab?.type === 'monitor' ? undefined : ""}
              style={{
                visibility: activeTab?.type === 'monitor' ? 'visible' : 'hidden',
                opacity: activeTab?.type === 'monitor' ? 1 : 0,
                pointerEvents: activeTab?.type === 'monitor' ? 'auto' : 'none',
                background: 'var(--color-surface)',
                zIndex: activeTab?.type === 'monitor' ? 10 : -1,
              }}
            >
              <Suspense fallback={<div className={styles.contentFallback}>加载监控中...</div>}>
                {tabs.some(t => t.type === 'monitor') && <MonitorPage />}
              </Suspense>
            </div>
            {tabs.filter(t => t.type === 'kb').map(tab => (
              <div
                key={tab.id}
                className={styles.tabSurface}
                inert={activeTabId === tab.id ? undefined : ""}
                style={{
                  visibility: activeTabId === tab.id ? 'visible' : 'hidden',
                  opacity: activeTabId === tab.id ? 1 : 0,
                  pointerEvents: activeTabId === tab.id ? 'auto' : 'none',
                  zIndex: activeTabId === tab.id ? 5 : -1,
                }}
              >
                <Suspense fallback={<div className={styles.contentFallback}>加载知识库中...</div>}>
                  <ReactFlowProvider>
                    <GraphStoreProvider>
                      <GraphPage tabId={tab.id} />
                    </GraphStoreProvider>
                  </ReactFlowProvider>
                </Suspense>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})
