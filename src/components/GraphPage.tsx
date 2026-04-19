/**
 * 图谱页面：三栏布局
 * 左侧面板 + 中间 React Flow 图谱 + 右侧详情面板
 */
import { useEffect, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAppStore } from '../stores/appStore'
import { useRoomStore } from '../stores/roomStore'
import { useGraph } from '../hooks/useGraph'
import { useContextMenu } from '../hooks/useContextMenu'
import { useKeyboard } from '../hooks/useKeyboard'
import type { KnowledgeNode } from '../types'
import KnowledgeCard from '../nodes/KnowledgeCard'
import NavTree from './NavTree/NavTree'
import Toolbar from './Toolbar/Toolbar'
import SearchBar from './SearchBar/SearchBar'
import DetailPanel from './DetailPanel/DetailPanel'
import Breadcrumb from './Breadcrumb/Breadcrumb'
import ContextMenu from './ContextMenu/ContextMenu'
import { Background } from '@xyflow/react'
import styles from './GraphPage.module.css'
import '../css/graph.css'

const nodeTypes = { knowledgeCard: KnowledgeCard }

/** Inner component that uses ReactFlow context */
function GraphCanvas({ graph, onNodeContextMenu }: {
  graph: ReturnType<typeof useGraph> & { fitView?: () => void }
  onNodeContextMenu: (nodeId: string, e: React.MouseEvent) => void
}) {
  const showGrid = useAppStore((s) => s.showGrid)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const { fitView } = useReactFlow()

  // Load room when room path changes
  useEffect(() => {
    const load = async () => {
      await graph.loadRoom(graph.nodes.length === 0 ? '' : '')
      setTimeout(() => fitView({ padding: 0.1, duration: 200 }), 50)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Highlight search matches
  useEffect(() => {
    graph.highlightSearch(searchQuery)
  }, [searchQuery, graph.highlightSearch])

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
        onNodeContextMenu={(e) => {
          // Extract node ID from the event target
          const nodeEl = (e.target as HTMLElement).closest('.react-flow__node')
          if (nodeEl) {
            const nodeId = nodeEl.getAttribute('data-id') ?? ''
            onNodeContextMenu(nodeId, e)
          }
        }}
        onPaneClick={graph.onPaneClick}
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
      <div id="zoom-indicator" className={styles.zoomIndicator}>100%</div>
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
  const hideContextMenu = useAppStore((s) => s.hideContextMenu)
  const expandRightPanel = useAppStore((s) => s.expandRightPanel)

  // Single source of truth for graph state
  const graph = useGraph()
  const prevRoomPathRef = useRef<string | null>(null)

  // Context menu
  const { contextMenu, showCM, hideCM } = useContextMenu()

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

  // Context menu trigger from canvas
  const handleNodeContextMenu = (nodeId: string, e: React.MouseEvent) => {
    graph.onNodeContextMenu(null as never, { id: nodeId } as never)
    showCM(nodeId, e)
  }

  // Rename dialog confirm
  const handleRenameConfirm = () => {
    if (!renameDialog?.name.trim() || !renameDialog?.nodeId) return
    graph.renameNode(renameDialog.nodeId, renameDialog.name.trim())
    setRenameDialog(null)
  }

  if (view !== 'graph') return null

  return (
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

          <ReactFlowProvider>
            <GraphCanvas graph={graph} onNodeContextMenu={handleNodeContextMenu} />
          </ReactFlowProvider>
        </div>

        {/* 右侧面板 */}
        {!rightPanelCollapsed && (
          <div className={styles.rightPanel} style={{ width: rightPanelWidth }}>
            <DetailPanel selectedNode={graph.selectedNode} selectedNodeId={selectedNodeId} graph={graph} />
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        targetId={contextMenu.targetId}
        onNewChild={handleNewChild}
        onRename={handleRename}
        onDelete={handleDelete}
        onClose={hideCM}
      />

      {/* 重命名对话框 */}
      {renameDialog && (
        <div className={styles.modalOverlay} onClick={() => setRenameDialog(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>重命名节点</div>
            <input
              className={styles.modalInput}
              value={renameDialog.name}
              onChange={(e) => setRenameDialog({ ...renameDialog, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameConfirm()
                if (e.key === 'Escape') setRenameDialog(null)
              }}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button className={styles.modalBtnCancel} onClick={() => setRenameDialog(null)}>取消</button>
              <button className={styles.modalBtnConfirm} onClick={handleRenameConfirm}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
