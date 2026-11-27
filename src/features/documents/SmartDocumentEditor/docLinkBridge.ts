/**
 * 文档双链的跨层事件桥。
 *
 * 行内 spec 由 BlockNote 在 ProseMirror 节点视图里渲染，它在 React 树的很深一层；
 * 而「打开目标文档」的处理器在 SmartDocumentEditor / 右栏。沿用 editorLinkInterceptor
 * 的做法：组件挂载时注册最新回调，模块级只持有引用，调用时读最新值，不受闭包陈旧影响。
 * 同一时刻只有当前活动标签页挂载编辑器，因此单实例 handler 是安全的。
 *
 * AI 回答里的 [ref:i] 与双链不同：它自己带着 docId，不该要求用户「先选中一个节点」，
 * 更不该因为目标文档在别的房间 / 知识库就把整个画布带过去。因此另开一条常驻的
 * 「引用预览」桥，由右栏详情面板（CSS hidden 常驻挂载）注册：只在右栏临时、
 * 只读地展示目标文档，画布的房间、知识库与选中节点一概不动。
 * 双链桥继续只服务于 ProseMirror 里的 chip，保留它原本的跨房间跳转语义。
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

/**
 * @returns 是否已有处理器接管。文档双链 chip 只可能在编辑器挂载后被点到，
 *   因此无 handler 时由调用方自行降级（AI 引用改走下面的常驻引用桥）。
 */
export function requestOpenDocumentLink(payload: DocumentLinkOpenPayload): boolean {
  if (!openHandler) return false
  openHandler(payload)
  return true
}

/** P3 引用：[ref:i] 的编号只在渲染层映射到 docId；三层名字仅用于预览条展示。 */
export interface ReferenceOpenPayload {
  docId: string
  title: string
  ref?: number
  breadcrumb?: string
  nodeName?: string
  blockLabel?: string
  snippet?: string
}

type ReferenceOpenHandler = (payload: ReferenceOpenPayload) => boolean | Promise<boolean>

let referenceOpenHandler: ReferenceOpenHandler | null = null

export function setReferenceOpenHandler(fn: ReferenceOpenHandler | null): void {
  referenceOpenHandler = fn
}

/** 只注销自己注册的那一个 handler，避免多个 tab 的 DetailPanel 互相清掉对方的注册。 */
export function clearReferenceOpenHandler(fn: ReferenceOpenHandler): void {
  if (referenceOpenHandler === fn) referenceOpenHandler = null
}

/**
 * 临时预览 AI 引用指向的文档。rightPanel.reveal 之后 React 需要一帧才把 detail
 * 分区标记为活动并注册 handler，这里短轮询等待；返回是否真的完成了预览。
 * 不要求画布已有选中节点，也不切换房间 / 知识库 / 选中节点 —— 目标文档由
 * docId 反查得到，只在右栏覆盖层里只读展示。
 */
export async function requestOpenReference(
  payload: ReferenceOpenPayload,
  timeoutMs = 1200,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const handler = referenceOpenHandler
    if (handler) {
      try {
        return await handler(payload)
      } catch {
        return false
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  return false
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
