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
import { installBlackbox } from './core/blackbox'
import { installInteractionBoundary } from './core/interactionBoundary'
import { writeEntry } from './core/logger'
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

const RO_LOOP = 'ResizeObserver loop'

const isResizeObserverNoise = (...args: unknown[]): boolean =>
  args.some(
    (arg) =>
      (typeof arg === 'string' && arg.includes(RO_LOOP)) ||
      (arg instanceof Error && typeof arg.message === 'string' && arg.message.includes(RO_LOOP)),
  )

// 只抑制 ResizeObserver 噪音（浏览器在同一帧内触发的良性告警），
// 覆写收窄到这一句判断，其余 console 输出原样放行。
const originalConsoleError = console.error
// eslint-disable-next-line no-console -- 唯一例外：ResizeObserver 噪音抑制
console.error = (...args: unknown[]) => {
  if (isResizeObserverNoise(...args)) return
  originalConsoleError.apply(console, args)
}
const originalConsoleWarn = console.warn
// eslint-disable-next-line no-console -- 唯一例外：ResizeObserver 噪音抑制
console.warn = (...args: unknown[]) => {
  if (isResizeObserverNoise(...args)) return
  originalConsoleWarn.apply(console, args)
}

// 渲染进程全局异常接管（规范 §3.5），走统一日志入口。
// capture 阶段先跑：ResizeObserver 噪音只抑制、不上报；其余异常全部入库。
window.addEventListener('error', (event: ErrorEvent) => {
  if (isResizeObserverNoise(event.message, event.error)) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
  void writeEntry({
    level: 'ERROR',
    module: 'app',
    action: 'app.error',
    message: `渲染进程未捕获异常: ${event.message ?? ''}`,
    error: event.error ?? event.message,
    params: { source: event.filename, line: event.lineno, column: event.colno },
  })
}, true)

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  void writeEntry({
    level: 'ERROR',
    module: 'app',
    action: 'app.error',
    message: '渲染进程未处理的 Promise 拒绝',
    error: event.reason,
  })
})

// P7.2：交互边界必须早于任何 React 渲染 / 事件处理，让真实输入先生成 traceId。
installInteractionBoundary()
// v3 D2：原始输入只进内存黑匣子，崩溃/异常时由主进程同步 dump（不单独落盘）。
installBlackbox()

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
