/**
 * 性能指标契约 —— 全应用唯一真源。
 *
 * 分层依据来自应用功能分析：
 *   navigation  首页 / 知识库 / 房间的加载链路（用户等待整块内容出现）
 *   interaction 画布上的点击、创建、删除（要求即时反馈）
 *   document    详情文档与附件的读写、导出（IO 密集）
 *   data        检索、引用关系、知识库导入（可能扫全库）
 *   runtime     启动耗时与主线程长任务（无需业务代码配合，由观测器自动上报）
 *
 * 新增指标只需在 PERFORMANCE_METRICS 加 id、在 PERFORMANCE_METRIC_SPECS 加一条定义，
 * 埋点层 / 统计层 / 监控页面会自动消费，禁止在别处再抄一份 id 列表。
 * 颜色只引用 tokens.css 的语义变量（单色制），不在此处写死 hex。
 */
export const PERFORMANCE_ACTION = '性能:记录'

export const PERFORMANCE_CATEGORIES = {
  navigation: { id: 'navigation', label: '导航与加载', color: 'var(--color-accent)' },
  canvas: { id: 'canvas', label: '画布操作', color: 'var(--color-primary)' },
  interaction: { id: 'interaction', label: '交互响应', color: 'var(--color-primary)' },
  document: { id: 'document', label: '文档读写', color: 'var(--color-success)' },
  data: { id: 'data', label: '数据与检索', color: 'var(--color-warning)' },
  runtime: { id: 'runtime', label: '运行时健康', color: 'var(--color-danger)' },
} as const

export type PerformanceCategoryId = keyof typeof PERFORMANCE_CATEGORIES
export const PERFORMANCE_CATEGORY_IDS = Object.keys(PERFORMANCE_CATEGORIES) as PerformanceCategoryId[]

/** 指标 id 常量：业务代码一律用 PERFORMANCE_METRICS.xxx，禁止裸字符串。 */
export const PERFORMANCE_METRICS = {
  roomLoad: 'room_load',
  kbListLoad: 'kb_list_load',
  appStartup: 'app_startup',
  nodeSelect: 'node_select',
  nodeCreate: 'node_create',
  nodeDelete: 'node_delete',
  edgeCreate: 'edge_create',
  detailRead: 'detail_read',
  detailSave: 'detail_save',
  documentExport: 'document_export',
  attachmentUpload: 'attachment_upload',
  kbImport: 'kb_import',
  documentSearch: 'document_search',
  documentRelations: 'document_relations',
  longTask: 'long_task',
  canvasEdit: 'canvas_edit',
  canvasGesture: 'canvas_gesture',
  graphMetaBuild: 'graph_meta_build',
  graphMetaFlush: 'graph_meta_flush',
  canvasQuery: 'canvas_query',
  canvasLod: 'canvas_lod',
} as const

export type PerformanceMetricId = typeof PERFORMANCE_METRICS[keyof typeof PERFORMANCE_METRICS]
export const PERFORMANCE_METRIC_IDS = Object.values(PERFORMANCE_METRICS) as PerformanceMetricId[]

export interface PerformanceMetricSpec {
  id: PerformanceMetricId
  label: string
  shortLabel: string
  category: PerformanceCategoryId
  /** 超过该耗时的成功样本计为慢操作。 */
  thresholdMs: number
  /** 说明该指标测什么，页面 tooltip 与文档共用。 */
  description: string
  /** 采样率 (0,1]；高频指标用它降噪，1 表示全量。 */
  sampleRate: number
  /** 同一指标两次上报的最小间隔（ms），0 表示不节流。 */
  minIntervalMs: number
}

