/**
 * 语义缩放 P1.9（2026-11-09）：碰撞感知的 LOD 硬约束（纯函数，无 DOM / store / IPC）。
 *
 * 【用户反馈】「缩放后节点之间会重合」。根因不在 LOD 隐藏节奏，而在 P0 的语义缩放：
 *   视觉壳被 `transform: scale(compensation)` 钉在屏幕尺寸上（远景反而放大到 1.3 倍），
 *   但节点坐标仍由 viewport 线性收缩 → 屏幕间距 ∝ ratio、视觉壳 ∝ glyphScale，
 *   于是「主干紧凑」到一定程度必然压在一起。P1 的几何压力只把这件事用来**调节奏**，
 *   没有保证结果，所以密集布局里剩下的节点依然会叠。
 *
 * 【用户第 3 轮的原话】「主干紧凑到一定程度后，又开始将相对边缘节点渐隐」——
 *   本模块就是那第二阶段的硬约束：**紧凑到要重叠时，按退场优先级把更边缘的节点渐隐**。
 *   与 P2（改动渲染坐标 / 多级布局插值）不同，这里一行坐标都不改：
 *   `hidden` 只是 React Flow 的渲染属性，不落盘、不碰 7 处字段白名单，
 *   也不会污染「用户手摆位置 / viewport 返回视野」。
 *
 * 【四条铁律】
 *  1. **100% 恒等**：ratio >= 1 完全不裁剪（用户手摆的重叠保持原样），
 *     100%→85% 用 smoothstep 平滑启用，不允许任何档位突然砍掉一批。
 *  2. **单调不回升**：boxScale 随 ratio 下降单调增大，保留优先级固定，
 *     因此「已保留集合」单调缩小；绝不以可见集合为输入，不会自激震荡。
 *  3. **语义优先**：树根 / pin / 选中 / 临时 reveal 恒定保留且优先级最高；
 *     裁掉一个树节点时连它的整棵子树一起裁，绝不出现「子可见、父已隐藏」。
 *  4. **几何同源**：碰撞盒 = 锚点壳 × compensation（视觉壳 transform 的等效 flow 尺寸）
 *     × padding，与 `zoomScale.glyphCompensationForZoom` 唯一源一致；
 *     尺寸取 nodes[].width/height（autoSize 会写回 DOM 实测值），缺省用磁盘默认值。
 *
 * 【为什么障碍是「所有更高优先级节点」而不是「已保留节点」】2026-11-09 回归实测：
 * 只拿已保留节点当障碍时，某个高优先级节点在更小 ratio 下被裁后，它就不再是障碍，
 * 原本被它挡住的低优先级节点会「闪回」——缩放途中节点忽隐忽现，且单调性被破坏
 * （实测 0.78 档隐藏 {a,b,d}、0.76 档变成 {a,b,c}）。改成障碍集合与 ratio 无关后：
 *   - 重叠关系只随 boxScale 单调增长 → 隐藏集合单调，绝不震荡；
 *   - 任意一对节点里优先级低的一方必被裁 → 最终保留集合两两不重叠是可证明的；
 *   - 代价是密集簇会连锁抽稀成「一个代表 + N」（正是地图标注避让的标准行为，
 *     且 P1.75 的 +N 徽标会解释被收起的节点）。
 *
 * 复杂度：按「保留优先级」遍历 + 均匀网格，O(n log n)，
 * 万级节点也只在跨 2% 显示比台阶时算一次。
 */
/** 与 `domain/graph/model.ts` 的 DEFAULT_NODE_SIZE / normalizeGraphMeta 同源。 */
export const LOD_COLLISION_DEFAULT_WIDTH = 120
export const LOD_COLLISION_DEFAULT_HEIGHT = 52
/** 视觉壳之间留 6% 缝隙：边框贴在一起观感上仍然像粘连。 */
export const LOD_COLLISION_PADDING = 1.06
/** 100% 是恒等点（不裁剪）；到 85% 时约束完全生效。 */
export const LOD_COLLISION_GUARD_START_RATIO = 1
export const LOD_COLLISION_GUARD_FULL_RATIO = 0.85

export interface LodCollisionNode {
  id: string
  position?: { x: number; y: number } | null
  width?: number
  height?: number
  measured?: { width?: number; height?: number } | null
}

