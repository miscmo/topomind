/**
 * 把图片容器载荷注册进领域层容器注册表。
 *
 * 与 excalidraw / cardspec 同构：外层关系树、图谱映射、生命周期搬运都只认
 * container.type，新增第三种容器不需要改节点类型或任何格式白名单。
 */
import { registerContainerType, type ContainerNodeSizeLimits, type ContainerSizeContext } from '../../../../domain/container/containerTypes'
import {
  IMAGE_CONTAINER_TYPE,
  IMAGE_DOCUMENT_SCHEMA,
  IMAGE_DOCUMENT_VERSION,
  createEmptyImageDocumentContent,
  fitImageNodeSize,
  imageContentVersion,
  normalizeImageDocumentContent,
  serializeImageDocumentContent,
  type ImageDocumentContent,
} from '../../../documents/ImageDocument/imageDocumentTypes'

export const IMAGE_CONTAINER_SPEC = {
  id: IMAGE_CONTAINER_TYPE,
  documentType: 'image',
  schema: IMAGE_DOCUMENT_SCHEMA,
  version: IMAGE_DOCUMENT_VERSION,
  createEmpty: (title: string) => createEmptyImageDocumentContent(title),
  normalize: (raw: unknown, title: string) => normalizeImageDocumentContent(raw, title),
  serialize: (value: ImageDocumentContent) => serializeImageDocumentContent(value),
  getSceneVersion: (value: ImageDocumentContent) => imageContentVersion(value),
  // 节点尺寸严格跟随图片宽高比：预览 img 解码后上报原始像素，ContainerCard
  // 据此一次性纠正 _graph.json 里的节点尺寸，并锁住后续拖动的宽高比。
  // 尺寸只在运行时算，绝不写进 .timg.json —— 载荷保持纯内容，跨设备搬运无副作用。
  getPreferredNodeSize: (
    value: ImageDocumentContent,
    limits: ContainerNodeSizeLimits,
    context?: ContainerSizeContext,
  ) => {
    const size = fitImageNodeSize(
      context?.intrinsicWidth ?? 0,
      context?.intrinsicHeight ?? 0,
      limits,
    )
    if (!size || !value.src) return null
    return {
      ...size,
      key: `${value.src}:${context?.intrinsicWidth}x${context?.intrinsicHeight}`,
    }
  },
} as const

registerContainerType(IMAGE_CONTAINER_SPEC)
