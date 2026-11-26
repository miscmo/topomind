/**
 * 日志契约 —— 全应用唯一真源（v3）。
 *
 * 分层：本文件只定义「结构、枚举、注册表、分类规则、脱敏规则」，不含 IPC、
 * 落盘或 UI 逻辑。采集层（src/core/logger.ts）、桥接层（log-backend.ts）、
 * 消费层（plugins/public/api.ts、monitorStore.ts）一律从这里 re-export / 引用，
 * 禁止在别处再声明 LogEntry、LogLevel 或抄一份 action id 列表。
 *
 * v3 新增一级分类 `category`（user / internal / performance / error）与关联键
 * `sessionId / seq / spanId / parentId / workspaceId`；分类规则集中在 CATEGORY_RULES，
 * 由 scripts/gen-event-types.mts 生成主进程可用的 JS 产物，禁止手写副本。
 *
 * 主进程 electron/log-service.js 是独立进程，无法 import TS；它只消费生成产物
 * 与数值常量（LOG_LIMITS / LEVEL_ORDER），由 scripts/verify-logging.mts 做一致性门禁。
 * 行为逻辑（等级、补全、写文件）仍只存在于主进程一侧。
 *
 * 兼容性：v1 日志没有 `v` 字段、action 是中文自由文本；v2 没有 category / seq。
 * 老日志一律走 categoryFromLegacy() 读时归类，不重写历史文件。
 */
import { PERFORMANCE_ACTION } from './performanceContract.ts'

// ============================================================
// 1. 版本、等级、模块域
// ============================================================

export const LOG_SCHEMA_VERSION = 3
export type LogSchemaVersion = 1 | 2 | 3

export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

export const DEFAULT_LOG_LEVEL: LogLevel = 'INFO'
export const DEV_LOG_LEVEL: LogLevel = 'DEBUG'

// ============================================================
// 1.1 日期口径：日志分片一律按「用户本地日」（D12）
// ============================================================

/**
 * 日志分片名 / 查询条件用的日期键（YYYY-MM-DD），按**用户本地时区**计算。
 *
 * 主进程 electron/log-service.js 的 _dateStr 用 getFullYear/getMonth/getDate，
 * 渲染侧日期筛选、导出文件名也必须用同一口径。若改用
 * `new Date().toISOString().slice(0, 10)`（UTC），UTC+8 的 00:00–08:00 会指向
 * 前一天，表现为「当天的日志一条都查不到、回放是空的」——P4.5 实测命中。
 * 无效输入返回空串，供 UI 过滤时安全跳过。
 */
export function logDayKey(value: Date | string | number = new Date()): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ============================================================
// 1.2 v3 一级分类：四类日志拼成一条因果链
// ============================================================

/**
 * 每条日志必须且只能属于一类；分类不靠 module/action 猜，而是显式一级字段。
 * 保留期按类独立，物理文件也按类分开（见 electron/log-service.js）。
 * `audit` 为未来权限/外链审计预留，当前不启用，不参与分文件。
 */
export const LOG_CATEGORIES = {
  user: { id: 'user', label: '用户事件', shortLabel: '用户', retentionDays: 30, description: '用户做了什么：语义动作全量，原始输入只进内存' },
  internal: { id: 'internal', label: '内部事件', shortLabel: '内部', retentionDays: 14, description: '软件因此做了什么：状态迁移、IPC、命令、定时任务、插件生命周期' },
  performance: { id: 'performance', label: '性能', shortLabel: '性能', retentionDays: 14, description: '花了多久：沿用 PERFORMANCE_METRICS 的采样与阈值' },
  error: { id: 'error', label: '异常', shortLabel: '异常', retentionDays: 90, description: '哪里断了：错误全量、结构化异常、指纹与面包屑' },
} as const

export type LogCategory = keyof typeof LOG_CATEGORIES
export const LOG_CATEGORY_IDS = Object.keys(LOG_CATEGORIES) as LogCategory[]

export const CATEGORY_RETENTION_DAYS: Record<LogCategory, number> = {
  user: LOG_CATEGORIES.user.retentionDays,
  internal: LOG_CATEGORIES.internal.retentionDays,
  performance: LOG_CATEGORIES.performance.retentionDays,
  error: LOG_CATEGORIES.error.retentionDays,
}

// ------------------------------------------------------------
// 1.1 P7 事实唯一性：一条日志 = 一个事实，不是一次函数调用
// ------------------------------------------------------------

/**
 * 事实类型（P7 M2）。分类由产生点声明的 kind 推导，而不是靠 action 前缀猜：
 * `node.` 前缀曾把「store 写回」也判成用户事件，是重复日志被放大的原因之一。
 */
export type LogFactKind = 'intent' | 'state' | 'process' | 'periodic' | 'failure' | 'metric'

export const FACT_KIND_CATEGORY: Record<LogFactKind, LogCategory> = {
  intent: 'user',
  state: 'internal',
  process: 'internal',
  periodic: 'internal',
  failure: 'error',
  metric: 'performance',
}

/** 事实基数：门禁据此判断「同一 action 多个产生点」是否合理。 */
export type FactCardinality = 'per-interaction' | 'per-state-change' | 'per-event'

/** 事实归属层：一个事实只允许一个 owner 产生。 */
export type FactOwner = 'interaction' | 'state' | 'process' | 'failure' | 'periodic' | 'metric'

/**
 * 显式声明分组（单一真源）。未列出的 action 由 inferFactKind() 兜底推导，
 * validateEventCatalog() 会保证每个事件都有合法 kind，新增事件必须来这里登记。
 */
export const FACT_KIND_GROUPS: Record<LogFactKind, readonly string[]> = {
  intent: [
    'user.command', 'user.document_open', 'user.node_click', 'user.tab_close',
    'user.tab_switch', 'user.view_open', 'user.room_enter',
    'kb.open', 'kb.create', 'kb.import', 'kb.delete', 'kb.sort', 'kb.trash_restore', 'kb.trash_clear',
    'node.create', 'node.delete', 'node.rename', 'node.enter', 'node.move', 'node.style_update',
    'container.create', 'edge.create', 'edge.delete', 'edge.update',
    'room.navigate', 'graph.page_enter', 'workspace.select', 'workspace.enter', 'workspace.leave',
    'document.create', 'document.save', 'document.rename', 'document.delete', 'document.move',
    'document.style_update', 'document.export', 'attachment.upload', 'attachment.delete', 'attachment.open',
    'ui.context_menu', 'ui.shortcut', 'ui.view', 'ui.tab',
    'ai.agent_save', 'ai.patch_preview', 'ai.patch_reject', 'ai.tool',
  ],
  state: ['node.select', 'room.load', 'room.load_discard', 'kb.list_load', 'kb.node_count_load', 'ai.agent_select', 'ai.patch_commit'],
  process: ['kb.create_dialog', 'kb.import_dialog', 'store.call'],
  periodic: ['ipc.invoke', 'ipc.audit', 'timer.aggregate', 'app.lifecycle', 'app.startup', 'app.quit', 'app.diagnostic_export', 'plugin.state', 'plugin.activate', 'plugin.deactivate', 'plugin.log'],
  failure: ['app.crash', 'app.error', 'app.crash_recovered'],
  metric: [],
}

const KIND_BY_ACTION = new Map<string, LogFactKind>()
for (const [kind, ids] of Object.entries(FACT_KIND_GROUPS)) {
  for (const id of ids) KIND_BY_ACTION.set(id, kind as LogFactKind)
}

