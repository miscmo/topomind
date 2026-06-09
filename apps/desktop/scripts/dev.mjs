import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(appDir, '..', '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const needsShell = process.platform === 'win32'
const require = createRequire(import.meta.url)
const electronBinary = require('electron')

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function findAvailablePort(host, preferredPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', (error) => {
      server.close(() => {
        if (preferredPort >= 5183) {
          reject(error)
          return
        }
        resolve(findAvailablePort(host, preferredPort + 1))
      })
    })
    server.listen(preferredPort, host, () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to resolve available renderer port'))
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function resolveRendererUrl() {
  const configured = process.env.TOPOMIND_ELECTRON_RENDERER_URL?.trim()
  if (configured) {
    return configured
  }
  const host = '127.0.0.1'
  const port = await findAvailablePort(host, 5173)
  return `http://${host}:${port}`
}

async function waitForRenderer(url, timeoutMs = 60000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status === 404) {
        return
      }
    } catch {}
    await wait(500)
  }
  throw new Error(`Renderer did not become ready in time: ${url}`)
}

const rendererUrl = await resolveRendererUrl()
const rendererOrigin = new URL(rendererUrl)

const webProcess = spawn(npmCommand, [
  'run',
  'dev',
  '--workspace',
  '@topomind/web',
  '--',
  '--host',
  rendererOrigin.hostname,
  '--port',
  rendererOrigin.port || '5173',
  '--strictPort',
], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
  shell: needsShell,
})

let electronProcess = null

function shutdown(code = 0) {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill()
  }
  if (!webProcess.killed) {
    webProcess.kill()
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

webProcess.on('exit', (code) => {
  if (!electronProcess) {
    process.exit(code ?? 0)
  }
})

try {
  await waitForRenderer(rendererUrl)
  electronProcess = spawn(electronBinary, [path.join(appDir, 'main.mjs')], {
    cwd: appDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      TOPOMIND_ELECTRON_RENDERER_URL: rendererUrl,
    },
  })
  electronProcess.on('exit', (code) => shutdown(code ?? 0))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  shutdown(1)
}
