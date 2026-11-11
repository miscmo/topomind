/**
 * 语义缩放 LOD（纯函数层，无 DOM / 无 store / 无 IPC，供 esbuild 打包真跑）。
 *
 * 【用户决策 2026-11-08】缩放不是单纯的 UI 放大，而是「镜头拉近 / 远离」：
 *   - 边缘由**从属关系树**定义：树上节点按 depth 逐级显现，游离节点先隐藏；
 *   - 树根任何档位都保留，否则一缩小整棵树连根消失；
 *   - `pin` 是「手动指定深度」的替代：置顶节点始终显示，**不参与树、不改 depth**；
 *   - **无树保护**：没有从属边、或树覆盖率过低时自动关闭 LOD，否则纯关联图 /
 *     流程图一缩小就变空。`force` 模式可由用户显式跳过保护。
 *
 * 【2026-11-08 二次优化】用户反馈「一到某个比例以下，节点深度就骤降」：
 * 旧的 4 个离散档位（100/3/2/1 级）让节点成批出现/消失。现在改成
 * **逐节点连续 reveal 阈值**——每个深度、每个游离节点都有自己的显示比例临界点，
 * 缩放时一次只进出少数节点；再叠加滞回（防临界点抖动）与淡入淡出（防视觉跳变）。
 *
 * 【2026-11-09 方向修复】用户反馈「缩小的时候反而是树的主干先消失」。
 * 排查结论：深度自动推断是对的（root=1 / 子=2 / 孙=3），错的是 reveal 方向 ——
 * 判据是 `ratio >= reveal`，**阈值越低越晚消失**，旧实现却让 depth 越大阈值越低，
 * 于是浅层主干先被藏、最深的叶子留到最后，正好与用户定义相反。
 * 退场顺序固定为：游离节点 → 深层叶子 → 浅层主干 → 树根（恒定保留）。
 *
 * 【2026-11-09 三次优化】用户反馈「前期缩放节点隐藏少、后期突然变多」。
 * 根因：旧阈值按「深度序号 / 游离排名」线性铺开，等于按**档位**而不是按**节点数**
 * 分配行程。真实图谱的深度分布极不均衡（大量节点挤在同一两层），跨过那一层的
 * 阈值就会整层消失；游离节点往往只有几个，却独占 100%→70% 的全部行程，
 * 于是前 30% 行程几乎不隐藏节点，后 40% 行程突然塞进绝大多数节点。
 * 现在改成 **按累计节点数分位数分配阈值**：先按上面的语义排好「退场序列」，
 * 再把 100%→30% 的行程按序列下标均匀分给每个节点，任意一段缩放行程隐藏的
 * 节点数都≈恒定，与「某层有多少节点」无关。顺序语义完全保留，只改节奏。
 *
 * 【2026-11-09 P1】P0 把节点屏幕尺寸钉住后，「缝隙收拢」与「边缘渐隐」应当
 * 像地图一样自然交替。这里把分位阈值再经 `lodPressure.ts` 的几何压力曲线求逆：
 * 稀疏布局先紧凑、密集簇先渐隐，节奏由真实坐标分布决定，而不是硬编码阶段表。
 * 无坐标数据（最小构造 / 节点 <3 个）时曲线恒等，旧行为逐值不变。
 *
 * 【2026-11-11 自定义永久显示层数】用户要求「深度 1 和深度 2 的节点**全部**保留、
 * 永久显示」，并且层数要能在左侧状态面板随时改。旧实现只从退场序列末尾挑 1 个
 * depth 2 节点当骨架（用户：「看起来只是保留了深度为 2 的其中一个节点」）。
 * 现在 `preservedDepth`（默认 2）定义「永久保留的最深层级」：
 *   - 所有 depth <= preservedDepth 的树节点（树根算第 1 层）恒定显示，
 *     不受缩放 / 滞回 / 30% 最远镜头 / 碰撞抽稀影响；游离节点没有树深度，不在此列；
 *   - 它们仍占 exitOrder 的 rank、只是不分配 reveal 阈值 → 其余节点阈值逐值不变，
 *     压力曲线 / 单调性 / 单步隐藏上限一律不受影响；
 *   - 与树根同进碰撞 protected / priority 集合：**层数优先于零重叠**（用户强制保留，
 *     受保护节点彼此若重叠只计入 protectedOverlapPairs 诊断豁免）。
 * 骨架选择只依赖层级（id + 边），**不读坐标**，拖动节点不会让它闪来闪去。
 *
 * 【2026-11-11 两段镜头】用户要求「最小缩到 5%；缩到 20% 后最少保留两层深度，
 * 再继续缩小就只是让图谱更紧凑」。于是渐隐行程收窄为 100%→20%（LOD_FLOOR_RATIO
 * 由 zoomScale.COMPACT_START_RATIO 唯一派生）；20%→5% 是**紧凑行程**：
 * 用 `lodRatio = max(ratio, LOD_FLOOR_RATIO)` 参与所有可见性判定，可见集合严格冻结
 * 在 20% 端点（不再隐藏也不再显示任何节点），并跳过碰撞抽稀；诊断 displayPercent
 * 仍回吐真实读数。紧凑区的「更紧凑」由 viewport 等比缩小 + 字形补偿冻结实现，
 * 一行坐标都不改，P2 三条铁律（手摆位置落盘 / 返回视野 / hidden 不落盘）不受影响。
 *
 * 权威数据始终是 `_graph.json` 上 edges 的 relation；本模块只产出「哪些 id 该隐藏」，
 * 绝不改节点 / 边数据本身（`hidden` 是 React Flow 的渲染属性，不落盘）。
 * 深度派生不落盘，索引丢了可全文重建，绕开节点字段 7 处白名单。
 */
