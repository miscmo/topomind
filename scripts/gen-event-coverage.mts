/**
 * 生成「事件目录逐项覆盖率核对表」—— v3 P4 T4.5
 *
 * 与 gen-event-types.mts 一样是单一真源的产物生成器：
 * - 事件清单来自 EVENT_CATALOG，不手写；
 * - 静态引用点扫描 src/ 与 electron/ 的业务文件，**排除契约/目录/生成产物自身**；
 * - 「静态引用」不等于「运行时必然产生」，表内明确标注口径与未确认项；
 * - C12 会调用 buildCoverageReport() 与磁盘产物逐字比对，产物过期即门禁失败。
 *
 * 用法：npm run gen:coverage
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVENT_CATALOG } from '../src/shared/observability/eventCatalog.ts'
import { LOG_ACTIONS } from '../src/shared/observability/logContract.ts'
import { PERFORMANCE_METRICS, PERFORMANCE_ACTION } from '../src/shared/observability/performanceContract.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = path.join(ROOT, 'docs/design/event-coverage.md')

const EXCLUDED = [
  'src/shared/observability/',
  'scripts/',
  'electron/log-categories.generated.js',
  'docs/',
  'node_modules/',
  'outputs/',
  'dist/',
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const full = path.join(dir, name)
    const rel = path.relative(ROOT, full).replace(/\\/g, '/')
    if (EXCLUDED.some((prefix) => rel.startsWith(prefix))) continue
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|mts)$/.test(name)) out.push(rel)
  }
  return out
}

const actionKeys = new Map<string, string[]>()
for (const [key, id] of Object.entries(LOG_ACTIONS)) {
  const keys = actionKeys.get(id) ?? []
  keys.push(key)
  actionKeys.set(id, keys)
}
const metricKeys = new Map<string, string[]>()
for (const [key, id] of Object.entries(PERFORMANCE_METRICS)) {
  const keys = metricKeys.get(id) ?? []
  keys.push(key)
  metricKeys.set(id, keys)
}

/**
 * 明确保留但不产生日志的事件：说明必须写清「为什么没有产生点」，
 * 否则目录会混进永远不会出现的幽灵事件（v2 的教训）。
 */
const RESERVED: Record<string, string> = {
  'store.call': 'P2 决定不单独包装 `fs-backend._call`：它最终也走 `preload.invoke`，两处都包会把同一次 IPC 记两遍',
  'ui.tab': 'P7 决定由语义事件 `user.tab_close` / `user.tab_switch` 独家承接 tab 交互：关闭与切换各只写 1 条 user 记录，领域侧的 `ui.tab` 降级为内存步骤，不再落盘',
}

function needlesFor(id: string, owner: string): string[] {
  if (id === PERFORMANCE_ACTION) {
    // 性能样本统一用常量 PERFORMANCE_ACTION 作为 action，源码里没有中文字面量。
    return ['PERFORMANCE_ACTION', `'${id}'`, `"${id}"`, 'LOG_ACTIONS.performanceRecord']
  }
  if (owner === 'performance-registry') {
    const metric = id.replace(/^perf\./, '')
    return [
      `'${metric}'`, `"${metric}"`,
      ...(metricKeys.get(metric) ?? []).map((key) => `PERFORMANCE_METRICS.${key}`),
      `writePerformanceSample('${metric}'`,
    ]
  }
  return [
    `'${id}'`, `"${id}"`,
    ...(actionKeys.get(id) ?? []).map((key) => `LOG_ACTIONS.${key}`),
  ]
}

export interface CoverageRow {
  id: string
  category: string
  label: string
  owner: string
  sampleRate: number
  references: string[]
  /** P7：事实类型 / 基数 / 归属层，来自事件目录单一真源。 */
  kind: string
  cardinality: string
  factOwner: string
  /** P7：非注释行里的实际调用点次数（而非「文件是否包含该字符串」）。 */
  callSites: number
  status: '已接入' | '保留未启用' | '仅登记待核对'
}

export interface CoverageReport {
  rows: CoverageRow[]
  markdown: string
  summary: { total: number; wired: number; reserved: number; unconfirmed: number; multiSite: number }
  unconfirmedIds: string[]
}

/** 剥掉整行注释后统计调用点，避免文档注释里的示例代码被算成真实产生点。 */
function countCallSites(contents: readonly (readonly [string, string])[], needles: string[]): number {
  let total = 0
  for (const [, text] of contents) {
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
      if (needles.some((needle) => line.includes(needle))) total += 1
    }
  }
  return total
}

