import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

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
        onstart({ startup, url }) {
          startup(['.'], {
            env: { ...process.env, VITE_DEV_SERVER_URL: url },
          })
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
    include: ['react', 'react-dom', 'zustand'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@xyflow') || id.includes('reactflow')) {
              return 'vendor-reactflow'
            }
          }
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
})
