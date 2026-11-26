/**
 * 文档「外部写入」单向同步总线（AI Patch → 右栏会话 / 编辑器实例 / 画布预览）。
 *
 * 存在的原因：右栏智能文档是 1500ms debounce 的**整篇覆盖**保存，编辑器内存里的
 * draft 一旦比磁盘旧，下一次 autosave 就会把 AI 刚写进去的内容静默覆盖回来。
 * 本总线提供三件事：
 *   1. dirty 登记：右栏会话把「当前是否有未保存草稿」注册进来，AI 写入前据此拒绝；
 *   2. 外部写入发布：写盘成功后把新内容 + 递增 revision 广播出去；
 *   3. revision 订阅：右栏会话把新内容认领为干净基线，编辑器按 revision 重挂载，
 *      从而 initialContent 重新从磁盘态构建，彻底消除陈旧 draft。
 *
 * 本模块只持有纯数据，不 import storage / 任何业务 store，避免 documents ↔ ai-agent
 * 形成循环依赖；画布预览的 revision 刷新由 application 层注入的回调负责。
 */

import { useSyncExternalStore } from 'react'

export interface DocumentExternalWriteEvent {
  documentId: string
  cardPath: string
  content: unknown
  revision: number
}

interface ExternalWriteEntry {
  cardPath: string
  content: unknown
  revision: number
}

const entries = new Map<string, ExternalWriteEntry>()
const dirtyDocuments = new Set<string>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** 右栏文档会话在 isDocumentDirty 变化时调用。传 null 表示当前没有打开文档。 */
export function markDocumentDirty(documentId: string | null, dirty: boolean): void {
  if (!documentId) return
  if (dirty) dirtyDocuments.add(documentId)
  else dirtyDocuments.delete(documentId)
}

/** AI 写入前的硬门槛：有未保存草稿就拒绝，绝不静默覆盖用户正在敲的正文。 */
export function isDocumentDirty(documentId: string): boolean {
  return dirtyDocuments.has(documentId)
}

export function getDocumentExternalRevision(documentId: string): number {
  return entries.get(documentId)?.revision ?? 0
}

export function getDocumentExternalWrite(documentId: string): DocumentExternalWriteEvent | undefined {
  const entry = entries.get(documentId)
  if (!entry) return undefined
  return {
    documentId,
    cardPath: entry.cardPath,
    content: entry.content,
    revision: entry.revision,
  }
}

/** 写盘成功后调用：revision 单调递增，订阅方据此重挂载编辑器 / 认领干净基线。 */
export function publishDocumentExternalWrite(input: {
  documentId: string
  cardPath: string
  content: unknown
}): number {
  const revision = getDocumentExternalRevision(input.documentId) + 1
  entries.set(input.documentId, {
    cardPath: input.cardPath,
    content: input.content,
    revision,
  })
  emit()
  return revision
}

export function subscribeDocumentExternalWrites(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 供编辑器宿主拼进 key：外部写入后强制重挂载，initialContent 才会重新读新内容。 */
export function useDocumentExternalRevision(documentId: string | null): number {
  return useSyncExternalStore(
    subscribeDocumentExternalWrites,
    () => (documentId ? getDocumentExternalRevision(documentId) : 0),
    () => 0,
  )
}