/** 未显式登记的事件按级别/前缀兜底推导；失败与性能指标优先。 */
export function inferFactKind(id: string, level?: string, category?: LogCategory): LogFactKind {
  const explicit = KIND_BY_ACTION.get(id)
  if (explicit) return explicit
  if (category === 'performance' || id.startsWith('perf.') || id === PERFORMANCE_ACTION) return 'metric'
  if (category === 'error' || level === 'ERROR' || /_failed$|failed|\.error|\.crash|_reject|crash_recovered/.test(id)) return 'failure'
  if (category === 'internal' || /^(?:app|ipc|timer|plugin|internal|store)\./.test(id)) return 'periodic'
  return 'intent'
}

export function categoryFromKind(kind: LogFactKind): LogCategory {
  return FACT_KIND_CATEGORY[kind]
}

/** FNV-1a 32 位短哈希：dedupeKey 只用于去重，不承载可逆信息。 */
export function stableHash32(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function isLogCategory(value: unknown): value is LogCategory {
  return typeof value === 'string' && (LOG_CATEGORY_IDS as string[]).includes(value)
}

/**
 * 分类规则的唯一真源：由 gen-event-types.mts 写入主进程 JS 产物，
 * 保证渲染侧 buildLogEntry 与主进程读时归类口径一致。
 */
export const CATEGORY_RULES = {
  userPrefixes: [
    'kb.', 'node.', 'container.', 'edge.', 'room.navigate', 'graph.page_enter',
    'ui.', 'document.', 'attachment.', 'user.',
  ],
  internalPrefixes: [
    'app.', 'workspace.', 'plugin.', 'store.', 'room.load', 'internal.', 'performance.',
    'ipc.', 'timer.',
  ],
  errorActionPattern: '(?:_failed|failed|\\.error|\\.crash|_reject|crash_recovered)',
  defaultCategory: 'internal',
} as const

const ERROR_ACTION_HINT = new RegExp(CATEGORY_RULES.errorActionPattern, 'i')

/**
 * 读时兼容 + 采集兜底：v1/v2 老日志没有 category，按等级、action、module 推断。
 * 已带合法 category 的新条目直接返回，不重复推断。
 */
export function categoryFromLegacy(entry: Partial<LogEntry> | null | undefined): LogCategory {
  if (!entry || typeof entry !== 'object') return CATEGORY_RULES.defaultCategory
  if (isLogCategory(entry.category)) return entry.category
  const action = typeof entry.action === 'string' ? entry.action : ''
  const level = normalizeLogLevel(entry.level)
  if (level === 'ERROR' || ERROR_ACTION_HINT.test(action)) return 'error'
  if (action === PERFORMANCE_ACTION || entry.module === 'performance' || action.startsWith('perf.')) return 'performance'
  if (CATEGORY_RULES.userPrefixes.some((prefix) => action.startsWith(prefix))) return 'user'
  if (CATEGORY_RULES.internalPrefixes.some((prefix) => action.startsWith(prefix))) return 'internal'
  return CATEGORY_RULES.defaultCategory
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value)
}

/**
 * 采集入口的等级归一化：兼容小写 / 混合写法（'warn'、'Trace'），未知值降级为 INFO。
 * 直接调用 buildLogEntry 的 14 处（ErrorBoundary、性能埋点、插件、main.tsx）
 * 过去会因 isLogLevel 严格大写而静默降级，这里统一收口。
 */
export function normalizeLogLevel(value: unknown): LogLevel {
  if (typeof value !== 'string') return DEFAULT_LOG_LEVEL
  const upper = value.trim().toUpperCase()
  return isLogLevel(upper) ? upper : DEFAULT_LOG_LEVEL
}

/** module 按功能域划分，不按实现文件/函数名（后者会随重构漂移）。 */
export const LOG_MODULES = {
  app: { id: 'app', label: '应用' },
  workspace: { id: 'workspace', label: '工作目录' },
  kb: { id: 'kb', label: '知识库' },
  graph: { id: 'graph', label: '图谱' },
  document: { id: 'document', label: '文档' },
  attachment: { id: 'attachment', label: '附件' },
  store: { id: 'store', label: '存储' },
  plugin: { id: 'plugin', label: '插件' },
  performance: { id: 'performance', label: '性能' },
  ui: { id: 'ui', label: '界面' },
} as const

export type LogModuleId = keyof typeof LOG_MODULES
export const LOG_MODULE_IDS = Object.keys(LOG_MODULES) as LogModuleId[]

export function isLogModuleId(value: unknown): value is LogModuleId {
  return typeof value === 'string' && (LOG_MODULE_IDS as string[]).includes(value)
}

/** 旧 module 名 → 功能域。兼容期由采集层自动归一化。 */
export const LEGACY_MODULE_MAP: Readonly<Record<string, LogModuleId>> = Object.freeze({
  App: 'app', Main: 'app', ErrorBoundary: 'app', Runtime: 'app',
  SetupPage: 'workspace', Workspace: 'workspace',
  HomePage: 'kb', KBSettings: 'kb', useHomeKnowledgeBases: 'kb',
  useHomeCreateKB: 'kb', useHomeImportKB: 'kb', useTrashDialogModel: 'kb',
  graphOperations: 'graph', useGraph: 'graph', GraphPage: 'graph',
  GraphCanvas: 'graph', CanvasMiniMap: 'ui', useNodeActions: 'graph',
  useEdgeActions: 'graph', useNodeMoveToRoom: 'graph', useGraphRoomLoader: 'graph',
  DetailPanel: 'document', DocumentWorkspaceLayout: 'document',
  SaveCoordinator: 'document', Document: 'document',
  AttachmentsTab: 'attachment',
  Store: 'store', FSB: 'store', Storage: 'store',
  Performance: 'performance',
  TabBar: 'ui', Breadcrumb: 'ui', RoomHistory: 'ui', Sidebar: 'ui',
  FilterBar: 'ui', LogList: 'ui', DetailPanelView: 'ui', PluginDiagnosticsPanel: 'ui',
})

export function resolveModule(raw: string | undefined): LogModuleId {
  if (!raw) return 'app'
  if (isLogModuleId(raw)) return raw
  const exact = LEGACY_MODULE_MAP[raw]
  if (exact) return exact
  // `Store.writeTopoDocument` / `Store.*` 这类历史命名按前缀归域。
  if (raw.startsWith('Store.') || raw === 'FSB' || raw.startsWith('FSB.')) return 'store'
  if (raw.startsWith('plugin:') || raw.startsWith('Plugin')) return 'plugin'
  // 分段 + 驼峰拆词后精确匹配。旧实现用 includes(id)，两字母的 `ui` 会把
  // Guide / buildStatus / quickOpen / liquid 全部误归到 ui，这里改为边界感知。
  const segments = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s.:/\\_-]+/)
    .filter(Boolean)
  for (const segment of segments) {
    const lower = segment.toLowerCase()
    if (isLogModuleId(lower)) return lower
    const mapped = LEGACY_MODULE_MAP[segment] ?? LEGACY_MODULE_MAP[lower]
    if (mapped) return mapped
  }
  return 'app'
}

// ============================================================
// 2. action 注册表
// ============================================================

/**
 * 规范 id 采用 `<domain>.<verb>` 全小写英文；中文只在 label 里出现。
 * `性能:记录` 是保留 action：performanceMetrics.ts / 回归脚本依赖其字面量，禁止改名。
 */
