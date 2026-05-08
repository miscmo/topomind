/**
 * TopoMind React 入口点
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { StorageProvider } from './core/storage'
import './styles/base.css'
import './styles/tokens.css'

const container = document.getElementById('root')!
const root = createRoot(container)
root.render(
  <StrictMode>
    <StorageProvider engine="fs">
      <App />
    </StorageProvider>
  </StrictMode>
)
