/**
 * 容器渲染器静态装配点（v1 不走插件系统）。
 *
 * 新增一种容器只需在这里加一行注册 + 一个 spec：外层关系树、选中、LOD、
 * 从属校验、生命周期搬运全部零改动。Editor 必须 lazy，主 chunk 不含 Excalidraw。
 */
import { lazy } from 'react'
import { registerContainerRenderer } from './containerRenderers'
import { ContainerSvgPreview } from './ContainerSvgPreview'
import { EXCALIDRAW_CONTAINER_TYPE } from '../../../documents/ExcalidrawDocument/excalidrawDocumentTypes'
import './excalidrawContainerType'

const ExcalidrawEditor = lazy(() => import('./ExcalidrawContainerEditor').then(m => ({
  default: m.ExcalidrawContainerEditor,
})))

registerContainerRenderer({
  type: EXCALIDRAW_CONTAINER_TYPE,
  Preview: ContainerSvgPreview,
  Editor: ExcalidrawEditor,
  // 显示比不足 100% 时只给预览：手绘线条在缩小状态下不可读，也避免误触编辑。
  // 100% 对应 raw zoom 0.65（ZOOM_REFERENCE），不是 1。
  minEditDisplayPercent: 100,
})