export const LOG_ACTIONS = {
  appStartup: 'app.startup',
  appCrash: 'app.crash',
  appError: 'app.error',
  /** P3：上次会话异常退出后，下次启动生成的恢复报告。 */
  appCrashRecovered: 'app.crash_recovered',
  /** P3：一键诊断包导出（只记导出行为，不含包内容）。 */
  appDiagnosticExport: 'app.diagnostic_export',
  workspaceSelect: 'workspace.select',
  workspaceCreateFailed: 'workspace.create_failed',
  workspaceOpenFailed: 'workspace.open_failed',
  workspaceEnter: 'workspace.enter',
  workspaceLeave: 'workspace.leave',
  kbListLoad: 'kb.list_load',
  kbListLoadFailed: 'kb.list_load_failed',
  kbNodeCountLoad: 'kb.node_count_load',
  kbOpen: 'kb.open',
  kbCreate: 'kb.create',
  kbCreateDialog: 'kb.create_dialog',
  kbImport: 'kb.import',
  kbImportDialog: 'kb.import_dialog',
  kbSort: 'kb.sort',
  kbSettingsSave: 'kb.settings_save',
  kbSettingsSaveFailed: 'kb.settings_save_failed',
  kbDelete: 'kb.delete',
  kbDeleteFailed: 'kb.delete_failed',
  trashRestore: 'kb.trash_restore',
  trashClear: 'kb.trash_clear',
  nodeCreate: 'node.create',
  nodeCreateFailed: 'node.create_failed',
  nodeDelete: 'node.delete',
  nodeRename: 'node.rename',
  nodeSelect: 'node.select',
  nodeEnter: 'node.enter',
  nodeMove: 'node.move',
  nodeStyleUpdate: 'node.style_update',
  containerCreate: 'container.create',
  containerCreateFailed: 'container.create_failed',
  edgeCreate: 'edge.create',
  edgeDelete: 'edge.delete',
  edgeUpdate: 'edge.update',
  edgeValidationReject: 'edge.validation_reject',
  roomLoad: 'room.load',
  roomLoadDiscard: 'room.load_discard',
  roomNavigate: 'room.navigate',
  graphPageEnter: 'graph.page_enter',
  uiContextMenu: 'ui.context_menu',
  uiShortcut: 'ui.shortcut',
  uiView: 'ui.view',
  uiTab: 'ui.tab',
  documentCreate: 'document.create',
  documentSave: 'document.save',
  documentSaveFailed: 'document.save_failed',
  documentRename: 'document.rename',
  documentDelete: 'document.delete',
  documentMove: 'document.move',
  documentStyleUpdate: 'document.style_update',
  documentExport: 'document.export',
  attachmentUpload: 'attachment.upload',
  attachmentDelete: 'attachment.delete',
  attachmentOpen: 'attachment.open',
  pluginLog: 'plugin.log',
  performanceRecord: PERFORMANCE_ACTION,
  // ---- P2 单点拦截：内部事件（category = internal） ----
  ipcInvoke: 'ipc.invoke',
  ipcAudit: 'ipc.audit',
  storeCall: 'store.call',
  pluginState: 'plugin.state',
  pluginActivate: 'plugin.activate',
  pluginDeactivate: 'plugin.deactivate',
  appLifecycle: 'app.lifecycle',
  appQuit: 'app.quit',
  timerAggregate: 'timer.aggregate',
  // ---- P2 单点拦截：语义化用户事件（category = user） ----
  userCommand: 'user.command',
  userDocumentOpen: 'user.document_open',
  userNodeClick: 'user.node_click',
  userTabClose: 'user.tab_close',
  userTabSwitch: 'user.tab_switch',
  userViewOpen: 'user.view_open',
  userRoomEnter: 'user.room_enter',
  // ---- AI Agent（P0）：只记录「发生了什么」，绝不记录 Key 或对话正文 ----
  aiChat: 'ai.chat',
  aiChatFailed: 'ai.chat_failed',
  aiConfigSave: 'ai.config_save',
  // S1：智能体配置 / 选择；只记录「发生了什么」，不记录 prompt 正文。
  aiAgentSave: 'ai.agent_save',
  aiAgentSelect: 'ai.agent_select',
  // P1：AgentPatch 预览 / 提交 / 放弃；只记 taskId 与数量，不记节点内容与 prompt 正文。
  aiPatchPreview: 'ai.patch_preview',
  aiPatchCommit: 'ai.patch_commit',
  aiPatchReject: 'ai.patch_reject',
  // P2：一次任务结束聚合记 1 条工具调用摘要；逐次明细走内存，不逐条落盘（C10 / C15）。
  aiTool: 'ai.tool',
} as const

export type LogActionId = (typeof LOG_ACTIONS)[keyof typeof LOG_ACTIONS]
export const LOG_ACTION_IDS = Object.values(LOG_ACTIONS) as LogActionId[]
/** 兼容期允许业务代码继续传旧中文字符串。 */
export type LogActionInput = LogActionId | (string & {})
export const UNKNOWN_ACTION_ID = 'unknown.unknown'

export interface LogActionSpec {
  id: LogActionId
  label: string
  module: LogModuleId
  level: LogLevel
  description: string
  /** P7 M2：事实类型 / 基数 / 归属层，由事件目录单一真源生成。 */
  kind: LogFactKind
  cardinality: FactCardinality
  factOwner: FactOwner
}

/** 注册表手写部分只声明人读元数据；P7 的 kind / cardinality / factOwner 由生成器补齐。 */
type ActionMeta = Pick<LogActionSpec, 'label' | 'module' | 'level'>

