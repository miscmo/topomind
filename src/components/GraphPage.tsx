/**
 * 图谱页面：两栏布局
 * React Flow 图谱 + 右侧详情+样式配置+Git面板
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ReactFlow, type Node, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAppStore } from '../stores/appStore'
import { useTabStore, tabStore } from '../stores/tabStore'
import { usePromptStore } from '../stores/promptStore'
import { useGraph } from '../hooks/useGraph'
import { useNavContext } from '../hooks/useNavContext'
import { useNodeActions } from '../hooks/useNodeActions'
import { useContextMenu } from '../hooks/useContextMenu'
import { usePageLogging } from '../hooks/usePageLogging'
import { useRoomLoader } from '../hooks/useRoomLoader'
import { useTabDirtySync } from '../hooks/useTabDirtySync'
import { useResizePanel } from '../hooks/useResizePanel'
import { useKeyboard } from '../hooks/useKeyboard'
import { useDoubleClick } from '../hooks/useDoubleClick'
import { GraphContextProvider, useGraphContext } from '../contexts/GraphContext'
import KnowledgeCard from '../nodes/KnowledgeCard'
import NavTree from './NavTree/NavTree'
import Toolbar from './Toolbar/Toolbar'
import Breadcrumb from './Breadcrumb/Breadcrumb'
import SearchBar from './SearchBar/SearchBar'
import DetailPanel from './DetailPanel/DetailPanel'
import StyleSection from './DetailPanel/StyleSection'
import ContextMenu from './ContextMenu/ContextMenu'
import GitPanel from './GitPanel/GitPanel'
import { Background, type BackgroundVariant } from '@xyflow/react'
import { logAction } from '../core/log-backend'
import { registerTabSaver } from '../core/close-guard'
import styles from './GraphPage.module.css'

const nodeTypes = { knowledgeCard: KnowledgeCard }

/** Inner component that uses shared graph context */
const GraphCanvas = memo(function GraphCanvas({
  searchQuery,
  tabId,
}: {
  searchQuery: string
  tabId?: string
}) {
  const showGrid = useAppStore((s) => s.showGrid)
  const setSelectedEdgeId = useAppStore((s) => s.setSelectedEdgeId)
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab)
  const graph = useGraphContext()
  const { showCM, showEdgeCM, hideCM } = useContextMenu()
  const prompt = usePromptStore((s) => s.open)
  const [zoomLevel, setZoomLevel] = useState(1)
  const lastLogTimeRef = useRef<number>(0)

  // Debounced viewport change logging (max once per 2 seconds)
  const logViewportChange = useCallback(
    (viewport: { zoom: number; x: number; y: number }) => {
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
    },
    []
  )

const { handleClick: handlePaneClick } = useDoubleClick({
    onClick: () => {
      // Immediate: close context menu on every pane click
      hideCM()
    },
    onDoubleClick: () => {
      // 双击空白区只取消选择，不执行缩放动作
      useAppStore.getState().clearSelection()
    },
    onSingleClick: () => {
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
        onConnectStart={graph.onConnectStart}
        onConnectEnd={graph.onConnectEnd}
        connectionRadius={48}
        onNodeClick={graph.onNodeClick as (e: React.MouseEvent, node: Node) => void}
        onNodeDoubleClick={graph.onNodeDoubleClick as (e: React.MouseEvent, node: Node) => void}
        onNodeContextMenu={(e, node) => {
          if (node) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            graph.onNodeContextMenu(e, node as any)
            showCM(node.id, e)
          }
        }}
        onEdgeClick={(e, edge) => {
          if (edge) {
            graph.onEdgeClick(e, edge)
          }
        }}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={(e) => {
          showCM('', e)
        }}
        onEdgeContextMenu={(e, edge) => {
          if (edge) {
            setSelectedEdgeId(edge.id)
            setRightPanelTab('style')
            showEdgeCM(edge.id, e)
          }
        }}
        onMove={(_, viewport) => logViewportChange(viewport)}
        onInit={(instance) => { (window as any).__reactFlow = instance }}
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
          <Background
            variant={'dots' as BackgroundVariant}
            gap={20}
            size={1}
            color="#c8cdd6"
          />
        )}
      </ReactFlow>

      {/* 工具栏 */}
      <Toolbar zoomLevel={zoomLevel} />
    </>
  )
})

interface GraphPageProps {
  tabId?: string
}

