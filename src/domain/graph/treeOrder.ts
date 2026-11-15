/**
 * 节点树同级顺序字段的唯一归一化规则源。
 * 单独成文件是为了让格式层（storage / mapper / normalizeGraphMeta）只依赖这个
 * 零依赖纯函数，不把 graphHierarchy / edgeRelations 拉进磁盘读写链路。
 *
 * 语义：treeOrder 只影响左侧节点树列表里的同级排列，绝不参与画布坐标计算；
 * 缺省 = 未排序（按遍历顺序追加到尾部），空白/脏值一律视为未排序。
 */
export function normalizeTreeOrder(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
