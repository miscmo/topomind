import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

import { resolve } from 'path'
import fs from 'fs'

export default defineConfig({
  plugins: [
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
          let e2eWorkdir = process.env.TOPOMIND_E2E_WORKDIR || ''
          try {
            if (fs.existsSync('.env')) {
              const content = fs.readFileSync('.env', 'utf8')
              const match = content.split('\n').find(l => l.startsWith('TOPOMIND_E2E_WORKDIR='))
              if (match) e2eWorkdir = match.split('=').slice(1).join('=')
            }
          } catch (_) {}
          startup(['.'], {
            env: { ...process.env, TOPOMIND_E2E_WORKDIR: e2eWorkdir, VITE_DEV_SERVER_URL: url },
          })
        },
      },
      preload: {
        input: 'electron/preload.js',
        vite: {
          build: {
            rollupOptions: {
              output: {
                inlineDynamicImports: true,
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
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('elkjs')) {
              return 'vendor-elk'
            }
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
