/**
 * 公式（行内 / 块级）「正在编辑」的会话信号。
 *
 * 为什么需要它：`blockLastModifiedExtension` 会在停止输入约 1 秒后用
 * `setNodeMarkup` 把 lastModified 写回块内容节点。该操作会让 ProseMirror
 * 重建块内容节点的视图，行内公式 / 块级公式的 React state（是否正在编辑、
 * 输入框草稿）随之丢失 —— 表现就是「编辑公式时停顿一下，输入框自己消失，
 * 焦点回到正文，之后敲字会写进错误的位置」。
 *
 * 因此时间戳写入需要知道「此刻是否正在编辑公式」，是则推迟。用计数而不是
 * 布尔，避免多个公式的编辑会话互相覆盖（React StrictMode 的
 * mount→unmount→mount 也能正确收敛到 1）。
 */
let editingDepth = 0

export function beginMathEditing(): void {
  editingDepth += 1
}

export function endMathEditing(): void {
  editingDepth = editingDepth > 0 ? editingDepth - 1 : 0
}

export function isMathEditing(): boolean {
  return editingDepth > 0
}