export const PERFORMANCE_METRIC_SPECS: readonly PerformanceMetricSpec[] = [
  {
    id: PERFORMANCE_METRICS.roomLoad, label: '房间加载', shortLabel: '加载',
    category: 'navigation', thresholdMs: 400, sampleRate: 1, minIntervalMs: 0,
    description: '从发起 loadRoom 到节点/边写入图状态并完成渲染准备的耗时',
  },
  {
    id: PERFORMANCE_METRICS.kbListLoad, label: '知识库列表加载', shortLabel: '库列表',
    category: 'navigation', thresholdMs: 800, sampleRate: 1, minIntervalMs: 0,
    description: '首页读取知识库清单、配置、封面与子节点计数的整段耗时',
  },
  {
    id: PERFORMANCE_METRICS.appStartup, label: '应用启动', shortLabel: '启动',
    category: 'navigation', thresholdMs: 3000, sampleRate: 1, minIntervalMs: 0,
    description: '渲染进程脚本开始执行到 React 首帧提交完成的耗时',
  },
  {
    id: PERFORMANCE_METRICS.nodeSelect, label: '节点选中响应', shortLabel: '选中',
    category: 'interaction', thresholdMs: 150, sampleRate: 1, minIntervalMs: 0,
    description: '点击节点到详情会话首屏内容可用的耗时（含文档读取）',
  },
  {
    id: PERFORMANCE_METRICS.nodeCreate, label: '新建节点', shortLabel: '新建',
    category: 'interaction', thresholdMs: 120, sampleRate: 1, minIntervalMs: 0,
    description: '构建节点并同步插入画布状态的耗时，含退化到重载路径的落盘',
  },
  {
    id: PERFORMANCE_METRICS.nodeDelete, label: '删除节点', shortLabel: '删除',
    category: 'interaction', thresholdMs: 250, sampleRate: 1, minIntervalMs: 0,
    description: '把节点目录移入回收站并从画布移除节点与关联边的耗时',
  },
  {
    id: PERFORMANCE_METRICS.edgeCreate, label: '新建连线', shortLabel: '连线',
    category: 'interaction', thresholdMs: 120, sampleRate: 1, minIntervalMs: 0,
    description: '构造连线、写入图状态并触发后台落盘的耗时',
  },
  {
    id: PERFORMANCE_METRICS.detailRead, label: '详情文档读取', shortLabel: '读取',
    category: 'document', thresholdMs: 200, sampleRate: 1, minIntervalMs: 0,
    description: '从磁盘读取当前选中节点的智能文档正文的耗时',
  },
  {
    id: PERFORMANCE_METRICS.detailSave, label: '详情文档保存', shortLabel: '保存',
    category: 'document', thresholdMs: 300, sampleRate: 1, minIntervalMs: 0,
    description: '序列化草稿并写回智能文档文件的耗时',
  },
  {
    id: PERFORMANCE_METRICS.documentExport, label: '导出文档', shortLabel: '导出',
    category: 'document', thresholdMs: 800, sampleRate: 1, minIntervalMs: 0,
    description: 'flush 草稿、读取正文并生成下载文件的耗时',
  },
  {
    id: PERFORMANCE_METRICS.attachmentUpload, label: '上传附件', shortLabel: '附件',
    category: 'document', thresholdMs: 1500, sampleRate: 1, minIntervalMs: 0,
    description: '批量导入附件并刷新附件列表的耗时',
  },
  {
    id: PERFORMANCE_METRICS.kbImport, label: '导入知识库', shortLabel: '导入',
    category: 'data', thresholdMs: 5000, sampleRate: 1, minIntervalMs: 0,
    description: '导入整个知识库目录并刷新首页列表的耗时',
  },
  {
    id: PERFORMANCE_METRICS.documentSearch, label: '文档检索', shortLabel: '检索',
    category: 'data', thresholdMs: 300, sampleRate: 1, minIntervalMs: 0,
    description: '走派生文档树索引的一次搜索查询耗时（不含输入 debounce）',
  },
  {
    id: PERFORMANCE_METRICS.documentRelations, label: '引用关系查询', shortLabel: '引用',
    category: 'data', thresholdMs: 250, sampleRate: 1, minIntervalMs: 0,
    description: '读取文档出入链关系的一次查询耗时（命中索引时不读正文）',
  },
  {
    id: PERFORMANCE_METRICS.longTask, label: '主线程长任务', shortLabel: '长任务',
    category: 'runtime', thresholdMs: 100, sampleRate: 1, minIntervalMs: 200,
    description: 'PerformanceObserver 捕获的 ≥50ms 主线程阻塞，durationMs 为阻塞时长',
  },
  {
    id: PERFORMANCE_METRICS.canvasEdit, label: '画布编辑操作', shortLabel: '编辑',
    category: 'canvas', thresholdMs: 200, sampleRate: 1, minIntervalMs: 0,
    description: '画布离散写操作从入口到状态写回完成，具体动作看 params.operation；不含后台落盘',
  },
  {
    id: PERFORMANCE_METRICS.canvasGesture, label: '画布连续手势', shortLabel: '手势',
    category: 'canvas', thresholdMs: 400, sampleRate: 1, minIntervalMs: 0,
    description: '拖拽/缩放/平移/resize 一次手势会话的总耗时，逐帧只累积计数，结束上报一条',
  },
  {
    id: PERFORMANCE_METRICS.graphMetaBuild, label: '图数据全量构建', shortLabel: '构建',
    category: 'canvas', thresholdMs: 100, sampleRate: 1, minIntervalMs: 0,
    description: 'saveLater/saveNow 触发的同步 buildMetaFromNodesEdges（O(N+E)），多节点主要瓶颈',
  },
  {
    id: PERFORMANCE_METRICS.graphMetaFlush, label: '图数据写盘', shortLabel: '写盘',
    category: 'canvas', thresholdMs: 500, sampleRate: 0.5, minIntervalMs: 100,
    description: '后端 writeLayout 的 IPC 写盘耗时，不含 debounce 等待；慢样本强制上报',
  },
  {
    id: PERFORMANCE_METRICS.canvasQuery, label: '画布查询与定位', shortLabel: '定位',
    category: 'canvas', thresholdMs: 300, sampleRate: 1, minIntervalMs: 100,
    description: '画布内搜索、节点树展开、点击结果定位到镜头稳定的耗时，动作看 params.operation',
  },
  {
    id: PERFORMANCE_METRICS.canvasLod, label: 'LOD 可见集合重算', shortLabel: 'LOD',
    category: 'canvas', thresholdMs: 120, sampleRate: 1, minIntervalMs: 0,
    description: 'signature 变化触发的 computeLodVisibility 同步重算（含图型推断），不含渲染与落盘',
  },
]

