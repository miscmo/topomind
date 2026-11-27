/**
 * AI 回答引用的临时只读预览层（P5-r）。
 *
 * 它绝对定位盖在右栏「详情」之上，DetailPanel 仍保持挂载，所以关闭预览后
 * 原来的文档 / 草稿 / 滚动位置原样恢复。这里只按 docId 反查到的 cardPath
 * 读目标正文，不写 detailPanelStore、不切 tabStore 房间、不改 graphStore 选中。
 *
 * 渲染必须走 getDocumentEditorAdapter('smart')，即「节点关联文档 / 正常右栏」
 * 同一套链路：文档里图片持久化的是 `_attach/xxx.png` 相对引用，要靠 adapter 的
 * listAttachments + getAttachmentAbsoluteUrl + resolveFileUrl + 运行时 URL 替换
 * 才能解析成 local-file://。早先这里裸挂 SmartDocumentEditor，整条附件解析
 * 链路被跳过，结果就是预览里正文有、图片全裂。
 *
 * preview 开关负责关掉第二个实例的全局副作用：模块级单例 handler 与 AI 选中态
 * 通道都只能由主编辑器持有，否则预览打开/关闭会覆盖当前文档上下文。
 */
import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useStorage } from '../../../../core/storage'
import { getDocumentEditorAdapter } from '../../../documents/services/documentEditorRegistry'
import { topoDocumentPath } from '../../../documents/types/documentTypes'
import { TM_UI, tmUI } from '../../../../shared/ui/controlStyles'
import { useReferencePreviewStore, type ReferencePreviewTarget } from '../../model/referencePreviewStore'

const NOOP = () => {}
const SMART_ADAPTER = getDocumentEditorAdapter('smart')

/** 换目标文档就整体重挂载：读盘状态天然是干净的，effect 里不需要同步 setState。 */
export function ReferencePreviewPanel() {
  const target = useReferencePreviewStore((state) => state.target)
  if (!target) return null
  return <ReferencePreviewContent key={`${target.docId}:${target.cardPath}`} target={target} />
}

function ReferencePreviewContent({ target }: { target: ReferencePreviewTarget }) {
  const closePreview = useReferencePreviewStore((state) => state.closePreview)
  const storage = useStorage()
  const { docId, cardPath, title, type } = target
  const [content, setContent] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void storage.readTopoDocument(cardPath, docId)
      .then((value) => { if (alive) setContent(value) })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [storage, docId, cardPath])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePreview()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePreview])

  const isSmartDocument = !type || type === 'smart'
  const origin = target.sourceLabel || target.breadcrumb || target.nodeName || ''
  const meta = [origin, target.nodeName, target.blockLabel]
    .filter((item): item is string => Boolean(item))
    .join(' · ')

  // 与 DocumentEditorHost 完全一致的 adapter 参数：attachmentCardPath 必须是目标
  // 文档实际所属节点路径（附件物理目录），attachmentInsertTargetKey 用全库 docId
  // 生成，让运行时 URL 替换、外部写入 revision 都锁定在正确的文档上。
  const adapterProps = useMemo(() => ({
    value: content,
    title,
    onChange: NOOP,
    attachmentCardPath: cardPath,
    attachmentInsertTargetKey: topoDocumentPath(docId),
    onTocChange: NOOP,
    onTocItemClickReady: NOOP,
    onWordCountChange: NOOP,
    onOpenDocumentByDocId: NOOP,
    documentId: docId,
    documentTitle: title,
    preview: true,
  }), [content, title, cardPath, docId])

  return (
    <div
      className={tmUI(TM_UI.aiRefPreview, 'absolute inset-0 z-10 flex min-h-0 flex-col')}
      data-tm-ai-reference-preview=""
      data-tm-ai-reference-preview-doc-id={docId}
      role="region"
      aria-label="引用文档临时预览"
    >
      <div className={tmUI(TM_UI.aiRefPreviewBar, 'flex shrink-0 items-start gap-2')}>
        <button
          type="button"
          className={tmUI(TM_UI.button, 'inline-flex shrink-0 items-center gap-1')}
          onClick={closePreview}
          data-tm-ai-reference-preview-close=""
          title="关闭预览，返回原来的详情（Esc）"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={TM_UI.badgeAccent}>引用预览 · 只读</span>
            <span
              className={tmUI(TM_UI.aiRefPreviewTitle, 'truncate')}
              data-tm-ai-reference-preview-title=""
              title={title}
            >
              {title}
            </span>
          </div>
          {meta && <div className={tmUI(TM_UI.hint, 'mt-0.5 truncate')} title={meta}>来源：{meta}</div>}
        </div>
      </div>

      <div
        className={tmUI(TM_UI.scroll, 'min-h-0 flex-1 overflow-y-auto px-3 py-2')}
        data-tm-ai-reference-preview-body=""
      >
        {loading ? (
          <div className={TM_UI.hint}>正在加载引用文档…</div>
        ) : error ? (
          <div className={TM_UI.hint}>读取文档失败：{error}</div>
        ) : isSmartDocument && SMART_ADAPTER ? (
          <div className="h-full min-h-0">
            {SMART_ADAPTER.render(adapterProps)}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className={TM_UI.hint}>该类型文档暂不支持在此预览完整版式，以下是检索命中的片段。</div>
            <div className="whitespace-pre-wrap break-words">{target.snippet || '（无可用片段）'}</div>
          </div>
        )}
      </div>
    </div>
  )
}
