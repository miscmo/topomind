import React, { Suspense, lazy } from 'react'
import type { AttachmentUploadSyncContext, TopoDocumentType } from '../../../core/storage'
import type { TocItem } from '../types/workspaceTypes'
import { normalizeSmartDocumentContent } from '../SmartDocumentEditor/smartDocumentTypes'
import type { BlockNoteBlock, SmartDocumentContent } from '../SmartDocumentEditor/smartDocumentTypes'
import { normalizeMindMapDocumentContent } from '../MindMapDocumentEditor/mindMapDocumentTypes'
import { normalizeFlowchartDocumentContent } from '../FlowchartDocumentEditor/flowchartDocumentTypes'
import { useStorage } from '../../../core/storage'
import { getCloudAttachmentLocalUrl } from '../../../core/cloud-attachment-cache'
import { maybeCreateAttachmentUploadTicket, normalizeAttachmentMimeType } from '../../../core/attachment-upload-ticket'
import { LocalDB } from '../../../core/localdb-backend'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { useSelectedNodeId } from '../../../stores/graphStore'
import { topoDocumentIdFromKey } from '../types/documentTypes'
import type { LocalAttachmentRecord } from '../../../types/local-sync'

const SmartDocumentEditor = lazy(() => import('../SmartDocumentEditor/SmartDocumentEditor').then(m => ({ default: m.SmartDocumentEditor })))
const MindMapDocumentEditor = lazy(() => import('../MindMapDocumentEditor/MindMapDocumentEditor').then(m => ({ default: m.MindMapDocumentEditor })))
const FlowchartDocumentEditor = lazy(() => import('../FlowchartDocumentEditor/FlowchartDocumentEditor').then(m => ({ default: m.FlowchartDocumentEditor })))

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeAttachmentRef(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
  return normalized.startsWith('_attach/') ? normalized : `_attach/${normalized.split('/').pop() || normalized}`
}

function getAttachmentFileNameFromRef(value: string): string {
  const normalized = normalizeAttachmentRef(value)
  return normalized.split('/').pop() || normalized
}

function extractAttachmentFileNameFromUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const withoutQuery = trimmed.split('#')[0]?.split('?')[0] || ''
  const normalized = withoutQuery.replace(/^local-file:\/\//i, '').replace(/^file:\/\//i, '')
  const rawName = normalized.split(/[/\\]/).pop() || ''
  if (!rawName) return null
  try {
    return decodeURIComponent(rawName)
  } catch {
    return rawName
  }
}

function canDeriveAttachmentRefFromUrl(value: string): boolean {
  const trimmed = value.trim()
  return /^local-file:\/\//i.test(trimmed)
    || /^file:\/\//i.test(trimmed)
    || /^\.?\/?_attach[\\/]/i.test(trimmed)
}

function getAttachmentRefFromBlockProps(
  props: Record<string, unknown>,
  knownAttachmentNames: Set<string>
): string | null {
  if (typeof props.attachmentRef === 'string' && props.attachmentRef.trim()) {
    return normalizeAttachmentRef(props.attachmentRef)
  }
  if (typeof props.url === 'string') {
    if (!canDeriveAttachmentRefFromUrl(props.url)) return null
    const fileName = extractAttachmentFileNameFromUrl(props.url)
    if (fileName) {
      return normalizeAttachmentRef(fileName)
    }
  }
  if (typeof props.name === 'string' && knownAttachmentNames.has(props.name)) {
    return normalizeAttachmentRef(props.name)
  }
  return null
}

function mapBlocksRecursively(
  blocks: BlockNoteBlock[],
  mapper: (block: BlockNoteBlock) => BlockNoteBlock
): BlockNoteBlock[] {
  return blocks.map((block) => {
    const nextBlock = mapper(block)
    if (!Array.isArray(nextBlock.children)) return nextBlock
    return {
      ...nextBlock,
      children: mapBlocksRecursively(nextBlock.children as BlockNoteBlock[], mapper),
    }
  })
}

