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
              // 沙箱模式下 preload 仍需在运行时解析 'electron'（contextBridge/ipcRenderer），
              // 绝不能把 electron 打进 bundle，故显式 external。
              external: ['electron'],
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
      // Split heavy, independently-cacheable libraries into their own chunks so
      // the initial/main chunk stays smaller and the editor bundle can be cached
      // separately. Each module is assigned to exactly one chunk (function form),
      // which avoids circular-chunk build errors.
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (
            id.includes('@blocknote') ||
            id.includes('prosemirror') ||
            id.includes('@tiptap') ||
            id.includes('@codemirror') ||
            id.includes('@lezer')
          ) {
            return 'editor'
          }
          if (id.includes('@mantine') || id.includes('@tabler') || id.includes('@emotion')) {
            return 'mantine'
          }
          if (
            id.includes('/react/') ||
            id.includes('react-dom') ||
            id.includes('react-router') ||
            id.includes('reactflow') ||
            id.includes('@xyflow') ||
            id.includes('/scheduler/') ||
            // Keep the React-internals-touching ecosystem in ONE chunk. These
            // packages call into React's module factory at top-level init; if they
            // live in a separate chunk a cross-chunk circular init makes React's
            // export object (`Ae`) still `undefined` when it's first dereferenced,
            // throwing "Cannot set properties of undefined (setting 'Activity')"
            // and white-screening the production build. (Repro: use-sync-external-store
            // ← @xyflow/react, which sits in react-vendor.)
            id.includes('use-sync-external-store') ||
            id.includes('/zustand/') ||
            id.includes('zustand')
          ) {
            return 'react-vendor'
          }
          // Remaining vendor libraries: one chunk per top-level package. This is
          // the canonical safe manualChunks pattern — every module lands in a
          // single chunk, so no circular-chunk errors — and it gives fine-grained
          // caching plus parallel loading instead of one monolithic vendor blob.
          const m = id.match(/[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/)
          if (m) {
            return 'lib-' + m[1].replace('@', '').replace(/[\\/]/g, '-')
          }
          return 'vendor'
        },
      },
    },
    // The remaining >1 MB chunks (editor, mermaid, elkjs, shikijs-langs) are
    // single, inherently large third-party packages that are already isolated
    // into their own chunks — there is no actionable further split, so raise
    // the warning threshold to keep the build output clean.
    chunkSizeWarningLimit: 2000,
  },
})
