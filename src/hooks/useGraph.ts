/**
 * useGraph — Core graph logic hook
 *
 * Responsibilities:
 * - Load room graph data from filesystem (_graph.json)
 * - Build React Flow nodes and edges from graph metadata
 * - Handle node/edge CRUD operations
 * - Persist layout changes (debounced)
 * - Handle room navigation (drill-in / drill-out)
 */
import { useCallback, useRef, useState } from 'react'
import type { Node, NodeChange, EdgeChange, Connection } from '@xyflow/react'
import { useAppStore } from '../stores/appStore'
import { useRoomStore, roomStore } from '../stores/roomStore'
import { useLayout } from './useLayout'
import { useStorage } from './useStorage'
import { logAction } from '../core/log-backend'
import { logger } from '../core/logger'
import type { KnowledgeNodeData, KnowledgeNode, KnowledgeEdge, GraphMeta, EdgeRelation, EdgeWeight } from '../types'
import { DOMAIN_COLORS } from '../types'

const AUTO_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

function generateId(prefix: string): string {
  let id = prefix
  for (let i = 0; i < 6; i++) {
    id += AUTO_ID_CHARS[Math.floor(Math.random() * AUTO_ID_CHARS.length)]
  }
  return id
}

/** Shared serialization: convert nodes+edges to _graph.json format */
function buildMetaFromNodesEdges(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[]
): { children: Record<string, { name: string }>; edges: Array<{ id: string; source: string; target: string; relation: string; weight: string }> } {
  const children: Record<string, { name: string }> = {}
  for (const node of nodes) {
    const childName = node.id.includes('/') ? node.id.split('/').pop()! : node.id
    children[childName] = { name: node.data.label }
  }
  const graphEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    relation: e.data?.relation ?? '相关',
    weight: e.data?.weight ?? 'minor',
  }))
  return { children, edges: graphEdges }
}

export interface GraphState {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  loading: boolean
  selectedNode: KnowledgeNode | null
}