export const LOG_ACTION_META: Record<LogActionId, ActionMeta> = {
  'app.startup': { label: '应用启动', module: 'app', level: 'INFO' },
  'app.crash': { label: '进程崩溃', module: 'app', level: 'ERROR' },
  'app.error': { label: '未处理异常', module: 'app', level: 'ERROR' },
  'app.crash_recovered': { label: '异常退出恢复报告', module: 'app', level: 'ERROR' },
  'app.diagnostic_export': { label: '导出诊断包', module: 'app', level: 'INFO' },
  'workspace.select': { label: '选择工作目录', module: 'workspace', level: 'INFO' },
  'workspace.create_failed': { label: '创建工作目录失败', module: 'workspace', level: 'ERROR' },
  'workspace.open_failed': { label: '打开工作目录失败', module: 'workspace', level: 'ERROR' },
  'workspace.enter': { label: '进入工作目录', module: 'workspace', level: 'INFO' },
  'workspace.leave': { label: '离开工作目录', module: 'workspace', level: 'INFO' },
  'kb.list_load': { label: '知识库列表加载', module: 'kb', level: 'INFO' },
  'kb.list_load_failed': { label: '知识库列表加载失败', module: 'kb', level: 'ERROR' },
  'kb.node_count_load': { label: '子节点数量加载', module: 'kb', level: 'INFO' },
  'kb.open': { label: '打开知识库', module: 'kb', level: 'INFO' },
  'kb.create': { label: '创建知识库', module: 'kb', level: 'INFO' },
  'kb.create_dialog': { label: '新建知识库弹窗', module: 'kb', level: 'INFO' },
  'kb.import': { label: '导入知识库', module: 'kb', level: 'INFO' },
  'kb.import_dialog': { label: '导入知识库弹窗', module: 'kb', level: 'INFO' },
  'kb.sort': { label: '知识库排序', module: 'kb', level: 'INFO' },
  'kb.settings_save': { label: '保存知识库设置', module: 'kb', level: 'INFO' },
  'kb.settings_save_failed': { label: '保存知识库设置失败', module: 'kb', level: 'ERROR' },
  'kb.delete': { label: '删除知识库', module: 'kb', level: 'INFO' },
  'kb.delete_failed': { label: '删除知识库失败', module: 'kb', level: 'ERROR' },
  'kb.trash_restore': { label: '回收站恢复', module: 'kb', level: 'INFO' },
  'kb.trash_clear': { label: '回收站清空', module: 'kb', level: 'INFO' },
  'node.create': { label: '创建节点', module: 'graph', level: 'INFO' },
  'node.create_failed': { label: '创建节点失败', module: 'graph', level: 'WARN' },
  'node.delete': { label: '删除节点', module: 'graph', level: 'INFO' },
  'node.rename': { label: '重命名节点', module: 'graph', level: 'INFO' },
  'node.select': { label: '选中节点', module: 'graph', level: 'INFO' },
  'node.enter': { label: '进入节点', module: 'graph', level: 'INFO' },
  'node.move': { label: '跨房间移动节点', module: 'graph', level: 'INFO' },
  'node.style_update': { label: '更新节点样式', module: 'graph', level: 'INFO' },
  'container.create': { label: '创建容器', module: 'graph', level: 'INFO' },
  'container.create_failed': { label: '创建容器失败', module: 'graph', level: 'WARN' },
  'edge.create': { label: '创建连线', module: 'graph', level: 'INFO' },
  'edge.delete': { label: '删除连线', module: 'graph', level: 'INFO' },
  'edge.update': { label: '更新连线', module: 'graph', level: 'INFO' },
  'edge.validation_reject': { label: '连线校验拒绝', module: 'graph', level: 'WARN' },
  'room.load': { label: '加载房间', module: 'graph', level: 'INFO' },
  'room.load_discard': { label: '房间加载丢弃', module: 'graph', level: 'DEBUG' },
  'room.navigate': { label: '房间导航', module: 'graph', level: 'INFO' },
  'graph.page_enter': { label: '进入图谱页', module: 'graph', level: 'INFO' },
  'ui.context_menu': { label: '右键菜单', module: 'ui', level: 'DEBUG' },
  'ui.shortcut': { label: '快捷键', module: 'ui', level: 'DEBUG' },
  'ui.view': { label: '视图操作', module: 'ui', level: 'DEBUG' },
  'ui.tab': { label: '标签页切换', module: 'ui', level: 'DEBUG' },
  'document.create': { label: '创建文档', module: 'document', level: 'INFO' },
  'document.save': { label: '保存文档', module: 'document', level: 'INFO' },
  'document.save_failed': { label: '保存文档失败', module: 'document', level: 'ERROR' },
  'document.rename': { label: '重命名文档', module: 'document', level: 'INFO' },
  'document.delete': { label: '删除文档', module: 'document', level: 'INFO' },
  'document.move': { label: '移动文档', module: 'document', level: 'INFO' },
  'document.style_update': { label: '修改文档样式', module: 'document', level: 'INFO' },
  'document.export': { label: '导出文档', module: 'document', level: 'INFO' },
  'attachment.upload': { label: '上传附件', module: 'attachment', level: 'INFO' },
  'attachment.delete': { label: '删除附件', module: 'attachment', level: 'INFO' },
  'attachment.open': { label: '打开附件', module: 'attachment', level: 'INFO' },
  'plugin.log': { label: '插件日志', module: 'plugin', level: 'INFO' },
  [PERFORMANCE_ACTION]: { label: '性能记录', module: 'performance', level: 'INFO' },
  // P2 内部事件：由单点拦截层自动产生，业务代码不得手写这些 id。
  'ipc.invoke': { label: 'IPC 调用明细', module: 'app', level: 'INFO' },
  'ipc.audit': { label: 'IPC 调用汇总', module: 'app', level: 'INFO' },
  'store.call': { label: '存储层调用', module: 'store', level: 'INFO' },
  'plugin.state': { label: '插件状态迁移', module: 'plugin', level: 'INFO' },
  'plugin.activate': { label: '插件激活', module: 'plugin', level: 'INFO' },
  'plugin.deactivate': { label: '插件停用', module: 'plugin', level: 'INFO' },
  'app.lifecycle': { label: '应用生命周期', module: 'app', level: 'INFO' },
  'app.quit': { label: '应用退出', module: 'app', level: 'INFO' },
  'timer.aggregate': { label: '定时任务汇总', module: 'app', level: 'INFO' },
  // P2 语义化用户事件：target / result / trace 由 observe.ts 统一补齐。
  'user.command': { label: '执行命令', module: 'ui', level: 'INFO' },
  'user.document_open': { label: '打开文档', module: 'document', level: 'INFO' },
  'user.node_click': { label: '点击节点', module: 'graph', level: 'INFO' },
  'user.tab_close': { label: '关闭标签页', module: 'ui', level: 'INFO' },
  'user.tab_switch': { label: '切换标签页', module: 'ui', level: 'INFO' },
  'user.view_open': { label: '打开视图', module: 'ui', level: 'INFO' },
  'user.room_enter': { label: '进入房间', module: 'graph', level: 'INFO' },
  'ai.chat': { label: 'AI 会话', module: 'app', level: 'INFO' },
  'ai.chat_failed': { label: 'AI 会话失败', module: 'app', level: 'WARN' },
  'ai.config_save': { label: 'AI 配置保存', module: 'app', level: 'INFO' },
  'ai.agent_save': { label: 'AI 智能体配置保存', module: 'app', level: 'INFO' },
  'ai.agent_select': { label: 'AI 智能体切换', module: 'app', level: 'INFO' },
  'ai.patch_preview': { label: 'AI 变更预览', module: 'app', level: 'INFO' },
  'ai.patch_commit': { label: 'AI 变更提交', module: 'app', level: 'INFO' },
  'ai.patch_reject': { label: 'AI 变更放弃', module: 'app', level: 'INFO' },
  'ai.tool': { label: 'AI 工具调用摘要', module: 'app', level: 'INFO' },
}

function cardinalityFor(kind: LogFactKind): FactCardinality {
  if (kind === 'intent') return 'per-interaction'
  if (kind === 'state') return 'per-state-change'
  return 'per-event'
}

function ownerFor(kind: LogFactKind): FactOwner {
  if (kind === 'intent') return 'interaction'
  if (kind === 'state') return 'state'
  if (kind === 'process') return 'process'
  if (kind === 'failure') return 'failure'
  if (kind === 'metric') return 'metric'
  return 'periodic'
}

export const LOG_ACTION_SPECS: readonly LogActionSpec[] = LOG_ACTION_IDS.map((id) => {
  const meta = LOG_ACTION_META[id]
  const category = categoryFromLegacy({ level: meta.level, action: id, module: meta.module })
  const kind = inferFactKind(id, meta.level, category)
  return {
    id,
    ...meta,
    description: `${meta.label}（由日志契约注册表生成）`,
    kind,
    cardinality: cardinalityFor(kind),
    factOwner: ownerFor(kind),
  }
})

const ACTION_SPEC_BY_ID = new Map<LogActionId, LogActionSpec>(LOG_ACTION_SPECS.map((s) => [s.id, s]))

export function getActionSpec(id: string): LogActionSpec | undefined {
  return ACTION_SPEC_BY_ID.get(id as LogActionId)
}

