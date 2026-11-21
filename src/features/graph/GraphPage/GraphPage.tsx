/**
 * 图谱页面：铺满的 React Flow 图谱 + 贴在右边缘的详情/样式浮层
 */
import { memo, useEffect } from 'react'
import { GraphContextProvider } from '../../../contexts/GraphContext'
import { useSelectedNodeId, useGraphStoreApi } from '../../../stores/graphStore'
import { registerGraphApi } from '../linkedDocumentStore'
import { useLearningTrackerContextStore } from '../../learning-tracker/model/learningTrackerContextStore'
import RightPanelContainer from '../../right-panel/RightPanelContainer'
import GraphCanvas from '../GraphCanvas'
import { ContainerFullscreenEditorHost } from '../GraphCanvas/containers/ContainerFullscreenEditorHost'
import GraphPageContextMenu from './components/GraphPageContextMenu'
import NodeTreePanel from './components/NodeTreePanel'
import { NodeMoveToRoomDialog } from './components/NodeMoveToRoomDialog'
import RoomOverview from './components/RoomOverview'
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
        {/* 【右栏浮层 2026-11-12】这里刻意不做 flex 两栏：
            右栏一旦参与 flex，展开/折叠就会改变 #graph-panel 的宽度，React Flow 容器尺寸、
            全部 Panel（top-left / top-center / bottom-left / bottom-center）的定位，以及
            缩略图视口框（canvasSize / zoom）都会跟着重算，体验上就是「控件被挤走」。
            画布绝对铺满、isolate 自成一层，右栏绝对贴右盖在它上面：
            画布对右栏状态完全无感知，宽度与 viewport 恒定不变。 */}
        <div id="app-layout" className="relative w-full h-full">
          <div id="graph-panel" className="absolute inset-0 isolate overflow-clip bg-[var(--color-canvas-bg)]">
            {/* 房间路径 / 最近打开 / 镜头状态全部融合进 GraphCanvas 的画布状态抽屉，
                这里不再叠一层绝对定位组件，避免与 top-left Panel 互相遮挡。 */}

            {isActive ? (
              <GraphCanvas tabId={tabId} {...canvasProps} />
            ) : (
              <div className="h-full w-full bg-[var(--color-canvas-bg)]" aria-hidden="true" />
            )}
            {isActive && <RoomOverview tabId={tabId} />}
          </div>
          <RightPanelContainer tabId={tabId} isActive={isActive} />
          {/* 【左侧节点树 2026-11-13】同样是 absolute 浮层：
              不参与 flex 两栏，展开/折叠不改变 #graph-panel 宽度、Panel 定位或缩略图视口框。 */}
          <NodeTreePanel tabId={tabId} isActive={isActive} />
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
        {/* v1.4 全屏编辑：与 GraphCanvas 同级（不是它的后代），React 事件不会回流到画布。
            组件内部 portal 到 document.body，彻底脱离 .react-flow__viewport 的 transform。 */}
        <ContainerFullscreenEditorHost tabId={tabId} isActive={isActive} />
      </div>
    </GraphContextProvider>
  )
})
