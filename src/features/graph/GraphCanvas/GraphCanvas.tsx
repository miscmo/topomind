import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Background, ReactFlow, type BackgroundVariant, type Edge, type Node, type NodeTypes } from '@xyflow/react'
import SelectionMirrorMenu from './components/SelectionMirrorMenu'
import { useGraphStore } from '../../../stores/graphStore'
import { MIRROR_MIN_SELECTED_NODES } from '../../../domain/graph/mirrorSelection'
import { PaintRoller } from 'lucide-react'
import KnowledgeCard from './nodes/KnowledgeCard'
import FloatingEdge from './edges/FloatingEdge'
import { SmartGuidesRenderer } from './SmartGuidesRenderer'
import { CardSnappedConnectionLine } from './components/CardSnappedConnectionLine'
import { CanvasMiniMap } from './components/CanvasMiniMap'
import { NodeSearchBox } from './components/NodeSearchBox'
import { EdgeRelationPicker } from './components/EdgeRelationPicker'
import LodControl from './components/LodControl'
import CanvasReadOnlyBanner from './components/CanvasReadOnlyBanner'
import ViewportReturnButton from './components/ViewportReturnButton'
import { useGraphCanvasModel, type UseGraphCanvasModelProps } from './model/useGraphCanvasModel'
import { useSemanticLod } from './model/useSemanticLod'
import { setLodMode } from './model/lodPreferences'
import { useStorage } from '../../../core/storage'
import { useGraphUiStore } from '../../../stores/graphUiStore'
import { normalizeGraphProfileId, type GraphProfileId } from '../../../domain/graph/graphProfiles'
import {
  MAX_RAW_ZOOM,
  MIN_RAW_ZOOM,
  clampPendingWheelDelta,
  clampWheelDelta,
  wheelDeltaStep,
  semanticZoomVarsForZoom,
  isCompactZoom,
  wheelSensitivityForZoom,
} from '../../../domain/graph/zoomScale'
import { computeCanvasReadOnly } from '../../../domain/graph/canvasReadOnly'
import { clearCanvasReadOnly, publishCanvasReadOnly } from '../../../stores/canvasReadOnlyStore'

const nodeTypes = { knowledgeCard: KnowledgeCard }
const edgeTypes = {
  smoothstep: FloatingEdge,
  straight: FloatingEdge,
  curve: FloatingEdge,
}