import {
  MAX_HIERARCHY_DEPTH,
  buildHierarchy,
  computeLodVisibleNodes,
  toHierarchyEdge,
  type GraphHierarchy,
} from './graphHierarchy.ts'
import { isSubordinate, readEdgeRelationId } from './edgeRelations.ts'
import { buildLodPressureCurve, type LodPosition } from './lodPressure.ts'
import {
  emptyCollisionResult,
  resolveLodCollisions,
  type LodCollisionResult,
} from './lodCollision.ts'
import {
  COMPACT_START_RATIO,
  ZOOM_REFERENCE,
  clampRawZoom,
  describeLodStage,
  glyphCompensationForZoom,
  glyphScaleForRatio,
  resolveLodStage,
  toDisplayPercent,
  toDisplayRatio,
} from './zoomScale.ts'

/** 树覆盖率低于此值时自动关闭 LOD（纯关联图 / 流程图保护）。 */
export const LOD_TREE_COVERAGE_THRESHOLD = 0.25
/** 100% 显示比：全图可见（含游离）。 */
export const LOD_FULL_RATIO = 1
/**
 * 20% 显示比（渐隐终点 / 紧凑起点）：只剩「永久显示层数内的全部节点」；
 * 其余节点一律隐藏（不受滞回拖延）。20% 以下可见集合冻结，只做紧凑。
 * 唯一事实源是 zoomScale.COMPACT_START_RATIO，禁止在这里另写一个 0.2。
 */
export const LOD_FLOOR_RATIO = COMPACT_START_RATIO
/**
 * 「永久显示层级」默认值：1 = 只保树根，2 = 树根 + **全部**一级子（用户要的保底两层）。
 * 与 graphHierarchy 的深度定义同源（root=1 / 子=2），不要写成 0-based。
 * 这是默认值，不是上限：面板可随时改成 1~8 层或「全部层级」。
 */
export const LOD_DEFAULT_PRESERVED_DEPTH = 2
/** 面板「全部层级」的取值，与 hierarchy 深度上限同源，避免再发明第二套深度上限。 */
export const LOD_MAX_PRESERVED_DEPTH = MAX_HIERARCHY_DEPTH
/**
 * 层数唯一归一化入口：面板字符串 / 脏 localStorage / 越界输入一律收敛到 [1, MAX]。
 * 非数字与 0 不是合法层数，回落到默认两层（老房间没有这个字段时行为不变）。
 */
export function normalizePreservedDepth(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed === 0) return LOD_DEFAULT_PRESERVED_DEPTH
  return Math.min(LOD_MAX_PRESERVED_DEPTH, Math.max(1, Math.trunc(parsed)))
}
/** 临界点滞回带：已显示的节点要再缩小 1.5% 才隐藏，避免在阈值附近来回闪。 */
export const LOD_HYSTERESIS = 0.015
/** 进/出过渡时长（ms）：与镜头按钮过渡同节奏，动画比旧的 170ms 更柔和。 */
export const LOD_FADE_MS = 240
/** 同时参与淡出的对象上限；按节点数分位数退场后单批不会太大，这里留足余量。 */
export const LOD_MAX_FADE_NODES = 480
export const LOD_MAX_FADE_EDGES = 800

export type LodMode = 'auto' | 'off' | 'force'

/**
 * 「退场序列」里第 rank 个（0-based，共 count 个）非根节点被看见所需的最小显示比。
 *
 * 【方向铁律】判据是 `ratio >= reveal`，**阈值越高越早消失**。
 * 序列由 computeLodVisibility 排好：游离（度小者先）→ 深层叶子 → 浅层主干，
 * 所以随着 rank 增大 reveal 单调递减，天然保证「主干晚于深层、树根永不隐藏」。
 *
 * 关键是这里按**节点数**分配行程，而不是按深度级数 / 游离排名区间：
 * `reveal = 100% - (rank + 0.5) / count * 80%`，即把 100%→20% 均匀切成 count 份，
 * 每缩小 1% 显示比就固定隐藏约 `count / 80` 个节点。用中点 (rank+0.5) 是为了
 * 首节点在 100% 之下就退场、末节点在 20% 之上就退场，不留空档也不越界。
 * 旧实现按「档位」分配，深度分布一偏斜就会整层骤降（2026-11-09 三次优化）。
 * 【密度自适应】分位本身不动，改由 zoomScale 的步进灵敏度按 √N 放慢大图的
 * 每格缩放量，避免「节点多、树深时一格滚轮消失一片」（见 zoomScale 文件头）。
 */
