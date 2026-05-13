import { memo, useCallback, useRef, useState } from 'react'
import { Background, ReactFlow, type BackgroundVariant, type Edge, type Node, type NodeTypes, type Viewport } from '@xyflow/react'
import { useGraphUiStore } from '../../stores/graphUiStore'
import { useGraphContext } from '../../contexts/GraphContext'
import { useContextMenu } from '../../hooks/useContextMenu'
import type { KnowledgeNode } from '../../types'
import KnowledgeCard from './nodes/KnowledgeCard'
import Toolbar from '../Toolbar/Toolbar'
import { usePaneContextMenu } from './usePaneContextMenu'

const nodeTypes = { knowledgeCard: KnowledgeCard }

interface GraphCanvasProps {
  onEdgeContextMenu?: (edgeId: string, event: React.MouseEvent) => void
}

export default memo(function GraphCanvas({ onEdgeContextMenu }: GraphCanvasProps) {
  const showGrid = useGraphUiStore((s) => s.showGrid)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [zoomLevel, setZoomLevel] = useState(1)
  const graph = useGraphContext()
  const { openNodeMenu, openEdgeMenu } = useContextMenu()
  const { handlePaneClick } = usePaneContextMenu({ canvasRef, onPaneClick: graph.onPaneClick })

  const handleViewportChange = useCallback((viewport: Viewport) => {
    setZoomLevel(viewport.zoom)
  }, [])

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    graph.onNodeContextMenu(event, node as KnowledgeNode)
    openNodeMenu(node.id, event)
  }, [graph, openNodeMenu])

  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    graph.onEdgeClick(event, edge)
  }, [graph])

  const handleEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    onEdgeContextMenu?.(edge.id, event)
    openEdgeMenu(edge.id, event)
  }, [onEdgeContextMenu, openEdgeMenu])

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
        onNodeClick={graph.onNodeClick as (event: React.MouseEvent, node: Node) => void}
        onNodeDoubleClick={graph.onNodeDoubleClick as (event: React.MouseEvent, node: Node) => void}
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
