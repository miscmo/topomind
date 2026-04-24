/**
 * graphOperations — Node/edge CRUD and mutation operations for the graph
 *
 * Extracted from useGraph.ts to keep the hook focused on coordination.
 * All functions here deal with pure state transformations and storage I/O.
 */
import type { Connection } from '@xyflow/react'
import type { KnowledgeNode, KnowledgeEdge, EdgeRelation, EdgeWeight } from '../../types'
import { buildMetaFromNodesEdges } from './graphBuilder'
import { FSB } from '../../core/fs-backend'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'

export interface StorageApi {
  createCard: (parentPath: string, cardName: string) => Promise<string | null>
  deleteCard: (cardPath: string) => Promise<unknown>
  renameCard: (cardPath: string, newName: string) => Promise<unknown>
  saveGraphDebounced: (dirPath: string, buildMeta: () => object, onFlush: () => void) => void
  flushGraphSave: (dirPath: string, buildMeta: () => object, onFlush: () => void) => Promise<void>
}

export interface GraphOpsDeps {
  storage: StorageApi
  nodesMapRef: React.MutableRefObject<Map<string, KnowledgeNode>>
  edgesMapRef: React.MutableRefObject<Map<string, KnowledgeEdge>>
  nodesRef: React.MutableRefObject<KnowledgeNode[]>
  edgesRef: React.MutableRefObject<KnowledgeEdge[]>
  getActiveNavState: () => { kbPath: string; roomPath: string; roomName: string }
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  rebuildMaps: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  setState: (updater: (prev: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }) => { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; loading?: boolean; selectedNode?: KnowledgeNode | null }) => void
  getActiveSelectedNodeId: () => string | null
  setActiveSelectedNodeId: (nodeId: string | null) => void
  updateSelectedNode: (nodes: KnowledgeNode[], nodeId: string | null) => void
  setDirtyState: (next: boolean) => void
  isCreatingRef: React.MutableRefObject<boolean>
  isModifiedRef: React.MutableRefObject<boolean>
}

