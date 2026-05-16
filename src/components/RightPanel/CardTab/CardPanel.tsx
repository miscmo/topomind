import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useStorage } from '../../../core/storage'
import { logAction } from '../../../core/log-backend'
import { logger } from '../../../core/logger'
import { resolveRoomChildRef } from '../../../domain/graph/path-utils'
import { useGraphStore, useSelectedNodeId } from '../../../stores/graphStore'
import { tabStore } from '../../../stores/tabStore'
import { MarkdownWorkspace } from '../../MarkdownWorkspace/MarkdownWorkspace'
import styles from '../DetailTab/DetailTab.module.css'

interface CardPanelProps {
  tabId: string
}

const CardPanel = memo(function CardPanel({ tabId }: CardPanelProps) {
  const selectedNodeId = useSelectedNodeId()
  const storage = useStorage()

  const resolveNodePath = useCallback((nodeId: string) => {
    const graphSession = tabStore.getState().getGraphSession(tabId)
    return resolveRoomChildRef(graphSession.roomPath || graphSession.kbPath, nodeId)
  }, [tabId])
  const nodePath = selectedNodeId ? resolveNodePath(selectedNodeId) : null

  const selectedNode = useGraphStore((s) => selectedNodeId ? s.nodesMap.get(selectedNodeId) : null)

  const [content, setContent] = useState<string>('')
  const [savedContent, setSavedContent] = useState<string>('')
  
  const contentRequestSeqRef = useRef(0)

  useEffect(() => {
    if (!nodePath) return
    const requestSeq = ++contentRequestSeqRef.current
    
    storage.readCardMarkdown(nodePath).then((loadedContent: string) => {
      if (contentRequestSeqRef.current !== requestSeq) return
      setContent(loadedContent)
      setSavedContent(loadedContent)
    }).catch((e: any) => {
      if (contentRequestSeqRef.current !== requestSeq) return
      setContent('')
      setSavedContent('')
    })
  }, [nodePath, storage])

  const handleSave = async () => {
    if (!nodePath) return
    if (content === savedContent) return
    
    try {
      await storage.writeCardMarkdown(nodePath, content)
      setSavedContent(content)
      logAction('卡片:保存', 'CardPanel', { nodePath })
    } catch (e) {
      logger.catch('CardPanel', 'handleSave', e)
      throw e
    }
  }

  useEffect(() => {
    if (!nodePath) return
    return () => {
      if (content !== savedContent) {
        storage.writeCardMarkdown(nodePath, content).catch(e => {
          logger.catch('CardPanel', 'unmountSave', e)
        })
      }
    }
  }, [nodePath, content, savedContent, storage])

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

      <div className={styles.body}>
        <MarkdownWorkspace
          value={content}
          savedValue={savedContent}
          onChange={setContent}
          onSave={handleSave}
          attachmentCardPath={nodePath}
          documentType="card"
          title={selectedNode.data.label}
          pathLabel={nodePath || undefined}
        />
      </div>
    </div>
  )
})

export default CardPanel