export default memo(function GraphPage({ tabId }: GraphPageProps) {
  const view = useAppStore((s) => s.view)
  const { getNavState } = useNavContext({ tabId })
  const nav = getNavState()
  const effectiveRoomPath = nav.roomPath
  const effectiveKbPath = nav.kbPath
  const effectiveSearchQuery = nav.searchQuery
  const effectiveSelectedNodeId = nav.selectedNodeId

  // Right panel state
  const rightPanelCollapsed = useAppStore((s) => s.rightPanelCollapsed)
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth)
  const setRightPanelWidth = useAppStore((s) => s.setRightPanelWidth)
  const rightPanelTab = useAppStore((s) => s.rightPanelTab)
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab)
  const setSelectedEdgeId = useAppStore((s) => s.setSelectedEdgeId)

  const { isResizing, handleMouseDown: handleResizeMouseDown } = useResizePanel({
    initialWidth: rightPanelWidth,
    onWidthChange: setRightPanelWidth,
    minWidth: 200,
    maxWidth: 800,
  })

  // Log graph page visibility
  usePageLogging({
    view,
    effectiveRoomPath: effectiveRoomPath || null,
    effectiveKbPath: effectiveKbPath || null,
    tabId,
  })

  const { contextMenu, showCM, showEdgeCM, hideCM } = useContextMenu()

  // Single useGraph instance — shared via GraphContextProvider below
  const graph = useGraph(tabId)

  // Ref-based dirty state sync — avoids stale closure and cleanup-before-body races.
  useTabDirtySync({
    tabId,
    onDirtyChange: graph.onDirtyChange,
  })

  // Keep ref in sync to avoid stale closure from graph object changing
  const graphHighlightRef = useRef(graph.highlightSearch)
  graphHighlightRef.current = graph.highlightSearch

  // Load room when room path changes
  useRoomLoader({
    effectiveRoomPath: effectiveRoomPath || null,
    effectiveKbPath: effectiveKbPath || null,
    tabId,
    loadRoom: graph.loadRoom,
    isCreatingRef: graph.isCreatingRef,
  })

  
  // Highlight search matches
  useEffect(() => {
    graphHighlightRef.current(effectiveSearchQuery)
  }, [effectiveSearchQuery])

  // Save current graph before app quit
  const flushCurrentRoomSaveRef = useRef(graph.flushCurrentRoomSave)
  flushCurrentRoomSaveRef.current = graph.flushCurrentRoomSave

  useEffect(() => {
    if (!tabId) return
    return registerTabSaver(tabId, async () => {
      await flushCurrentRoomSaveRef.current()
    })
  }, [tabId])

  // Keyboard shortcuts + context menu handlers — single useNodeActions instance
  const {
    deleteSelectedNode,
    addChildNode,
    handleNewChild,
    handleRename,
    handleDelete,
    handleEdgeDelete,
    handleEdgeStyle,
    handleFocus,
    handleProperties,
  } = useNodeActions({ graph, tabId })

  useKeyboard({
    tabId,
    onDelete: () => {
      const selectedNodeIdForDelete = tabId
        ? tabStore.getState().getTabSelectedNode(tabId)
        : useAppStore.getState().selectedNodeId
      if (!selectedNodeIdForDelete) return
      deleteSelectedNode(selectedNodeIdForDelete)
    },
    onAddChild: (parentId: string) => {
      addChildNode(parentId)
    },
  })

  if (view !== 'graph') return null

  return (
    <GraphContextProvider graph={graph}>
      <div id="graph-page" className={styles.page}>
        <div id="app-layout" className={styles.layout}>
          {/* 中间图谱 */}
          <div id="graph-panel" className={styles.graphPanel}>
            {/* 标题 */}
            <div id="header" className={styles.header}>TopoMind</div>

            {/* 面包屑 */}
            <Breadcrumb tabId={tabId} />

            {/* 搜索 */}
            <SearchBar searchQuery={effectiveSearchQuery} onSearchChange={nav.setSearchQuery} />

            <GraphCanvas searchQuery={effectiveSearchQuery} tabId={tabId} />

            {/* Git 面板 */}
            <GitPanel />
          </div>

          {/* 拖拽调整宽度分隔条 */}
          {!rightPanelCollapsed && (
            <div
              className={`${styles.resizeHandle} ${isResizing ? styles.resizing : ''}`}
              onMouseDown={handleResizeMouseDown}
              title="拖拽调整宽度"
            />
          )}

          {/* 右侧面板 */}
          {!rightPanelCollapsed && (
            <div className={styles.rightPanel} style={{ width: rightPanelWidth }}>
              <div className={styles.rightPanelTabs}>
                <button
                  className={`${styles.rightPanelTabBtn} ${rightPanelTab === 'detail' ? styles.rightPanelTabBtnActive : ''}`}
                  onClick={() => setRightPanelTab('detail')}
                >
                  详情
                </button>
                <button
                  className={`${styles.rightPanelTabBtn} ${rightPanelTab === 'style' ? styles.rightPanelTabBtnActive : ''}`}
                  onClick={() => setRightPanelTab('style')}
                >
                  样式
                </button>
              </div>
              {rightPanelTab === 'detail' ? (
                <DetailPanel selectedNodeId={effectiveSelectedNodeId} tabId={tabId} />
              ) : (
                <StyleSection />
              )}
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
          onEdgeStyle={handleEdgeStyle}
          onFocus={handleFocus}
          onProperties={handleProperties}
          onClose={hideCM}
        />
      </div>
    </GraphContextProvider>
  )
})
