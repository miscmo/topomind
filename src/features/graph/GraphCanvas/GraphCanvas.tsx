import { memo } from 'react'
import { Background, ReactFlow, type BackgroundVariant, type Node, type NodeTypes } from '@xyflow/react'
import type { KnowledgeNode } from '../../../types'
import KnowledgeCard from './nodes/KnowledgeCard'
import FloatingEdge from './edges/FloatingEdge'
import Toolbar from '../../layout/Toolbar/Toolbar'
import { SmartGuidesRenderer } from './SmartGuidesRenderer'
import { CardSnappedConnectionLine } from './components/CardSnappedConnectionLine'
import { useGraphCanvasModel, type UseGraphCanvasModelProps } from './model/useGraphCanvasModel'

const nodeTypes = { knowledgeCard: KnowledgeCard }
const edgeTypes = {
  smoothstep: FloatingEdge,
  straight: FloatingEdge,
}

export default memo(function GraphCanvas({
  tabId,
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
  onCloseContextMenu,
}: UseGraphCanvasModelProps) {
  const { state, graph, actions } = useGraphCanvasModel({
    tabId,
    onNodeContextMenu,
    onEdgeContextMenu,
    onPaneContextMenu,
    onCloseContextMenu,
  })

  const {
    showGrid,
    connectingSourceId,
    nodes,
    edges,
    storedViewport,
    zoomLevel,
    guideLines,
  } = state

  const {
    handleNodesChange,
    handlePaneClick,
    handleMove,
    handleMoveEnd,
    handleNodeContextMenu,
    handleEdgeClick,
    handleEdgeContextMenu,
    handlePaneContextMenu,
    handleConnectionMouseMove,
    handleConnectionMouseLeave,
  } = actions

  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onMouseMove={connectingSourceId ? handleConnectionMouseMove : undefined}
      onMouseLeave={connectingSourceId ? handleConnectionMouseLeave : undefined}
      data-shortcut-scope="canvas"
      tabIndex={-1}
    >
      <ReactFlow
        id={tabId}
        nodes={nodes as Node[]}
        edges={edges}
        nodeTypes={nodeTypes as NodeTypes}
        edgeTypes={edgeTypes}

        onNodesChange={handleNodesChange}
        onEdgesChange={graph.onEdgesChange}

        onConnect={graph.onConnect}
        onConnectStart={graph.onConnectStart}
        onConnectEnd={graph.onConnectEnd}
        connectionRadius={12}
        connectionLineComponent={CardSnappedConnectionLine}

        onNodeClick={graph.onNodeClick as (event: React.MouseEvent, node: Node) => void}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}

        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        minZoom={0.15}
        defaultViewport={storedViewport}
        zoomOnDoubleClick={false}
        zoomOnScroll
        panOnDrag={[0]}

        proOptions={{ hideAttribution: true }}
        
        snapToGrid={false}
        snapGrid={[20, 20]}

        selectionOnDrag={false}
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}

        nodesDraggable
        nodesConnectable
        elementsSelectable
        elevateNodesOnSelect
        style={{ width: '100%', height: '100%', background: 'var(--color-canvas-bg)' }}
      >
        <SmartGuidesRenderer guideLines={guideLines} />
        {showGrid && (
          <Background id={tabId} variant={'dots' as BackgroundVariant} gap={20} size={1} color="var(--color-canvas-grid)" />
        )}
      </ReactFlow>
      <Toolbar zoomLevel={zoomLevel} />
    </div>
  )
})
