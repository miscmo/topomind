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
        // 注册自定义节点的组件类型
        nodeTypes={nodeTypes as NodeTypes}

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

        // 点击节点时触发
        onNodeClick={graph.onNodeClick as (event: React.MouseEvent, node: Node) => void}
        onNodeDoubleClick={graph.onNodeDoubleClick as (event: React.MouseEvent, node: Node) => void}
        // 右键节点时触发，通常用来打开节点级右键菜单
        onNodeContextMenu={handleNodeContextMenu}
        // 点击边
        onEdgeClick={handleEdgeClick}
        // 点击画布空白区域触发
        onPaneClick={handlePaneClick}
        // 右键边时触发
        onEdgeContextMenu={handleEdgeContextMenu}

        // 视图变化时触发，包括平移和缩放
        onMove={(_, viewport) => handleViewportChange(viewport)}
        // 最小缩放倍数
        minZoom={0.15}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        // 禁止双击放大
        zoomOnDoubleClick={false}
        // 允许滚轮缩放
        zoomOnScroll
        // 右键拖动画布平移
        panOnDrag={[2]}

        // 隐藏attribution标识
        proOptions={{ hideAttribution: true }}
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
