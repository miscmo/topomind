/**
 * 同步 Excalidraw 运行时字体与语言包到 public/excalidraw-assets/。
 *
 * 这些资源约 15MB，属于依赖自带产物，不入库（见 .gitignore 的 /public/excalidraw-assets/）。
 * 由 predev / build.mjs 在启动时按需生成，保证：
 *   - 新 clone 后无需手工复制即可 dev / build；
 *   - Electron 离线加载字体与语言包仍然走自托管路径，不回落 CDN。
 *
 * 幂等：以「包版本 + 源/目标文件数」作为 stamp，一致时跳过复制。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgRoot = join(root, 'node_modules', '@excalidraw', 'excalidraw')
const sourceRoot = join(pkgRoot, 'dist', 'prod')
const outDir = process.env.TOPOMIND_ASSETS_OUT_DIR
  ? join(root, process.env.TOPOMIND_ASSETS_OUT_DIR)
  : join(root, 'public', 'excalidraw-assets')
const stampPath = join(outDir, '.sync-stamp.json')

const ASSET_DIRS = ['fonts', 'locales']

function countFiles(dir) {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += countFiles(full)
    else if (statSync(full).isFile()) total += 1
  }
  return total
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(stampPath, 'utf-8'))
  } catch {
    return null
  }
}

function main() {
  if (!existsSync(sourceRoot)) {
    console.error('[excalidraw-assets] 找不到 @excalidraw/excalidraw/dist/prod，请先执行 npm install')
    process.exit(1)
  }

  let version = 'unknown'
  try {
    version = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8')).version
  } catch {
    // 版本读不到时仍继续复制，只是每次都视为需要刷新。
  }

  const expected = Object.fromEntries(
    ASSET_DIRS.map((name) => [name, countFiles(join(sourceRoot, name))]),
  )
  if (ASSET_DIRS.some((name) => expected[name] === 0)) {
    console.error('[excalidraw-assets] 依赖包内缺少 fonts/locales，Excalidraw 版本可能不匹配')
    process.exit(1)
  }

  const stamp = readStamp()
  const alreadySynced = stamp?.version === version
    && ASSET_DIRS.every((name) => stamp?.counts?.[name] === expected[name])
    && ASSET_DIRS.every((name) => countFiles(join(outDir, name)) >= expected[name])

  if (alreadySynced) {
    console.log(`[excalidraw-assets] 已是最新（${version}，${Object.values(expected).reduce((a, b) => a + b, 0)} 个文件），跳过`)
    return
  }

  mkdirSync(outDir, { recursive: true })
  for (const name of ASSET_DIRS) {
    cpSync(join(sourceRoot, name), join(outDir, name), { recursive: true, force: true })
  }
  writeFileSync(stampPath, JSON.stringify({ version, counts: expected }, null, 2))
  console.log(`[excalidraw-assets] 已同步 ${version}：${ASSET_DIRS.map((n) => `${n}=${expected[n]}`).join(', ')}`)
}

main()
