/**
 * LOD 可见性计划的缓存签名（零依赖纯函数，便于门禁 esbuild 真跑）。
 *
 * 【2026-11-15 多选卡顿修复】满缩放（用户视角 100%，也是画布唯一可编辑的档位）
 * 时所有节点必然可见，选中集合既不影响裁剪也不影响强制显示集合。旧签名把
 * 「所有选中 id 拼串」和 selectedNodeId 算进去，导致 Shift 拖框每帧选中集合
 * 一变就签名失效 → 全量 computeLodVisibility（建 hierarchy、排序、压力曲线）。
 *
 * 因此满缩放时签名忽略「所有选中 id 拼串」；只有真正进入收起区间（<100%）
 * 才把整份选中集合纳入，保证「选中节点强制显示」在缩小时仍然生效。
 *
 * 例外：selectedNodeId（第一个选中节点）始终进签名。左上角层级诊断面板要显示
 * 它的深度 / 类型 / 隐藏阈值，这些字段由 computeLodVisibility 里的 hierarchy 与
 * 压力曲线派生，必须随选中变化重算一次（GUI 阶段 Q 硬约束）。单个 id 是 O(1)，
 * 框选过程中只要第一个选中节点不变，整份计划就继续命中缓存、零重算。
 */
export interface LodPlanSignatureInput {
  hierarchyKey: string
  edgeCount: number
  zoom: number
  mode: string
  preservedDepth: number
  configuredProfileId: string
  pinnedKey: string
  revealedKey: string
  /** 由 isLodFullZoom(zoom) 计算，确保与 computeLodVisibility 同源 */
  fullZoom: boolean
  selectedKey: string
  selectedNodeId: string | null
}

export function buildLodPlanSignature(input: LodPlanSignatureInput): string {
  const parts: Array<string | number> = [
    input.hierarchyKey,
    input.edgeCount,
    input.zoom,
    input.mode,
    input.preservedDepth,
    input.configuredProfileId,
    input.pinnedKey,
    input.revealedKey,
  ]
  if (!input.fullZoom) {
    parts.push(input.selectedKey)
  }
  // 选中节点诊断始终跟随第一个选中节点更新，但只放 O(1) 的单个 id。
  parts.push(input.selectedNodeId ?? '')
  return parts.join('~')
}
