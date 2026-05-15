import { memo, useCallback, useEffect, useState } from 'react'
import { Background, Position, ReactFlow, getSmoothStepPath, useReactFlow, type BackgroundVariant, type ConnectionLineComponentProps, type Edge, type Node, type NodeTypes, type Viewport } from '@xyflow/react'
import { useGraphUiStore } from '../../stores/graphUiStore'
import { useGraphContext } from '../../contexts/GraphContext'
import { useGraphStore } from '../../stores/graphStore'
import type { KnowledgeNode } from '../../types'
import KnowledgeCard from './nodes/KnowledgeCard'
import FloatingEdge from './edges/FloatingEdge'
import Toolbar from '../Toolbar/Toolbar'

const nodeTypes = { knowledgeCard: KnowledgeCard }
const edgeTypes = {
  smoothstep: FloatingEdge,
  straight: FloatingEdge,
}

const CARD_CONNECT_SNAP_DISTANCE = 56

function distanceToRect(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width))
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

function getPointPosition(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const distances = [
    { position: Position.Left, distance: Math.abs(point.x - rect.x) },
    { position: Position.Right, distance: Math.abs(point.x - right) },
    { position: Position.Top, distance: Math.abs(point.y - rect.y) },
    { position: Position.Bottom, distance: Math.abs(point.y - bottom) },
  ]
  return distances.reduce((best, current) => current.distance < best.distance ? current : best).position
}

function getClosestPointOnRect(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.min(Math.max(point.x, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(point.y, rect.y), rect.y + rect.height),
  }
}

function getRectIntersectionPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const intersections: Array<{ x: number; y: number; t: number }> = []
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height

  if (dx !== 0) {
    for (const x of [rect.x, right]) {
      const t = (x - from.x) / dx
      const y = from.y + t * dy
      if (t >= 0 && t <= 1 && y >= rect.y && y <= bottom) {
        intersections.push({ x, y, t })
      }
    }
  }

  if (dy !== 0) {
    for (const y of [rect.y, bottom]) {
      const t = (y - from.y) / dy
      const x = from.x + t * dx
      if (t >= 0 && t <= 1 && x >= rect.x && x <= right) {
        intersections.push({ x, y, t })
      }
    }
  }

  const intersection = intersections.sort((a, b) => b.t - a.t)[0]
  return intersection ?? getClosestPointOnRect(to, rect)
}

function CardSnappedConnectionLine({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  connectionLineStyle,
}: ConnectionLineComponentProps) {
  const connectingTargetId = useGraphUiStore((s) => s.connectingTargetId)
  const targetNode = useGraphStore((s) => connectingTargetId ? s.nodesMap.get(connectingTargetId) : null)
  const targetRect = targetNode ? {
    x: targetNode.position.x,
    y: targetNode.position.y,
    width: targetNode.width ?? targetNode.initialWidth ?? targetNode.measured?.width ?? 120,
    height: targetNode.height ?? targetNode.initialHeight ?? targetNode.measured?.height ?? 52,
  } : null
  const targetPoint = targetRect
    ? getRectIntersectionPoint({ x: fromX, y: fromY }, { x: toX, y: toY }, targetRect)
    : { x: toX, y: toY }
  const targetPosition = targetRect ? getPointPosition(targetPoint, targetRect) : Position.Left
  const [path] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    targetPosition,
    borderRadius: 16,
  })

  return <path fill="none" d={path} style={connectionLineStyle} strokeWidth={2} stroke="#3b82f6" />
}

interface GraphCanvasProps {
  onNodeContextMenu?: (nodeId: string, event: React.MouseEvent) => void
  onEdgeContextMenu?: (edgeId: string, event: React.MouseEvent) => void
  onPaneContextMenu?: (x: number, y: number) => void
  onCloseContextMenu?: () => void
}

