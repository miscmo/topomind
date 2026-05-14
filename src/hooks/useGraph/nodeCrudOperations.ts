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
import { useGraphStore } from '../../stores/graphStore'
import { tabStore } from '../../stores/tabStore'

export interface NodeCrudOperationsDeps {
  tabId: string
  storage: StorageApi
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  saveNow: (dirPath: string) => Promise<void>
  isCreatingRef: { current: boolean }
}

export function buildNodeCrudOperations(deps: NodeCrudOperationsDeps) {
  const {
    tabId,
    storage,
    getActiveGraphSession,
    loadRoom,
    saveNow,
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
    const store = useGraphStore.getState()
    const nodeLabel = store.nodesMap.get(nodeId)?.data.label ?? nodeId
    const dirPath = getActiveGraphSession().roomPath
    const currentRoomPath = dirPath || getActiveGraphSession().kbPath || ''
    const cardPath = resolveRoomChildRef(currentRoomPath, nodeId)
    try {
      await deleteCardAndPruneGraph(storage, cardPath, nodeId, store.nodesMap, store.edgesMap)
      logAction('节点:删除', 'graphOperations', { nodeId, label: nodeLabel, path: cardPath })

      if (currentRoomPath) await saveNow(currentRoomPath)
      await loadRoom(currentRoomPath)
      if (tabStore.getState().getTabSelectedNode(tabId) === nodeId) {
        tabStore.getState().setTabSelectedNode(tabId, null)
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
      const store = useGraphStore.getState()
      const oldName = store.nodesMap.get(nodeId)?.data.label ?? nodeId
      logAction('节点:重命名', 'graphOperations', { nodeId, oldName, newName, path: cardPath })
      
      store.updateNode(nodeId, (node) => ({ ...node, data: { ...node.data, label: newName } }))

      if (currentRoomPath) await saveNow(currentRoomPath)
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
