import { COMPACT_START_RATIO } from './zoomScale.ts'

/**
 * 语义缩放 P1：重叠压力驱动的渐隐节奏（纯函数层，可被 esbuild 打包真跑）。
 *
 * 【用户决策 2026-11-09】「缩小时节点/文字尺寸不再变小，只让缝隙收拢；
 *  边缘渐隐与主干紧凑应当像地图一样自然交替」。P0 已把节点屏幕尺寸钉住，
 *  于是两个节点的世界间距 d 在屏幕上只剩 `d × ratio`：ratio 越小越挤。
 *  本模块用真实布局的「最近邻间距分布」把 100%→20% 这段渐隐行程重参数化：
 *    - 布局稀疏时，缩小的压力上不去，隐藏变慢 → 观感是「主干紧凑起来」；
 *    - 撞上密集簇时，压力陡升，隐藏加快 → 观感是「边缘内容缩回缝隙」；
 *  两者由同一条单调曲线驱动，交替是涌现结果，不是硬编码的阶段表。
 *
 * 【P1.5 2026-11-09】远景字形放大后，节点屏幕尺寸不再是常量：重叠需求改为
 *  `base × glyphScale(ratio) / ratio`。不传 glyphScale 函数时恒等于旧的
 *  `base / ratio`，所有历史断言逐值不变；真实链路由 lod.ts 传入
 *  `zoomScale.glyphScaleForRatio`，于是「节点变大 → 压力升高 → 渐隐提前」自动发生，
 *  不需要为字形放大额外编排隐藏阶段。
 *
 * 【三条铁律】
 *  1. **monotonic**：progress 只依赖静态布局 + 当前 ratio，绝不依赖可见集合，
 *     否则「隐藏 → 压力变 → 又显示」会自我震荡；缩小过程中隐藏单调不回升。
 *  2. **bounded**：几何项只占 `LOD_PRESSURE_WEIGHT`，剩余部分仍是线性分位，
 *     所以 `|d ratio / d progress| ≤ 1/(1-w)`，单步隐藏数有上界（不会骤降）。
 *  3. **两端固定**：progress(100%)=100%、progress(20%)=20%，
 *     ≥100% 全显示 / 20% 只剩永久层数的既有保护完全不受影响。
 *
 * 无坐标（回归脚本的最小构造、节点 <3 个）时曲线恒等，行为与旧的「按节点数
 * 分位数」逐字节一致；真实图谱里 nodes 一定带 React Flow 的 flow 坐标，自动启用。
 * 坐标只影响**节奏**，退场顺序仍由 lod.ts 的语义树唯一决定（父绝不会先于子消失）。
 */
/**
 * 显示比区间由 lod.ts 传入（唯一事实源仍是那里的 LOD_FULL_RATIO / LOD_FLOOR_RATIO），
 * 避免本模块反向 import lod.ts 形成循环依赖。默认值由 zoomScale 的紧凑起点派生，
 * 与 lod.ts 同源（zoomScale 不 import 本模块，不存在环）。
 */
/** 由 zoomScale 提供的「该显示比下节点视觉尺寸倍率」；不传时恒等 1（旧行为）。 */
export type LodGlyphScaleForRatio = (ratio: number) => number
const IDENTITY_GLYPH_SCALE: LodGlyphScaleForRatio = () => 1

export interface LodPressureBounds {
  fullRatio: number
  floorRatio: number
  /** P1.5：远景字形放大后的屏幕尺寸倍率；放进 bounds 让所有默认参数自动同源。 */
  glyphScaleForRatio?: LodGlyphScaleForRatio
}
export const DEFAULT_LOD_PRESSURE_BOUNDS: LodPressureBounds = {
  fullRatio: 1,
  floorRatio: COMPACT_START_RATIO,
}

/** React Flow 的 flow 坐标（不是屏幕像素）。 */
export interface LodPosition {
  x: number
  y: number
}

/** 几何项在行程重参数化里的最大占比；越大节奏越贴布局，但单步隐藏量也越大。 */
export const LOD_PRESSURE_WEIGHT = 0.28
/**
 * 单个间距从「不重叠」到「重叠」的平滑宽度（相对 s/d）。
 * 用平滑过渡而不是硬阈值，避免同间距节点同时跳变造成成批消失。
 */
