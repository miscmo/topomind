/**
 * 全项目 lint「防新增」门禁。
 *
 * 背景：历史遗留约 250 个 error（no-explicit-any / react-hooks 新规则 / 空 catch 等），
 * 一次性重写既不现实也容易引入行为变化。这里冻结当前基线，保证：
 *   - 任何新文件带 error → 失败；
 *   - 任何已有文件 error 数上升 → 失败；
 *   - 修掉历史错误后只会提示「可下调基线」，不会失败。
 *
 * 用法：
 *   npm run verify:lint:baseline            # 校验
 *   npm run lint:baseline:update           # 修完历史债后重建基线
 *
 * 与 `npm run lint` 使用同一套 eslint 配置和同一条命令（eslint . -f json），
 * 因此 eslint.config.js 的 ignores 变更会同时反映到基线里。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const baselinePath = path.join(here, 'lint-baseline.json')
const update = process.argv.includes('--update')
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js')

const run = spawnSync(process.execPath, [eslintBin, '.', '-f', 'json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
if (run.error) throw run.error
// eslint 的退出码：0=无 error，1=有 error（预期），>1=配置或运行故障。
if (run.status === null || run.status > 1) {
  console.error('eslint 执行失败：', run.stderr || `exit ${run.status}`)
  process.exit(1)
}

let results
try {
  results = JSON.parse(run.stdout)
} catch (error) {
  console.error('无法解析 eslint JSON 输出：', String(error))
  console.error((run.stdout || '').slice(0, 500))
  process.exit(1)
}

const byFile = {}
let total = 0
for (const file of results) {
  const count = file.errorCount || 0
  if (!count) continue
  const rel = path.relative(root, file.filePath).split(path.sep).join('/')
  byFile[rel] = count
  total += count
}
const sorted = Object.fromEntries(Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b)))
const fileCount = Object.keys(sorted).length

if (update) {
  fs.writeFileSync(baselinePath, `${JSON.stringify({ total, byFile: sorted }, null, 2)}\n`, 'utf8')
  console.log(`Lint baseline updated: ${total} errors in ${fileCount} files`)
  process.exit(0)
}

if (!fs.existsSync(baselinePath)) {
  console.error('缺少 lint 基线，请先运行 npm run lint:baseline:update')
  process.exit(1)
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const regressions = []
for (const [file, count] of Object.entries(sorted)) {
  const was = baseline.byFile?.[file] ?? 0
  if (count > was) regressions.push(`${file}: ${was} → ${count} errors`)
}
if (total > baseline.total) regressions.push(`total: ${baseline.total} → ${total} errors`)

if (regressions.length) {
  console.error('Lint baseline regression（历史债只允许减少，不允许新增）：')
  for (const line of regressions) console.error(`- ${line}`)
  process.exit(1)
}

console.log(`Lint baseline verified: ${total} errors / ${fileCount} files (baseline ${baseline.total})`)
if (total < baseline.total) {
  console.log(`历史错误减少了 ${baseline.total - total} 个，可运行 npm run lint:baseline:update 下调基线`)
}
