import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useStorage } from '../../../core/storage'
import { registerTabSaver } from '../../../core/close-guard'
import { logAction } from '../../../core/log-backend'
import { logger } from '../../../core/logger'
import { resolveRoomChildRef } from '../../../domain/graph/path-utils'
import { useGraphStore } from '../../../stores/graphStore'
import { tabStore } from '../../../stores/tabStore'
import { useCardContentStore } from '../../../stores/cardContentStore'
import MarkdownViewer from '../../MarkdownViewer'
import MarkdownEditor from '../DetailTab/MarkdownEditor'
import styles from '../DetailTab/DetailTab.module.css'

interface CardPanelProps {
  selectedNodeId: string | null
  tabId: string
}

const CardPanel = memo(function CardPanel({ selectedNodeId, tabId }: CardPanelProps) {
  const storage = useStorage()
  const [editMode, setEditMode] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [savedMarkdown, setSavedMarkdown] = useState('')
  const requestSeqRef = useRef(0)

  const selectedNode = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId) : null)
  const resolveNodePath = useCallback((nodeId: string) => {
    const graphSession = tabStore.getState().getGraphSession(tabId)
    return resolveRoomChildRef(graphSession.roomPath || graphSession.kbPath, nodeId)
  }, [tabId])

  const nodePath = selectedNodeId ? resolveNodePath(selectedNodeId) : null

  useEffect(() => {
    setEditMode(false)
    setMarkdown('')
    setSavedMarkdown('')

    const requestSeq = ++requestSeqRef.current
    if (!selectedNodeId) return

    const path = resolveNodePath(selectedNodeId)
    storage.readCardMarkdown(path).then((content: string) => {
      if (requestSeqRef.current !== requestSeq) return
      useCardContentStore.getState().setCardMarkdown(path, content)
      setMarkdown(content)
      setSavedMarkdown(content)
    }).catch(() => {
      if (requestSeqRef.current !== requestSeq) return
      useCardContentStore.getState().setCardMarkdown(path, '')
      setMarkdown('')
      setSavedMarkdown('')
    })
  }, [selectedNodeId, resolveNodePath, storage])

  const handleSave = useCallback(async () => {
    if (!selectedNodeId) return
    const path = resolveNodePath(selectedNodeId)
    const label = useGraphStore.getState().nodesMap.get(selectedNodeId)?.data.label
    try {
      await storage.writeCardMarkdown(path, markdown)
      useCardContentStore.getState().setCardMarkdown(path, markdown)
      setSavedMarkdown(markdown)
      setEditMode(false)
      logAction('卡片:保存', 'CardPanel', { nodePath: path, label })
    } catch (error) {
      logger.catch('CardPanel', 'handleSave', error)
    }
  }, [selectedNodeId, resolveNodePath, markdown, storage])

  const flushCardSave = useCallback(async () => {
    if (!editMode || !selectedNodeId) return
    if (markdown === savedMarkdown) return
    await handleSave()
  }, [editMode, selectedNodeId, markdown, savedMarkdown, handleSave])

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
          <button onClick={() => setEditMode(true)} title="编辑卡片 Markdown">
            编辑
          </button>
        ) : (
          <>
            <button className={styles.saveBtn} onClick={handleSave}>
              保存
            </button>
            <button
              onClick={() => {
                setMarkdown(savedMarkdown)
                setEditMode(false)
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
              value={markdown}
              onChange={setMarkdown}
              onSave={handleSave}
              attachmentCardPath={nodePath}
              placeholder="在此输入卡片 Markdown。建议写成详情文档的摘要、预览或关键结论..."
            />
          </div>
        ) : (
          <MarkdownViewer content={markdown} className={styles.markdownBody} attachmentCardPath={nodePath} />
        )}
      </div>
    </div>
  )
})

export default CardPanel