export interface ResolvedAction {
  /** 规范 id；未注册时为 unknown.unknown。 */
  id: string
  label: string
  module: LogModuleId
  level: LogLevel
  /** true 表示来自旧中文字符串映射，需要后续分批迁移到 LOG_ACTIONS。 */
  legacy: boolean
  registered: boolean
}

/**
 * 兼容期入口：把 107 处历史中文 action 统一收敛成规范 id。
 * 业务调用点无需改动即可输出规范化日志；未命中不丢日志，原文本进 params.rawAction。
 */
const LEGACY_GROUPS: ReadonlyArray<readonly [LogActionId, readonly string[]]> = [
  [LOG_ACTIONS.workspaceSelect, ['工作目录选择对话框关闭', '已选择工作目录', 'SetupPage:文件对话框关闭', 'SetupPage:选择工作目录']],
  [LOG_ACTIONS.workspaceCreateFailed, ['SetupPage:创建工作目录失败', 'SetupPage:创建工作目录异常']],
  [LOG_ACTIONS.workspaceOpenFailed, ['打开工作目录异常']],
  [LOG_ACTIONS.kbListLoad, ['HomePage:知识库列表加载成功']],
  [LOG_ACTIONS.kbListLoadFailed, ['HomePage:加载知识库列表异常', 'HomePage:统计子节点异常']],
  [LOG_ACTIONS.kbNodeCountLoad, ['HomePage:子节点数量加载完成']],
  [LOG_ACTIONS.kbOpen, ['打开知识库成功', 'HomePage:点击知识库卡片', 'HomePage:键盘打开知识库卡片']],
  [LOG_ACTIONS.kbCreate, ['知识库:创建', '点击新建知识库']],
  [LOG_ACTIONS.kbCreateDialog, ['HomePage:新建知识库弹窗:打开', 'HomePage:新建知识库弹窗:关闭']],
  [LOG_ACTIONS.kbImport, ['知识库:导入', '点击导入知识库', 'HomePage:点击选择导入文件夹', 'HomePage:选择导入文件夹完成', 'HomePage:选择导入文件夹取消']],
  [LOG_ACTIONS.kbImportDialog, ['HomePage:导入知识库弹窗:打开', 'HomePage:导入知识库弹窗:关闭']],
  [LOG_ACTIONS.kbSort, ['HomePage:知识库排序']],
  [LOG_ACTIONS.kbSettingsSave, ['HomePage:知识库设置已保存']],
  [LOG_ACTIONS.kbSettingsSaveFailed, ['HomePage:保存知识库设置失败']],
  [LOG_ACTIONS.kbDelete, ['HomePage:成功删除知识库']],
  [LOG_ACTIONS.kbDeleteFailed, ['HomePage:删除知识库失败']],
  [LOG_ACTIONS.trashRestore, ['回收站:恢复项目']],
  [LOG_ACTIONS.trashClear, ['回收站:清空全部']],
  [LOG_ACTIONS.nodeCreate, ['节点:创建', '节点:快捷键创建', '节点:双击']],
  [LOG_ACTIONS.nodeCreateFailed, ['节点:创建失败']],
  [LOG_ACTIONS.nodeDelete, ['节点:删除']],
  [LOG_ACTIONS.nodeRename, ['节点:重命名']],
  [LOG_ACTIONS.nodeSelect, ['节点:选中', '节点:选中子树', '节点:点击']],
  [LOG_ACTIONS.nodeEnter, ['节点:进入']],
  [LOG_ACTIONS.nodeMove, ['节点:跨房间移动', '节点:跨房间移动-前进', '节点:跨房间移动-撤销']],
  [LOG_ACTIONS.nodeStyleUpdate, ['节点:更新尺寸模式', '节点:更新样式(批量)', '节点:更新表情', '节点:清除自有样式(批量)']],
  [LOG_ACTIONS.containerCreate, ['容器:创建']],
  [LOG_ACTIONS.containerCreateFailed, ['容器:创建失败']],
  [LOG_ACTIONS.edgeCreate, ['连线:创建']],
  [LOG_ACTIONS.edgeDelete, ['连线:删除']],
  [LOG_ACTIONS.edgeUpdate, ['连线:更新关系', '连线:更新关系名', '连线:更新样式', '连线:更新锚点', '连线:样式(设置页)']],
  [LOG_ACTIONS.edgeValidationReject, ['连线:强校验拒绝', '连线:从属校验拒绝', '连线:关系切换被从属校验拒绝']],
  [LOG_ACTIONS.roomLoad, ['房间:加载', '房间:加载完成', '房间:加载触发']],
  [LOG_ACTIONS.roomLoadDiscard, ['房间:加载丢弃']],
  [LOG_ACTIONS.roomNavigate, ['房间:导航', '房间:钻入', '房间:返回根级', '房间历史:快捷导航']],
  [LOG_ACTIONS.graphPageEnter, ['页面:进入图谱']],
  [LOG_ACTIONS.uiContextMenu, ['右键菜单:关闭', '右键菜单:显示']],
  [LOG_ACTIONS.uiShortcut, ['快捷键:搜索节点', '快捷键:撤销', '快捷键:重做']],
  [LOG_ACTIONS.uiView, ['视图:缩略图尺寸调整', '视图:缩略图拖拽平移', '视图:缩略图点击定位', '视图:缩略图节点定位']],
  [LOG_ACTIONS.uiTab, ['Tab:关闭', '切换Tab']],
  [LOG_ACTIONS.documentSave, ['内容:保存', 'Document:保存成功']],
  [LOG_ACTIONS.documentSaveFailed, ['Document:保存失败', 'SaveCoordinator:保存失败']],
  [LOG_ACTIONS.documentRename, ['文档:重命名']],
  [LOG_ACTIONS.documentDelete, ['文档:删除']],
  [LOG_ACTIONS.documentMove, ['文档:移动', '文档:跨节点移动', '文档:跨节点移动-撤销']],
  [LOG_ACTIONS.documentStyleUpdate, ['文档:修改样式']],
  [LOG_ACTIONS.documentExport, ['多类型文档:导出']],
  [LOG_ACTIONS.attachmentUpload, ['附件管理:上传']],
  [LOG_ACTIONS.attachmentDelete, ['附件管理:删除']],
  [LOG_ACTIONS.attachmentOpen, ['附件管理:系统打开', '附件管理:资源管理器打开']],
]

export const LEGACY_ACTION_MAP: Readonly<Record<string, LogActionId>> = Object.freeze(
  Object.fromEntries(
    LEGACY_GROUPS.flatMap(([id, raws]) => raws.map((raw) => [raw, id] as const)),
  ) as Record<string, LogActionId>,
)

export function resolveAction(raw: LogActionInput | undefined): ResolvedAction {
  if (!raw) {
    return { id: UNKNOWN_ACTION_ID, label: '未分类动作', module: 'app', level: 'INFO', legacy: false, registered: false }
  }
  if (typeof raw !== 'string') {
    return { id: UNKNOWN_ACTION_ID, label: '未分类动作', module: 'app', level: 'INFO', legacy: false, registered: false }
  }
  const direct = getActionSpec(raw)
  if (direct) {
    return { id: direct.id, label: direct.label, module: direct.module, level: direct.level, legacy: false, registered: true }
  }
  const mapped = LEGACY_ACTION_MAP[raw]
  if (mapped) {
    const spec = getActionSpec(mapped)!
    return { id: spec.id, label: spec.label, module: spec.module, level: spec.level, legacy: true, registered: true }
  }
  return { id: UNKNOWN_ACTION_ID, label: raw, module: 'app', level: 'INFO', legacy: true, registered: false }
}