export const PERFORMANCE_METRIC_SPEC_BY_ID = Object.fromEntries(
  PERFORMANCE_METRIC_SPECS.map((spec) => [spec.id, spec]),
) as Record<PerformanceMetricId, PerformanceMetricSpec>

/**
 * 画布具体动作不单独占一个指标 id，而是作为 params.operation 维度；
 * 统计层按 operation 聚合，新增动作不需要改注册表 / 页面指标表。
 */
export const CANVAS_OPERATIONS = {
  create: 'create',
  delete: 'delete',
  deleteBatch: 'delete_batch',
  edgeCreate: 'edge_create',
  drag: 'drag',
  zoom: 'zoom',
  pan: 'pan',
  resize: 'resize',
  metaBuild: 'meta_build',
  metaFlush: 'meta_flush',
  search: 'search',
  locate: 'locate',
  treeExpand: 'tree_expand',
  lodRecompute: 'lod_recompute',
  edgeDelete: 'edge_delete',
  anchorAdjust: 'anchor_adjust',
  batchStyle: 'batch_style',
  mirror: 'mirror',
  subtreeSelect: 'subtree_select',
  treeOrder: 'tree_order',
} as const

export type CanvasOperationId = typeof CANVAS_OPERATIONS[keyof typeof CANVAS_OPERATIONS]

