/**
 * 容器节点（v1.4）：关系树上的普通节点，**只读预览**，永远不挂载编辑器。
 *
 * 双击只把会话写进 activeContainerStore，由 ContainerFullscreenEditorHost 在
 * document.body 上开全屏编辑器；宿主落盘后 bump revision，本节点据此重读一次
 * 磁盘并重建 SVG 预览。编辑与画布缩放彻底解耦，也不再受 React Flow transform
 * 影响 Excalidraw 的指针坐标。
 */
import { memo, useEffect, useMemo, useState } from 'react'
import { Handle, Position, type NodeProps, useStore } from '@xyflow/react'
import type { KnowledgeNode } from '../../../../../types'
import { useStorage } from '../../../../../core/storage'
import { tabStore } from '../../../../../stores/tabs/tabStore'
import { resolveRoomChildRef } from '../../../../../domain/graph/path-utils'
import { toDisplayPercent } from '../../../../../domain/graph/zoomScale'
import { useGraphContext } from '../../../../../contexts/GraphContext'
import { getContainerType } from '../../../../../domain/container/containerTypes'
import { getContainerRenderer } from '../../containers/containerRenderers'
import { useActiveContainerStore } from '../../containers/activeContainerStore'

/** 低于该显示百分比只给静态占位，不为远景容器排队导出 SVG。 */
const PREVIEW_MIN_DISPLAY_PERCENT = 60

function ContainerMessage({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-3 text-center text-[11px] leading-4 text-[var(--color-text-muted)]">
      {text}
    </div>
  )
}

function ContainerCard({ id, data, selected }: NodeProps<KnowledgeNode>) {
  const containerRef = data.container
  const renderer = containerRef ? getContainerRenderer(containerRef.type) : undefined
  const spec = containerRef ? getContainerType(containerRef.type) : undefined
  const storage = useStorage()
  const graph = useGraphContext()
  const zoom = useStore((state) => state.transform[2])
  const session = useActiveContainerStore((state) => state.session)
  const revision = useActiveContainerStore((state) => state.revision)
  const activate = useActiveContainerStore((state) => state.activate)

  const [loaded, setLoaded] = useState<{ key: string; value: unknown } | null>(null)
  const [loadError, setLoadError] = useState(false)

  const cardPath = useMemo(() => resolveRoomChildRef(
    typeof data.parent === 'string' ? data.parent : '',
    typeof data.cardRef === 'string' ? data.cardRef : id,
  ), [data.parent, data.cardRef, id])

  const title = String(data.label || '未命名容器')
  // 显示 100% 的 raw zoom 是 0.65（ZOOM_REFERENCE）；预览 LOD 必须走显示比，
  // 但**编辑入口不再有缩放门槛**——全屏编辑与画布镜头无关。
  const displayPercent = toDisplayPercent(zoom)
  const isEditingThis = session?.nodeId === id
  const docKey = `${cardPath}:${containerRef?.documentId ?? ''}`
  const content = loaded?.key === docKey ? loaded.value : undefined

  useEffect(() => {
    // 全屏编辑期间本节点只显示上一次的静态预览（且被覆盖层遮住），不读盘；
    // 退出后由 isEditingThis / revision 变化触发一次重读，拿到宿主刚落盘的内容。
    if (isEditingThis) return
    let cancelled = false
    setLoadError(false)
    if (!containerRef || !spec) return
    void storage.readTopoDocument(cardPath, containerRef.documentId).then((raw) => {
      if (cancelled) return
      try { setLoaded({ key: docKey, value: spec.normalize(raw, title) }) }
      catch { setLoadError(true) }
    }).catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [docKey, cardPath, containerRef?.documentId, spec, storage, title, revision, isEditingThis])

  const Preview = renderer?.Preview

  return (
    <div
      data-tm-container-card={id}
      data-tm-container-active={isEditingThis ? 'true' : 'false'}
      onPointerDownCapture={() => graph.selectNode(id)}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (!containerRef || !renderer) return
        activate({
          nodeId: id,
          tabId: tabStore.getState().activeTabId,
          cardPath,
          documentId: containerRef.documentId,
          containerType: containerRef.type,
          title,
        })
      }}
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-lg border bg-[var(--color-surface)] ${
        selected ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
      }`}
      title="双击进入全屏编辑（节点仅显示预览）"
    >
      <Handle type="target" position={Position.Left} className="w-0 h-0 border-none opacity-0" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="w-0 h-0 border-none opacity-0" />
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-2 text-[11px] font-semibold text-[var(--color-text-primary)]">
        <span className="truncate">{title}</span>
        {isEditingThis && (
          <span className="shrink-0 rounded bg-[var(--color-hover-bg)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
            全屏编辑中
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {!renderer || !spec || !containerRef ? (
          <ContainerMessage text={`未知容器类型：${containerRef?.type ?? '未配置'}（原始数据已保留）`} />
        ) : loadError ? (
          <ContainerMessage text="载荷读取失败或版本不受支持，原始文件已保留" />
        ) : content === undefined ? (
          <ContainerMessage text="正在加载容器内容..." />
        ) : Preview ? (
          <Preview
            nodeId={id}
            documentId={containerRef.documentId}
            content={content}
            title={title}
            visible={displayPercent >= PREVIEW_MIN_DISPLAY_PERCENT}
          />
        ) : (
          <ContainerMessage text="容器缺少预览渲染器" />
        )}
      </div>
    </div>
  )
}

export default memo(ContainerCard)
