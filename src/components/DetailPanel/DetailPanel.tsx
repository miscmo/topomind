/**
 * 右侧详情面板
 * 显示节点 Markdown 内容，支持预览/编辑切换
 */
import { useEffect, useState, useRef } from 'react'
import { marked } from 'marked'
import { useStorage } from '../../hooks/useStorage'
import { useAppStore } from '../../stores/appStore'
import MarkdownEditor from './MarkdownEditor'
import styles from './DetailPanel.module.css'
import type { KnowledgeNode } from '../../types'
import type { GraphState } from '../../hooks/useGraph'

marked.setOptions({ breaks: true, gfm: true })

interface DetailPanelProps {
  selectedNode: KnowledgeNode | null
  selectedNodeId: string | null
  graph?: GraphState
}

export default function DetailPanel({ selectedNode, selectedNodeId, graph }: DetailPanelProps) {
  const storage = useStorage()
  const collapseRightPanel = useAppStore((s) => s.collapseRightPanel)

  const [editMode, setEditMode] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [saving, setSaving] = useState(false)
  const [renameMode, setRenameMode] = useState(false)
  const [newName, setNewName] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Load markdown when node changes
  useEffect(() => {
    setEditMode(false)
    setMarkdown('')
    setRenameMode(false)

    if (!selectedNodeId) return

    const path = selectedNode?.data.path ?? selectedNodeId
    const content = storage.readMarkdown(path)
    setMarkdown(content)
  }, [selectedNodeId, selectedNode?.data.path, storage])

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
    setEditMode(false)
  }

  // ===== Rename node =====
  const handleRenameConfirm = () => {
    if (!renameMode || !newName.trim() || !selectedNodeId) {
      setRenameMode(false)
      return
    }
    graph?.renameNode(selectedNodeId, newName.trim())
    setRenameMode(false)
  }

  // ===== Delete node =====
  const handleDelete = () => {
    if (!selectedNodeId) return
    if (!window.confirm(`确定要删除节点 "${selectedNode?.data.label}" 吗？`)) return
    graph?.deleteChildNode(selectedNodeId)
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
  const nodePath = data.path
  const hasChildren = data.hasChildren

  // Build child concept tags from directory listing
  // We show available sub-rooms as clickable tags
  const renderChildTags = () => {
    if (!hasChildren) return null
    return (
      <div className={styles.childTags}>
        <span style={{ fontSize: '11px', color: '#888', marginRight: '4px' }}>子概念</span>
        {/* Child tags are rendered as non-interactive labels for now */}
        {/* Navigation via double-click on the canvas */}
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
            <span className={styles.titleText} title={nodePath}>
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
                setMarkdown(storage.readMarkdown(path))
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
              dangerouslySetInnerHTML={{ __html: marked.parse(markdown) as string }}
            />
            {renderChildTags()}
          </>
        )}
      </div>
    </div>
  )
}