import { build } from 'vite'

// Vite and vite-plugin-electron empty their own output directories. Keeping the
// build entry free of explicit recursive deletion also makes it work in hosts
// that protect generated directories with a safe-delete policy.
await build()
