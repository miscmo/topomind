/**
 * TopoMind React 入口点
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PlatformProvider } from './core/platform-context'
import { StorageProvider } from './core/storage'
import { useThemeStore } from './stores/themeStore'
import '@xyflow/react/dist/style.css'
import './styles/base.css'
import './styles/tokens.css'

const container = document.getElementById('root')!
const root = createRoot(container)
useThemeStore.getState().initializeTheme()

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

root.render(
  <StrictMode>
    <PlatformProvider>
      <StorageProvider>
        <App />
      </StorageProvider>
    </PlatformProvider>
  </StrictMode>
)