export function buildCoverageReport(): CoverageReport {
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'electron'))]
  const contents = files.map((rel) => [rel, readFileSync(path.join(ROOT, rel), 'utf8')] as const)

  const rows: CoverageRow[] = EVENT_CATALOG.map((spec) => {
    const needles = needlesFor(spec.id, spec.owner)
    const references = contents
      .filter(([, text]) => needles.some((needle) => text.includes(needle)))
      .map(([rel]) => rel)
    const status: CoverageRow['status'] = references.length > 0
      ? '已接入'
      : RESERVED[spec.id]
        ? '保留未启用'
        : '仅登记待核对'
    return {
      id: spec.id,
      category: spec.category,
      label: spec.label,
      owner: spec.owner,
      sampleRate: spec.sampleRate,
      references,
      kind: spec.kind,
      cardinality: spec.cardinality,
      factOwner: spec.factOwner,
      callSites: countCallSites(contents, needles),
      status,
    }
  })

  const unconfirmedIds = rows.filter((r) => r.status === '仅登记待核对').map((r) => r.id)
  const summary = {
    total: rows.length,
    wired: rows.filter((r) => r.status === '已接入').length,
    reserved: rows.filter((r) => r.status === '保留未启用').length,
    unconfirmed: unconfirmedIds.length,
    multiSite: rows.filter((r) => r.callSites >= 2).length,
  }

  const byCategory = new Map<string, CoverageRow[]>()
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? []
    list.push(row)
    byCategory.set(row.category, list)
  }

  const lines: string[] = [
    '# TopoMind 事件目录逐项覆盖率核对表',
    '',
    '> 生成产物，**请勿手工编辑**。执行 `npm run gen:coverage` 重建；`verify:logging` 的 C12 会逐字比对本文件与生成器输出。',
    '> 数据来源：`src/shared/observability/eventCatalog.ts`（单一真源）。',
    '',
    '## 口径（务必先读）',
    '',
    '1. 「已接入」= 业务源码里出现了该事件 id 或其 `LOG_ACTIONS` / `PERFORMANCE_METRICS` / `PERFORMANCE_ACTION` 常量引用。**静态引用 ≠ 运行时必然产生**：条件分支、已下线入口、仅注释引用都可能计入，因此这张表是核对清单，不是运行时覆盖率证明。',
    '2. 「保留未启用」= 设计上决定不产生该事件，并在下表写明原因；这是唯一允许「零引用」的情形。',
    '3. 「仅登记待核对」= 事件目录已登记，却找不到任何产生点，也没有保留说明。这些是**真实缺口**，必须补埋点或从目录移除，不允许用「会被拦截层动态产生」含糊带过。',
    '4. 扫描范围：`src/**/*.{ts,tsx}` 与 `electron/*.js`，排除 `shared/observability/`、`scripts/`、生成产物与文档自身，避免把注册表本身当成产生点。',
    '5. P7 新增「事实类型 / 基数 / 产生点」三列：`kind` 由事件目录声明（不再靠 action 前缀猜分类）；产生点统计剥掉整行注释后的非注释调用次数。`per-interaction` 事件有多个产生点时标注「多入口需核对」——不同入口/分支是合理的，但**同一次执行路径被写多次是缺陷**，由 C15 的运行时代重与 `dedupeKey` 兜底兜住。',
    '',
    '## 汇总',
    '',
    `| 指标 | 数值 |`,
    `| ---- | ---- |`,
    `| 事件总数 | ${summary.total} |`,
    `| 已接入（静态引用） | ${summary.wired} |`,
    `| 保留未启用（有书面理由） | ${summary.reserved} |`,
    `| 仅登记待核对（缺口） | ${summary.unconfirmed} |`,
    `| 多产生点事件（需核对） | ${summary.multiSite} |`,
    '',
  ]

  for (const [category, list] of [...byCategory.entries()].sort()) {
    lines.push(`## ${category}`, '')
    lines.push('| 事件 id | 标签 | 事实类型 | 基数 | 采样率 | 状态 | 产生点 | 静态引用点 / 保留理由 |')
    lines.push('| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |')
    for (const row of list) {
      let detail: string
      if (row.status === '保留未启用') detail = RESERVED[row.id]
      else if (row.references.length === 0) detail = '—'
      else detail = `${row.references.length} 处：${row.references.slice(0, 3).map((r) => `\`${r}\``).join('、')}${row.references.length > 3 ? ' …' : ''}`
      const siteNote = row.callSites >= 2 && row.cardinality === 'per-interaction'
        ? `${row.callSites}（多入口需核对）`
        : String(row.callSites)
      lines.push(`| \`${row.id}\` | ${row.label} | ${row.kind} | ${row.cardinality} | ${row.sampleRate} | ${row.status} | ${siteNote} | ${detail} |`)
    }
    lines.push('')
  }

  lines.push(
    '## 结论',
    '',
    `- 「关键用户动作覆盖率」在本表中**按静态引用逐项核对**：${summary.total} 个事件中 ${summary.wired} 个有产生点、${summary.reserved} 个书面保留、${summary.unconfirmed} 个待核对。`,
    unconfirmedIds.length === 0
      ? '- 当前没有「仅登记待核对」项；目录中的每个事件要么有产生点，要么有明文的保留理由。'
      : `- 待核对项：${unconfirmedIds.map((id) => `\`${id}\``).join('、')}。`,
    '- 运行时是否真的每条事件都会产生，仍需 P2 的拦截行为用例（C10）与人工按上表逐项走查共同证明；本表不冒充运行时覆盖率。',
    '- 新增事件只需登记到 `LOG_ACTIONS` / `PERFORMANCE_METRIC_SPECS`，重新运行 `npm run gen:events && npm run gen:coverage` 即可同步类型、分类产物与本表。',
    '',
  )

  return { rows, markdown: `${lines.join('\n')}\n`, summary, unconfirmedIds }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = buildCoverageReport()
  writeFileSync(OUTPUT, report.markdown, 'utf8')
  console.log(`Event coverage written: ${report.summary.total} events (wired=${report.summary.wired}, reserved=${report.summary.reserved}, unconfirmed=${report.summary.unconfirmed})`)
}
