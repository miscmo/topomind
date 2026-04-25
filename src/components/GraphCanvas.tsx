import { memo, useCallback, useRef, useState } from 'react'
import { Background, ReactFlow, type BackgroundVariant, type Node, type NodeTypes } from '@xyflow/react'
import { useAppStore } from '../stores/appStore'
import { useContextMenu } from '../hooks/useContextMenu'
import { useDoubleClick } from '../hooks/useDoubleClick'
import { useGraphContext } from '../contexts/GraphContext'
import KnowledgeCard from '../nodes/KnowledgeCard'
import Toolbar from './Toolbar/Toolbar'
import type { KnowledgeNode } from '../types'
import { logAction } from '../core/log-backend'

const nodeTypes = { knowledgeCard: KnowledgeCard }

interface GraphCanvasProps {
  onEdgeContextMenu?: (edgeId: string, event: React.MouseEvent) => void
}

export default memo(function GraphCanvas({ onEdgeContextMenu }: GraphCanvasProps) {
  const showGrid = useAppStore((s) => s.showGrid)
  const graph = useGraphContext()
  const { showCM, hideCM } = useContextMenu()
  const [zoomLevel, setZoomLevel] = useState(1)
  const lastLogTimeRef = useRef<number>(0)

  const logViewportChange = useCallback((viewport: { zoom: number; x: number; y: number }) => {
    setZoomLevel(viewport.zoom)
    const now = Date.now()
    if (now - lastLogTimeRef.current > 2000) {
      lastLogTimeRef.current = now
      logAction('视图:移动', 'GraphPage', {
        zoom: viewport.zoom,
        x: Math.round(viewport.x),
        y: Math.round(viewport.y),
      })
    }
  }, [])

  const { handleClick: handlePaneClick } = useDoubleClick({
    onClick: () => hideCM(),
    onDoubleClick: () => useAppStore.getState().clearSelection(),
    onSingleClick: () => useAppStore.getState().clearSelection(),
  })

  return (
    <>
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
        onNodeClick={graph.onNodeClick as (e: React.MouseEvent, node: Node) => void}
        onNodeDoubleClick={graph.onNodeDoubleClick as (e: React.MouseEvent, node: Node) => void}
        onNodeContextMenu={(e, node) => {
          if (node) {
            graph.onNodeContextMenu(e, node as KnowledgeNode)
            showCM(node.id, e)
          }
        }}
        onEdgeClick={(e, edge) => {
          if (edge) graph.onEdgeClick(e, edge)
        }}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={(e) => showCM('', e)}
        onEdgeContextMenu={(e, edge) => {
          if (edge) {
            onEdgeContextMenu?.(edge.id, e)
            showCM(edge.id, e)
          }
        }}
        onMove={(_, viewport) => logViewportChange(viewport)}
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
    </>
  )
})