export interface LodCollisionOptions {
  /** 当前显示比（1 = 100%）。>= 1 直接返回空结果，保证恒等点。 */
  ratio: number
  /** 视觉壳相对锚点壳的放大倍数，来自 zoomScale.glyphCompensationForZoom。 */
  compensation: number
  /** 恒定保留、且优先级最高的节点（树根 / pin / 选中 / 临时 reveal）。 */
  protectedIds: ReadonlySet<string>
  /** 保留优先级，越靠前越重要；由 lod.ts 传「退场序列的逆序」。 */
  priority: readonly string[]
  /** parent → children，只含从属边；用于父被裁时连带裁掉整棵子树。 */
  children: ReadonlyMap<string, readonly string[]>
  /** 与 graphHierarchy.MAX_HIERARCHY_DEPTH 同源，防脏数据成环。 */
  maxDepth?: number
  padding?: number
}

export interface LodCollisionResult {
  /** 因碰撞需要额外隐藏的节点 id（已含被裁节点的子树）。 */
  hiddenIds: Set<string>
  /** 参与判定的候选节点数。 */
  candidateCount: number
  /** 平滑启用系数（0 = 100% 恒等，1 = 完全生效）。 */
  guard: number
  /** 实际用于判定的盒放大倍数。 */
  boxScale: number
  /** 保护节点之间仍然重叠的对数（用户强制保留，允许，仅作诊断）。 */
  protectedOverlapPairs: number
  active: boolean
}

interface CollisionBox {
  id: string
  cx: number
  cy: number
  hw: number
  hh: number
  left: number
  right: number
  top: number
  bottom: number
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * 100% 不裁剪；85% 完全生效。用 smoothstep 让「约束强度」两端导数为 0，
 * 避免刚离开 100% 就立刻把贴得近的节点成批砍掉。
 */
export function collisionGuardForRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio >= LOD_COLLISION_GUARD_START_RATIO) return 0
  if (ratio <= LOD_COLLISION_GUARD_FULL_RATIO) return 1
  return 1 - smoothstep(LOD_COLLISION_GUARD_FULL_RATIO, LOD_COLLISION_GUARD_START_RATIO, ratio)
}

/** 盒放大倍数：100% 恒等 1，越远越接近 compensation。 */
export function collisionBoxScaleFor(compensation: number, guard: number): number {
  const raw = Number.isFinite(compensation) ? compensation : 1
  return 1 + (Math.max(1, Math.min(8, raw)) - 1) * clamp01(guard)
}

function readSize(node: LodCollisionNode): { width: number; height: number } {
  const width = Number.isFinite(node.width) ? (node.width as number)
    : Number.isFinite(node.measured?.width) ? (node.measured?.width as number)
      : LOD_COLLISION_DEFAULT_WIDTH
  const height = Number.isFinite(node.height) ? (node.height as number)
    : Number.isFinite(node.measured?.height) ? (node.measured?.height as number)
      : LOD_COLLISION_DEFAULT_HEIGHT
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  }
}

function buildBox(node: LodCollisionNode, boxScale: number, padding: number): CollisionBox | null {
  const p = node.position
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
  const { width, height } = readSize(node)
  // 视觉壳以锚点壳中心为原点 transform: scale(compensation)，
  // 因此等效 flow 盒 = 锚点盒 × boxScale，中心不动。
  const hw = (width * boxScale * padding) / 2
  const hh = (height * boxScale * padding) / 2
  const cx = p.x + width / 2
  const cy = p.y + height / 2
  return {
    id: node.id, cx, cy, hw, hh,
    left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh,
  }
}

export function boxesOverlap(a: CollisionBox, b: CollisionBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/**
 * 诊断 / 回归专用的两两重叠计数（O(n²)，不要在画布热路径调用）。
 * 产品路径用网格，且只登记已保留节点，天然有界。
 */
export function countOverlapPairs(
  nodes: readonly LodCollisionNode[],
  ids: ReadonlySet<string>,
  boxScale: number,
  padding = LOD_COLLISION_PADDING,
): number {
  const boxes: CollisionBox[] = []
  for (const node of nodes) {
    if (!ids.has(node.id)) continue
    const box = buildBox(node, boxScale, padding)
    if (box) boxes.push(box)
  }
  let pairs = 0
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlap(boxes[i], boxes[j])) pairs += 1
    }
  }
  return pairs
}

export function emptyCollisionResult(): LodCollisionResult {
  return {
    hiddenIds: new Set<string>(),
    candidateCount: 0,
    guard: 0,
    boxScale: 1,
    protectedOverlapPairs: 0,
    active: false,
  }
}

/**
 * 按保留优先级遍历：与任一「更高优先级节点」的放大盒相交，就把当前节点渐隐。
 * 障碍集合不随 ratio 变化，因此隐藏集合单调、最终保留集合两两不重叠。
 * 保护节点之间不做互相裁剪（用户强制保留 > 视觉避让），只统计诊断。
 * 最后把被裁树节点的整棵子树一并加入 hiddenIds，保持父子链完整。
 */
