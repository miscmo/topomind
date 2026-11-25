/**
 * 容器节点（v1.5）：关系树上的普通节点，**只读预览**，永远不挂载编辑器。
 *
 * 双击只把会话写进 activeContainerStore，由 ContainerFullscreenEditorHost 在
 * document.body 上开全屏编辑器；宿主落盘后 bump revision，本节点据此重读一次
 * 磁盘并重建 SVG 预览。编辑与画布缩放彻底解耦，也不再受 React Flow transform
 * 影响 Excalidraw 的指针坐标。
 *
 * v1.5：节点边框可拖拽调整尺寸。刻意拆成两层壳——
 *   - 锚点壳 overflow-visible：NodeResizer 的 8 个手柄画在边框外侧，
 *     若沿用单层 overflow-hidden，手柄会被直接裁掉（KnowledgeCard 同理用 overflow-visible）；
 *   - 视觉壳 overflow-hidden：只负责圆角、边框与 SVG 预览裁切。
 * 尺寸链路完全复用既有 NodeResizer → onNodesChange(dimensions) → applyNodeDimensionChanges
 * → buildMetaFromNodesEdges → _graph.json，不新增任何持久化字段。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps, useStore } from '@xyflow/react'
import type { KnowledgeNode } from '../../../../../types'
import { useStorage } from '../../../../../core/storage'
import { tabStore } from '../../../../../stores/tabs/tabStore'
import { useActiveCanvasReadOnly } from '../../../../../stores/canvasReadOnlyStore'
import { useGraphStoreApi } from '../../../../../stores/graphStore'
import { useGraphUiStore } from '../../../../../stores/graphUiStore'
import { resolveRoomChildRef } from '../../../../../domain/graph/path-utils'
import { toDisplayPercent } from '../../../../../domain/graph/zoomScale'
import { useGraphContext } from '../../../../../contexts/GraphContext'
import { getContainerType } from '../../../../../domain/container/containerTypes'
import { getContainerRenderer } from '../../containers/containerRenderers'
import { useActiveContainerStore } from '../../containers/activeContainerStore'

/** 低于该显示百分比只给静态占位，不为远景容器排队导出 SVG。 */
const PREVIEW_MIN_DISPLAY_PERCENT = 60

/**
 * 【2026-11-24】容器节点（流程图 / 知识卡片 / 图片）统一放宽 resize 上限。
 * 普通知识节点仍走用户样式配置里的 nodeSizeLimits(默认 640×480)，不受影响：
 * 容器承载的是白板 / 卡片 / 大图，640×480 远不够看。这里只抬 max，min 继续
 * 沿用全局配置，保证用户调过的最小尺寸仍然生效。max 取「配置值 vs 放宽值」的
 * 较大者，避免用户把全局上限调到更大时反而被这里压回去。
 */