export function revealRatioForRank(rank: number, count: number): number {
  if (count <= 0) return LOD_FULL_RATIO
  const index = Math.min(count - 1, Math.max(0, Number.isFinite(rank) ? rank : 0))
  return LOD_FULL_RATIO - ((index + 0.5) / count) * (LOD_FULL_RATIO - LOD_FLOOR_RATIO)
}

export interface LodNodeLike {
  id: string
  selected?: boolean
  hidden?: boolean
  /** React Flow 的 flow 坐标，P1 几何压力只读；缺省时曲线退回恒等 */
  position?: LodPosition | null
  /** 锚点壳尺寸（autoSize 会写回 DOM 实测值）；P1.9 碰撞盒用，缺省退回磁盘默认值 */
  width?: number
  height?: number
  measured?: { width?: number; height?: number } | null
  /** React Flow 的 CSSProperties；纯函数层只读写自己那几个 key，故用 unknown 保持类型兼容 */
  style?: unknown
  /** 只用于左上角诊断面板读取标题；纯函数层只读不写 */
  data?: unknown
}

export interface LodEdgeLike {
  id: string
  source: string
  target: string
  hidden?: boolean
  style?: unknown
  /** 渲染层边把 relation 放在 data 上，磁盘边放在顶层，两者都兼容 */
  relation?: string
  data?: { relation?: string }
}

export interface LodVisibilityInput {
  nodes: readonly LodNodeLike[]
  edges: readonly LodEdgeLike[]
  /** raw React Flow zoom（权威输入），缺省按 100% 处理 */
  zoom?: number
  mode?: LodMode
  /**
   * 房间图型显式声明「这是层级图」时跳过「树覆盖率过低」保护。
   * **不影响无树保护**：一条从属边都没有时仍然自动关闭，否则一缩小整房变空。
   */
  skipCoverageProtection?: boolean
  /**
   * 永久显示的树深度层数（左侧状态面板随时可改，本机偏好持久化）。
   * 缺省 / 非法值一律回落到 LOD_DEFAULT_PRESERVED_DEPTH；只影响保底集合，
   * 不改退场顺序、不改任何节点的坐标或落盘字段。
   */
  preservedDepth?: number
  /** 用户置顶（本机偏好，按房间隔离） */
  pinned?: ReadonlySet<string>
  /** 搜索定位等临时显示，跨粗档位即清空 */
  revealed?: ReadonlySet<string>
  /** 上一次的可见集合，用于临界点滞回；首帧不传（无滞回） */
  previousVisibleNodeIds?: ReadonlySet<string>
  /**
   * 面板 / 置顶控件使用的「当前选中节点」（来自 graph store）。
   * React Flow 的选中态不保证同步进 nodes[].selected，诊断与强制显示
   * 必须与置顶按钮共用同一个来源，否则点选节点后深度栏会一直空白。
   */
  selectedNodeId?: string | null
}

export type LodReason = 'active' | 'forced' | 'off' | 'no-tree' | 'low-coverage'
export type LodNodeKind = 'root' | 'tree' | 'free'

/** 某一树深度的节点总数与当前可见数（左上角诊断面板直接消费）。 */
export interface LodDepthLevel {
  depth: number
  total: number
  visible: number
}

/** 当前选中节点的层级诊断，用来核对「自动推断出来的深度对不对」。 */
export interface LodSelectedNodeInfo {
  id: string
  label: string
  /** hierarchy 派生的深度；游离节点也返回 1，用 kind 区分 */
  depth: number
  kind: LodNodeKind
  visible: boolean
  /** 不强制显示时，该节点所需的最小显示比；树根为 null（恒定显示） */
  revealRatio: number | null
  /** 当前是否因 pin / 选中 / 临时 reveal 被强制显示 */
  forced: boolean
}

