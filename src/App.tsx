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
import { useTabStore } from './stores/tabStore'
import { useWorkspaceStore } from './stores/workspaceStore'
import { useConfirmStore } from './stores/confirmStore'
import { GraphStoreProvider } from './stores/graphStore'
import { logAction } from './core/log-backend'
import { resetClientSession } from './core/session-reset'

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

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isSetup = view === 'setup'
  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-[var(--color-bg-app)] overflow-hidden">
      <ConfirmModal />
      <PromptModal />
      {isSetup ? (
        <>
          <CustomTitleBar mode="setup" />
          <div className="relative flex-1 min-h-0 overflow-hidden">
            <SetupPage />
          </div>
        </>
      ) : (
        <div className="w-full h-full min-h-0 flex flex-col bg-[var(--color-bg-muted)] overflow-hidden">
          <CustomTitleBar mode="workspace" />
          <div className="relative w-full flex-1 min-h-0 overflow-hidden bg-[var(--color-surface)]">
            <div
              className="absolute inset-0 transition-opacity duration-120 ease-in-out"
              inert={activeTab?.type === 'home' ? undefined : true}
              style={{
                visibility: activeTab?.type === 'home' ? 'visible' : 'hidden',
                opacity: activeTab?.type === 'home' ? 1 : 0,
                pointerEvents: activeTab?.type === 'home' ? 'auto' : 'none',
                zIndex: activeTab?.type === 'home' ? 5 : -1,
              }}
            >
              <Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-muted)] text-[13px]">加载首页中...</div>}>
                <HomePage />
              </Suspense>
            </div>
            <div
              className="absolute inset-0 transition-opacity duration-120 ease-in-out"
              inert={activeTab?.type === 'monitor' ? undefined : true}
              style={{
                visibility: activeTab?.type === 'monitor' ? 'visible' : 'hidden',
                opacity: activeTab?.type === 'monitor' ? 1 : 0,
                pointerEvents: activeTab?.type === 'monitor' ? 'auto' : 'none',
                background: 'var(--color-surface)',
                zIndex: activeTab?.type === 'monitor' ? 10 : -1,
              }}
            >
              <Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-muted)] text-[13px]">加载监控中...</div>}>
                {tabs.some(t => t.type === 'monitor') && <MonitorPage />}
              </Suspense>
            </div>
            {tabs.filter(t => t.type === 'kb').map(tab => (
              <div
                key={tab.id}
                className="absolute inset-0 transition-opacity duration-120 ease-in-out"
                inert={activeTabId === tab.id ? undefined : true}
                style={{
                  visibility: activeTabId === tab.id ? 'visible' : 'hidden',
                  opacity: activeTabId === tab.id ? 1 : 0,
                  pointerEvents: activeTabId === tab.id ? 'auto' : 'none',
                  zIndex: activeTabId === tab.id ? 5 : -1,
                }}
              >
                <Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-muted)] text-[13px]">加载知识库中...</div>}>
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
