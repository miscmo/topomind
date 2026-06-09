import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { resolve } from 'path'

const DEFAULT_CLOUD_SERVER_URL = 'http://127.0.0.1:3000'

function getCloudServerOrigin() {
  const rawUrl = (process.env.VITE_TOPOMIND_SERVER_URL || DEFAULT_CLOUD_SERVER_URL).trim()
  try {
    return new URL(rawUrl).origin
  } catch {
    return new URL(DEFAULT_CLOUD_SERVER_URL).origin
  }
}

function buildCsp({ isDev }) {
  const connectSrc = [
    "'self'",
    getCloudServerOrigin(),
    'http://127.0.0.1:7777',
  ]

  if (isDev) {
    connectSrc.push('http://localhost:5173', 'ws://localhost:5173')
  }

  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' http://localhost:5173"
    : "script-src 'self'"

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' local-file: data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
  ].join('; ') + ';'
}

function cspPlugin() {
  return {
    name: 'topomind-csp',
    transformIndexHtml(html, context) {
      return html.replace('__TOPOMIND_CSP__', buildCsp({ isDev: Boolean(context.server) }))
    },
  }
}

export default defineConfig({
  plugins: [
    cspPlugin(),
    react(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand'],
  },
  build: {
    rollupOptions: {
      plugins: [
        visualizer({
          open: false,
          filename: 'stats.html',
          gzipSize: true,
          brotliSize: true,
        }),
      ],
      // Use default Vite chunking
      output: {},
    },
    chunkSizeWarningLimit: 1000,
  },
})
