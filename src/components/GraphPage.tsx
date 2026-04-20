/**
 * 图谱页面：三栏布局
 * 左侧面板 + 中间 React Flow 图谱 + 右侧详情面板
 */
import { memo, useEffect, useRef, useState } from 'react'
import { ReactFlow, type Node, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAppStore } from '../stores/appStore'
import { useRoomStore } from '../stores/roomStore'
import { useGraph } from '../hooks/useGraph'
import { useNodeActions } from '../hooks/useNodeActions'
import { useContextMenu } from '../hooks/useContextMenu'
import { useKeyboard } from '../hooks/useKeyboard'
import { useDoubleClick } from '../hooks/useDoubleClick'
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
const GraphCanvas = memo(function GraphCanvas({
  searchQuery,
  onSearchChange,
}: {
  searchQuery: string
  onSearchChange: (q: string) => void
}) {
  const showGrid = useAppStore((s) => s.showGrid)
  const graph = useGraphContext()
  const { showCM, showEdgeCM } = useContextMenu()
  const [zoomLevel, setZoomLevel] = useState(1)

const { handleClick: handlePaneClick } = useDoubleClick({
    onDoubleClick: () => {
      const name = window.prompt('请输入新节点名称：')
      if (!name?.trim()) return
      logAction('节点:创建', 'GraphPage', { nodeName: name.trim(), source: 'double-click-canvas' })
      graph.createChildNode(name.trim())
    },
    onSingleClick: () => {
      // Single click on pane: deselect
      useAppStore.getState().clearSelection()
    },
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
        onNodeClick={graph.onNodeClick as (e: React.MouseEvent, node: Node) => void}
        onNodeDoubleClick={graph.onNodeDoubleClick as (e: React.MouseEvent, node: Node) => void}
        onNodeContextMenu={(e, node) => {
          if (node) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            graph.onNodeContextMenu(e, node as any)
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
})

export default memo(function GraphPage() {
  const view = useAppStore((s) => s.view)
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const rightPanelCollapsed = useAppStore((s) => s.rightPanelCollapsed)
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth)
  const currentRoomPath = useRoomStore((s) => s.currentRoomPath)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)

  const prevRoomPathRef = useRef<string | null>(null)

  const { contextMenu, showEdgeCM, hideCM } = useContextMenu()

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
  const { deleteSelectedNode, addChildNode } = useNodeActions()
  useKeyboard({
    onDelete: () => {
      if (!selectedNodeId) return
      deleteSelectedNode(selectedNodeId)
    },
    onAddChild: (parentId: string) => {
      addChildNode(parentId)
    },
  })

  // Context menu handlers — extracted to useNodeActions hook
  const {
    handleNewChild,
    handleRename,
    handleDelete,
    handleEdgeDelete,
    handleFocus,
    handleProperties,
  } = useNodeActions()

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
            <SearchBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />

            <GraphCanvas searchQuery={searchQuery} onSearchChange={setSearchQuery} />

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
})
