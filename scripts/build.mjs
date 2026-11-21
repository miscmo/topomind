import { build } from 'vite'

// 字体/语言包不入库，由同步脚本在构建前按需生成到 public/excalidraw-assets/。
await import('./sync-excalidraw-assets.mjs')

// Vite and vite-plugin-electron empty their own output directories. Keeping the
// build entry free of explicit recursive deletion also makes it work in hosts
// that protect generated directories with a safe-delete policy.
await build()
