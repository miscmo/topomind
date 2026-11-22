import { useState, useCallback, useRef, useEffect } from 'react'
import { useStorage } from '../../../core/storage'
import { useConfirmStore } from '../../../shared/ui/ConfirmModal/confirmStore'
import { useDraftStore } from './draftStore'
import { useCardContentStore } from './cardContentStore'
import { useGraphStoreApi } from '../../../stores/graphStore'
import { logAction } from '../../../core/log-backend'
import { PERFORMANCE_METRICS, measurePerformance } from '../../../core/performance-log'
import { logger } from '../../../core/logger'
import { joinRefs } from '../../../domain/graph/path-utils'
import { topoDocumentIdFromPath, topoDocumentPath } from '../../../features/documents/types/documentTypes'
import { getTopoDocumentTypeDefinition } from '../../../features/documents/services/documentTypeRegistry'
import { useDetailPanelStore } from './detailPanelStore'
import { toast } from '../../../shared/ui/Toaster/toastStore'
import { useRightPanelStore } from '@/stores/rightPanelStore'
import type { TopoDocumentManifestItem, TopoDocumentMetaPatch, TopoDocumentType } from '../../../core/storage'

/**
 * 把主进程返回的更新项合并进本地列表：目标项换新对象，祖先链只换引用
 * （递归列表的 memo 需要沿路径把新 node 传下去），其余项原样复用。
 * 列表里没有该文档时原样返回，避免跨节点写盘把数据串到别的节点。
 */
function mergeDocumentMetaUpdate(
  documents: TopoDocumentManifestItem[],
  updated: TopoDocumentManifestItem,
): TopoDocumentManifestItem[] {
  if (!documents.some((item) => item.id === updated.id)) return documents
  const ancestorIds = new Set<string>()
  let cursor = updated.parentId ?? null
  while (cursor && !ancestorIds.has(cursor)) {
    ancestorIds.add(cursor)
    cursor = documents.find((item) => item.id === cursor)?.parentId ?? null
  }
  return documents.map((item) => {
    if (item.id === updated.id) return updated
    return ancestorIds.has(item.id) ? { ...item } : item
  })
}

