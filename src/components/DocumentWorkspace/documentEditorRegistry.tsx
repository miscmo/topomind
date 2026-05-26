import React from 'react'
import type { TopoDocumentType } from '../../core/storage'
import type { TocItem } from '../DocumentWorkspaceLayout/workspaceTypes'
import { SmartDocumentEditor } from '../SmartDocumentEditor/SmartDocumentEditor'
import { normalizeSmartDocumentContent } from '../SmartDocumentEditor/smartDocumentTypes'
import { MindMapDocumentEditor } from '../MindMapDocumentEditor/MindMapDocumentEditor'
import { normalizeMindMapDocumentContent } from '../MindMapDocumentEditor/mindMapDocumentTypes'
import { FlowchartDocumentEditor } from '../FlowchartDocumentEditor/FlowchartDocumentEditor'
import { normalizeFlowchartDocumentContent } from '../FlowchartDocumentEditor/flowchartDocumentTypes'
import { useStorage } from '../../core/storage'

function parseJsonValue(value: unknown) {
  if (value && typeof value === 'object') return value
  if (!value) return null
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function useStructuredDocumentValue<T>(
  value: unknown,
  title: string,
  normalize: (value: unknown, fallbackTitle: string) => T,
  onChange: (value: unknown) => void
) {
  const cacheRef = React.useRef<{ sourceValue: unknown; objectValue: T } | null>(null)

  const objectValue = React.useMemo(() => {
    if (cacheRef.current && cacheRef.current.sourceValue === value) {
      return cacheRef.current.objectValue
    }
    return normalize(parseJsonValue(value), title)
  }, [normalize, title, value])

  const handleChange = React.useCallback((nextValue: T) => {
    cacheRef.current = { sourceValue: nextValue, objectValue: nextValue }
    onChange(nextValue)
  }, [onChange])

  return { objectValue, handleChange }
}

export interface DocumentEditorAdapterProps {
  value: unknown
  title: string
  onChange: (value: unknown) => void
  attachmentCardPath: string | null
  attachmentInsertTargetKey: string
  onTocChange: (items: TocItem[]) => void
  onTocItemClickReady: (handler: ((item: TocItem) => void) | null) => void
  onWordCountChange: (stats: { characters: number; words: number; blocks: number } | null) => void
}

interface DocumentEditorTypeAdapter {
  type: TopoDocumentType
  render: (props: DocumentEditorAdapterProps) => React.ReactNode
  hasToc?: boolean
  hasStats?: boolean
}

function SmartDocumentAdapter({
  value,
  title,
  onChange,
  onTocChange,
  onTocItemClickReady,
  attachmentCardPath,
  attachmentInsertTargetKey,
  onWordCountChange,
}: DocumentEditorAdapterProps) {
  const store = useStorage()
  const { objectValue, handleChange } = useStructuredDocumentValue(value, title, normalizeSmartDocumentContent, onChange)

  const uploadFile = React.useCallback(async (file: File) => {
    if (!attachmentCardPath) {
      return URL.createObjectURL(file)
    }
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const base64Data = base64.split(',')[1]
      await store.writeAttachmentBase64(attachmentCardPath, file.name, file.type, base64Data)
      const url = await store.getAttachmentAbsoluteUrl(attachmentCardPath, file.name)
      return url || URL.createObjectURL(file)
    } catch (e) {
      console.error('Failed to upload file', e)
      return URL.createObjectURL(file)
    }
  }, [attachmentCardPath, store])

  return (
    <SmartDocumentEditor
      value={objectValue}
      onChange={handleChange}
      onTocChange={onTocChange}
      onTocItemClickReady={onTocItemClickReady}
      uploadFile={uploadFile}
      onWordCountChange={(stats) => onWordCountChange(stats)}
      attachmentInsertTargetKey={attachmentInsertTargetKey}
    />
  )
}

function MindMapDocumentAdapter({ value, title, onChange, onTocChange, onTocItemClickReady, onWordCountChange }: DocumentEditorAdapterProps) {
  const { objectValue, handleChange } = useStructuredDocumentValue(value, title, normalizeMindMapDocumentContent, onChange)

  React.useEffect(() => {
    onTocChange([])
    onTocItemClickReady(null)
    onWordCountChange(null)
  }, [onTocChange, onTocItemClickReady, onWordCountChange])

  return <MindMapDocumentEditor value={objectValue} onChange={handleChange} />
}

function FlowchartDocumentAdapter({ value, title, onChange, onTocChange, onTocItemClickReady, onWordCountChange }: DocumentEditorAdapterProps) {
  const { objectValue, handleChange } = useStructuredDocumentValue(value, title, normalizeFlowchartDocumentContent, onChange)

  React.useEffect(() => {
    onTocChange([])
    onTocItemClickReady(null)
    onWordCountChange(null)
  }, [onTocChange, onTocItemClickReady, onWordCountChange])

  return <FlowchartDocumentEditor value={objectValue} onChange={handleChange} />
}

export const DOCUMENT_EDITOR_REGISTRY: Record<TopoDocumentType, DocumentEditorTypeAdapter> = {
  smart: {
    type: 'smart',
    render: (props) => <SmartDocumentAdapter {...props} />,
    hasToc: true,
    hasStats: true,
  },
  mindmap: {
    type: 'mindmap',
    render: (props) => <MindMapDocumentAdapter {...props} />,
  },
  flowchart: {
    type: 'flowchart',
    render: (props) => <FlowchartDocumentAdapter {...props} />,
  },
}

export function getDocumentEditorAdapter(type: TopoDocumentType): DocumentEditorTypeAdapter {
  return DOCUMENT_EDITOR_REGISTRY[type]
}
