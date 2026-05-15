import type { KnowledgeEdge, KnowledgeNode, KnowledgeNodeStyle } from '../../types'
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
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'
import { tabStore } from '../../stores/tabStore'

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

function normalizeNodeStylePatch(style: KnowledgeNodeStyle): KnowledgeNodeStyle {
  const next: KnowledgeNodeStyle = {}
  if (Number.isFinite(style.headerFontSize)) next.headerFontSize = clamp(style.headerFontSize as number, 8, 28)
  if (Number.isFinite(style.bodyFontSize)) next.bodyFontSize = clamp(style.bodyFontSize as number, 8, 24)
  if (typeof style.headerColor === 'string') next.headerColor = style.headerColor.trim()
  if (typeof style.headerBackgroundColor === 'string') next.headerBackgroundColor = style.headerBackgroundColor.trim()
  return next
}

export interface NodeCrudOperationsDeps {
  tabId: string
  storage: StorageApi
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  loadRoom: (path: string, isCreating?: boolean) => Promise<void>
  saveNow: (dirPath: string) => Promise<void>
  isCreatingRef: { current: boolean }
  storeApi: StoreApi<GraphState>
}

export function buildNodeCrudOperations(deps: NodeCrudOperationsDeps) {
  const {
    tabId,
    storage,
    getActiveGraphSession,
    loadRoom,
    saveNow,
    isCreatingRef,
    storeApi,
  } = deps

  const createChildNode = async (name: string, parentId?: string, position?: { x: number; y: number }, options?: { editTitle?: boolean }): Promise<string | null> => {
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
      if (reloadPath) await saveNow(reloadPath)
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
      if (options?.editTitle) {
        const loadedStore = storeApi.getState()
        loadedStore.setNodes(loadedStore.nodes.map((node) => ({
          ...node,
          selected: node.id === cardId,
          data: node.id === cardId
            ? {
                ...node.data,
                titleEditRequested: true,
              }
            : node.data,
        })))
      }
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
    const store = storeApi.getState()
    const nodeLabel = store.nodesMap.get(nodeId)?.data.label ?? nodeId
    const dirPath = getActiveGraphSession().roomPath
    const currentRoomPath = dirPath || getActiveGraphSession().kbPath || ''
    const cardPath = resolveRoomChildRef(currentRoomPath, nodeId)
    try {
      await deleteCardAndPruneGraph(storage, cardPath, nodeId, store.nodesMap, store.edgesMap)
      logAction('节点:删除', 'graphOperations', { nodeId, label: nodeLabel, path: cardPath })

      if (currentRoomPath) await saveNow(currentRoomPath)
      await loadRoom(currentRoomPath)
      const isSelected = storeApi.getState().nodes.find(n => n.id === nodeId)?.selected
      if (isSelected) {
        let changed = false
        const nextNodes = storeApi.getState().nodes.map(n => {
          if (!n.selected) return n
          changed = true
          return { ...n, selected: false }
        })
        if (changed) storeApi.getState().setNodes(nextNodes)
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
      const store = storeApi.getState()
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

  const updateNodeStyle = async (nodeId: string, style: KnowledgeNodeStyle): Promise<void> => {
    const store = storeApi.getState()
    const node = store.nodesMap.get(nodeId)
    if (!node) return
    const patch = normalizeNodeStylePatch(style)
    const currentStyle = node.data.nodeStyle ?? {}
    const nextStyle = { ...currentStyle, ...patch }
    const changed = Object.entries(patch).some(([key, value]) => currentStyle[key as keyof KnowledgeNodeStyle] !== value)
    if (!changed) return

    store.updateNode(nodeId, (currentNode) => ({
      ...currentNode,
      data: {
        ...currentNode.data,
        nodeStyle: nextStyle,
      },
    }))

    const graphSession = getActiveGraphSession()
    const currentRoomPath = graphSession.roomPath || graphSession.kbPath || ''
    if (currentRoomPath) await saveNow(currentRoomPath)
    logAction('节点:更新样式', 'graphOperations', { nodeId, style: patch })
  }

  return {
    createChildNode,
    deleteChildNode,
    renameNode,
    updateNodeStyle,
  }
}
