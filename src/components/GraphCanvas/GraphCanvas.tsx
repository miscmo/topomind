import { memo, useRef } from 'react'
import { Background, ReactFlow, type BackgroundVariant, type Node, type NodeTypes } from '@xyflow/react'
import { useAppStore } from '../../stores/appStore'
import KnowledgeCard from './nodes/KnowledgeCard'
import Toolbar from '../Toolbar/Toolbar'
import { useGraphCanvasEvents } from './useGraphCanvasEvents'
import { usePaneContextMenu } from './usePaneContextMenu'
import { useViewportLogger } from './useViewportLogger'

const nodeTypes = { knowledgeCard: KnowledgeCard }

interface GraphCanvasProps {
  onEdgeContextMenu?: (edgeId: string, event: React.MouseEvent) => void
}

export default memo(function GraphCanvas({ onEdgeContextMenu }: GraphCanvasProps) {
  const showGrid = useAppStore((s) => s.showGrid)
  const canvasRef = useRef<HTMLDivElement>(null)
  const { zoomLevel, handleViewportChange } = useViewportLogger()
  const {
    graph,
    handleNodeClick,
    handleNodeDoubleClick,
    handleNodeContextMenu,
    handleEdgeClick,
    handleEdgeContextMenu,
  } = useGraphCanvasEvents({ onEdgeContextMenu })
  const { handlePaneClick } = usePaneContextMenu({ canvasRef, onPaneClick: graph.onPaneClick })

  return (
    <div ref={canvasRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={graph.nodes as Node[]}
        edges={graph.edges}
        nodeTypes={nodeTypes as NodeTypes}
        onNodesChange={graph.onNodesChange}
        onEdgesChange={graph.onEdgesChange}
        onConnect={graph.onConnect}
        onConnectStart={graph.onConnectStart}
        onConnectEnd={graph.onConnectEnd}
        connectionRadius={48}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onEdgeContextMenu={handleEdgeContextMenu}
        onMove={(_, viewport) => handleViewportChange(viewport)}
        minZoom={0.15}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        zoomOnDoubleClick={false}
        zoomOnScroll
        panOnDrag={[2]}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        style={{ width: '100%', height: '100%' }}
      >
        {showGrid && (
          <Background variant={'dots' as BackgroundVariant} gap={20} size={1} color="#c8cdd6" />
        )}
      </ReactFlow>
      <Toolbar zoomLevel={zoomLevel} />
    </div>
  )
})
