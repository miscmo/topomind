/**
 * 右侧详情面板
 * 显示节点 Markdown 内容，支持预览/编辑切换
 */
import { useEffect, useState, useRef } from 'react'
import { marked } from 'marked'
import { useStorage } from '../../hooks/useStorage'
import { useAppStore } from '../../stores/appStore'
import { useGraphContext } from '../../contexts/GraphContext'
import MarkdownEditor from './MarkdownEditor'
import styles from './DetailPanel.module.css'
import { FSB } from '../../core/fs-backend'
import { logAction } from '../../core/log-backend'

marked.setOptions({ breaks: true, gfm: true })

interface DetailPanelProps {
  selectedNodeId: string | null
}

export default function DetailPanel({ selectedNodeId }: DetailPanelProps) {
  const storage = useStorage()
  const collapseRightPanel = useAppStore((s) => s.collapseRightPanel)
  const graph = useGraphContext()

  const [editMode, setEditMode] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [saving, setSaving] = useState(false)
  const [renameMode, setRenameMode] = useState(false)
  const [newName, setNewName] = useState('')
  const [childTags, setChildTags] = useState<Array<{ path: string; name: string }>>([])
  const renameInputRef = useRef<HTMLInputElement>(null)

  const selectedNode = graph.selectedNode
  const nodePath = selectedNode?.data.path ?? null
  const hasChildren = selectedNode?.data.hasChildren ?? false

  // Load markdown when node changes
  useEffect(() => {
    setEditMode(false)
    setMarkdown('')
    setRenameMode(false)

    if (!selectedNodeId) return

    const path = selectedNode?.data.path ?? selectedNodeId
    storage.readMarkdown(path).then((content: string) => {
      setMarkdown(content)
    })
  }, [selectedNodeId, selectedNode?.data.path, storage])

  // Load child concept tags when node has children
  useEffect(() => {
    if (!hasChildren || !nodePath) {
      setChildTags([])
      return
    }

    FSB.listChildren(nodePath).then((children: Array<{ path: string; name: string; isDir: boolean }>) => {
      const dirs = (children || []).filter((c: { isDir: boolean }) => c.isDir)
      setChildTags(dirs)
    })
  }, [hasChildren, nodePath])

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renameMode && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renameMode])

  // ===== Save markdown =====
  const handleSave = () => {
    if (!selectedNodeId) return
    const path = selectedNode?.data.path ?? selectedNodeId
    storage.writeMarkdown(path, markdown)
    logAction('内容:保存', 'DetailPanel', { nodePath: path, label: selectedNode?.data.label })
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
  const handleDelete = () => {
    if (!selectedNodeId) return
    if (!window.confirm(`确定要删除节点 "${selectedNode?.data.label}" 吗？`)) return
    logAction('节点:删除', 'DetailPanel', {
      nodeId: selectedNodeId,
      label: selectedNode?.data.label,
      path: selectedNode?.data.path,
    })
    graph.deleteChildNode(selectedNodeId)
    collapseRightPanel()
  }

  // ===== Empty state =====
  if (!selectedNodeId || !selectedNode) {
    return (
      <div className={styles.detailPanel}>
        <div className={styles.emptyState}>选择一个节点查看详情</div>
      </div>
    )
  }

  const { data } = selectedNode

  // Build child concept tags from directory listing
  // Clicking a tag navigates into that child room
  const renderChildTags = () => {
    if (!hasChildren || childTags.length === 0) return null
    return (
      <div className={styles.childTags}>
        <span style={{ fontSize: '11px', color: '#888', marginRight: '4px' }}>子概念</span>
        {childTags.map((child) => (
          <span
            key={child.path}
            className={styles.childTag}
            onClick={() => graph.loadRoom(child.path)}
            title={`进入 ${child.name}`}
          >
            {child.name}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div className={styles.detailPanel}>
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
              style={{ color: '#e74c3c' }}
            >
              删除
            </button>
          </>
        ) : (
          <>
            <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => {
                // Reload original content
                const path = selectedNode?.data.path ?? selectedNodeId
                storage.readMarkdown(path).then((content: string) => setMarkdown(content))
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
              dangerouslySetInnerHTML={{ __html: String(marked.parse(markdown)) }}
            />
            {renderChildTags()}
          </>
        )}
      </div>
    </div>
  )
}