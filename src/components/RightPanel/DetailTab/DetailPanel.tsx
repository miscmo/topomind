/**
 * 右侧详情面板
 * 显示节点 Markdown 内容，支持预览/编辑切换
 */
import { useEffect, useState, useRef, memo, useCallback } from 'react'
import { useStorage } from '../../../core/storage'
import { useRightPanelStore } from '../../../stores/rightPanelStore'
import { useConfirmStore } from '../../../stores/confirmStore'
import { useGraphContext } from '../../../contexts/GraphContext'
import { useGraphStore, useSelectedNodeId, useGraphStoreApi } from '../../../stores/graphStore'
import { useDraftStore } from '../../../stores/draftStore'
import { useCardContentStore } from '../../../stores/cardContentStore'
import MarkdownEditor from './MarkdownEditor'
import MarkdownViewer from '../../MarkdownViewer'
import styles from './DetailTab.module.css'
import { logAction } from '../../../core/log-backend'
import { logger } from '../../../core/logger'
import { registerTabSaver } from '../../../core/close-guard'
import { tabStore } from '../../../stores/tabStore'
import { resolveRoomChildRef } from '../../../domain/graph/path-utils'

interface DetailPanelProps {
  tabId: string
}

const DetailPanel = memo(function DetailPanel({ tabId }: DetailPanelProps) {
  const selectedNodeId = useSelectedNodeId()
  const storeApi = useGraphStoreApi()
  const storage = useStorage()
  const collapseRightPanel = useRightPanelStore((s) => s.collapseRightPanel)
  const graph = useGraphContext()
  const confirm = useConfirmStore((s) => s.open)

  const selectedNode = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId) : null)
  const resolveNodePath = useCallback((nodeId: string) => {
    const graphSession = tabStore.getState().getGraphSession(tabId)
    return resolveRoomChildRef(graphSession.roomPath || graphSession.kbPath, nodeId)
  }, [tabId])
  const nodePath = selectedNodeId ? resolveNodePath(selectedNodeId) : null

  const editMode = useDraftStore((s) => nodePath ? (s.detailEditModes[nodePath] || false) : false)
  const setEditMode = useDraftStore((s) => s.setDetailEditMode)
  const draftMarkdown = useDraftStore((s) => nodePath ? (s.detailDrafts[nodePath] ?? '') : '')
  const setDraftMarkdown = useDraftStore((s) => s.setDetailDraft)
  const detailEntry = useCardContentStore((s) => nodePath ? s.detailEntries[nodePath] : undefined)
  const loadDetailMarkdown = useCardContentStore((s) => s.loadDetailMarkdown)
  const setDetailMarkdown = useCardContentStore((s) => s.setDetailMarkdown)

  const [savedMarkdown, setSavedMarkdown] = useState('')
  const [renameMode, setRenameMode] = useState(false)
  const [newName, setNewName] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const markdownRequestSeqRef = useRef(0)

  const childCount = selectedNode?.data.childCount ?? 0

  // Load markdown when node changes
  useEffect(() => {
    setRenameMode(false)
    setNewName('')

    const requestSeq = ++markdownRequestSeqRef.current
    if (!selectedNodeId || !nodePath) return

    const cachedContent = useCardContentStore.getState().detailEntries[nodePath]?.content
    if (cachedContent !== undefined) {
      setSavedMarkdown(cachedContent)
      if (useDraftStore.getState().detailDrafts[nodePath] === undefined) {
        setDraftMarkdown(nodePath, cachedContent)
      }
    }

    loadDetailMarkdown(nodePath, storage)

    storage.readMarkdown(nodePath).then((content: string) => {
      if (markdownRequestSeqRef.current !== requestSeq) return
      setDetailMarkdown(nodePath, content)
      setSavedMarkdown(content)
      // Initialize draft only if there is none
      if (useDraftStore.getState().detailDrafts[nodePath] === undefined) {
        setDraftMarkdown(nodePath, content)
      }
    }).catch(() => {
      if (markdownRequestSeqRef.current !== requestSeq) return
      setDetailMarkdown(nodePath, '')
      setSavedMarkdown('')
      if (useDraftStore.getState().detailDrafts[nodePath] === undefined) {
        setDraftMarkdown(nodePath, '')
      }
    })
  }, [selectedNodeId, nodePath, storage, setDraftMarkdown, loadDetailMarkdown, setDetailMarkdown])

  useEffect(() => {
    if (detailEntry) {
      setSavedMarkdown(detailEntry.content)
    }
  }, [detailEntry])

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renameMode && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renameMode])

  // ===== Save markdown =====
  // Use nodesMapRef for stale-closure-safe access. selectedNode from render-time
  // closure can be stale when the selected node changes without re-rendering DetailPanel.
  const handleSave = async () => {
    if (!selectedNodeId || !nodePath) return
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const label = node?.data.label
    try {
      await storage.writeMarkdown(nodePath, draftMarkdown)
      setDetailMarkdown(nodePath, draftMarkdown)
      setSavedMarkdown(draftMarkdown)
      logAction('内容:保存', 'DetailPanel', { nodePath, label })
      setEditMode(nodePath, false)
    } catch (e) {
      logger.catch('DetailPanel', 'handleSave', e)
    }
  }

  // ===== Rename node =====
  // Use nodesMapRef for stale-closure-safe access. selectedNode from render-time
  // closure can be stale when the selected node changes without re-rendering DetailPanel.
  const handleRenameConfirm = () => {
    if (!renameMode || !newName.trim() || !selectedNodeId) {
      setRenameMode(false)
      return
    }
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const oldLabel = node?.data.label ?? selectedNode?.data.label
    const path = resolveNodePath(selectedNodeId)
    logAction('节点:重命名', 'DetailPanel', {
      nodeId: selectedNodeId,
      oldName: oldLabel,
      newName: newName.trim(),
      path,
    })
    graph.renameNode(selectedNodeId, newName.trim())
    setRenameMode(false)
  }

  // ===== Delete node =====
  // Use nodesMapRef for stale-closure-safe node data access.
  // selectedNode from render-time closure can be stale when the selected node changes
  // without triggering a DetailPanel re-render (e.g., via React Flow selection).
  const handleDelete = useCallback(async () => {
    if (!selectedNodeId) return
    const node = storeApi.getState().nodesMap.get(selectedNodeId)
    const label = node?.data.label ?? selectedNodeId
    const path = resolveNodePath(selectedNodeId)
    const confirmed = await confirm({ title: '删除节点', message: `将删除节点「${label}」。此操作不可撤销。` })
    if (!confirmed) return
    logAction('节点:删除', 'DetailPanel', { nodeId: selectedNodeId, label, path })
    graph.deleteChildNode(selectedNodeId)
    collapseRightPanel()
  }, [selectedNodeId, confirm, graph, collapseRightPanel, resolveNodePath, storeApi])

  const flushMarkdownSave = useCallback(async () => {
    if (!editMode || !selectedNodeId || !nodePath) return
    if (draftMarkdown === savedMarkdown) return
    await handleSave()
  }, [editMode, selectedNodeId, nodePath, draftMarkdown, savedMarkdown, handleSave])

  useEffect(() => {
    return registerTabSaver(tabId, flushMarkdownSave)
  }, [tabId, flushMarkdownSave])

  // ===== Empty state =====
  if (!selectedNodeId || !selectedNode) {
    return (
      <div id="detail-panel" className={styles.detailPanel}>
        <div className={styles.emptyState}>选择一个节点查看详情</div>
      </div>
    )
  }

  const { data } = selectedNode

  return (
    <div id="detail-panel" className={styles.detailPanel}>
      {/* 标题栏 */}
      <div className={styles.title}>
        <div className={styles.titleMain}>
          {renameMode ? (
            <input
              ref={renameInputRef}
              className={styles.renameInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={handleRenameConfirm}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameConfirm()
                if (e.key === 'Escape') setRenameMode(false)
              }}
            />
          ) : (
            <span className={styles.titleText} title={nodePath ?? undefined}>
              {data.label}
            </span>
          )}
          {childCount > 0 && (
            <span className={styles.badge} title="含有子概念">
              {childCount} 子
            </span>
          )}
        </div>
        <div className={styles.titleSub}>{nodePath}</div>
      </div>

      {/* 操作按钮行 */}
      <div className={styles.actions}>
        {!editMode ? (
          <>
            <button onClick={() => nodePath && setEditMode(nodePath, true)} title="编辑 Markdown">
              编辑
            </button>
            <button
              onClick={() => {
                setNewName(data.label)
                setRenameMode(true)
              }}
              title="重命名节点"
            >
              重命名
            </button>
            <button
              onClick={handleDelete}
              title="删除节点"
              className={styles.deleteBtn}
            >
              删除
            </button>
          </>
        ) : (
          <>
            <button className={styles.saveBtn} onClick={handleSave}>
              保存
            </button>
            <button
              onClick={() => {
                if (!nodePath) return
                // Reload original content — use nodesMapRef for stale-closure-safe access
                const requestSeq = ++markdownRequestSeqRef.current
                storage.readMarkdown(nodePath).then((content: string) => {
                  if (markdownRequestSeqRef.current !== requestSeq) return
                  setDetailMarkdown(nodePath, content)
                  setDraftMarkdown(nodePath, content)
                  setSavedMarkdown(content)
                }).catch(() => {
                  if (markdownRequestSeqRef.current !== requestSeq) return
                  setDetailMarkdown(nodePath, '')
                  setDraftMarkdown(nodePath, '')
                  setSavedMarkdown('')
                })
                setEditMode(nodePath, false)
              }}
            >
              取消
            </button>
          </>
        )}
      </div>

      {/* 内容区 */}
      <div className={styles.body}>
        {editMode ? (
          <div className={styles.mdEditorWrap}>
            <MarkdownEditor
              value={draftMarkdown}
              onChange={(val) => nodePath && setDraftMarkdown(nodePath, val)}
              onSave={handleSave}
              attachmentCardPath={nodePath}
              placeholder="在此输入 Markdown 内容..."
            />
          </div>
        ) : (
          <>
            <MarkdownViewer content={draftMarkdown} className={styles.markdownBody} attachmentCardPath={nodePath} />
          </>
        )}
      </div>
    </div>
  )
})

export default DetailPanel
