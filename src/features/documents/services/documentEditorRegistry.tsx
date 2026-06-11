import React, { Suspense, lazy } from 'react'
import type { TopoDocumentType } from '../../../core/storage'
import type { TocItem } from '../types/workspaceTypes'
import { normalizeSmartDocumentContent } from '../SmartDocumentEditor/smartDocumentTypes'
import type { BlockNoteBlock, SmartDocumentContent } from '../SmartDocumentEditor/smartDocumentTypes'
import { normalizeMindMapDocumentContent } from '../MindMapDocumentEditor/mindMapDocumentTypes'
import { normalizeFlowchartDocumentContent } from '../FlowchartDocumentEditor/flowchartDocumentTypes'
import { useStorage } from '../../../core/storage'

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
    ...value,
    blocks,
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
  const persistedValue = React.useMemo(
    () => normalizeSmartDocumentContent(parseJsonValue(value), title),
    [title, value]
  )
  const documentInstanceKey = attachmentInsertTargetKey || title
  const attachmentUrlCacheRef = React.useRef<Map<string, string>>(new Map())
  const knownAttachmentNamesRef = React.useRef<Set<string>>(new Set())
  const [attachmentRuntimeVersion, setAttachmentRuntimeVersion] = React.useState(0)

  React.useEffect(() => {
    attachmentUrlCacheRef.current = new Map()
    knownAttachmentNamesRef.current = new Set()
    setAttachmentRuntimeVersion((version) => version + 1)

    if (!attachmentCardPath) return
    let cancelled = false
    store.listAttachments(attachmentCardPath)
      .then((items) => {
        if (cancelled) return
        knownAttachmentNamesRef.current = new Set(items.map((item) => item.name))
        setAttachmentRuntimeVersion((version) => version + 1)
      })
      .catch((error) => {
        console.error('Failed to preload attachment refs', error)
      })
    return () => {
      cancelled = true
    }
  }, [attachmentCardPath, store])

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
    if (!attachmentCardPath || refsToResolve.length === 0) return
    let cancelled = false
    Promise.all(
      refsToResolve.map(async (attachmentRef) => {
        const url = await store.getAttachmentAbsoluteUrl(attachmentCardPath, attachmentRef)
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
  }, [attachmentCardPath, missingAttachmentRefsKey, store])

  const handleChange = React.useCallback((nextValue: SmartDocumentContent) => {
    onChange(buildSmartDocumentPersistedValue(nextValue, knownAttachmentNamesRef.current))
  }, [onChange])

  const uploadFile = React.useCallback(async (file: File) => {
    if (!attachmentCardPath) {
      throw new Error('当前文档未绑定附件目录，无法上传文件')
    }
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const base64Data = base64.split(',')[1]
      const attachmentRef = await store.writeAttachmentBase64(attachmentCardPath, file.name, file.type, base64Data)
      const url = await store.getAttachmentAbsoluteUrl(attachmentCardPath, attachmentRef)
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
  }, [attachmentCardPath, store])

  const resolveFileUrl = React.useCallback(async (url: string) => {
    if (!url) return url
    if (!attachmentCardPath) return url
    if (!canDeriveAttachmentRefFromUrl(url) && !/^_attach[\\/]/i.test(url)) return url

    const attachmentRef = normalizeAttachmentRef(url)
    const cachedUrl = attachmentUrlCacheRef.current.get(attachmentRef)
    if (cachedUrl) return cachedUrl

    const resolvedUrl = await store.getAttachmentAbsoluteUrl(attachmentCardPath, attachmentRef)
    if (!resolvedUrl) return url

    attachmentUrlCacheRef.current.set(attachmentRef, resolvedUrl)
    knownAttachmentNamesRef.current.add(getAttachmentFileNameFromRef(attachmentRef))
    return resolvedUrl
  }, [attachmentCardPath, store])

  return (
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-muted-foreground">加载编辑器...</div>}>
      <SmartDocumentEditor
        key={documentInstanceKey}
        value={runtimeValue}
        onChange={handleChange}
        onTocChange={onTocChange}
        onTocItemClickReady={onTocItemClickReady}
        uploadFile={uploadFile}
        resolveFileUrl={resolveFileUrl}
        onWordCountChange={onWordCountChange}
        attachmentInsertTargetKey={attachmentInsertTargetKey}
      />
    </Suspense>
  )
}

function MindMapDocumentAdapter({ value, title, onChange, onTocChange, onTocItemClickReady, onWordCountChange, attachmentInsertTargetKey }: DocumentEditorAdapterProps) {
  const { objectValue, handleChange } = useStructuredDocumentValue(value, title, normalizeMindMapDocumentContent, onChange)
  const documentInstanceKey = attachmentInsertTargetKey || title

  React.useEffect(() => {
    onTocChange([])
    onTocItemClickReady(null)
    onWordCountChange(null)
  }, [onTocChange, onTocItemClickReady, onWordCountChange])

  return (
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-muted-foreground">加载编辑器...</div>}>
      <MindMapDocumentEditor key={documentInstanceKey} value={objectValue} onChange={handleChange} />
    </Suspense>
  )
}

function FlowchartDocumentAdapter({ value, title, onChange, onTocChange, onTocItemClickReady, onWordCountChange, attachmentInsertTargetKey }: DocumentEditorAdapterProps) {
  const { objectValue, handleChange } = useStructuredDocumentValue(value, title, normalizeFlowchartDocumentContent, onChange)
  const documentInstanceKey = attachmentInsertTargetKey || title

  React.useEffect(() => {
    onTocChange([])
    onTocItemClickReady(null)
    onWordCountChange(null)
  }, [onTocChange, onTocItemClickReady, onWordCountChange])

  return (
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-muted-foreground">加载编辑器...</div>}>
      <FlowchartDocumentEditor key={documentInstanceKey} value={objectValue} onChange={handleChange} />
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
