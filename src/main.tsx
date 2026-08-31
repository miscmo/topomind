/**
 * TopoMind React 入口点
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { bootstrapCommandRegistry } from './application/commands'
import { PlatformProvider } from './core/platform-context'
import { StorageProvider } from './core/storage'
import { bootstrapPlugins } from './plugins'
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
bootstrapCommandRegistry()
bootstrapPlugins()

// Suppress harmless ResizeObserver loop warning.
// It is emitted by the browser when a ResizeObserver callback resizes an observed
// element within the same frame (e.g. dragging the right-panel resizer resizes the
// BlockNote editor container, whose internal ResizeObserver re-fires). It has no
// functional impact, so we keep it out of the console to avoid noise.
const suppressResizeObserverError = () => {
  const RO_LOOP = 'ResizeObserver loop'
  const isRoLoop = (...args: any[]): boolean =>
    args.some(
      (a) =>
        (typeof a === 'string' && a.includes(RO_LOOP)) ||
        (a instanceof Error && typeof a.message === 'string' && a.message.includes(RO_LOOP)),
    )

  const originalError = console.error
  console.error = (...args: any[]) => {
    if (isRoLoop(...args)) return
    originalError.apply(console, args)
  }
  const originalWarn = console.warn
  console.warn = (...args: any[]) => {
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
