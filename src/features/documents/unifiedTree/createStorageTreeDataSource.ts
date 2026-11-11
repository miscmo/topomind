import type { Store } from '../../../core/storage'
import type { UnifiedTreeDataSource } from './types'

/**
 * 默认的统一树数据源：把存储服务的三个按需 API 适配成树协议。
 * 换成其它后端（远程、内存夹具、插件数据源）时只需另写一个 adapter。
 */
export function createStorageTreeDataSource(storage: Store): UnifiedTreeDataSource {
  return {
    loadLevel: (parentKey) => storage.listUnifiedTreeLevel(parentKey),
    search: (query, limit) => storage.searchUnifiedDocuments(query, { limit: limit ?? 80 }),
    resolvePath: (docId) => storage.resolveUnifiedDocumentPath(docId),
  }
}