export function resolveLodCollisions(
  nodes: readonly LodCollisionNode[],
  candidateIds: ReadonlySet<string>,
  options: LodCollisionOptions,
): LodCollisionResult {
  const result = emptyCollisionResult()
  const { ratio, protectedIds, priority, children } = options
  const guard = collisionGuardForRatio(ratio)
  if (guard <= 0 || candidateIds.size < 2) return result
  const boxScale = collisionBoxScaleFor(options.compensation, guard)
  const padding = options.padding ?? LOD_COLLISION_PADDING

  const boxes = new Map<string, CollisionBox>()
  for (const node of nodes) {
    if (!candidateIds.has(node.id)) continue
    const box = buildBox(node, boxScale, padding)
    if (box) boxes.set(node.id, box)
  }
  if (boxes.size < 2) return result

  // 网格边长 >= 任意盒的全宽/全高：两盒若相交，中心必落在 3×3 邻格内。
  let cell = 1
  for (const box of boxes.values()) cell = Math.max(cell, box.hw * 2, box.hh * 2)
  const keyOf = (cx: number, cy: number) => `${Math.floor(cx / cell)},${Math.floor(cy / cell)}`
  const buckets = new Map<string, CollisionBox[]>()
  const kept: CollisionBox[] = []
  const keptIds = new Set<string>()
  const hiddenIds = new Set<string>()

  const overlapsEarlier = (box: CollisionBox, skipProtected: boolean): boolean => {
    const gx = Math.floor(box.cx / cell)
    const gy = Math.floor(box.cy / cell)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`)
        if (!bucket) continue
        for (const other of bucket) {
          if (skipProtected && protectedIds.has(other.id)) continue
          if (boxesOverlap(box, other)) return true
        }
      }
    }
    return false
  }

  // priority 里没列到的候选按 id 兜底排到最后，保证顺序稳定、结果可复现。
  const seenInPriority = new Set<string>()
  const order: string[] = []
  for (const id of priority) {
    if (!candidateIds.has(id) || seenInPriority.has(id)) continue
    seenInPriority.add(id)
    order.push(id)
  }
  for (const id of [...boxes.keys()].sort()) {
    if (!seenInPriority.has(id)) order.push(id)
  }

  for (const id of order) {
    const box = boxes.get(id)
    if (!box) continue
    const isProtected = protectedIds.has(id)
    // 障碍是「所有更高优先级节点」，与它们最终是否保留无关（见文件头铁律）。
    // 保护节点之间允许重叠（恒定保留优先），但会挡住后来的普通节点。
    const collides = overlapsEarlier(box, isProtected)
    if (collides && !isProtected) {
      hiddenIds.add(id)
    } else {
      keptIds.add(id)
      kept.push(box)
    }
    // 被裁的节点仍然登记：它是更低优先级节点的稳定障碍，保证隐藏集合单调。
    const key = keyOf(box.cx, box.cy)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(box)
    else buckets.set(key, [box])
  }

  // 保护节点之间的剩余重叠对数（数量很少，O(k²) 可接受）。
  let protectedOverlapPairs = 0
  const protectedBoxes = kept.filter((box) => protectedIds.has(box.id))
  for (let i = 0; i < protectedBoxes.length; i += 1) {
    for (let j = i + 1; j < protectedBoxes.length; j += 1) {
      if (boxesOverlap(protectedBoxes[i], protectedBoxes[j])) protectedOverlapPairs += 1
    }
  }

  // 父被裁 → 整棵子树一起裁，避免「子可见、父已隐藏」的断链。
  const maxDepth = options.maxDepth ?? 100
  const stack: Array<{ id: string; depth: number }> = []
  for (const id of hiddenIds) stack.push({ id, depth: 0 })
  const visited = new Set<string>(hiddenIds)
  while (stack.length > 0) {
    const { id, depth } = stack.pop() as { id: string; depth: number }
    if (depth >= maxDepth) continue
    for (const child of children.get(id) ?? []) {
      if (visited.has(child) || protectedIds.has(child) || !keptIds.has(child)) continue
      visited.add(child)
      hiddenIds.add(child)
      stack.push({ id: child, depth: depth + 1 })
    }
  }

  result.hiddenIds = hiddenIds
  result.candidateCount = boxes.size
  result.guard = guard
  result.boxScale = boxScale
  result.protectedOverlapPairs = protectedOverlapPairs
  result.active = true
  return result
}
