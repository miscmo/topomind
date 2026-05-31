export const TOPO_DOCUMENT_TYPES = ['smart', 'mindmap', 'flowchart'] as const

export type TopoDocumentType = typeof TOPO_DOCUMENT_TYPES[number]

export function isTopoDocumentType(type: unknown): type is TopoDocumentType {
  return typeof type === 'string' && (TOPO_DOCUMENT_TYPES as readonly string[]).includes(type)
}
