/**
 * 构建 / 开发前的资源与门禁编排。
 *
 * 不依赖 shell 的 `&&`（Windows 上 npm 可能落到 PowerShell 5.1，它不认 `&&`），
 * 直接用当前 Node 可执行文件按序拉起各脚本，任一失败立即终止。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const steps = [
  'scripts/sync-excalidraw-assets.mjs',
  'scripts/build-emoji-assets.mjs',
]
if (process.argv.includes('--design')) steps.push('scripts/verify-design-system.mjs')

for (const step of steps) {
  const result = spawnSync(process.execPath, [path.join(ROOT, step)], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error(`[prepare-assets] ${step} 失败（exit ${result.status ?? 'unknown'}）`)
    process.exit(result.status ?? 1)
  }
}
