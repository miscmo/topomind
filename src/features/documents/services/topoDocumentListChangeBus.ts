/**
 * 编辑器内部新建结构化子文档后，通知右栏文档树重读 manifest。
 *
 * 右栏的 loadDocuments 是 useDetailDocuments 内部的局部回调，从 ProseMirror 节点视图
 * 无法直接调用，也不值得为此把回调穿透五层 props。这里只做一条极短的单向总线：
 * 事件只带 cardPath，订阅方自行比对当前节点，避免跨节点把列表串错。
 */
type TopoDocumentListChangeListener = (cardPath: string) => void

const listeners = new Set<TopoDocumentListChangeListener>()

export function publishTopoDocumentListChange(cardPath: string): void {
  if (!cardPath) return
  for (const listener of listeners) listener(cardPath)
}

export function subscribeTopoDocumentListChanges(
  listener: TopoDocumentListChangeListener,
): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