export default memo(function GraphCanvas({
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
  onCloseContextMenu,
}: GraphCanvasProps) {
  const showGrid = useGraphUiStore((s) => s.showGrid)
  const connectingSourceId = useGraphUiStore((s) => s.connectingSourceId)
  const setConnectingTargetId = useGraphUiStore((s) => s.setConnectingTargetId)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const storedViewport = useGraphStore((s) => s.viewport)
  const setStoredViewport = useGraphStore((s) => s.setViewport)
  const [zoomLevel, setZoomLevel] = useState(1)
  const reactFlow = useReactFlow()
  const graph = useGraphContext()
  const handlePaneClick = () => {
    onCloseContextMenu?.()
    graph.onPaneClick()
  }

  const handleViewportChange = useCallback((viewport: Viewport) => {
    setZoomLevel(viewport.zoom)
  }, [])

  useEffect(() => {
    setZoomLevel(storedViewport.zoom)
  }, [storedViewport.zoom])

  useEffect(() => {
    const currentViewport = reactFlow.getViewport()
    const viewportChanged =
      Math.abs(currentViewport.x - storedViewport.x) > 0.5 ||
      Math.abs(currentViewport.y - storedViewport.y) > 0.5 ||
      Math.abs(currentViewport.zoom - storedViewport.zoom) > 0.001

    if (!viewportChanged) return

    const frame = requestAnimationFrame(() => {
      reactFlow.setViewport(storedViewport, { duration: 0 })
    })

    return () => cancelAnimationFrame(frame)
  }, [reactFlow, storedViewport])

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    graph.onNodeContextMenu(event, node as KnowledgeNode)
    onNodeContextMenu?.(node.id, event)
  }, [graph, onNodeContextMenu])

  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    graph.onEdgeClick(event, edge)
  }, [graph])

  const handleEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    graph.onEdgeClick(event, edge)
    onEdgeContextMenu?.(edge.id, event)
  }, [graph, onEdgeContextMenu])

  const handlePaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onPaneContextMenu?.(event.clientX, event.clientY)
  }, [onPaneContextMenu])

  const handleConnectionMouseMove = useCallback((event: React.MouseEvent) => {
    if (!connectingSourceId) return
    const point = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    let nextTargetId: string | null = null
    let bestDistance = Infinity
    for (const node of nodes) {
      if (node.id === connectingSourceId) continue
      const width = node.width ?? node.initialWidth ?? node.measured?.width ?? 120
      const height = node.height ?? node.initialHeight ?? node.measured?.height ?? 52
      const distance = distanceToRect(point, {
        x: node.position.x,
        y: node.position.y,
        width,
        height,
      })
      if (distance <= CARD_CONNECT_SNAP_DISTANCE && distance < bestDistance) {
        bestDistance = distance
        nextTargetId = node.id
      }
    }
    if (useGraphUiStore.getState().connectingTargetId !== nextTargetId) {
      setConnectingTargetId(nextTargetId)
    }
  }, [connectingSourceId, nodes, reactFlow, setConnectingTargetId])

  const handleConnectionMouseLeave = useCallback(() => {
    if (!connectingSourceId) return
    setConnectingTargetId(null)
  }, [connectingSourceId, setConnectingTargetId])

  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onMouseMove={handleConnectionMouseMove}
      onMouseLeave={handleConnectionMouseLeave}
    >
      <ReactFlow
        nodes={nodes as Node[]}
        edges={edges}
        // 注册自定义节点的组件类型
        nodeTypes={nodeTypes as NodeTypes}
        edgeTypes={edgeTypes}

        // 拖动节点、选中节点、删除节点后的位置或状态更新
        onNodesChange={graph.onNodesChange}
        // 监听边变化。常见包括删除边、选中边等
        onEdgesChange={graph.onEdgesChange}

        // 当用户从一个节点拖出连线并成功连到另一个节点时触发
        onConnect={graph.onConnect}
        // 开始拖拽创建连线时触
        onConnectStart={graph.onConnectStart}
        // 结束拖拽连线时触发，不管最终有没有连上
        onConnectEnd={graph.onConnectEnd}
        // 连线吸附半径。离目标 handle 足够近时更容易连上，值越大越容易吸附
        connectionRadius={48}
        connectionLineComponent={CardSnappedConnectionLine}

        // 点击节点时触发
        onNodeClick={graph.onNodeClick as (event: React.MouseEvent, node: Node) => void}
        // 右键节点时触发，通常用来打开节点级右键菜单
        onNodeContextMenu={handleNodeContextMenu}
        // 点击边
        onEdgeClick={handleEdgeClick}
        // 点击画布空白区域触发
        onPaneClick={handlePaneClick}
        // 右键画布空白区域触发。使用 React Flow 原生 pane context menu 事件，不再额外监听 DOM。
        onPaneContextMenu={handlePaneContextMenu}
        // 右键边时触发
        onEdgeContextMenu={handleEdgeContextMenu}

        // 视图变化时触发，包括平移和缩放
        onMove={(_, viewport) => handleViewportChange(viewport)}
        onMoveEnd={(_, viewport) => setStoredViewport(viewport)}
        // 最小缩放倍数
        minZoom={0.15}
        defaultViewport={storedViewport}
        // 禁止双击放大
        zoomOnDoubleClick={false}
        // 允许滚轮缩放
        zoomOnScroll
        // 左键拖动画布平移
        panOnDrag={[0]}

        // 隐藏attribution标识
        proOptions={{ hideAttribution: true }}
        
        // 禁用默认的框选和多选快捷键
        selectionOnDrag={false}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}

        // 允许拖动节点
        nodesDraggable
        // 允许节点建立连线
        nodesConnectable
        // 允许节点和边被选中
        elementsSelectable
        // 选中节点时提升层级，避免被别的元素挡住
        elevateNodesOnSelect
        // 设置ReactFlow 容器尺寸，确保撑满父容器。
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
