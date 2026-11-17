/**
 * 右键节点时的选中态决策（唯一真源）。
 *
 * 旧实现在 onNodeContextMenu 里无条件 selectNode(node.id)，会把 nodes[].selected
 * 重置成单选 —— 框选 / 选中子树 / Shift 点选之后一右键，「多选模式」就没了，
 * 批量移动只剩一个节点。
 *
 * 语义：右键落在已有选中集合内 → 保留整批；落在集合外 → 切到单选该节点。
 * 抽成纯函数是为了让专项验证能直接真跑这条分支，而不是只靠源码字符串断言。
 */
export function shouldResetSelectionOnContextMenu(
  selectedIds: readonly string[],
  nodeId: string,
): boolean {
  return !selectedIds.includes(nodeId)
}