export interface LodVisibility {
  active: boolean
  reason: LodReason
  /** 粗档位（0~3），只用于 UI 标签与清空临时显示，不参与裁剪 */
  tier: number
  /** 当前实际可见的最大树深度（连续变化） */
  maxDepth: number
  /** 当前是否还有游离节点可见 */
  showFree: boolean
  label: string
  /** 用户视角百分比（100% = raw 0.5） */
  displayPercent: number
  treeCoverage: number
  subordinateEdgeCount: number
  /** 全部节点 id（含隐藏），便于 UI 统计 */
  totalNodeCount: number
  /** 当前选中节点（直接从 nodes 派生，避免依赖另一个 store 的同步时序） */
  selectedNodeIds: string[]
  /** 全树最大深度（不随缩放变化），用于核对深度自动推断 */
  treeMaxDepth: number
  rootCount: number
  freeCount: number
  /** P1 几何压力是否生效（无坐标 / 节点 <3 时为 false，退回纯分位节奏） */
  pressureActive: boolean
  /** 参与压力统计的坐标样本数 */
  pressureSampleCount: number
  /** P1.5 压力是否已计入远景字形放大（无坐标时为 false） */
  pressureGlyphAware: boolean
  /** P1.9 碰撞约束是否生效（100% 恒等点 / LOD 关闭时为 false） */
  collisionActive: boolean
  /** 因「紧凑到重叠」而额外渐隐的节点数（含被连带裁掉的子树） */
  collisionHiddenCount: number
  /** 100%→85% 的平滑启用系数，供 GUI 直读 */
  collisionGuard: number
  /** 实际用于碰撞判定的盒放大倍数 */
  collisionBoxScale: number
  /** 恒定保留节点之间仍存在的重叠对数（用户强制保留优先，仅诊断） */
  collisionProtectedOverlapPairs: number
  /** P1.75 可见主干节点 → 名下被折叠的下级节点数（最近可见祖先归属，不重复计数） */
  collapsedCounts: Map<string, number>
  /** 已归属到主干卡片的隐藏节点总数 */
  collapsedTotal: number
  /** 无从属祖先、无法归属到任何卡片的隐藏节点数（游离节点） */
  collapsedFreeCount: number
  /** 每级树节点的 总数 / 当前可见数，按 depth 升序 */
  depthLevels: LodDepthLevel[]
  /** 当前有节点可见的树深度层数；最远镜头必须 >= min(preservedDepth, treeMaxDepth) */
  visibleDepthLevelCount: number
  /** 本次实际生效的永久显示层数（归一化后，面板与裁剪同源，不另存一份状态） */
  preservedDepth: number
  /** 选中节点（取第一个）的层级诊断，无选中为 null */
  selectedNode: LodSelectedNodeInfo | null
  visibleNodeIds: Set<string>
  hiddenNodeIds: Set<string>
  hiddenEdgeIds: Set<string>
}