export default memo(function GraphCanvas({
  tabId,
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
  onCloseContextMenu,
}: UseGraphCanvasModelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const { state, graph, actions } = useGraphCanvasModel({
    tabId,
    onNodeContextMenu,
    onEdgeContextMenu,
    onPaneContextMenu,
    onCloseContextMenu,
  })

  const {
    showGrid,
    nodes,
    edges,
    renderViewport,
    zoomLevel,
    lodZoom,
    lodTier,
    roomPath,
    selectedNodeId,
    guideLines,
    isFormatPainterActive,
    isEdgeFormatPainterActive,
    isShiftPressed,
    isSearchOpen,
    isNodeInteractionActive,
  } = state

  const {
    handleNodesChange,
    handlePaneClick,
    handleMove,
    handleMoveEnd,
    handleNodeContextMenu,
    handleEdgeClick,
    handleEdgeContextMenu,
    handlePaneContextMenu,
    setIsSearchOpen,
    handleSearchSelectNode,
  } = actions

  // 语义缩放的视觉变量挂在最外层容器上，由所有节点继承。
  // 必须用连续 zoomLevel（不是 2% 台阶的 lodZoom）：compensation ≈ glyphScale/ratio，
  // 在 30% 附近一个量化台阶会被放大成 20%+ 的跳变，看起来一格一格蹦。
  // 只写 CSS 变量、不进 React state，节点组件不订阅 zoom，缩放期间零重渲染。
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const vars = semanticZoomVarsForZoom(zoomLevel)
    element.style.setProperty('--tm-glyph-comp', vars.glyphCompensation.toFixed(6))
    element.style.setProperty('--tm-detail-alpha', vars.detailAlpha.toFixed(4))
    element.style.setProperty('--tm-detail-hit', vars.detailHit)
  }, [zoomLevel])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateCanvasSize = () => {
      setCanvasSize({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    }

    updateCanvasSize()

    const observer = new ResizeObserver(() => {
      updateCanvasSize()
    })

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  // 房间图型是「视图意图」：存全局 _config.json 的 roomProfiles（roomPath → id），
  // 不进 _graph.json 索引、不碰节点/边字段 7 处白名单；旧房间无配置即为 auto。
  const storage = useStorage()
  const roomProfiles = useGraphUiStore((s) => s.roomProfiles)
  const setRoomProfiles = useGraphUiStore((s) => s.setRoomProfiles)
  const [profileSaveError, setProfileSaveError] = useState('')
  const currentRoom = roomPath || tabId
  const configuredProfileId = normalizeGraphProfileId(roomProfiles[currentRoom])
  const handleProfileChange = useCallback((next: GraphProfileId) => {
    const normalized = normalizeGraphProfileId(next)
    // read-modify-write：从最新 store 取，避免快速切换时覆盖别的房间。
    const map = { ...useGraphUiStore.getState().roomProfiles, [currentRoom]: normalized }
    setRoomProfiles(map)
    setProfileSaveError('')
    void storage.writeConfig({ roomProfiles: map }).catch((error) => {
      setProfileSaveError(error instanceof Error ? error.message : String(error))
    })
  }, [currentRoom, setRoomProfiles, storage])

  // 语义缩放：只派发 hidden 属性，节点/边数据本身不动（位置、选中、连线全部保住）。
  // 缩略图与搜索仍用全量 nodes/edges，避免 LOD 把「整图概览」和「找不到节点」也一起藏掉。
  const lod = useSemanticLod({
    nodes,
    edges,
    zoom: lodZoom,
    stage: lodTier,
    roomPath: currentRoom,
    configuredProfileId,
    selectedNodeId,
  })
  // 选中态以 nodes 派生为准（与 React Flow 的 .selected 同源），store 字段只作首选。
  const pinTarget = selectedNodeId ?? lod.visibility.selectedNodeIds[0] ?? null

  // 【画布只读 2026-11-11】判定唯一源是 domain 纯函数：显示比没到 100% 或还有隐藏节点
  // 就整张画布禁写。UI（props / 提示）与写操作闸门（useGraph 读 store）共用这一份状态，
  // 由 layout effect 在浏览器绘制前发布，避免「画面已缩小、闸门还没合上」的一帧空窗。
  const hiddenNodeCount = lod.visibility.hiddenNodeIds.size
  const readOnlyState = computeCanvasReadOnly(zoomLevel, hiddenNodeCount)
  const canvasReadOnly = readOnlyState.readOnly
  // 多选镜像菜单：选区 >=2 且画布可写才出现（缩小即只读，位置信息失真时禁止编辑）。
  const selectedNodeCount = useGraphStore((s) => s.selectedNodeCount)
  const showSelectionMirror = selectedNodeCount >= MIRROR_MIN_SELECTED_NODES && !canvasReadOnly
  // 【密度自适应 2026-11-11】渐隐区按节点数 / 树深度放慢每格滚轮，避免大图
  // 「轻轻一动消失一片」；紧凑区不限速（d3 等比缩放本身边际递减、且不再隐藏节点）。
  const compactZoom = isCompactZoom(zoomLevel)
  const wheelSensitivity = wheelSensitivityForZoom(
    zoomLevel,
    lod.visibility.totalNodeCount,
    lod.visibility.treeMaxDepth,
  )
  useLayoutEffect(() => {
    publishCanvasReadOnly(tabId, zoomLevel, hiddenNodeCount)
  }, [tabId, zoomLevel, hiddenNodeCount])
  useLayoutEffect(() => () => clearCanvasReadOnly(tabId), [tabId])

  // 节点/连线两个格式刷共用同一套"应用模式"视觉（光标 + 顶部提示条），但彼此互斥
  const isAnyFormatPainterActive = isFormatPainterActive || isEdgeFormatPainterActive

  // 滚轮阻尼 + 逐帧缓动：
  //  d3-zoom 一格 deltaY=220 会直接跳掉约 26% 缩放，节点必然成批进出。
  //  捕获阶段拦下原始事件，钳制单格 deltaY 后把「剩余增量」交给 rAF 逐帧派发小步；
  //  `2^(-deltaY*0.002)` 是可乘的，累计缩放量与原来一格完全相同，但 transform
  //  逐帧连续变化，镜头是「滑」过去的而不是一格一格跳。
  //  这里**不用** CSS transition: transform —— 那会让 React Flow 内部 viewport
  //  先跳到终值、画面慢慢追，缩放后立刻点节点就会点到错误的位置；逐帧派发让
  //  内部坐标与画面始终一致。d3 的「朝光标缩放」与触控板细粒度事件也原样保留。
  const wheelAnimRef = useRef<{
    remaining: number
    lastTime: number
    raf: number | null
    pane: Element | null
    clientX: number
    clientY: number
    deltaMode: number
  } | null>(null)

  const dispatchWheelStep = useCallback((deltaY: number) => {
    const anim = wheelAnimRef.current
    if (!anim || !anim.pane || Math.abs(deltaY) < 0.3) return
    const normalized = new WheelEvent('wheel', {
      deltaY,
      deltaMode: anim.deltaMode,
      clientX: anim.clientX,
      clientY: anim.clientY,
      bubbles: true,
      cancelable: true,
    })
    ;(normalized as WheelEvent & { __tmNormalizedWheel?: boolean }).__tmNormalizedWheel = true
    anim.pane.dispatchEvent(normalized)
  }, [])

  // 显式标注类型：回调内会递归调度自己，避免 TS 陷入自引用类型推断。
  const runWheelAnimation: (now: number) => void = useCallback((now: number) => {
    const anim = wheelAnimRef.current
    if (!anim) return
    // 首帧（或新一格滚轮追加后）按 16ms 计算，避免 dt=0 卡住动画。
    const dt = anim.lastTime === 0 ? 16 : now - anim.lastTime
    anim.lastTime = now
    const step = wheelDeltaStep(anim.remaining, dt)
    anim.remaining -= step
    dispatchWheelStep(step)
    if (Math.abs(anim.remaining) > 0.3) {
      anim.raf = window.requestAnimationFrame(runWheelAnimation)
    } else {
      anim.remaining = 0
      anim.raf = null
    }
  }, [dispatchWheelStep])

  useEffect(() => () => {
    const anim = wheelAnimRef.current
    if (anim?.raf != null) window.cancelAnimationFrame(anim.raf)
    wheelAnimRef.current = null
  }, [])

  const handleWheelCapture = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const native = event.nativeEvent as WheelEvent & { __tmNormalizedWheel?: boolean }
    if (native.__tmNormalizedWheel) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as Element | null
    if (!target) return
    const pane = target.closest('.react-flow__pane')
    if (!pane) return
    if (target.closest('.react-flow__panel, .react-flow__minimap, .nowheel')) return
    event.stopPropagation()
    // 只缩放「操作量」，不改 zoom→显示比换算与 LOD 阈值公式：小图逐值不变。
    const delta = clampWheelDelta(native.deltaY) * wheelSensitivity
    if (!delta) return
    let anim = wheelAnimRef.current
    if (!anim) {
      anim = { remaining: 0, lastTime: 0, raf: null, pane: null, clientX: 0, clientY: 0, deltaMode: 0 }
      wheelAnimRef.current = anim
    }
    // 连续滚轮只需追加剩余量；每帧消费一小步，天然形成指数缓出。
    anim.remaining = clampPendingWheelDelta(anim.remaining + delta)
    anim.pane = pane
    anim.clientX = native.clientX
    anim.clientY = native.clientY
    anim.deltaMode = native.deltaMode
    anim.lastTime = 0
    if (anim.raf === null) anim.raf = window.requestAnimationFrame(runWheelAnimation)
  }, [runWheelAnimation, wheelSensitivity])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      className={[
        canvasReadOnly ? 'tm-canvas-readonly' : '',
        isAnyFormatPainterActive && !canvasReadOnly ? 'format-painter-active' : '',
      ].filter(Boolean).join(' ') || undefined}
      data-tm-canvas-readonly={canvasReadOnly ? 'true' : 'false'}
      data-tm-canvas-readonly-reason={readOnlyState.reason}
      data-tm-canvas-readonly-hidden={hiddenNodeCount}
      data-tm-canvas-compact={compactZoom ? 'true' : 'false'}
      data-tm-canvas-wheel-sensitivity={wheelSensitivity.toFixed(3)}
      onMouseDown={actions.handleCanvasMouseDown}
      onWheelCapture={handleWheelCapture}
      onMouseEnter={actions.handleCanvasMouseEnter}
      onMouseMove={actions.handleCanvasMouseMove}
      onMouseLeave={actions.handleCanvasMouseLeave}
      data-shortcut-scope="canvas"
      tabIndex={-1}
    >
      {isAnyFormatPainterActive && !canvasReadOnly && (
        <>
          <style>{`
            .format-painter-active, .format-painter-active * {
              cursor: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScyNCcgaGVpZ2h0PScyNCcgdmlld0JveD0nMCAwIDI0IDI0JyBmaWxsPSdub25lJyBzdHJva2U9JyMwMDAwMDAnIHN0cm9rZS13aWR0aD0nMicgc3Ryb2tlLWxpbmVjYXA9J3JvdW5kJyBzdHJva2UtbGluZWpvaW49J3JvdW5kJz48cGF0aCBkPSdtMTMuNSA4LjUtNC00Jy8+PHBhdGggZD0nTTEwLjUgMTMuNSA2IDkuNWw0LTQgNC41IDQuNWMuOC44LjUgMi0uNSAzbC0xLjUgMS41Yy0xIDEtMi4yIDEuMi0zIC41Jy8+PHBhdGggZD0nbTQgMTQuNSAxLjUgMS41Jy8+PHBhdGggZD0nTTE4LjUgMTkgNiAxNC41bC00IDRhMi4xMiAyLjEyIDAgMCAwIDMgM2wzLjUtMi41eicvPjxwYXRoIGQ9J00yMSAyMXYtNGEyIDIgMCAwIDAtMi0yaC00Jy8+PHBhdGggZD0nTTE1IDE1di00YTIgMiAwIDAgMSAyLTJoNCcvPjwvc3ZnPg==") 4 14, crosshair !important;
            }
          `}</style>
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[100] bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] px-4 py-2.5 rounded-full shadow-[var(--shadow-popover)] flex items-center gap-2.5 pointer-events-none transition-all">
            <div className="bg-[var(--color-accent)] text-[var(--color-text-inverse)] p-1 rounded-full flex items-center justify-center">
              <PaintRoller className="w-3.5 h-3.5" />
            </div>
            <span className="text-[13px] font-medium tracking-wide">
              {isEdgeFormatPainterActive
                ? "格式刷已激活，点击连线应用样式。按 Esc 退出"
                : "格式刷已激活，点击节点应用样式。按 Esc 退出"}
            </span>
          </div>
        </>
      )}

      {/* 已框选出多个节点时改显示多选操作菜单，避免两个 top-center 浮层叠在一起。 */}
      {isShiftPressed && state.isMouseOverCanvas && !isFormatPainterActive && !state.isInputFocused
        && !canvasReadOnly && !showSelectionMirror && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[100] bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] px-4 py-2.5 rounded-full shadow-[var(--shadow-popover)] flex items-center gap-2.5 pointer-events-none transition-all">
          <div className="bg-[var(--color-primary)] text-[var(--color-text-inverse)] p-1 px-2 rounded flex items-center justify-center font-bold text-[12px]">
            Shift
          </div>
          <span className="text-[13px] font-medium tracking-wide">
            按住 Shift 并拖拽鼠标进行多选，多选后可批量移动节点
          </span>
        </div>
      )}

      {isSearchOpen && (
        <NodeSearchBox
          nodes={nodes as Node[]}
          onSelectNode={(node) => {
            // 命中被 LOD 隐藏的节点时临时显示它（跨档位自动清空）。
            lod.revealNode(node.id)
            handleSearchSelectNode(node)
          }}
          onClose={() => setIsSearchOpen(false)}
        />
      )}

      {/* 新建连线的必选关系浮层（portal 到 document.body，不受画布裁剪） */}
      <EdgeRelationPicker recommendedRelation={lod.recommendedRelation} />

      {/* 【只读】拖节点 / 拉连线在 React Flow 手势层就停掉，不让用户「拖了却不动」；
          选择仍保留（只读也要能点节点看右栏），写操作另由 useGraph 闸门硬拦。 */}
      <ReactFlow
        id={tabId}
        nodes={lod.visibleNodes as Node[]}
        edges={lod.visibleEdges as Edge[]}
        onlyRenderVisibleElements
        nodeTypes={nodeTypes as NodeTypes}
        edgeTypes={edgeTypes}

        onNodesChange={handleNodesChange}
        onEdgesChange={graph.onEdgesChange}

        onConnect={graph.onConnect}
        onConnectStart={graph.onConnectStart}
        onConnectEnd={graph.onConnectEnd}
        connectionRadius={12}
        connectionLineComponent={CardSnappedConnectionLine}

        onNodeClick={graph.onNodeClick as (event: React.MouseEvent, node: Node) => void}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}

        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        minZoom={MIN_RAW_ZOOM}
        maxZoom={MAX_RAW_ZOOM}
        defaultViewport={renderViewport}
        zoomOnDoubleClick={false}
        zoomOnScroll
        panOnDrag={[0]}

        proOptions={{ hideAttribution: true }}
        
        snapToGrid={false}
        snapGrid={[20, 20]}

        selectionOnDrag={false}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}

        nodesDraggable={!canvasReadOnly}
        nodesConnectable={!canvasReadOnly}
        nodesFocusable={!canvasReadOnly}
        elementsSelectable
        elevateNodesOnSelect
        style={{ 
          width: '100%', 
          height: '100%', 
          background: 'var(--color-canvas-bg)'
        }}
      >
        <SmartGuidesRenderer guideLines={guideLines} />
        <CanvasReadOnlyBanner state={readOnlyState} zoomLevel={zoomLevel} />
        {showSelectionMirror && (
          <SelectionMirrorMenu
            selectedCount={selectedNodeCount}
            onFlip={graph.flipSelectionHorizontally}
          />
        )}
        <LodControl
          visibility={lod.visibility}
          readOnlyState={readOnlyState}
          zoomLevel={zoomLevel}
          mode={lod.mode}
          effectiveMode={lod.effectiveMode}
          policySource={lod.policySource}
          profileId={lod.profileId}
          effectiveProfileId={lod.effectiveProfileId}
          profileSaveError={profileSaveError}
          pinnedCount={lod.pinnedCount}
          selectedNodeId={pinTarget}
          isSelectedPinned={!!pinTarget && lod.pinnedIds.includes(pinTarget)}
          onModeChange={setLodMode}
          onPreservedDepthChange={lod.setPreservedDepth}
          onProfileChange={handleProfileChange}
          onTogglePin={lod.togglePin}
          onClearPin={lod.clearPin}
        />
        <ViewportReturnButton tabId={tabId} />
        <CanvasMiniMap
          nodes={nodes as Node[]}
          edges={edges}
          zoomLevel={zoomLevel}
          canvasSize={canvasSize}
          interactionActive={isNodeInteractionActive}
        />
        {showGrid && (
          <Background id={tabId} variant={'dots' as BackgroundVariant} gap={20} size={1} color="var(--color-canvas-grid)" />
        )}
      </ReactFlow>
    </div>
  )
})
