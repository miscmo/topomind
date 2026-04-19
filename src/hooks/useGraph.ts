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
import type { KnowledgeNodeData, KnowledgeNode, KnowledgeEdge, GraphMeta, EdgeRelation, EdgeWeight } from '../types'

const DOMAIN_COLORS = [
  '#3498db', '#e74c3c', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
  '#16a085', '#c0392b', '#8e44ad', '#27ae60',
]

const AUTO_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

function generateId(prefix: string): string {
  let id = prefix
  for (let i = 0; i < 6; i++) {
    id += AUTO_ID_CHARS[Math.floor(Math.random() * AUTO_ID_CHARS.length)]
  }
  return id
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

  const // Node internal map for O(1) access
    nodesMapRef = useRef<Map<string, KnowledgeNode>>(new Map())
  const edgesMapRef = useRef<Map<string, KnowledgeEdge>>(new Map())
  const savePendingRef = useRef(false)

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

      const rfNodes: KnowledgeNode[] = []

      for (let i = 0; i < children.length; i++) {
        const [childName, childInfo] = children[i]
        const childPath = dirPath ? `${dirPath}/${childName}` : childName
        const nodeId = childPath // Use path as node ID for uniqueness

        // Check if this child has its own sub-directory (has children)
        let hasChildren = false
        let childCount = 0
        try {
          childCount = await storage.countChildren(childPath)
          hasChildren = childCount > 0
        } catch {
          hasChildren = false
        }

        // Determine domain color from index
        const domainColor = DOMAIN_COLORS[i % DOMAIN_COLORS.length]

        // Position: use saved position or compute grid layout
        const saved = savedPositions[nodeId]
        const position = saved ?? {
          x: 50 + i * spacingX,
          y: 50 + i * spacingY,
        }

        const rfNode: KnowledgeNode = {
          id: nodeId,
          type: 'knowledgeCard',
          position,
          data: {
            id: nodeId,
            label: childInfo.name,
            path: childPath,
            parent: dirPath || kbPath || undefined,
            hasChildren,
            domainColor,
            childCount: hasChildren ? childCount : undefined,
            nodeType: hasChildren ? 'container' : 'leaf',
          },
        }

        rfNodes.push(rfNode)
      }

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
        const kbPath = roomStore.getState().currentKBPath

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

        setState({
          nodes,
          edges,
          loading: false,
          selectedNode: null,
        })
      } catch (e) {
        console.error('[useGraph] loadRoom failed:', e)
        setState((s) => ({ ...s, loading: false }))
      }
    },
    [storage, buildNodes, buildEdges, rebuildMaps, updateSelectedNode]
  )

  // ===== Apply layout =====

  const layoutNodes = useCallback(
    async (direction: 'RIGHT' | 'DOWN' = 'DOWN') => {
      const positions = await computeLayout(state.nodes, direction)
      if (Object.keys(positions).length === 0) return

      const updatedNodes = state.nodes.map((n) => {
        const pos = positions[n.id]
        if (pos) {
          return { ...n, position: pos }
        }
        return n
      })

      rebuildMaps(updatedNodes, state.edges)
      setState((s) => ({ ...s, nodes: updatedNodes }))

      // Save positions to filesystem
      await saveLayoutToDisk(currentRoomPath, updatedNodes, state.edges)
    },
    [state.nodes, state.edges, currentRoomPath, computeLayout, rebuildMaps]
  )

  // ===== Save layout to disk =====

  const saveLayoutToDisk = useCallback(
    async (dirPath: string, nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => {
      if (!dirPath) return

      // Build children map from nodes
      const children: Record<string, { name: string }> = {}
      for (const node of nodes) {
        const childName = node.id.includes('/') ? node.id.split('/').pop()! : node.id
        children[childName] = { name: node.data.label }
      }

      // Build edges array
      const graphEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        relation: e.data?.relation ?? '相关',
        weight: e.data?.weight ?? 'minor',
      }))

      await storage.saveLayout(dirPath, {
        children,
        edges: graphEdges,
      })
    },
    [storage]
  )

  const scheduleDebouncedSave = useCallback(
    (dirPath: string) => {
      if (savePendingRef.current) return
      savePendingRef.current = true

      storage.saveGraphDebounced(
        dirPath,
        () => {
          const nodes = Array.from(nodesMapRef.current.values())
          const edges = Array.from(edgesMapRef.current.values())
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
        },
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
            if (currentRoomPath) {
              scheduleDebouncedSave(currentRoomPath)
            }
          } else if (change.type === 'remove') {
            // Node removed
            nodes = nodes.filter((n) => n.id !== change.id)
            nodesMapRef.current = new Map(nodes.map((n) => [n.id, n]))
          } else if (change.type === 'select') {
            // Selection change handled separately
          } else if (change.type === 'dimensions') {
            // Dimension change — update measured size
            nodes = nodes.map((n) =>
              n.id === change.id ? { ...n, measured: change.dimensions } : n
            )
          }
        }

        // Update selectedNode ref
        updateSelectedNode(nodes, selectedNodeId)

        return { ...prev, nodes }
      })
    },
    [currentRoomPath, selectedNodeId, updateSelectedNode, scheduleDebouncedSave]
  )

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setState((prev) => {
      let edges = [...prev.edges]

      for (const change of changes) {
        if (change.type === 'remove') {
          edges = edges.filter((e) => e.id !== change.id)
          edgesMapRef.current = new Map(edges.map((e) => [e.id, e]))
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
        rebuildMaps(prev.nodes, edges)
        return { ...prev, edges }
      })

      // Save to disk
      if (currentRoomPath) {
        scheduleDebouncedSave(currentRoomPath)
      }
    },
    [currentRoomPath, rebuildMaps, scheduleDebouncedSave]
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      selectNode(node.id)
      updateSelectedNode(state.nodes, node.id)
    },
    [state.nodes, selectNode, updateSelectedNode]
  )

  const onPaneClick = useCallback(() => {
    clearSelection()
    updateSelectedNode(state.nodes, null)
  }, [state.nodes, clearSelection, updateSelectedNode])

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
          () => {
            const nodes = Array.from(nodesMapRef.current.values())
            const edges = Array.from(edgesMapRef.current.values())
            const children: Record<string, { name: string }> = {}
            for (const node of nodes) {
              const childName = node.id.includes('/')
                ? node.id.split('/').pop()!
                : node.id
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
        )
      }

      // Enter the child room
      enterRoom({ path: childPath, kbPath: roomStore.getState().currentKBPath, name: childName })
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
    async (name: string): Promise<string | null> => {
      if (!currentRoomPath) return null

      try {
        const newPath = await storage.createCard(currentRoomPath, name)

        // Reload room to get updated children
        await loadRoom(currentRoomPath)
        return newPath
      } catch (e) {
        console.error('[useGraph] createChildNode failed:', e)
        return null
      }
    },
    [currentRoomPath, storage, loadRoom]
  )

  const deleteChildNode = useCallback(
    async (nodeId: string): Promise<boolean> => {
      try {
        await storage.deleteCard(nodeId)
        await loadRoom(currentRoomPath)
        if (selectedNodeId === nodeId) {
          clearSelection()
        }
        return true
      } catch (e) {
        console.error('[useGraph] deleteChildNode failed:', e)
        return false
      }
    },
    [currentRoomPath, storage, loadRoom, selectedNodeId, clearSelection]
  )

  const renameNode = useCallback(
    async (nodeId: string, newName: string): Promise<boolean> => {
      try {
        await storage.renameCard(nodeId, newName)
        // Update the node in local state without full reload
        setState((prev) => {
          const nodes = prev.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, label: newName } }
              : n
          )
          rebuildMaps(nodes, prev.edges)
          return { ...prev, nodes }
        })
        if (currentRoomPath) {
          scheduleDebouncedSave(currentRoomPath)
        }
        return true
      } catch (e) {
        console.error('[useGraph] renameNode failed:', e)
        return false
      }
    },
    [currentRoomPath, storage, rebuildMaps, scheduleDebouncedSave]
  )

  // ===== Edge CRUD =====

  const deleteEdge = useCallback(
    async (edgeId: string): Promise<boolean> => {
      setState((prev) => {
        const edges = prev.edges.filter((e) => e.id !== edgeId)
        rebuildMaps(prev.nodes, edges)
        return { ...prev, edges }
      })
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
        () => {
          const nodes = Array.from(nodesMapRef.current.values())
          const edges = Array.from(edgesMapRef.current.values())
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
      )
    }

    clearSelection()
    goBack()
  }, [currentRoomPath, storage, goBack, clearSelection])

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
