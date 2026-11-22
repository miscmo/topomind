/**
 * 统一设计契约门禁。
 *
 * 目标：让后续任何人（包括 AI agent）新增/修改 UI 控件时无法再散落手写视觉值。
 *
 * 三层保护：
 *   1) 契约完整性：controls.css 必须被入口引入、TM_UI 的每个类都必须在 CSS 里有定义、
 *      契约自身不得含硬编码颜色 / !important / 魔法值；
 *   2) 存量基线：所有历史硬编码值登记在 design-system-baseline.json，
 *      **每类违规只允许减少、不允许增加**，新增一处即失败；
 *   3) 新文件强约束：新增的 .tsx 只要含 <button>，就必须使用 tm-* 类或 TM_UI 常量。
 *
 * 用法：
 *   node scripts/verify-design-system.mjs            # 校验
 *   node scripts/verify-design-system.mjs --update  # 迁移完一批后收紧基线（需 review diff）
 *
 * 刻意不做的：ESLint 自定义规则。项目 lint 基线是 0 errors，给存量文件新增一条
 * error 规则会一次性打破几十个文件；静态门禁 + 基线更适合渐进收敛。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const BASELINE_PATH = path.join(ROOT, 'scripts', 'design-system-baseline.json')
const UPDATE = process.argv.includes('--update')

const problems = []
const fail = (message) => problems.push(message)

/** 违规类型：只统计「字面视觉值」，token 变量与布局尺寸不算违规。 */
const PATTERNS = {
  // 硬编码色值：#fff / rgba(15,23,42,.08)。var(--...) 不含这些字面量，天然放行。
  color: /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g,
  // 魔法层级：z-[100] / z-[3001]；应改用 tokens.css 的 --z-* 变量或统一浮层类。
  zIndex: /\bz-\[\d+\]/g,
  // 魔法圆角：rounded-[3px]；应改用 --radius-* / .tm-*。
  radius: /rounded-\[\d+px\]/g,
  // 手写阴影：shadow-[-4px_0_24px_rgba(...)]；shadow-[var(--shadow-sm)] 放行。
  shadow: /shadow-\[[^\]]*(?:rgba?\(|\d+px)[^\]]*\]/g,
  // 硬编码字号：text-[10px]；应改用 --font-size-* / .tm-*。
  fontSize: /text-\[\d+px\]/g,
}

/** tokens.css 是唯一允许出现字面色值的文件（它就是色值真源）。 */
const LITERAL_COLOR_ALLOWLIST = new Set(['src/styles/tokens.css'])

function rel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/')
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(tsx|css)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 去掉注释，避免文档注释里的示例代码被误判为违规。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function countMatches(text, regex) {
  return (text.match(regex) ?? []).length
}

const files = walk(SRC).map(rel).sort()
const current = {}
for (const file of files) {
  const text = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'))
  const counts = {}
  for (const [kind, pattern] of Object.entries(PATTERNS)) {
    if (kind === 'color' && LITERAL_COLOR_ALLOWLIST.has(file)) continue
    const n = countMatches(text, pattern)
    if (n > 0) counts[kind] = n
  }
  if (Object.keys(counts).length > 0) current[file] = counts
}

// ---- 1) 契约完整性 ----
const controlsCssPath = path.join(SRC, 'styles', 'controls.css')
const tokensCssPath = path.join(SRC, 'styles', 'tokens.css')
const contractPath = path.join(SRC, 'shared', 'ui', 'controlStyles.ts')
const mainPath = path.join(SRC, 'main.tsx')
const pkgPath = path.join(ROOT, 'package.json')

