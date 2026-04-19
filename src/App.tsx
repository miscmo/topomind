/**
 * TopoMind React 根组件
 * 根据 view 状态路由到不同页面
 */
import { ReactFlowProvider } from '@xyflow/react'
import { useAppStore } from './stores/appStore'
import { useRoomStore } from './stores/roomStore'
import SetupPage from './components/SetupPage'
import HomePage from './components/HomePage'
import GraphPage from './components/GraphPage'

export default function App() {
  const view = useAppStore((s) => s.view)

  return (
    <ReactFlowProvider>
      {view === 'setup' && <SetupPage />}
      {view === 'home' && <HomePage />}
      {view === 'graph' && <GraphPage />}
    </ReactFlowProvider>
  )
}
