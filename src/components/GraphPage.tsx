/**
 * 图谱页面：三栏布局
 * 左侧面板 + 中间 React Flow 图谱 + 右侧详情面板
 */
import { useEffect, useRef, useState } from 'react'
import { ReactFlow, type Node, type NodeTypes, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAppStore } from '../stores/appStore'
import { useRoomStore } from '../stores/roomStore'
import { useGraph } from '../hooks/useGraph'
import { useContextMenu } from '../hooks/useContextMenu'
import { useKeyboard } from '../hooks/useKeyboard'
import { GraphContextProvider, useGraphContext } from '../contexts/GraphContext'
import KnowledgeCard from '../nodes/KnowledgeCard'
import NavTree from './NavTree/NavTree'
import Toolbar from './Toolbar/Toolbar'
import SearchBar from './SearchBar/SearchBar'
import DetailPanel from './DetailPanel/DetailPanel'
import Breadcrumb from './Breadcrumb/Breadcrumb'
import ContextMenu from './ContextMenu/ContextMenu'
import GitPanel from './GitPanel/GitPanel'
import { Background, type BackgroundVariant } from '@xyflow/react'
import { logAction } from '../core/log-backend'
import styles from './GraphPage.module.css'

const nodeTypes = { knowledgeCard: KnowledgeCard }

/** Inner component that uses shared graph context */
function GraphCanvas() {
  const showGrid = useAppStore((s) => s.showGrid)
  const graph = useGraphContext()
  const { showCM, showEdgeCM } = useContextMenu()
  const [zoomLevel, setZoomLevel] = useState(1)

  // Double-click detection: track click timing/position via onPaneClick
  const lastPaneClickRef = useRef<{ time: number; x: number; y: number } | null>(null)

  const handlePaneClick = (event: React.MouseEvent) => {
    const now = Date.now()
    const { clientX, clientY } = event

    if (lastPaneClickRef.current) {
      const elapsed = now - lastPaneClickRef.current.time
      const dx = Math.abs(clientX - lastPaneClickRef.current.x)
      const dy = Math.abs(clientY - lastPaneClickRef.current.y)
      if (elapsed < 400 && dx < 10 && dy < 10) {
        // Double-click on empty canvas: create new top-level node
        lastPaneClickRef.current = null
        const name = window.prompt('请输入新节点名称：')
        if (!name?.trim()) return
        logAction('节点:创建', 'GraphPage', { nodeName: name.trim(), source: 'double-click-canvas' })
        graph.createChildNode(name.trim())
        return
      }
    }

    lastPaneClickRef.current = { time: now, x: clientX, y: clientY }
    graph.onPaneClick(event)
  }

  return (
    <>
      <ReactFlow
        nodes={graph.nodes as Node[]}
        edges={graph.edges}
        nodeTypes={nodeTypes as NodeTypes}
        onNodesChange={graph.onNodesChange}
        onEdgesChange={graph.onEdgesChange}
        onConnect={graph.onConnect}
        onNodeClick={graph.onNodeClick}
        onNodeDoubleClick={graph.onNodeDoubleClick}
        onNodeContextMenu={(e, node) => {
          if (node) {
            graph.onNodeContextMenu(e, node)
            showCM(node.id, e)
          }
        }}
        onPaneClick={handlePaneClick}
        onEdgeContextMenu={(e, edge) => {
          if (edge) {
            showEdgeCM(edge.id, e)
          }
        }}
        onMove={(_, viewport) => setZoomLevel(viewport.zoom)}
        minZoom={0.15}
        maxZoom={3.5}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable
        elementsSelectable
      >
        {showGrid && (
          <Background
            variant={'dots' as BackgroundVariant}
            gap={20}
            size={1}
            color="#c8cdd6"
          />
        )}
      </ReactFlow>

      {/* 工具栏 */}
      <Toolbar />

      {/* 缩放指示器 */}
      <div id="zoom-indicator" className={styles.zoomIndicator}>{Math.round(zoomLevel * 100)}%</div>
    </>
  )
}

