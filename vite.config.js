import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { visualizer } from 'rollup-plugin-visualizer'

import { resolve } from 'path'

const DEV_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' http://localhost:5173; style-src 'self' 'unsafe-inline'; img-src 'self' local-file: data: blob:; font-src 'self' data:; connect-src 'self' http://localhost:5173 ws://localhost:5173; worker-src 'self' blob:;"
const PROD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' local-file: data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:;"

function cspPlugin() {
  return {
    name: 'topomind-csp',
    transformIndexHtml(html, context) {
      return html.replace('__TOPOMIND_CSP__', context.server ? DEV_CSP : PROD_CSP)
    },
  }
}

export default defineConfig({
  plugins: [
    cspPlugin(),
    react(),
    electron({
      main: {
        entry: 'electron/main.js',
        vite: {
          build: {
            rollupOptions: {
              output: {
                inlineDynamicImports: true,
              },
            },
          },
        },
        processAsync: true,
        onstart({ startup }) {
          if (process.env.VSCODE_DEBUG) {
            console.log('[startup] Electron App')
          } else {
            // Strip ELECTRON_RUN_AS_NODE if present: when set, Electron launches as
            // a plain Node process and never loads its built-in modules (app,
            // BrowserWindow, ...), so the main window never appears. The var can be
            // inherited from a parent terminal/IDE and is invisible otherwise.
            const cleanEnv = { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
            startup(['.', '--no-sandbox'], { env: cleanEnv }).catch((error) => {
              console.error('[startup] Electron 启动失败', error)
            })
          }
        },
      },
      preload: {
        input: 'electron/preload.js',
        vite: {
          build: {
            lib: {
              entry: resolve(__dirname, 'electron/preload.js'),
              formats: ['cjs'],
              fileName: () => 'preload.js',
            },
            rollupOptions: {
              output: {
                inlineDynamicImports: true,
                entryFileNames: 'preload.js',
              },
            },
          },
        },
      },
      renderer: {},
    }),
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
    // Restrict the dependency scanner to the real app entry. By default Vite
    // globs every *.html under the project root as a scan entry, which makes
    // esbuild crawl dozens of stale build artifacts (build-*/index.html,
    // outputs/*.html, release/..., stats.html) — each a full dist tree — and
    // blows up memory / kills the scan service on startup.
    entries: ['index.html'],
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