// ============================================================
// 3. 字段字典（LogEntry v2）
// ============================================================

export interface LogErrorInfo {
  name: string
  message: string
  stack?: string
}

/** 用户动作指向的对象；label 默认只保留长度摘要（v3 D3 隐私取舍）。 */
export interface LogTarget {
  type: string
  id?: string
  label?: string
}

/**
 * P3 黑匣子面包屑（D2）：只描述「发生了哪种输入、落在什么控件上」，
 * 不含输入正文、文档标题或明文路径。平时只存在于内存，error/崩溃时随日志同步 dump。
 */
export interface Breadcrumb {
  /** epoch ms */
  t: number
  type: string
  target?: { tag?: string; id?: string; role?: string; label?: string }
  view?: string
  seq: number
}

/** P3：本地 minidump 引用，dir 是逻辑目录名而非绝对路径。 */
export interface LogDumpRef {
  available: boolean
  dir: string
  file?: string
  size?: number
  createdAt?: string
}

/** P3：错误发生时的运行环境快照。 */
export interface LogEnv {
  platform: string
  arch: string
  node: string
  electron?: string
  chrome?: string
  appVersion?: string
  pid: number
  sessionId?: string | null
  workspaceId?: string
}

/**
 * 服务层补全后的完整条目。字段用 optional 是为了「读时兼容」：
 * v1 缺 v / error，v2 缺 category / sessionId / seq，查询与订阅都可能拿到
 * 不完整结构，由 _normalizeReadEntry / normalizeLogEntry 补齐。
 * 语义上的必填由 electron/log-service.js 的 write() 保证。
 */
export interface LogEntry {
  v?: LogSchemaVersion
  id?: string
  timestamp?: string
  level?: LogLevel
  module?: LogModuleId | string
  action?: LogActionId | string
  /** 人读动作名（中文），由事件目录生成；v1/v2 缺失时读时补 action label。 */
  label?: string
  category?: LogCategory
  /** 一次应用启动到退出，由主进程生成并统一补全。 */
  sessionId?: string
  /** 会话内单调递增序号，解决同毫秒乱序与跨类文件合并。 */
  seq?: number
  traceId?: string | null
  spanId?: string
  parentId?: string
  /** 工作目录路径的短哈希，不落明文路径（v3 §0.1）。 */
  workspaceId?: string
  target?: LogTarget | null
  result?: string
  source?: string
  outcome?: string
  durationMs?: number
  message?: string
  params?: Record<string, unknown> | null
  /** v2 结构化异常；v1 的散装字符串也允许，UI 会兼容格式化。 */
  error?: LogErrorInfo | string | null
  meta?: Record<string, unknown> | null
  /** P3 error 专属：错误指纹（hash(name + 归一化 message + 栈顶帧)），供 UI 聚合。 */
  fingerprint?: string
  /** P3 error 专属：崩溃前最近 50 条原始输入轨迹，只随 error 日志同步落盘（D2）。 */
  breadcrumbs?: Breadcrumb[]
  /** P3 error 专属：本地 minidump 引用。 */
  dumpRef?: LogDumpRef | null
  /** P3 error 专属：产生该错误时的运行环境。 */
  env?: LogEnv | null
  /** P7 事实唯一性：同一交互内 action + target + kind 的幂等键，主进程据此去重。 */
  dedupeKey?: string
  /** P7：被去重合并的重复条数（不静默丢弃，统计可见）。 */
  repeatCount?: number
  /** P7：产生点显式声明的事实类型；覆盖按前缀推断的 category。 */
  kind?: LogFactKind
  /** P7：一次操作在内存中记录的过程步骤数；步骤本身默认不落盘。 */
  stepCount?: number
  /** P7：仅 error / 慢操作 / 诊断包导出时 dump 的过程步骤。 */
  steps?: TraceStep[]
}

/** P7：内存 trace buffer 的步骤结构（不落盘，除非按需 dump）。 */
export interface TraceStep {
  name: string
  at: number
  durationMs?: number
  outcome?: string
  spanId?: string
  parentId?: string
  /** dump 时由主进程二次脱敏；平时只存在于内存。 */
  params?: Record<string, unknown> | null
}

export interface LogQueryInput {
  date?: string
  keyword?: string
  levels?: string[]
  actions?: string[]
  /** v3：按类过滤，主进程只扫描对应类别的物理文件。 */
  categories?: string[]
  sessionId?: string
  /** v3 P4：按 trace 反查一次操作的完整链路（性能慢样本 → 用户事件）。 */
  traceId?: string
  startTime?: string
  endTime?: string
  limit?: number
  offset?: number
}

export interface LogQueryResult {
  entries: LogEntry[]
  total: number
  parseErrors?: number
}

export interface LogWriteResult {
  /**
   * 仅表示「已被日志服务接纳」：已进内存缓冲、已广播、已排入写队列。
   * **不代表已落盘**；落盘是异步的，真实状态看 durable / pendingWrites / drain()。
   */
  accepted: boolean
  reason?: 'filtered' | 'invalid' | 'write-failed' | 'not-ready' | 'queued'
  entry?: LogEntry
  /**
   * 此刻是否已同步落盘。非 error 类走异步批量写队列，恒为 false；
   * P3 起 error 类走独立 appendFileSync 通道，写入成功才为 true。
   */
  durable?: boolean
  /** 当前仍待写入的条目数（含预缓冲）。 */
  pendingWrites?: number
}

export const LOG_LIMITS = {
  maxBufferSize: 2000,
  maxFileSizeBytes: 10 * 1024 * 1024,
  retentionDays: 14,
  maxMessageLength: 500,
  maxParamsBytes: 8 * 1024,
  maxParamsDepth: 3,
  maxQueryLimit: 500,
  defaultQueryLimit: 200,
} as const

// ============================================================
// 4. 采集层工具：异常归一化、脱敏、消息清洗
// ============================================================

export function normalizeError(err: unknown): LogErrorInfo | null {
  if (err === null || err === undefined) return null
  if (typeof err === 'string') return { name: 'Error', message: err }
  if (err instanceof Error) {
    return { name: err.name || 'Error', message: err.message || String(err), stack: err.stack }
  }
  if (typeof err === 'object' && 'message' in err) {
    const record = err as { name?: unknown; message?: unknown; stack?: unknown }
    return {
      name: typeof record.name === 'string' ? record.name : 'Error',
      message: String(record.message ?? ''),
      stack: typeof record.stack === 'string' ? record.stack : undefined,
    }
  }
  return { name: 'Error', message: safeStringify(err) }
}

