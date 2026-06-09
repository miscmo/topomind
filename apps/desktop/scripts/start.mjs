import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, '..')
const rendererDistDir = path.resolve(appDir, '../web/dist')
const require = createRequire(import.meta.url)
const electronBinary = require('electron')

if (!existsSync(rendererDistDir)) {
  console.error('Missing web build output. Run `npm run build --workspace @topomind/web` first.')
  process.exit(1)
}

const child = spawn(electronBinary, [path.join(appDir, 'main.mjs')], {
  cwd: appDir,
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