function buildSmartDocumentRuntimeValue(
  value: SmartDocumentContent,
  attachmentUrlCache: Map<string, string>,
  knownAttachmentNames: Set<string>
): { runtimeValue: SmartDocumentContent; missingAttachmentRefs: string[] } {
  const missingAttachmentRefs = new Set<string>()
  const blocks = mapBlocksRecursively(value.blocks, (block) => {
    if (!isRecord(block.props)) return block
    const attachmentRef = getAttachmentRefFromBlockProps(block.props, knownAttachmentNames)
    if (!attachmentRef) return block
    const nextProps: Record<string, unknown> = {
      ...block.props,
      attachmentRef,
      name: typeof block.props.name === 'string' ? block.props.name : getAttachmentFileNameFromRef(attachmentRef),
    }
    if (block.type === 'image') {
      nextProps.url = attachmentRef
      return {
        ...block,
        props: nextProps,
      }
    }
    const cachedUrl = attachmentUrlCache.get(attachmentRef)
    if (cachedUrl) {
      nextProps.url = cachedUrl
    } else {
      missingAttachmentRefs.add(attachmentRef)
    }
    return {
      ...block,
      props: nextProps,
    }
  })
  return {
    runtimeValue: {
      ...value,
      blocks,
    },
    missingAttachmentRefs: Array.from(missingAttachmentRefs).sort(),
  }
}

function buildSmartDocumentPersistedValue(
  value: SmartDocumentContent,
  knownAttachmentNames: Set<string>
): SmartDocumentContent {
  const blocks = mapBlocksRecursively(value.blocks, (block) => {
    if (!isRecord(block.props)) return block
    const attachmentRef = getAttachmentRefFromBlockProps(block.props, knownAttachmentNames)
    if (!attachmentRef) return block
    const nextProps: Record<string, unknown> = {
      ...block.props,
      attachmentRef,
      name: typeof block.props.name === 'string' ? block.props.name : getAttachmentFileNameFromRef(attachmentRef),
    }
    delete nextProps.url
    return {
      ...block,
      props: nextProps,
    }
  })
  return {
    schema: 'topomind.smart-document',
    version: 1,
    title: value.title,
    blocks,
  }
}

