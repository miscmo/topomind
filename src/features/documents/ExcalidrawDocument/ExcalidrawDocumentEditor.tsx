/**
 * 独立「手绘流程图」文档的右栏编辑器。
 *
 * 编辑器内核复用 ExcalidrawBlockFullscreenEditor（全项目唯一静态 import
 * @excalidraw/excalidraw 的文件），这里只负责三件事：
 *   1. 把右栏会话传入的 unknown 内容归一化成 ExcalidrawDocumentContent；
 *   2. 用 excalidrawSceneVersion 去重，Excalidraw 的平移 / 缩放 / 点选不会把
 *      文档标脏，也不会触发右栏 1500ms 整篇覆盖写盘；
 *   3. 订阅外部写 revision：正文里的引用块改完图后，这里重挂载读新场景，
 *      避免右栏持有旧草稿把磁盘内容覆盖回去。
 *
 * 内核必须 lazy：Excalidraw 不能进右栏 / 智能文档的主 chunk。
 */
import { Suspense, lazy, memo, useCallback, useMemo, useRef } from 'react'
import {
  excalidrawSceneVersion,
  normalizeExcalidrawDocumentContent,
  serializeExcalidrawDocumentContent,
} from './excalidrawDocumentTypes'
import { useDocumentExternalRevision } from '../services/documentExternalWriteBus'

const ExcalidrawCore = lazy(() =>
  import('../SmartDocumentEditor/ExcalidrawBlockFullscreenEditor').then((module) => ({
    default: module.ExcalidrawBlockFullscreenEditor,
  })),
)

export interface ExcalidrawDocumentEditorProps {
  value: unknown
  title: string
  onChange: (value: unknown) => void
  documentId?: string | null
}

export const ExcalidrawDocumentEditor = memo(function ExcalidrawDocumentEditor({
  value, title, onChange, documentId,
}: ExcalidrawDocumentEditorProps) {
  const revision = useDocumentExternalRevision(documentId ?? null)
  const normalized = useMemo(() => {
    try {
      return normalizeExcalidrawDocumentContent(value, title)
    } catch {
      // 未知 version 绝不静默降级成空场景，否则一次 autosave 就会覆盖掉看不懂的数据。
      return null
    }
  }, [value, title])
  const initialScene = useMemo(
    () => normalized ? serializeExcalidrawDocumentContent(normalized) : '',
    [normalized],
  )
  // initialData 只在 Excalidraw 实例挂载时读一次：右栏 autosave 会把 value 回灌，
  // 若把每次重算的 initialScene 直接传下去，编辑器会被反复喂入新 initialData。
  // adapter 在外部写 revision 变化时用新 key 重挂载，这个 ref 会随之重置。
  const frozenInitialSceneRef = useRef<string | null>(null)
  if (frozenInitialSceneRef.current === null && initialScene) {
    frozenInitialSceneRef.current = initialScene
  }

  // 每次渲染同步「已落盘基线」：autosave 回灌 value 后，下一次 onChange 的
  // 比较基准要跟着换，否则同一份内容会被反复判脏。
  const versionRef = useRef<number>(Number.NaN)
  versionRef.current = normalized ? excalidrawSceneVersion(normalized) : Number.NaN

  const handleChange = useCallback((serialized: string) => {
    let next
    try {
      next = normalizeExcalidrawDocumentContent(JSON.parse(serialized), title)
    } catch {
      return
    }
    const nextVersion = excalidrawSceneVersion(next)
    if (nextVersion === versionRef.current) return
    versionRef.current = nextVersion
    onChange(next)
  }, [title, onChange])

  if (!normalized) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]"
        data-tm-excalidraw-document-unsupported="true"
      >
        <span>流程图文档数据版本不受支持，已保留原始数据</span>
      </div>
    )
  }

  return (
    <div
      className="relative h-full w-full min-h-0"
      data-tm-excalidraw-document-editor={documentId ?? ''}
    >
      <Suspense fallback={
        <div className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
          正在加载编辑器…
        </div>
      }>
        <ExcalidrawCore
          key={`${documentId ?? title}#r${revision}`}
          blockId={documentId ?? title}
          title={title}
          initialScene={frozenInitialSceneRef.current ?? ''}
          onChange={handleChange}
        />
      </Suspense>
    </div>
  )
})
