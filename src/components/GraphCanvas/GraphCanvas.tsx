import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Background, ReactFlow, type BackgroundVariant, type Node, type NodeTypes } from '@xyflow/react'
import { useAppStore } from '../../stores/appStore'
import { useContextMenu } from '../../hooks/useContextMenu'
import { useDoubleClick } from '../../hooks/useDoubleClick'
import { useGraphContext } from '../../contexts/GraphContext'
import KnowledgeCard from './nodes/KnowledgeCard'
import Toolbar from '../Toolbar/Toolbar'
import type { KnowledgeNode } from '../../types'
import { logAction } from '../../core/log-backend'

const nodeTypes = { knowledgeCard: KnowledgeCard }
const RIGHT_DRAG_THRESHOLD = 6

interface GraphCanvasProps {
  onEdgeContextMenu?: (edgeId: string, event: React.MouseEvent) => void
  tabId: string
}

export default memo(function GraphCanvas({ onEdgeContextMenu, tabId }: GraphCanvasProps) {
  const showGrid = useAppStore((s) => s.showGrid)
  const showContextMenu = useAppStore((s) => s.showContextMenu)
  const graph = useGraphContext()
  const { showCM, hideCM } = useContextMenu()
  const [zoomLevel, setZoomLevel] = useState(1)
  const lastLogTimeRef = useRef<number>(0)
  const canvasRef = useRef<HTMLDivElement>(null)
  const rightMouseDownRef = useRef<{ x: number; y: number } | null>(null)
  const suppressNextPaneContextMenuRef = useRef(false)

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

  const isPaneTarget = useCallback((target: EventTarget | null) => {
    const el = target instanceof Element ? target : null
    if (!el) return false
    if (el.closest('.react-flow__node, .react-flow__edge, .react-flow__handle')) return false
    return !!canvasRef.current?.contains(el)
  }, [])

  const openPaneContextMenu = useCallback((x: number, y: number) => {
    logAction('右键菜单:显示', 'GraphCanvas', { type: 'pane', x, y })
    showContextMenu(x, y, 'pane', '__pane__')
  }, [showContextMenu])

  useEffect(() => {
    const root = canvasRef.current
    if (!root) return

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 2 || !isPaneTarget(e.target)) return
      rightMouseDownRef.current = { x: e.clientX, y: e.clientY }
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 2) return
      const start = rightMouseDownRef.current
      rightMouseDownRef.current = null
      if (!start) return

      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (moved > RIGHT_DRAG_THRESHOLD) {
        suppressNextPaneContextMenuRef.current = true
        return
      }

      e.preventDefault()
      e.stopPropagation()
      suppressNextPaneContextMenuRef.current = true
      openPaneContextMenu(e.clientX, e.clientY)
    }

    const handleContextMenu = (e: MouseEvent) => {
      if (!isPaneTarget(e.target)) return

      e.preventDefault()
      e.stopPropagation()

      if (suppressNextPaneContextMenuRef.current) {
        suppressNextPaneContextMenuRef.current = false
        return
      }

      const start = rightMouseDownRef.current
      rightMouseDownRef.current = null
      if (!start) return

      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (moved > RIGHT_DRAG_THRESHOLD) return

      openPaneContextMenu(e.clientX, e.clientY)
    }

    root.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('mouseup', handleMouseUp, true)
    root.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      root.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
      root.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [isPaneTarget, openPaneContextMenu])

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
    </div>
  )
})