/** 每个动作的慢操作阈值（ms）；注册表阈值是 operation 缺省时的兜底值。 */
export const CANVAS_OPERATION_THRESHOLDS: Record<CanvasOperationId, number> = {
  create: 120,
  delete: 250,
  delete_batch: 400,
  edge_create: 120,
  drag: 300,
  zoom: 400,
  pan: 200,
  resize: 250,
  meta_build: 100,
  meta_flush: 500,
  search: 120,
  locate: 300,
  tree_expand: 400,
  lod_recompute: 120,
  edge_delete: 150,
  anchor_adjust: 150,
  batch_style: 200,
  mirror: 250,
  subtree_select: 150,
  tree_order: 150,
}

export const CANVAS_OPERATION_LABELS: Record<CanvasOperationId, string> = {
  create: '新建节点',
  delete: '删除节点',
  delete_batch: '批量删除',
  edge_create: '新建连线',
  drag: '移动节点',
  zoom: '缩放画布',
  pan: '平移画布',
  resize: '调整尺寸',
  meta_build: '全量构建',
  meta_flush: '写盘',
  search: '画布搜索',
  locate: '搜索定位',
  tree_expand: '节点树展开',
  lod_recompute: 'LOD 重算',
  edge_delete: '删除连线',
  anchor_adjust: '调整锚点',
  batch_style: '批量样式',
  mirror: '水平镜像',
  subtree_select: '选中子树',
  tree_order: '树排序',
}

export function canvasOperationThreshold(operation: string): number | null {
  return CANVAS_OPERATION_THRESHOLDS[operation as CanvasOperationId] ?? null
}

/**
 * 耗时随节点数线性增长的动作：阈值按规模对数放宽，否则万级节点房间会被
 * 静态阈值 100% 标红，慢操作反而失去区分度。交互类（点击/拖拽/缩放）不放宽，
 * 那些变慢就是真的退化。上限 8 倍，保证异常峰值仍能被判为慢。
 *
 * 只在埋点上报时把结果写进 params.thresholdMs；isSlowSample 的语义不变，
 * 统计层无需知道「阈值是怎么来的」，存量样本与回归夹具也不受影响。
 */
export const SCALE_ADJUSTED_OPERATIONS: readonly CanvasOperationId[] = [
  'meta_build', 'meta_flush', 'delete_batch', 'lod_recompute',
  'search', 'tree_expand', 'batch_style', 'subtree_select',
]

export function thresholdForScale(base: number, nodeCount: number, operation?: string): number {
  if (!Number.isFinite(base) || base <= 0) return base
  if (!operation || !SCALE_ADJUSTED_OPERATIONS.includes(operation as CanvasOperationId)) return base
  if (!Number.isFinite(nodeCount) || nodeCount <= 200) return base
  const factor = Math.min(8, 1 + Math.log2(1 + nodeCount / 200) * 0.6)
  return Math.round(base * factor)
}

export function resolvePerformanceMetricSpec(id: string): PerformanceMetricSpec | null {
  return PERFORMANCE_METRIC_SPEC_BY_ID[id as PerformanceMetricId] ?? null
}

export function performanceMetricCategory(id: string): PerformanceCategoryId {
  return resolvePerformanceMetricSpec(id)?.category ?? 'runtime'
}

export interface PerformanceLogParams extends Record<string, unknown> {
  metric: PerformanceMetricId
  durationMs: number
  success?: boolean
  /** 一次应用会话的标识，用于区分重启前后的样本。 */
  sessionId?: string
  /** 上报来源模块，如 useGraph / HomePage / PerformanceObserver。 */
  source?: string
  /** 同一条用户操作链路的标识，便于把多个指标串起来看。 */
  traceId?: string
  /** 埋点上下文键（节点 id / 房间路径等），用于定位慢样本。 */
  contextKey?: string
}