export function buildGraphOperations(deps: GraphOpsDeps) {
  const {
    storage,
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    edgesRef,
    getActiveNavState,
    loadRoom,
    rebuildMaps,
    setState,
    getActiveSelectedNodeId,
    setActiveSelectedNodeId,
    updateSelectedNode,
    setDirtyState,
    isCreatingRef,
    isModifiedRef,
  } = deps

  // ===== Internal helpers =====

  const scheduleSave = (dirPath: string) => {
    console.log('[DEBUG] scheduleSave called with dirPath:', dirPath)
    if (!dirPath) return
    storage.saveGraphDebounced(
      dirPath,
      () => buildMetaFromNodesEdges(
        Array.from(nodesMapRef.current.values()),
        Array.from(edgesMapRef.current.values())
      ),
      () => setDirtyState(false)
    )
  }

  const saveNow = async (dirPath: string) => {
    if (!dirPath) return
    await storage.flushGraphSave(
      dirPath,
      () => buildMetaFromNodesEdges(
        Array.from(nodesMapRef.current.values()),
        Array.from(edgesMapRef.current.values())
      ),
      () => setDirtyState(false)
    )
  }

  // ===== Node CRUD =====

  const createChildNode = async (name: string, parentId?: string): Promise<string | null> => {
    const nav = getActiveNavState()
    const dirPath = nav.roomPath
    const targetPath = parentId ?? (dirPath || nav.kbPath)
    if (!targetPath) {
      logAction('节点:创建失败', 'graphOperations', {
        reason: dirPath ? 'targetPath-empty' : 'not-inside-room',
        nodeName: name,
        parentId: parentId || null,
        roomPath: nav.roomPath || null,
        kbPath: nav.kbPath || null,
      })
      return null
    }

    // Only mark dirty when inside a room (roomPath is non-empty).
    // At root level there is no _graph.json to save to, so the debounce
    // mechanism never fires and dirty would persist forever.
    if (dirPath) setDirtyState(true)
    isCreatingRef.current = true

    try {
      const newPath = await storage.createCard(targetPath, name)
      const reloadPath = dirPath || getActiveNavState().kbPath || ''
      logAction('节点:创建', 'graphOperations', {
        nodeName: name,
        parentPath: targetPath,
        newPath: newPath ?? null,
        roomPath: nav.roomPath || null,
        kbPath: nav.kbPath || null,
        reloadPath: reloadPath || null,
      })

      // Update parent's _graph.json immediately so loadRoom discovers the new child.
      // Without this, the parent's children map doesn't include the new entry,
      // so buildNodes skips it and the node never appears on canvas.
      // (The old e2e mock updated storedGraphMeta in fs:mkDir, but the real
      // Electron backend only creates the directory — save is debounced 300ms later.)
      let parentMeta: Awaited<ReturnType<typeof FSB.readGraphMeta>> = {}
      try {
        parentMeta = await FSB.readGraphMeta(targetPath)
      } catch {
        // 新建父节点首次添加子节点时，_graph.json 可能尚不存在；按空 meta 兜底。
        parentMeta = {}
      }

      const existingChildren = (parentMeta?.children && typeof parentMeta.children === 'object' && !Array.isArray(parentMeta.children))
        ? parentMeta.children as Record<string, unknown>
        : {} as Record<string, unknown>
      const resolvedPath = (newPath ?? '').trim()
      const cardKey = resolvedPath
        ? (resolvedPath.split(/[/\\]/).pop() ?? resolvedPath)
        : name
      const childrenWithNew: Record<string, unknown> = {
        ...existingChildren,
        [cardKey]: { name, hasChildren: false },
      }
      await FSB.writeGraphMeta(targetPath, {
        ...parentMeta,
        children: childrenWithNew,
        edges: Array.isArray((parentMeta as { edges?: unknown })?.edges) ? (parentMeta as { edges: unknown[] }).edges : [],
      } as Parameters<typeof FSB.writeGraphMeta>[1])

      // Also update the current room's _graph.json so that when this room is
      // displayed, buildNodes finds the child entry and the node appears on canvas.
      // Two things must happen:
      // 1. The parent's entry must have hasChildren: true (so it shows "1 child")
      // 2. The new child entry must be added to the room's children map
      //    (otherwise loadRoom never discovers it and the node count stays the same)
      const currentRoomMeta = await FSB.readGraphMeta(reloadPath).catch(() => ({ children: {}, edges: [] } as Record<string, unknown>))
      const roomChildren = (currentRoomMeta?.children && typeof currentRoomMeta.children === 'object' && !Array.isArray(currentRoomMeta.children))
        ? currentRoomMeta.children as Record<string, unknown>
        : {} as Record<string, unknown>

      // Find the parent's key in the room's children map.
      // Keys are name-only (e.g. "父节点") at the room level, not full paths.
      // Match by comparing normalized entry names against the parent's display name.
      const parentName = nodesMapRef.current.get(targetPath)?.data.label ?? (targetPath.split(/[/\\]/).pop() ?? targetPath)
      let parentEntryKey: string | null = null
      for (const [key, value] of Object.entries(roomChildren)) {
        const normalizedKey = key.includes('/') || key.includes('\\')
          ? (key.split(/[/\\]/).pop() ?? key)
          : key
        const entry = value as { name?: string }
        if (normalizedKey === parentName || entry.name === parentName || key === parentName) {
          parentEntryKey = key
          break
        }
      }

      // Determine the child's key in the room's children map: name-only (e.g. "子节点A")
      const childName = cardKey

      const updatedRoomChildren: Record<string, unknown> = { ...roomChildren }
      if (parentEntryKey) {
        updatedRoomChildren[parentEntryKey] = { ...(roomChildren[parentEntryKey] as object), hasChildren: true }
      }
      // Add the new child entry (only if not already present)
      if (!updatedRoomChildren[childName]) {
        updatedRoomChildren[childName] = { name, hasChildren: false }
      }

      await FSB.writeGraphMeta(reloadPath, {
        ...currentRoomMeta,
        children: updatedRoomChildren,
        edges: Array.isArray((currentRoomMeta as { edges?: unknown })?.edges) ? (currentRoomMeta as { edges: unknown[] }).edges : [],
      } as Parameters<typeof FSB.writeGraphMeta>[1])

      await loadRoom(reloadPath, true)
      isCreatingRef.current = false

      // Trigger debounce save so that onFlush → setDirtyState(false) fires
      // naturally, clearing the dirty bullet. Without this, dirty stays true
      // forever and test 6.2 ("保存后脏标记消失") times out.
      scheduleSave(getActiveNavState().roomPath)

      return newPath
    } catch (e) {
      isCreatingRef.current = false
      logger.catch('graphOperations', 'createChildNode', e)
      logAction('节点:创建失败', 'graphOperations', {
        reason: 'exception',
        nodeName: name,
        parentPath: targetPath,
        roomPath: nav.roomPath || null,
        kbPath: nav.kbPath || null,
        error: (e as Error)?.message || String(e),
      })
      return null
    }
  }

  const deleteChildNode = async (nodeId: string): Promise<boolean> => {
    const nodeLabel = nodesMapRef.current.get(nodeId)?.data.label ?? nodeId
    const dirPath = getActiveNavState().roomPath
    const currentRoomPath = dirPath || getActiveNavState().kbPath || ''
    try {
      await storage.deleteCard(nodeId)
      logAction('节点:删除', 'graphOperations', { nodeId, label: nodeLabel, path: nodeId })

      // Remove from nodesMapRef so saveNow doesn't re-write the stale entry to _graph.json.
      nodesMapRef.current.delete(nodeId)

      setDirtyState(true)
      if (dirPath) await saveNow(dirPath)
      await loadRoom(currentRoomPath)
      if (getActiveSelectedNodeId() === nodeId) {
        setActiveSelectedNodeId(null)
      }
      return true
    } catch (e) {
      logger.catch('graphOperations', 'deleteChildNode', e)
      return false
    }
  }

  const renameNode = async (nodeId: string, newName: string): Promise<boolean> => {
    const dirPath = getActiveNavState().roomPath
    try {
      await storage.renameCard(nodeId, newName)
      const oldName = nodesMapRef.current.get(nodeId)?.data.label ?? nodeId
      logAction('节点:重命名', 'graphOperations', { nodeId, oldName, newName, path: nodeId })
      // Update node in local state without full reload
      setState((prev) => {
        const nodes = prev.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, label: newName } } : n
        )
        nodesRef.current = nodes
        rebuildMaps(nodes, prev.edges)
        return { ...prev, nodes }
      })
      if (dirPath) scheduleSave(dirPath)
      return true
    } catch (e) {
      logger.catch('graphOperations', 'renameNode', e)
      return false
    }
  }

  // ===== Edge CRUD =====

  const addEdge = (connection: Connection, edgeId: string) => {
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
    if (dirPath) scheduleSave(dirPath)
    logAction('连线:创建', 'graphOperations', { edgeId, source: connection.source, target: connection.target })
  }

  const deleteEdge = (edgeId: string) => {
    setState((prev) => {
      const edges = prev.edges.filter((e) => e.id !== edgeId)
      edgesRef.current = edges
      rebuildMaps(prev.nodes, edges)
      return { ...prev, edges }
    })
    const dirPath = getActiveNavState().roomPath
    if (dirPath) scheduleSave(dirPath)
    logAction('连线:删除', 'graphOperations', { edgeId })
  }

  const updateEdgeRelation = (edgeId: string, relation: EdgeRelation, weight: EdgeWeight) => {
    const dirPath = getActiveNavState().roomPath
    setState((prev) => {
      const edges = prev.edges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...e.data, relation, weight } } : e
      )
      edgesRef.current = edges
      rebuildMaps(prev.nodes, edges)
      return { ...prev, edges }
    })
    if (dirPath) scheduleSave(dirPath)
    logAction('连线:更新关系', 'graphOperations', { edgeId, relation, weight })
  }

  // ===== Node position changes =====

  const applyNodePositionChanges = (changes: Array<{ id: string; position: { x: number; y: number } }>) => {
    setState((prev) => {
      const nodesMap = new Map(prev.nodes.map((n) => [n.id, n]))
      for (const change of changes) {
        const node = nodesMap.get(change.id)
        if (node && change.position) {
          nodesMap.set(change.id, { ...node, position: change.position })
        }
      }
      const nodes = Array.from(nodesMap.values())
      nodesRef.current = nodes
      rebuildMaps(nodes, prev.edges)
      updateSelectedNode(nodes, getActiveSelectedNodeId())
      return { ...prev, nodes }
    })
    const dirPath = getActiveNavState().roomPath
    if (dirPath) scheduleSave(dirPath)
  }

  const applyNodeRemoveChanges = (changeIds: string[]) => {
    const removedSet = new Set(changeIds)
    setState((prev) => {
      const nodes = prev.nodes.filter((n) => !changeIds.includes(n.id))
      // Remove edges connected to deleted nodes to avoid orphaned edges
      const edges = prev.edges.filter((e) => !removedSet.has(e.source) && !removedSet.has(e.target))
      nodesRef.current = nodes
      edgesRef.current = edges
      rebuildMaps(nodes, edges)
      return { ...prev, nodes, edges }
    })
    const dirPath = getActiveNavState().roomPath
    if (dirPath) scheduleSave(dirPath)
  }

  const applyNodeDimensionChanges = (changes: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined }>) => {
    setState((prev) => {
      const nodes = prev.nodes.map((n) => {
        const change = changes.find((c) => c.id === n.id)
        if (!change) return n
        return {
          ...n,
          measured: change.dimensions ?? undefined,
        }
      })
      nodesRef.current = nodes
      return { ...prev, nodes }
    })
  }

  // ===== Selection =====

  const selectNode = (nodeId: string) => {
    setActiveSelectedNodeId(nodeId)
    updateSelectedNode(nodesRef.current, nodeId)
    logAction('节点:选中', 'graphOperations', {
      nodeId,
      label: nodesMapRef.current.get(nodeId)?.data.label,
      path: nodesMapRef.current.get(nodeId)?.data.path,
    })
  }

  const deselectNode = () => {
    setActiveSelectedNodeId(null)
    updateSelectedNode(nodesRef.current, null)
  }

  return {
    // Node CRUD
    createChildNode,
    deleteChildNode,
    renameNode,
    // Edge CRUD
    addEdge,
    deleteEdge,
    updateEdgeRelation,
    // Position changes
    applyNodePositionChanges,
    applyNodeRemoveChanges,
    applyNodeDimensionChanges,
    // Selection
    selectNode,
    deselectNode,
    // Internal
    scheduleSave,
    saveNow,
  }
}

export type GraphOperations = ReturnType<typeof buildGraphOperations>