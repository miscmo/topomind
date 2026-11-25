import {
  TOPO_DOCUMENT_TYPES,
  TOPO_PANEL_DOCUMENT_TYPES,
  isTopoDocumentType,
  type TopoDocumentType,
} from '../../../core/topoDocumentTypes'
import type { LogActionId } from '../../../shared/observability/logContract.ts'

export interface DocumentTypeDefinition {
  type: TopoDocumentType
  label: string
  icon: string
  defaultTitle: string
  /** P2 T2.4：必须是事件目录登记的规范 id，禁止再传中文自由文本。 */
  createLogName: LogActionId
  /** panel = 右栏文档；container-only = 只作为节点容器载荷，不进右栏菜单与文档树 */
  surface: 'panel' | 'container-only'
}

export const TOPO_DOCUMENT_TYPE_DEFINITIONS: Record<TopoDocumentType, DocumentTypeDefinition> = {
  smart: {
    type: 'smart',
    label: '智能文档',
    icon: '📄',
    defaultTitle: '智能文档',
    createLogName: 'document.create',
    surface: 'panel',
  },
  mindmap: {
    type: 'mindmap',
    label: '思维导图',
    icon: '🧠',
    defaultTitle: '思维导图',
    createLogName: 'document.create',
    surface: 'panel',
  },
  excalidraw: {
    type: 'excalidraw',
    label: 'Excalidraw 白板',
    icon: '✎',
    defaultTitle: '未命名白板',
    createLogName: 'container.create',
    surface: 'container-only',
  },
  cardspec: {
    type: 'cardspec',
    label: '知识卡片',
    icon: '▣',
    defaultTitle: '未命名卡片',
    createLogName: 'container.create',
    surface: 'container-only',
  },
  image: {
    type: 'image',
    label: '图片容器',
    icon: '🖼',
    defaultTitle: '图片容器',
    createLogName: 'container.create',
    surface: 'container-only',
  },
}

/** 旧档 / 旧链接里可能出现的已退场类型，运行时给一个安全兜底，避免 undefined 崩溃。 */
const RETIRED_DOCUMENT_DEFINITION: DocumentTypeDefinition = {
  type: 'smart',
  label: '旧版文档',
  icon: '📄',
  defaultTitle: '旧版文档',
  createLogName: 'document.create',
  surface: 'container-only',
}

export function getTopoDocumentTypeDefinition(type: TopoDocumentType): DocumentTypeDefinition {
  return TOPO_DOCUMENT_TYPE_DEFINITIONS[type] ?? RETIRED_DOCUMENT_DEFINITION
}

/** 右栏新建菜单 / 右键子菜单 / 创建动作校验统一用这个，不直接遍历全集。 */
export function getPanelDocumentTypes(): readonly TopoDocumentType[] {
  return TOPO_PANEL_DOCUMENT_TYPES
}

export function isStructuredTopoDocumentType(type: unknown): type is TopoDocumentType {
  return isTopoDocumentType(type)
}

export { TOPO_DOCUMENT_TYPES }