function buildAttachmentRecordMapByRef(records: LocalAttachmentRecord[]) {
  const result = new Map<string, LocalAttachmentRecord>()
  for (const record of records) {
    if (record.deletedAt) continue
    result.set(normalizeAttachmentRef(record.fileName), record)
  }
  return result
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
  readOnly?: boolean
  value: unknown
  title: string
  onChange: (value: unknown) => void
  attachmentCardRef: string | null
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
  readOnly = false,
  value,
  title,
  onChange,
  onTocChange,
  onTocItemClickReady,
  attachmentCardRef,
  attachmentInsertTargetKey,
  onWordCountChange,
}: DocumentEditorAdapterProps) {
  const store = useStorage()
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const selectedNodeId = useSelectedNodeId()
  const persistedValue = React.useMemo(
    () => normalizeSmartDocumentContent(parseJsonValue(value), title),
    [title, value]
  )
  const documentInstanceKey = attachmentInsertTargetKey || title
  const attachmentSyncContext: AttachmentUploadSyncContext | undefined =
    currentWorkspaceId && selectedNodeId
      ? {
          workspaceId: currentWorkspaceId,
          cardId: selectedNodeId,
          documentId: topoDocumentIdFromKey(attachmentInsertTargetKey),
        }
      : undefined
  const attachmentUrlCacheRef = React.useRef<Map<string, string>>(new Map())
  const knownAttachmentNamesRef = React.useRef<Set<string>>(new Set())
  const attachmentRecordByRefRef = React.useRef<Map<string, LocalAttachmentRecord>>(new Map())
  const [attachmentRuntimeVersion, setAttachmentRuntimeVersion] = React.useState(0)

  React.useEffect(() => {
    attachmentUrlCacheRef.current = new Map()
    knownAttachmentNamesRef.current = new Set()
    attachmentRecordByRefRef.current = new Map()
    setAttachmentRuntimeVersion((version) => version + 1)

    if (!attachmentCardRef) return
    let cancelled = false
    const preloadPromise =
      currentWorkspaceId && selectedNodeId
        ? LocalDB.listAttachmentsByCard(currentWorkspaceId, selectedNodeId).then((records) => {
            if (cancelled) return
            const activeRecords = records.filter((record) => !record.deletedAt)
            knownAttachmentNamesRef.current = new Set(activeRecords.map((record) => record.fileName))
            attachmentRecordByRefRef.current = buildAttachmentRecordMapByRef(activeRecords)
            setAttachmentRuntimeVersion((version) => version + 1)
          })
        : store.listAttachments(attachmentCardRef).then((items) => {
            if (cancelled) return
            knownAttachmentNamesRef.current = new Set(items.map((item) => item.name))
            setAttachmentRuntimeVersion((version) => version + 1)
          })
    preloadPromise.catch((error) => {
      console.error('Failed to preload attachment refs', error)
    })
    return () => {
      cancelled = true
    }
  }, [attachmentCardRef, currentWorkspaceId, selectedNodeId, store])

  const { runtimeValue, missingAttachmentRefs } = React.useMemo(() => {
    return buildSmartDocumentRuntimeValue(
      persistedValue,
      attachmentUrlCacheRef.current,
      knownAttachmentNamesRef.current
    )
  }, [attachmentRuntimeVersion, persistedValue])

  const missingAttachmentRefsKey = React.useMemo(
    () => missingAttachmentRefs.join('|'),
    [missingAttachmentRefs]
  )

  React.useEffect(() => {
    const refsToResolve = missingAttachmentRefsKey ? missingAttachmentRefsKey.split('|') : []
    if (!attachmentCardRef || refsToResolve.length === 0) return
    let cancelled = false
    Promise.all(
      refsToResolve.map(async (attachmentRef) => {
        const attachmentRecord = attachmentRecordByRefRef.current.get(attachmentRef)
        const url =
          currentWorkspaceId && attachmentRecord
            ? await getCloudAttachmentLocalUrl({
                workspaceId: currentWorkspaceId,
                attachmentId: attachmentRecord.id,
                fileName: attachmentRecord.fileName,
              })
            : await store.getAttachmentAbsoluteUrl(attachmentCardRef, attachmentRef)
        if (!url || cancelled) return false
        attachmentUrlCacheRef.current.set(attachmentRef, url)
        knownAttachmentNamesRef.current.add(getAttachmentFileNameFromRef(attachmentRef))
        return true
      })
    ).then((results) => {
      if (cancelled || !results.some(Boolean)) return
      setAttachmentRuntimeVersion((version) => version + 1)
    }).catch((error) => {
      console.error('Failed to resolve attachment URLs', error)
    })
    return () => {
      cancelled = true
    }
  }, [attachmentCardRef, currentWorkspaceId, missingAttachmentRefsKey, store])

  const handleChange = React.useCallback((nextValue: SmartDocumentContent) => {
    onChange(buildSmartDocumentPersistedValue(nextValue, knownAttachmentNamesRef.current))
  }, [onChange])

  const uploadFile = React.useCallback(async (file: File) => {
    if (!attachmentCardRef) {
      throw new Error('当前文档未绑定附件目录，无法上传文件')
    }
    try {
      const normalizedMimeType = normalizeAttachmentMimeType(file.type, file.name)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const base64Data = base64.split(',')[1]
      const uploadTicketJson = await maybeCreateAttachmentUploadTicket({
        syncContext: attachmentSyncContext,
        fileName: file.name,
        mimeType: normalizedMimeType,
        sizeBytes: file.size,
      })
      const attachmentRef = await store.writeAttachmentBase64(
        attachmentCardRef,
        file.name,
        normalizedMimeType,
        base64Data,
        attachmentSyncContext,
        uploadTicketJson,
      )
      const url = await store.getAttachmentAbsoluteUrl(attachmentCardRef, attachmentRef)
      if (!url) throw new Error('附件写入成功，但无法生成访问地址')
      attachmentUrlCacheRef.current.set(attachmentRef, url)
      knownAttachmentNamesRef.current.add(getAttachmentFileNameFromRef(attachmentRef))
      setAttachmentRuntimeVersion((version) => version + 1)
      return {
        props: {
          url: attachmentRef,
          attachmentRef,
          name: file.name,
        },
      }
    } catch (e) {
      console.error('Failed to upload file', e)
      throw e
    }
  }, [attachmentCardRef, attachmentSyncContext, store])

  const resolveFileUrl = React.useCallback(async (url: string) => {
    if (!url) return url
    if (!attachmentCardRef) return url
    if (!canDeriveAttachmentRefFromUrl(url) && !/^_attach[\\/]/i.test(url)) return url

    const attachmentRef = normalizeAttachmentRef(url)
    const cachedUrl = attachmentUrlCacheRef.current.get(attachmentRef)
    if (cachedUrl) return cachedUrl

    const attachmentRecord = attachmentRecordByRefRef.current.get(attachmentRef)
    const resolvedUrl =
      currentWorkspaceId && attachmentRecord
        ? await getCloudAttachmentLocalUrl({
            workspaceId: currentWorkspaceId,
            attachmentId: attachmentRecord.id,
            fileName: attachmentRecord.fileName,
          })
        : await store.getAttachmentAbsoluteUrl(attachmentCardRef, attachmentRef)
    if (!resolvedUrl) return url

    attachmentUrlCacheRef.current.set(attachmentRef, resolvedUrl)
    knownAttachmentNamesRef.current.add(getAttachmentFileNameFromRef(attachmentRef))
    return resolvedUrl
  }, [attachmentCardRef, currentWorkspaceId, store])

  return (
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-muted-foreground">加载编辑器...</div>}>
      <SmartDocumentEditor
        key={documentInstanceKey}
        value={runtimeValue}
        onChange={handleChange}
        readOnly={readOnly}
        onTocChange={onTocChange}
        onTocItemClickReady={onTocItemClickReady}
        uploadFile={uploadFile}
        resolveFileUrl={resolveFileUrl}
        onWordCountChange={(stats: any) => onWordCountChange(stats)}
        attachmentInsertTargetKey={attachmentInsertTargetKey}
      />
    </Suspense>
  )
}

