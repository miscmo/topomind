/**
 * 画布缩放比例尺唯一规则源（纯函数，无 DOM / 无 store / 无 IPC，可被 esbuild 打包真跑）。
 *
 * 【用户决策 2026-11-08】「50% 左右才算正常能阅读的水平，应该叫 100%」→ 旧基准 raw 0.5。
 * 【用户决策 2026-11-09】「现在 130% 左右应该为正常的 100% 的效果；放大支持到 200%，
 *   缩小到 30% 左右」→ 旧基准下的 130% 是 raw 0.65，把它重定基为新的 100%。
 * 【用户决策 2026-11-10】「再放大没有意义了，节点已经全部展示」→ 上限收到 100%。
 *   于是显示比 = raw / 0.65，100% 同时是「常规阅读比例」「LOD 全显示端点」
 *   「语义缩放恒等点」「最大镜头」，四者重合，放大不再有空段。
 * 【用户决策 2026-11-11】「最小缩小比例可以到 5%，缩到 20% 后最少保留两层深度，
 *   再继续缩小就只是让图谱更紧凑」→ 把镜头拆成两段，可用区间 5%~100%：
 *     - 100%~20%：**渐隐行程**，按语义树逐个收起节点，20% 处只剩永久显示层数；
 *     - 20%~5% ：**紧凑行程**，可见集合冻结，只让节点间距随镜头等比收紧，
 *       不再隐藏/显示任何节点。
 *   紧凑区用 d3-zoom 天然的等比缩放（zoom *= 2^(-deltaY·0.002)）：
 *   越接近 5%，同样的滚轮格数带来的**绝对**变化越小，正是「越紧凑、幅度越小」。
 * 【用户决策 2026-11-11 晚】紧凑区「文字仍保持」：屏幕字号冻结在 20% 的可读大小
 *   （约 9.3px），不跟镜头一起缩到 2.4px。代价是节点视觉壳不缩小而间距继续缩小，
 *   骨架之间会更靠近甚至叠住；可见集合已冻结、碰撞抽稀在紧凑区跳过，
 *   因此不会因此触发隐藏/闪烁。这是用户明确选择的「可读性优先于零重叠」。
 *
 * 【密度自适应，2026-11-11】用户问「节点多、树深时，一格滚轮就消失一片怎么办」。
 * 渐隐行程固定 80 个百分点、要收起 N 个节点，平均 1% 就要收 N/80 个：
 *   - 按节点数分位（原实现）：格数固定，每格隐藏数 ∝ N → 大图跳变；
 *   - 按绝对数限速：每格隐藏数固定，格数 ∝ N → 大图要滚几百格，同样难用。
 * 折中：让「一次操作改变的显示比」∝ 1/√N（并随树深度温和放慢），
 * 于是每格隐藏数 ∝ √N、走完全程的格数 ∝ √N，两头都不爆炸。灵敏度只改
 * **步进量**，不改 zoom→显示比换算、不改 LOD 阈值公式，所有既有断言逐值不变。
 *
 * 落盘值仍然是 raw zoom（`_graph.json` 的 zoom / pan），本模块只做
 * 「显示换算 + 边界钳制 + 旧默认值重定基」，**不改任何磁盘字段语义**，
 * 也不碰节点 / 边 7 处字段白名单。
 */
/** 用户视角 100% 对应的 raw zoom（= 旧基准下的 130%）。 */
export const ZOOM_REFERENCE = 0.65
/** 用户视角的最小 / 最大百分比；raw 边界由它们派生，避免两处各写一份。 */
export const MIN_DISPLAY_PERCENT = 5
/** 100% 已是全图可见 + 细节完整的终点，继续放大不产生任何新信息。 */
export const MAX_DISPLAY_PERCENT = 100
/**
 * 「渐隐行程」的终点 / 「紧凑行程」的起点（显示百分比，先暂定 20%）。
 * 唯一事实源：lod.ts 的 LOD_FLOOR_RATIO、lodPressure 的默认 bounds、
 * 字形补偿冻结阈值都由它派生，避免三处各写一份 0.2。
 */
