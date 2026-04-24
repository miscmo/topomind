/**
 * 右侧详情面板
 * 显示节点 Markdown 内容，支持预览/编辑切换
 */
import { useEffect, useState, useRef, memo, useMemo, useCallback } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useStorage } from '../../hooks/useStorage'
import { useAppStore } from '../../stores/appStore'
import { usePromptStore } from '../../stores/promptStore'
import { useRoomStore } from '../../stores/roomStore'
import { useGraphContext } from '../../contexts/GraphContext'
import MarkdownEditor from './MarkdownEditor'
import styles from './DetailPanel.module.css'
import { logAction } from '../../core/log-backend'

// Configure marked once — called at module load time, not inside components
marked.setOptions({ breaks: true, gfm: true })

interface DetailPanelProps {
  selectedNodeId: string | null
}

const DetailPanel = memo(function DetailPanel({ selectedNodeId }: DetailPanelProps) {
  const storage = useStorage()
  const collapseRightPanel = useAppStore((s) => s.collapseRightPanel)
  const graph = useGraphContext()
  const prompt = usePromptStore((s) => s.open)
  const roomStore = useRoomStore()
  const currentKBPath = useRoomStore((s) => s.currentKBPath)

  const [editMode, setEditMode] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [renameMode, setRenameMode] = useState(false)
  const [newName, setNewName] = useState('')
  const [childTags, setChildTags] = useState<Array<{ path: string; name: string }>>([])
  const renameInputRef = useRef<HTMLInputElement>(null)
  const markdownRequestSeqRef = useRef(0)
  const childTagsRequestSeqRef = useRef(0)

  const selectedNode = graph.selectedNode
  const nodePath = selectedNode?.data.path ?? null
  const hasChildren = selectedNode?.data.hasChildren ?? false

  // Load markdown when node changes
  useEffect(() => {
    setEditMode(false)
    setMarkdown('')
    setRenameMode(false)
    setNewName('')

    const requestSeq = ++markdownRequestSeqRef.current
    if (!selectedNodeId) return

    const path = selectedNode?.data.path ?? selectedNodeId
    storage.readMarkdown(path).then((content: string) => {
      if (markdownRequestSeqRef.current !== requestSeq) return
      setMarkdown(content)
    }).catch(() => {
      if (markdownRequestSeqRef.current !== requestSeq) return
      setMarkdown('')
    })
  }, [selectedNodeId, selectedNode?.data.path, storage])

  // Load child concept tags when node has children
  useEffect(() => {
    const requestSeq = ++childTagsRequestSeqRef.current

    if (!hasChildren || !nodePath) {
      setChildTags([])
      return
    }

    storage.listCards(nodePath).then((children: Array<{ path: string; name: string; isDir: boolean }>) => {
      if (childTagsRequestSeqRef.current !== requestSeq) return
      const dirs = (children || []).filter((c: { isDir: boolean }) => c.isDir)
      setChildTags(dirs)
    }).catch(() => {
      if (childTagsRequestSeqRef.current !== requestSeq) return
      setChildTags([])
    })
  }, [hasChildren, nodePath, storage])

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
  const handleSave = () => {
    if (!selectedNodeId) return
    const node = graph.nodesMapRef.current.get(selectedNodeId)
    const path = node?.data.path ?? selectedNodeId
    const label = node?.data.label
    storage.writeMarkdown(path, markdown)
    logAction('内容:保存', 'DetailPanel', { nodePath: path, label })
    setEditMode(false)
  }

  // ===== Rename node =====
  const handleRenameConfirm = () => {
    if (!renameMode || !newName.trim() || !selectedNodeId) {
      setRenameMode(false)
      return
    }
    logAction('节点:重命名', 'DetailPanel', {
      nodeId: selectedNodeId,
      oldName: selectedNode?.data.label,
      newName: newName.trim(),
      path: selectedNode?.data.path,
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
    const node = graph.nodesMapRef.current.get(selectedNodeId)
    const label = node?.data.label ?? selectedNodeId
    const path = node?.data.path ?? selectedNodeId
    const confirmed = await prompt({ title: '确认删除', placeholder: `输入 "${label}" 确认删除` })
    if (!confirmed?.trim() || confirmed !== label) return
    logAction('节点:删除', 'DetailPanel', { nodeId: selectedNodeId, label, path })
    graph.deleteChildNode(selectedNodeId)
    collapseRightPanel()
  }, [selectedNodeId, prompt, graph, collapseRightPanel])

  // Memoize parsed HTML — must be declared before any early returns (Rules of Hooks)
  const sanitizedHtml = useMemo(
    () => DOMPurify.sanitize(marked.parse(markdown) as string),
    [markdown]
  )

  // ===== Empty state =====
  if (!selectedNodeId || !selectedNode) {
    return (
      <div id="detail-panel" className={styles.detailPanel}>
        <div className={styles.emptyState}>选择一个节点查看详情</div>
      </div>
    )
  }

  // selectedNode could be null due to stale closures even after the guard above.
  // This resolves "Cannot destructure property 'data' of 'R' as it is null" errors.
  if (!selectedNode) return null

  const { data } = selectedNode

  // Build child concept tags from directory listing
  // Clicking a tag navigates into that child room
  const renderChildTags = () => {
    if (!hasChildren || childTags.length === 0) return null
    return (
      <div className={styles.childTags}>
        <span className={styles.childTagsLabel}>子概念</span>
        {childTags.map((child) => (
          <span
            key={child.path}
            className={styles.childTag}
            onClick={() => {
              logAction('房间:钻入', 'DetailPanel', { roomPath: child.path, roomName: child.name, source: 'child-tag' })
              const idx = child.path.lastIndexOf('/')
              const kbPath = idx >= 0 ? child.path.slice(0, idx) : currentKBPath || child.path
              roomStore.enterRoom({ path: child.path, kbPath, name: child.name })
            }}
            title={`进入 ${child.name}`}
          >
            {child.name}
          </span>
        ))}
      </div>
    )
  }


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
          {hasChildren && (
            <span className={styles.badge} title="含有子概念">
              {data.childCount ?? '?'} 子
            </span>
          )}
        </div>
        <div className={styles.titleSub}>{nodePath}</div>
      </div>

      {/* 操作按钮行 */}
      <div className={styles.actions}>
        {!editMode ? (
          <>
            <button onClick={() => setEditMode(true)} title="编辑 Markdown">
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
                // Reload original content — use nodesMapRef for stale-closure-safe access
                const node = graph.nodesMapRef.current.get(selectedNodeId)
                const path = node?.data.path ?? selectedNodeId
                const requestSeq = ++markdownRequestSeqRef.current
                storage.readMarkdown(path).then((content: string) => {
                  if (markdownRequestSeqRef.current !== requestSeq) return
                  setMarkdown(content)
                }).catch(() => {
                  if (markdownRequestSeqRef.current !== requestSeq) return
                  setMarkdown('')
                })
                setEditMode(false)
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
              value={markdown}
              onChange={setMarkdown}
              onSave={handleSave}
              placeholder="在此输入 Markdown 内容..."
            />
          </div>
        ) : (
          <>
            {/* Markdown 渲染 */}
            <div
              className={styles.markdownBody}
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            />
            {renderChildTags()}
          </>
        )}
      </div>
    </div>
  )
})

export default DetailPanel