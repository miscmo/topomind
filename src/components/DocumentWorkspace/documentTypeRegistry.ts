import { TOPO_DOCUMENT_TYPES, isTopoDocumentType, type TopoDocumentType } from '../../core/topoDocumentTypes'

export interface DocumentTypeDefinition {
  type: TopoDocumentType
  label: string
  icon: string
  defaultTitle: string
  createLogName: string
}

export const TOPO_DOCUMENT_TYPE_DEFINITIONS: Record<TopoDocumentType, DocumentTypeDefinition> = {
  smart: {
    type: 'smart',
    label: '智能文档',
    icon: '✨',
    defaultTitle: '智能文档',
    createLogName: '多类型文档:创建智能文档',
  },
  mindmap: {
    type: 'mindmap',
    label: '思维导图',
    icon: '🧠',
    defaultTitle: '思维导图',
    createLogName: '多类型文档:创建思维导图',
  },
  flowchart: {
    type: 'flowchart',
    label: '流程图',
    icon: '🔀',
    defaultTitle: '流程图',
    createLogName: '多类型文档:创建流程图',
  },
}

export function getTopoDocumentTypeDefinition(type: TopoDocumentType): DocumentTypeDefinition {
  return TOPO_DOCUMENT_TYPE_DEFINITIONS[type]
}

export function isStructuredTopoDocumentType(type: unknown): type is TopoDocumentType {
  return isTopoDocumentType(type)
}

export { TOPO_DOCUMENT_TYPES }
