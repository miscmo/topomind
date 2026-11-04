import { memo, useCallback, useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  useStore,
  type EdgeProps,
} from '@xyflow/react'
import { STYLE_CONFIG_DEFAULTS } from '../../../../domain/style/styleDefaults'
import { EDGE_ARROW_SIZE_LIMIT, clampNumber } from '../../../../domain/style/styleConstraints'
import type { EdgeStylePatch, KnowledgeEdge } from '../../../../types'
import { normalizeEdgeAnchor, type EdgeAnchorPatch } from '../../../../domain/graph/edgeAnchors'
import {
  DEFAULT_CURVE_CONTROL,
  hasCustomCurve,
  normalizeCurveControl,
  type CurveControl,
} from '../../../../domain/graph/edgeCurve'
import { useGraphContext } from '../../../../contexts/GraphContext'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { useConfirmStore } from '../../../../shared/ui/ConfirmModal/confirmStore'
import { getEdgeParams, getInternalNodeRect, getCurvedEdgePath } from './floatingUtils'
import QuickEdgeToolbar from './QuickEdgeToolbar'
import EdgeAnchorHandles, { type EdgeAnchorPreview } from './EdgeAnchorHandles'
import EdgeBendHandle from './EdgeBendHandle'
import EdgeToolbarAnchor from './EdgeToolbarAnchor'

/**
 * 箭头几何：在 12x12 的 viewBox 内画一个朝右的箭头，尖端位于 x=12、垂直居中于 y=6。
 * 配合 markerUnits="userSpaceOnUse" 与 markerWidth=arrowSize，
 * viewBox 单位与像素 1:1，因此 arrowSize 就是箭头的像素长度。
 */
const ARROW_VIEWBOX = 12
const ARROW_PATH = 'M 0 0 L 12 6 L 0 12'
const ARROW_STROKE_WIDTH = 1.2
/** 低于此缩放就不渲染箭头：此时箭头不足 1 像素，纯属白付 DOM 与光栅成本 */
const ARROW_MIN_ZOOM = 0.35

/** 从连线数据里取出完整样式快照（缺字段回落到默认样式），供格式刷复制 */
function readEdgeStyleSnapshot(edgeData: KnowledgeEdge['data'] | undefined): EdgeStylePatch {
  const defaults = STYLE_CONFIG_DEFAULTS.defaultEdgeStyle
  return {
    lineMode: edgeData?.lineMode ?? defaults.lineMode,
    lineStyle: edgeData?.lineStyle ?? defaults.lineStyle,
    // 格式刷必须带走曲线形态，否则复制到目标连线时弯曲位置/幅度会丢失
    curveControl: normalizeCurveControl(edgeData?.curveControl),
    color: edgeData?.color ?? defaults.color,
    lineWidth: edgeData?.lineWidth ?? defaults.lineWidth,
    arrow: edgeData?.arrow ?? defaults.arrow,
    arrowSize: edgeData?.arrowSize ?? defaults.arrowSize,
    arrowShape: edgeData?.arrowShape ?? defaults.arrowShape,
    arrowPosition: edgeData?.arrowPosition ?? defaults.arrowPosition,
  }
}

