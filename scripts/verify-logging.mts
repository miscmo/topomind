/**
 * 日志模块门禁（logging-spec-and-redesign.md §4）。
 *
 * 结构与行为双检：静态部分校验「结构契约是否被破坏」，C7 起还会用轻量 mock
 * 真实加载主进程服务与 TS 纯函数模块（Node strip-types），执行故障注入与行为断言。
 *
 *   C1 契约唯一性      —— LogEntry / LogLevel / 注册表只能在 logContract.ts 声明
 *   C2 action 注册表   —— id 格式、去重、保留 action、旧字面量全覆盖
 *   C3 module 枚举     —— 10 个功能域自洽、旧 module 映射值合法
 *   C4 常量一致性      —— 主进程数值与 LOG_LIMITS / LEVEL_ORDER 一一对应
 *   C5 IPC 通道同步    —— main.js handler ↔ preload 三张白名单 ↔ log-backend 封装
 *   C6 链路与收敛      —— 单一写入入口、全局异常接管、分页/导出、console 冻结
 *   C7 运行时冒烟      —— 真实加载主进程服务，验证按类落盘/等级/日期校验/查询/导出
 *   C8 行为用例        —— P0 故障注入、脱敏、accepted 语义
 *   C9 v3 行为用例     —— 事件目录登记率、生成产物一致性、分类/保留期/批量写/读时兼容
 *   C10 P2 单点拦截    —— 中文 action 冻结线、preload 防自放大与聚合、trace/span 因果链、
 *                          用户事件三件套、定时任务聚合（结构与行为双检）
 *   C11 P3 崩溃闭环    —— error 同步落盘与 durable、指纹/面包屑/dump/env、session 恢复报告、
 *                          诊断包二次脱敏与双目录、黑匣子只进内存、crashReporter（结构与行为双检）
 *   C12 P4 五视图与索引 —— 视图模型纯函数、五视图/控制条结构、事件覆盖率逐项核对、
 *                          行偏移索引（total/有序/过滤/增量/坏行/CRLF 回退）、10 万条查询 P95
 *   C13 P5 真实链路      —— 直接驱动 recordUser/logAction/recordInternal，验证真实埋点
 *                          共享 traceId 并在事件流里成链（C12 理想 fixture 的盲点）
 *   C14 P6/P8 Debug HUD  —— 菜单/命令/挂载/层级结构，订阅成对与不写日志的防自放大守卫，
 *                          内存缓冲纯函数行为用例（上限裁剪、乱序归位、过滤、摘要、截断），
 *                          透明背景三主题 token、root 级真穿透与悬停可读性的结构与行为用例
 *   C15 P7 事实唯一性    —— 显式 kind 分类、dedupeKey 幂等键、主进程短窗去重（error 例外）、
 *                          事件目录元数据与覆盖率表多产生点列
 *
 * 注：C7 起本脚本会真实加载主进程服务与 TS 纯函数模块（Node strip-types），
 * 不再是纯静态文本检查；D7 要求新增能力必须带可执行行为用例。
 * 用法：npm run verify:logging（已接入 scripts/verify-all.mjs）。
 */