export const COMPACT_START_PERCENT = 20
export const COMPACT_START_RATIO = COMPACT_START_PERCENT / 100
/** 最小 5%：紧凑行程的终点，留给「整张图缩成概览」的远景。 */
export const MIN_RAW_ZOOM = (ZOOM_REFERENCE * MIN_DISPLAY_PERCENT) / 100
/** 紧凑区按钮每步把「距 5% 下限的距离」乘这个因子（等比衰减 → 边际递减）。 */
export const COMPACT_STEP_DECAY = 0.72
/** 紧凑区按钮保底步长（百分点）：保证能真正走到 5% 端点，不会无限逼近。 */
export const COMPACT_STEP_MIN_PERCENT = 0.5
/** 最大 100%：与 ZOOM_REFERENCE 恒等，写在这里让上限只有一个来源。 */
export const MAX_RAW_ZOOM = (ZOOM_REFERENCE * MAX_DISPLAY_PERCENT) / 100
/** 远古版本所有房间的默认 zoom=1。 */
export const LEGACY_DEFAULT_RAW_ZOOM = 1
/** 2026-11-08 基准下的 100%（raw 0.5）：老房间的默认镜头基本都是它。 */
export const LEGACY_REFERENCE_RAW_ZOOM = 0.5
/** 缩放按钮每次 ±10 个百分点。 */
export const ZOOM_STEP_PERCENT = 10
/** LOD 重算粒度：显示比每 2% 一个台阶，滚轮过程中不必每帧重算可见性。 */
export const LOD_ZOOM_QUANTUM = 0.02
/**
 * 鼠标滚轮单格 deltaY 上限。React Flow 用 d3-zoom 的 `2^(-deltaY*0.002)`，
 * 一格 220 会直接跳掉约 26% 缩放，节点必然成批出现/消失；钳到 80 后一格约 10%，
 * 与缩放按钮 ±10% 对齐。触控板本身是细粒度事件（deltaY 很小），不受影响。
 */
export const MAX_WHEEL_DELTA = 80
/** 滚轮剩余增量最多积压两格，快速连滚不会让镜头追赶过头或一次跳太多。 */
export const MAX_PENDING_WHEEL_DELTA = MAX_WHEEL_DELTA * 2
/** 按钮 / 复位的镜头过渡时长（ms），与 LOD 淡入淡出保持同一节奏。 */
export const ZOOM_TRANSITION_MS = 240
/**
 * 滚轮缓动时间常数（ms）：每个动画帧只派发「剩余增量的一小部分」给 d3-zoom。
 * `2^(-deltaY*0.002)` 是可乘的，所以拆分后总缩放量与原来一格完全相同，
 * 但 transform 逐帧连续变化；且内部 viewport 与画面始终一致（不像 CSS
 * transition 那样让画面落后于命中坐标）。连续滚轮事件只需往剩余量里追加。
 */
export const WHEEL_SMOOTH_TAU_MS = 62

export function clampWheelDelta(deltaY: number): number {
  const value = Number.isFinite(deltaY) ? deltaY : 0
  return Math.min(MAX_WHEEL_DELTA, Math.max(-MAX_WHEEL_DELTA, value))
}

/**
 * 单个动画帧该派发多少 deltaY（指数衰减，天然支持连续滚轮事件追加）。
 * 返回值的符号与 remaining 一致，且绝对值严格小于 remaining，不会过冲。
 */
export function wheelDeltaStep(remaining: number, elapsedMs: number): number {
  const value = Number.isFinite(remaining) ? remaining : 0
  if (value === 0) return 0
  const dt = Math.min(48, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0))
  if (dt === 0) return 0
  return value * (1 - Math.exp(-dt / WHEEL_SMOOTH_TAU_MS))
}

export function clampPendingWheelDelta(deltaY: number): number {
  const value = Number.isFinite(deltaY) ? deltaY : 0
  return Math.min(MAX_PENDING_WHEEL_DELTA, Math.max(-MAX_PENDING_WHEEL_DELTA, value))
}

export interface ViewportLike {
  x: number
  y: number
  zoom: number
}

export function clampRawZoom(zoom: number): number {
  const value = Number.isFinite(zoom) ? zoom : ZOOM_REFERENCE
  return Math.min(MAX_RAW_ZOOM, Math.max(MIN_RAW_ZOOM, value))
}