function FloatingEdge({
  id,
  source,
  target,
  style,
  data,
}: EdgeProps) {
  // EdgeProps 的 data 是宽松类型，这里按 KnowledgeEdge 的数据契约取值
  const edgeData = data as KnowledgeEdge['data'] | undefined
  // 选中态以 data.selected 为唯一来源（setSelectedEdgeInGraph 维护）
  const isSelected = edgeData?.selected === true
  const connectingSourceId = useGraphUiStore((s) => s.connectingSourceId)
  const isNodeFormatPainterActive = useGraphUiStore((s) => s.formatPainterStyle !== null)
  const isEdgeFormatPainterActive = useGraphUiStore((s) => s.edgeFormatPainterStyle !== null)
  const { updateEdgeStyle, updateEdgeAnchor, deleteEdge } = useGraphContext()
  const confirm = useConfirmStore((s) => s.open)
  // 拖动锚点 / 弯曲控制柄时只在这里做路径预览，松手才写 store：一次拖动 = 一条撤销记录、一次落盘
  const [anchorPreview, setAnchorPreview] = useState<EdgeAnchorPreview | null>(null)
  const [curvePreview, setCurvePreview] = useState<CurveControl | null>(null)

  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  const handleAnchorCommit = useCallback((patch: EdgeAnchorPatch) => {
    void updateEdgeAnchor(id, patch)
  }, [updateEdgeAnchor, id])

  const handleAnchorReset = useCallback(() => {
    void updateEdgeAnchor(id, { sourceAnchor: null, targetAnchor: null })
  }, [updateEdgeAnchor, id])

  const handleColorChange = useCallback((value: string) => {
    void updateEdgeStyle(id, { color: value })
  }, [updateEdgeStyle, id])

  // 删除是不可逆的破坏性操作，且按钮就在工具栏最右、hover 变红，误触成本高：
  // 走全局统一模态确认框（App.tsx 已挂载），取消则什么都不做。
  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: '删除连线',
      message: '确定删除这条连线吗？删除后可用 Ctrl+Z 撤销。',
      confirmText: '删除连线',
    })
    if (!confirmed) return
    await deleteEdge(id)
  }, [confirm, deleteEdge, id])

  const handleCurveCommit = useCallback((control: CurveControl) => {
    void updateEdgeStyle(id, { curveControl: control })
  }, [updateEdgeStyle, id])

  const handleCurveReset = useCallback(() => {
    void updateEdgeStyle(id, { curveControl: null })
  }, [updateEdgeStyle, id])

  const toggleFormatPainter = useCallback(() => {
    const uiStore = useGraphUiStore.getState()
    if (uiStore.edgeFormatPainterStyle !== null) {
      uiStore.setEdgeFormatPainterStyle(null)
      return
    }
    // 与节点格式刷互斥：启用连线格式刷时先关掉节点格式刷
    uiStore.setFormatPainterStyle(null)
    uiStore.setEdgeFormatPainterStyle(readEdgeStyleSnapshot(edgeData))
  }, [edgeData])

  // 节点格式刷激活时进入"应用到节点"模式，隐藏连线工具栏避免误点；
  // 连线格式刷激活时保留本条连线的工具栏，方便再点一次取消。
  const showToolbar =
    isSelected
    && connectingSourceId === null
    && !isNodeFormatPainterActive
  // 格式刷/连线中隐藏手柄，避免挡住「点击连线应用样式」
  const showAnchorHandles =
    isSelected
    && connectingSourceId === null
    && !isNodeFormatPainterActive
    && !isEdgeFormatPainterActive
  const hasCustomAnchors =
    normalizeEdgeAnchor(edgeData?.sourceAnchor) != null
    || normalizeEdgeAnchor(edgeData?.targetAnchor) != null
  const hasCurveCustomized = hasCustomCurve(normalizeCurveControl(edgeData?.curveControl))
  const isCurve = edgeData?.lineMode === 'curve' || data?.type === 'curve'
  // 曲线模式且选中时，在「曲线上的控制点」处显示可二维拖动的手柄
  const showBendHandle =
    isSelected
    && isCurve
    && connectingSourceId === null
    && !isNodeFormatPainterActive
    && !isEdgeFormatPainterActive

  if (!sourceNode || !targetNode) {
    return null
  }

  const sourceRect = getInternalNodeRect(sourceNode)
  const targetRect = getInternalNodeRect(targetNode)
  const sourceAnchor = anchorPreview?.side === 'source' ? anchorPreview.anchor : edgeData?.sourceAnchor
  const targetAnchor = anchorPreview?.side === 'target' ? anchorPreview.anchor : edgeData?.targetAnchor

  const {
    sx, sy, tx, ty, sourcePos, targetPos, sourceBorder, targetBorder,
  } = getEdgeParams(
    sourceNode,
    targetNode,
    { sourceAnchor, targetAnchor }
  )

  const isStraight = edgeData?.lineMode === 'straight' || data?.type === 'straight'
  // 拖动弯曲控制柄时只做路径预览，松手才写库；预览优先于已保存值
  const liveControl = curvePreview ?? normalizeCurveControl(edgeData?.curveControl) ?? DEFAULT_CURVE_CONTROL
  // 箭头在极低缩放下只有亚像素大小，却要为每条边额外渲染 <defs>+<marker>+<path>
  // （可见边的 SVG DOM 直接三倍）。低于阈值就不画箭头，只留线条本身。
  // 订阅的是布尔而非 zoom 浮点值，只在跨阈值时重渲染一次。
  const showArrows = useStore((s) => s.transform[2] >= ARROW_MIN_ZOOM)
  const arrowEnabled = edgeData?.arrow !== false && showArrows
  const arrowSize = clampNumber(
    edgeData?.arrowSize ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowSize,
    EDGE_ARROW_SIZE_LIMIT.min,
    EDGE_ARROW_SIZE_LIMIT.max
  )
  const arrowShape = edgeData?.arrowShape ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowShape
  const arrowPosition = edgeData?.arrowPosition ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.arrowPosition
  const showStart = arrowEnabled && (arrowPosition === 'start' || arrowPosition === 'both')
  const showEnd = arrowEnabled && (arrowPosition === 'end' || arrowPosition === 'both')

  const markerId = `topomind-arrow-${id}`
  const markerColor = typeof style?.stroke === 'string' ? style.stroke : STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color
  const markerOpacity = style?.opacity

  // 曲线模式下 label 点即「曲线上的控制点」（与 EdgeBendHandle 抓取点严格一致），
  // 既作为工具栏默认挂靠点，也并入工具栏避让锚点，避免工具条盖住弯曲手柄。
  const [edgePath, labelX, labelY] = isCurve
    ? getCurvedEdgePath(sx, sy, tx, ty, liveControl)
    : isStraight
      ? getStraightPath({
          sourceX: sx,
          sourceY: sy,
          targetX: tx,
          targetY: ty,
        })
      : getSmoothStepPath({
          sourceX: sx,
          sourceY: sy,
          sourcePosition: sourcePos,
          targetPosition: targetPos,
          targetX: tx,
          targetY: ty,
          borderRadius: 16,
        })
  const curveMid: { x: number; y: number } | null = isCurve ? { x: labelX, y: labelY } : null

  const isSolid = arrowShape === 'solid'

  return (
    <>
      {arrowEnabled && (
        <defs>
          {/*
            orient="auto-start-reverse"：同一个箭头定义用于 marker-start 时会自动翻转 180°，
            因此起点箭头朝外，无需再定义一份反向的 marker。
          */}
          <marker
            id={markerId}
            viewBox={`0 0 ${ARROW_VIEWBOX} ${ARROW_VIEWBOX}`}
            markerWidth={arrowSize}
            markerHeight={arrowSize}
            refX={ARROW_VIEWBOX}
            refY={ARROW_VIEWBOX / 2}
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path
              d={isSolid ? `${ARROW_PATH} Z` : ARROW_PATH}
              fill={isSolid ? markerColor : 'none'}
              stroke={markerColor}
              strokeWidth={ARROW_STROKE_WIDTH}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={markerOpacity}
            />
          </marker>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={showStart ? `url(#${markerId})` : undefined}
        markerEnd={showEnd ? `url(#${markerId})` : undefined}
        style={style}
      />
      {(showToolbar || showAnchorHandles) && (
        <EdgeLabelRenderer>
          {/* 手柄贴在边框交点上，线头在其外侧 6px；工具栏按手柄位置避让 */}
          {showAnchorHandles && (
            <EdgeAnchorHandles
              sourceRect={sourceRect}
              targetRect={targetRect}
              sourcePoint={sourceBorder}
              targetPoint={targetBorder}
              sourceAnchor={sourceAnchor}
              targetAnchor={targetAnchor}
              onPreview={setAnchorPreview}
              onCommit={handleAnchorCommit}
            />
          )}
          {showBendHandle && (
            <EdgeBendHandle
              sx={sx}
              sy={sy}
              tx={tx}
              ty={ty}
              control={liveControl}
              onPreview={setCurvePreview}
              onCommit={handleCurveCommit}
              onReset={handleCurveReset}
            />
          )}
          {showToolbar && (
            <EdgeToolbarAnchor
              labelX={labelX}
              labelY={labelY}
              anchors={showBendHandle && curveMid ? [sourceBorder, targetBorder, curveMid] : [sourceBorder, targetBorder]}
              faded={anchorPreview !== null || curvePreview !== null}
            >
              <QuickEdgeToolbar
                color={edgeData?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color}
                isFormatPainterActive={isEdgeFormatPainterActive}
                hasCustomAnchors={hasCustomAnchors}
                hasCustomCurve={isCurve && hasCurveCustomized}
                onColorChange={handleColorChange}
                onToggleFormatPainter={toggleFormatPainter}
                onResetAnchors={handleAnchorReset}
                onResetCurve={handleCurveReset}
                onDelete={handleDelete}
              />
            </EdgeToolbarAnchor>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default memo(FloatingEdge)
