/**
 * P2 T2.4：把 v2 遗留的中文 `logAction('…')` 字面量迁到规范 id。
 *
 * 可重复执行（幂等）：只替换「中文首参且能在 LEGACY_ACTION_MAP 命中」的调用，
 * 已是规范 id 的调用原样保留；未命中的会明确报错，避免静默漏迁。
 * LEGACY_ACTION_MAP 本身保留（v1/v2 老日志与插件 API 仍可能传中文）。
 *
 * 用法：npm run migrate:actions
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGACY_ACTION_MAP } from '../src/shared/observability/logContract.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const srcDir = path.join(root, 'src')

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await filesUnder(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const CHINESE = /[\u4e00-\u9fff]/
const files = await filesUnder(srcDir)
let replaced = 0
let touched = 0
const unmapped: string[] = []

for (const file of files) {
  const original = await readFile(file, 'utf8')
  const next = original.replace(
    /logAction\(\s*(['"])([^'"]+)\1/g,
    (full, quote: string, raw: string) => {
      if (!CHINESE.test(raw)) return full
      const mapped = LEGACY_ACTION_MAP[raw]
      if (!mapped) {
        unmapped.push(`${path.relative(root, file).split(path.sep).join('/')}: ${raw}`)
        return full
      }
      replaced += 1
      return `logAction(${quote}${mapped}${quote}`
    },
  )
  if (next !== original) {
    await writeFile(file, next, 'utf8')
    touched += 1
  }
}

if (unmapped.length > 0) {
  console.error('LEGACY_ACTION_UNMAPPED:\n' + unmapped.join('\n'))
  process.exitCode = 1
}
console.log(`LEGACY_ACTIONS_MIGRATED: ${replaced} literals in ${touched} files; unmapped=${unmapped.length}`)
