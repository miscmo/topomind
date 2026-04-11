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
      },
      preload: {
        // 预加载脚本
        input: 'electron/preload.js',
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
})