export function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export function sanitizeMessage(message: string, max: number = LOG_LIMITS.maxMessageLength): string {
  const clean = String(message ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…（已截断）` : clean
}

/** 与 electron/log-redact.js 保持同名同集合（小写比较），两端口径由 C8 用例交叉校验。 */
const SENSITIVE_KEYS = new Set([
  'content', 'text', 'body', 'markdown', 'html', 'raw', 'documentcontent',
  'filecontent', 'basecontent', 'password', 'token', 'secret', 'apikey',
  'credential', 'authorization', 'cookie', 'base64',
])
// 只匹配明确后缀，不用 includes：否则 context 会被 text 误伤。
const SENSITIVE_SUFFIX = /(?:Content|Text|Body|Markdown|Html|Raw|Password|Token|Secret|ApiKey|Credential|Authorization|Cookie|Base64)$/
const PATH_KEYS = new Set([
  'path', 'nodepath', 'documentpath', 'sourcepath', 'selectedpath', 'dirpath',
  'workdir', 'importedpath', 'attachmentcardpath', 'kbpath', 'roompath',
  'targetcardpath', 'absolutechildpath', 'currentdetaildocumentpath',
  'importdir', 'filepath', 'folderpath', 'rootdir', 'attachmentpath',
])
const PATH_KEY_LOOSE = /path|dir|uri|url|folder|file/i
const LENGTH_ONLY_KEYS = new Set([
  'keyword', 'query', 'searchterm', 'searchtext', 'searchquery',
  'newkeyword', 'previouskeyword', 'notifymessage', 'message',
  'documenttitle', 'nodetitle', 'notetitle', 'usernote',
])
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\/(?:users|home|root)\/|\\\\)/i

function toBasename(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  const last = parts[parts.length - 1] || normalized
  return last.length > 80 ? last.slice(0, 80) : last
}

/** 错误对象保留 name/message/stack（排障主线索），只把其中的绝对路径换成 basename。 */
function redactErrorInfo(value: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of ['name', 'message', 'stack'] as const) {
    const raw = value[field]
    if (typeof raw !== 'string') {
      out[field] = redactValue(raw, undefined, 1, seen)
      continue
    }
    const withoutPaths = raw.replace(/[a-zA-Z]:[\\/][^\s"']+/g, (match) => toBasename(match))
    const max = field === 'stack' ? 4000 : 500
    out[field] = withoutPaths.length > max ? `${withoutPaths.slice(0, max)}…` : withoutPaths
  }
  return out
}

function redactValue(value: unknown, key: string | undefined, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value
  const lowerKey = typeof key === 'string' ? key.toLowerCase() : ''
  if (typeof value === 'string') {
    if (SENSITIVE_KEYS.has(lowerKey) || SENSITIVE_SUFFIX.test(key ?? '')) return '[redacted]'
    if (LENGTH_ONLY_KEYS.has(lowerKey)) return `[length:${value.length}]`
    // data: URI 多为图片/附件的整段 base64，写进日志既无诊断价值，又会撑出
    // MB 级单行日志（实测 8.3MB/行）。统一换成 mime + 长度摘要，作为源头改造
    // 之外的框架层兜底：任何调用点误传封面图/附件内容都不会再造成日志洪水。
    if (value.startsWith('data:')) {
      const semicolon = value.indexOf(';')
      const comma = value.indexOf(',')
      const mimeEnd = semicolon > 5 ? semicolon : comma
      const mime = mimeEnd > 5 ? value.slice(5, mimeEnd) : 'unknown'
      return `[data-uri:${mime};length:${value.length}]`
    }
    // 值形态兜底：即使 key 语义在 params.args 里丢失，绝对路径也不落明文。
    if (ABSOLUTE_PATH.test(value)) return toBasename(value)
    if ((PATH_KEYS.has(lowerKey) || PATH_KEY_LOOSE.test(key ?? '')) && /[\\/]/.test(value)) return toBasename(value)
    return value.length > 200 ? `${value.slice(0, 200)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return String(value)
  if (value instanceof Error) {
    return redactErrorInfo({ name: value.name, message: value.message, stack: value.stack }, seen)
  }
  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]'
    if (depth >= LOG_LIMITS.maxParamsDepth) return '[truncated]'
    if (lowerKey === 'error' && !Array.isArray(value)) {
      return redactErrorInfo(value as Record<string, unknown>, seen)
    }
    seen.add(value as object)
    const result: unknown = Array.isArray(value)
      ? value.slice(0, 50).map((item) => redactValue(item, undefined, depth + 1, seen))
      : (() => {
          const out: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (SENSITIVE_KEYS.has(k.toLowerCase()) || SENSITIVE_SUFFIX.test(k)) {
              out[k] = '[redacted]'
              continue
            }
            out[k] = k.toLowerCase() === 'error' && v && typeof v === 'object' && !Array.isArray(v)
              ? redactErrorInfo(v as Record<string, unknown>, seen)
              : redactValue(v, k, depth + 1, seen)
          }
          return out
        })()
    // 只在递归路径上防环，退出时释放，避免「同一对象被引用两次」被误判为循环引用。
    seen.delete(value as object)
    return result
  }
  return String(value)
}

/** 结构化上下文清洗：脱敏、深度限制、循环引用保护、总体积限制。 */
export function redactParams(params: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!params || typeof params !== 'object') return null
  let cleaned: Record<string, unknown>
  try {
    cleaned = redactValue(params, undefined, 0, new WeakSet<object>()) as Record<string, unknown>
  } catch {
    return { redacted: true, reason: 'redact-failed' }
  }
  const size = (() => { try { return JSON.stringify(cleaned)?.length ?? 0 } catch { return 0 } })()
  if (size > LOG_LIMITS.maxParamsBytes) {
    const slim: Record<string, unknown> = { truncated: true, originalBytes: size }
    for (const [k, v] of Object.entries(cleaned)) {
      slim[k] = v !== null && typeof v === 'object' ? '[truncated]' : v
    }
    return slim
  }
  return cleaned
}

/** 一次用户操作的链路 id；与性能埋点的 trace 形式保持一致。 */
const TRACE_SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
let traceSequence = 0
export function newTraceId(scope = 'app'): string {
  traceSequence += 1
  return `${scope}:${TRACE_SESSION}:${traceSequence}`
}

// ------------------------------------------------------------
// 4.1 v3 关联键作用域：trace 串一次操作，span 串内部父子树
// ------------------------------------------------------------

/**
 * P5 交互窗口：让不在显式作用域内的普通日志（106 处 logAction、log.info、
 * 性能埋点、异步回调里的采集点）也能共享同一次用户操作的 traceId。
 *
 * withTraceId 是同步 try/finally 作用域，await 之后必然复位，无法承载
 * 「点击 → 异步 IPC → 渲染完成」这条真实链路。交互窗口按时间戳**惰性过期**，
 * 不创建任何定时器（P0 曾因 flush 重试定时器在 Node 门禁里形成永动进程）。
 *
 * 取舍：窗口只传播 traceId，**不伪造 span 父子关系**；span 树仍只由
 * observeOperation 的显式作用域生成。周期聚合类日志用 traceId: null 显式声明
 * 「独立事件」，绝不硬塞进最近一次点击的链路。
 */
export const INTERACTION_TTL_MS = 2000

let activeInteraction: { traceId: string; expiresAt: number } | null = null

/** 开始（或覆盖）一次用户交互窗口；ttlMs 供门禁缩短窗口做过期用例。 */
export function startInteraction(traceId: string, ttlMs: number = INTERACTION_TTL_MS): void {
  activeInteraction = traceId ? { traceId, expiresAt: Date.now() + Math.max(0, ttlMs) } : null
}

export function endInteraction(): void {
  activeInteraction = null
}

/** 显式 trace 作用域；没有作用域时才回落到交互窗口。 */
let activeTraceId: string | null = null

/** 显式同步作用域优先；其次读未过期的交互窗口（惰性清理，无定时器）。 */
export function getCurrentTraceId(): string | null {
  if (activeTraceId) return activeTraceId
  if (activeInteraction) {
    if (Date.now() < activeInteraction.expiresAt) return activeInteraction.traceId
    activeInteraction = null
  }
  return null
}