/** 淡入淡出集合：out 中的对象先保持挂载并淡出，到时再真正 hidden；in 中的挂载时淡入。 */
export interface LodFadeState {
  out: ReadonlySet<string>
  in: ReadonlySet<string>
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>()
const EMPTY_FADE: LodFadeState = { out: EMPTY_SET, in: EMPTY_SET }
const FADE_STYLE_KEYS = ['opacity', 'pointerEvents', 'transition', 'animation'] as const

/** 诊断面板只读取标题，读不到就退回 id；纯函数层不写任何节点字段。 */
function readNodeLabel(node: LodNodeLike | undefined): string {
  const data = node?.data as { label?: unknown } | undefined
  return typeof data?.label === 'string' && data.label.trim().length > 0
    ? data.label
    : node?.id ?? ''
}

/** 把渲染层 / 磁盘层的边统一投影成 hierarchy 需要的形状。 */
function projectEdges(edges: readonly LodEdgeLike[]) {
  return edges.map((edge) => toHierarchyEdge({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    relation: readEdgeRelationId(edge.relation ?? edge.data?.relation),
  }))
}

/**
 * 只依赖「节点 id 集合 + 从属边集合」的签名。拖动节点时 nodes 数组每帧都变，
 * 但 id 与关系不变 → 签名不变 → hierarchy 可以复用，不必每帧重建整棵树。
 */
export function buildLodHierarchyKey(
  nodes: readonly LodNodeLike[],
  edges: readonly LodEdgeLike[],
): string {
  const nodePart = nodes.map((node) => node.id).join('|')
  const subordinatePart = projectEdges(edges)
    .filter((edge) => isSubordinate(edge.relation))
    .map((edge) => `${edge.id}>${edge.source}>${edge.target}`)
    .join('|')
  return `${nodePart}#${subordinatePart}`
}

/**
 * 【P1.75 折叠子树计数，2026-11-09】远景只留主干时，主干卡片要能看出「底下收了多少」。
 *
 * 归属规则：每个隐藏节点只记到**离它最近的可见祖先**名下，于是
 *   - 同一批隐藏节点不会被祖先链上的每个节点重复计数（合计 ≤ 隐藏总数）；
 *   - 中间节点仍可见时，计数落在中间节点，而不是一路上溯到树根；
 *   - 游离节点没有从属祖先，不归属到任何卡片（由控件单列为「游离已收起」）。
 * 上溯结果整链缓存，万级节点 × 100 层深度也不会退化成 O(n·depth) 重复遍历；
 * 另带 seen / 深度上限，脏数据成环也不会死循环。
 *
 * 计数只是**派生渲染信息**：不写节点 data、不进 7 处字段白名单、不落盘。
 */
export function computeCollapsedCounts(
  hierarchy: GraphHierarchy,
  visibleNodeIds: ReadonlySet<string>,
  hiddenNodeIds: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>()
  if (hiddenNodeIds.size === 0) return counts
  const nearest = new Map<string, string | null>()
  const nearestVisibleAncestor = (startId: string): string | null => {
    const chain: string[] = []
    const seen = new Set<string>()
    let cursor: string | undefined = startId
    let result: string | null = null
    while (cursor && !seen.has(cursor) && chain.length <= MAX_HIERARCHY_DEPTH) {
      const cached = nearest.get(cursor)
      if (cached !== undefined) { result = cached; break }
      if (visibleNodeIds.has(cursor)) { result = cursor; break }
      seen.add(cursor)
      chain.push(cursor)
      const parent: string | undefined = hierarchy.parentEdge.get(cursor)?.source
      if (!parent) break
      cursor = parent
    }
    for (const id of chain) nearest.set(id, result)
    if (cursor && !nearest.has(cursor)) nearest.set(cursor, result)
    return result
  }
  for (const id of hiddenNodeIds) {
    const holder = nearestVisibleAncestor(id)
    if (!holder || holder === id || !visibleNodeIds.has(holder)) continue
    counts.set(holder, (counts.get(holder) ?? 0) + 1)
  }
  return counts
}

export function computeLodVisibility(input: LodVisibilityInput): LodVisibility {
  const { nodes, edges } = input
  const rawZoom = Number.isFinite(input.zoom) ? (input.zoom as number) : ZOOM_REFERENCE
  const ratio = toDisplayRatio(clampRawZoom(rawZoom))
  // 【紧凑行程 2026-11-11】20% 以下可见集合严格冻结在渐隐终点：
  // 判定一律用 lodRatio，displayPercent 仍回吐真实读数（面板显示 5% 而不是 20%）。
  const lodRatio = Math.max(LOD_FLOOR_RATIO, ratio)
  const stage = resolveLodStage(rawZoom)
  const mode: LodMode = input.mode ?? 'auto'
  const nodeIds = nodes.map((node) => node.id)
  const projected = projectEdges(edges)
  const subordinateEdges = projected.filter((edge) => isSubordinate(edge.relation))
  const { hierarchy } = buildHierarchy(nodeIds, subordinateEdges)
  const treeNodeCount = nodeIds.length - hierarchy.free.length
  const treeCoverage = nodeIds.length > 0 ? treeNodeCount / nodeIds.length : 0
  const rootIds = new Set(hierarchy.roots)
  const freeIds = new Set(hierarchy.free)

  // 诊断统计与 reveal 阈值共用**同一份** hierarchy，绝不另写一套深度推断。
  // 阈值用全树最大深度（不随缩放变化），避免「某些节点藏了之后别的节点阈值也跟着漂」。
  let treeMaxDepth = 1
  const depthTotals = new Map<number, number>()
  for (const id of hierarchy.nodes) {
    if (freeIds.has(id)) continue
    const depth = hierarchy.depth.get(id) ?? 1
    treeMaxDepth = Math.max(treeMaxDepth, depth)
    depthTotals.set(depth, (depthTotals.get(depth) ?? 0) + 1)
  }

  // 游离节点按「关联度」排名：度越小越边缘，越早隐藏；同名 id 兜底保证顺序稳定。
  const degree = new Map<string, number>()
  for (const edge of projected) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  const rankedFree = [...hierarchy.free].sort((a, b) => {
    const diff = (degree.get(a) ?? 0) - (degree.get(b) ?? 0)
    return diff !== 0 ? diff : (a < b ? -1 : a > b ? 1 : 0)
  })
  // 树节点按「深度降序」排：父节点一定排在子节点之后 → 父的 reveal 更低 →
  // 不会出现「子节点还看得见、父节点却先没了」的断链。同级再按关联度升序、id 兜底。
  const rankedTree = hierarchy.nodes
    .filter((id) => !freeIds.has(id) && !rootIds.has(id))
    .sort((a, b) => {
      const depthDiff = (hierarchy.depth.get(b) ?? 1) - (hierarchy.depth.get(a) ?? 1)
      if (depthDiff !== 0) return depthDiff
      const degreeDiff = (degree.get(a) ?? 0) - (degree.get(b) ?? 0)
      return degreeDiff !== 0 ? degreeDiff : (a < b ? -1 : a > b ? 1 : 0)
    })
  // 退场序列只有一份：游离先走，然后由深到浅收起树；树根不在序列里（恒定保留）。
  // 阈值按序列下标均分 100%→20% 行程，而不是按深度级数 / 游离排名分档位。
  // P1：再经几何压力曲线求逆，把「均匀行程」重参数化成真实布局的压力行程。
  // 曲线只改节奏、不改顺序，因此父子先后、树根恒定、单调性三条铁律全部保留。
  const exitOrder = [...rankedFree, ...rankedTree]
  // 【自定义永久显示层数】depth <= preservedDepth 的**全部**树节点都是保底骨架，
  // 不再像旧实现那样只从退场序列末尾挑一个 depth 2 节点。
  // 树根本来就不在 exitOrder 里（恒定保留），这里只补非根树节点；
  // 游离节点没有从属深度，一律不进保底集合（depth 初始值 1 不代表它在树上）。
  // 只依赖层级，不读坐标：拖动节点时骨架不会重选、不会闪现。
  const preservedDepth = normalizePreservedDepth(input.preservedDepth)
  const skeletonIds = new Set<string>()
  for (const id of hierarchy.nodes) {
    if (freeIds.has(id) || rootIds.has(id)) continue
    if ((hierarchy.depth.get(id) ?? 1) <= preservedDepth) skeletonIds.add(id)
  }
  const pressure = buildLodPressureCurve(
    nodes.map((node) => node.position),
    {
      fullRatio: LOD_FULL_RATIO,
      floorRatio: LOD_FLOOR_RATIO,
      // P1.5：远景字形放大后的屏幕尺寸也计入重叠需求，压力升高自动把渐隐提前，
      // 避免「节点更大更挤」与「主干更清晰」互相打架。
      glyphScaleForRatio,
    },
  )
  const revealOf = new Map<string, number>()
  exitOrder.forEach((id, rank) => {
    // 骨架不分配阈值（恒定显示）；它仍占着 rank，其余节点的阈值逐值不变。
    if (skeletonIds.has(id)) return
    revealOf.set(id, pressure.ratioFor(revealRatioForRank(rank, exitOrder.length)))
  })

  let active = true
  let reason: LodReason = 'active'
  if (mode === 'off') {
    active = false
    reason = 'off'
  } else if (subordinateEdges.length === 0) {
    active = false
    reason = 'no-tree'
  } else if (
    treeCoverage < LOD_TREE_COVERAGE_THRESHOLD
    && mode !== 'force'
    && !input.skipCoverageProtection
  ) {
    active = false
    reason = 'low-coverage'
  } else if (mode === 'force') {
    reason = 'forced'
  }

  // 强制显示集合：pin（持久）+ 临时 reveal + 当前选中节点（编辑时不能突然消失）。
  // store 的 selectedNodeId 与 nodes[].selected 都算选中，避免两个来源时序不一致。
  const selectedNodeIds = nodes.filter((node) => node.selected).map((node) => node.id)
  const externalSelectedId = input.selectedNodeId && hierarchy.depth.has(input.selectedNodeId)
    ? input.selectedNodeId
    : null
  const forced = new Set<string>(input.pinned ?? [])
  for (const id of input.revealed ?? []) forced.add(id)
  for (const id of selectedNodeIds) forced.add(id)
  if (externalSelectedId) forced.add(externalSelectedId)

  let visibleNodeIds: Set<string>
  if (!active || lodRatio >= LOD_FULL_RATIO) {
    // LOD 关闭、或用户视角 ≥100%：全部显示（含游离）。
    visibleNodeIds = new Set(nodeIds)
  } else {
    const previous = input.previousVisibleNodeIds
    const band = previous ? LOD_HYSTERESIS : 0
    const isVisibleAt = (id: string): boolean => {
      if (forced.has(id) || skeletonIds.has(id)) return true
      // 渐隐终点（20%）及其以下的紧凑区只剩树根 + 永久层数内的全部节点：
      // 滞回不能把骨架拖到收起区间之外，紧凑区也不能把任何节点放回来。
      if (lodRatio <= LOD_FLOOR_RATIO) return false
      const reveal = revealOf.get(id) ?? LOD_FULL_RATIO
      const wasVisible = previous?.has(id) ?? false
      // 已显示的晚一点藏、已隐藏的晚一点显，避免临界点滚轮抖动导致闪烁。
      return lodRatio >= (wasVisible ? reveal - band : reveal + band)
    }

    // computeLodVisibleNodes 提供树根保护（与 maxDepth 独立）+ 强制集合；
    // 每个节点只按自己在退场序列里的阈值进出，不按整层档位一次性砍掉。
    // 树根与 depth <= preservedDepth 的全部节点恒定显示，最远镜头因此至少保留 N 层。
    const treeBase = computeLodVisibleNodes(hierarchy, MAX_HIERARCHY_DEPTH, forced)
    visibleNodeIds = new Set<string>()
    for (const id of treeBase) {
      if (rootIds.has(id) || skeletonIds.has(id) || forced.has(id)) { visibleNodeIds.add(id); continue }
      if (isVisibleAt(id)) visibleNodeIds.add(id)
    }
    for (const id of rankedFree) {
      if (isVisibleAt(id)) visibleNodeIds.add(id)
    }
  }

  // 【P1.9 碰撞硬约束，2026-11-09】用户反馈「缩放后节点之间会重合」。
  // P0 把视觉壳钉在屏幕尺寸上（远景还放大 1.3 倍），坐标却仍随 viewport 线性收缩，
  // 于是「主干紧凑」到一定程度必然压在一起；P1 的几何压力只用间距**调节奏**，
  // 没有保证结果。这里把用户第 3 轮描述的「紧凑到一定程度 → 相对边缘节点渐隐」
  // 补成硬约束：一行坐标都不改（hidden 只是 React Flow 渲染属性），
  // 因此手摆位置落盘 / viewport 返回视野 / 7 处字段白名单通通不受影响。
  let collision: LodCollisionResult = emptyCollisionResult()
  // 紧凑区（ratio < 20%）可见集合必须冻结：碰撞抽稀会在补偿冻结后算出巨大的盒子，
  // 哪怕受保护节点不会被裁，诊断读数也会被污染。渐隐区照常执行硬约束。
  if (active && ratio >= LOD_FLOOR_RATIO && ratio < LOD_FULL_RATIO && visibleNodeIds.size >= 2) {
    // 永久层数内的节点与树根同属「恒定保留」：即使贴着树根也不会被碰撞裁掉，
    // 用户指定的 N 层才是硬保证；受保护节点彼此若重叠只计入 protectedOverlapPairs 诊断。
    // 这是「层数优先于零重叠」的明确取舍——零重叠只在非受保护节点之间保证。
    const protectedIds = new Set<string>([...rootIds, ...skeletonIds, ...forced])
    collision = resolveLodCollisions(nodes, visibleNodeIds, {
      ratio,
      // 唯一源：视觉壳 transform 的 scale() 值，碰撞盒与画面逐像素同源。
      // 紧凑区已在上面的守卫里跳过，这里 ratio 必然 >= LOD_FLOOR_RATIO。
      compensation: glyphCompensationForZoom(rawZoom),
      protectedIds,
      // 树根 / 永久层数内节点 / pin / 选中 / 临时 reveal 最优先，其余按退场序列逆序。
      priority: [...forced, ...rootIds, ...skeletonIds, ...exitOrder.slice().reverse()],
      children: hierarchy.children,
      maxDepth: MAX_HIERARCHY_DEPTH,
    })
    for (const id of collision.hiddenIds) visibleNodeIds.delete(id)
  }

  const hiddenNodeIds = new Set(nodeIds.filter((id) => !visibleNodeIds.has(id)))
  const collapsedCounts = computeCollapsedCounts(hierarchy, visibleNodeIds, hiddenNodeIds)
  let collapsedTotal = 0
  for (const value of collapsedCounts.values()) collapsedTotal += value
  const collapsedFreeCount = hiddenNodeIds.size - collapsedTotal
  const hiddenEdgeIds = new Set<string>()
  if (active) {
    for (const edge of edges) {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
        hiddenEdgeIds.add(edge.id)
      }
    }
  }

