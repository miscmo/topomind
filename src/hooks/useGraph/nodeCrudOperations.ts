import type { KnowledgeEdge, KnowledgeNode } from '../../types'
import { logger } from '../../core/logger'
import { logAction } from '../../core/log-backend'
import { generateId } from './graphBuilder'
import { resolveRoomChildRef } from '../../domain/graph/path-utils'
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
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
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
    getActiveGraphSession,
    loadRoom,
    rebuildMaps,
    saveNow,
    setState,
    getActiveSelectedNodeId,
    setActiveSelectedNodeId,
    isCreatingRef,
  } = deps

  const createChildNode = async (name: string, parentId?: string, position?: { x: number; y: number }): Promise<string | null> => {
    const graphSession = getActiveGraphSession()
    const dirPath = graphSession.roomPath
    const currentRoomPath = dirPath || graphSession.kbPath
    const targetPath = parentId ? resolveRoomChildRef(currentRoomPath, parentId) : currentRoomPath
    if (!targetPath) {
      logAction('节点:创建失败', 'graphOperations', {
        reason: dirPath ? 'targetPath-empty' : 'not-inside-room',
        nodeName: name,
        parentId: parentId || null,
        roomPath: graphSession.roomPath || null,
        kbPath: graphSession.kbPath || null,
      })
      return null
    }

    isCreatingRef.current = true

    try {
      const reloadPath = currentRoomPath || getActiveGraphSession().kbPath || ''
      const cardId = generateId('card-')
      const result = await createChildCard(storage, {
        name,
        parentRef: targetPath,
        reloadRef: reloadPath,
        cardId,
        position,
      })
      logAction('节点:创建', 'graphOperations', {
        nodeName: name,
        nodeId: cardId,
        parentPath: targetPath,
        newPath: result.newRef ?? null,
        roomPath: graphSession.roomPath || null,
        kbPath: graphSession.kbPath || null,
        reloadPath: reloadPath || null,
      })

      await loadRoom(reloadPath, true)
      isCreatingRef.current = false
      const savePath = getActiveGraphSession().roomPath || getActiveGraphSession().kbPath
      if (savePath) await saveNow(savePath)

      return cardId
    } catch (e) {
      isCreatingRef.current = false
      logger.catch('graphOperations', 'createChildNode', e)
      logAction('节点:创建失败', 'graphOperations', {
        reason: 'exception',
        nodeName: name,
        parentPath: targetPath,
        roomPath: graphSession.roomPath || null,
        kbPath: graphSession.kbPath || null,
        error: (e as Error)?.message || String(e),
      })
      return null
    }
  }

  const deleteChildNode = async (nodeId: string): Promise<boolean> => {
    const nodeLabel = nodesMapRef.current.get(nodeId)?.data.label ?? nodeId
    const dirPath = getActiveGraphSession().roomPath
    const currentRoomPath = dirPath || getActiveGraphSession().kbPath || ''
    const cardPath = resolveRoomChildRef(currentRoomPath, nodeId)
    try {
      await deleteCardAndPruneGraph(storage, cardPath, nodeId, nodesMapRef.current, edgesMapRef.current)
      logAction('节点:删除', 'graphOperations', { nodeId, label: nodeLabel, path: cardPath })

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
    const dirPath = getActiveGraphSession().roomPath
    const currentRoomPath = dirPath || getActiveGraphSession().kbPath || ''
    const cardPath = resolveRoomChildRef(currentRoomPath, nodeId)
    try {
      await renameCardInService(storage, cardPath, newName)
      const oldName = nodesMapRef.current.get(nodeId)?.data.label ?? nodeId
      logAction('节点:重命名', 'graphOperations', { nodeId, oldName, newName, path: cardPath })
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
