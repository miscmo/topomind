/**
 * TopoMind React 根组件
 * 根据 view 状态路由到不同页面
 * 监控窗口通过 hash (#/monitor) 独立渲染 MonitorPage
 */
import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useAppStore } from './stores/appStore'
import SetupPage from './components/SetupPage'
import HomePage from './components/HomePage'
import GraphPage from './components/GraphPage'
import MonitorPage from './components/MonitorPage/MonitorPage'

export default function App() {
  const view = useAppStore((s) => s.view)

  // 监控窗口通过 hash 路由，独立于 view 状态
  const [isMonitorWindow, setIsMonitorWindow] = useState(
    typeof window !== 'undefined' && window.location.hash === '#/monitor'
  )

  useEffect(() => {
    const handleHashChange = () => {
      setIsMonitorWindow(window.location.hash === '#/monitor')
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // 监控窗口只渲染 MonitorPage
  if (isMonitorWindow) {
    return <MonitorPage />
  }

  return (
    <ReactFlowProvider>
      {view === 'setup' && <SetupPage />}
      {view === 'home' && <HomePage />}
      {view === 'graph' && <GraphPage />}
    </ReactFlowProvider>
  )
}
