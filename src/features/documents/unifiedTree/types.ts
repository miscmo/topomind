import type { FSBDocumentCandidate, UnifiedTreeLevel, UnifiedTreeNode } from '../../../core/fs-backend'

export type { UnifiedTreeNode, UnifiedTreeLevel }

/**
 * 统一资源树的数据源契约。
 *
 * 树本身不绑定任何业务：任何「整合查看」入口（关联文档、插入引用、以后的
 * 移动文档到节点、附件归属、全局跳转）只要提供这三个方法，就能复用
 * useUnifiedTree + UnifiedTreeView，不需要再写一套加载/缓存/展开逻辑。
 */
export interface UnifiedTreeDataSource {
  /** 只返回 parentKey 的直接子层；实现方不得递归子孙或全库扫描。 */
  loadLevel: (parentKey: string) => Promise<UnifiedTreeLevel>
  /** 跨层搜索：空 query 不应触发扫描。 */
  search: (query: string, limit?: number) => Promise<FSBDocumentCandidate[]>
  /** docId → 从根到该文档的 key 链，用于自动展开定位。 */
  resolvePath: (docId: string) => Promise<string[]>
}

/** 深度优先展开后的一行；depth 只用于缩进，key 始终保持不透明。 */
export interface UnifiedTreeRow {
  node: UnifiedTreeNode
  depth: number
  parentKey: string
  expanded: boolean
  loading: boolean
}
