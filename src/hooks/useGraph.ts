/**
 * useGraph — Core graph logic hook
 *
 * Responsibilities:
 * - Load room graph data from filesystem (_graph.json)
 * - Handle node/edge CRUD operations
 * - Persist layout changes (debounced)
 * - Handle room navigation (drill-in / drill-out)
 *
 * Node/edge building is delegated to ./graphBuilder.ts
 */
import { useCallback, useRef, useState, useEffect } from 'react'
import type { Node, NodeChange, EdgeChange, Connection } from '@xyflow/react'
import { useAppStore } from '../stores/appStore'
import { useRoomStore, roomStore } from '../stores/roomStore'
import { tabStore } from '../stores/tabStore'
import { useLayout } from './useLayout'
import { useStorage } from './useStorage'
import { logAction } from '../core/log-backend'
import { logger } from '../core/logger'
import type { KnowledgeNodeData, KnowledgeNode, KnowledgeEdge, EdgeRelation, EdgeWeight } from '../types'
import { buildMetaFromNodesEdges, buildNodes, buildEdges, generateId } from './useGraph/graphBuilder'

export interface GraphState {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  loading: boolean
  selectedNode: KnowledgeNode | null
}

export function useGraph(tabId?: string) {
  const storage = useStorage()
  const { computeLayout } = useLayout()

  const enterRoom = useRoomStore((s) => s.enterRoom)
  const goBack = useRoomStore((s) => s.goBack)

  const selectNode = useAppStore((s) => s.selectNode)
  const clearSelection = useAppStore((s) => s.clearSelection)

  const [state, setState] = useState<GraphState>({
    nodes: [],
    edges: [],
    loading: false,
    selectedNode: null,
  })

  // Dirty state: true when changes are pending save, false when saved
  const [isModified, setIsModified] = useState(false)

  // Node internal maps for O(1) access
  const nodesMapRef = useRef<Map<string, KnowledgeNode>>(new Map())
  const edgesMapRef = useRef<Map<string, KnowledgeEdge>>(new Map())
  // Refs for stable closure access to current nodes/edges
  const nodesRef = useRef<KnowledgeNode[]>([])
  const edgesRef = useRef<KnowledgeEdge[]>([])
  const isModifiedRef = useRef(false)
  const loadRequestSeqRef = useRef(0)
  const latestAppliedLoadSeqRef = useRef(0)

  // ===== Node/Edge helpers =====

  const rebuildMaps = useCallback((nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => {
    nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
    edgesMapRef.current = new Map(edges.map((e) => [e.id, e]))
  }, [])

  const updateSelectedNode = useCallback((nodes: KnowledgeNode[], nodeId: string | null) => {
    if (!nodeId) {
      setState((s) => ({ ...s, selectedNode: null }))
      return
    }
    const node = nodes.find((n) => n.id === nodeId) ?? null
    setState((s) => ({ ...s, selectedNode: node }))
  }, [])

  // Callback refs for external consumers to observe dirty state changes
  // Avoids polling intervals in consuming components
  const dirtyChangeCallbacksRef = useRef<Set<(isModified: boolean) => void>>(new Set())

  const setDirtyState = useCallback((next: boolean) => {
    if (isModifiedRef.current === next) return
    isModifiedRef.current = next
    setIsModified(next)
    dirtyChangeCallbacksRef.current.forEach((cb) => cb(next))
  }, [])

  const getActiveSelectedNodeId = useCallback(() => {
    if (tabId) {
      return tabStore.getState().getTabSelectedNode(tabId)
    }
    return useAppStore.getState().selectedNodeId
  }, [tabId])

  const setActiveSelectedNodeId = useCallback((nodeId: string | null) => {
    if (tabId) {
      tabStore.getState().setTabSelectedNode(tabId, nodeId)
    }

    if (nodeId === null) {
      clearSelection()
    } else {
      selectNode(nodeId)
    }
  }, [tabId, clearSelection, selectNode])

  const getActiveNavState = useCallback(() => {
    if (tabId) {
      const tab = tabStore.getState().getTabById(tabId)
      if (tab && tab.type === 'kb' && tab.kbPath) {
        return {
          kbPath: tab.kbPath,
          roomPath: tab.currentRoomPath || tab.kbPath,
          roomName: tab.currentRoomName || tab.label,
        }
      }
    }

    const roomState = roomStore.getState()
    return {
      kbPath: roomState.currentKBPath || '',
      roomPath: roomState.currentRoomPath || roomState.currentKBPath || '',
      roomName: roomState.currentRoomName || '全局',
    }
  }, [tabId])

  // ===== Load room =====

  const loadRoom = useCallback(
    async (dirPath: string) => {
      const requestSeq = ++loadRequestSeqRef.current
      setState((s) => ({ ...s, loading: true }))

      try {
        const meta = await storage.readLayout(dirPath)
        const kbPath = getActiveNavState().kbPath

        logAction('房间:加载', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })

        // Build saved position map from child rooms' zoom/pan
        const savedPositions: Record<string, { x: number; y: number }> = {}
        if (meta.children) {
          const childEntries = Object.keys(meta.children)
          const positionResults = await Promise.allSettled(
            childEntries.map(async (childName) => {
              const childPath = dirPath ? `${dirPath}/${childName}` : childName
              const childMeta = await storage.readLayout(childPath)
              return { childPath, childMeta }
            })
          )
          for (const result of positionResults) {
            if (result.status === 'fulfilled' && result.value.childMeta.zoom != null && result.value.childMeta.pan != null) {
              savedPositions[result.value.childPath] = { x: result.value.childMeta.pan.x, y: result.value.childMeta.pan.y }
            }
          }
        }

        const nodes = await buildNodes(storage, dirPath, meta, savedPositions, kbPath)
        const edges = buildEdges(meta)

        // Ignore stale responses: only the latest in-flight load may update refs/state.
        if (requestSeq < loadRequestSeqRef.current) {
          logAction('房间:加载丢弃', 'useGraph', { roomPath: dirPath, kbPath, requestSeq })
          return
        }

        latestAppliedLoadSeqRef.current = requestSeq
        rebuildMaps(nodes, edges)
        updateSelectedNode(nodes, null)
        nodesRef.current = nodes
        edgesRef.current = edges
        logAction('房间:加载完成', 'useGraph', {
          roomPath: dirPath,
          kbPath,
          nodeCount: nodes.length,
          edgeCount: edges.length,
          requestSeq,
        })

        setState({
          nodes,
          edges,
          loading: false,
          selectedNode: null,
        })
      } catch (e) {
        logger.catch('useGraph', 'loadRoom', e)
        if (requestSeq === loadRequestSeqRef.current && requestSeq >= latestAppliedLoadSeqRef.current) {
          setState((s) => ({ ...s, loading: false }))
        }
      }
    },
    [storage, rebuildMaps, updateSelectedNode]
  )

  // ===== Save layout to disk =====

  const saveLayoutToDisk = useCallback(
    async (dirPath: string, nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => {
      if (!dirPath) return
      await storage.saveLayout(dirPath, buildMetaFromNodesEdges(nodes, edges))
      setDirtyState(false)
    },
    [storage, setDirtyState]
  )

  // ===== Apply layout =====

  const layoutNodes = useCallback(
    async (direction: 'RIGHT' | 'DOWN' = 'DOWN') => {
      const positions = await computeLayout(nodesRef.current, direction)
      if (Object.keys(positions).length === 0) return

      const updatedNodes = nodesRef.current.map((n) => {
        const pos = positions[n.id]
        return pos ? { ...n, position: pos } : n
      })

      rebuildMaps(updatedNodes, edgesRef.current)
      nodesRef.current = updatedNodes
      setState((s) => ({ ...s, nodes: updatedNodes }))
      logAction('布局:应用', 'useGraph', { direction, positionedCount: Object.keys(positions).length })

      // Read current room path at execution time to avoid stale closure
      const dirPath = getActiveNavState().roomPath
      if (dirPath) {
        await saveLayoutToDisk(dirPath, updatedNodes, edgesRef.current)
      }
    },
    [computeLayout, rebuildMaps, saveLayoutToDisk]
  )

  const scheduleDebouncedSave = useCallback(
    (dirPath: string) => {
      if (!dirPath) return
      setDirtyState(true)

      storage.saveGraphDebounced(
        dirPath,
        () => buildMetaFromNodesEdges(
          Array.from(nodesMapRef.current.values()),
          Array.from(edgesMapRef.current.values())
        ),
        () => {
          setDirtyState(false)
        }
      )
    },
    [storage, setDirtyState]
  )

  // Register a callback to be called when dirty state changes
  const onDirtyChange = useCallback((callback: (isModified: boolean) => void) => {
    dirtyChangeCallbacksRef.current.add(callback)
    // Call immediately with current state
    callback(isModifiedRef.current)
    return () => {
      dirtyChangeCallbacksRef.current.delete(callback)
    }
  }, [])

  // ===== React Flow event handlers =====

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setState((prev) => {
        let nodes = [...prev.nodes]

        for (const change of changes) {
          if (change.type === 'position' && change.position) {
            nodes = nodes.map((n) =>
              n.id === change.id ? { ...n, position: change.position! } : n
            )
            nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
            nodesRef.current = nodes
            const dirPath = getActiveNavState().roomPath
            if (dirPath) {
              scheduleDebouncedSave(dirPath)
            }
          } else if (change.type === 'remove') {
            nodes = nodes.filter((n) => n.id !== change.id)
            nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
            nodesRef.current = nodes
          } else if (change.type === 'select') {
            // Selection change handled separately
          } else if (change.type === 'dimensions') {
            nodes = nodes.map((n) =>
              n.id === change.id ? { ...n, measured: change.dimensions } : n
            )
            nodesRef.current = nodes
          }
        }

        // Update selectedNode ref — read fresh from active state to avoid stale closure
        updateSelectedNode(nodes, getActiveSelectedNodeId())

        return { ...prev, nodes }
      })
    },
    [updateSelectedNode, scheduleDebouncedSave]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // Read current room path at execution time to avoid stale closure
      const dirPath = getActiveNavState().roomPath

      setState((prev) => {
        let edges = [...prev.edges]

        for (const change of changes) {
          if (change.type === 'remove') {
            edges = edges.filter((e) => e.id !== change.id)
            edgesMapRef.current = new Map(edges.map((e) => [e.id, e]))
            edgesRef.current = edges
          }
        }

        return { ...prev, edges }
      })

      if (dirPath) {
        scheduleDebouncedSave(dirPath)
      }
    },
    [scheduleDebouncedSave]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return

      const edgeId = generateId('e-')
      const newEdge: KnowledgeEdge = {
        id: edgeId,
        source: connection.source,
        target: connection.target,
        type: 'smoothstep',
        data: {
          relation: '相关',
          weight: 'minor',
          highlighted: false,
          faded: false,
        },
      }

      setState((prev) => {
        const edges = [...prev.edges, newEdge]
        edgesRef.current = edges
        rebuildMaps(prev.nodes, edges)
        return { ...prev, edges }
      })
      const dirPath = getActiveNavState().roomPath
      if (dirPath) {
        scheduleDebouncedSave(dirPath)
      }

      logAction('连线:创建', 'useGraph', { edgeId, source: connection.source, target: connection.target })
    },
    [rebuildMaps, scheduleDebouncedSave]
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      setActiveSelectedNodeId(node.id)
      updateSelectedNode(nodesRef.current, node.id)
      logAction('节点:选中', 'useGraph', { nodeId: node.id, label: node.data.label, path: node.data.path })
    },
    [setActiveSelectedNodeId, updateSelectedNode]
  )

  const onPaneClick = useCallback(() => {
    setActiveSelectedNodeId(null)
    updateSelectedNode(nodesRef.current, null)
  }, [setActiveSelectedNodeId, updateSelectedNode])

  const navigateToChildRoom = useCallback(async (childPath: string, childName: string) => {
    const navState = getActiveNavState()
    const dirPath = navState.roomPath

    // Save current room layout before leaving
    if (dirPath) {
      await storage.flushGraphSave(
        dirPath,
        () => buildMetaFromNodesEdges(
          Array.from(nodesMapRef.current.values()),
          Array.from(edgesMapRef.current.values())
        ),
        () => setDirtyState(false)
      )
    }

    // Enter the child room
    if (tabId) {
      tabStore.getState().enterRoomInTab(tabId, {
        path: childPath,
        kbPath: navState.kbPath || '',
        name: childName,
      })
      const restored = tabStore.getState().getRoomStateFromTab(tabId)
      roomStore.getState().restoreRoomState({
        kbPath: navState.kbPath || '',
        roomHistory: restored?.roomHistory ?? [],
        currentRoomPath: restored?.currentRoomPath ?? childPath,
        currentRoomName: restored?.currentRoomName || childName,
      })
    } else {
      enterRoom({ path: childPath, kbPath: navState.kbPath || '', name: childName })
    }
    logAction('房间:钻入', 'useGraph', { roomPath: childPath, roomName: childName, fromRoom: dirPath })
  }, [getActiveNavState, tabId, enterRoom, storage, setDirtyState])

  const onNodeDoubleClick = useCallback(
    async (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      if (!node.data.hasChildren) return // Can't enter a leaf node
      await navigateToChildRoom(node.data.path, node.data.label)
    },
    [navigateToChildRoom]
  )

  const onNodeContextMenu = useCallback(
    (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      setActiveSelectedNodeId(node.id)
    },
    [setActiveSelectedNodeId]
  )

  // ===== Node CRUD =====

  const createChildNode = useCallback(
    async (name: string, parentId?: string): Promise<string | null> => {
      // If parentId is provided, create inside that node's directory
      // Otherwise create in the current room (top-level node)
      const dirPath = getActiveNavState().roomPath
      const targetPath = parentId ?? dirPath
      if (!targetPath) return null

      try {
        const newPath = await storage.createCard(targetPath, name)
        logAction('节点:创建', 'useGraph', { nodeName: name, parentPath: targetPath, newPath: newPath ?? undefined })
        // Reload room to get updated children
        await loadRoom(dirPath || getActiveNavState().kbPath || '')
        return newPath
      } catch (e) {
        logger.catch('useGraph', 'createChildNode', e)
        return null
      }
    },
    [storage, loadRoom]
  )

  const deleteChildNode = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const nodeLabel = nodesMapRef.current.get(nodeId)?.data.label ?? nodeId
      const dirPath = getActiveNavState().roomPath
      try {
        await storage.deleteCard(nodeId)
        logAction('节点:删除', 'useGraph', { nodeId, label: nodeLabel, path: nodeId })
        await loadRoom(dirPath || getActiveNavState().kbPath || '')
        // Read fresh from active state to avoid stale closure
        if (getActiveSelectedNodeId() === nodeId) {
          setActiveSelectedNodeId(null)
        }
        return true
      } catch (e) {
        logger.catch('useGraph', 'deleteChildNode', e)
        return false
      }
    },
    [storage, loadRoom, clearSelection]
  )

  const renameNode = useCallback(
    async (nodeId: string, newName: string): Promise<boolean> => {
      const oldName = nodesMapRef.current.get(nodeId)?.data.label ?? nodeId
      const dirPath = getActiveNavState().roomPath
      try {
        await storage.renameCard(nodeId, newName)
        logAction('节点:重命名', 'useGraph', { nodeId, oldName, newName, path: nodeId })
        // Update the node in local state without full reload
        setState((prev) => {
          const nodes = prev.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, label: newName } }
              : n
          )
          nodesRef.current = nodes
          rebuildMaps(nodes, prev.edges)
          return { ...prev, nodes }
        })
        if (dirPath) {
          scheduleDebouncedSave(dirPath)
        }
        return true
      } catch (e) {
        logger.catch('useGraph', 'renameNode', e)
        return false
      }
    },
    [storage, rebuildMaps, scheduleDebouncedSave]
  )

  // ===== Edge CRUD =====

  const updateEdgeRelation = useCallback(
    (edgeId: string, relation: EdgeRelation, weight: EdgeWeight) => {
      const dirPath = getActiveNavState().roomPath
      setState((prev) => {
        const edges = prev.edges.map((e) =>
          e.id === edgeId
            ? { ...e, data: { ...e.data, relation, weight } }
            : e
        )
        edgesRef.current = edges
        rebuildMaps(prev.nodes, edges)
        return { ...prev, edges }
      })
      if (dirPath) {
        scheduleDebouncedSave(dirPath)
      }
    },
    [rebuildMaps, scheduleDebouncedSave]
  )

  // ===== Room navigation =====

  const navigateBack = useCallback(async () => {
    const dirPath = getActiveNavState().roomPath

    // Save current room layout
    if (dirPath) {
      await storage.flushGraphSave(
        dirPath,
        () => buildMetaFromNodesEdges(
          Array.from(nodesMapRef.current.values()),
          Array.from(edgesMapRef.current.values())
        ),
        () => setDirtyState(false)
      )
    }

    clearSelection()
    logAction('房间:返回', 'useGraph', { fromRoom: dirPath })

    if (tabId) {
      const target = tabStore.getState().goBackInTab(tabId)
      const fallbackKbPath = getActiveNavState().kbPath || ''
      roomStore.getState().restoreRoomState({
        kbPath: target?.kbPath || fallbackKbPath,
        roomHistory: tabStore.getState().getRoomStateFromTab(tabId)?.roomHistory ?? [],
        currentRoomPath: target?.path || fallbackKbPath,
        currentRoomName: target?.name || tabStore.getState().getTabById(tabId)?.label || '全局',
      })
    } else {
      goBack()
    }

    // Load the new room immediately after store update
    const newPath = getActiveNavState().roomPath || getActiveNavState().kbPath || ''
    await loadRoom(newPath)
  }, [tabId, storage, goBack, clearSelection, loadRoom, getActiveNavState])

  /** Navigate to a specific room by history index. Truncates history and loads target room. */
  const navigateToRoom = useCallback(
    async (index: number) => {
      const historyLength = tabId
        ? (tabStore.getState().getRoomStateFromTab(tabId)?.roomHistory.length ?? 0)
        : roomStore.getState().roomHistory.length
      if (index < 0 || index >= historyLength) return

      const dirPath = getActiveNavState().roomPath

      // Save current room layout before leaving
      if (dirPath) {
        await storage.flushGraphSave(
          dirPath,
          () => buildMetaFromNodesEdges(
            Array.from(nodesMapRef.current.values()),
            Array.from(edgesMapRef.current.values())
          ),
          () => setDirtyState(false)
        )
      }

      clearSelection()
      logAction('房间:导航', 'useGraph', { targetIndex: index })

      if (tabId) {
        const target = tabStore.getState().navigateToHistoryIndexInTab(tabId, index)
        const fallbackKbPath = getActiveNavState().kbPath || ''
        roomStore.getState().restoreRoomState({
          kbPath: target?.kbPath || fallbackKbPath,
          roomHistory: tabStore.getState().getRoomStateFromTab(tabId)?.roomHistory ?? [],
          currentRoomPath: target?.path || fallbackKbPath,
          currentRoomName: target?.name || tabStore.getState().getTabById(tabId)?.label || '全局',
        })
      } else {
        roomStore.getState().navigateToHistoryIndex(index)
      }

      const newPath = getActiveNavState().roomPath || getActiveNavState().kbPath || ''
      await loadRoom(newPath)
    },
    [tabId, storage, clearSelection, loadRoom, getActiveNavState]
  )

  // ===== Search highlight =====

  const highlightSearch = useCallback((query: string) => {
    const q = query.toLowerCase().trim()
    setState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          searchMatch: q ? n.data.label.toLowerCase().includes(q) : false,
        },
      })),
    }))
  }, [])

  const flushCurrentRoomSave = useCallback(async () => {
    const navState = getActiveNavState()
    const dirPath = navState.roomPath || navState.kbPath || ''
    if (!dirPath) return

    await storage.flushGraphSave(
      dirPath,
      () => buildMetaFromNodesEdges(
        Array.from(nodesMapRef.current.values()),
        Array.from(edgesMapRef.current.values())
      ),
      () => setDirtyState(false)
    )
  }, [storage, setDirtyState, getActiveNavState])

  return {
    // State
    nodes: state.nodes,
    edges: state.edges,
    loading: state.loading,
    selectedNode: state.selectedNode,
    isModified,

    // Dirty state callbacks — consumer registers to avoid polling
    onDirtyChange,

    // Room lifecycle
    loadRoom,
    navigateBack,
    navigateToRoom,

    // React Flow handlers
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeClick,
    onPaneClick,
    onNodeDoubleClick,
    onNodeContextMenu,

    // Node operations
    createChildNode,
    deleteChildNode,
    renameNode,

    // Edge operations
    updateEdgeRelation,

    // Layout
    layoutNodes,

    // Search
    highlightSearch,

    // Persistence
    flushCurrentRoomSave,

    // Stable refs for closure access to current state
    nodesRef,
    edgesRef,
    nodesMapRef,
    edgesMapRef,
  }
}