  let maxDepth = 1
  let visibleFreeCount = 0
  const depthVisible = new Map<number, number>()
  for (const id of visibleNodeIds) {
    if (freeIds.has(id)) { visibleFreeCount += 1; continue }
    const depth = hierarchy.depth.get(id) ?? 1
    maxDepth = Math.max(maxDepth, depth)
    depthVisible.set(depth, (depthVisible.get(depth) ?? 0) + 1)
  }
  const depthLevels: LodDepthLevel[] = [...depthTotals.keys()]
    .sort((a, b) => a - b)
    .map((depth) => ({
      depth,
      total: depthTotals.get(depth) ?? 0,
      visible: depthVisible.get(depth) ?? 0,
    }))

  // 选中节点的深度 / 类型 / 隐藏阈值一律取自同一份 hierarchy，
  // 让左上角面板能直接核对「自动推断的深度」以及「它为什么被藏」。
  const selectedId = externalSelectedId ?? selectedNodeIds[0]
  let selectedNode: LodSelectedNodeInfo | null = null
  if (selectedId) {
    const isFree = freeIds.has(selectedId)
    const isRoot = rootIds.has(selectedId)
    const depth = hierarchy.depth.get(selectedId) ?? 1
    selectedNode = {
      id: selectedId,
      label: readNodeLabel(nodes.find((node) => node.id === selectedId)),
      depth,
      kind: isRoot ? 'root' : isFree ? 'free' : 'tree',
      visible: visibleNodeIds.has(selectedId),
      // 与裁剪完全同源：直接取退场序列里的阈值，面板读数不会和实际隐藏时机对不上。
      // 树根与永久层数内节点恒定显示，阈值记 null（面板显示「始终显示」）。
      revealRatio: isRoot || skeletonIds.has(selectedId) ? null : (revealOf.get(selectedId) ?? LOD_FULL_RATIO),
      forced: forced.has(selectedId),
    }
  }