export const LOD_PRESSURE_SOFTNESS = 0.9
/** 查找表步长：与 LOD 的 2% 显示比台阶对齐，避免插值精度超出量化精度。 */
export const LOD_PRESSURE_STEP = 0.02
/** 单个网格桶最多比较的点数，防止所有节点挤在一格时退化成 O(n²)。 */
const MAX_BUCKET_PROBES = 24

export interface LodPressureCurve {
  /** 是否真的用上了几何布局；false 时 ratioFor 是恒等映射。 */
  active: boolean
  /** 是否把远景字形放大计入重叠需求（供诊断 / GUI 直读）。 */
  glyphAware: boolean
  /** 参与统计的最近邻间距样本数（诊断 / 真跑断言用）。 */
  sampleCount: number
  /** progress 阈值（按节点数分位算出的显示比）→ 实际显示比阈值。 */
  ratioFor(progress: number): number
  /** 给定显示比 → 行程进度，用于验证单调性。 */
  progressFor(ratio: number): number
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** smoothstep：把线性输入压成两端导数为 0 的平滑过渡。 */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * 空间哈希求每个点到最近邻的世界距离。只取 3×3 邻格，找不到邻居的孤立点
 * 给一个较大的哨兵值（cell×3）——「很稀疏」本身就是有效信息，无需全局 O(n²)。
 */
export function collectNodeSpacings(points: readonly (LodPosition | undefined | null)[]): number[] {
  const valid: LodPosition[] = []
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    valid.push(point)
  }
  if (valid.length < 3) return []

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of valid) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const area = Math.max(1, (maxX - minX) * (maxY - minY))
  // 乘 1.5 是必要的：sqrt(面积/n) 只是平均密度半径，规则网格里相邻两点
  // 可能恰好落在相隔 2 格的边界上，只扫 3×3 会把边缘点误判成孤立点。
  const cell = Math.max(1, Math.sqrt(area / valid.length) * 1.5)
  const buckets = new Map<string, number[]>()
  valid.forEach((p, index) => {
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(index)
    else buckets.set(key, [index])
  })

  return valid.map((p, index) => {
    const cx = Math.floor(p.x / cell)
    const cy = Math.floor(p.y / cell)
    let best = Infinity
    let probes = 0
    for (let dx = -1; dx <= 1 && probes < MAX_BUCKET_PROBES * 9; dx += 1) {
      for (let dy = -1; dy <= 1 && probes < MAX_BUCKET_PROBES * 9; dy += 1) {
        const bucket = buckets.get(`${cx + dx},${cy + dy}`)
        if (!bucket) continue
        for (let k = 0; k < bucket.length && probes < MAX_BUCKET_PROBES * 9; k += 1) {
          const other = bucket[k]
          if (other === index) continue
          probes += 1
          const q = valid[other]
          const dist = Math.hypot(q.x - p.x, q.y - p.y)
          if (dist < best) best = dist
        }
      }
    }
    return Number.isFinite(best) ? best : cell * 3
  })
}

/** 取间距分布的中位数作为「100% 时不算重叠」的基准，避免被极近的离群点对带偏。 */
function medianSpacing(spacings: readonly number[]): number {
  const sorted = [...spacings].sort((a, b) => a - b)
  return Math.max(1e-6, sorted[Math.floor(sorted.length / 2)])
}

/**
 * 几何重叠度：屏幕间距需求 `s = base × glyphScale(ratio) / ratio`。
 * 节点屏幕尺寸恒定时需求 ∝ 1/ratio；远景字形放大后分子也变大，压力随之升高。
 * 每个间距样本用 smoothstep 平滑贡献，返回 [0,1]。ratio 越小，结果单调不减。
 */
export function overlapPressureForRatio(
  ratio: number,
  spacings: readonly number[],
  bounds: LodPressureBounds = DEFAULT_LOD_PRESSURE_BOUNDS,
  base = medianSpacing(spacings),
): number {
  if (spacings.length === 0) return 0
  const safeRatio = Math.max(bounds.floorRatio, Math.min(bounds.fullRatio, ratio))
  // 防御外部函数返回 NaN / 极端值：压力必须是 [0,1] 且随 ratio 单调。
  const rawGlyph = (bounds.glyphScaleForRatio ?? IDENTITY_GLYPH_SCALE)(safeRatio)
  const glyph = Number.isFinite(rawGlyph) ? Math.min(4, Math.max(0.5, rawGlyph)) : 1
  const need = base * glyph / safeRatio
  let sum = 0
  for (const spacing of spacings) {
    const x = need / Math.max(1e-6, spacing)
    sum += smoothstep(
      1 - LOD_PRESSURE_SOFTNESS,
      1 + LOD_PRESSURE_SOFTNESS,
      x,
    )
  }
  return sum / spacings.length
}

