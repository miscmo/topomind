/**
 * TopoMind React 入口点
 */
// 必须最先执行：给 BlockNote 默认块规格注入 lastModified 属性。
// @blocknote/react 在自身模块加载时就把 defaultBlockSpecs 的 propSchema 捕获进渲染闭包，
// 若注入晚于它，core 会写入 lastModified 而渲染层不认识 → 渲染崩溃。
import './features/documents/SmartDocumentEditor/patchBlockSpecs'
// Excalidraw 在**子组件渲染时**就构造 FontFace 并固化 URL 列表（自托管 + esm.sh fallback）。
// 放在容器组件的 useEffect 会晚于子 effect，导致动态字体全部回落 CDN、离线缺字。
// 这里在主 chunk 模块体同步设置，保证 lazy editor chunk 加载前 window 变量已就绪。
import { ensureExcalidrawAssets } from './features/graph/GraphCanvas/containers/excalidrawAssets'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { bootstrapCommandRegistry } from './application/commands'
import { PlatformProvider } from './core/platform-context'
import { reportAppStartup, startRuntimePerformanceObserver } from './core/performance-runtime'
import { StorageProvider } from './core/storage'
import { bootstrapPlugins } from './plugins'
import { installOverlayExitTransition } from './shared/ui/overlayPresence'
import { useThemeStore } from './stores/themeStore'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@xyflow/react/dist/style.css'
import './styles/base.css'
import './styles/tokens.css'
import './styles/controls.css'
import './styles/motion.css'

const container = document.getElementById('root')!
// 必须早于任何 React 渲染 / lazy chunk 加载：见文件头 import 处的说明。
ensureExcalidrawAssets()
const root = createRoot(container)
useThemeStore.getState().initializeTheme()
bootstrapCommandRegistry()
bootstrapPlugins()
// 全局浮层渐出代理必须早于任何 React 渲染：条件渲染的弹窗 / 浮窗关闭时
// 会被同步 removeChild，代理要在 DOM 边界把节点接管回来播完淡出。
installOverlayExitTransition()
// 运行时观测在首帧前启动：buffered 长任务包含启动/模块求值阶段的阻塞。
startRuntimePerformanceObserver()

// Suppress harmless ResizeObserver loop warning.
// It is emitted by the browser when a ResizeObserver callback resizes an observed
// element within the same frame (e.g. dragging the right-panel resizer resizes the
// BlockNote editor container, whose internal ResizeObserver re-fires). It has no
// functional impact, so we keep it out of the console to avoid noise.
const suppressResizeObserverError = () => {
  const RO_LOOP = 'ResizeObserver loop'
  const isRoLoop = (...args: unknown[]): boolean =>
    args.some(
      (a) =>
        (typeof a === 'string' && a.includes(RO_LOOP)) ||
        (a instanceof Error && typeof a.message === 'string' && a.message.includes(RO_LOOP)),
    )

  const originalError = console.error
  console.error = (...args: unknown[]) => {
    if (isRoLoop(...args)) return
    originalError.apply(console, args)
  }
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    if (isRoLoop(...args)) return
    originalWarn.apply(console, args)
  }

  const onError = (e: ErrorEvent) => {
    if (e?.message && e.message.includes(RO_LOOP)) {
      // preventDefault cancels the browser's native console print for this error;
      // stopImmediatePropagation prevents other listeners reacting to it.
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }
  // capture phase so we run before any other listener
  window.addEventListener('error', onError as EventListener, true)
}
suppressResizeObserverError()

root.render(
  <StrictMode>
    <PlatformProvider>
      <StorageProvider>
        <App />
      </StorageProvider>
    </PlatformProvider>
  </StrictMode>
)

// performance.now() 从导航起点计时，双 rAF 确保 React 已提交首帧再上报启动耗时。
requestAnimationFrame(() => {
  requestAnimationFrame(() => reportAppStartup(performance.now()))
})
