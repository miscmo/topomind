import React from 'react'
import { MarkdownWorkspace } from '../MarkdownWorkspace/MarkdownWorkspace'
import type { MarkdownViewMode } from '../MarkdownWorkspace/markdownTypes'
import type { TopoDocumentManifestItem } from '../../core/storage'
import { topoDocumentIdFromPath, topoDocumentTypeLabel } from './documentTypes'
import { SmartDocumentEditor } from '../SmartDocumentEditor/SmartDocumentEditor'
import { normalizeSmartDocumentContent, serializeSmartDocumentContent } from '../SmartDocumentEditor/smartDocumentTypes'
import { MindMapDocumentEditor } from '../MindMapDocumentEditor/MindMapDocumentEditor'
import { normalizeMindMapDocumentContent, serializeMindMapDocumentContent } from '../MindMapDocumentEditor/mindMapDocumentTypes'
import { FlowchartDocumentEditor } from '../FlowchartDocumentEditor/FlowchartDocumentEditor'
import { normalizeFlowchartDocumentContent, serializeFlowchartDocumentContent } from '../FlowchartDocumentEditor/flowchartDocumentTypes'

function parseJsonValue(value: string) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

interface DocumentEditorHostProps {
  value: string
  savedValue: string
  isContentLoaded?: boolean
  onChange: (value: string) => void
  onSave: () => Promise<void> | void
  attachmentCardPath: string | null
  previewClassName?: string
  detailHeader: React.ReactNode
  documentsTabContent?: React.ReactNode
  activeDetailDocumentPath: string
  viewMode: MarkdownViewMode
  onViewModeChange: (mode: MarkdownViewMode) => void
  detailSidebarCollapsed: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarCollapsedChange: (collapsed: boolean) => void
  onSidebarHoverChange: (hovered: boolean) => void
  onOpenDetailDocumentLink: (documentPath: string) => void
  isDetailDocumentBusy?: boolean
  topoDocuments: TopoDocumentManifestItem[]
}

const SmartDocumentWrapper = ({ value, title, onChange }: { value: string, title: string, onChange: (v: string) => void }) => {
  const cacheRef = React.useRef<{ stringValue: string; objectValue: any } | null>(null)
  
  const objectValue = React.useMemo(() => {
    if (cacheRef.current && cacheRef.current.stringValue === value) {
      return cacheRef.current.objectValue
    }
    return normalizeSmartDocumentContent(parseJsonValue(value), title)
  }, [value, title])

  const handleChange = React.useCallback((nextValue: any) => {
    const str = serializeSmartDocumentContent(nextValue)
    cacheRef.current = { stringValue: str, objectValue: nextValue }
    onChange(str)
  }, [onChange])

  return <SmartDocumentEditor value={objectValue} onChange={handleChange} />
}

const MindMapDocumentWrapper = ({ value, title, onChange }: { value: string, title: string, onChange: (v: string) => void }) => {
  const cacheRef = React.useRef<{ stringValue: string; objectValue: any } | null>(null)
  
  const objectValue = React.useMemo(() => {
    if (cacheRef.current && cacheRef.current.stringValue === value) {
      return cacheRef.current.objectValue
    }
    return normalizeMindMapDocumentContent(parseJsonValue(value), title)
  }, [value, title])

  const handleChange = React.useCallback((nextValue: any) => {
    const str = serializeMindMapDocumentContent(nextValue)
    cacheRef.current = { stringValue: str, objectValue: nextValue }
    onChange(str)
  }, [onChange])

  return <MindMapDocumentEditor value={objectValue} onChange={handleChange} />
}

const FlowchartDocumentWrapper = ({ value, title, onChange }: { value: string, title: string, onChange: (v: string) => void }) => {
  const cacheRef = React.useRef<{ stringValue: string; objectValue: any } | null>(null)
  
  const objectValue = React.useMemo(() => {
    if (cacheRef.current && cacheRef.current.stringValue === value) {
      return cacheRef.current.objectValue
    }
    return normalizeFlowchartDocumentContent(parseJsonValue(value), title)
  }, [value, title])

  const handleChange = React.useCallback((nextValue: any) => {
    const str = serializeFlowchartDocumentContent(nextValue)
    cacheRef.current = { stringValue: str, objectValue: nextValue }
    onChange(str)
  }, [onChange])

  return <FlowchartDocumentEditor value={objectValue} onChange={handleChange} />
}

