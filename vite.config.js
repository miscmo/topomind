import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    electron({
      main: {
        // Electron 主进程入口
        entry: 'electron/main.js',
        vite: {
          build: {
            rollupOptions: {
              output: {
                // 确保所有依赖内联到单个文件中，不拆分 chunk
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
      preload: {
        // 预加载脚本
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
      // 渲染进程可以使用 Node.js API（通过 preload 暴露）
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // 让 Vite 把 vendor 中的库打进 bundle（或直接 import npm 包）
  optimizeDeps: {
    include: ['vue', 'pinia'],
  },
  // 拆分 cytoscape / elkjs vendor chunk
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('cytoscape') || id.includes('elkjs')) {
              return 'vendor-cytoscape'
            }
          }
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
})
