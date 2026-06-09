/**
 * TopoMind React 入口点
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import GraphPerformanceBenchmarkApp from './benchmarks/GraphPerformanceBenchmarkApp'
import { useThemeStore } from './stores/themeStore'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@xyflow/react/dist/style.css'
import './styles/base.css'
import './styles/tokens.css'

const container = document.getElementById('root')!
const root = createRoot(container)
useThemeStore.getState().initializeTheme()
const isGraphBenchmarkRoute = window.location.pathname === '/__benchmarks__/graph'

// Suppress harmless ResizeObserver loop limit exceeded error
const suppressResizeObserverError = () => {
  const originalError = console.error
  console.error = (...args: any[]) => {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('ResizeObserver loop')) {
      return
    }
    originalError.apply(console, args)
  }
  window.addEventListener('error', (e) => {
    if (e.message === 'ResizeObserver loop completed with undelivered notifications.' || e.message === 'ResizeObserver loop limit exceeded') {
      e.stopImmediatePropagation()
    }
  })
}
suppressResizeObserverError()

// #region debug-point C:runtime-bootstrap
fetch('http://127.0.0.1:7777/event', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: 'electron-cloud-connect',
    runId: 'post-fix',
    hypothesisId: 'C',
    location: 'apps/web/src/main.tsx:bootstrap',
    msg: '[DEBUG] renderer bootstrap',
    data: {
      href: window.location.href,
      origin: window.location.origin,
      pathname: window.location.pathname,
      baseUrl: import.meta.env.VITE_TOPOMIND_SERVER_URL || 'http://127.0.0.1:3000',
      isDesktop: Boolean(window.electronAPI?.platform?.isDesktop),
      userAgent: navigator.userAgent,
    },
    ts: Date.now(),
  }),
}).catch(() => {})
// #endregion

if (isGraphBenchmarkRoute) {
  root.render(<GraphPerformanceBenchmarkApp />)
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