export function DocumentEditorHost({
  value,
  savedValue,
  isContentLoaded = true,
  onChange,
  onSave,
  attachmentCardPath,
  previewClassName,
  detailHeader,
  documentsTabContent,
  activeDetailDocumentPath,
  viewMode,
  onViewModeChange,
  detailSidebarCollapsed,
  detailSidebarFloating,
  onDetailSidebarCollapsedChange,
  onSidebarHoverChange,
  onOpenDetailDocumentLink,
  isDetailDocumentBusy,
  topoDocuments,
}: DocumentEditorHostProps) {
  const activeTopoDocumentId = topoDocumentIdFromPath(activeDetailDocumentPath)
  const activeTopoDocument = activeTopoDocumentId
    ? topoDocuments.find((item) => item.id === activeTopoDocumentId)
    : undefined
  const shouldRenderSmartEditor = activeTopoDocument?.type === 'smart'
  const shouldRenderMindMapEditor = activeTopoDocument?.type === 'mindmap'
  const shouldRenderFlowchartEditor = activeTopoDocument?.type === 'flowchart'
  const shouldRenderStructuredEditor = shouldRenderSmartEditor || shouldRenderMindMapEditor || shouldRenderFlowchartEditor
  const shouldRenderPlaceholder = activeTopoDocument && activeTopoDocument.type !== 'markdown' && activeTopoDocument.type !== 'smart' && activeTopoDocument.type !== 'mindmap' && activeTopoDocument.type !== 'flowchart'
  const shouldRenderNoDocument = !activeTopoDocument

  if (shouldRenderNoDocument) {
    return (
      <MarkdownWorkspace
        value=""
        savedValue=""
        onChange={() => {}}
        onSave={() => {}}
        attachmentCardPath={attachmentCardPath}
        documentType="detail"
        previewClassName={previewClassName}
        detailSidebarCollapsed={detailSidebarCollapsed}
        detailSidebarFloating={detailSidebarFloating}
        onDetailSidebarCollapsedChange={onDetailSidebarCollapsedChange}
        onSidebarHoverChange={onSidebarHoverChange}
        detailHeader={detailHeader}
        documentsTabContent={documentsTabContent}
        activeDetailDocumentPath={activeDetailDocumentPath}
        viewMode="preview"
        onViewModeChange={onViewModeChange}
        showToolbar={false}
        editorContent={(
          <div className="h-full min-h-0 flex items-center justify-center bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] p-6">
            <div className="max-w-[360px] rounded-2xl text-center">
              <div className="text-[13px] text-[var(--color-text-muted)]">在左侧边栏右键或使用快捷菜单创建文档。</div>
            </div>
          </div>
        )}
      />
    )
  }

  const loadingContent = (
    <div className="h-full min-h-0 flex items-center justify-center bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] p-6">
      <div className="text-[13px] text-[var(--color-text-muted)]">正在加载文档内容...</div>
    </div>
  )

  const editorContent = shouldRenderStructuredEditor && !isContentLoaded ? loadingContent : shouldRenderSmartEditor ? (
    <SmartDocumentWrapper
      key={activeTopoDocument.id}
      value={value}
      title={activeTopoDocument.title}
      onChange={onChange}
    />
  ) : shouldRenderMindMapEditor ? (
    <MindMapDocumentWrapper
      key={activeTopoDocument.id}
      value={value}
      title={activeTopoDocument.title}
      onChange={onChange}
    />
  ) : shouldRenderFlowchartEditor ? (
    <FlowchartDocumentWrapper
      key={activeTopoDocument.id}
      value={value}
      title={activeTopoDocument.title}
      onChange={onChange}
    />
  ) : shouldRenderPlaceholder ? (
    <div className="h-full min-h-0 flex items-center justify-center bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-bg)] p-6">
      <div className="max-w-[360px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)] p-5 text-center">
        <div className="text-[13px] font-semibold text-[var(--color-primary)] mb-2">{topoDocumentTypeLabel(activeTopoDocument.type)}</div>
        <div className="text-base font-bold text-[var(--color-text-primary)] mb-2 truncate" title={activeTopoDocument.title}>{activeTopoDocument.title}</div>
        <div className="text-xs leading-relaxed text-[var(--color-text-muted)]">该类型文档已进入统一文档列表，编辑器将在后续阶段接入。</div>
      </div>
    </div>
  ) : undefined

  return (
    <MarkdownWorkspace
      value={shouldRenderPlaceholder ? '' : value}
      savedValue={shouldRenderPlaceholder ? '' : savedValue}
      onChange={onChange}
      onSave={onSave}
      attachmentCardPath={attachmentCardPath}
      documentType="detail"
      previewClassName={previewClassName}
      detailSidebarCollapsed={detailSidebarCollapsed}
      detailSidebarFloating={detailSidebarFloating}
      onDetailSidebarCollapsedChange={onDetailSidebarCollapsedChange}
      onSidebarHoverChange={onSidebarHoverChange}
      detailHeader={detailHeader}
      documentsTabContent={documentsTabContent}
      activeDetailDocumentPath={activeDetailDocumentPath}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      showToolbar={false}
      editorContent={editorContent}
    />
  )
}