/** 行程进度：1 = 全显示，0.2 = 只剩永久层数；单调递减且两端固定。 */
export function lodProgressForRatio(
  ratio: number,
  spacings: readonly number[],
  bounds: LodPressureBounds = DEFAULT_LOD_PRESSURE_BOUNDS,
  overlapLow = overlapPressureForRatio(bounds.fullRatio, spacings, bounds),
  overlapHigh = overlapPressureForRatio(bounds.floorRatio, spacings, bounds),
  base = medianSpacing(spacings),
): number {
  const { fullRatio, floorRatio } = bounds
  const safeRatio = Math.min(fullRatio, Math.max(floorRatio, ratio))
  const span = fullRatio - floorRatio
  const linear = (fullRatio - safeRatio) / span
  const overlapSpan = overlapHigh - overlapLow
  const geometric = overlapSpan > 1e-9
    ? clamp01((overlapPressureForRatio(safeRatio, spacings, bounds, base) - overlapLow) / overlapSpan)
    : linear
  const warped = (1 - LOD_PRESSURE_WEIGHT) * linear + LOD_PRESSURE_WEIGHT * geometric
  return fullRatio - clamp01(warped) * span
}

/**
 * 预计算 2% 台阶上的 progress 查找表，再用线性插值求逆。
 * 只需建一次表（O(36·n)），之后每个节点的阈值查询是 O(log n)。
 * 无坐标时返回恒等曲线，保证旧行为逐值不变。
 */
export function buildLodPressureCurve(
  points: readonly (LodPosition | undefined | null)[],
  bounds: LodPressureBounds = DEFAULT_LOD_PRESSURE_BOUNDS,
): LodPressureCurve {
  const { fullRatio, floorRatio } = bounds
  const spacings = collectNodeSpacings(points)
  if (spacings.length === 0) {
    return {
      active: false,
      glyphAware: false,
      sampleCount: 0,
      ratioFor: (progress) => progress,
      progressFor: (ratio) => ratio,
    }
  }

  const glyphScaleForRatio = bounds.glyphScaleForRatio ?? IDENTITY_GLYPH_SCALE
  // 只看函数值、不比较引用：esbuild 打包后跨模块的函数引用未必稳定。
  const glyphAware = Math.abs(glyphScaleForRatio((fullRatio + floorRatio) / 2) - 1) > 1e-6
  // 中位数基准只算一次：查找表有 36 个采样点，每次重排 1 万节点会白白拖慢缩放。
  const base = medianSpacing(spacings)
  const overlapLow = overlapPressureForRatio(fullRatio, spacings, bounds, base)
  const overlapHigh = overlapPressureForRatio(floorRatio, spacings, bounds, base)
  const progressFor = (ratio: number) => lodProgressForRatio(ratio, spacings, bounds, overlapLow, overlapHigh, base)

  const ratios: number[] = []
  const progresses: number[] = []
  let previous = Infinity
  for (let ratio = fullRatio; ratio > floorRatio + 1e-9; ratio -= LOD_PRESSURE_STEP) {
    const progress = Math.min(previous, progressFor(ratio))
    ratios.push(ratio)
    progresses.push(progress)
    previous = progress
  }
  ratios.push(floorRatio)
  progresses.push(floorRatio)
  progresses[0] = fullRatio

  const ratioFor = (progress: number): number => {
    const target = Math.min(fullRatio, Math.max(floorRatio, progress))
    if (target >= fullRatio) return fullRatio
    if (target <= progresses[progresses.length - 1]) return floorRatio
    // progresses 单调递减；找第一个 <= target 的区间并线性插值。
    let low = 0
    let high = progresses.length - 1
    while (low + 1 < high) {
      const mid = (low + high) >> 1
      if (progresses[mid] > target) low = mid
      else high = mid
    }
    const pLow = progresses[low]
    const pHigh = progresses[high]
    if (pLow - pHigh < 1e-12) return ratios[low]
    const t = (pLow - target) / (pLow - pHigh)
    return ratios[low] + (ratios[high] - ratios[low]) * t
  }

  return { active: true, glyphAware, sampleCount: spacings.length, ratioFor, progressFor }
}