export function useDetailDocuments({
  selectedNodeId,
  nodePath,
  activeDocumentPath,
  setActiveDocumentPath,
  flushDocumentSave,
  allowedDocumentIds,
  syncHasDetail = true,
}: {
  selectedNodeId: string | null
  nodePath: string | null
  activeDocumentPath: string
  setActiveDocumentPath: (path: string | ((prev: string) => string)) => void
  flushDocumentSave: () => Promise<void>
  /** 关联视图：默认激活项的兜底只允许落在这些文档上，避免跳到源节点其它文档 */
  allowedDocumentIds?: string[] | null
  /** 关联视图必须关掉：owner 节点有没有文档，不代表当前节点有自身文档 */
  syncHasDetail?: boolean
}) {
  const storage = useStorage()
  const confirm = useConfirmStore((s) => s.open)
  const storeApi = useGraphStoreApi()
  const clearDetailDraft = useDraftStore((s) => s.clearDetailDraft)
  const clearDetailContent = useCardContentStore((s) => s.clearDetailContent)
  const setDocumentListForNodePath = useDetailPanelStore((s) => s.setDocumentListForNodePath)

  const [topoDocuments, setTopoDocuments] = useState<TopoDocumentManifestItem[]>(() => (
    nodePath ? (useDetailPanelStore.getState().documentListsByNodePath[nodePath] ?? []) : []
  ))
  const [topoDocumentsCardPath, setTopoDocumentsCardPath] = useState(() => nodePath ?? '')
  const [isDocumentBusy, setIsDocumentBusy] = useState(false)
  const [documentLinkNotice, setDocumentLinkNotice] = useState('')

  // 列表数据的实时镜像：让文档操作回调不必把 topoDocuments 放进依赖数组。
  // 否则一次局部样式更新会让整条回调链全部换引用、进而击穿列表的 memo。
  const topoDocumentsRef = useRef(topoDocuments)
  topoDocumentsRef.current = topoDocuments
  const activeDocumentPathRef = useRef(activeDocumentPath)
  activeDocumentPathRef.current = activeDocumentPath
  const nodePathRef = useRef(nodePath)
  nodePathRef.current = nodePath
  const flushDocumentSaveRef = useRef(flushDocumentSave)
  flushDocumentSaveRef.current = flushDocumentSave
  // 元数据写盘串行队列：取色器 onChange / 连续点击会产生并发写，排队执行可避免
  // 后写覆盖先写，以及后一次变更检测读到上一次尚未落盘的状态。
  const metaWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

  const documentListRequestSeqRef = useRef(0)

  const syncNodeHasDetail = useCallback((targetNodeId: string | null, hasDetail: boolean) => {
    if (!targetNodeId) return
    const node = storeApi.getState().nodesMap.get(targetNodeId)
    if (!node || node.data.hasDetail === hasDetail) return

    const temporalState = storeApi.temporal?.getState?.()
    if (temporalState) temporalState.pause()
    storeApi.getState().updateNode(targetNodeId, (currentNode) => ({
      ...currentNode,
      data: { ...currentNode.data, hasDetail },
    }))
    if (temporalState) temporalState.resume()
  }, [storeApi])

  useEffect(() => {
    if (!nodePath) {
      setTopoDocuments([])
      setTopoDocumentsCardPath('')
      return
    }
    const state = useDetailPanelStore.getState()
    const cachedDocuments = state.documentListsByNodePath[nodePath] ?? []
    setTopoDocuments(cachedDocuments)
    setTopoDocumentsCardPath(nodePath)
    if (syncHasDetail && Object.prototype.hasOwnProperty.call(state.documentListsByNodePath, nodePath)) {
      syncNodeHasDetail(selectedNodeId, cachedDocuments.length > 0)
    }
  }, [nodePath, selectedNodeId, syncNodeHasDetail, syncHasDetail])

  const loadDocuments = useCallback(async (cardPath: string, requestSeq?: number, targetNodeId?: string | null) => {
    const nextTopoDocuments = await storage.listTopoDocuments(cardPath).catch((e) => {
      logger.catch('DetailPanel', `loadTopoDocuments: ${cardPath}`, e)
      return [] as TopoDocumentManifestItem[]
    })
    if (requestSeq !== undefined && documentListRequestSeqRef.current !== requestSeq) {
      return nextTopoDocuments
    }
    setTopoDocuments(nextTopoDocuments)
    setTopoDocumentsCardPath(cardPath)
    setDocumentListForNodePath(cardPath, nextTopoDocuments)
    if (syncHasDetail) syncNodeHasDetail(targetNodeId ?? selectedNodeId, nextTopoDocuments.length > 0)

    // Default to the first available document if the active one doesn't exist anymore.
    // 关联视图只展示被关联的几篇：兜底不能跳到所属节点文档树里的其它文档。
    const eligible = allowedDocumentIds
      ? nextTopoDocuments.filter((item) => allowedDocumentIds.includes(item.id))
      : nextTopoDocuments
    setActiveDocumentPath((currentPath) => {
      if (eligible.some((item) => topoDocumentPath(item.id) === currentPath)) {
        return currentPath
      }
      return eligible.length > 0 ? topoDocumentPath(eligible[0].id) : ''
    })
    return nextTopoDocuments
  }, [selectedNodeId, setDocumentListForNodePath, setActiveDocumentPath, storage, syncNodeHasDetail, allowedDocumentIds, syncHasDetail])

  useEffect(() => {
    if (!documentLinkNotice) return
    const timeoutId = window.setTimeout(() => {
      setDocumentLinkNotice('')
    }, 2600)
    return () => window.clearTimeout(timeoutId)
  }, [documentLinkNotice])

  const handleSelectDocument = useCallback(async (documentPath: string) => {
    if (documentPath === activeDocumentPath) return
    try {
      await flushDocumentSave()
      setActiveDocumentPath(documentPath)
    } catch (e) {
      setDocumentLinkNotice('保存当前文档失败，已取消切换。')
      logger.catch('DetailPanel', 'handleSelectDocument', e)
    }
  }, [activeDocumentPath, flushDocumentSave, setActiveDocumentPath])

  const createTopoDocumentByType = useCallback(async (type: TopoDocumentType, name: string, parentId?: string | null) => {
    if (!nodePath) return
    const nextName = name.trim()
    if (!nextName) return
    const definition = getTopoDocumentTypeDefinition(type)
    setIsDocumentBusy(true)
    try {
      await flushDocumentSave()
      const created = await storage.createTopoDocument(nodePath, { type, title: nextName, parentId: parentId || null })
      // 【按需展开】无文档节点新建文档：右栏可能处于自动折叠态，这里保证新建结果立刻可见。
      // 直接用 expandRightPanel（不走 applyRightPanelAutoVisibility），避免与选中事件互相覆盖。
      useRightPanelStore.getState().expandRightPanel()
      useRightPanelStore.getState().setRightPanelTab('detail')
      const createdDocumentPath = topoDocumentPath(created.id)
      const createdDocumentKey = joinRefs(nodePath, createdDocumentPath)
      clearDetailDraft(createdDocumentKey)
      clearDetailContent(createdDocumentKey)
      const nextDocs = await loadDocuments(nodePath)
      
      // Make sure the document we just created is actually loaded in the tree
      if (nextDocs.some(d => d.id === created.id)) {
        setActiveDocumentPath(createdDocumentPath)
      } else {
        // Fallback to reload again or log warning if it failed to appear
        logger.warn('DetailPanel', `Created document ${created.id} not found in the reloaded list.`)
      }
      logAction(definition.createLogName, 'DetailPanel', { nodePath, documentId: created.id, documentPath: created.path })
    } catch (e) {
      logger.catch('DetailPanel', `createTopoDocumentByType:${type}`, e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [nodePath, flushDocumentSave, storage, clearDetailDraft, clearDetailContent, loadDocuments, setActiveDocumentPath])

  const handleCreateTopoDocument = useCallback(async (type: TopoDocumentType, name: string, parentId?: string | null) => {
    await createTopoDocumentByType(type, name, parentId)
  }, [createTopoDocumentByType])

  const handleRenameDocument = useCallback(async (documentPath: string, name: string) => {
    if (!nodePath || documentPath === '') return
    const nextName = name.trim()
    if (!nextName) return
    const targetDocument = topoDocumentsRef.current.find((item) => topoDocumentPath(item.id) === documentPath)
    if (targetDocument && 'title' in targetDocument && targetDocument.title === nextName) return
    setIsDocumentBusy(true)
    try {
      if (documentPath === activeDocumentPath) {
        await flushDocumentSave()
      }
      const previousDocumentKey = joinRefs(nodePath, documentPath)
      
      const documentId = topoDocumentIdFromPath(documentPath)
      if (!documentId) return
      await storage.renameTopoDocument(nodePath, documentId, nextName)

      clearDetailDraft(previousDocumentKey)
      clearDetailContent(previousDocumentKey)
      await loadDocuments(nodePath)
      logAction('文档:重命名', 'DetailPanel', { nodePath, documentPath, nextName })
    } catch (e) {
      logger.catch('DetailPanel', 'handleRenameDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [nodePath, activeDocumentPath, flushDocumentSave, storage, clearDetailDraft, clearDetailContent, loadDocuments])

  const handleDeleteDocument = useCallback(async (documentPath: string = activeDocumentPath) => {
    if (!selectedNodeId || !nodePath || documentPath === '') return
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const label = node?.data.label ?? selectedNodeId
    const targetDocument = topoDocumentsRef.current.find((item) => topoDocumentPath(item.id) === documentPath)
    const documentName = targetDocument ? targetDocument.title : documentPath
    const confirmed = await confirm({
      title: '删除文档',
      message: `将删除节点「${label}」的文档「${documentName}」。文档会移入全局回收站。`
    })
    if (!confirmed) return
    setIsDocumentBusy(true)
    try {
      if (documentPath === activeDocumentPath) {
        await flushDocumentSave()
      }
      const documentKey = joinRefs(nodePath, documentPath)
      if (documentPath === activeDocumentPath) {
        setActiveDocumentPath('')
      }
      
      const documentId = topoDocumentIdFromPath(documentPath)
      if (!documentId) return
      await storage.deleteTopoDocument(nodePath, documentId)
      
      clearDetailDraft(documentKey)
      clearDetailContent(documentKey)
      
      const nextDocs = await loadDocuments(nodePath)
      if (documentPath === activeDocumentPath || activeDocumentPath === '') {
        setActiveDocumentPath(nextDocs.length > 0 ? topoDocumentPath(nextDocs[0].id) : '')
      }
      
      logAction('文档:删除', 'DetailPanel', { nodeId: selectedNodeId, label, path: nodePath, documentPath })
    } catch (e) {
      logger.catch('DetailPanel', 'handleDeleteDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [activeDocumentPath, clearDetailDraft, clearDetailContent, confirm, loadDocuments, nodePath, selectedNodeId, storeApi, storage, setActiveDocumentPath, flushDocumentSave])

  const handleMoveDocument = useCallback(async (documentId: string, newParentId: string | null, newSortOrder: number) => {
    if (!nodePath) return
    setIsDocumentBusy(true)
    try {
      if (topoDocumentPath(documentId) === activeDocumentPath) {
        await flushDocumentSave()
      }
      await storage.moveTopoDocument(nodePath, documentId, newParentId, newSortOrder)
      await loadDocuments(nodePath)
      logAction('文档:移动', 'DetailPanel', { nodePath, documentId, newParentId, newSortOrder })
    } catch (e) {
      logger.catch('DetailPanel', 'handleMoveDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [activeDocumentPath, flushDocumentSave, nodePath, storage, loadDocuments])

  const handleMoveDocumentToCard = useCallback(async (documentId: string, targetCardPath: string) => {
    if (!nodePath) return
    setIsDocumentBusy(true)
    try {
      if (topoDocumentPath(documentId) === activeDocumentPath) {
        await flushDocumentSave()
      }
      const result = await storage.moveTopoDocumentToCard(nodePath, documentId, targetCardPath)

      // 刷新源节点文档列表；被移动的文档已不在当前节点，清理/重置激活项
      const nextDocs = await loadDocuments(nodePath)
      if (topoDocumentPath(documentId) === activeDocumentPath) {
        setActiveDocumentPath(nextDocs.length > 0 ? topoDocumentPath(nextDocs[0].id) : '')
      }

      const targetLabel = targetCardPath === '__ROOT__'
        ? '根节点'
        : (storeApi.getState().nodesMap.get(targetCardPath)?.data.label ?? targetCardPath)

      // 撤销：删除目标节点上的副本（进回收站）+ 从源节点回收站恢复原文档（含子文档）
      const undo = async () => {
        try {
          if (result.moved[0]) {
            await storage.deleteTopoDocument(targetCardPath, result.moved[0].id)
          }
          const trash = await storage.listTrashTopoDocuments(nodePath)
          const trashItem = trash.find((t) => t.documentId === documentId)
          if (trashItem) {
            const restored = await storage.restoreTrashTopoDocument(nodePath, trashItem.trashName)
            setActiveDocumentPath(topoDocumentPath(restored.id))
          }
          await loadDocuments(nodePath)
          logAction('文档:跨节点移动-撤销', 'DetailPanel', { nodePath, documentId, targetCardPath })
        } catch (e) {
          logger.catch('DetailPanel', 'undoMoveDocumentToCard', e)
          toast({ level: 'error', title: '撤销失败', message: (e as Error)?.message || String(e), duration: 6000 })
        }
      }

      toast({
        level: 'info',
        title: `已移动到「${targetLabel}」`,
        message: `移动 ${result.movedCount} 篇文档${result.attachmentCount > 0 ? `，${result.attachmentCount} 个附件随文档迁移` : ''}${result.attachmentCleaned > 0 ? `，源节点清理 ${result.attachmentCleaned} 个孤儿附件` : ''}`,
        duration: 6000,
        action: { label: '撤销', onClick: () => void undo() },
      })
      logAction('文档:跨节点移动', 'DetailPanel', { nodePath, documentId, targetCardPath, movedCount: result.movedCount, attachmentCount: result.attachmentCount, attachmentCleaned: result.attachmentCleaned })
    } catch (e) {
      logger.catch('DetailPanel', 'handleMoveDocumentToCard', e)
      toast({ level: 'error', title: '移动失败', message: (e as Error)?.message || String(e), duration: 6000 })
    } finally {
      setIsDocumentBusy(false)
    }
  }, [activeDocumentPath, flushDocumentSave, nodePath, storage, loadDocuments, storeApi])

  /**
   * 文档列表项样式（图标 / 颜色 / 字号 / 字形）。
   *
   * 只写这一项、只更新这一项：主进程 updateTopoDocumentMeta 已经返回更新后的
   * manifest item，无需再 loadDocuments 全量重读；也不设置 isDocumentBusy——
   * 那个全局标志会下发到每一行，让整列图标和按钮在写盘期间一起变灰再恢复。
   * 写盘按队列串行，避免连续取色 / 连点产生并发写和中间态读取。
   */
  const handleUpdateDocumentMeta = useCallback((documentPath: string, patch: TopoDocumentMetaPatch) => {
    if (!nodePath || documentPath === '') return
    const documentId = topoDocumentIdFromPath(documentPath)
    if (!documentId) return
    const targetNodePath = nodePath

    const writeMeta = async () => {
      // 写盘期间用户可能已经切到别的节点：变更检测和合并都以「目标节点」的
      // 列表为准，不能误用当前节点的新列表。
      const sourceDocuments = nodePathRef.current === targetNodePath
        ? topoDocumentsRef.current
        : (useDetailPanelStore.getState().documentListsByNodePath[targetNodePath] ?? [])
      const targetDocument = sourceDocuments.find((item) => item.id === documentId)
      if (!targetDocument) return
      // 仅当 patch 中所有字段都无实际变化时才跳过；组合 patch 中一个
      // 字段相同不能阻止另一个已变化字段写盘。字体样式三件套一并纳入变更检测，
      // 否则「编辑样式」面板里只改字号时会被误判成无变化、静默不写盘。
      const iconChanged = patch.icon !== undefined
        && (patch.icon?.trim() || '') !== (targetDocument.icon ?? '')
      const colorChanged = patch.color !== undefined
        && (patch.color || '') !== (targetDocument.color ?? '')
      const fontSizeChanged = patch.fontSize !== undefined
        && (patch.fontSize ?? null) !== (targetDocument.fontSize ?? null)
      const fontWeightChanged = patch.fontWeight !== undefined
        && (patch.fontWeight ?? null) !== (targetDocument.fontWeight ?? null)
      const fontStyleChanged = patch.fontStyle !== undefined
        && (patch.fontStyle ?? null) !== (targetDocument.fontStyle ?? null)
      if (!iconChanged && !colorChanged && !fontSizeChanged && !fontWeightChanged && !fontStyleChanged) return

      try {
        if (documentPath === activeDocumentPathRef.current) {
          await flushDocumentSaveRef.current()
        }
        const updated = await storage.updateTopoDocumentMeta(targetNodePath, documentId, patch)
        const nextDocuments = mergeDocumentMetaUpdate(sourceDocuments, updated)
        if (nextDocuments === sourceDocuments) return
        if (nodePathRef.current === targetNodePath) {
          // 局部替换：只有目标项及祖先链换引用，其余行靠 memo 跳过 render。
          topoDocumentsRef.current = nextDocuments
          setTopoDocuments(nextDocuments)
        }
        setDocumentListForNodePath(targetNodePath, nextDocuments)
        logAction('文档:修改样式', 'DetailPanel', { nodePath: targetNodePath, documentPath, patch })
      } catch (e) {
        // 排查提示：若主进程未重启（旧 IPC 处理器缺失），此处会捕获
        // "No handler registered for 'fs:updateTopoDocumentMeta'" 之类的错误。
        console.warn('[DocumentMeta] 更新文档图标/颜色失败（请确认应用已完全重启，主进程需加载最新代码）', e)
        logger.catch('DetailPanel', 'handleUpdateDocumentMeta', e)
      }
    }

    const result = metaWriteQueueRef.current.then(writeMeta)
    metaWriteQueueRef.current = result.catch(() => undefined)
  }, [nodePath, storage, setDocumentListForNodePath])

  const handleExportTopoDocument = useCallback(async (documentPath: string) => {
    if (!nodePath) return
    const documentId = topoDocumentIdFromPath(documentPath)
    if (!documentId) return
    setIsDocumentBusy(true)
    try {
      if (documentPath === activeDocumentPath) {
        await flushDocumentSave()
      }
      const payload = await measurePerformance(
        PERFORMANCE_METRICS.documentExport,
        () => storage.exportTopoDocument(nodePath, documentId),
        { module: 'DetailPanel', params: { nodePath, documentId } },
      )
      const blob = new Blob([payload.content], { type: payload.mimeType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = payload.fileName
      try {
        document.body.appendChild(anchor)
        anchor.click()
      } finally {
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
      }
      logAction('多类型文档:导出', 'DetailPanel', { nodePath, documentId, fileName: payload.fileName, type: payload.type })
    } catch (e) {
      logger.catch('DetailPanel', 'handleExportTopoDocument', e)
    } finally {
      setIsDocumentBusy(false)
    }
  }, [activeDocumentPath, flushDocumentSave, nodePath, storage])

  const handleOpenCurrentDocumentFolder = useCallback(async (activeTopoDocumentId: string | null) => {
    if (!nodePath || !activeTopoDocumentId) return
    setDocumentLinkNotice('')
    try {
      await flushDocumentSave()
      const opened = await storage.openTopoDocumentFolder(nodePath, activeTopoDocumentId)
      if (!opened) {
        setDocumentLinkNotice('无法打开当前文档所在目录')
      }
    } catch (e) {
      setDocumentLinkNotice('打开当前文档所在目录失败')
      logger.catch('DetailPanel', 'handleOpenCurrentDocumentFolder', e)
    }
  }, [flushDocumentSave, nodePath, storage])

  return {
    topoDocuments,
    setTopoDocuments,
    topoDocumentsCardPath,
    setTopoDocumentsCardPath,
    isDocumentBusy,
    documentLinkNotice,
    documentListRequestSeqRef,
    loadDocuments,
    handleSelectDocument,
    handleCreateTopoDocument,
    handleRenameDocument,
    handleDeleteDocument,
    handleMoveDocument,
    handleMoveDocumentToCard,
    handleUpdateDocumentMeta,
    handleExportTopoDocument,
    handleOpenCurrentDocumentFolder,
  }
}
