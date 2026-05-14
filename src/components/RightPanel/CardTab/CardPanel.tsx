import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useStorage } from '../../../core/storage'
import { registerTabSaver } from '../../../core/close-guard'
import { logAction } from '../../../core/log-backend'
import { logger } from '../../../core/logger'
import { resolveRoomChildRef } from '../../../domain/graph/path-utils'
import { useGraphStore, useSelectedNodeId, useGraphStoreApi } from '../../../stores/graphStore'
import { tabStore } from '../../../stores/tabStore'
import { useCardContentStore } from '../../../stores/cardContentStore'
import { useDraftStore } from '../../../stores/draftStore'
import MarkdownViewer from '../../MarkdownViewer'
import MarkdownEditor from '../DetailTab/MarkdownEditor'
import styles from '../DetailTab/DetailTab.module.css'

interface CardPanelProps {
  tabId: string
}

const CardPanel = memo(function CardPanel({ tabId }: CardPanelProps) {
  const selectedNodeId = useSelectedNodeId()
  const storeApi = useGraphStoreApi()
  const storage = useStorage()

  const resolveNodePath = useCallback((nodeId: string) => {
    const graphSession = tabStore.getState().getGraphSession(tabId)
    return resolveRoomChildRef(graphSession.roomPath || graphSession.kbPath, nodeId)
  }, [tabId])
  const nodePath = selectedNodeId ? resolveNodePath(selectedNodeId) : null

  const editMode = useDraftStore((s) => nodePath ? (s.cardEditModes[nodePath] || false) : false)
  const setEditMode = useDraftStore((s) => s.setCardEditMode)
  const draftMarkdown = useDraftStore((s) => nodePath ? (s.cardDrafts[nodePath] ?? '') : '')
  const setDraftMarkdown = useDraftStore((s) => s.setCardDraft)
  const cardEntry = useCardContentStore((s) => nodePath ? s.entries[nodePath] : undefined)

  const [savedMarkdown, setSavedMarkdown] = useState('')
  const requestSeqRef = useRef(0)

  const selectedNode = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId) : null)

  useEffect(() => {
    const requestSeq = ++requestSeqRef.current
    if (!selectedNodeId || !nodePath) return

    const cachedContent = useCardContentStore.getState().entries[nodePath]?.content
    if (cachedContent !== undefined) {
      setSavedMarkdown(cachedContent)
      if (useDraftStore.getState().cardDrafts[nodePath] === undefined) {
        setDraftMarkdown(nodePath, cachedContent)
      }
    }

    storage.readCardMarkdown(nodePath).then((content: string) => {
      if (requestSeqRef.current !== requestSeq) return
      useCardContentStore.getState().setCardMarkdown(nodePath, content)
      setSavedMarkdown(content)
      if (useDraftStore.getState().cardDrafts[nodePath] === undefined) {
        setDraftMarkdown(nodePath, content)
      }
    }).catch(() => {
      if (requestSeqRef.current !== requestSeq) return
      useCardContentStore.getState().setCardMarkdown(nodePath, '')
      setSavedMarkdown('')
      if (useDraftStore.getState().cardDrafts[nodePath] === undefined) {
        setDraftMarkdown(nodePath, '')
      }
    })
  }, [selectedNodeId, nodePath, storage, setDraftMarkdown])

  useEffect(() => {
    if (cardEntry) {
      setSavedMarkdown(cardEntry.content)
    }
  }, [cardEntry])

  const handleSave = useCallback(async () => {
    if (!selectedNodeId || !nodePath) return
    const label = storeApi.getState().nodesMap.get(selectedNodeId)?.data.label
    try {
      await storage.writeCardMarkdown(nodePath, draftMarkdown)
      useCardContentStore.getState().setCardMarkdown(nodePath, draftMarkdown)
      setSavedMarkdown(draftMarkdown)
      setEditMode(nodePath, false)
      logAction('卡片:保存', 'CardPanel', { nodePath, label })
    } catch (error) {
      logger.catch('CardPanel', 'handleSave', error)
    }
  }, [selectedNodeId, nodePath, draftMarkdown, storage, setEditMode])

  const flushCardSave = useCallback(async () => {
    if (!editMode || !selectedNodeId || !nodePath) return
    if (draftMarkdown === savedMarkdown) return
    await handleSave()
  }, [editMode, selectedNodeId, nodePath, draftMarkdown, savedMarkdown, handleSave])

  useEffect(() => {
    return registerTabSaver(tabId, flushCardSave)
  }, [tabId, flushCardSave])

  if (!selectedNodeId || !selectedNode) {
    return (
      <div className={styles.detailPanel}>
        <div className={styles.emptyState}>选择一个节点编辑卡片</div>
      </div>
    )
  }

  return (
    <div className={styles.detailPanel}>
      <div className={styles.title}>
        <div className={styles.titleMain}>
          <span className={styles.titleText} title={nodePath ?? undefined}>
            {selectedNode.data.label}
          </span>
        </div>
        <div className={styles.titleSub}>卡片内容：{nodePath}</div>
      </div>

      <div className={styles.actions}>
        {!editMode ? (
          <button onClick={() => nodePath && setEditMode(nodePath, true)} title="编辑卡片 Markdown">
            编辑
          </button>
        ) : (
          <>
            <button className={styles.saveBtn} onClick={handleSave}>
              保存
            </button>
            <button
              onClick={() => {
                if (nodePath) {
                  setDraftMarkdown(nodePath, savedMarkdown)
                  setEditMode(nodePath, false)
                }
              }}
            >
              取消
            </button>
          </>
        )}
      </div>

      <div className={styles.body}>
        {editMode ? (
          <div className={styles.mdEditorWrap}>
            <MarkdownEditor
              value={draftMarkdown}
              onChange={(val) => nodePath && setDraftMarkdown(nodePath, val)}
              onSave={handleSave}
              attachmentCardPath={nodePath}
              placeholder="在此输入卡片 Markdown。建议写成详情文档的摘要、预览或关键结论..."
            />
          </div>
        ) : (
          <MarkdownViewer content={draftMarkdown} className={styles.markdownBody} attachmentCardPath={nodePath} />
        )}
      </div>
    </div>
  )
})

export default CardPanel