export default function GraphPage() {
  const view = useAppStore((s) => s.view)
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const rightPanelCollapsed = useAppStore((s) => s.rightPanelCollapsed)
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth)
  const currentRoomPath = useRoomStore((s) => s.currentRoomPath)
  const searchQuery = useAppStore((s) => s.searchQuery)

  const prevRoomPathRef = useRef<string | null>(null)

  const selectNode = useAppStore((s) => s.selectNode)

  // Context menu
  const { contextMenu, showEdgeCM, hideCM } = useContextMenu()
  const { fitView } = useReactFlow()

  // Single useGraph instance — passed to GraphContextProvider for sharing
  const graph = useGraph()

  // Load room when room path changes
  useEffect(() => {
    if (prevRoomPathRef.current !== currentRoomPath) {
      prevRoomPathRef.current = currentRoomPath
      graph.loadRoom(currentRoomPath || '')
    }
  }, [currentRoomPath, graph])

  // Highlight search matches
  useEffect(() => {
    graph.highlightSearch(searchQuery)
  }, [searchQuery, graph.highlightSearch])

  // Keyboard shortcuts
  useKeyboard({
    onDelete: () => {
      if (!selectedNodeId) return
      const node = graph.nodes.find((n) => n.id === selectedNodeId)
      if (!node) return
      if (!window.confirm(`确定要删除 "${node.data.label}" 吗？`)) return
      graph.deleteChildNode(selectedNodeId)
    },
    onAddChild: (parentId: string) => {
      const name = window.prompt('请输入新节点名称：')
      if (!name?.trim()) return
      logAction('节点:创建', 'GraphPage', { parentId, nodeName: name.trim(), source: 'keyboard-tab' })
      graph.createChildNode(name.trim(), parentId)
    },
  })

  // Context menu handlers
  const handleNewChild = (nodeId: string) => {
    const name = window.prompt('请输入新节点名称：')
    if (!name?.trim()) return
    logAction('节点:创建', 'GraphPage', { nodeId, nodeName: name.trim(), source: 'context-menu' })
    graph.createChildNode(name.trim(), nodeId)
  }

  const handleRename = (nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const newName = window.prompt('请输入新名称：', node.data.label)
    if (!newName?.trim() || newName === node.data.label) return
    logAction('节点:重命名', 'GraphPage', { nodeId, oldName: node.data.label, newName: newName.trim(), source: 'context-menu' })
    graph.renameNode(nodeId, newName.trim())
  }

  const handleDelete = (nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    if (!window.confirm(`确定要删除 "${node.data.label}" 吗？`)) return
    logAction('节点:删除', 'GraphPage', { nodeId, label: node.data.label, path: node.data.path, source: 'context-menu' })
    graph.deleteChildNode(nodeId)
  }

  const handleEdgeDelete = (edgeId: string) => {
    const edge = graph.edges.find((e) => e.id === edgeId)
    logAction('连线:删除', 'GraphPage', { edgeId, edgeSource: edge?.source, edgeTarget: edge?.target, trigger: 'context-menu' })
    graph.deleteEdge(edgeId)
  }

  const handleFocus = (nodeId: string) => {
    selectNode(nodeId)
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (node) {
      fitView({ nodes: [node], padding: 0.3, duration: 300 })
    }
    logAction('节点:聚焦', 'GraphPage', { nodeId })
  }

  const handleProperties = (nodeId: string) => {
    selectNode(nodeId)
    logAction('节点:属性', 'GraphPage', { nodeId })
  }

  if (view !== 'graph') return null

  return (
    <GraphContextProvider graph={graph}>
      <div id="graph-page" className={styles.page}>
        <div id="app-layout" className={styles.layout}>
          {/* 左侧面板 */}
          <div className={styles.leftPanel}>
            <NavTree />
          </div>

          {/* 中间图谱 */}
          <div id="graph-panel" className={styles.graphPanel}>
            {/* 标题 */}
            <div id="header" className={styles.header}>TopoMind</div>

            {/* 面包屑 */}
            <Breadcrumb />

            {/* 搜索 */}
            <SearchBar />

            <GraphCanvas />

            {/* Git 面板 */}
            <GitPanel />
          </div>

          {/* 右侧面板 */}
          {!rightPanelCollapsed && (
            <div className={styles.rightPanel} style={{ width: rightPanelWidth }}>
              <DetailPanel selectedNodeId={selectedNodeId} />
            </div>
          )}
        </div>

        {/* 右键菜单 */}
        <ContextMenu
          visible={contextMenu.visible}
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          targetId={contextMenu.targetId}
          onNewChild={handleNewChild}
          onRename={handleRename}
          onDelete={handleDelete}
          onEdgeDelete={handleEdgeDelete}
          onFocus={handleFocus}
          onProperties={handleProperties}
          onClose={hideCM}
        />
      </div>
    </GraphContextProvider>
  )
}
