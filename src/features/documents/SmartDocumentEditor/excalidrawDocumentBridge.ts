/**
 * 「编辑器里插入手绘流程图」的跨层创建桥。
 *
 * 插入入口有两处：斜杠菜单（SmartDocumentEditor）与块侧边菜单（ProseMirror 节点视图
 * 深处），后者拿不到当前节点路径 / storage。沿用 docLinkBridge 的做法：由主编辑器实例
 * 注册唯一处理器，模块级只持引用，调用时读最新值。
 *
 * 只读的「引用临时预览」实例 registerGlobalHandlers=false，不会抢注册；卸载时用
 * clear 只注销自己那一个，避免多标签页互相清掉对方的注册。
 *
 * 关键约束：**没有处理器时返回 null，调用方绝不能回退成 props.scene 内嵌块**。
 * 新插入的流程图一律是独立文档引用，旧档的内嵌块才走兼容分支。
 */
export interface ExcalidrawDocumentRef {
  documentId: string
  title: string
}

export type ExcalidrawDocumentCreateHandler = () => Promise<ExcalidrawDocumentRef | null>

let createHandler: ExcalidrawDocumentCreateHandler | null = null

export function setExcalidrawDocumentCreateHandler(fn: ExcalidrawDocumentCreateHandler | null): void {
  createHandler = fn
}

export function clearExcalidrawDocumentCreateHandler(fn: ExcalidrawDocumentCreateHandler): void {
  if (createHandler === fn) createHandler = null
}

export function requestCreateExcalidrawDocument(): Promise<ExcalidrawDocumentRef | null> {
  if (!createHandler) return Promise.resolve(null)
  try {
    return createHandler()
  } catch {
    return Promise.resolve(null)
  }
}

/**
 * 当前编辑器的节点路径，仅作为 resolveDocumentById 的 O(1) 提示。
 * 不是真源：文档被移动后提示会失效，反查会自动回落到全库扫描自愈。
 * 由主编辑器渲染时写入（同一时刻只有活动标签页挂载编辑器），不落盘。
 */
let cardPathHint = ''

export function setExcalidrawDocumentCardPathHint(cardPath: string | null | undefined): void {
  cardPathHint = String(cardPath ?? '')
}

export function getExcalidrawDocumentCardPathHint(): string {
  return cardPathHint
}
