/**
 * 图谱页面：两栏布局
 * React Flow 图谱 + 右侧详情和样式配置
 */
import { memo, useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useGraphPageController } from '../hooks/useGraphPageController'
import { getNavStateForTab } from '../hooks/useNavContext'
import { useNodeActions } from '../hooks/useNodeActions'
import { useContextMenu } from '../hooks/useContextMenu'
import { useKeyboard } from '../hooks/useKeyboard'
import { GraphContextProvider } from '../contexts/GraphContext'
import Breadcrumb from './Breadcrumb/Breadcrumb'
import RightPanelContainer, { useRightPanelActions } from './RightPanel/RightPanelContainer'
import GraphCanvas from './GraphCanvas'
import ContextMenu from './ContextMenu/ContextMenu'
import styles from './GraphPage.module.css'

interface GraphPageProps {
  tabId: string
}

export default memo(function GraphPage({ tabId }: GraphPageProps) {
  const { nav, graph } = useGraphPageController({ tabId })
  const { screenToFlowPosition } = useReactFlow()
  const { openEdgeStylePanel } = useRightPanelActions()
  const { contextMenu, hideCM } = useContextMenu()
  const { 
    deleteSelectedNode, addChildNode, handleNewChild, handleRename, 
    handleDelete, handleEdgeDelete, handleEdgeStyle, handleFocus, 
    handleProperties 
  } = useNodeActions({ graph })

  const handleContextMenuNewChild = useCallback((nodeId: string, position?: { x: number; y: number }) => {
    const flowPosition = position ? screenToFlowPosition(position) : undefined
    handleNewChild(nodeId, flowPosition)
  }, [handleNewChild, screenToFlowPosition])

  useKeyboard({
    tabId,
    onDelete: () => {
      const { selectedNodeId } = getNavStateForTab(tabId)
      if (!selectedNodeId) return
      deleteSelectedNode(selectedNodeId)
    },
    onAddChild: (parentId: string) => {
      addChildNode(parentId)
    },
  })

  return (
    <GraphContextProvider graph={graph}>
      <div id="graph-page" className={styles.page}>
        <div id="app-layout" className={styles.layout}>
          <div id="graph-panel" className={styles.graphPanel}>
            <Breadcrumb tabId={tabId} />

            <GraphCanvas
              tabId={tabId}
              onEdgeContextMenu={openEdgeStylePanel}
            />
          </div>
          <RightPanelContainer selectedNodeId={nav.selectedNodeId} tabId={tabId} />
        </div>
        <ContextMenu
          visible={contextMenu.visible}
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          targetId={contextMenu.targetId}
          onNewChild={handleContextMenuNewChild}
          onRename={handleRename}
          onDelete={handleDelete}
          onEdgeDelete={handleEdgeDelete}
          onEdgeStyle={handleEdgeStyle}
          onFocus={handleFocus}
          onProperties={handleProperties}
          onClose={hideCM}
        />
      </div>
    </GraphContextProvider>
  )
})
