import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'
import {
  createChildCard,
  deleteCardAndPruneGraph,
  renameCard as renameCardInService,
} from '../../domain/card/cardService'
import type { StorageApi } from './graphOperations'

export interface NodeCrudOperationsDeps {
  storage: StorageApi
  nodesMapRef: React.MutableRefObject<Map<string, KnowledgeNode>>
  edgesMapRef: React.MutableRefObject<Map<string, KnowledgeEdge>>
  nodesRef: React.MutableRefObject<KnowledgeNode[]>
  getActiveNavState: () => { kbPath: string; roomPath: string; roomName: string }
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  rebuildMaps: (nodes: KnowledgeNode[], edges: KnowledgeEdge[]) => void
  saveNow: (dirPath: string) => Promise<void>
  setState: (updater: (prev: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }) => { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; loading?: boolean; selectedNode?: KnowledgeNode | null }) => void
  getActiveSelectedNodeId: () => string | null
  setActiveSelectedNodeId: (nodeId: string | null) => void
  isCreatingRef: React.MutableRefObject<boolean>
}

export function buildNodeCrudOperations(deps: NodeCrudOperationsDeps) {
  const {
    storage,
    nodesMapRef,
    edgesMapRef,
    nodesRef,
    getActiveNavState,
    loadRoom,
    rebuildMaps,
    saveNow,
    setState,
    getActiveSelectedNodeId,
    setActiveSelectedNodeId,
    isCreatingRef,
  } = deps

  const createChildNode = async (name: string, parentId?: string, position?: { x: number; y: number }): Promise<string | null> => {
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

    isCreatingRef.current = true

    try {
      const reloadPath = dirPath || getActiveNavState().kbPath || ''
      const result = await createChildCard(storage, {
        name,
        parentRef: targetPath,
        reloadRef: reloadPath,
        nodesById: nodesMapRef.current,
        position,
      })
      logAction('节点:创建', 'graphOperations', {
        nodeName: name,
        parentPath: targetPath,
        newPath: result.newRef ?? null,
        roomPath: nav.roomPath || null,
        kbPath: nav.kbPath || null,
        reloadPath: reloadPath || null,
      })

      await loadRoom(reloadPath, true)
      await saveNow(getActiveNavState().roomPath)

      return result.newRef
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
      await deleteCardAndPruneGraph(storage, nodeId, nodesMapRef.current, edgesMapRef.current)
      logAction('节点:删除', 'graphOperations', { nodeId, label: nodeLabel, path: nodeId })

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
      await renameCardInService(storage, nodeId, newName)
      const oldName = nodesMapRef.current.get(nodeId)?.data.label ?? nodeId
      logAction('节点:重命名', 'graphOperations', { nodeId, oldName, newName, path: nodeId })
      setState((prev) => {
        const nodes = prev.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, label: newName } } : n
        )
        nodesRef.current = nodes
        rebuildMaps(nodes, prev.edges)
        return { ...prev, nodes }
      })
      if (dirPath) await saveNow(dirPath)
      return true
    } catch (e) {
      logger.catch('graphOperations', 'renameNode', e)
      return false
    }
  }

  return {
    createChildNode,
    deleteChildNode,
    renameNode,
  }
}
