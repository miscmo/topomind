/**
 * Debug HUD 的挂载点：未开启时零加载成本。
 *
 * 放在 App 根层而不是某个视图里，保证浮窗始终位于应用最顶层、不受
 * overflow-clip / tab 切换影响；只有开关状态变化会重渲染这个轻量宿主。
 */
import { lazy, Suspense } from 'react'
import { useDebugHudStore } from './debugStore'

const DebugHud = lazy(() => import('./DebugHud'))

export default function DebugHudHost() {
  const enabled = useDebugHudStore((s) => s.enabled)
  if (!enabled) return null
  return (
    <Suspense fallback={null}>
      <DebugHud />
    </Suspense>
  )
}