/**
 * 两个历史「默认镜头」都代表当时语义下的 100%，新基准下必须回到新的 100%：
 *   - raw 1：远古版本的默认；
 *   - raw 0.5：2026-11-08 基准的默认（老房间几乎都存成这个值）。
 * 不这么做，老房间一打开就落在 77% / 154%，直接掉进 LOD 收起区间。
 * 其它数值只做边界钳制，不擅自改写用户保存过的镜头。
 */
export function rebaseViewportZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return ZOOM_REFERENCE
  if (Math.abs(zoom - LEGACY_DEFAULT_RAW_ZOOM) < 0.001) return ZOOM_REFERENCE
  if (Math.abs(zoom - LEGACY_REFERENCE_RAW_ZOOM) < 0.001) return ZOOM_REFERENCE
  return clampRawZoom(zoom)
}

export function rebaseViewport<T extends ViewportLike>(viewport: T): T {
  return { ...viewport, zoom: rebaseViewportZoom(viewport.zoom) } as T
}

/** raw zoom → 显示比（1 = 100%）。 */
export function toDisplayRatio(rawZoom: number): number {
  return (Number.isFinite(rawZoom) ? rawZoom : ZOOM_REFERENCE) / ZOOM_REFERENCE
}

export function toDisplayPercent(rawZoom: number): number {
  return Math.round(toDisplayRatio(rawZoom) * 100)
}

export function formatZoomPercent(rawZoom: number): string {
  return `${toDisplayPercent(rawZoom)}%`
}

/**
 * 是否已到放大 / 缩小端点。按「显示百分比」而非 raw 浮点相等判断：
 * 按钮过渡与滚轮缓动结束后 raw zoom 常带 1e-3 级残差，用 1e-6 容差会出现
 * 「读数已是 100%，放大按钮却没禁用」。与用户看到的读数同源，也和
 * `clampRawZoom` 的边界语义一致（越界值同样算到达端点）。
 */
export function isAtMaxZoom(rawZoom: number): boolean {
  return toDisplayPercent(rawZoom) >= MAX_DISPLAY_PERCENT
}

export function isAtMinZoom(rawZoom: number): boolean {
  return toDisplayPercent(rawZoom) <= MIN_DISPLAY_PERCENT
}

/** 显示百分比 → raw zoom（自动钳到允许范围）。 */
export function fromDisplayPercent(percent: number): number {
  const value = Number.isFinite(percent) ? percent : 100
  return clampRawZoom((value / 100) * ZOOM_REFERENCE)
}

export function stepDisplayZoom(rawZoom: number, deltaPercent: number): number {
  return fromDisplayPercent(toDisplayPercent(rawZoom) + deltaPercent)
}

/* ---------------------------------------------------------------------------
 * 密度自适应 + 紧凑行程步进
 * ------------------------------------------------------------------------- */

/** 小于这个节点规模时灵敏度恒为 1：所有既有回归 / 小房间行为逐值不变。 */
export const LOD_DENSITY_REFERENCE_NODES = 60
/** 树每多一层额外放慢的比例（温和，只在超过参考规模时生效）。 */
export const LOD_DENSITY_DEPTH_RELAX = 0.06
/** 灵敏度下限：万级大图也不能慢到「滚不动」。 */
export const MIN_ZOOM_STEP_SENSITIVITY = 0.12

/**
 * 「一次操作改变的显示比」的倍率，只取决于静态的图规模 / 树深度。
 * n <= 60 → 1；n 越大按 1/√n 衰减，深度越大再温和放慢。
 * 于是每格隐藏数 ∝ √N、走完渐隐行程的格数 ∝ √N（详见文件头权衡说明）。
 */
export function zoomStepSensitivityForGraph(nodeCount: number, treeMaxDepth = 1): number {
  const n = Number.isFinite(nodeCount) ? Math.max(0, nodeCount) : 0
  if (n <= LOD_DENSITY_REFERENCE_NODES) return 1
  const byCount = Math.sqrt(LOD_DENSITY_REFERENCE_NODES / n)
  const depth = Number.isFinite(treeMaxDepth) ? Math.max(1, treeMaxDepth) : 1
  const byDepth = 1 / (1 + LOD_DENSITY_DEPTH_RELAX * Math.max(0, depth - 2))
  return Math.min(1, Math.max(MIN_ZOOM_STEP_SENSITIVITY, byCount * byDepth))
}