  return {
    active,
    reason,
    tier: stage,
    maxDepth,
    showFree: visibleFreeCount > 0,
    label: hiddenNodeIds.size === 0 ? describeLodStage(0) : describeLodStage(stage),
    displayPercent: toDisplayPercent(rawZoom),
    treeCoverage,
    subordinateEdgeCount: subordinateEdges.length,
    totalNodeCount: nodeIds.length,
    selectedNodeIds,
    treeMaxDepth,
    rootCount: rootIds.size,
    freeCount: freeIds.size,
    pressureActive: pressure.active,
    pressureGlyphAware: pressure.glyphAware,
    pressureSampleCount: pressure.sampleCount,
    collisionActive: collision.active,
    collisionHiddenCount: collision.hiddenIds.size,
    collisionGuard: collision.guard,
    collisionBoxScale: collision.boxScale,
    collisionProtectedOverlapPairs: collision.protectedOverlapPairs,
    collapsedCounts,
    collapsedTotal,
    collapsedFreeCount,
    depthLevels,
    visibleDepthLevelCount: depthVisible.size,
    preservedDepth,
    selectedNode,
    visibleNodeIds,
    hiddenNodeIds,
    hiddenEdgeIds,
  }
}

function stripFadeStyle(style: unknown): Record<string, unknown> {
  const clean = { ...((style ?? {}) as Record<string, unknown>) }
  for (const key of FADE_STYLE_KEYS) delete clean[key]
  return clean
}