import { readFile, readdir, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { buildGeneratedTs, buildGeneratedJs } from './gen-event-types.mts'
import { buildCoverageReport } from './gen-event-coverage.mts'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const rel = (file: string) => path.relative(root, file).split(path.sep).join('/')
const read = (file: string) => readFile(path.join(root, file), 'utf8')
const norm = (value: string) => value.replace(/\s+/g, '')

/**
 * 门禁的日期键必须和日志服务的分片口径一致：**用户本地日**（D12）。
 * 服务 electron/log-service.js 的 _dateStr 用 getFullYear/getMonth/getDate；
 * 若这里用 toISOString().slice(0,10)（UTC），UTC+8 的 00:00–08:00 会去读前一天的
 * 空目录，C7/C8/C9/C11/C12 会整组误报失败（P4.5 实测：25 violations）。
 */
const localDay = (value: Date | number = new Date()): string => {
  const d = value instanceof Date ? value : new Date(value)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const violations: string[] = []
let checkCount = 0
function expect(group: string, ok: boolean, message: string) {
  checkCount += 1
  if (!ok) violations.push(`[${group}] ${message}`)
}

/** 截取两个标记之间的源码块，缺标记返回空串（后续断言会失败并给出原因）。 */
function block(text: string, start: string, end: string): string {
  const from = text.indexOf(start)
  if (from < 0) return ''
  const to = text.indexOf(end, from + start.length)
  return to < 0 ? text.slice(from) : text.slice(from, to)
}

async function filesUnder(dir: string, exts: string[]): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      out.push(...await filesUnder(full, exts))
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

const CONTRACT = 'src/shared/observability/logContract.ts'
const contract = await read(CONTRACT)
const service = await read('electron/log-service.js')
const main = await read('electron/main.js')
const preload = await read('electron/preload.js')
const backend = await read('src/core/log-backend.ts')
const sourceFiles = await filesUnder(path.join(root, 'src'), ['.ts', '.tsx'])
const electronFiles = await filesUnder(path.join(root, 'electron'), ['.js', '.cjs'])

// ------------------------------------------------------------
// C1 契约唯一性
// ------------------------------------------------------------
const FORBIDDEN_DECLARATIONS: Array<[RegExp, string]> = [
  [/interface\s+LogEntry\b/, 'interface LogEntry'],
  [/interface\s+LogEntrySnapshot\b/, 'interface LogEntrySnapshot'],
  [/type\s+LogLevel\s*=/, 'type LogLevel'],
  [/interface\s+LogQueryInput\b/, 'interface LogQueryInput'],
  [/interface\s+LogWriteResult\b/, 'interface LogWriteResult'],
  [/const\s+LOG_ACTIONS\s*=/, 'const LOG_ACTIONS'],
  [/const\s+LOG_MODULES\s*=/, 'const LOG_MODULES'],
]
for (const file of sourceFiles) {
  if (rel(file) === CONTRACT) continue
  const text = await readFile(file, 'utf8')
  for (const [pattern, name] of FORBIDDEN_DECLARATIONS) {
    expect('C1', !pattern.test(text), `${rel(file)} 重复声明 ${name}（必须 re-export ${CONTRACT}）`)
  }
}
for (const file of [
  'src/core/log-backend.ts',
  'src/core/logger.ts',
  'src/plugins/public/api.ts',
  'src/plugins/public/monitorStore.ts',
  'src/plugins/bootstrap.ts',
]) {
  expect('C1', (await read(file)).includes('logContract'), `${file} 未引用契约唯一真源`)
}

// ------------------------------------------------------------
// C2 action 注册表
// ------------------------------------------------------------
const actionsBlock = block(contract, 'export const LOG_ACTIONS = {', '} as const')
const actionIds = [...actionsBlock.matchAll(/^\s*\w+:\s*'([^']+)'/gm)].map((m) => m[1])
expect('C2', actionIds.length >= 50, `LOG_ACTIONS 规模异常（${actionIds.length} 条），疑似注册表被截断`)
for (const id of actionIds) {
  expect('C2', /^[a-z][a-z0-9]*\.[a-z0-9_]+$/.test(id), `action id 格式不合规: ${id}（应为 <domain>.<verb>）`)
}
expect('C2', new Set(actionIds).size === actionIds.length, 'LOG_ACTIONS 存在重复 id')
expect('C2', actionsBlock.includes('PERFORMANCE_ACTION'), 'LOG_ACTIONS 未登记保留 action PERFORMANCE_ACTION')
const perfContract = await read('src/shared/observability/performanceContract.ts')
expect('C2', /export const PERFORMANCE_ACTION = '性能:记录'/.test(perfContract), '保留 action 性能:记录 被改名（会打断回归门禁）')
expect('C2', contract.includes('[PERFORMANCE_ACTION]:'), '保留 action 缺少 LOG_ACTION_META 登记')
expect('C2', contract.includes('export function resolveAction('), '缺少 resolveAction 兼容层')

const legacyBlock = block(contract, 'const LEGACY_GROUPS', 'export const LEGACY_ACTION_MAP')
const legacyRaws = new Set([...legacyBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]))
expect('C2', legacyRaws.size >= 90, `旧 action 兼容映射数量异常（${legacyRaws.size} 条）`)
const knownActions = new Set([...actionIds, '性能:记录'])
for (const file of sourceFiles) {
  const text = await readFile(file, 'utf8')
  for (const match of text.matchAll(/logAction\(\s*['"]([^'"]+)['"]/g)) {
    const raw = match[1]
    expect('C2', knownActions.has(raw) || legacyRaws.has(raw), `${rel(file)} 的 logAction("${raw}") 未登记到注册表或兼容映射`)
  }
}

// ------------------------------------------------------------
// C3 module 枚举
// ------------------------------------------------------------
const modulesBlock = block(contract, 'export const LOG_MODULES = {', '} as const')
const modulePairs = [...modulesBlock.matchAll(/^\s*(\w+):\s*\{\s*id:\s*'([^']+)'/gm)]
  .map((m) => ({ key: m[1], id: m[2] }))
const moduleIds = modulePairs.map((p) => p.id)
expect('C3', moduleIds.length === 10, `LOG_MODULES 应为 10 个功能域，实际 ${moduleIds.length}`)
for (const { key, id } of modulePairs) expect('C3', key === id, `LOG_MODULES.${key} 的 id 为 ${id}，key 与 id 必须一致`)
expect('C3', new Set(moduleIds).size === moduleIds.length, 'LOG_MODULES 存在重复 id')
const legacyModuleBlock = block(contract, 'export const LEGACY_MODULE_MAP', 'export function resolveModule')
const legacyModuleValues = [...legacyModuleBlock.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1])
expect('C3', legacyModuleValues.length >= 30, 'LEGACY_MODULE_MAP 疑似被截断')
for (const value of legacyModuleValues) {
  expect('C3', moduleIds.includes(value), `LEGACY_MODULE_MAP 指向未定义的功能域: ${value}`)
}
expect('C3', contract.includes('export function resolveModule('), '缺少 resolveModule 归一化函数')

// ------------------------------------------------------------
// C4 主进程常量与契约一致
// ------------------------------------------------------------
const limitsBlock = block(contract, 'export const LOG_LIMITS = {', '} as const')
const LIMIT_PAIRS: Array<[string, string]> = [
  ['maxBufferSize', 'MAX_BUFFER_SIZE'],
  ['maxFileSizeBytes', 'MAX_FILE_SIZE_BYTES'],
  ['retentionDays', 'RETENTION_DAYS'],
  ['maxMessageLength', 'MAX_MESSAGE_LENGTH'],
  ['maxParamsBytes', 'MAX_PARAMS_BYTES'],
  ['maxQueryLimit', 'MAX_QUERY_LIMIT'],
  ['defaultQueryLimit', 'DEFAULT_QUERY_LIMIT'],
]
for (const [tsName, jsName] of LIMIT_PAIRS) {
  const lhs = new RegExp(`${tsName}:\\s*([^,\\n]+)`).exec(limitsBlock)
  const rhs = new RegExp(`const ${jsName} = ([^;]+);`).exec(service)
  expect('C4', Boolean(lhs && rhs), `LOG_LIMITS.${tsName} 与 electron/log-service.js 的 ${jsName} 未成对存在`)
  if (lhs && rhs) {
    expect('C4', norm(lhs[1]) === norm(rhs[1]), `${tsName} 不一致: ${lhs[1].trim()} vs ${rhs[1].trim()}`)
  }
}
const levelOrder = (text: string) => {
  const out: Record<string, number> = {}
  for (const m of text.matchAll(/\b(DEBUG|INFO|WARN|ERROR):\s*(\d+)/g)) out[m[1]] = Number(m[2])
  return JSON.stringify(out)
}
const tsOrder = levelOrder(block(contract, 'export const LOG_LEVEL_ORDER', 'export const DEFAULT_LOG_LEVEL'))
const jsOrder = levelOrder(block(service, 'const LEVEL_ORDER = {', 'const LEVEL_NAMES'))
expect('C4', tsOrder === jsOrder && tsOrder !== '{}', `LEVEL_ORDER 不一致: ${tsOrder} vs ${jsOrder}`)
// v3：分类数据只能来自生成产物，主进程禁止手写副本。
const generatedJs = await read('electron/log-categories.generated.js')
for (const name of ['LOG_CATEGORY_IDS', 'CATEGORY_RETENTION_DAYS', 'CATEGORY_BY_ACTION', 'CATEGORY_RULES']) {
  expect('C4', generatedJs.includes(`export const ${name}`), `主进程 JS 产物缺少 ${name}`)
}
expect('C4', service.includes("from './log-categories.generated.js'"), 'log-service.js 未消费事件目录生成产物')

// ------------------------------------------------------------
// C5 IPC 通道三处同步
// ------------------------------------------------------------
const collectChannels = (text: string) => new Set([...text.matchAll(/'(log:[^']+)'/g)].map((m) => m[1]))
const invokeAllowed = collectChannels(block(preload, 'const ALLOWED_CHANNELS = new Set([', ']);'))
const sendAllowed = collectChannels(block(preload, 'const ALLOWED_SEND_CHANNELS = new Set([', ']);'))
const receiveAllowed = collectChannels(block(preload, 'const ALLOWED_RECEIVE_CHANNELS = new Set([', ']);'))
const mainHandles = new Set([...main.matchAll(/ipcMain\.handle\(\s*'(log:[^']+)'/g)].map((m) => m[1]))
const backendCalls = new Set([...backend.matchAll(/_call\(\s*'(log:[^']+)'/g)].map((m) => m[1]))
const backendOn = new Set([...backend.matchAll(/api\.(?:on|off)\(\s*'(log:[^']+)'/g)].map((m) => m[1]))
const backendSend = new Set([...backend.matchAll(/api\.send\(\s*'(log:[^']+)'/g)].map((m) => m[1]))

for (const channel of invokeAllowed) expect('C5', mainHandles.has(channel), `preload 放行 ${channel}，但 main.js 没有 handler`)
for (const channel of mainHandles) expect('C5', invokeAllowed.has(channel), `main.js 注册 ${channel}，但 preload 未放行`)
for (const channel of backendCalls) {
  expect('C5', mainHandles.has(channel) && invokeAllowed.has(channel), `log-backend 调用 ${channel}，但主进程/preload 未同步`)
}
for (const channel of backendOn) expect('C5', receiveAllowed.has(channel), `log-backend 监听 ${channel}，但不在 preload RECEIVE 白名单`)
for (const channel of backendSend) expect('C5', sendAllowed.has(channel), `log-backend 发送 ${channel}，但不在 preload SEND 白名单`)
for (const channel of sendAllowed) {
  expect('C5', service.includes(`ipcMain.on('${channel}'`), `log-service.js 缺少 ${channel} 的订阅处理`)
}
expect('C5', !collectChannels(`${main}${preload}${backend}${service}`).has('log:clear'), '旧 log:clear 通道未清除（应改为 log:clearBuffer）')

// ------------------------------------------------------------
// C6 链路完整性与 console 收敛
// ------------------------------------------------------------
const logger = await read('src/core/logger.ts')
expect('C6', !/_shouldLog|_currentLevel/.test(logger), '渲染侧仍存在本地等级过滤（阈值必须只在主进程）')
expect('C6', logger.includes('export function writeEntry('), '缺少统一写入入口 writeEntry')
const bootstrap = await read('src/plugins/bootstrap.ts')
expect('C6', /log\(level, pluginId[^)]*\)\s*\{[\s\S]{0,600}?writeEntry\(/.test(bootstrap), 'hostServices.log 未接回 writeEntry（插件日志会丢）')
const mainTsx = await read('src/main.tsx')
expect('C6', mainTsx.includes("addEventListener('unhandledrejection'"), '渲染进程缺少 unhandledrejection 接管')
expect('C6', mainTsx.includes("addEventListener('error'"), '渲染进程缺少 window error 接管')
expect('C6', main.includes("process.on('uncaughtException'") && main.includes("process.on('unhandledRejection'"), '主进程缺少全局异常接管')
expect('C6', main.includes('render-process-gone') && main.includes('unresponsive'), '主进程缺少渲染进程崩溃事件接管')
expect('C6', main.includes('LogService.init(') && main.includes('LogService.enterWorkDir('), '启动兜底 init 或工作目录切换缺失')
expect('C6', service.includes('function clearBuffer(') && !/\bfunction clear\(/.test(service), 'clear() 未更名为 clearBuffer()')
expect('C6', service.includes('readline.createInterface') && service.includes('createReadStream'), 'query 未改为流式读取')
expect('C6', service.includes('_validateDate') && service.includes('_isInsideLogDir'), '缺少日期白名单 / 目录穿越校验')
expect('C6', service.includes('_enqueueWrite') && service.includes('_appendWithRetry'), '缺少串行写队列与失败重试')
expect('C6', service.includes('_pruneOldLogs') && service.includes('_pickShard'), '缺少保留期清理或分片轮转')
const perf = await read('src/core/performance-log.ts')
expect('C6', perf.includes('action: PERFORMANCE_ACTION'), '性能埋点 action 被改写（回归脚本依赖字面量）')
const logList = await read('src/plugins/builtin/monitor/components/LogList.tsx')
expect('C6', logList.includes('visibleCount'), 'LogList 缺少分页/渐进渲染')
const filterBar = await read('src/plugins/builtin/monitor/components/FilterBar.tsx')
expect('C6', filterBar.includes('exportJsonl'), '日志 tab 缺少 JSONL 导出')
// v3：spanId / parentId 已升为正式关联键，幽灵字段只剩 v1 的 file / line / func。
// P4 收窄：只检查「日志条目对象」上的访问，避免把 P3 合法的 dumpRef.file
// （minidump 文件名）误判成幽灵字段；类型系统本身已禁止条目上的这三个键。
for (const file of sourceFiles.filter((f) => rel(f).includes('plugins/') || rel(f).includes('shared/observability/'))) {
  const text = await readFile(file, 'utf8')
  expect('C6', !/\b(?:entry|raw|parsed|normalized|selectedEntry)\.(?:func|file|line)\b/.test(text), `${rel(file)} 仍引用已删除的幽灵字段`)
}
expect('C6', /categoryFromLegacy\(/.test(contract), '契约缺少 v3 读时归类函数 categoryFromLegacy')
expect('C6', /LOG_SCHEMA_VERSION = 3/.test(contract), '契约版本未升到 v3')

// console 冻结基线：历史残留只允许减少，不允许新增（配合 eslint no-console）。
const CONSOLE_PATTERN = /console\.(?:log|warn|error|info|debug)\s*\(/g
const consoleCount = async (files: string[]) => {
  let total = 0
  for (const file of files) total += (await readFile(file, 'utf8')).match(CONSOLE_PATTERN)?.length ?? 0
  return total
}
const CONSOLE_BASELINE = { src: 37, electron: 18 }
const srcConsole = await consoleCount(sourceFiles)
const electronConsole = await consoleCount(electronFiles)
expect('C6', srcConsole <= CONSOLE_BASELINE.src, `src 裸 console 从 ${CONSOLE_BASELINE.src} 增至 ${srcConsole}`)
expect('C6', electronConsole <= CONSOLE_BASELINE.electron, `electron 裸 console 从 ${CONSOLE_BASELINE.electron} 增至 ${electronConsole}`)

// ------------------------------------------------------------
// C7 运行时冒烟：用轻量 mock 替换 electron 依赖后真实加载主进程服务
// ------------------------------------------------------------
// 主进程入口脱敏是独立模块：data: URL 无法解析相对 import，把它一并编码注入。
// 提到 try 外面是为了让 C8 能复用同一份 patched 源码并加载独立的服务实例。
const redactSource = await read('electron/log-redact.js')
const redactUrl = `data:text/javascript;base64,${Buffer.from(redactSource).toString('base64')}`
const categoriesSource = await read('electron/log-categories.generated.js')
const categoriesUrl = `data:text/javascript;base64,${Buffer.from(categoriesSource).toString('base64')}`
const patched = service
  .replace(
    "import { ipcMain, BrowserWindow } from 'electron';",
    'const ipcMain = { handle() {}, on() {} };\nconst BrowserWindow = { getAllWindows: () => [] };',
  )
  .replace(/from '(path|fs|fs\/promises|readline)'/g, "from 'node:$1'")
  .replace("from './log-redact.js'", `from '${redactUrl}'`)
  .replace("from './log-categories.generated.js'", `from '${categoriesUrl}'`)
const moduleUrl = `data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`
try {
  const svc = (await import(moduleUrl)).default
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'topomind-log-'))
  try {
    expect('C7', svc.init({ logDir: tmpDir, level: 'DEBUG' }) === true, 'LogService.init 返回 false')

    svc.write({ level: 'ERROR', module: 'app', message: '异常冒烟', error: { name: 'SmokeError', message: '可搜索异常内容' } })
    const accepted = svc.write({ level: 'INFO', module: 'app', action: 'app.startup', message: '冒烟条目', params: { ok: true } })
    expect('C7', accepted?.accepted === true, `write 未返回 accepted: ${JSON.stringify(accepted)}`)

    svc.setLevel('ERROR')
    const filtered = svc.write({ level: 'INFO', module: 'app', message: '应被过滤' })
    expect('C7', filtered?.accepted === false && filtered?.reason === 'filtered', '等级过滤未生效或 reason 不正确')
    expect('C7', svc.getLevel() === 'ERROR', 'getLevel 未返回当前阈值')
    svc.setLevel('DEBUG')

    const escaped = await svc.query({ date: '../../etc/passwd' })
    expect('C7', escaped.total === 0 && escaped.entries.length === 0, 'date 目录穿越未被拒绝')

    const today = localDay()
    let raw = ''
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { raw = await readFile(path.join(tmpDir, today, 'internal.log'), 'utf8') } catch { /* 写队列尚未完成 */ }
      if (raw.includes('冒烟条目')) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect('C7', raw.includes('冒烟条目'), '串行写队列未把条目落盘')
    expect('C7', !raw.includes('应被过滤'), '被等级过滤的条目仍写入了磁盘')

    const page = await svc.query({ date: today, limit: 10 })
    expect('C7', page.entries.some((e: { message?: string }) => e.message === '冒烟条目'), 'query 未读回落盘条目')
    expect('C7', page.entries[0]?.v === 3, '落盘条目缺少 v3 版本号')
    expect('C7', Boolean(page.entries[0]?.category), '落盘条目缺少 v3 一级分类')
    expect('C7', typeof page.total === 'number', 'query 未返回 total')
    const errorPage = await svc.query({ date: today, keyword: '可搜索异常内容', limit: 10 })
    expect('C7', errorPage.total === 1 && errorPage.entries[0]?.error?.message === '可搜索异常内容', 'query keyword 未覆盖结构化 error 字段')
    expect('C7', (await svc.exportJsonl(today)).includes('冒烟条目'), 'exportJsonl 未返回原始 JSONL')
    expect('C7', svc.getAvailableDates().includes(today), 'getAvailableDates 未包含当天')
    expect('C7', svc.clearBuffer() === true && svc.getBuffer().length === 0, 'clearBuffer 未只清内存缓冲')
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
} catch (error) {
  expect('C7', false, `运行时冒烟异常: ${String(error)}`)
}

// ------------------------------------------------------------
// C8 行为用例（v3 P0）：验证「行为正确」，而不只是「字符串存在」。
// v2 的 3221 项全绿却漏掉 16 个缺陷，根因是 C6 大量使用 includes 断言。
// ------------------------------------------------------------
try {
  const contractUrl = new URL('../src/shared/observability/logContract.ts', import.meta.url).href
  const contract = await import(contractUrl)
  const redact = await import(redactUrl)

  // C8-1 契约：等级归一化、module 边界匹配、双端脱敏口径一致
  expect('C8', contract.normalizeLogLevel('warn') === 'WARN', '小写 level 未归一化为 WARN')
  expect('C8', contract.normalizeLogLevel('unknown-level') === 'INFO', '非法 level 未降级为 INFO')
  expect('C8', contract.buildLogEntry({ level: 'warn', message: 'x' }).level === 'WARN', 'buildLogEntry 仍把小写 level 静默降为 INFO')
  for (const raw of ['Guide', 'buildStatus', 'quickOpen', 'liquid']) {
    expect('C8', contract.resolveModule(raw) === 'app', `resolveModule 仍误判 ${raw}`)
  }
  expect('C8', contract.resolveModule('Store.writeTopoDocument') === 'store', '前缀归域失效')
  expect('C8', contract.resolveModule('uiTabBar') === 'ui', '驼峰分段归域失效')

  const probe = {
    keyword: 'abc', newKeyword: '机密标题', previousKeyword: '上次输入',
    notifyMessage: '用户正文', message: '通知内容',
    path: 'C:/Users/75465/secret/文档.md', content: '正文内容',
    error: { name: 'E', message: 'failed at C:/Users/x/a.md' }, context: '保留我',
  }
  const tsOut = JSON.stringify(contract.redactParams(probe))
  const jsOut = JSON.stringify(redact.redactParamsDeep(probe))
  expect('C8', tsOut === jsOut, `渲染侧与主进程脱敏口径不一致: ${tsOut} vs ${jsOut}`)
  expect('C8', !tsOut.includes('机密标题') && !tsOut.includes('正文内容') && !tsOut.includes('C:/Users'), '脱敏后仍含用户内容或绝对路径明文')
  expect('C8', contract.redactParams(probe).context === '保留我', '脱敏误伤了普通上下文键 context')

  // C8-2 故障注入：目录不可写 → 启动日志进预缓冲 → 恢复可写后补写
  const svc2 = (await import(`${moduleUrl}#c8-recovery`)).default
  const tmp2 = await mkdtemp(path.join(os.tmpdir(), 'topomind-log-c8-'))
  try {
    const blocked = path.join(tmp2, 'not-a-dir')
    await writeFile(blocked, 'x')
    expect('C8', svc2.init({ logDir: path.join(blocked, 'logs'), level: 'DEBUG' }) === true, '目录不可写时 init 不应阻断启动')
    expect('C8', svc2.getWriteStats().dirReady === false, '不可写目录被误判为就绪（_logDir 提前赋值）')
    expect('C8', svc2.getBuffer().some((e: { action?: string }) => e.action === 'app.startup'), '目录不可写时启动日志未进内存缓冲')
    expect('C8', svc2.getWriteStats().pending > 0, '目录不可写时启动日志未进预缓冲队列')
    const wk = path.join(tmp2, 'workspace')
    await mkdir(wk, { recursive: true })
    svc2.enterWorkDir(wk)
    await svc2.drain(2000)
    const c8Today = localDay()
    let restored = ''
    for (let i = 0; i < 40; i += 1) {
      try { restored = await readFile(path.join(wk, 'logs', c8Today, 'internal.log'), 'utf8') } catch { /* 尚未落盘 */ }
      if (restored.includes('日志服务已初始化')) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect('C8', restored.includes('日志服务已初始化'), '目录恢复可写后启动期日志未补写（v2 P0-1 回归）')
    expect('C8', svc2.getWriteStats().dropped === 0, '故障恢复过程出现静默丢弃')
  } finally {
    await rm(tmp2, { recursive: true, force: true })
  }

  // C8-3 accepted 语义 + IPC 入口二次脱敏 + meta 大小上限
  const svc3 = (await import(`${moduleUrl}#c8-boundary`)).default
  const tmp3 = await mkdtemp(path.join(os.tmpdir(), 'topomind-log-c8b-'))
  try {
    svc3.init({ logDir: tmp3, level: 'DEBUG' })
    const bigMeta: Record<string, string> = {}
    for (let i = 0; i < 200; i += 1) bigMeta[`k${i}`] = 'v'.repeat(50)
    const result = svc3.write({
      level: 'INFO', module: 'app', action: 'app.startup', message: 'C8 行为冒烟',
      params: {
        keyword: '机密搜索词', newKeyword: '标题明文', content: '文档正文',
        path: 'C:/Users/75465/secret/文档.md',
      },
      meta: bigMeta,
    })
    expect('C8', result?.accepted === true && result?.durable === false, 'accepted 不应承诺已同步落盘')
    const stats = await svc3.drain(2000)
    expect('C8', stats.pending === 0, 'drain 后仍有待写条目')
    const page = await svc3.query({ date: localDay(), keyword: 'C8 行为冒烟' })
    const found = page.entries.find((e: { message?: string }) => e.message === 'C8 行为冒烟')
    expect('C8', Boolean(found), '未查询到主进程入口写入的条目')
    const dumped = JSON.stringify(found ?? {})
    expect('C8', !dumped.includes('机密搜索词') && !dumped.includes('标题明文') && !dumped.includes('文档正文') && !dumped.includes('C:/Users'), 'log:write 入口脱敏未生效（绕过 buildLogEntry 的调用会泄露）')
    expect('C8', Boolean((found as { meta?: { truncated?: boolean } } | undefined)?.meta?.truncated), 'meta 未做大小上限')
  } finally {
    await rm(tmp3, { recursive: true, force: true })
  }
} catch (error) {
  expect('C8', false, `C8 行为用例异常: ${String(error)}`)
}

// ------------------------------------------------------------
// C9 v3 行为用例（P1）：事件目录、生成产物、分类、批量落盘、分级保留、读时兼容
// v2 的教训：3221 项字符串断言全绿仍漏 16 个缺陷，故新增能力必须跑真实服务实例。
// ------------------------------------------------------------
try {
  const catalog = await import(new URL('../src/shared/observability/eventCatalog.ts', import.meta.url).href)
  const contractV3 = await import(new URL('../src/shared/observability/logContract.ts', import.meta.url).href)
  const generatedCategories = await import(categoriesUrl)

  // C9-1 事件目录：登记率 100% / 自检 / 生成产物逐字一致 / 裸字符串冻结
  const problems = catalog.validateEventCatalog()
  expect('C9', problems.length === 0, `事件目录自检失败: ${problems.join('; ')}`)
  expect('C9', catalog.EVENT_CATALOG.length >= 70, `事件目录规模异常: ${catalog.EVENT_CATALOG.length}`)
  expect('C9', (await read('src/shared/observability/eventTypes.generated.ts')) === buildGeneratedTs(),
    'eventTypes.generated.ts 已过期，请运行 npm run gen:events')
  expect('C9', generatedJs === buildGeneratedJs(),
    'log-categories.generated.js 已过期，请运行 npm run gen:events')
  expect('C9', JSON.stringify(contractV3.CATEGORY_RETENTION_DAYS) === JSON.stringify(generatedCategories.CATEGORY_RETENTION_DAYS),
    'TS 契约与主进程分级保留期不一致')
  for (const spec of catalog.EVENT_CATALOG) {
    expect('C9', catalog.getEventSpec(spec.id) === spec, `事件目录无法按 id 检索: ${spec.id}`)
  }
  let chineseActionCount = 0
  for (const file of sourceFiles) {
    const text = await readFile(file, 'utf8')
    for (const match of text.matchAll(/logAction\(\s*['"]([^'"]+)['"]/g)) {
      if (/[^\x00-\x7F]/.test(match[1])) chineseActionCount += 1
      expect('C9', Boolean(contractV3.getActionSpec(match[1]) || contractV3.LEGACY_ACTION_MAP[match[1]]),
        `${rel(file)} 存在未登记的裸字符串 action: ${match[1]}`)
    }
  }
  // P2 迁移完成前冻结在 106，只允许减少；「字面 0」是 P2 的验收线。
  expect('C9', chineseActionCount <= 106, `中文 action 从冻结线 106 增至 ${chineseActionCount}（P2 应迁移而不是新增）`)
  expect('C9', contractV3.resolveAction('P1 全新未登记动作').registered === false,
    '未登记 action 必须被判定为未注册（采集层记 WARN，门禁直接失败）')

  // C9-2 契约行为：读时归类、显式 category 优先、v3 字段、D3 脱敏、trace/span 作用域
  const legacyCases = [
    { entry: { level: 'ERROR', action: '任意旧错误', module: 'app' }, expected: 'error' },
    { entry: { level: 'INFO', action: '性能:记录', module: 'performance' }, expected: 'performance' },
    { entry: { level: 'INFO', action: 'ui.tab', module: 'ui' }, expected: 'user' },
    { entry: { level: 'INFO', action: 'app.startup', module: 'app' }, expected: 'internal' },
    { entry: { level: 'WARN', action: 'node.create_failed', module: 'graph' }, expected: 'error' },
  ]
  for (const { entry, expected } of legacyCases) {
    expect('C9', contractV3.categoryFromLegacy(entry) === expected, `老日志归类错误: ${JSON.stringify(entry)}`)
  }
  expect('C9', contractV3.categoryFromLegacy({ category: 'user', level: 'ERROR' }) === 'user',
    '显式 category 应优先于规则推断')
  const built = contractV3.buildLogEntry({
    level: 'warn', action: 'kb.open', module: 'kb',
    target: { type: 'node', id: 'n1', label: '机密文档标题' },
  })
  expect('C9', built.v === 3 && built.category === 'user' && built.level === 'WARN',
    'buildLogEntry 未输出 v3 分类 / 等级')
  expect('C9', built.label === '打开知识库', 'buildLogEntry 未从注册表生成中文 label')
  expect('C9', typeof built.target?.label === 'string' && built.target.label.startsWith('[length:'),
    'target.label 未按 D3 保留长度摘要')
  const scoped = contractV3.withTraceId('op', (traceId: string) =>
    contractV3.withSpan('ipc', () => contractV3.buildLogEntry({ action: 'app.startup', message: 'x', traceId })))
  expect('C9', Boolean(scoped.spanId) && String(scoped.traceId).startsWith('op:'),
    'withSpan / withTraceId 未注入 v3 关联键')

  // C9-3 真实主进程：按类分文件、批量写、跨类合并、categories 过滤、会话补全
  const svc9 = (await import(`${moduleUrl}#c9-v3`)).default
  const tmp9 = await mkdtemp(path.join(os.tmpdir(), 'topomind-log-c9-'))
  try {
    svc9.init({ logDir: tmp9, level: 'DEBUG' })
    const session = svc9.getSessionInfo()
    expect('C9', String(session.sessionId).startsWith('sess-'), 'sessionId 未由主进程生成')
    expect('C9', /^[0-9a-f]{8}$/.test(String(session.workspaceId)), 'workspaceId 不是路径短哈希')

    svc9.write({ level: 'INFO', module: 'kb', action: 'kb.open', message: '用户打开知识库' })
    svc9.write({ level: 'INFO', module: 'app', action: 'app.startup', message: '内部启动事件' })
    svc9.write({ level: 'INFO', module: 'performance', action: '性能:记录', message: '性能样本', params: { metric: 'room_load', durationMs: 42 } })
    svc9.write({ level: 'ERROR', module: 'app', action: 'app.error', message: '异常样本', error: { name: 'E', message: 'boom' } })
    for (let i = 0; i < 50; i += 1) {
      svc9.write({ level: 'INFO', module: 'ui', action: 'ui.tab', message: `批量条目 ${i}` })
    }
    await svc9.drain(2000)
    const day9 = localDay()
    const categoryText: Record<string, string> = {}
    for (const category of generatedCategories.LOG_CATEGORY_IDS) {
      let text = ''
      try { text = await readFile(path.join(tmp9, day9, `${category}.log`), 'utf8') } catch { /* 未生成 */ }
      categoryText[category] = text
      expect('C9', text.length > 0, `类别 ${category} 未生成独立物理文件`)
    }
    expect('C9', categoryText.user.includes('用户打开知识库'), 'user 类未落到 user.log')
    expect('C9', categoryText.internal.includes('内部启动事件'), 'internal 类未落到 internal.log')
    expect('C9', categoryText.performance.includes('性能样本'), 'performance 类未落到 performance.log')
    expect('C9', categoryText.error.includes('异常样本'), 'error 类未落到 error.log')
    expect('C9', (categoryText.user.match(/批量条目 /g) ?? []).length === 50, '批量写队列未把 50 条合并落盘')
    expect('C9', svc9.getWriteStats().written >= 54, '批量写统计未累计真实落盘条数')

    const page9 = await svc9.query({ date: day9, limit: 200 })
    expect('C9', page9.entries.length > 0 && page9.entries.every((e: { category?: string }) => Boolean(e.category)),
      'query 未给所有条目补齐 category')
    let ordered = true
    for (let i = 1; i < page9.entries.length; i += 1) {
      const prev = page9.entries[i - 1] as { timestamp?: string }
      const cur = page9.entries[i] as { timestamp?: string }
      if (Date.parse(cur.timestamp ?? '') < Date.parse(prev.timestamp ?? '')) ordered = false
    }
    expect('C9', ordered, '跨类文件未按时间序合并（回放会乱序）')
    const userOnly = await svc9.query({ date: day9, categories: ['user'], limit: 200 })
    expect('C9', userOnly.entries.length > 0 && userOnly.entries.every((e: { category?: string }) => e.category === 'user'),
      'categories 过滤未下推到主进程')
    const found9 = page9.entries.find((e: { message?: string }) => e.message === '用户打开知识库') as
      { sessionId?: string; seq?: number; workspaceId?: string; label?: string } | undefined
    expect('C9', Boolean(found9?.sessionId && Number.isFinite(found9?.seq) && found9?.workspaceId && found9?.label),
      'v3 关联键 / label 未由主进程补全')

    // C9-4 读时兼容：v1 平铺旧文件不重写，查询时补 category / session / label
    const legacyLine = JSON.stringify({
      timestamp: new Date().toISOString(), level: 'ERROR', module: 'app',
      action: '旧中文动作', message: 'v1 历史内容', params: { error: '旧异常文本' },
    })
    await writeFile(path.join(tmp9, `${day9}.log`), `${legacyLine}\n`)
    const legacyPage = await svc9.query({ date: day9, keyword: 'v1 历史内容' })
    const legacy = legacyPage.entries[0] as { v?: number; category?: string; sessionId?: string; label?: string } | undefined
    expect('C9', Boolean(legacy), 'v1 平铺旧文件未被查询读取')
    expect('C9', legacy?.v === 1 && legacy?.category === 'error', 'v1 旧日志读时归类错误')
    expect('C9', String(legacy?.sessionId).startsWith('legacy@') && typeof legacy?.label === 'string',
      'v1 旧日志未补齐 sessionId / label')
    expect('C9', (await svc9.exportJsonl(day9)).includes('v1 历史内容'), 'exportJsonl 未包含旧格式分片')

    // C9-5 分级保留期：60 天前 → user/internal/performance 过期，error（90 天）保留
    const oldDay = localDay(Date.now() - 60 * 24 * 60 * 60 * 1000)
    await mkdir(path.join(tmp9, oldDay), { recursive: true })
    for (const category of generatedCategories.LOG_CATEGORY_IDS) {
      await writeFile(path.join(tmp9, oldDay, `${category}.log`), '{"v":2}\n')
    }
    await writeFile(path.join(tmp9, `${oldDay}.log`), '{"v":1}\n')
    svc9.leaveWorkDir() // 重新激活目录 → 触发 _pruneOldLogs
    expect('C9', !existsSync(path.join(tmp9, oldDay, 'user.log')), 'user 30 天保留期未生效')
    expect('C9', !existsSync(path.join(tmp9, oldDay, 'internal.log')), 'internal 14 天保留期未生效')
    expect('C9', !existsSync(path.join(tmp9, oldDay, 'performance.log')), 'performance 14 天保留期未生效')
    expect('C9', existsSync(path.join(tmp9, oldDay, 'error.log')), 'error 90 天保留期被误删')
    expect('C9', !existsSync(path.join(tmp9, `${oldDay}.log`)), 'v2 平铺旧文件未按 14 天清理')
    expect('C9', svc9.getAvailableDates().includes(day9), 'getAvailableDates 未识别 v3 日期目录')
  } finally {
    await rm(tmp9, { recursive: true, force: true })
  }
} catch (error) {
  expect('C9', false, `C9 v3 行为用例异常: ${String(error)}`)
}

// ------------------------------------------------------------
// C10 P2 单点拦截：结构 + 行为双检（D7 要求新增能力必须带可执行用例）
// ------------------------------------------------------------
const observe = await read('src/core/observe.ts')
const commandRegistry = await read('src/application/commands/commandRegistry.ts')
const pluginLifecycle = await read('src/plugins/host/pluginLifecycle.ts')
const tabActions = await read('src/stores/tabs/tabActions.ts')
const docTypeRegistry = await read('src/features/documents/services/documentTypeRegistry.ts')
const electronApiTypes = await read('src/types/electron-api.ts')

expect('C10', observe.includes('export function recordInternal(') && observe.includes('export function recordUser('), '观察层缺少 recordInternal / recordUser')
expect('C10', observe.includes('export async function observeOperation') && observe.includes('withSpanContext('), '观察层缺少跨异步的 span 上下文恢复')
expect('C10', observe.includes('export function createTimerAudit(') && observe.includes('export function auditInterval('), '观察层缺少定时任务聚合')
expect('C10', preload.includes('AUDIT_LOG_PREFIX') && preload.includes('auditFlush('), 'preload 缺少 IPC 审计聚合器')
expect('C10', preload.includes('setTraceContext:') && electronApiTypes.includes('setTraceContext?'), 'traceId 跨进程透传通道未打通')
expect('C10', /channel\.startsWith\(AUDIT_LOG_PREFIX\)/.test(preload), 'preload 未排除 log:* 通道（审计自放大风险）')
expect('C10', /ipcRenderer\.invoke\('log:write', entry\)/.test(preload), '审计写入未绕过暴露的 invoke 包装')
expect('C10', main.includes('mainLifecycle(') && main.includes("'quit.approved'"), '主进程生命周期/关闭链路埋点缺失')
expect('C10', commandRegistry.includes('observeOperation(') && commandRegistry.includes('LOG_ACTIONS.userCommand'), '命令执行未单点拦截')
expect('C10', pluginLifecycle.includes('recordInternal(') && pluginLifecycle.includes('LOG_ACTIONS.pluginState'), '插件状态机未单点拦截')
for (const file of [
  'src/features/layout/TabBar/TabBar.tsx',
  'src/features/learning-tracker/model/learningTrackerStore.ts',
  'src/domain/persistence/saveCoordinator.ts',
]) {
  expect('C10', (await read(file)).includes('auditInterval('), `${file} 的高频定时任务未聚合`)
}
for (const file of [
  'src/stores/tabs/tabActions.ts',
  'src/features/right-panel/components/DetailTab/DetailPanel.tsx',
  'src/features/graph/GraphPage/components/RoomOverview.tsx',
]) {
  expect('C10', (await read(file)).includes('recordUser('), `${file} 的语义化用户事件未补齐`)
}
expect('C10', /createLogName:\s*LogActionId/.test(docTypeRegistry), 'documentTypeRegistry 的 action 未强类型化')
expect('C10', tabActions.includes('LOG_ACTIONS.userViewOpen'), '视图切换事件未接入事件目录')

// C10-1 中文裸字符串冻结线 = 0（D8：P2 T2.4 的验收线）
const legacyChinese = [...legacyRaws].filter((raw) => /[\u4e00-\u9fff]/.test(raw))
const leftoverChinese: string[] = []
for (const file of sourceFiles) {
  if (rel(file) === CONTRACT) continue // 登记表与兼容映射本身必须保留中文
  const text = await readFile(file, 'utf8')
  for (const match of text.matchAll(/logAction\(\s*['"]([^'"]+)['"]/g)) {
    if (/[\u4e00-\u9fff]/.test(match[1])) leftoverChinese.push(`${rel(file)} logAction("${match[1]}")`)
  }
  for (const raw of legacyChinese) {
    if (text.includes(`'${raw}'`) || text.includes(`"${raw}"`)) leftoverChinese.push(`${rel(file)} "${raw}"`)
  }
}
expect('C10', leftoverChinese.length === 0,
  `P2 中文 action 裸字符串冻结线未清零（${leftoverChinese.length} 处）: ${leftoverChinese.slice(0, 4).join('; ')}`)
expect('C10', legacyChinese.length >= 90, '兼容映射中文条目异常减少，迁移脚本可能误删登记表')

// C10-2 采集层行为：因果链、用户三件套、定时任务聚合、logAction 自动补字段
interface C10Entry {
  action?: string
  category?: string
  traceId?: string
  spanId?: string
  parentId?: string
  target?: { type?: string; id?: string }
  result?: string
  params?: Record<string, unknown>
  [key: string]: unknown
}
const c10Captured: C10Entry[] = []
const c10Global = globalThis as unknown as { window?: unknown }
const previousWindow = c10Global.window
c10Global.window = {
  electronAPI: {
    invoke: (channel: string, entry: unknown) => {
      if (channel.startsWith('log:')) c10Captured.push(entry as C10Entry)
      return Promise.resolve({ accepted: true })
    },
    on() {}, off() {}, send() {}, setTraceContext() {},
  },
}
try {
  const observeUrl = pathToFileURL(path.join(root, 'src/core/observe.ts')).href
  const backendUrl = pathToFileURL(path.join(root, 'src/core/log-backend.ts')).href
  const obs = await import(observeUrl)
  const backend = await import(backendUrl)

  // 一次操作 = 1 个 trace，用户事件是根 span，内部事件是独立子 span。
  c10Captured.length = 0
  await obs.observeOperation('user.command', { target: { type: 'command', id: 'nav.openSettings' } }, async () => {
    void obs.recordInternal({ action: 'ipc.invoke', source: 'preload', params: { channel: 'fs:listKBs' } })
    void obs.recordInternal({ action: 'plugin.state', source: 'plugin-lifecycle' })
  })
  expect('C10', c10Captured.length === 3, `一次操作应产生 1 user + 2 internal 共 3 条，实际 ${c10Captured.length}`)
  expect('C10', new Set(c10Captured.map((e) => e.traceId)).size === 1, '同一次操作的 traceId 不一致（因果链断裂）')
  const userEntry = c10Captured.find((e) => e.action === 'user.command')
  const internals = c10Captured.filter((e) => e.category === 'internal')
  expect('C10', Boolean(userEntry) && userEntry?.category === 'user', '用户事件未归到 user 类')
  expect('C10', userEntry?.target?.id === 'nav.openSettings' && userEntry?.result === 'success', '用户事件 target/result 缺失')
  expect('C10', internals.length === 2 && new Set(internals.map((e) => e.spanId)).size === 2, '内部步骤未生成独立子 span')
  expect('C10', internals.every((e) => e.parentId === userEntry?.spanId), '内部 span 的 parentId 未指向用户事件根 span')

  // 定时任务：窗口内零落盘，flush 后一条聚合。
  c10Captured.length = 0
  const timer = obs.createTimerAudit('c10-probe', 60_000)
  timer.tick('success', 3)
  timer.tick('failure', 7)
  expect('C10', c10Captured.length === 0, '高频 tick 未按分钟聚合（会淹没可读日志）')
  timer.flush()
  const aggregate = c10Captured[0]
  expect('C10', aggregate?.action === 'timer.aggregate' && aggregate?.category === 'internal', '定时任务汇总事件缺失')
  expect('C10', aggregate?.params?.runs === 2 && aggregate?.params?.failures === 1 && aggregate?.params?.maxMs === 7,
    '定时任务汇总统计不正确')

  // logAction 单点补齐 v3 三件套；失败类 action 自动归 error 且 result=failure。
  c10Captured.length = 0
  await backend.logAction('node.create', 'graph', { nodeId: 'n1' })
  await backend.logAction('document.save_failed', 'document', {})
  expect('C10', c10Captured.length === 2, 'logAction 写入数量异常')
  expect('C10', c10Captured[0]?.target?.type === 'graph' && c10Captured[0]?.result === 'success'
    && typeof c10Captured[0]?.traceId === 'string' && c10Captured[0]?.category === 'user',
  'logAction 未自动补齐 target / result / trace')
  expect('C10', c10Captured[1]?.category === 'error' && c10Captured[1]?.result === 'failure',
    '失败类 action 未归 error 类或未标记 failure')
} catch (error) {
  expect('C10', false, `C10 采集层行为用例异常: ${String(error)}`)
} finally {
  if (previousWindow === undefined) delete c10Global.window
  else c10Global.window = previousWindow
}

// C10-3 preload 行为：排除日志通道、失败即明细、跨窗口聚合、traceId 透传
try {
  const mockPrelude = `
const __writes = [];
const contextBridge = { exposeInMainWorld: (_key, value) => { globalThis.__tmPreloadApi = value; } };
const ipcRenderer = {
  invoke: (channel, ...args) => {
    if (channel === 'log:write') { __writes.push(args[0]); globalThis.__tmPreloadWrites = __writes; return Promise.resolve({ accepted: true }); }
    // 必须用真实在白名单中的通道，否则 preload 会提前拒绝、进不到审计逻辑。
    if (channel === 'fs:readTopoDocument') return Promise.reject(new Error('c10 probe failure'));
    return Promise.resolve('ok');
  },
  send: () => {}, on: () => {}, off: () => {},
};
globalThis.__tmPreloadWrites = __writes;
`
  const preloadPatched = preload.replace("import { contextBridge, ipcRenderer } from 'electron';", mockPrelude)
  const preloadUrl = `data:text/javascript;base64,${Buffer.from(preloadPatched).toString('base64')}`
  const c10Any = globalThis as unknown as Record<string, unknown>
  const realNow = Date.now
  let clockOffset = 0
  Date.now = () => realNow() + clockOffset
  try {
    await import(preloadUrl)
    const api = c10Any.__tmPreloadApi as {
      setTraceContext: (id: string | null) => void
      invoke: (channel: string) => Promise<unknown>
    }
    const writes = c10Any.__tmPreloadWrites as C10Entry[]
    api.setTraceContext('trace-c10')
    await api.invoke('fs:listKBs')
    expect('C10', writes.length === 0, '正常 IPC 调用在聚合窗口内不应逐条落盘')
    await api.invoke('log:getBuffer')
    expect('C10', writes.length === 0, 'log:* 通道未被排除，存在 invoke → 日志 → invoke 自放大')
    await api.invoke('fs:readTopoDocument').catch(() => {})
    expect('C10', writes.length === 1 && writes[0]?.action === 'ipc.invoke', '失败调用未即时记明细')
    expect('C10', writes[0]?.outcome === 'failure' && writes[0]?.traceId === 'trace-c10',
      '失败明细未带 outcome 或未透传渲染侧 traceId')
    clockOffset = 60_001
    await api.invoke('fs:listKBs')
    expect('C10', writes.length === 2 && writes[1]?.action === 'ipc.audit', '跨时间窗未写聚合汇总')
    expect('C10', Number(writes[1]?.params?.totalCalls) >= 1 && Array.isArray(writes[1]?.params?.channels),
      '聚合汇总缺少按通道分组统计')
    expect('C10', !('traceId' in (writes[1] ?? {})), '60s 聚合汇总被误归到某次用户操作链路（P5 显式独立）')
  } finally {
    Date.now = realNow
    delete c10Any.__tmPreloadApi
    delete c10Any.__tmPreloadWrites
  }
} catch (error) {
  expect('C10', false, `C10 preload 行为用例异常: ${String(error)}`)
}

// ------------------------------------------------------------
// C11 P3 崩溃闭环：结构 + 行为双检（D7）
// ------------------------------------------------------------
const blackbox = await read('src/core/blackbox.ts')
expect('C11', main.includes('crashReporter.start('), '主进程未启用 crashReporter')
expect('C11', /uploadToServer:\s*false/.test(main), 'crashReporter 必须禁止远程上报')
expect('C11', main.includes("app.setPath('crashDumps'"), '未设置本地 crashDumps 目录')
expect('C11', main.includes('LogService.markSessionClean(') && main.includes('LogService.markSessionCrashed('), '关闭/崩溃链路未标记 session 状态')
expect('C11', service.includes('appendFileSync(') && service.includes('_writeErrorSync('), 'error 类缺少独立同步落盘句柄')
expect('C11', service.includes('app.crash_recovered') && service.includes('SESSION_FILE_NAME'), '缺少 session.json 异常退出恢复报告')
expect('C11', service.includes('exportDiagnosticBundle('), '缺少一键诊断包')
expect('C11', service.includes("ipcMain.on('log:breadcrumbs'"), '黑匣子镜像通道未在主进程注册')
expect('C11', sendAllowed.has('log:breadcrumbs'), 'preload 未放行黑匣子镜像 send 通道')
expect('C11', blackbox.includes('pointerdown') && blackbox.includes('logPushBreadcrumbs('), '渲染侧黑匣子未采集原始输入')
expect('C11', !/console\.(?:log|warn|error|info|debug)\s*\(/.test(blackbox), '黑匣子写了裸 console（C6 冻结线零余量）')
expect('C11', !blackbox.includes('.invoke('), '黑匣子不应走 invoke（IPC 审计与自放大风险）')
expect('C11', contract.includes('fingerprint?: string') && contract.includes('breadcrumbs?: Breadcrumb[]'), '契约缺少 P3 error 专属字段')
expect('C11', filterBar.includes('exportBundle'), '监控页缺少诊断包导出入口')

try {
  const svc11 = (await import(`${moduleUrl}#c11-error`)).default
  const tmp11 = await mkdtemp(path.join(os.tmpdir(), 'topomind-log-p3-'))
  const day11 = localDay()
  const errorFile = path.join(tmp11, day11, 'error.log')
  try {
    svc11.init({ logDir: tmp11, level: 'DEBUG', appVersion: '9.9.9' })
    expect('C11', svc11.getSessionInfo().status === 'running', 'session.json 启动后状态不是 running')
    // 上次会话尾部事件：恢复报告要靠它们重建面包屑。
    for (let i = 0; i < 25; i += 1) {
      svc11.write({ level: 'INFO', module: 'ui', action: 'ui.tab', message: `会话轨迹 ${i}`, params: { index: i } })
    }
    await mkdir(path.join(tmp11, 'crashes'), { recursive: true })
    await writeFile(path.join(tmp11, 'crashes', 'fake-crash.dmp'), 'minidump')

    // C11-1 黑匣子只进内存，且拒绝明文控件文案
    const crumbs = []
    for (let i = 0; i < 25; i += 1) {
      crumbs.push({
        t: Date.now() + i, type: i % 2 ? 'pointerdown' : 'keydown', seq: i + 1, view: '/app',
        target: { tag: 'button', id: `btn-${i}`, label: i === 0 ? '机密文档标题' : `[length:${i}]` },
      })
    }
    expect('C11', svc11.pushBreadcrumbs(crumbs) === 25, '主进程黑匣子未接纳 25 条镜像')
    expect('C11', svc11.getBreadcrumbs(50).length === 25, '黑匣子内存缓冲长度不正确')
    expect('C11', !svc11.getBreadcrumbs(50).some((c: { target?: { label?: string } }) => c.target?.label === '机密文档标题'), '明文控件文案未被拒绝')
    expect('C11', !existsSync(path.join(tmp11, 'breadcrumbs.log')), '原始输入被单独落盘（违反 D2）')

    // C11-2 error 同步落盘 + 崩溃上下文
    const errInput = {
      level: 'ERROR', module: 'app', action: 'app.error', message: 'P3 同步异常',
      error: { name: 'CrashError', message: 'boom at line 12' },
    }
    const r1 = svc11.write(errInput)
    expect('C11', r1?.accepted === true && r1?.durable === true, 'error 类未同步落盘（durable 应为 true）')
    // 不 await drain：同步句柄写入后文件必须立刻可读。
    const immediate = readFileSync(errorFile, 'utf8').trim().split('\n').filter(Boolean)
    expect('C11', immediate.join('\n').includes('P3 同步异常'), 'error 日志未在未 drain 时立即落盘')
    const first = JSON.parse(immediate[immediate.length - 1])
    expect('C11', Array.isArray(first.breadcrumbs) && first.breadcrumbs.length >= 20, '崩溃事件面包屑少于 20 条')
    expect('C11', /^fp-[0-9a-f]{8}$/.test(first.fingerprint ?? ''), '错误指纹格式不正确')
    expect('C11', first.dumpRef?.available === true && first.dumpRef?.file === 'fake-crash.dmp', 'dumpRef 未引用本地 minidump')
    expect('C11', Boolean(first.env?.platform && first.env?.node && first.env?.appVersion === '9.9.9'), 'error 日志缺少运行环境快照')
    const infoResult = svc11.write({ level: 'INFO', module: 'app', action: 'app.startup', message: '非 error 仍是异步' })
    expect('C11', infoResult?.durable === false, '非 error 类不应承诺同步落盘')

    const r2 = svc11.write(errInput)
    const r3 = svc11.write({ ...errInput, error: { name: 'CrashError', message: 'different failure 99' } })
    expect('C11', r2?.durable === true && r3?.durable === true, '后续 error 未走同步通道')
    const errorLines = readFileSync(errorFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    expect('C11', errorLines[0].fingerprint === errorLines[1].fingerprint, '相同错误指纹不稳定')
    expect('C11', errorLines[2].fingerprint !== errorLines[0].fingerprint, '不同错误被误并到同一指纹')

    // C11-3 诊断包：四类日志、指纹聚合、二次脱敏、session/env/dump
    svc11.write({
      level: 'INFO', module: 'document', action: 'document.save', message: '保存文档',
      params: { content: '绝密正文ABC', path: 'C:/Users/75465/secret/文档.md', documentTitle: '机密标题' },
    })
    await svc11.drain(2000)
    const bundle1 = JSON.parse(svc11.exportDiagnosticBundle())
    expect('C11', bundle1.schema === 'topomind-diagnostic-bundle/1', '诊断包 schema 不正确')
    for (const category of ['user', 'internal', 'performance', 'error']) {
      expect('C11', Array.isArray(bundle1.logs[category]), `诊断包缺少 ${category} 类日志`)
    }
    expect('C11', bundle1.logs.error.length >= 3, '诊断包未汇总已落盘的 error 日志')
    expect('C11', bundle1.errors.length >= 2 && bundle1.errors.some((row: { count: number }) => row.count >= 2), '诊断包未按 fingerprint 聚合错误')
    expect('C11', Boolean(bundle1.env?.platform && bundle1.dumpRef && bundle1.session?.file?.status), '诊断包缺少 env / dumpRef / session')
    const bundleText = JSON.stringify(bundle1)
    expect('C11', !bundleText.includes('绝密正文ABC') && !bundleText.includes('机密标题') && !bundleText.includes('C:/Users'), '诊断包二次脱敏失效')
    expect('C11', bundle1.logs.internal.some((e: { label?: string }) => typeof e.label === 'string' && e.label.startsWith('[length:')), '导出前 label 未降级为长度摘要')

    // C11-4 D5 双目录汇总
    const workDir11 = path.join(tmp11, 'workspace')
    await mkdir(workDir11, { recursive: true })
    svc11.enterWorkDir(workDir11)
    await svc11.drain(2000)
    const bundle2 = JSON.parse(svc11.exportDiagnosticBundle())
    expect('C11', bundle2.directories.length === 2 && bundle2.directories.some((d: { role: string }) => d.role === 'fallback'), '诊断包未汇总当前/兜底双目录')
    expect('C11', bundle2.fallbackErrors.length >= 3, '兜底目录 error 日志未进入诊断包')

    // C11-5 故意不 markSessionClean，模拟进程被杀；新实例启动应生成恢复报告。
    const svc11b = (await import(`${moduleUrl}#c11-recovery`)).default
    svc11b.init({ logDir: tmp11, level: 'DEBUG' })
    await svc11b.drain(2000)
    const recovered = readFileSync(errorFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    const report = recovered.find((e: { action?: string }) => e.action === 'app.crash_recovered')
    expect('C11', Boolean(report), '下次启动未生成异常退出恢复报告')
    expect('C11', Array.isArray(report?.breadcrumbs) && report.breadcrumbs.length >= 20, '恢复报告面包屑少于 20 条')
    expect('C11', Boolean(report?.dumpRef) && typeof report?.fingerprint === 'string', '恢复报告缺少 dumpRef / fingerprint')
    expect('C11', Number(report?.params?.tailCount) >= 20, '恢复报告未带上一次会话尾部事件')

    // C11-6 干净退出不得误报崩溃
    svc11b.markSessionClean()
    const reportCount = recovered.filter((e: { action?: string }) => e.action === 'app.crash_recovered').length
    const svc11c = (await import(`${moduleUrl}#c11-clean`)).default
    svc11c.init({ logDir: tmp11, level: 'DEBUG' })
    await svc11c.drain(2000)
    const afterClean = readFileSync(errorFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    expect('C11', afterClean.filter((e: { action?: string }) => e.action === 'app.crash_recovered').length === reportCount, '干净退出被误判为崩溃')
  } finally {
    await rm(tmp11, { recursive: true, force: true })
  }

  // C11-7 渲染侧黑匣子：只镜像、脱敏、不触发 invoke
  const c11Any = globalThis as unknown as Record<string, unknown>
  const prevWindow = c11Any.window
  const prevDocument = c11Any.document
  const prevElement = c11Any.Element
  interface C11Sent { ch: string; payload: unknown }
  const sent: C11Sent[] = []
  const listeners = new Map<string, (event: unknown) => void>()
  class FakeElement {
    constructor(tag, attrs) { this.tagName = String(tag).toUpperCase(); this.attrs = attrs || {} }
    getAttribute(name) { return this.attrs[name] ?? null }
  }
  c11Any.Element = FakeElement
  c11Any.window = {
    location: { pathname: '/app' },
    electronAPI: {
      invoke() { return Promise.resolve({ accepted: true }) },
      send(ch, payload) { sent.push({ ch, payload }) },
      on() {}, off() {},
    },
  }
  c11Any.document = {
    addEventListener(type, handler) { listeners.set(type, handler) },
    removeEventListener(type) { listeners.delete(type) },
  }
  try {
    const bb = await import(`${pathToFileURL(path.join(root, 'src/core/blackbox.ts')).href}#c11-blackbox`)
    const uninstall = bb.installBlackbox()
    expect('C11', listeners.size === 4, '黑匣子未接管 4 类原始输入事件')
    const button = new FakeElement('button', { id: 'save', 'aria-label': '机密文档标题', role: 'button' })
    for (let i = 0; i < 20; i += 1) listeners.get('pointerdown')?.({ target: button })
    expect('C11', sent.length === 1 && sent[0].ch === 'log:breadcrumbs', '黑匣子未批量镜像到主进程 send 通道')
    const batch = sent[0]?.payload as Array<{ target?: { label?: string } }> | undefined
    expect('C11', Array.isArray(batch) && batch.length === 20, '镜像批次条数不正确')
    expect('C11', Boolean(batch?.every((crumb) => typeof crumb.target?.label === 'string' && crumb.target.label.startsWith('[length:'))), '控件文案未脱敏为长度摘要')
    uninstall()
  } finally {
    if (prevWindow === undefined) delete c11Any.window
    else c11Any.window = prevWindow
    if (prevDocument === undefined) delete c11Any.document
    else c11Any.document = prevDocument
    if (prevElement === undefined) delete c11Any.Element
    else c11Any.Element = prevElement
  }
} catch (error) {
  expect('C11', false, `C11 行为用例异常: ${String(error)}`)
}

// ------------------------------------------------------------
// C12 P4 五视图 / 查询索引 / 事件覆盖率（结构 + 行为双检）
// ------------------------------------------------------------
try {
  // --- C12-1 事件目录逐项覆盖率核对表 ---
  const c12Coverage = buildCoverageReport()
  const c12CoverageDisk = await read('docs/design/event-coverage.md')
  expect('C12', c12Coverage.markdown === c12CoverageDisk, '事件覆盖率表产物过期，请运行 npm run gen:coverage')
  expect('C12', c12Coverage.summary.total >= 90, '覆盖率表事件数异常')
  expect('C12', c12Coverage.summary.unconfirmed === 0, `仍有未核对事件: ${c12Coverage.unconfirmedIds.join(', ')}`)
  expect('C12', c12Coverage.markdown.includes('静态引用 ≠ 运行时必然产生'), '覆盖率表缺少口径声明，禁止冒充运行时覆盖率')
  expect('C12', c12Coverage.markdown.includes('保留未启用'), '覆盖率表未标注「保留未启用」及其理由')
  const c12Pkg = await read('package.json')
  expect('C12', c12Pkg.includes('gen:coverage'), 'package.json 缺少 gen:coverage 入口')

  // --- C12-2 视图模型纯函数：分组 / span 树 / 采样 / 指纹 / 回放 ---
  const c12Vm = await import(`${pathToFileURL(path.join(root, 'src/shared/observability/logViewModel.ts')).href}#c12-vm`)
  const c12Mk = (i: number, extra: Record<string, unknown> = {}) => ({
    v: 3, id: `c12-${i}`, timestamp: new Date(1700000000000 + i * 10).toISOString(),
    level: 'INFO', action: 'ui.tab', label: '切换标签页', category: 'internal',
    sessionId: 'sess-c12', seq: i, traceId: `trace-${Math.floor((i - 1) / 3)}`,
    spanId: `span-${i}`, parentId: i % 3 === 1 ? null : `span-${i - 1}`,
    message: `c12 event ${i}`, params: { n: i }, ...extra,
  })
  const c12Entries = Array.from({ length: 12 }, (_, i) => c12Mk(i + 1))
  const c12Sorted = c12Vm.sortByTime([...c12Entries].reverse())
  expect('C12', c12Sorted.length === 12 && c12Sorted[0].id === 'c12-1', 'sortByTime 未按 timestamp+seq 排序')
  const c12Sessions = c12Vm.groupBySession(c12Entries)
  expect('C12', c12Sessions.length === 1 && c12Sessions[0].entryCount === 12, 'groupBySession 分组错误')
  const c12Traces = c12Vm.groupByTrace(c12Entries)
  expect('C12', c12Traces.length === 4 && c12Traces.every((g: { entries: unknown[] }) => g.entries.length === 3), 'groupByTrace 未按 traceId 折叠')
  const c12Tree = c12Vm.flattenSpanTree(c12Vm.buildSpanTree(c12Entries))
  expect('C12', c12Tree.some((n: { depth: number }) => n.depth > 0), 'buildSpanTree 未建立 parentId 层级')
  const c12WithUserError = [
    ...c12Entries,
    c12Mk(13, { category: 'user', level: 'INFO', traceId: 'trace-u' }),
    c12Mk(14, { category: 'error', level: 'ERROR', traceId: 'trace-e', fingerprint: 'fp-c12', breadcrumbs: [{ t: 1, type: 'pointerdown', seq: 1 }] }),
  ]
  const c12Sampled = c12Vm.applyDisplaySample(c12WithUserError, 0.1)
  expect('C12', c12Sampled.some((e: { id: string }) => e.id === 'c12-13') && c12Sampled.some((e: { id: string }) => e.id === 'c12-14'), '显示采样误删了 user/error 事件')
  expect('C12', c12Sampled.length < c12WithUserError.length, '显示采样未对 internal 降采样')
  const c12Errors = c12Vm.groupErrorsByFingerprint(c12WithUserError)
  expect('C12', c12Errors.length === 1 && c12Errors[0].count === 1 && c12Errors[0].breadcrumbCount === 1, '错误指纹聚合错误')
  expect('C12', c12Vm.findRecoveryReports([c12Mk(15, { action: 'app.crash_recovered' })]).length === 1, '恢复报告识别失败')
  expect('C12', c12Vm.flattenBreadcrumbs(c12WithUserError[13]).length === 1, 'breadcrumbs 展开失败')
  expect('C12', c12Vm.userEventForTrace(c12WithUserError, 'trace-u')?.id === 'c12-13', '慢样本反查用户事件失败')
  expect('C12', c12Vm.replaySteps(c12Entries).length === 12, '回放步骤数错误')
  expect('C12', c12Vm.filterViewEntries(c12Entries, { sessionId: 'none' }).length === 0, 'session 过滤失效')

  // --- C12-3 五视图与控制条结构 ---
  const c12Page = await read('src/plugins/builtin/monitor/MonitorPage.tsx')
  for (const c12View of ['TimelineView', 'SpanView', 'ErrorView', 'ControlBar', 'PerformanceTab', 'PluginDiagnosticsPanel']) {
    expect('C12', c12Page.includes(c12View), `MonitorPage 未编排 ${c12View}`)
  }
  const c12Store = await read('src/plugins/public/monitorStore.ts')
  for (const c12Tab of ['timeline', 'spans', 'errors', 'performance', 'plugins', 'log']) {
    expect('C12', c12Store.includes(`'${c12Tab}'`), `MonitorState 缺少视图 ${c12Tab}`)
  }
  const c12Bar = await read('src/plugins/builtin/monitor/components/ControlBar.tsx')
  for (const c12Key of ['runtimeLevel', 'selectedSessionId', 'detailed', 'displaySampleRate', 'streaming', 'replayCursor']) {
    expect('C12', c12Bar.includes(c12Key), `统一控制条缺少 ${c12Key}`)
  }
  expect('C12', c12Bar.includes('TM_UI'), '新增 UI 文件未按设计系统使用 TM_UI 控件常量')
  const c12Perf = await read('src/plugins/builtin/monitor/PerformanceTab.tsx')
  expect('C12', c12Perf.includes('traceId: selectedTraceId') && c12Perf.includes('focusTrace'), '性能慢样本缺少用户事件反查')
  const c12Contract = await read('src/shared/observability/logContract.ts')
  const c12Backend = await read('src/core/log-backend.ts')
  const c12Boot = await read('src/plugins/bootstrap.ts')
  const c12ServiceSrc = await read('electron/log-service.js')
  expect('C12', c12Contract.includes('traceId?: string'), 'LogQueryInput 缺少 traceId')
  expect('C12', c12Backend.includes('traceId: opts.traceId') && c12Boot.includes('traceId: input?.traceId'), 'traceId 查询未透传到主进程')
  expect('C12', c12Boot.includes('categories: input?.categories') && c12Boot.includes('sessionId: input?.sessionId'), '查询条件未完整下推')
  expect('C12', c12Boot.includes('guard < 200'), 'queryAllLogs 分页上限未覆盖 10 万条')
  expect('C12', c12ServiceSrc.includes('_buildFileIndex') && c12ServiceSrc.includes('_readIndexedEntries'), '主进程缺少行偏移索引')

  // --- C12-3b 日期口径 D12：分片 / 筛选 / 导出必须同为「用户本地日」 ---
  const c12Formatting = await read('src/shared/observability/logFormatting.tsx')
  const c12Bundle = await read('src/plugins/builtin/monitor/utils/bundleExport.ts')
  expect('C12', c12Contract.includes('export function logDayKey') && c12Contract.includes('getFullYear()'),
    '契约缺少本地日期键 logDayKey（D12）')
  expect('C12', c12Formatting.includes('logDayKey') && c12Boot.includes('logDayKey') && c12Bundle.includes('logDayKey'),
    '渲染侧日期未统一走 logDayKey（D12）')
  expect('C12', !/toISOString\(\)\s*\.slice\(0,\s*10\)/.test([c12Formatting, c12Boot, c12Bundle, c12ServiceSrc].join('\n')),
    '日志链路仍用 UTC 日期，UTC+ 时区凌晨会查不到当天日志（D12 回归）')
  expect('C12', /function _dateStr[\s\S]{0,300}getFullYear\(\)/.test(c12ServiceSrc),
    '主进程分片未使用本地日期（D12 回归）')

  // --- C12-4 索引行为：10 万条 fixture / total / 有序 / 过滤 / 增量 / 坏行 ---
  // 独立实例：只让服务自己创建日期目录，直接验证分片名 == 本地日（而非 UTC 日）。
  const c12DaySvc = (await import(`${moduleUrl}#c12-day`)).default
  const c12DayTmp = await mkdtemp(path.join(os.tmpdir(), 'topomind-log-c12-day-'))
  c12DaySvc.init({ logDir: c12DayTmp, level: 'INFO' })
  await c12DaySvc.drain()
  const c12CreatedDays = (await readdir(c12DayTmp)).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
  expect('C12', c12CreatedDays.length === 1 && c12CreatedDays[0] === localDay(),
    `主进程分片日期口径错误: 实际 ${c12CreatedDays.join(',')}，期望 ${localDay()}（UTC 与本地跨日时最易暴露）`)
  expect('C12', c12DaySvc.getAvailableDates().includes(localDay()), 'getAvailableDates 未返回本地当日分片')
  await rm(c12DayTmp, { recursive: true, force: true })

  const c12Tmp = await mkdtemp(path.join(os.tmpdir(), 'topomind-log-c12-'))
  const c12Date = localDay()
  const c12Day = path.join(c12Tmp, c12Date)
  await mkdir(c12Day, { recursive: true })
  const c12Cats = ['user', 'internal', 'performance', 'error']
  const c12Per = 25000
  // fixture 时间戳也按本地午夜起算，避免 UTC 基准把样本推到相邻自然日。
  const c12Base = new Date(
    Number(c12Date.slice(0, 4)),
    Number(c12Date.slice(5, 7)) - 1,
    Number(c12Date.slice(8, 10)),
    0, 0, 0, 0,
  ).getTime()
  for (let c = 0; c < c12Cats.length; c += 1) {
    const c12Chunks: string[] = []
    for (let i = 0; i < c12Per; i += 1) {
      const seq = c * c12Per + i + 1
      c12Chunks.push(`${JSON.stringify({
        v: 3, id: `p4-${seq}`, timestamp: new Date(c12Base + seq * 10).toISOString(),
        level: c12Cats[c] === 'error' ? 'ERROR' : 'INFO',
        module: 'app', action: c12Cats[c] === 'user' ? 'ui.tab' : 'app.startup',
        label: c12Cats[c] === 'user' ? '切换标签页' : '内部事件', category: c12Cats[c],
        sessionId: 'sess-c12', seq, traceId: `trace-${Math.floor(seq / 10)}`,
        message: `c12 ${c12Cats[c]} ${seq}`, params: { bucket: seq % 97 },
      })}\n`)
    }
    await writeFile(path.join(c12Day, `${c12Cats[c]}.log`), c12Chunks.join(''), 'utf8')
  }
  const c12Svc = (await import(`${moduleUrl}#c12-index`)).default
  c12Svc.init({ logDir: c12Tmp, level: 'INFO' })
  await c12Svc.drain()

  const c12Timings: number[] = []
  let c12First: { entries: Array<{ timestamp?: string }>; total: number; parseErrors: number } | null = null
  for (let p = 0; p < 6; p += 1) {
    const t0 = performance.now()
    const page = await c12Svc.query({ date: c12Date, categories: ['user'], limit: 200, offset: p * 200 })
    c12Timings.push(performance.now() - t0)
    if (p === 0) c12First = page
  }
  expect('C12', c12First !== null && c12First.entries.length === 200 && c12First.total === c12Per, `10 万条索引首页 total 错误: ${c12First?.total}`)
  expect('C12', c12First !== null && c12First.parseErrors === 0, '索引模式误报坏行')
  expect('C12', c12First !== null && c12First.entries.every((e, i, arr) => i === 0 || Date.parse(arr[i - 1].timestamp ?? '') <= Date.parse(e.timestamp ?? '')), '索引分页未保持时间序')
  const c12Stats = c12Svc.getQueryStats()
  expect('C12', c12Stats.fallbacks === 0, '正常分片不应触发流式回退')
  expect('C12', c12Stats.hits >= 5, '查询计划缓存未命中（分页仍在重复全量解析）')
  const c12Steady = c12Timings.slice(1).sort((a, b) => a - b)
  const c12P95 = c12Steady[Math.floor(c12Steady.length * 0.95)]
  expect('C12', c12P95 < 300, `10 万条稳定态查询 P95 ${c12P95.toFixed(1)}ms >= 300ms`)
  expect('C12', c12Timings[0] < 1500, `10 万条冷启动建索引 ${c12Timings[0].toFixed(1)}ms 过慢`)

  const c12Keyword = await c12Svc.query({ date: c12Date, keyword: 'c12 user 24999', limit: 10 })
  expect('C12', c12Keyword.total === 1 && c12Keyword.entries[0]?.id === 'p4-24999', '索引 keyword 过滤与主进程口径不一致')
  const c12Trace = await c12Svc.query({ date: c12Date, traceId: 'trace-1', limit: 10 })
  expect('C12', c12Trace.total === 10, `traceId 反查应命中 10 条，实际 ${c12Trace.total}`)
  const c12Session = await c12Svc.query({ date: c12Date, sessionId: 'sess-other', limit: 10 })
  expect('C12', c12Session.total === 0, 'sessionId 过滤失效（fixture 全部属于 sess-c12）')

  // 先让 internal 分片建索引，再验证写入成功后的增量追加
  await c12Svc.query({ date: c12Date, categories: ['internal'], limit: 1 })
  c12Svc.write({ level: 'INFO', module: 'app', action: 'app.startup', category: 'internal', message: 'c12 incremental probe' })
  await c12Svc.drain()
  expect('C12', c12Svc.getQueryStats().appended >= 1, '写入成功后索引未增量追加')
  const c12Incremental = await c12Svc.query({ date: c12Date, keyword: 'c12 incremental probe', limit: 10 })
  expect('C12', c12Incremental.total === 1, '增量索引的新条目查不到')

  await writeFile(path.join(c12Day, 'user.log'), '{broken json}\n', { encoding: 'utf8', flag: 'a' })
  const c12Bad = await c12Svc.query({ date: c12Date, categories: ['user'], limit: 1 })
  expect('C12', c12Bad.parseErrors === 1, '坏行计数在索引模式下丢失')

  // --- C12-5 CRLF / 非精确文件必须回退流式且结果不丢 ---
  const c12CrlfTmp = await mkdtemp(path.join(os.tmpdir(), 'topomind-log-c12-crlf-'))
  const c12CrlfLine = `${JSON.stringify({ v: 1, timestamp: new Date(c12Base + 1000).toISOString(), level: 'INFO', action: 'ui.tab', message: 'legacy crlf' })}\r\n`
  await writeFile(path.join(c12CrlfTmp, `${c12Date}.log`), c12CrlfLine + c12CrlfLine, 'utf8')
  const c12CrlfSvc = (await import(`${moduleUrl}#c12-crlf`)).default
  c12CrlfSvc.init({ logDir: c12CrlfTmp, level: 'INFO' })
  await c12CrlfSvc.drain()
  const c12CrlfRes = await c12CrlfSvc.query({ date: c12Date, limit: 10 })
  expect('C12', c12CrlfSvc.getQueryStats().fallbacks >= 1, 'CRLF 文件未触发流式回退')
  expect('C12', c12CrlfRes.total >= 2, 'CRLF 回退后历史日志丢失')

  await rm(c12Tmp, { recursive: true, force: true })
  await rm(c12CrlfTmp, { recursive: true, force: true })
} catch (error) {
  expect('C12', false, `C12 行为用例异常: ${String(error)}`)
}

// ------------------------------------------------------------
// C13 P5 真实链路：由拦截层产生的日志必须真的成链
//
// C12 的视图模型用例用的是手工构造的共享 traceId，因此全绿却漏掉了
// 「真实埋点里每条 logAction 各生成一个 traceId」这个缺陷（事件流退化成
// 一条条独立消息）。本组用例直接驱动 recordUser / logAction / recordInternal，
// 用捕获到的真实条目验证分组结果，不再用理想 fixture。
// ------------------------------------------------------------
try {
  const c13Captured: C10Entry[] = []
  const c13Mirror: Array<string | null> = []
  const c13Global = globalThis as unknown as { window?: unknown }
  const c13PrevWindow = c13Global.window
  c13Global.window = {
    electronAPI: {
      invoke: (channel: string, entry: unknown) => {
        if (channel.startsWith('log:')) c13Captured.push(entry as C10Entry)
        return Promise.resolve({ accepted: true })
      },
      on() {}, off() {}, send() {},
      setTraceContext: (id: string | null) => { c13Mirror.push(id) },
    },
  }
  try {
    // 不能用 #fragment：observe.ts 与 logContract 必须共享同一份交互窗口状态。
    const c13Obs = await import(pathToFileURL(path.join(root, 'src/core/observe.ts')).href)
    const c13Backend = await import(pathToFileURL(path.join(root, 'src/core/log-backend.ts')).href)
    const c13Contract = await import(pathToFileURL(path.join(root, 'src/shared/observability/logContract.ts')).href)
    const c13Vm = await import(pathToFileURL(path.join(root, 'src/shared/observability/logViewModel.ts')).href)

    // C13-1 一次用户点击 + 随后的普通 logAction / 内部事件必须共享同一 trace
    c13Captured.length = 0
    c13Mirror.length = 0
    await c13Obs.recordUser('user.node_click', { target: { type: 'node', id: 'n1' } })
    await c13Backend.logAction('document.open', 'document', { docId: 'd1' })
    await c13Obs.recordInternal({ action: 'ipc.invoke', source: 'preload', params: { channel: 'fs:readTopoDocument' } })
    expect('C13', c13Captured.length === 3, `真实链路应产生 3 条日志，实际 ${c13Captured.length}`)
    const c13Trace = c13Captured[0]?.traceId
    expect('C13', typeof c13Trace === 'string' && c13Captured.every((e) => e.traceId === c13Trace),
      '一次点击后续的真实日志未共享 traceId（事件流会退化成独立消息）')
    expect('C13', c13Captured[0]?.category === 'user' && Boolean(c13Captured[0]?.spanId), '用户事件未成为链路根')
    expect('C13', c13Mirror.includes(c13Trace as string), '用户事件未把 traceId 镜像给 preload')

    // C13-2 视图模型对真实数据只得到 1 条操作链，而不是 3 个单条组
    const c13Groups = c13Vm.groupByTrace(c13Captured)
    expect('C13', c13Groups.length === 1 && c13Groups[0].entries.length === 3,
      `真实日志被拆成 ${c13Groups.length} 组（应为 1 组 3 条）`)
    expect('C13', c13Groups[0].isChain === true && c13Groups[0].independent === false, '真实链路未被识别为操作链')
    expect('C13', c13Groups[0].root?.action === 'user.node_click', '操作链标题未取用户事件')

    // C13-3 周期聚合显式独立：60s 窗口横跨多次点击，不能伪造因果
    c13Captured.length = 0
    const c13Timer = c13Obs.createTimerAudit('c13-probe', 60_000)
    c13Timer.tick('success', 2)
    c13Timer.flush()
    expect('C13', c13Captured[0]?.action === 'timer.aggregate', '定时任务汇总事件缺失')
    expect('C13', !('traceId' in (c13Captured[0] ?? {})), '60s 周期汇总被误归到某次用户操作')

    // C13-4 交互窗口过期后不误归到上一次操作
    c13Captured.length = 0
    c13Contract.startInteraction('c13-expired', 0)
    await c13Backend.logAction('kb.open', 'kb', {})
    expect('C13', c13Captured[0]?.traceId !== 'c13-expired', '过期交互窗口仍把日志归到上一次操作')

    // C13-5 契约三态：显式独立 / 跟随窗口 / 显式指定
    c13Contract.endInteraction()
    const c13Independent = c13Contract.buildLogEntry({ message: '独立', traceId: null })
    expect('C13', !('traceId' in c13Independent), 'traceId:null 未声明为独立事件')
    c13Contract.startInteraction('c13-window')
    const c13Followed = c13Contract.buildLogEntry({ message: '跟随' })
    expect('C13', c13Followed.traceId === 'c13-window', '交互窗口未向普通日志传播 traceId')
    const c13Explicit = c13Contract.buildLogEntry({ message: '指定', traceId: 'c13-fixed' })
    expect('C13', c13Explicit.traceId === 'c13-fixed', '显式 traceId 未优先于交互窗口')
    c13Contract.endInteraction()

    // C13-6 视图必须区分操作链与独立事件，并给出阶段
    const c13Timeline = await read('src/plugins/builtin/monitor/components/TimelineView.tsx')
    expect('C13', c13Timeline.includes('IndependentList') && c13Timeline.includes('独立事件'), '事件流未把独立事件单独呈现')
    expect('C13', c13Timeline.includes('stageOf('), '事件流缺少阶段标签（触发/内部/耗时/结果）')
    const c13VmSrc = await read('src/shared/observability/logViewModel.ts')
    expect('C13', c13VmSrc.includes('isChain') && c13VmSrc.includes('independent'), '视图模型未标记操作链/独立事件')
    expect('C13', (await read('src/core/observe.ts')).includes('startInteraction('), '拦截层未开启交互窗口')
    expect('C13', (await read('electron/preload.js')).includes('resolvedTrace = traceId === null'), 'preload 聚合汇总未声明独立')
  } finally {
    if (c13PrevWindow === undefined) delete c13Global.window
    else c13Global.window = c13PrevWindow
  }
} catch (error) {
  expect('C13', false, `C13 真实链路用例异常: ${String(error)}`)
}

// ------------------------------------------------------------
// C14 P6 Debug HUD：结构守卫 + 缓冲纯函数行为用例
// ------------------------------------------------------------
try {
  const c14Title = await read('src/features/layout/CustomTitleBar/CustomTitleBar.tsx')
  const c14Commands = await read('src/application/commands/commandRegistry.ts')
  const c14App = await read('src/App.tsx')
  const c14Host = await read('src/features/debug/DebugHudHost.tsx')
  const c14Hud = await read('src/features/debug/DebugHud.tsx')
  const c14Store = await read('src/features/debug/debugStore.ts')
  const c14BufferSrc = await read('src/features/debug/debugLogBuffer.ts')
  const c14Tokens = await read('src/styles/tokens.css')
  const c14Preload = await read('electron/preload.js')
  const c14Service = await read('electron/log-service.js')
  const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const c14HudCode = stripComments(c14Hud)

  // C14-1 入口：菜单可勾选项 + 快捷键 + 唯一命令 + 根层挂载（未开启不加载 chunk）
  expect('C14', c14Title.includes("label: 'Debug 模式'") && c14Title.includes('checked: debugEnabled'),
    '应用菜单缺少可勾选的 Debug 模式入口')
  expect('C14', c14Title.includes("useShortcut(['Ctrl+Shift+D']") && c14Title.includes("runCommand('debug.toggle')"),
    'Ctrl+Shift+D 未与菜单共用 debug.toggle 命令')
  expect('C14', c14Commands.includes("id: 'debug.toggle'") && c14Commands.includes('useDebugHudStore.getState().toggleEnabled()'),
    'debug.toggle 命令未注册或未真正切换状态')
  expect('C14', c14App.includes('<DebugHudHost />'), 'Debug HUD 未挂载到 App 根层（会被视图容器裁剪）')
  expect('C14', c14Host.includes('useDebugHudStore((s) => s.enabled)') && c14Host.includes('lazy(() => import('),
    'Debug HUD 宿主未做到「未开启零加载成本」')

  // C14-2 层级：应用内最顶层，但不能盖住致命错误弹窗
  const c14ZDebug = Number(c14Tokens.match(/--z-debug-hud:\s*(\d+)/)?.[1] ?? 0)
  const c14ZMenu = Number(c14Tokens.match(/--z-titlebar-menu:\s*(\d+)/)?.[1] ?? 0)
  const c14ZGlobal = Number(c14Tokens.match(/--z-global:\s*(\d+)/)?.[1] ?? 0)
  expect('C14', c14ZDebug > c14ZMenu && c14ZDebug < c14ZGlobal,
    `Debug HUD 层级异常（debug=${c14ZDebug} menu=${c14ZMenu} global=${c14ZGlobal}）`)
  expect('C14', c14Hud.includes("zIndex: 'var(--z-debug-hud)'") && c14Hud.includes("position: 'fixed'"),
    'Debug HUD 未使用语义层级变量或不是 fixed 浮层')
  expect('C14', !/text-\[\d+px\]|\bz-\[\d+\]|#[0-9a-fA-F]{3,8}\b|rgba\(/.test(c14HudCode),
    'Debug HUD 引入了硬编码视觉值，应只用 CSS 变量 / TM_UI')

  // C14-3 订阅闭环与防自放大：只订阅、只在开启时订阅、绝不写日志
  expect('C14', c14Hud.includes('logSubscribe(onEntry)') && c14Hud.includes('logUnsubscribe(onEntry)'),
    'Debug HUD 的订阅/取消订阅未成对（关闭后会泄漏监听器）')
  expect('C14', c14Hud.includes('if (!store.enabled) return'), 'Debug HUD 未在非开启态短路订阅')
  expect('C14', c14Hud.includes('logGetBuffer()') && c14Hud.includes('DEBUG_HUD_FLUSH_MS'),
    'Debug HUD 未补开启前历史或未做实时流合帧')
  expect('C14', !/logAction\(|logWrite\(|log\.info\(|mainLog|log:write|ipcRenderer/.test(c14HudCode),
    'Debug HUD 写了日志：log:write -> log:entry -> HUD 会自我放大')
  expect('C14', c14Hud.includes('debugHudRootPointerEvents(store.clickThrough)')
    && (c14Hud.match(/pointerEvents: 'auto'/g) ?? []).length >= 3,
  'Debug HUD 缺少 root 级真穿透，或标题栏/过滤条/缩放手柄未显式恢复可操作')
  expect('C14', c14Store.includes('detailed: false') && c14Store.includes('enabled: false'),
    'Debug HUD 默认态不是「关闭 + 详情隐藏」')
  expect('C14', !/node:fs|writeFile|appendFile|localStorage/.test(stripComments(c14BufferSrc)),
    'Debug HUD 的日志缓冲被写进磁盘（应只在内存里保留最近 N 条）')

  // C14-4 零新增 IPC：复用主进程已有的 log:entry 广播与白名单
  expect('C14', c14Preload.includes("'log:subscribe'") && c14Preload.includes("'log:entry'"),
    'preload 未放行 log:subscribe / log:entry，HUD 无法复用实时流')
  expect('C14', c14Service.includes("win.webContents.send('log:entry'"),
    '主进程广播模型已变化：若改成多窗口广播，请同步评估 D18 的独立窗口方案')

  // C14-5 缓冲纯函数行为用例（真实 import，不是 fixture 静态检查）
  const c14Buffer = await import(pathToFileURL(path.join(root, 'src/features/debug/debugLogBuffer.ts')).href)
  const c14Mk = (i: number, patch: Record<string, unknown> = {}) => ({
    id: `c14-${i}`,
    timestamp: new Date(Date.UTC(2026, 10, 24, 9, 0, 0) + i).toISOString(),
    seq: i,
    level: 'INFO',
    category: 'internal',
    action: 'ipc.invoke',
    label: '内部调用',
    ...patch,
  })
  const c14Many = Array.from({ length: 500 }, (_, i) => c14Mk(i))
  const c14Capped = c14Buffer.appendDebugEntries([], c14Many)
  expect('C14', c14Capped.length === c14Buffer.DEBUG_HUD_LIMIT,
    `高频日志未按上限裁剪：${c14Capped.length} / ${c14Buffer.DEBUG_HUD_LIMIT}`)
  expect('C14', c14Capped[0]?.seq === 500 - c14Buffer.DEBUG_HUD_LIMIT && c14Capped[c14Capped.length - 1]?.seq === 499,
    '裁剪后没有保留最新的 N 条')
  const c14Ordered = c14Buffer.appendDebugEntries([c14Mk(10), c14Mk(30)], [c14Mk(20)])
  expect('C14', c14Ordered.map((e: { seq: number }) => e.seq).join(',') === '10,20,30',
    '历史缓冲与实时推送乱序到达时未按 timestamp+seq 归位')
  const c14Sample = c14Mk(1, { level: 'ERROR', category: 'user', label: '点击节点', traceId: 'trace-abcdefghijk' })
  expect('C14', c14Buffer.matchesDebugFilters(c14Sample, { levels: ['ERROR'], categories: [], keyword: '' }),
    '级别过滤未命中')
  expect('C14', !c14Buffer.matchesDebugFilters(c14Sample, { levels: ['INFO'], categories: [], keyword: '' }),
    '级别过滤漏放行')
  expect('C14', c14Buffer.matchesDebugFilters(c14Sample, { levels: [], categories: ['user'], keyword: '节点' }),
    '类别 + 关键词组合过滤失效')
  expect('C14', !c14Buffer.matchesDebugFilters(c14Sample, { levels: [], categories: ['performance'], keyword: '' }),
    '类别过滤未排除其他类')
  const c14Sum = c14Buffer.summarizeDebugEntries([c14Mk(1, { level: 'ERROR' }), c14Mk(2, { level: 'WARN' }), c14Mk(3)])
  expect('C14', c14Sum.total === 3 && c14Sum.errors === 1 && c14Sum.warns === 1, '浮窗计数徽标统计错误')
  const c14Short = c14Buffer.shortTraceId('trace-abcdefghijk')
  expect('C14', c14Short.length === 8 && 'trace-abcdefghijk'.endsWith(c14Short) && c14Buffer.shortTraceId(null) === '—',
    'trace 短码压缩或独立事件占位错误')
  expect('C14', c14Buffer.debugClock('2026-11-24T09:00:00.123Z') === '09:00:00.123', '时钟段格式化错误')
  const c14Detail = c14Buffer.debugEntryDetail(c14Mk(1, { params: { blob: 'x'.repeat(5000) } }))
  expect('C14', c14Detail.includes('已截断') && c14Detail.length < 2500, '超长 params 未截断，会撑爆浮窗')

  // C14-6 P8 透明背景：按钮 / 状态持久化 / 三主题 token / root 级真穿透 / 悬停可读性
  const c14SurfaceSrc = await read('src/features/debug/debugSurface.ts')
  expect('C14', c14Hud.includes('aria-label="透明背景"') && c14Hud.includes('aria-pressed={store.translucent}')
    && c14Hud.includes('setTranslucent(!store.translucent)'),
  'Debug HUD 标题栏缺少可勾选的透明背景按钮')
  expect('C14', c14Hud.includes('debugHudSurfaceStyle({ translucent: store.translucent, hovered })')
    && c14Hud.includes('debugHudLogTextShadow(store.translucent, hovered)')
    && c14Hud.includes('data-tm-debug-translucent'),
  '透明背景未走共享纯函数层，或缺少半透明底上的文字描边')
  expect('C14', (c14Hud.match(/onPointerEnter=\{\(\) => setHovered\(true\)\}/g) ?? []).length >= 2,
    '标题栏 / 过滤条缺少悬停恢复不透明的入口')
  expect('C14', c14Store.includes('translucent: false') && c14Store.includes('translucent: state.translucent')
    && c14Store.includes('translucentPatch(get(), translucent)'),
  '透明开关未持久化，或开启时未联动真穿透')
  for (const token of ['bg', 'border', 'shadow', 'text-shadow']) {
    const count = (c14Tokens.match(new RegExp(`--debug-hud-translucent-${token}:`, 'g')) ?? []).length
    expect('C14', count === 3, `透明 token --debug-hud-translucent-${token} 未覆盖三套主题（实际 ${count}）`)
  }
  expect('C14', !/text-\[\d+px\]|\bz-\[\d+\]|#[0-9a-fA-F]{3,8}\b|rgba\(/.test(stripComments(c14SurfaceSrc)),
    '透明表面决策层混入了硬编码视觉值（应只用 tokens.css 变量）')
  expect('C14', !/logAction\(|logWrite\(|log:write|ipcRenderer/.test(stripComments(c14SurfaceSrc)),
    '透明表面决策层写了日志，会破坏 HUD 防自放大')

  const c14Surface = await import(pathToFileURL(path.join(root, 'src/features/debug/debugSurface.ts')).href)
  const c14Opaque = c14Surface.debugHudSurfaceStyle({ translucent: false, hovered: false })
  const c14Glass = c14Surface.debugHudSurfaceStyle({ translucent: true, hovered: false })
  const c14Hover = c14Surface.debugHudSurfaceStyle({ translucent: true, hovered: true })
  expect('C14', c14Opaque.background === undefined && c14Opaque.boxShadow === 'var(--shadow-popover)',
    '不透明态被半透明变量污染')
  expect('C14', c14Glass.background === 'var(--debug-hud-translucent-bg)'
    && c14Glass.borderColor === 'var(--debug-hud-translucent-border)'
    && c14Glass.boxShadow === 'var(--debug-hud-translucent-shadow)',
  '透明态未应用半透明表面 token')
  expect('C14', c14Hover.background === 'var(--titlebar-menu-bg)' && c14Hover.background !== c14Glass.background,
    '鼠标移到控制条时未临时恢复不透明（日志会读不清）')
  expect('C14', c14Surface.debugHudRootPointerEvents(true) === 'none'
    && c14Surface.debugHudRootPointerEvents(false) === 'auto',
  '点击穿透未落到 root：只给日志列表设 none 时父浮层仍会截获下层点击')
  expect('C14', c14Surface.debugHudLogTextShadow(true, false) === 'var(--debug-hud-translucent-text-shadow)'
    && c14Surface.debugHudLogTextShadow(true, true) === undefined
    && c14Surface.debugHudLogTextShadow(false, false) === undefined,
  '半透明底文字描边的开关条件错误')
  const c14PatchOn = c14Surface.translucentPatch({ translucent: false, clickThrough: false }, true)
  expect('C14', c14PatchOn.translucent === true && c14PatchOn.clickThrough === true,
    '开启透明背景未联动打开真穿透')
  const c14PatchOff = c14Surface.translucentPatch({ translucent: true, clickThrough: true }, false)
  expect('C14', c14PatchOff.translucent === false && c14PatchOff.clickThrough === true,
    '关闭透明背景擅自改回了用户单独设置的穿透')
  const c14PatchKeep = c14Surface.translucentPatch({ translucent: true, clickThrough: false }, false)
  expect('C14', c14PatchKeep.clickThrough === false, '关闭透明背景凭空打开了穿透')
} catch (error) {
  expect('C14', false, `C14 Debug HUD 用例异常: ${String(error)}`)
}

// ------------------------------------------------------------
// C15 P7 事实唯一性：显式分类 + dedupeKey + 主进程去重 + 多产生点核对
// ------------------------------------------------------------
try {
  const c15Catalog = await read('src/shared/observability/eventCatalog.ts')
  const c15CoverageMd = await read('docs/design/event-coverage.md')
  expect('C15', contract.includes('FACT_KIND_GROUPS') && contract.includes('stableHash32'),
    '契约层缺少事实类型分组或幂等键生成')
  expect('C15', contract.includes('categoryFromKind(input.kind)') && contract.includes('dedupeKey'),
    '产生点显式 kind 未覆盖按前缀推断的 category')
  expect('C15', service.includes('_applyDedupe') && service.includes('duplicates'),
    '主进程缺少短窗口去重或重复计数')
  expect('C15', c15Catalog.includes('kind: spec.kind') && c15Catalog.includes('缺少合法事实类型'),
    '事件目录未登记事实类型 / 门禁未校验')
  expect('C15', c15CoverageMd.includes('多产生点事件（需核对）') && c15CoverageMd.includes('事实类型'),
    '覆盖率表缺少事实类型与多产生点列')

  // C15-1 契约行为：同一事实同 key、不同 trace 不同 key、独立事件无 key、kind 决定分类
  const c15Contract = await import(pathToFileURL(path.join(root, CONTRACT)).href)
  const c15Base = { action: 'node.select', traceId: 'c15-trace', target: { type: 'node', id: 'n1' }, kind: 'state' } as const
  const c15A = c15Contract.buildLogEntry({ ...c15Base })
  const c15B = c15Contract.buildLogEntry({ ...c15Base })
  const c15C = c15Contract.buildLogEntry({ ...c15Base, traceId: 'c15-other' })
  expect('C15', typeof c15A.dedupeKey === 'string' && c15A.dedupeKey === c15B.dedupeKey,
    '同一交互内同一事实未生成相同 dedupeKey')
  expect('C15', c15A.dedupeKey !== c15C.dedupeKey, '不同交互的事实被误判为重复')
  expect('C15', c15A.category === 'internal', '显式 state 未把状态写回归到 internal（仍靠前缀判 user）')
  const c15Independent = c15Contract.buildLogEntry({ action: 'timer.aggregate', traceId: null })
  expect('C15', !('dedupeKey' in c15Independent), '独立事件不应参与去重')
  const c15Intent = c15Contract.buildLogEntry({ action: 'user.node_click', kind: 'intent', traceId: 'c15-trace' })
  expect('C15', c15Intent.category === 'user', '显式 intent 未归到 user')
  expect('C15', c15Contract.inferFactKind('node.select') === 'state' && c15Contract.inferFactKind('user.node_click') === 'intent',
    '事实类型显式声明分组失效')

  // C15-2 主进程行为：重复写入被合并、不同 key 不误杀、error 例外、计数可见
  const c15Tmp = await mkdtemp(path.join(os.tmpdir(), 'topomind-c15-'))
  try {
    const c15Svc = (await import(`${moduleUrl}#c15-dedupe`)).default
    c15Svc.init({ logDir: c15Tmp, level: 'INFO' })
    await c15Svc.drain()
    const base = {
      level: 'INFO', module: 'app', action: 'node.select', category: 'internal',
      message: 'c15 same fact', dedupeKey: 'dk_c15_same', traceId: 'c15-trace', kind: 'state',
    }
    const first = c15Svc.write({ ...base })
    const second = c15Svc.write({ ...base })
    const third = c15Svc.write({ ...base, dedupeKey: 'dk_c15_other', message: 'c15 different fact' })
    const fourth = c15Svc.write({ ...base, category: 'error', level: 'ERROR', message: 'c15 error fact' })
    expect('C15', first.accepted && !first.deduplicated, '首条事实被误去重')
    expect('C15', second.deduplicated === true && Number(second.repeatCount) >= 2, '重复事实未被合并')
    expect('C15', !third.deduplicated, '不同 dedupeKey 被误杀')
    expect('C15', !fourth.deduplicated, 'error 类被去重，破坏崩溃前必达')
    expect('C15', c15Svc.getWriteStats().duplicates >= 1, '重复次数未计入写入统计')
    const kept = c15Svc.getBuffer().find((e: { dedupeKey?: string }) => e.dedupeKey === 'dk_c15_same')
    expect('C15', Number(kept?.repeatCount ?? 0) >= 1, '重复次数未写到保留条目（订阅者看不到）')
    await c15Svc.drain()
  } finally {
    await rm(c15Tmp, { recursive: true, force: true })
  }

  // C15-3 覆盖率表确实列出了多产生点，而不是把重复当成「覆盖良好」
  const c15Report = buildCoverageReport()
  expect('C15', c15Report.summary.multiSite >= 5, '覆盖率表未暴露多产生点事件')
  expect('C15', c15Report.rows.some((r) => r.id === 'node.select' && r.callSites >= 2),
    'node.select 的多产生点未被核对表记录')
  expect('C15', c15Report.rows.find((r) => r.id === 'node.select')?.kind === 'state',
    'node.select 仍被登记为用户意图而非状态事实')

  // C15-4 P7.2 交互边界：结构挂载 + 连点/键盘/TTL 纯函数行为
  const c15BoundarySrc = await read('src/core/interactionBoundary.ts')
  const c15Main = await read('src/main.tsx')
  const c15ObsSrc = await read('src/core/observe.ts')
  expect('C15', c15Main.includes('installInteractionBoundary()')
    && c15Main.indexOf('installInteractionBoundary()') < c15Main.indexOf('root.render('),
  '交互边界未早于 React 渲染安装')
  expect('C15', c15BoundarySrc.includes("addEventListener('pointerdown'")
    && c15BoundarySrc.includes("addEventListener('keydown'")
    && c15BoundarySrc.includes(', true)'), '交互边界未使用 window 捕获阶段监听真实输入')
  expect('C15', c15ObsSrc.includes('getCurrentTraceId() ?? newTraceId(actionId)'),
    'recordUser 仍自行 newTraceId，未复用交互边界')
  expect('C15', c15ObsSrc.includes('getCurrentTraceId() ?? newTraceId(name)'),
    'beginOperation 未复用交互边界，命令链仍会平行')
  const c15Boundary = await import(pathToFileURL(path.join(root, 'src/core/interactionBoundary.ts')).href)
  const t0 = 1_700_000_000_000
  const s1 = c15Boundary.nextInteraction(null, 'pointerdown', t0)
  const s2 = c15Boundary.nextInteraction(s1, 'pointerdown', t0 + 50)
  const s3 = c15Boundary.nextInteraction(s2, 'keydown', t0 + 300)
  const s4 = c15Boundary.nextInteraction(s3, 'pointerdown', t0 + 500)
  const s5 = c15Boundary.nextInteraction(s4, 'pointerdown', t0 + 500 + c15Contract.INTERACTION_TTL_MS + 1)
  expect('C15', s1.traceId === s2.traceId, '150ms 连点被拆成两条链')
  expect('C15', s2.traceId === s3.traceId, '键盘输入换了 traceId')
  expect('C15', s4.traceId !== s3.traceId, '超过连点窗口的新点击未开新交互')
  expect('C15', s5.traceId !== s4.traceId, 'TTL 过期后仍复用旧交互')

  // C15-5 P7.3/P7.5 真实模型：一次交互只落 1 条 user 记录，过程步骤只在内存，
  // 只有 error 才把步骤 dump 落盘。这是「一次点击 4 条 user 日志」的正面回归用例。
  const c15Buffer = await import(pathToFileURL(path.join(root, 'src/core/traceBuffer.ts')).href)
  c15Buffer.resetTraceBuffer()
  c15Buffer.recordStep({ name: 'node.select', outcome: 'changed', params: { nodeId: 'n1' } }, 'c15-click-trace')
  c15Buffer.recordStep({ name: 'node.select', outcome: 'unchanged', params: { nodeId: 'n1' } }, 'c15-click-trace')
  c15Buffer.recordStep({ name: 'ui.tab.close', outcome: 'closed' }, 'c15-click-trace')
  expect('C15', c15Buffer.stepCount('c15-click-trace') === 3, '过程步骤未按交互分组缓存')
  const c15Dumped = c15Buffer.dumpSteps('c15-click-trace')
  expect('C15', c15Dumped.length === 3 && c15Dumped[0].name === 'node.select' && c15Dumped[2].name === 'ui.tab.close',
    'dump 的步骤顺序或内容不正确')
  expect('C15', c15Buffer.dumpSteps('c15-other-trace').length === 0, '不同交互的步骤串了')
  expect('C15', c15Buffer.recordStep({ name: 'orphan' }, null) === null, '显式独立事件不应记步骤')
  for (let i = 0; i < c15Buffer.MAX_STEPS_PER_TRACE + 20; i += 1) {
    c15Buffer.recordStep({ name: `step.${i}` }, 'c15-flood')
  }
  expect('C15', c15Buffer.dumpSteps('c15-flood', 500).length === c15Buffer.MAX_STEPS_PER_TRACE, '步骤上限未生效')
  expect('C15', c15Buffer.traceBufferStats().droppedSteps >= 20, '步骤丢弃未如实统计')

  const c15UserEntry = c15Contract.buildLogEntry({
    action: 'user.node_click', kind: 'intent', traceId: 'c15-click-trace', stepCount: 3,
  })
  expect('C15', c15UserEntry.category === 'user' && c15UserEntry.kind === 'intent' && c15UserEntry.stepCount === 3,
    '一次交互的用户记录缺少步骤摘要')
  expect('C15', !('steps' in c15UserEntry), '正常交互不应把全量步骤落盘')
  const c15ErrorEntry = c15Contract.buildLogEntry({
    action: 'app.error', kind: 'failure', traceId: 'c15-click-trace',
    steps: c15Dumped, level: 'ERROR',
  })
  expect('C15', c15ErrorEntry.category === 'error' && c15ErrorEntry.steps?.length === 3,
    'error 未按需 dump 该交互的过程步骤')

  // 结构守卫：同一次执行路径上的重复埋点确实已降级，而不是只加了去重兜底。
  const c15Handlers = await read('src/hooks/useGraph/graphEventHandlers.ts')
  const c15Selection = await read('src/hooks/useGraph/selectionOperations.ts')
  const c15TabSrc = await read('src/features/layout/TabBar/TabBar.tsx')
  const c15Backend = await read('src/core/log-backend.ts')
  expect('C15', !c15Handlers.includes("logAction('node.select'"), '事件层仍在补写 node.select')
  expect('C15', c15Selection.includes('recordStep(') && !c15Selection.includes('logAction('),
    'store 写回未降级为内存步骤')
  expect('C15', c15TabSrc.includes('recordStep(') && !c15TabSrc.includes("logAction('ui.tab'"),
    'TabBar 仍双写 ui.tab 领域事件')
  expect('C15', c15Backend.includes('entry.stepCount = stepCount(entry.traceId)')
    && c15Backend.includes("entry.category === 'error'"),
  '落盘记录未注入步骤摘要 / error 未触发按需 dump')

  // C15-6 P7.4 状态中间件：diff 是纯函数、跳过运行时态、脱敏、只写内存步骤
  const c15State = await import(pathToFileURL(path.join(root, 'src/core/observabilityStoreMiddleware.ts')).href)
  const c15Prev = {
    view: 'graph', currentWorkDir: '/a/b', selectedNodeIds: ['n1'],
    railVisible: true, theme: 'dark', count: 1,
  }
  const c15Next = {
    ...c15Prev, view: 'workspace', currentWorkDir: '/a/c',
    selectedNodeIds: ['n2'], theme: 'light', count: 2,
  }
  const c15Diff = c15State.diffStateChange(c15Prev, c15Next, { name: 'test' })
  expect('C15', c15Diff !== null && c15Diff.changed === 4, '状态 diff 未正确识别持久化字段变化')
  const c15Keys = (c15Diff?.fields ?? []).map((f: { key: string }) => f.key)
  expect('C15', !c15Keys.includes('selectedNodeIds'), '运行时 selected 字段被当成状态事实')
  expect('C15', c15State.diffStateChange(c15Prev, { ...c15Prev }, { name: 'test' }) === null,
    '无变化仍产出状态 diff')
  const c15PathField = (c15Diff?.fields ?? []).find((f: { key: string }) => f.key === 'currentWorkDir')
  expect('C15', Boolean(c15PathField && !c15PathField.to.includes('/a/c')), '路径明文进入了状态摘要')
  expect('C15', c15State.summarizeValue('dark') === 'str:dark'
    && c15State.summarizeValue('some secret', true).startsWith('[redacted]'),
  '状态摘要的安全短值 / 敏感值口径不正确')
  const c15StateSrc = await read('src/core/observabilityStoreMiddleware.ts')
  expect('C15', !/logWrite\(|logAction\(|log:write/.test(c15StateSrc),
    '状态中间件会写日志（自放大风险）')
  for (const c15StoreFile of [
    'workspaceStore.ts', 'tabs/tabStore.ts', 'rightPanelStore.ts', 'layoutStore.ts', 'themeStore.ts',
  ]) {
    expect('C15', (await read(`src/stores/${c15StoreFile}`)).includes('attachStateObservation('),
      `${c15StoreFile} 未接入状态观测`)
  }

  c15Buffer.resetTraceBuffer()
  c15Contract.startInteraction('')
} catch (error) {
  expect('C15', false, `C15 事实唯一性用例异常: ${String(error)}`)
}

if (violations.length > 0) {
  console.error(`LOGGING_VERIFY_FAILED: ${violations.length} violations / ${checkCount} checks`)
  for (const line of violations) console.error(`- ${line}`)
  process.exit(1)
}
console.log(`LOGGING_VERIFIED: ${checkCount} checks, ${sourceFiles.length} src files; console src=${srcConsole} electron=${electronConsole}`)