const CONTAINER_MAX_WIDTH = 1600
const CONTAINER_MAX_HEIGHT = 1200

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
  const storeApi = useGraphStoreApi()
  const zoom = useStore((state) => state.transform[2])
  const session = useActiveContainerStore((state) => state.session)
  const revision = useActiveContainerStore((state) => state.revision)
  const activate = useActiveContainerStore((state) => state.activate)
  // 只读闸门只影响「布局写操作」（拖节点 / 拉连线 / resize），不碰容器内容编辑：
  // 全屏宿主独立读写，缩小画布或大房间 LOD 隐藏节点时仍可双击进编辑器。
  const canvasReadOnly = useActiveCanvasReadOnly()
  const nodeSizeLimits = useGraphUiStore((state) => state.nodeSizeLimits)
  const containerLimits = useMemo(() => ({
    minWidth: nodeSizeLimits.minWidth,
    minHeight: nodeSizeLimits.minHeight,
    maxWidth: Math.max(nodeSizeLimits.maxWidth, CONTAINER_MAX_WIDTH),
    maxHeight: Math.max(nodeSizeLimits.maxHeight, CONTAINER_MAX_HEIGHT),
  }), [nodeSizeLimits.minWidth, nodeSizeLimits.minHeight, nodeSizeLimits.maxWidth, nodeSizeLimits.maxHeight])
  const [hovered, setHovered] = useState(false)
  const [loaded, setLoaded] = useState<{ key: string; value: unknown } | null>(null)

  // 这些派生值必须早于下面的尺寸自适应 useMemo/effect：依赖数组在渲染期求值，
  // 放在后面会踩 const 的 TDZ。
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

  const [loadError, setLoadError] = useState(false)
  // 图片类预览解码后上报原始像素；只作为运行时输入，绝不写进载荷。
  const [intrinsic, setIntrinsic] = useState<{ width: number; height: number } | null>(null)
  const lastFittedKeyRef = useRef('')

  const handleIntrinsicSize = useCallback((width: number, height: number) => {
    setIntrinsic((prev) => (prev?.width === width && prev?.height === height ? prev : { width, height }))
  }, [])

  // 由领域 spec 算出「载荷建议的节点尺寸」。目前只有图片容器实现，其他容器
  // 返回 null，本节点完全不介入尺寸，保持既有行为。
  const preferred = useMemo(() => {
    if (!spec || content === undefined) return null
    try {
      return spec.getPreferredNodeSize?.(content, containerLimits, intrinsic
        ? { intrinsicWidth: intrinsic.width, intrinsicHeight: intrinsic.height }
        : undefined) ?? null
    } catch { return null }
  }, [spec, content, containerLimits, intrinsic])

  useEffect(() => {
    if (!preferred || canvasReadOnly || isEditingThis) return
    // 同一组件实例里同一张图只处理一次，避免 React 重渲染反复写盘。
    if (lastFittedKeyRef.current === preferred.key) return
    const node = storeApi.getState().nodesMap.get(id)
    if (!node) return
    const currentWidth = node.width ?? node.measured?.width ?? 0
    const currentHeight = node.height ?? node.measured?.height ?? 0
    lastFittedKeyRef.current = preferred.key
    if (currentWidth <= 0 || currentHeight <= 0) return
    if (Math.abs(currentWidth - preferred.width) < 1 && Math.abs(currentHeight - preferred.height) < 1) return

    // 重开房间 / 切 tab 会重挂节点，lastFittedKeyRef 归零；但用户手动拖大的尺寸
    // 不能被重新拉回默认 480。用「当前比例 + 双份尺寸记账」判定，不新增落盘字段：
    //   - 比例不符 → 换图（或初始比例就不同），必须按新图比例重新适配；
    //   - 比例相符且 collapsed/expanded 记账已分叉 → NodeResizer 只写其中一份，
    //     说明用户手动 resize 过（且当时已锁比例），刷新后原样保留；
    //   - 比例相符、记账一致、尺寸又不是适配值 → 新建默认 360×240，执行首次适配。
    const targetRatio = preferred.width / preferred.height
    const ratioMatches = Math.abs(currentWidth / currentHeight - targetRatio) < 0.01
    const collapsedWidth = node.data.collapsedWidth ?? currentWidth
    const collapsedHeight = node.data.collapsedHeight ?? currentHeight
    const expandedWidth = node.data.expandedWidth ?? currentWidth
    const expandedHeight = node.data.expandedHeight ?? currentHeight
    const userResized = Math.abs(collapsedWidth - expandedWidth) >= 1
      || Math.abs(collapsedHeight - expandedHeight) >= 1
    if (ratioMatches && userResized) return

    // 尺寸必须同时写 width/height/measured 与 expanded/collapsed 记账：
    // buildMetaFromNodesEdges 落盘用的是 data.collapsedWidth，读回时又优先
    // data.expandedWidth；漏写任一组都会导致刷新后尺寸被打回 360×240。
    storeApi.getState().updateNode(id, (current) => ({
      ...current,
      width: preferred.width,
      height: preferred.height,
      measured: { ...(current.measured ?? {}), width: preferred.width, height: preferred.height },
      data: {
        ...current.data,
        collapsedWidth: preferred.width,
        collapsedHeight: preferred.height,
        expandedWidth: preferred.width,
        expandedHeight: preferred.height,
      },
    }))
    // effect 内不 await：节点预览不该阻塞渲染，落盘失败也不回滚界面尺寸。
    void graph.flushCurrentRoomSave()
  }, [preferred, canvasReadOnly, isEditingThis, id, storeApi, graph])

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
  // 与 KnowledgeCard 一致：只读期不挂手柄，避免出现「拖了却不动」；
  // 全屏会话中节点被覆盖层挡住，也没必要保留手柄。
  const showResizeHandles = !canvasReadOnly && !isEditingThis && (hovered || !!selected)

  return (
    <div
      data-tm-container-card={id}
      data-tm-container-active={isEditingThis ? 'true' : 'false'}
      data-tm-container-resizable={showResizeHandles ? 'true' : 'false'}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDownCapture={() => graph.selectNode(id)}
      onDoubleClick={(event) => {
        // 拖完边框松手时的双击余波落在手柄上，不能误开全屏编辑器。
        if ((event.target as Element | null)?.closest?.('.react-flow__resize-control')) return
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
      className="relative h-full w-full overflow-visible"
      title={`${title} · 双击进入全屏编辑（节点仅显示预览）；拖拽边框可调整节点大小`}
      aria-label={title}
    >
      <Handle type="target" position={Position.Left} className="w-0 h-0 border-none opacity-0" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="w-0 h-0 border-none opacity-0" />

      {showResizeHandles && (
        <NodeResizer
          isVisible
          minWidth={containerLimits.minWidth}
          minHeight={containerLimits.minHeight}
          maxWidth={containerLimits.maxWidth}
          maxHeight={containerLimits.maxHeight}
          // 图片容器节点已被纠正成图片的宽高比，锁住比例后任意拖边框都不会
          // 让图片与节点之间出现空隙或拉伸；其他容器保持自由 resize。
          keepAspectRatio={Boolean(preferred)}
          handleClassName="w-2 h-2 bg-[var(--color-surface)] border-[1.5px] border-[var(--color-accent)] rounded-sm shadow-sm z-30"
          lineClassName="border-transparent z-20"
        />
      )}

      <div
        className={`absolute inset-0 overflow-hidden rounded-lg border bg-[var(--color-surface)] ${
          selected ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
        }`}
      >
        {/* 【2026-11-23】容器节点默认不渲染 28px 标题栏，整块区域只放内容预览：
            节点名由外层 title / aria-label 与节点树承载，全屏编辑态由
            data-tm-container-active 暴露（GUI 回归与无障碍仍可识别），
            不再吃掉流程图的可视高度。 */}
        <div className="relative h-full w-full">
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
              cardPath={cardPath}
              content={content}
              title={title}
              visible={displayPercent >= PREVIEW_MIN_DISPLAY_PERCENT}
              onIntrinsicSize={handleIntrinsicSize}
            />
          ) : (
            <ContainerMessage text="容器缺少预览渲染器" />
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(ContainerCard)
