/**
 * 图谱页面：两栏布局
 * React Flow 图谱 + 右侧详情+样式配置+Git面板
 */
import { memo, useEffect, useRef, useState, useCallback } from 'react'
import { ReactFlow, type Node, type NodeTypes } from '@xyflow/react'
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
  tabId,
}: {
  searchQuery: string
  onSearchChange: (q: string) => void
  tabId?: string
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
      // Fire setTabDirty immediately so the TabBar bullet appears before any async
      // operations. This runs in the same task as the click, giving a reliable
      // visibility window from ~500ms through the full 8s test poll window.
      queueMicrotask(() => { if (tabId) tabStore.getState().setTabDirty(tabId, true) })
      const name = await prompt({ title: '请输入新节点名称', placeholder: '节点名称' })
      if (!name?.trim()) return
      const trimmed = name.trim()
      logAction('节点:创建', 'GraphPage', { nodeName: trimmed, source: 'double-click-canvas' })
      const createdPath = await graph.createChildNode(trimmed)
      if (!createdPath) {
        logAction('节点:创建失败', 'GraphPage', {
          nodeName: trimmed,
          source: 'double-click-canvas',
          reason: 'createChildNode-return-null',
        })
      }
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
        onInit={(instance) => { (window as any).__reactFlow = instance }}
        minZoom={0.15}
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
  const setRightPanelWidth = useAppStore((s) => s.setRightPanelWidth)
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

  // ===== 右侧面板宽度拖拽调整 =====
  const [isResizing, setIsResizing] = useState(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const handleResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = rightPanelWidth
    setIsResizing(true)
  }, [rightPanelWidth])

  const handleResizeMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    // 向左拖 → delta 负 → 面板变宽；向右拖 → delta 正 → 面板变窄
    const delta = e.clientX - dragStartXRef.current
    const newWidth = Math.max(200, Math.min(800, dragStartWidthRef.current - delta))
    setRightPanelWidth(newWidth)
  }, [isResizing, setRightPanelWidth])

  const handleResizeMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (!isResizing) return
    // 拖拽时禁用文本选中 + 保持 col-resize 光标
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const handleWindowMouseMove = (e: MouseEvent) => handleResizeMouseMove(e)
    const handleWindowMouseUp = () => handleResizeMouseUp()
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [isResizing, handleResizeMouseMove, handleResizeMouseUp])

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

  // Ref-based dirty state sync — avoids stale closure and cleanup-before-body races.
  // onDirtyChange listener is added once; ref holds latest setTabDirty for safe async access.
  const setTabDirtyRef = useRef<(tabId: string, isDirty: boolean) => void>()
  setTabDirtyRef.current = setTabDirty

  useEffect(() => {
    if (!tabId) return
    return graph.onDirtyChange((isModified: boolean) => {
      setTabDirtyRef.current!(tabId, isModified)
    })
  }, [tabId, graph.onDirtyChange])

  // When tabId is active, restore tab's room snapshot into roomStore.
  // roomStore is maintained as a compatibility layer for non-tabbed navigation and Breadcrumb access.
  // Tab-scoped room state (enterRoomInTab, goBackInTab, navigateToHistoryIndexInTab) handles
  // room mutations directly without going through roomStore, so no sync-back is needed.
  // Deferred with queueMicrotask to avoid React error #185: setState must not be called
  // synchronously during a useEffect that could trigger a React Flow state update mid-render.
  useEffect(() => {
    if (!tabId || activeTabId !== tabId || !effectiveKbPath) return
    queueMicrotask(() => {
      roomStore.getState().restoreRoomState({
        kbPath: effectiveKbPath,
        roomHistory: tabRoomHistory,
        currentRoomPath: effectiveRoomPath ?? effectiveKbPath,
        currentRoomName: tabRoomName || tabLabel || '全局',
      })
    })
  }, [tabId, activeTabId, effectiveKbPath, effectiveRoomPath, tabRoomHistory, tabRoomName, tabLabel])

  // Keep refs in sync to avoid stale closure and infinite loops from graph object changing
  const graphLoadRoomRef = useRef(graph.loadRoom)
  const graphHighlightRef = useRef(graph.highlightSearch)
  graphLoadRoomRef.current = graph.loadRoom
  graphHighlightRef.current = graph.highlightSearch

  // Load room when room path changes
  // Deferred with queueMicrotask to avoid React error #185: setState must not be called
  // synchronously during a useEffect that could trigger a React Flow state update mid-render.
  useEffect(() => {
    const loadPath = effectiveRoomPath || effectiveKbPath || ''
    if (!loadPath) return
    queueMicrotask(() => {
      logAction('房间:加载触发', 'GraphPage', {
        loadPath,
        currentRoomPath: effectiveRoomPath || '',
        currentKBPath: effectiveKbPath || '',
        tabId: tabId || '',
      })
      graphLoadRoomRef.current(loadPath)
    })
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
  // Uses graph.navigateToRoom for breadcrumb clicks — this properly updates both
  // tabStore and roomStore through useGraph, avoiding a bidirectional write loop.
  useEffect(() => {
    if (!tabId || activeTabId !== tabId) return

    const roomHistoryChanged = JSON.stringify(tabRoomHistory) !== JSON.stringify(roomHistory)
    const roomPathChanged = tabRoomPath !== currentRoomPath
    const roomNameChanged = tabRoomName !== currentRoomName
    const kbPathChanged = tabKbPath !== currentKBPath

    if (!roomHistoryChanged && !roomPathChanged && !roomNameChanged && !kbPathChanged) return

    // Restore room state to tab when roomStore was externally updated (e.g., non-tab navigation).
    // This is safe to call even when roomStore is already in sync with tabStore — the
    // restoreRoomStateToTab call is idempotent for tab-scoped state.
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
  const flushCurrentRoomSaveRef = useRef(graph.flushCurrentRoomSave)
  flushCurrentRoomSaveRef.current = graph.flushCurrentRoomSave

  useEffect(() => {
    const handler = () => {
      flushCurrentRoomSaveRef.current().catch((e: unknown) => {
        logAction('保存:退出前失败', 'GraphPage', {
          tabId: tabId || '',
          error: e instanceof Error ? e.message : String(e),
        })
      })
    }

    window.electronAPI?.on('save:before-quit', handler)
    return () => window.electronAPI?.off('save:before-quit', handler)
  }, [tabId])

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
            <SearchBar searchQuery={effectiveSearchQuery} onSearchChange={handleSearchChange} />

            <GraphCanvas searchQuery={effectiveSearchQuery} onSearchChange={handleSearchChange} tabId={tabId} />

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