/**
 * 是否处在「只紧凑、不再隐藏节点」的镜头区间（严格小于 20%）：
 * 20% 本身是渐隐终点，仍属于渐隐行程的最后一点。
 */
export function isCompactZoom(rawZoom: number): boolean {
  return toDisplayRatio(clampRawZoom(rawZoom)) < COMPACT_START_RATIO
}

/** 滚轮灵敏度：紧凑区不隐藏节点，d3 的等比缩放本身已足够慢，无需再限速。 */
export function wheelSensitivityForZoom(rawZoom: number, nodeCount: number, treeMaxDepth = 1): number {
  return isCompactZoom(rawZoom) ? 1 : zoomStepSensitivityForGraph(nodeCount, treeMaxDepth)
}

/**
 * 缩放按钮的「下一步显示比」（滚轮由 d3-zoom 的等比因子直接提供，不走这里）：
 *   - 渐隐区 >20%：线性 ±10% × 密度灵敏度，缩小到 20% 处稳定停靠一次；
 *   - 紧凑区 <=20%：按「距 5% 下限的距离」等比衰减，越紧凑绝对步长越小；
 *     放大是它的逆运算，配保底步长保证能真正到 5% 端点并可逆。
 */
export function stepGraphZoom(rawZoom: number, deltaPercent: number, sensitivity = 1): number {
  const p = toDisplayPercent(rawZoom)
  const s = Number.isFinite(sensitivity) ? Math.min(1, Math.max(0.05, sensitivity)) : 1
  if (p > COMPACT_START_PERCENT) {
    if (deltaPercent < 0) {
      const next = p - Math.abs(deltaPercent) * s
      return fromDisplayPercent(next < COMPACT_START_PERCENT ? COMPACT_START_PERCENT : next)
    }
    return stepDisplayZoom(rawZoom, deltaPercent * s)
  }
  const distance = p - MIN_DISPLAY_PERCENT
  if (deltaPercent < 0) {
    const next = Math.max(MIN_DISPLAY_PERCENT,
      MIN_DISPLAY_PERCENT + distance * COMPACT_STEP_DECAY - COMPACT_STEP_MIN_PERCENT)
    return fromDisplayPercent(next)
  }
  const next = MIN_DISPLAY_PERCENT + (distance + COMPACT_STEP_MIN_PERCENT) / COMPACT_STEP_DECAY
  // 越过渐隐终点就回到线性步进：否则「20% 再点放大」会被钳在 20% 出不去。
  if (next > COMPACT_START_PERCENT) {
    return fromDisplayPercent(Math.min(100, COMPACT_START_PERCENT + Math.abs(deltaPercent) * s))
  }
  return fromDisplayPercent(next)
}

/**
 * 把连续 zoom 量化成 2% 显示比台阶，LOD 只在跨台阶时重算。
 * 紧凑区（<=20%）一律吸附到渐隐终点：可见集合本来就冻结，没必要每 2% 重建整树。
 * 面板读数取自连续 zoomLevel，不依赖这份量化值，所以不会显示成 20%。
 */
export function quantizeLodZoom(rawZoom: number): number {
  const ratio = toDisplayRatio(clampRawZoom(rawZoom))
  const lodRatio = Math.max(COMPACT_START_RATIO, ratio)
  const quantized = Math.round(lodRatio / LOD_ZOOM_QUANTUM) * LOD_ZOOM_QUANTUM
  return clampRawZoom(quantized * ZOOM_REFERENCE)
}

/** 粗档位只给 UI 标签与「跨明显档位清空临时显示」用，**不参与裁剪**。 */
export const LOD_STAGE_MIN_RATIO: readonly number[] = [1, 0.7, 0.4, 0]
export const LOD_STAGE_LABELS: readonly string[] = ['完整图谱', '渐进收起', '主干轮廓', '仅骨架']

export function resolveLodStage(rawZoom: number): number {
  const ratio = toDisplayRatio(rawZoom)
  for (let stage = 0; stage < LOD_STAGE_MIN_RATIO.length; stage += 1) {
    if (ratio >= LOD_STAGE_MIN_RATIO[stage]) return stage
  }
  return LOD_STAGE_LABELS.length - 1
}

export function describeLodStage(stage: number): string {
  return LOD_STAGE_LABELS[stage] ?? LOD_STAGE_LABELS[LOD_STAGE_LABELS.length - 1]
}

