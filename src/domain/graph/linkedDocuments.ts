/**
 * 节点关联已有文档：唯一的数据规则来源（渲染层）。
 *
 * docId 是全库稳定主键（见 electron/services/document-id-service.js），
 * cardRef 只是 O(1) 定位缓存，失效时由 resolveDocumentById 全库自愈并回写。
 * title 仅是失效时的显示快照，打开时以真实标题刷新，不参与寻址。
 */
export const MAX_LINKED_DOCUMENTS = 8

export interface LinkedDocumentRef {
  docId: string
  cardRef: string
  title: string
}

/** 解析结果：关联记录 + 后端反查出的真实位置与状态。 */
export interface ResolvedLinkedDocument extends LinkedDocumentRef {
  /** ok = 可打开；trashed = 在回收站（可恢复）；missing = 已彻底删除 */
  status: 'ok' | 'trashed' | 'missing'
  cardPath: string
  type: string
  trashName?: string
  /** 所属节点的可读名称，用于「在所属节点打开」时的房间名 */
  nodeName?: string
  /** 来源面包屑（唯一格式规则在主进程 formatDocumentSource），末段是节点名而非 id */
  sourceLabel?: string
}

/** 后端 resolveDocumentById 的原始返回（不含 cardRef，由调用方合并）。 */
export interface DocumentResolution {
  status: 'ok' | 'trashed' | 'missing'
  docId: string
  cardPath: string
  title: string
  type: string
  trashName?: string
  nodeName?: string
  sourceLabel?: string
}

/**
 * 文档双链的「被引用」条目：另一篇文档的正文中出现了指向本 docId 的 docLink。
 * breadcrumb 由主进程 formatDocumentSource 统一生成，右栏不得自行拼接。
 */
export interface DocumentBacklink {
  docId: string
  title: string
  type: string
  cardPath: string
  nodeName: string
  breadcrumb: string
  /** 该文档中指向目标的引用次数 */
  references: number
}

/** 返回 undefined 表示「没有关联」：写盘时省略该键，旧档零迁移、不撑大 _graph.json。 */
export function normalizeLinkedDocuments(raw: unknown, max = MAX_LINKED_DOCUMENTS): LinkedDocumentRef[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const result: LinkedDocumentRef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const docId = typeof record.docId === 'string' ? record.docId.trim() : ''
    if (!docId || seen.has(docId)) continue
    seen.add(docId)
    result.push({
      docId,
      cardRef: typeof record.cardRef === 'string' ? record.cardRef.trim().replace(/\\/g, '/') : '',
      title: typeof record.title === 'string' ? record.title.slice(0, 200) : '',
    })
    if (result.length >= max) break
  }
  return result.length ? result : undefined
}
