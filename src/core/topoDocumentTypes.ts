/**
 * TopoMind 文档类型唯一规则源。
 *
 * 两层概念刻意分开：
 * - TOPO_DOCUMENT_TYPES：落盘/校验类型全集，供 storage 创建校验、扩展名表、导入重映射使用。
 * - TOPO_PANEL_DOCUMENT_TYPES：右栏「可见 surface」。容器载荷（excalidraw、cardspec、image）与已退场的
 *   compat 类型（flowchart）都不在这里，因此不会出现在新建菜单与文档树中。
 *
 * 旧 `.tflow.json` 只在主进程 electron/file-service.js 保留为「只索引不渲染」的 compat 类型，
 * 不进渲染层枚举，保证 tree.json 条目不被 normalize/reconcile 静默删除。
 */
export const TOPO_DOCUMENT_TYPES = ['smart', 'mindmap', 'excalidraw', 'cardspec', 'image'] as const

export type TopoDocumentType = typeof TOPO_DOCUMENT_TYPES[number]

export function isTopoDocumentType(type: unknown): type is TopoDocumentType {
  return typeof type === 'string' && (TOPO_DOCUMENT_TYPES as readonly string[]).includes(type)
}

/** 右栏新建菜单与文档树只认这些类型。 */
export const TOPO_PANEL_DOCUMENT_TYPES = ['smart', 'mindmap'] as const

export type TopoPanelDocumentType = typeof TOPO_PANEL_DOCUMENT_TYPES[number]

export function isPanelDocumentType(type: unknown): type is TopoPanelDocumentType {
  return typeof type === 'string' && (TOPO_PANEL_DOCUMENT_TYPES as readonly string[]).includes(type)
}
