/**
 * 容器渲染器静态装配点（v1 不走插件系统）。
 *
 * 新增一种容器只需在这里加一行注册 + 一个 spec：外层关系树、选中、LOD、
 * 从属校验、生命周期搬运全部零改动。Editor 必须 lazy，主 chunk 不含编辑器实现。
 *
 * v1.4：编辑由 ContainerFullscreenEditorHost 全屏承载，与画布缩放彻底解耦，
 * 因此不再有「进入编辑所需的最小显示百分比」这类门槛。
 */
import { lazy } from 'react'
import { registerContainerRenderer } from './containerRenderers'
import { ContainerSvgPreview } from './ContainerSvgPreview'
import { EXCALIDRAW_CONTAINER_TYPE } from '../../../documents/ExcalidrawDocument/excalidrawDocumentTypes'
import { CARDSPEC_CONTAINER_TYPE } from '../../../documents/CardSpecDocument/cardSpecTypes'
import { IMAGE_CONTAINER_TYPE } from '../../../documents/ImageDocument/imageDocumentTypes'
import { CardSpecPreview } from './cardspec/CardSpecPreview'
import { ImageContainerPreview } from './image/ImageContainerPreview'
import './excalidrawContainerType'
import './cardSpecContainerType'
import './imageContainerType'

const ExcalidrawEditor = lazy(() => import('./ExcalidrawContainerEditor').then(m => ({
  default: m.ExcalidrawContainerEditor,
})))

const CardSpecEditor = lazy(() => import('./cardspec/CardSpecEditor').then(m => ({
  default: m.CardSpecEditor,
})))

const ImageEditor = lazy(() => import('./image/ImageContainerEditor').then(m => ({
  default: m.ImageContainerEditor,
})))

registerContainerRenderer({
  type: EXCALIDRAW_CONTAINER_TYPE,
  Preview: ContainerSvgPreview,
  Editor: ExcalidrawEditor,
})

registerContainerRenderer({
  type: CARDSPEC_CONTAINER_TYPE,
  Preview: CardSpecPreview,
  Editor: CardSpecEditor,
})

registerContainerRenderer({
  type: IMAGE_CONTAINER_TYPE,
  Preview: ImageContainerPreview,
  Editor: ImageEditor,
})