function MindMapDocumentAdapter({ readOnly = false, value, title, onChange, onTocChange, onTocItemClickReady, onWordCountChange, attachmentInsertTargetKey }: DocumentEditorAdapterProps) {
  const { objectValue, handleChange } = useStructuredDocumentValue(value, title, normalizeMindMapDocumentContent, onChange)
  const documentInstanceKey = attachmentInsertTargetKey || title

  React.useEffect(() => {
    onTocChange([])
    onTocItemClickReady(null)
    onWordCountChange(null)
  }, [onTocChange, onTocItemClickReady, onWordCountChange])

  return (
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-muted-foreground">加载编辑器...</div>}>
      <MindMapDocumentEditor key={documentInstanceKey} value={objectValue} onChange={handleChange} readOnly={readOnly} />
    </Suspense>
  )
}

function FlowchartDocumentAdapter({ readOnly = false, value, title, onChange, onTocChange, onTocItemClickReady, onWordCountChange, attachmentInsertTargetKey }: DocumentEditorAdapterProps) {
  const { objectValue, handleChange } = useStructuredDocumentValue(value, title, normalizeFlowchartDocumentContent, onChange)
  const documentInstanceKey = attachmentInsertTargetKey || title

  React.useEffect(() => {
    onTocChange([])
    onTocItemClickReady(null)
    onWordCountChange(null)
  }, [onTocChange, onTocItemClickReady, onWordCountChange])

  return (
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-muted-foreground">加载编辑器...</div>}>
      <FlowchartDocumentEditor key={documentInstanceKey} value={objectValue} onChange={handleChange} readOnly={readOnly} />
    </Suspense>
  )
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