export function useGraph() {
  const storage = useStorage()
  const { computeLayout } = useLayout()

  const currentRoomPath = useRoomStore((s) => s.currentRoomPath)
  const enterRoom = useRoomStore((s) => s.enterRoom)
  const goBack = useRoomStore((s) => s.goBack)

  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const selectNode = useAppStore((s) => s.selectNode)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const autoId = useAppStore((s) => s.autoId)
  const exitEdgeMode = useAppStore((s) => s.exitEdgeMode)

  const [state, setState] = useState<GraphState>({
    nodes: [],
    edges: [],
    loading: false,
    selectedNode: null,
  })

  // Node internal maps for O(1) access
  const nodesMapRef = useRef<Map<string, KnowledgeNode>>(new Map())
  const edgesMapRef = useRef<Map<string, KnowledgeEdge>>(new Map())
  const savePendingRef = useRef(false)
  // Refs for stable closure access to current nodes/edges
  const nodesRef = useRef<KnowledgeNode[]>([])
  const edgesRef = useRef<KnowledgeEdge[]>([])

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

  // ===== Build nodes/edges from filesystem =====

  const buildNodes = useCallback(
    async (
      dirPath: string,
      meta: GraphMeta,
      savedPositions: Record<string, { x: number; y: number }>,
      kbPath: string
    ): Promise<KnowledgeNode[]> => {
      const children = Object.entries(meta.children ?? {})
      const nodeCount = children.length

      // Default spacing based on count
      const spacingX = Math.max(60, 200 - nodeCount * 5)
      const spacingY = Math.max(50, 120 - nodeCount * 3)

      // Parallelize child count checks — eliminates N sequential reads
      const childCountResults = await Promise.all(
        children.map(async ([childName]) => {
          const childPath = dirPath ? `${dirPath}/${childName}` : childName
          try {
            return await storage.countChildren(childPath)
          } catch {
            return 0
          }
        })
      )

      const rfNodes: KnowledgeNode[] = children.map(([childName, childInfo], i) => {
        const childPath = dirPath ? `${dirPath}/${childName}` : childName
        const nodeId = childPath
        const childCount = childCountResults[i]
        const hasChildren = childCount > 0
        const domainColor = DOMAIN_COLORS[i % DOMAIN_COLORS.length]
        const saved = savedPositions[nodeId]
        const position = saved ?? {
          x: 50 + i * spacingX,
          y: 50 + i * spacingY,
        }

        return {
          id: nodeId,
          type: 'knowledgeCard',
          position,
          data: {
            label: childInfo.name,
            path: childPath,
            parent: dirPath || kbPath || undefined,
            hasChildren,
            domainColor,
            childCount: hasChildren ? childCount : undefined,
            nodeType: hasChildren ? 'container' : 'leaf',
          },
        }
      })

      return rfNodes
    },
    [storage]
  )

  const buildEdges = useCallback(
    (meta: GraphMeta, parentPath: string): KnowledgeEdge[] => {
      return (meta.edges ?? []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated: e.weight === 'main',
        data: {
          relation: e.relation,
          weight: e.weight,
          highlighted: false,
          faded: false,
        },
      }))
    },
    []
  )

  // ===== Load room =====

  const loadRoom = useCallback(
    async (dirPath: string) => {
      setState((s) => ({ ...s, loading: true }))

      try {
        const meta = await storage.readLayout(dirPath)
        const kbPath = roomStore.getState().currentKBPath || ''

        logAction('房间:加载', 'useGraph', { roomPath: dirPath, kbPath })

        // Build saved position map
        const savedPositions: Record<string, { x: number; y: number }> = {}
        if (meta.children) {
          for (const childName of Object.keys(meta.children)) {
            const childPath = dirPath ? `${dirPath}/${childName}` : childName
            // Read each child's layout
            try {
              const childMeta = await storage.readLayout(childPath)
              if (childMeta.zoom != null && childMeta.pan != null) {
                savedPositions[childPath] = { x: childMeta.pan.x, y: childMeta.pan.y }
              }
            } catch {
              // Child layout not found
            }
          }
        }

        const nodes = await buildNodes(dirPath, meta, savedPositions, kbPath)
        const edges = buildEdges(meta, dirPath)

        rebuildMaps(nodes, edges)
        updateSelectedNode(nodes, null)
        nodesRef.current = nodes
        edgesRef.current = edges

        setState({
          nodes,
          edges,
          loading: false,
          selectedNode: null,
        })
      } catch (e) {
        logger.catch('useGraph', 'loadRoom', e)
        setState((s) => ({ ...s, loading: false }))
      }
    },
    [storage, buildNodes, buildEdges, rebuildMaps, updateSelectedNode]
  )

  // ===== Save layout to disk =====

  const saveLayoutToDisk = useCallback(
    async (dirPath: string, nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => {
      if (!dirPath) return
      await storage.saveLayout(dirPath, buildMetaFromNodesEdges(nodes, edges))
    },
    [storage]
  )

  // ===== Apply layout =====

  const layoutNodes = useCallback(
    async (direction: 'RIGHT' | 'DOWN' = 'DOWN') => {
      const positions = await computeLayout(nodesRef.current, direction)
      if (Object.keys(positions).length === 0) return

      const updatedNodes = nodesRef.current.map((n) => {
        const pos = positions[n.id]
        if (pos) {
          return { ...n, position: pos }
        }
        return n
      })

      rebuildMaps(updatedNodes, edgesRef.current)
      nodesRef.current = updatedNodes
      setState((s) => ({ ...s, nodes: updatedNodes }))

      // Read currentRoomPath at execution time to avoid stale closure
      const dirPath = roomStore.getState().currentRoomPath
      if (dirPath) {
        await saveLayoutToDisk(dirPath, updatedNodes, edgesRef.current)
      }
    },
    [computeLayout, rebuildMaps, saveLayoutToDisk]
  )

  const scheduleDebouncedSave = useCallback(
    (dirPath: string) => {
      if (savePendingRef.current) return
      savePendingRef.current = true

      storage.saveGraphDebounced(
        dirPath,
        () => buildMetaFromNodesEdges(
          Array.from(nodesMapRef.current.values()),
          Array.from(edgesMapRef.current.values())
        ),
        () => {
          savePendingRef.current = false
        }
      )
    },
    [storage]
  )

  // ===== React Flow event handlers =====

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setState((prev) => {
        let nodes = [...prev.nodes]

        for (const change of changes) {
          if (change.type === 'position' && change.position) {
            // Update node position
            nodes = nodes.map((n) =>
              n.id === change.id ? { ...n, position: change.position! } : n
            )
            // Mark dirty and schedule save
            nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
            nodesRef.current = nodes
            if (currentRoomPath) {
              scheduleDebouncedSave(currentRoomPath)
            }
          } else if (change.type === 'remove') {
            // Node removed
            nodes = nodes.filter((n) => n.id !== change.id)
            nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
            nodesRef.current = nodes
          } else if (change.type === 'select') {
            // Selection change handled separately
          } else if (change.type === 'dimensions') {
            // Dimension change — update measured size
            nodes = nodes.map((n) =>
              n.id === change.id ? { ...n, measured: change.dimensions } : n
            )
            nodesRef.current = nodes
          }
        }

        // Update selectedNode ref — read fresh from store to avoid stale closure
        updateSelectedNode(nodes, useAppStore.getState().selectedNodeId)

        return { ...prev, nodes }
      })
    },
    [currentRoomPath, updateSelectedNode, scheduleDebouncedSave]
  )

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
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
  }, [])

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

      // Save to disk
      if (currentRoomPath) {
        scheduleDebouncedSave(currentRoomPath)
      }

      logAction('连线:创建', 'useGraph', { edgeId, source: connection.source, target: connection.target })
    },
    [currentRoomPath, rebuildMaps, scheduleDebouncedSave]
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      selectNode(node.id)
      updateSelectedNode(nodesRef.current, node.id)
      logAction('节点:选中', 'useGraph', { nodeId: node.id, label: node.data.label, path: node.data.path })
    },
    [selectNode, updateSelectedNode]
  )

  const onPaneClick = useCallback(() => {
    clearSelection()
    updateSelectedNode(nodesRef.current, null)
  }, [clearSelection, updateSelectedNode])

  const onNodeDoubleClick = useCallback(
    async (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      if (!node.data.hasChildren) return // Can't enter a leaf node

      // Drill into the child room
      const childPath = node.data.path
      const childName = node.data.label

      // Save current room layout before leaving
      if (currentRoomPath) {
        await storage.flushGraphSave(
          currentRoomPath,
          () => buildMetaFromNodesEdges(
            Array.from(nodesMapRef.current.values()),
            Array.from(edgesMapRef.current.values())
          )
        )
      }

      // Enter the child room
      enterRoom({ path: childPath, kbPath: roomStore.getState().currentKBPath || '', name: childName })
      logAction('房间:钻入', 'useGraph', { roomPath: childPath, roomName: childName, fromRoom: currentRoomPath })
      // LoadRoom will be called by GraphPage when roomPath changes
    },
    [currentRoomPath, enterRoom, storage]
  )

  const onNodeContextMenu = useCallback(
    (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      // Context menu is shown by appStore
      selectNode(node.id)
    },
    [selectNode]
  )

  // ===== Node CRUD =====

  const createChildNode = useCallback(
    async (name: string, parentId?: string): Promise<string | null> => {
      // If parentId is provided, create inside that node's directory
      // Otherwise create in the current room (top-level node)
      const targetPath = parentId ?? currentRoomPath
      if (!targetPath) return null

      try {
        const newPath = await storage.createCard(targetPath, name)
        logAction('节点:创建', 'useGraph', { nodeName: name, parentPath: targetPath, newPath: newPath ?? undefined })
        // Reload room to get updated children
        await loadRoom(currentRoomPath || '')
        return newPath
      } catch (e) {
        logger.catch('useGraph', 'createChildNode', e)
        return null
      }
    },
    [currentRoomPath, storage, loadRoom]
  )

  const deleteChildNode = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const nodeLabel = nodesMapRef.current.get(nodeId)?.data.label ?? nodeId
      try {
        await storage.deleteCard(nodeId)
        logAction('节点:删除', 'useGraph', { nodeId, label: nodeLabel, path: nodeId })
        await loadRoom(currentRoomPath || '')
        if (selectedNodeId === nodeId) {
          clearSelection()
        }
        return true
      } catch (e) {
        logger.catch('useGraph', 'deleteChildNode', e)
        return false
      }
    },
    [currentRoomPath, storage, loadRoom, selectedNodeId, clearSelection]
  )

  const renameNode = useCallback(
    async (nodeId: string, newName: string): Promise<boolean> => {
      const oldName = nodesMapRef.current.get(nodeId)?.data.label ?? nodeId
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
        if (currentRoomPath) {
          scheduleDebouncedSave(currentRoomPath)
        }
        return true
      } catch (e) {
        logger.catch('useGraph', 'renameNode', e)
        return false
      }
    },
    [currentRoomPath, storage, rebuildMaps, scheduleDebouncedSave]
  )

  // ===== Edge CRUD =====

  const deleteEdge = useCallback(
    async (edgeId: string): Promise<boolean> => {
      const edge = edgesMapRef.current.get(edgeId)
      setState((prev) => {
        const edges = prev.edges.filter((e) => e.id !== edgeId)
        edgesRef.current = edges
        rebuildMaps(prev.nodes, edges)
        return { ...prev, edges }
      })
      logAction('连线:删除', 'useGraph', { edgeId, source: edge?.source, target: edge?.target })
      if (currentRoomPath) {
        scheduleDebouncedSave(currentRoomPath)
      }
      return true
    },
    [currentRoomPath, rebuildMaps, scheduleDebouncedSave]
  )

  const updateEdgeRelation = useCallback(
    (edgeId: string, relation: EdgeRelation, weight: EdgeWeight) => {
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
      if (currentRoomPath) {
        scheduleDebouncedSave(currentRoomPath)
      }
    },
    [currentRoomPath, rebuildMaps, scheduleDebouncedSave]
  )

  // ===== Room navigation =====

  const navigateBack = useCallback(async () => {
    // Save current room layout
    if (currentRoomPath) {
      await storage.flushGraphSave(
        currentRoomPath,
        () => buildMetaFromNodesEdges(
          Array.from(nodesMapRef.current.values()),
          Array.from(edgesMapRef.current.values())
        )
      )
    }

    clearSelection()
    logAction('房间:返回', 'useGraph', { fromRoom: currentRoomPath })
    goBack()
    // Load the new room immediately after store update
    const newPath = roomStore.getState().currentRoomPath || ''
    await loadRoom(newPath)
  }, [currentRoomPath, storage, goBack, clearSelection, loadRoom])

  /** Navigate to a specific room by history index. Truncates history and loads target room. */
  const navigateToRoom = useCallback(
    async (index: number) => {
      const roomState = roomStore.getState()
      if (index < 0 || index >= roomState.roomHistory.length) return

      // Save current room layout before leaving
      if (currentRoomPath) {
        await storage.flushGraphSave(
          currentRoomPath,
          () => buildMetaFromNodesEdges(
            Array.from(nodesMapRef.current.values()),
            Array.from(edgesMapRef.current.values())
          )
        )
      }

      clearSelection()
      logAction('房间:导航', 'useGraph', { targetIndex: index })
      roomStore.getState().navigateToHistoryIndex(index)
      const newPath = roomStore.getState().currentRoomPath || ''
      await loadRoom(newPath)
    },
    [currentRoomPath, storage, clearSelection, loadRoom]
  )

  // ===== Search highlight =====

  const highlightSearch = useCallback(
    (query: string) => {
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
    },
    []
  )

  return {
    // State
    nodes: state.nodes,
    edges: state.edges,
    loading: state.loading,
    selectedNode: state.selectedNode,

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
    deleteEdge,
    updateEdgeRelation,

    // Layout
    layoutNodes,

    // Search
    highlightSearch,
  }
}