/* ---------------------------------------------------------------------------
 * 语义缩放（semantic zoom）：几何缩放与「字形缩放」解耦
 *
 * 【用户决策 2026-11-09】「缩到最后节点和文字小得看不清，缩放就没意义了；
 *   节点本身和内容应该有上下限，超过阈值的缩放只用来控制布局」。
 *
 * React Flow 的 `.react-flow__viewport` 是一个整体 `scale(zoom)`：节点 DOM 的
 * 宽高、字号、内边距都是「世界单位」，屏幕像素 = 世界单位 × zoom。若什么都不做，
 * 20% 时 11px 的标题只剩 2.2px，正是不可读的根因。
 *
 * 因此把缩放拆成两个量：
 *   - layoutScale = rawZoom：只作用于坐标间距（仍由 viewport transform 提供）；
 *   - glyphScale  = 节点「视觉尺寸」的屏幕倍率（相对 100% 的 base）：
 *       100% 恒等 1（上限，不再有近景放大段）；
 *       100%→20%：由 1 平滑涨到 GLYPH_FAR_SCALE(1.3)，
 *              远景标题反而更大 —— yFiles 式「只留关键字段 + 更大字号」，
 *              装饰同时由 detailAlpha 淡出，主干越缩越清晰；
 *       20%→5% ：**屏幕尺寸冻结**在 20% 取值（补偿 = 1.3/ratio 继续增大），
 *              标题字号保持可读，只有节点间距继续收紧（紧凑区不再隐藏任何节点）。
 * 100% 既是上限又是唯一的恒等点（点复位时与旧版逐像素一致）。渲染层乘
 * `compensation = glyphScale / ratio`（世界单位），于是
 *   屏幕尺寸 = base × compensation × ratio = base × glyphScale，与间距解耦。
 *
 * 【字形放大必须让 LOD 知道】节点屏幕尺寸变大 → 相同间距下更容易重叠，
 * 所以 lodPressure 的重叠需求按 `base × glyphScale(ratio) / ratio` 计算，
 * 压力升高会自动把渐隐提前，避免远景变成一堆互相压住的大方块。
 *
 * 【为什么不用 CSS 反缩放改 world size】xyflow 用 getBoundingClientRect 差值 ÷
 * viewport zoom 计算 handleBounds，且 measured 尺寸走 offsetWidth 不吃 transform；
 * 直接改节点尺寸会让边锚点、fitView、框选、落盘尺寸全部失配。本项目用
 * 「外层锚点壳不缩放 / 内层视觉壳缩放」两层结构绕开，见 KnowledgeCard.tsx。
 * ------------------------------------------------------------------------- */

/** 屏幕尺寸基准 = 100% 时的尺寸：远景绝不比常规阅读视图更小，近景也不再放大。 */
export const GLYPH_MIN_SCALE = 1
/**
 * 渐隐终点（20%）视觉尺寸倍率：标题屏幕字号由 100% 的约 7.2px 抬到约 9.3px。
 * 最远镜头用户只想看清主干；装饰已由 detailAlpha 淡出，等价于「只留关键字段 + 更大字号」。
 * 不能太大：屏幕尺寸按同倍率抬高重叠压力，会逼 LOD 过早把主干也藏掉。
 */
export const GLYPH_FAR_SCALE = 1.3
/** 远景放大开始的显示比；100% 是恒等点，以下才逐渐放大。 */
export const GLYPH_FAR_START_RATIO = 1
/** 细节淡出起点（显示比）：45% 以下只剩骨架标题。 */
export const DETAIL_START_RATIO = 0.45
/** 细节完整显现的显示比。 */
export const DETAIL_FULL_RATIO = 1
/** 装饰可交互的 detailAlpha 阈值；低于它装饰淡出且不吃鼠标事件。 */
export const DETAIL_HIT_THRESHOLD = 0.5

/** smoothstep：两端导数为 0，避免细节在阈值处「啪」地跳变。 */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  // 端点严格归零/归一：浮点误差会让 t≈1e-16 算出 3e-32 的残留，
  // 视觉上无害，但下游如果要按「是否等于 0」判定骨架态就会踩坑。
  if (t <= Number.EPSILON) return 0
  if (t >= 1 - Number.EPSILON) return 1
  return t * t * (3 - 2 * t)
}

