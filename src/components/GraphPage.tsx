/**
 * 图谱页面：三栏布局
 * 左侧面板 + 中间 React Flow 图谱 + 右侧详情面板
 */
import { memo, useEffect, useRef, useState, useCallback } from 'react'
import { ReactFlow, type Node, type NodeTypes, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAppStore } from '../stores/appStore'
import { useRoomStore, roomStore } from '../stores/roomStore'
import { useTabStore, tabStore } from '../stores/tabStore'
import { usePromptStore } from '../stores/promptStore'
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
    onDoubleClick: async () => {
      const name = await prompt({ title: '请输入新节点名称', placeholder: '节点名称' })
      if (!name?.trim()) return
      logAction('节点:创建', 'GraphPage', { nodeName: name.trim(), source: 'double-click-canvas' })
      await graph.createChildNode(name.trim())
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
        onPaneContextMenu={(e) => {
          e.preventDefault()
          hideCM()
        }}
        onEdgeContextMenu={(e, edge) => {
          if (edge) {
            showEdgeCM(edge.id, e)
          }
        }}
        onMove={(_, viewport) => logViewportChange(viewport)}
        onInit={(instance: ReactFlowInstance) => { (window as any).__reactFlow = instance }}
        minZoom={0.15}
        maxZoom={3.5}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
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
      <Toolbar />

      {/* 缩放指示器 */}
      <div id="zoom-indicator" className={styles.zoomIndicator}>{Math.round(zoomLevel * 100)}%</div>
    </>
  )
})

interface GraphPageProps {
  tabId?: string
}

