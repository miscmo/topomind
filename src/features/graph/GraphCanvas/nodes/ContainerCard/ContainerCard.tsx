/**
 * 容器节点：仍是关系树上的普通节点，只是把内容区外包给 container.type 对应的渲染器。
 *
 * 两态模型：非活跃 / 显示比不足只渲染 SVG 预览（零编辑器实例）；
 * 唯一活跃且显示比达到注册表门槛时才 lazy 挂载编辑器。内容编辑与画布只读闸门解耦。
 */
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, type NodeProps, useStore } from '@xyflow/react'
import type { KnowledgeNode } from '../../../../../types'
import { useStorage } from '../../../../../core/storage'
import { registerTabSaver } from '../../../../../core/close-guard'
import { tabStore } from '../../../../../stores/tabs/tabStore'
import { resolveRoomChildRef } from '../../../../../domain/graph/path-utils'
import { toDisplayPercent } from '../../../../../domain/graph/zoomScale'
import { useGraphContext } from '../../../../../contexts/GraphContext'
import { getContainerType } from '../../../../../domain/container/containerTypes'
import { getContainerRenderer } from '../../containers/containerRenderers'
import { useActiveContainerStore, deactivateActiveContainer } from '../../containers/activeContainerStore'

/** 低于该显示百分比只给静态占位，不为远景容器排队导出 SVG。 */
const PREVIEW_MIN_DISPLAY_PERCENT = 60
/** 内容保存 debounce：比右栏 1500ms 更短，避免失焦时丢笔画。 */
const CONTAINER_SAVE_DELAY_MS = 400

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
  const activeId = useActiveContainerStore((state) => state.activeId)
  const activate = useActiveContainerStore((state) => state.activate)

  const [content, setContent] = useState<unknown>(undefined)
  const [loadError, setLoadError] = useState(false)
  const pendingRef = useRef<unknown>(null)
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const lastVersionRef = useRef<number | null>(null)

  const cardPath = useMemo(() => resolveRoomChildRef(
    typeof data.parent === 'string' ? data.parent : '',
    typeof data.cardRef === 'string' ? data.cardRef : id,
  ), [data.parent, data.cardRef, id])

  const title = String(data.label || '未命名容器')
  // 显示 100% 的 raw zoom 是 0.65（ZOOM_REFERENCE），用裸 transform[2] 跟 1 比会永远不可编辑。
  const displayPercent = toDisplayPercent(zoom)
  const canActivate = Boolean(renderer && containerRef
    && displayPercent >= (renderer?.minEditDisplayPercent ?? 100))
  const isActive = activeId === id
  const editing = isActive && canActivate

  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    setContent(undefined)
    if (!containerRef || !spec) return
    void storage.readTopoDocument(cardPath, containerRef.documentId).then((raw) => {
      if (cancelled) return
      try { setContent(spec.normalize(raw, title)) } catch { setLoadError(true) }
    }).catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [cardPath, containerRef?.documentId, spec, storage, title])

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!dirtyRef.current || !containerRef) return
    try {
      await storage.writeTopoDocument(cardPath, containerRef.documentId, pendingRef.current)
      dirtyRef.current = false
    } catch {
      // 保留 dirty，close-guard / 下一次编辑 / 下次激活都会重试，绝不覆盖更晚的输入。
    }
  }, [cardPath, containerRef?.documentId, storage])

  const handleChange = useCallback((next: unknown) => {
    const version = spec?.getSceneVersion?.(next) ?? null
    if (version !== null && version === lastVersionRef.current) return
    lastVersionRef.current = version
    setContent(next)
    pendingRef.current = next
    dirtyRef.current = true
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { void flush() }, CONTAINER_SAVE_DELAY_MS)
  }, [flush, spec])

  // 失活 / 缩放下降 / 切房间 / 卸载：先 flush 再允许编辑器实例消失。
  useEffect(() => {
    if (!editing) { void flush(); return }
    const tabId = tabStore.getState().activeTabId
    return registerTabSaver(tabId, flush, () => dirtyRef.current)
  }, [editing, flush])

  useEffect(() => () => { void flush() }, [flush])

  const handleRequestDeactivate = useCallback(() => {
    void flush().finally(() => deactivateActiveContainer(id))
  }, [flush, id])

  const Preview = renderer?.Preview
  const Editor = renderer?.Editor

  return (
    <div
      data-tm-container-card={id}
      data-tm-container-active={editing ? 'true' : 'false'}
      onPointerDownCapture={() => graph.selectNode(id)}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (canActivate) activate(id)
      }}
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-lg border bg-[var(--color-surface)] ${
        selected ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
      }`}
      title={canActivate ? '双击进入编辑' : '放大到 100% 后双击可编辑'}
    >
      <Handle type="target" position={Position.Left} className="w-0 h-0 border-none opacity-0" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="w-0 h-0 border-none opacity-0" />
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-2 text-[11px] font-semibold text-[var(--color-text-primary)]">
        <span className="truncate">{title}</span>
        {editing && (
          <button
            type="button"
            className="nodrag shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:bg-[var(--color-hover-bg)]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); handleRequestDeactivate() }}
          >
            退出编辑
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {!renderer || !spec || !containerRef ? (
          <ContainerMessage text={`未知容器类型：${containerRef?.type ?? '未配置'}（原始数据已保留）`} />
        ) : loadError ? (
          <ContainerMessage text="载荷读取失败或版本不受支持，原始文件已保留" />
        ) : content === undefined ? (
          <ContainerMessage text="正在加载容器内容..." />
        ) : editing && Editor ? (
          <Suspense fallback={<ContainerMessage text="正在加载编辑器..." />}>
            <Editor
              nodeId={id}
              documentId={containerRef.documentId}
              cardPath={cardPath}
              content={content}
              title={title}
              active
              onChange={handleChange}
              onRequestDeactivate={handleRequestDeactivate}
            />
          </Suspense>
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
