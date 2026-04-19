/**
 * TopoMind React 根组件
 * 根据 view 状态路由到不同页面
 */
import { useAppStore } from './stores/appStore'
import { useRoomStore } from './stores/roomStore'
import SetupPage from './components/SetupPage'
import HomePage from './components/HomePage'
import GraphPage from './components/GraphPage'

export default function App() {
  const view = useAppStore((s) => s.view)

  if (view === 'setup') return <SetupPage />
  if (view === 'home') return <HomePage />
  return <GraphPage />
}
