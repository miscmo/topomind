/**
 * 把 Excalidraw 载荷注册进领域层容器注册表。
 *
 * 这是「新增一种容器」唯一的领域侧改动：外层关系树、图谱映射、生命周期搬运
 * 都不认识 excalidraw，只按 container.type 查表。
 */
import { registerContainerType } from '../../../../domain/container/containerTypes'
import {
  EXCALIDRAW_CONTAINER_TYPE,
  EXCALIDRAW_DOCUMENT_SCHEMA,
  EXCALIDRAW_DOCUMENT_VERSION,
  createEmptyExcalidrawDocumentContent,
  excalidrawSceneVersion,
  normalizeExcalidrawDocumentContent,
  serializeExcalidrawDocumentContent,
  type ExcalidrawDocumentContent,
} from '../../../documents/ExcalidrawDocument/excalidrawDocumentTypes'

export const EXCALIDRAW_CONTAINER_SPEC = {
  id: EXCALIDRAW_CONTAINER_TYPE,
  documentType: 'excalidraw',
  schema: EXCALIDRAW_DOCUMENT_SCHEMA,
  version: EXCALIDRAW_DOCUMENT_VERSION,
  createEmpty: (title: string) => createEmptyExcalidrawDocumentContent(title),
  normalize: (raw: unknown, title: string) => normalizeExcalidrawDocumentContent(raw, title),
  serialize: (value: ExcalidrawDocumentContent) => serializeExcalidrawDocumentContent(value),
  getSceneVersion: (value: ExcalidrawDocumentContent) => excalidrawSceneVersion(value),
} as const

registerContainerType(EXCALIDRAW_CONTAINER_SPEC)
