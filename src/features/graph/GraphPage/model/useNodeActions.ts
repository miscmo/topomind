/**
 * useNodeActions — Node/edge action handlers
 *
 * Handles context-menu node/edge operations.
 *
 * NOTE: Use nodesMapRef/edgesMapRef (O(1) lookup) instead of nodesRef/edgesRef
 * arrays because refs are recreated on every context re-creation (after setState),
 * causing stale closures. The Map objects are consistently updated by rebuildMaps().
 */
import { useCallback } from 'react'
import { useConfirmStore } from '../../../../shared/ui/ConfirmModal/confirmStore'
import { logAction } from '../../../../core/log-backend'
import type { KnowledgeNode } from '../../../../types'
import type { GraphContextValue } from '../../../../contexts/GraphContext'
import { useEdgeActions } from './useEdgeActions'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import { useStorage } from '../../../../core/storage'
import { tabStore } from '../../../../stores/tabs/tabStore'
import { isActiveCanvasReadOnly } from '../../../../stores/canvasReadOnlyStore'
import { resolveRoomChildRef } from '../../../../domain/graph/path-utils'
import { EXCALIDRAW_CONTAINER_TYPE } from '../../../documents/ExcalidrawDocument/excalidrawDocumentTypes'
import { CARDSPEC_CONTAINER_TYPE } from '../../../documents/CardSpecDocument/cardSpecTypes'

/** 容器创建参数：新增一种容器只加一个变体，创建链路不变。 */
type ContainerVariant = 'excalidraw' | 'cardspec'
const CONTAINER_VARIANTS: Record<ContainerVariant, { name: string; documentType: 'excalidraw' | 'cardspec'; containerType: string }> = {
  excalidraw: { name: '流程图容器', documentType: 'excalidraw', containerType: EXCALIDRAW_CONTAINER_TYPE },
  cardspec: { name: '知识卡片容器', documentType: 'cardspec', containerType: CARDSPEC_CONTAINER_TYPE },
}

export interface UseNodeActionsOptions {
  /** Called after an action to notify parent (e.g., for focus management) */
  onAction?: () => void
  graph: GraphContextValue
}

export function useNodeActions(options: UseNodeActionsOptions) {
  const storeApi = useGraphStoreApi()
  const { onAction, graph } = options
  const confirm = useConfirmStore((s) => s.open)
  const storage = useStorage()
  const { handleEdgeDelete, handleEdgeStyle } = useEdgeActions({ graph, onAction })

  // Use nodesMapRef/edgesMapRef (Map) for O(1) lookup instead of nodesRef/edgesRef arrays.
  // Maps are consistently updated by rebuildMaps() on every state change.
  // Arrays via refs are recreated on every context re-creation, causing stale closures.
  const findNodeById = useCallback((nodeId: string): KnowledgeNode | undefined => {
    return storeApi.getState().nodesMap.get(nodeId)
  }, [storeApi])

  const handleNewChild = useCallback(async (position?: { x: number; y: number }) => {
    logAction('节点:创建', 'useNodeActions', { 
      nodeName: '新节点',
      source: 'pane-context-menu',
      position 
    })
    await graph.createChildNode('新节点', undefined, position, { editTitle: true })
    onAction?.()
  }, [graph, onAction])

  /**
   * 创建容器节点的唯一路径：先建普通节点（乐观插入）→ 在其 _docs 下建载荷文档
   * → 只更新这一个节点的 kind/container 指针 → flush + 原地刷新。
   * 载荷创建失败时保留普通知识节点，绝不留下指向空文档的容器。
   * variant 决定载荷类型（excalidraw 白板 / cardspec 知识卡片）。
   */
  const createContainerChild = useCallback(async (position: { x: number; y: number } | undefined, variant: ContainerVariant) => {
    if (isActiveCanvasReadOnly()) return
    const config = CONTAINER_VARIANTS[variant]
    const tabs = tabStore.getState()
    const session = tabs.getGraphSession(tabs.activeTabId)
    const roomPath = session.roomPath || session.kbPath
    if (!roomPath) return
    const name = config.name
    logAction('容器:创建', 'useNodeActions', { name, roomPath, position, variant })
    const cardId = await graph.createChildNode(name, undefined, position)
    if (!cardId) return
    const nodePath = resolveRoomChildRef(roomPath, cardId)
    try {
      const doc = await storage.createTopoDocument(nodePath, {
        type: config.documentType,
        title: name,
      })
      const documentId = String(doc?.id || '')
      if (!documentId) throw new Error('载荷文档未返回 id')
      storeApi.getState().updateNode(cardId, (node) => ({
        ...node,
        type: 'containerCard',
        width: 360,
        height: 240,
        data: {
          ...node.data,
          kind: 'container',
          container: { type: config.containerType, documentId },
          collapsedWidth: 360,
          collapsedHeight: 240,
        },
      }))
      await graph.flushCurrentRoomSave()
      await graph.refreshCurrentRoom()
    } catch (e) {
      logAction('容器:创建失败', 'useNodeActions', {
        nodeId: cardId, variant, error: (e as Error)?.message || String(e),
      })
    }
    onAction?.()
  }, [graph, onAction, storage, storeApi])

  const handleNewContainerChild = useCallback(async (position?: { x: number; y: number }) => {
    await createContainerChild(position, 'excalidraw')
  }, [createContainerChild])

  const handleNewCardSpecContainerChild = useCallback(async (position?: { x: number; y: number }) => {
    await createContainerChild(position, 'cardspec')
  }, [createContainerChild])

  const confirmAndDeleteNode = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node) return false
    const confirmed = await confirm({ title: '删除节点', message: `将删除节点「${node.data.label}」。若该节点已有文档或子房间，其目录会移入全局回收站。` })
    if (!confirmed) return false
    logAction('节点:删除', 'useNodeActions', { nodeId, label: node.data.label, source: 'context-menu' })
    await graph.deleteChildNode(nodeId)
    return true
  }, [confirm, findNodeById, graph])

  const handleEnterNode = useCallback(async (nodeId: string) => {
    const node = findNodeById(nodeId)
    if (!node) return
    const cardRef = typeof node.data.cardRef === 'string' ? node.data.cardRef : node.id
    const absoluteChildPath = resolveRoomChildRef(typeof node.data.parent === 'string' ? node.data.parent : '', cardRef)
    logAction('节点:进入', 'useNodeActions', { nodeId, label: node.data.label, source: 'context-menu' })
    await graph.navigateToChildRoom(absoluteChildPath, node.data.label)
    onAction?.()
  }, [findNodeById, graph, onAction])

  const handleDelete = useCallback(async (nodeId: string) => {
    const deleted = await confirmAndDeleteNode(nodeId)
    if (deleted) onAction?.()
  }, [confirmAndDeleteNode, onAction])

  return {
    handleNewChild,
    handleNewContainerChild,
    handleNewCardSpecContainerChild,
    handleEnterNode,
    handleDelete,
    handleEdgeDelete,
    handleEdgeStyle,
  }
}
