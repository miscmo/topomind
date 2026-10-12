/**
 * TopoMind React 根组件
 * Tab-based routing: home tab + multiple KB tabs
 * Monitor window via hash (#/monitor) renders independently
 */
import { memo, useEffect, lazy, Suspense } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
const SetupPage = lazy(() => import('./features/setup/SetupPage'))
const PromptModal = lazy(() => import('./shared/ui/PromptModal/PromptModal').then(m => ({ default: m.PromptModal })))
const ConfirmModal = lazy(() => import('./shared/ui/ConfirmModal/ConfirmModal').then(m => ({ default: m.ConfirmModal })))
const CustomTitleBar = lazy(() => import('./features/layout/CustomTitleBar/CustomTitleBar'))
import { useTabStore } from './stores/tabs/tabStore'
import { useWorkspaceStore } from './stores/workspaceStore'
import { GraphStoreProvider } from './stores/graphStore'
import { executeCommand } from './application/commands'
import './core/close-guard'
import { resetClientSession } from './core/session-reset'
import { PluginViewHost } from './plugins'
import { useConfigBootstrap } from './application/config'
import { LearningTrackerProvider } from './features/learning-tracker/LearningTrackerProvider'
import { ErrorBoundary } from './features/layout/ErrorBoundary'
import { Toaster } from './shared/ui/Toaster/Toaster'

const HomePage = lazy(() => import('./features/kb/HomePage'))
const GraphPage = lazy(() => import('./features/graph/GraphPage'))

export default memo(function App() {
  const initHomeTab = useTabStore((s) => s.initHomeTab)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const view = useWorkspaceStore((s) => s.view)
  useConfigBootstrap()

  useEffect(() => { initHomeTab() }, [])

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
      if (typeof action !== 'string') {
        return
      }

      void executeCommand(action).catch((error) => {
        console.error(`Failed to execute menu command: ${action}`, error)
      })
    }
    window.electronAPI?.on('app:menu-action', onMenuAction)
    return () => {
      window.electronAPI?.off('app:menu-action', onMenuAction)
    }
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isSetup = view === 'setup'
  const activeSecondaryViewId = activeTab?.type === 'secondary-view' ? activeTab.viewId : null

  return (
    // 最外层兜底：即使各区域都有自己的边界，这里仍能接住漏网的错误，避免白屏
    <ErrorBoundary label="应用">
      <LearningTrackerProvider>
        <div className="w-full h-full min-h-0 flex flex-col bg-[var(--color-bg-app)] overflow-hidden">
          <Suspense fallback={null}>
            <ConfirmModal />
            <PromptModal />
          </Suspense>
          <Toaster />
          {isSetup ? (
            <Suspense fallback={null}>
              <CustomTitleBar mode="setup" />
              <div className="relative flex-1 min-h-0 overflow-hidden">
                <SetupPage />
              </div>
            </Suspense>
          ) : (
            <div className="w-full h-full min-h-0 flex flex-col bg-[var(--color-bg-muted)] overflow-hidden">
              <Suspense fallback={null}>
                <CustomTitleBar mode="workspace" />
              </Suspense>
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
                    <ErrorBoundary label="首页">
                      <HomePage />
                    </ErrorBoundary>
                  </Suspense>
                </div>
                <div
                  className="absolute inset-0 transition-opacity duration-120 ease-in-out"
                  inert={activeTab?.type === 'secondary-view' ? undefined : true}
                  style={{
                    visibility: activeTab?.type === 'secondary-view' ? 'visible' : 'hidden',
                    opacity: activeTab?.type === 'secondary-view' ? 1 : 0,
                    pointerEvents: activeTab?.type === 'secondary-view' ? 'auto' : 'none',
                    background:
                      activeSecondaryViewId === 'learning.statistics'
                        ? 'var(--color-bg-app)'
                        : 'var(--color-surface)',
                    zIndex: activeTab?.type === 'secondary-view' ? 10 : -1,
                  }}
                >
                  {activeSecondaryViewId && (
                    <Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-muted)] text-[13px]">加载页面中...</div>}>
                      <ErrorBoundary label="学习统计页面" resetKeys={[activeSecondaryViewId]}>
                        <PluginViewHost viewId={activeSecondaryViewId} />
                      </ErrorBoundary>
                    </Suspense>
                  )}
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
                      // Keep the tab's React/store state alive, but let Chromium skip
                      // painting and layout work for inactive graph pages.
                      contentVisibility: activeTabId === tab.id ? 'visible' : 'hidden',
                      zIndex: activeTabId === tab.id ? 5 : -1,
                    }}
                  >
                    <Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-muted)] text-[13px]">加载知识库中...</div>}>
                      {/* 按标签页隔离：所有标签页是常驻挂载的，单个标签页崩溃不应带走整个应用 */}
                      <ErrorBoundary label={`知识库标签页「${tab.label || tab.kbPath || tab.id}」`} resetKeys={[tab.id, activeTabId === tab.id]}>
                        <ReactFlowProvider>
                          <GraphStoreProvider>
                            <GraphPage tabId={tab.id} isActive={activeTabId === tab.id} />
                          </GraphStoreProvider>
                        </ReactFlowProvider>
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </LearningTrackerProvider>
    </ErrorBoundary>
  )
})
