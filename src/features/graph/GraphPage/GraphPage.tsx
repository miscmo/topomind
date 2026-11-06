/**
 * 图谱页面：两栏布局
 * React Flow 图谱 + 右侧详情和样式配置
 */
import { memo, useEffect } from 'react'
import { GraphContextProvider } from '../../../contexts/GraphContext'
import { useSelectedNodeId, useGraphStoreApi } from '../../../stores/graphStore'
import { registerGraphApi } from '../linkedDocumentStore'
import Breadcrumb from '../../layout/Breadcrumb/Breadcrumb'
import RoomHistory from '../../layout/RoomHistory/RoomHistory'
import { useLearningTrackerContextStore } from '../../learning-tracker/model/learningTrackerContextStore'
import RightPanelContainer from '../../right-panel/RightPanelContainer'
import GraphCanvas from '../GraphCanvas'
import GraphPageContextMenu from './components/GraphPageContextMenu'
import { NodeMoveToRoomDialog } from './components/NodeMoveToRoomDialog'
import { useGraphPageController } from './model/useGraphPageController'
import { useGraphPageActions } from './model/useGraphPageActions'
import { useShortcut } from '../../../hooks/useShortcut'
import { useTabStore } from '../../../stores/tabs/tabStore'
import { useRightPanelStore } from '@/stores/rightPanelStore'

interface GraphPageProps {
  tabId: string
  isActive?: boolean
}

export default memo(function GraphPage({ tabId, isActive = true }: GraphPageProps) {
  const { graph } = useGraphPageController({ tabId })
  const { canvasProps, contextMenuProps, moveDialogProps } = useGraphPageActions({ graph, tabId })
  const selectedNodeId = useSelectedNodeId()
  const graphStoreApi = useGraphStoreApi()

  // 关联对话框挂在 App 根（全局唯一实例），保存后需要把结果广播回各标签页的画布内存。
  useEffect(() => registerGraphApi(graphStoreApi), [graphStoreApi])
  const setSelectedNodeIdForTab = useLearningTrackerContextStore((s) => s.setSelectedNodeIdForTab)
  const clearTabContext = useLearningTrackerContextStore((s) => s.clearTabContext)
  const activeTabId = useTabStore((s) => s.activeTabId)

  useShortcut(['Control+Tab', 'Meta+Tab'], (event) => {
    if (activeTabId !== tabId) return
    event.preventDefault()
    const { rightPanelCollapsed, collapseRightPanel, expandRightPanel } = useRightPanelStore.getState()
    if (rightPanelCollapsed) {
      expandRightPanel()
    } else {
      collapseRightPanel()
    }
  }, { scope: 'global', preventDefault: true })

  useEffect(() => {
    setSelectedNodeIdForTab(tabId, selectedNodeId)
  }, [tabId, selectedNodeId, setSelectedNodeIdForTab])

  useEffect(() => {
    return () => {
      clearTabContext(tabId)
    }
  }, [tabId, clearTabContext])

  return (
    <GraphContextProvider graph={graph}>
      {/* overflow-clip 而非 hidden：这两层外壳只负责裁剪，**必须不可滚动**。
          它们被程序化滚动时（scrollIntoView/focus 会沿祖先链带动 hidden 容器），
          图谱 + 右栏 + 编辑器状态栏会作为整体上移、底部露白且无法滚回。 */}
      <div id="graph-page" className="w-full h-full overflow-clip bg-[var(--color-canvas-bg)] pt-0">
        <div id="app-layout" className="flex w-full h-full relative">
          <div id="graph-panel" className="flex-1 h-full relative overflow-clip bg-[var(--color-canvas-bg)]">
            <div className="absolute top-3 left-3 z-[11] flex flex-col items-start gap-2 max-w-[min(560px,calc(100%-24px))]">
              <Breadcrumb tabId={tabId} />
              <RoomHistory tabId={tabId} />
            </div>

            {isActive ? (
              <GraphCanvas tabId={tabId} {...canvasProps} />
            ) : (
              <div className="h-full w-full bg-[var(--color-canvas-bg)]" aria-hidden="true" />
            )}
          </div>
          <RightPanelContainer tabId={tabId} isActive={isActive} />
        </div>
        <GraphPageContextMenu {...contextMenuProps} />
        {moveDialogProps.moveState && (
          <NodeMoveToRoomDialog
            nodeIds={moveDialogProps.moveState.nodeIds}
            sourceRoomPath={moveDialogProps.moveState.sourceRoomPath}
            kbPath={moveDialogProps.moveState.kbPath}
            onConfirm={moveDialogProps.handleMoveNodesToRoom}
            onClose={moveDialogProps.closeMoveToRoom}
          />
        )}
      </div>
    </GraphContextProvider>
  )
})