function sameStyle(a: unknown, b: Record<string, unknown> | undefined): boolean {
  const av = (a ?? {}) as Record<string, unknown>
  const bv = b ?? {}
  const keys = new Set([...Object.keys(av), ...Object.keys(bv)])
  for (const key of keys) if (av[key] !== bv[key]) return false
  return true
}

/**
 * 进/出都用 CSS keyframes 而不是 transition：新挂载的节点没有「旧 opacity」
 * 可与新值做过渡，transition 在这种场景下会被浏览器直接跳过；animation 一定
 * 会从 from 帧播到 to 帧。`both` 让淡出的对象在卸载前保持在 opacity 0，
 * 配合 useSemanticLod 的定时器做「先渐隐、后真 hidden；先挂载、后渐显」。
 */
function desiredFadeStyle(
  base: Record<string, unknown>,
  fadingOut: boolean,
  fadingIn: boolean,
): Record<string, unknown> | undefined {
  const easing = 'cubic-bezier(0.4, 0, 0.2, 1)'
  if (fadingOut) {
    return {
      ...base,
      opacity: 0,
      pointerEvents: 'none',
      animation: `tm-lod-exit ${LOD_FADE_MS}ms ${easing} both`,
    }
  }
  if (fadingIn) {
    return { ...base, animation: `tm-lod-enter ${LOD_FADE_MS}ms ${easing} both` }
  }
  return Object.keys(base).length > 0 ? base : undefined
}

/**
 * 只给真正改变 hidden / 淡入淡出样式的节点创建新对象，其余复用原引用。
 * 拖动时 nodes 每帧更新但状态不变 → 直接返回原数组，零拷贝。
 * fade.out 中的节点先保持挂载（hidden=false）并淡出，到时由调用方清除集合再真正隐藏。
 */
export function applyLodNodeHidden<T extends LodNodeLike>(
  nodes: T[],
  visibility: LodVisibility,
  fade: LodFadeState = EMPTY_FADE,
): T[] {
  let changed = false
  const next = nodes.map((node) => {
    const shouldHide = visibility.hiddenNodeIds.has(node.id)
    const fadingOut = shouldHide && fade.out.has(node.id)
    const fadingIn = !shouldHide && fade.in.has(node.id)
    const desiredHidden = shouldHide && !fadingOut
    const style = desiredFadeStyle(stripFadeStyle(node.style), fadingOut, fadingIn)
    if (desiredHidden === !!node.hidden && sameStyle(node.style, style)) return node
    changed = true
    return { ...node, hidden: desiredHidden, style } as T
  })
  return changed ? next : nodes
}

/** 一端隐藏即隐藏该边；其余复用原引用。边与节点共用同一套淡入淡出节奏。 */
export function applyLodEdgeHidden<T extends LodEdgeLike>(
  edges: T[],
  visibility: LodVisibility,
  fade: LodFadeState = EMPTY_FADE,
): T[] {
  let changed = false
  const next = edges.map((edge) => {
    const shouldHide = visibility.hiddenEdgeIds.has(edge.id)
    const fadingOut = shouldHide && fade.out.has(edge.id)
    const fadingIn = !shouldHide && fade.in.has(edge.id)
    const desiredHidden = shouldHide && !fadingOut
    const style = desiredFadeStyle(stripFadeStyle(edge.style), fadingOut, fadingIn)
    if (desiredHidden === !!edge.hidden && sameStyle(edge.style, style)) return edge
    changed = true
    return { ...edge, hidden: desiredHidden, style } as T
  })
  return changed ? next : edges
}

export function describeLodReason(reason: LodReason): string {
  switch (reason) {
    case 'active': return '已启用'
    case 'forced': return '强制启用'
    case 'off': return '已关闭'
    case 'no-tree': return '本房间没有从属关系，已自动关闭'
    case 'low-coverage': return '强关系覆盖不足，已自动关闭'
    default: return '已关闭'
  }
}