export function withTraceId<T>(scope: string, fn: (traceId: string) => T): T {
  const previous = activeTraceId
  const next = newTraceId(scope)
  activeTraceId = next
  try {
    return fn(next)
  } finally {
    activeTraceId = previous
  }
}

interface SpanContext {
  spanId: string
  parentId: string | null
}
let activeSpan: SpanContext | null = null
let spanSequence = 0

export function newSpanId(scope = 'span'): string {
  spanSequence += 1
  return `${scope}:${TRACE_SESSION}:${spanSequence}`
}

export function getActiveSpan(): SpanContext | null {
  return activeSpan
}

/** 嵌套调用自动生成 parentId，供 P2 的 IPC / 命令 / 插件拦截层构建 span 瀑布。 */
export function withSpan<T>(scope: string, fn: (spanId: string) => T): T {
  const previous = activeSpan
  const next: SpanContext = { spanId: newSpanId(scope), parentId: previous?.spanId ?? null }
  activeSpan = next
  try {
    return fn(next.spanId)
  } finally {
    activeSpan = previous
  }
}

/**
 * 恢复一个已存在的 span 上下文。withTraceId / withSpan 是同步作用域，
 * 在 `await` 之后会复位，异步拦截层无法靠它们传播关联键；
 * P2 的 observe.ts 用本函数显式恢复根 span，再嵌套 withSpan 生成子 span。
 */
export function withSpanContext<T>(spanId: string, parentId: string | null, fn: () => T): T {
  const previous = activeSpan
  activeSpan = { spanId, parentId }
  try {
    return fn()
  } finally {
    activeSpan = previous
  }
}

// ============================================================
// 5. 统一构造入口：任何来源的写入都要先经过它
// ============================================================

/**
 * 采集层交给桥接层的原始输入。只允许字段字典里的键；
 * v1 幽灵字段（file/line/func）仍被丢弃，spanId/parentId 在 v3 已是正式字段，
 * 由 withSpan() 作用域自动注入，调用方不需要手填。
 */
export interface LogEntryInput {
  level?: LogLevel | string
  module?: string
  action?: string
  message?: string
  label?: string
  category?: LogCategory | string
  target?: LogTarget | null
  result?: string
  source?: string
  outcome?: string
  durationMs?: number
  params?: Record<string, unknown> | null
  /** 任意异常值；由 normalizeError 转成结构化 error。 */
  error?: unknown
  /**
   * P5 三态：字符串 = 显式指定；undefined = 跟随当前交互窗口；null = 显式独立
   * （周期聚合 / 主进程日志不归属任何用户操作，落盘时不写该字段）。
   */
  traceId?: string | null
  /** P7：产生点显式声明事实类型，覆盖前缀推断；process 类步骤由 traceBuffer 拦截，不走这里。 */
  kind?: LogFactKind
  /** P7：一次操作记录的步骤数（步骤本体在内存 traceBuffer）。 */
  stepCount?: number
  /** P7：仅 error / 慢操作 / 诊断包导出时随日志同步落盘的步骤明细。 */
  steps?: TraceStep[]
  /** 主进程统一生成的关联键不接受渲染侧传入（防伪造），仅服务端补全。 */
  meta?: Record<string, unknown> | null
}

/** D3：默认不记文档标题 / 节点名，只留长度摘要；详细模式由 P4 决定。 */
function cleanTarget(target: LogTarget | null | undefined): LogTarget | null {
  if (!target || typeof target !== 'object') return null
  const out: LogTarget = { type: sanitizeMessage(String(target.type ?? 'unknown'), 40) }
  if (typeof target.id === 'string' && target.id) out.id = sanitizeMessage(target.id, 120)
  if (typeof target.label === 'string' && target.label) out.label = `[length:${target.label.length}]`
  return out
}

/**
 * 把任意来源的日志输入规整成 v3 条目（不含 id/timestamp/sessionId/seq/workspaceId，
 * 由主进程服务层补全）。这是采集侧的唯一构造入口：logger、logAction、性能埋点、
 * ErrorBoundary、插件 LoggingApi 最终都经过它，因此等级、分类、module、脱敏、
 * 长度限制只实现一次。
 */
export function buildLogEntry(input: LogEntryInput): Partial<LogEntry> {
  const level: LogLevel = normalizeLogLevel(input.level)
  const action = typeof input.action === 'string' && input.action ? input.action.slice(0, 120) : undefined
  const spec = action ? getActionSpec(action) : undefined
  const message = sanitizeMessage(input.message || spec?.label || action || '日志事件')
  const label = sanitizeMessage(input.label || spec?.label || action || '日志事件', 80)
  const inferredCategory = categoryFromLegacy({
    level, action, module: input.module,
    category: isLogCategory(input.category) ? input.category : undefined,
  })
  // P7 M2：产生点显式声明 kind 时由它决定分类，不再靠 action 前缀猜。
  const kind = input.kind ?? inferFactKind(action ?? '', level, inferredCategory)
  const category = input.kind ? categoryFromKind(input.kind) : inferredCategory
  const params = redactParams(input.params)
  const error = input.error === undefined || input.error === null ? undefined : normalizeError(input.error)
  // P5 三态 traceId：显式值 > 当前交互窗口 > 现场生成。
  // 显式 null = 「独立事件」（周期聚合、主进程日志），不写 traceId 字段，
  // 绝不硬塞进最近一次用户操作的链路而伪造因果。
  const resolvedTraceId = input.traceId === null
    ? null
    : (input.traceId || getCurrentTraceId() || newTraceId('renderer'))
  const span = getActiveSpan()
  const meta = input.meta && typeof input.meta === 'object' ? input.meta : undefined
  const target = cleanTarget(input.target)
  // P7 M5：同一交互内「同一事实」共用一个幂等键；独立事件（traceId=null）不参与去重，
  // 周期聚合各自成立，不会被误合并。key 只含不可逆短哈希，不落明文 target。
  const dedupeKey = resolvedTraceId
    ? `dk_${stableHash32(`${kind}|${action ?? ''}|${target?.type ?? ''}|${target?.id ?? ''}|${resolvedTraceId}`)}`
    : null

  return {
    v: LOG_SCHEMA_VERSION,
    level,
    module: resolveModule(input.module),
    category,
    kind,
    ...(action ? { action } : {}),
    message,
    label,
    ...(target ? { target } : {}),
    ...(typeof input.result === 'string' && input.result ? { result: sanitizeMessage(input.result, 40) } : {}),
    ...(typeof input.source === 'string' && input.source ? { source: sanitizeMessage(input.source, 40) } : {}),
    ...(typeof input.outcome === 'string' && input.outcome ? { outcome: sanitizeMessage(input.outcome, 40) } : {}),
    ...(typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
      ? { durationMs: Math.max(0, Math.round(input.durationMs)) } : {}),
    ...(params ? { params } : {}),
    ...(error ? { error } : {}),
    ...(resolvedTraceId ? { traceId: resolvedTraceId } : {}),
    ...(dedupeKey ? { dedupeKey } : {}),
    ...(span ? { spanId: span.spanId, ...(span.parentId ? { parentId: span.parentId } : {}) } : {}),
    ...(typeof input.stepCount === 'number' && Number.isFinite(input.stepCount)
      ? { stepCount: Math.max(0, Math.round(input.stepCount)) } : {}),
    ...(Array.isArray(input.steps) && input.steps.length > 0
      ? { steps: input.steps.slice(0, 100) } : {}),
    ...(meta ? { meta } : {}),
  }
}