export default memo(function GraphPage({ tabId }: GraphPageProps) {
  const view = useAppStore((s) => s.view)
  const appSelectedNodeId = useAppStore((s) => s.selectedNodeId)
  const rightPanelCollapsed = useAppStore((s) => s.rightPanelCollapsed)
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth)
  const currentRoomPath = useRoomStore((s) => s.currentRoomPath)
  const currentKBPath = useRoomStore((s) => s.currentKBPath)
  const currentRoomName = useRoomStore((s) => s.currentRoomName)
  const roomHistory = useRoomStore((s) => s.roomHistory)
  const appSearchQuery = useAppStore((s) => s.searchQuery)
  const setAppSearchQuery = useAppStore((s) => s.setSearchQuery)
  const setTabDirty = useTabStore((s) => s.setTabDirty)
  const getTabById = useTabStore((s) => s.getTabById)
  const setTabSearchQuery = useTabStore((s) => s.setTabSearchQuery)
  const setTabSelectedNode = useTabStore((s) => s.setTabSelectedNode)
  const restoreRoomStateToTab = useTabStore((s) => s.restoreRoomStateToTab)
  const activeTabId = useTabStore((s) => s.activeTabId)

  const currentTab = tabId ? getTabById(tabId) : undefined
  const tabRoomHistory = currentTab?.roomHistory ?? []
  const tabRoomPath = currentTab?.currentRoomPath ?? null
  const tabRoomName = currentTab?.currentRoomName ?? ''
  const tabLabel = currentTab?.label ?? ''
  const tabKbPath = currentTab?.kbPath ?? null
  const tabSearchQuery = currentTab?.searchQuery ?? ''
  const tabSelectedNodeId = currentTab?.selectedNodeId ?? null
  const effectiveRoomPath = tabRoomPath || currentRoomPath
  const effectiveKbPath = tabKbPath || currentKBPath
  const effectiveSearchQuery = tabId ? tabSearchQuery : appSearchQuery
  const effectiveSelectedNodeId = tabId ? tabSelectedNodeId : appSelectedNodeId

  // Log graph page visibility
  useEffect(() => {
    if (view === 'graph') {
      logAction('页面:进入图谱', 'GraphPage', {
        currentRoomPath: effectiveRoomPath || '',
        currentKBPath: effectiveKbPath || '',
        tabId: tabId || '',
      })
    }
  }, [view, effectiveRoomPath, effectiveKbPath, tabId])

  const { contextMenu, showEdgeCM, hideCM } = useContextMenu()

  // Single useGraph instance — shared via GraphContextProvider below
  const graph = useGraph(tabId)

  // Callback-based dirty state sync — avoids polling interval
  // Only active when this GraphPage is associated with a tab (tabId is provided)
  useEffect(() => {
    if (!tabId) return
    return graph.onDirtyChange((isModified: boolean) => {
      setTabDirty(tabId, isModified)
    })
  }, [tabId, graph, setTabDirty])

  // Load room when room path changes
  // Keep refs in sync to avoid stale closure and infinite loops from graph object changing
  const graphLoadRoomRef = useRef(graph.loadRoom)
  const graphHighlightRef = useRef(graph.highlightSearch)
  graphLoadRoomRef.current = graph.loadRoom
  graphHighlightRef.current = graph.highlightSearch

  // Restore tab-scoped room snapshot into roomStore when this GraphPage becomes active.
  // Phase 2: roomStore is still used as a compatibility layer, but tabStore becomes the preferred source.
  useEffect(() => {
    if (!tabId || activeTabId !== tabId || !effectiveKbPath) return

    roomStore.getState().restoreRoomState({
      kbPath: effectiveKbPath,
      roomHistory: tabRoomHistory,
      currentRoomPath: effectiveRoomPath ?? effectiveKbPath,
      currentRoomName: tabRoomName || tabLabel || '全局',
    })
  }, [tabId, activeTabId, effectiveKbPath, effectiveRoomPath, tabRoomHistory, tabRoomName, tabLabel])

  useEffect(() => {
    const loadPath = effectiveRoomPath || effectiveKbPath || ''
    if (!loadPath) return
    logAction('房间:加载触发', 'GraphPage', {
      loadPath,
      currentRoomPath: effectiveRoomPath || '',
      currentKBPath: effectiveKbPath || '',
      tabId: tabId || '',
    })
    graphLoadRoomRef.current(loadPath)
  }, [effectiveRoomPath, effectiveKbPath, tabId])

  const handleSearchChange = useCallback((q: string) => {
    if (tabId) {
      setTabSearchQuery(tabId, q)
    }
    // Compatibility: keep global app store in sync during migration period
    setAppSearchQuery(q)
  }, [tabId, setTabSearchQuery, setAppSearchQuery])

  // Highlight search matches
  useEffect(() => {
    graphHighlightRef.current(effectiveSearchQuery)
  }, [effectiveSearchQuery])

  // Sync room state to tabStore when key room fields change (active tab only)
  useEffect(() => {
    if (!tabId || activeTabId !== tabId) return

    const roomHistoryChanged = JSON.stringify(tabRoomHistory) !== JSON.stringify(roomHistory)
    const roomPathChanged = tabRoomPath !== currentRoomPath
    const roomNameChanged = tabRoomName !== currentRoomName
    const kbPathChanged = tabKbPath !== currentKBPath

    if (!roomHistoryChanged && !roomPathChanged && !roomNameChanged && !kbPathChanged) return

    restoreRoomStateToTab(tabId, {
      kbPath: currentKBPath,
      roomHistory,
      currentRoomPath,
      currentRoomName,
    })
  }, [
    tabId,
    activeTabId,
    restoreRoomStateToTab,
    tabRoomHistory,
    tabRoomPath,
    tabRoomName,
    tabKbPath,
    roomHistory,
    currentRoomPath,
    currentRoomName,
    currentKBPath,
  ])

  // Keep app-level selected node in sync with active tab selected node (compatibility bridge)
  useEffect(() => {
    if (!tabId || activeTabId !== tabId) return
    if (appSelectedNodeId === effectiveSelectedNodeId) return
    if (effectiveSelectedNodeId) {
      useAppStore.getState().selectNode(effectiveSelectedNodeId)
    } else {
      useAppStore.getState().clearSelection()
    }
  }, [tabId, activeTabId, appSelectedNodeId, effectiveSelectedNodeId])

  // Save current graph before app quit
  useEffect(() => {
    const handler = () => {
      graph.flushCurrentRoomSave().catch((e) => {
        logAction('保存:退出前失败', 'GraphPage', {
          tabId: tabId || '',
          error: e instanceof Error ? e.message : String(e),
        })
      })
    }

    window.electronAPI?.on('save:before-quit', handler)
    return () => window.electronAPI?.off('save:before-quit', handler)
  }, [graph, tabId])

  // Keyboard shortcuts + context menu handlers — single useNodeActions instance
  const {
    deleteSelectedNode,
    addChildNode,
    handleNewChild,
    handleRename,
    handleDelete,
    handleEdgeDelete,
    handleFocus,
    handleProperties,
  } = useNodeActions()

  useKeyboard({
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
            <SearchBar searchQuery={effectiveSearchQuery} onSearchChange={handleSearchChange} />

            <GraphCanvas searchQuery={effectiveSearchQuery} onSearchChange={handleSearchChange} />

            {/* Git 面板 */}
            <GitPanel />
          </div>

          {/* 右侧面板 */}
          {!rightPanelCollapsed && (
            <div className={styles.rightPanel} style={{ width: rightPanelWidth }}>
              <DetailPanel selectedNodeId={effectiveSelectedNodeId} />
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
