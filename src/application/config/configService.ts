import type { Store } from '../../core/storage'
import { normalizeStyleConfig } from '../../domain/style/normalizeStyleConfig'
import { useGraphUiStore } from '../../stores/graphUiStore'

type AppConfig = Awaited<ReturnType<Store['readConfig']>>

export function hydrateGraphUiConfig(config: AppConfig): void {
  const styleConfig = normalizeStyleConfig(config)
  const graphUi = useGraphUiStore.getState()
  graphUi.replaceDefaultEdgeStyle(styleConfig.defaultEdgeStyle)
  graphUi.replaceDefaultNodeStyle(styleConfig.defaultNodeStyle)
  graphUi.replaceDefaultNodeSize(styleConfig.defaultNodeSize)
  graphUi.replaceDefaultEditorStyle(styleConfig.defaultEditorStyle)
  graphUi.replaceNodeSizeLimits(styleConfig.nodeSizeLimits)
  graphUi.setNodeBadgeSize(styleConfig.nodeBadgeSize)
}