/**
 * 节点视觉尺寸的屏幕倍率（按显示比，供 LOD 压力曲线直接复用）。
 * 100% 是上限兼唯一恒等点（恒为 1）；只有远景 smoothstep 平滑放大到 GLYPH_FAR_SCALE。
 * 【2026-11-10】放大上限收到 100% 后，原「近景 pow(ratio,0.25) 涨到 1.15」分支
 * 永远不可达，已删除；越界的 ratio（旧房间存的 154% / 200%）先钳到 [0.2,1] 再算，
 * 保证任何镜头都不会让节点虚胖。
 * 【2026-11-11】下界由 30% 改为 COMPACT_START_RATIO(20%)：紧凑区（5%~20%）
 * 恒等取 1.3，配合 glyphCompensationForZoom 的「屏幕倍率冻结」保持文字可读。
 */
export function glyphScaleForRatio(ratio: number): number {
  const safe = Math.min(MAX_DISPLAY_PERCENT / 100, Math.max(COMPACT_START_RATIO,
    Number.isFinite(ratio) ? ratio : 1))
  if (safe >= GLYPH_FAR_START_RATIO) return GLYPH_MIN_SCALE
  const t = smoothstep(COMPACT_START_RATIO, GLYPH_FAR_START_RATIO, safe)
  return GLYPH_MIN_SCALE + (GLYPH_FAR_SCALE - GLYPH_MIN_SCALE) * (1 - t)
}

/** 节点视觉尺寸的屏幕倍率（相对 100% 时的尺寸）。 */
export function glyphScaleForZoom(rawZoom: number): number {
  return glyphScaleForRatio(toDisplayRatio(clampRawZoom(rawZoom)))
}

/**
 * 世界单位补偿系数：内层视觉壳 `transform: scale(compensation)`。
 * 乘上 viewport 的 zoom 后恰好得到 glyphScale，因此屏幕尺寸与间距解耦。
 *
 * 【文字仍保持 2026-11-11】紧凑区（<20%）把**屏幕倍率**冻结在 GLYPH_FAR_SCALE：
 * compensation = GLYPH_FAR_SCALE / ratio，于是标题屏幕字号恒为 100% 的 1.3 倍，
 * 不会随镜头缩到 2.4px。20% 处与渐隐区严格连续（1.3/0.2 = 6.5）。
 * 可见集合在紧凑区冻结、碰撞抽稀跳过，所以视觉壳靠得更近不会触发隐藏。
 */
export function glyphCompensationForZoom(rawZoom: number): number {
  const ratio = toDisplayRatio(clampRawZoom(rawZoom))
  if (ratio < COMPACT_START_RATIO) {
    return GLYPH_FAR_SCALE / Math.max(MIN_DISPLAY_PERCENT / 100, ratio)
  }
  return glyphScaleForRatio(ratio) / ratio
}

/** 装饰细节的连续显现度（0 = 只剩骨架，1 = 完整卡片）。 */
export function detailAlphaForZoom(rawZoom: number): number {
  return smoothstep(DETAIL_START_RATIO, DETAIL_FULL_RATIO, toDisplayRatio(clampRawZoom(rawZoom)))
}

/**
 * 昂贵交互部件（工具栏 / NodeResizer / resize 标签）的挂载档位。
 * 只用来省 DOM，视觉连续性交给 detailAlpha；阈值与 alpha 同源，避免两套标准。
 */
export function detailTierForZoom(rawZoom: number): 0 | 1 | 2 {
  const alpha = detailAlphaForZoom(rawZoom)
  if (alpha <= 0.001) return 0
  if (alpha < 0.6) return 1
  return 2
}

export interface SemanticZoomVars {
  glyphCompensation: number
  detailAlpha: number
  detailHit: 'auto' | 'none'
}

/** 画布一次写入的 CSS 变量值集合（纯数据，便于 esbuild 真跑断言）。 */
export function semanticZoomVarsForZoom(rawZoom: number): SemanticZoomVars {
  const detailAlpha = detailAlphaForZoom(rawZoom)
  return {
    glyphCompensation: glyphCompensationForZoom(rawZoom),
    detailAlpha,
    detailHit: detailAlpha >= DETAIL_HIT_THRESHOLD ? 'auto' : 'none',
  }
}
