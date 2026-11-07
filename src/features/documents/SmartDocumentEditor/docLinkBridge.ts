/**
 * 文档双链的跨层事件桥。
 *
 * 行内 spec 由 BlockNote 在 ProseMirror 节点视图里渲染，它在 React 树的很深一层；
 * 而「打开目标文档」的处理器在 SmartDocumentEditor / 右栏。沿用 editorLinkInterceptor
 * 的做法：组件挂载时注册最新回调，模块级只持有引用，调用时读最新值，不受闭包陈旧影响。
 * 同一时刻只有当前活动标签页挂载编辑器，因此单实例 handler 是安全的。
 */

export interface DocumentLinkOpenPayload {
  docId: string
  title: string
}

let openHandler: ((payload: DocumentLinkOpenPayload) => void) | null = null

export function setDocumentLinkOpenHandler(
  fn: ((payload: DocumentLinkOpenPayload) => void) | null,
): void {
  openHandler = fn
}

export function requestOpenDocumentLink(payload: DocumentLinkOpenPayload): void {
  openHandler?.(payload)
}

/** 触发点光标矩形（viewport 坐标），用于把选择器浮层贴在 `[[` 输入处。 */
export interface DocumentLinkPickerRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface DocumentLinkPickerRequest {
  rect: DocumentLinkPickerRect
  source: 'input-rule' | 'slash-menu'
}

let pickerHandler: ((request: DocumentLinkPickerRequest) => void) | null = null

export function setDocumentLinkPickerHandler(
  fn: ((request: DocumentLinkPickerRequest) => void) | null,
): void {
  pickerHandler = fn
}

export function requestDocumentLinkPicker(request: DocumentLinkPickerRequest): void {
  pickerHandler?.(request)
}

/** 从 DOM 选区取光标矩形；取不到时返回屏幕中上部作为兜底锚点。 */
export function readCaretRect(): DocumentLinkPickerRect {
  const fallback = {
    left: window.innerWidth / 2,
    top: window.innerHeight / 3,
    right: window.innerWidth / 2,
    bottom: window.innerHeight / 3,
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return fallback
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  if (!rect || (rect.left === 0 && rect.top === 0 && rect.width === 0 && rect.height === 0)) {
    return fallback
  }
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}