for (const p of [controlsCssPath, tokensCssPath, contractPath, mainPath]) {
  if (!fs.existsSync(p)) fail(`缺少设计契约文件：${rel(p)}`)
}
if (problems.length === 0) {
  const controlsCss = fs.readFileSync(controlsCssPath, 'utf8')
  const controlsClean = stripComments(controlsCss)
  const tokensCss = fs.readFileSync(tokensCssPath, 'utf8')
  const contract = fs.readFileSync(contractPath, 'utf8')
  const mainSrc = fs.readFileSync(mainPath, 'utf8')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

  if (!mainSrc.includes("import './styles/controls.css'")) {
    fail('src/main.tsx 必须引入 styles/controls.css，否则所有 .tm-* 类都不会生效')
  }
  if (/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(controlsClean)) {
    fail('controls.css 不得出现字面色值，必须引用 tokens.css 变量')
  }
  if (controlsClean.includes('!important')) {
    fail('controls.css 不得使用 !important：会覆盖被 verify-critical 精确断言的 className')
  }
  for (const token of ['--control-radius', '--control-height-sm', '--control-icon', '--z-popover']) {
    if (!tokensCss.includes(`${token}:`)) fail(`tokens.css 缺少控件级语义 token ${token}`)
  }
  if (/#[0-9a-fA-F]{3,8}\b|rounded-\[|text-\[\d+px\]/.test(contract)) {
    fail('controlStyles.ts 只能引用 .tm-* 类名，不得内联 Tailwind 视觉值（会形成第二份真源）')
  }

  // TM_UI 的每个类都必须在 controls.css 里有定义，避免常量与样式漂移。
  const defined = new Set([...controlsCss.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]))
  const declared = [...contract.matchAll(/'([^']*\btm-[^']*)'/g)].map((m) => m[1])
  if (declared.length < 15) fail('controlStyles.ts 的 TM_UI 常量疑似被清空，请检查')
  for (const value of declared) {
    for (const cls of value.split(/\s+/)) {
      if (cls.startsWith('tm-') && !defined.has(cls)) {
        fail(`TM_UI 引用了未定义的类 .${cls}（请补进 controls.css）`)
      }
    }
  }
  if (!pkg.scripts?.['verify:design']) fail('package.json 必须提供 verify:design 脚本')
  if (!pkg.scripts?.prebuild) fail('package.json 必须提供 prebuild 挂钩，保证构建前自动检查')
}

// ---- 2) 契约文件本身必须零违规 ----
for (const file of ['src/styles/controls.css', 'src/shared/ui/controlStyles.ts']) {
  if (current[file]) {
    fail(`设计契约文件自身出现违规值：${file} ${JSON.stringify(current[file])}`)
    delete current[file]
  }
}

// ---- 3) baseline 比较 ----
if (UPDATE) {
  if (problems.length > 0) {
    console.error('DESIGN_CONTRACT_INVALID')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({
    schemaVersion: 1,
    note: '存量视觉值登记。只允许减少，不允许增加；迁移一批后用 --update 收紧。',
    uiFiles: files.filter((f) => f.endsWith('.tsx')),
    violations: current,
  }, null, 2)}\n`, 'utf8')
  console.log(`Design baseline updated: ${Object.keys(current).length} files with legacy values`)
  process.exit(0)
}

if (!fs.existsSync(BASELINE_PATH)) {
  fail('缺少 scripts/design-system-baseline.json，请先运行 --update 生成基线')
} else {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  const known = new Set(baseline.uiFiles ?? [])
  let increased = 0
  let reduced = 0
  for (const [file, counts] of Object.entries(current)) {
    const before = baseline.violations?.[file] ?? {}
    for (const [kind, n] of Object.entries(counts)) {
      const old = before[kind] ?? 0
      if (n > old) {
        increased += n - old
        fail(`新增视觉值违规 ${file} [${kind}] ${old} → ${n}`)
      } else if (n < old) {
        reduced += old - n
      }
    }
  }
  for (const [file, counts] of Object.entries(baseline.violations ?? {})) {
    for (const kind of Object.keys(counts)) {
      if (!current[file]?.[kind]) reduced += counts[kind]
    }
  }
  if (reduced > 0) {
    console.log(`[design] 已收敛 ${reduced} 处存量视觉值，可运行 --update 收紧基线`)
  }

  // ---- 4) 新增 UI 文件强约束 ----
  for (const file of files.filter((f) => f.endsWith('.tsx'))) {
    if (known.has(file)) continue
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    if (/<button\b/.test(text) && !/\btm-[a-z]/.test(text) && !text.includes('TM_UI')) {
      fail(`新增 UI 文件 ${file} 含 <button> 但未使用 tm-* 类 / TM_UI 常量，请按 docs/design/ui-control-system.md 套用统一控件`)
    }
  }
  if (increased > 0) fail(`共新增 ${increased} 处视觉值违规，禁止合入`)
}

if (problems.length > 0) {
  console.error('DESIGN_SYSTEM_FAILED')
  for (const p of problems) console.error(`  - ${p}`)
  process.exitCode = 1
} else {
  console.log('Design system verified')
}
