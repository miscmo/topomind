/**
 * 图谱页面：三栏布局
 * 左侧面板 + 中间 React Flow 图谱 + 右侧详情面板
 */
import { useEffect, useRef, useState } from 'react'
import { ReactFlow, useReactFlow } from '@xyflow/react'
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
import { Background } from '@xyflow/react'
import styles from './GraphPage.module.css'

const nodeTypes = { knowledgeCard: KnowledgeCard }

/** Inner component that uses shared graph context */
function GraphCanvas() {
  const showGrid = useAppStore((s) => s.showGrid)
  const graph = useGraphContext()
  const { showCM, showEdgeCM } = useContextMenu()
  const [zoomLevel, setZoomLevel] = useState(1)

  return (
    <>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
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
        onPaneClick={graph.onPaneClick}
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
            variant="dots"
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

  // Context menu
  const { contextMenu, showEdgeCM, hideCM } = useContextMenu()

  // Single useGraph instance — passed to GraphContextProvider for sharing
  const graph = useGraph()

  // Rename dialog state
  const [renameDialog, setRenameDialog] = useState<{ nodeId: string; name: string } | null>(null)

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
      if (!window.confirm(`确定要删除 "${graph.selectedNode?.data.label}" 吗？`)) return
      graph.deleteChildNode(selectedNodeId)
    },
  })

  // Context menu handlers
  const handleNewChild = (nodeId: string) => {
    const name = window.prompt('请输入新节点名称：')
    if (!name?.trim()) return
    graph.createChildNode(name.trim())
  }

  const handleRename = (nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const newName = window.prompt('请输入新名称：', node.data.label)
    if (!newName?.trim() || newName === node.data.label) return
    graph.renameNode(nodeId, newName.trim())
  }

  const handleDelete = (nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    if (!window.confirm(`确定要删除 "${node.data.label}" 吗？`)) return
    graph.deleteChildNode(nodeId)
  }

  const handleEdgeDelete = (edgeId: string) => {
    graph.deleteEdge(edgeId)
  }

  // Rename dialog confirm
  const handleRenameConfirm = () => {
    if (!renameDialog?.name.trim() || !renameDialog?.nodeId) return
    graph.renameNode(renameDialog.nodeId, renameDialog.name.trim())
    setRenameDialog(null)
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
          onClose={hideCM}
        />
      </div>
    </GraphContextProvider>
  )
}
