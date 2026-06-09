/**
 * 图谱页面：两栏布局
 * React Flow 图谱 + 右侧详情和样式配置
 */
import { memo, useCallback, useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import { GraphContextProvider } from '../../../contexts/GraphContext'
import { GraphStoreProvider, useSelectedNodeId } from '../../../stores/graphStore'
import Breadcrumb from '../../layout/Breadcrumb/Breadcrumb'
import { useLearningTrackerContextStore } from '../../learning-tracker/model/learningTrackerContextStore'
import RightPanelContainer from '../../right-panel/RightPanelContainer'
import GraphCanvas from '../GraphCanvas'
import { CardTrashDialog } from './components/CardTrashDialog'
import GraphPageContextMenu from './components/GraphPageContextMenu'
import { useGraphPageController } from './model/useGraphPageController'
import { useGraphPageActions } from './model/useGraphPageActions'
import { useWorkspaceStore } from '../../../stores/workspaceStore'

interface GraphPageProps {
  tabId: string
}

const GraphPageContent = memo(function GraphPageContent({ tabId }: GraphPageProps) {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const readOnly = Boolean(currentWorkspaceId)
  const allowPaneCreateWhenReadOnly = Boolean(currentWorkspaceId)
  const allowNodeMenuWhenReadOnly = Boolean(currentWorkspaceId)
  const allowLayoutWhenReadOnly = Boolean(currentWorkspaceId)
  const allowEdgeWriteWhenReadOnly = Boolean(currentWorkspaceId)
  const { graphSession, graph } = useGraphPageController({ tabId })
  const { canvasProps, contextMenuProps } = useGraphPageActions({
    graph,
    readOnly,
    allowPaneCreateWhenReadOnly,
    allowNodeMenuWhenReadOnly,
    allowLayoutWhenReadOnly,
    allowEdgeWriteWhenReadOnly,
  })
  const selectedNodeId = useSelectedNodeId()
  const setSelectedNodeIdForTab = useLearningTrackerContextStore((s) => s.setSelectedNodeIdForTab)
  const clearTabContext = useLearningTrackerContextStore((s) => s.clearTabContext)
  const [cardTrashVisible, setCardTrashVisible] = useState(false)
  const currentRoomRef = graphSession.roomRef || ''
  const currentKbId = graphSession.kbId || null

  const refreshGraph = useCallback(async () => {
    if (!currentRoomRef) return
    await graph.loadRoom(currentRoomRef)
  }, [currentRoomRef, graph])

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
      <div id="graph-page" className="w-full h-full overflow-hidden bg-[var(--color-canvas-bg)] pt-0">
        <div id="app-layout" className="flex w-full h-full relative">
          <div id="graph-panel" className="flex-1 h-full relative overflow-hidden bg-[var(--color-canvas-bg)]">
            <Breadcrumb tabId={tabId} />
            {readOnly && (
              <div className="absolute left-3 right-3 top-16 z-[12] flex items-start justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--titlebar-menu-bg)] px-4 py-3 text-[12px] text-[var(--color-text-secondary)] shadow-[var(--shadow-md)] backdrop-blur-xl">
                <div className="min-w-0 flex-1">
                  当前图谱页仍以 LocalDB 镜像为主。已支持节点标题改名、画布右键新建节点、节点右键删除/重命名/样式编辑/清除样式、节点回收站恢复/清空、连线创建/关系编辑/删除/样式编辑/清除样式、节点拖拽与视口布局本地写回，以及右侧文档内容本地编辑；节点回收站清空当前按整棵已删除子树语义收敛。
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setCardTrashVisible(true)}
                  disabled={!currentKbId}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  节点回收站
                </button>
              </div>
            )}

            <GraphCanvas tabId={tabId} {...canvasProps} />
          </div>
          <RightPanelContainer tabId={tabId} readOnly={false} />
        </div>
        {(!readOnly || allowPaneCreateWhenReadOnly || allowNodeMenuWhenReadOnly || allowEdgeWriteWhenReadOnly) && (
          <GraphPageContextMenu {...contextMenuProps} />
        )}
        <CardTrashDialog
          visible={cardTrashVisible}
          workspaceId={currentWorkspaceId}
          kbId={currentKbId}
          onClose={() => setCardTrashVisible(false)}
          refreshGraph={refreshGraph}
        />
      </div>
    </GraphContextProvider>
  )
})

export default memo(function GraphPage({ tabId }: GraphPageProps) {
  return (
    <GraphStoreProvider>
      <ReactFlowProvider>
        <GraphPageContent tabId={tabId} />
      </ReactFlowProvider>
    </GraphStoreProvider>
  )
})
