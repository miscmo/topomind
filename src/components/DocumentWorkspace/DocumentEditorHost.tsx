import React from 'react'
import { DocumentWorkspaceLayout } from '../DocumentWorkspaceLayout/DocumentWorkspaceLayout'
import type { TocItem } from '../DocumentWorkspaceLayout/workspaceTypes'
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
  detailHeader: React.ReactNode
  documentsTabContent?: React.ReactNode
  activeDetailDocumentPath: string
  detailSidebarCollapsed: boolean
  detailSidebarFloating?: boolean
  onDetailSidebarCollapsedChange: (collapsed: boolean) => void
  onSidebarHoverChange: (hovered: boolean) => void
  onOpenDetailDocumentLink: (documentPath: string) => void
  isDetailDocumentBusy?: boolean
  topoDocuments: TopoDocumentManifestItem[]
}

const SmartDocumentWrapper = ({
  value,
  title,
  onChange,
  onTocChange,
  onTocItemClickReady,
}: {
  value: string
  title: string
  onChange: (v: string) => void
  onTocChange: (items: TocItem[]) => void
  onTocItemClickReady: (handler: ((item: TocItem) => void) | null) => void
}) => {
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

  return (
    <SmartDocumentEditor
      value={objectValue}
      onChange={handleChange}
      onTocChange={onTocChange}
      onTocItemClickReady={onTocItemClickReady}
    />
  )
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
  detailHeader,
  documentsTabContent,
  activeDetailDocumentPath,
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
  const shouldRenderNoDocument = !activeTopoDocument
  const [smartTocItems, setSmartTocItems] = React.useState<TocItem[]>([])
  const [smartTocItemClick, setSmartTocItemClick] = React.useState<((item: TocItem) => void) | null>(null)

  const handleSmartTocItemClickReady = React.useCallback((handler: ((item: TocItem) => void) | null) => {
    setSmartTocItemClick(() => handler)
  }, [])

  if (shouldRenderNoDocument) {
    return (
      <DocumentWorkspaceLayout
        value=""
        savedValue=""
        onChange={() => {}}
        onSave={() => {}}
        attachmentCardPath={attachmentCardPath}
        documentType="detail"
        detailSidebarCollapsed={detailSidebarCollapsed}
        detailSidebarFloating={detailSidebarFloating}
        onDetailSidebarCollapsedChange={onDetailSidebarCollapsedChange}
        onSidebarHoverChange={onSidebarHoverChange}
        detailHeader={detailHeader}
        documentsTabContent={documentsTabContent}
        activeDetailDocumentPath={activeDetailDocumentPath}
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
      onTocChange={setSmartTocItems}
      onTocItemClickReady={handleSmartTocItemClickReady}
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
  ) : undefined

  return (
    <DocumentWorkspaceLayout
      value={value}
      savedValue={savedValue}
      onChange={onChange}
      onSave={onSave}
      attachmentCardPath={attachmentCardPath}
      documentType="detail"
      detailSidebarCollapsed={detailSidebarCollapsed}
      detailSidebarFloating={detailSidebarFloating}
      onDetailSidebarCollapsedChange={onDetailSidebarCollapsedChange}
      onSidebarHoverChange={onSidebarHoverChange}
      detailHeader={detailHeader}
      documentsTabContent={documentsTabContent}
      activeDetailDocumentPath={activeDetailDocumentPath}
      tocItems={shouldRenderSmartEditor ? smartTocItems : undefined}
      onTocItemClick={shouldRenderSmartEditor ? smartTocItemClick ?? undefined : undefined}
      editorContent={editorContent}
    />
  )
}
