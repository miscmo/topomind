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
import { useGraphContext } from '../../../../contexts/GraphContext'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { getEdgeParams, getInternalNodeRect } from './floatingUtils'
import QuickEdgeToolbar from './QuickEdgeToolbar'
import EdgeAnchorHandles, { type EdgeAnchorPreview } from './EdgeAnchorHandles'

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
  const { updateEdgeStyle, updateEdgeAnchor } = useGraphContext()
  // 拖动锚点时只在这里做路径预览，松手才写 store：一次拖动 = 一条撤销记录、一次落盘
  const [anchorPreview, setAnchorPreview] = useState<EdgeAnchorPreview | null>(null)

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

  if (!sourceNode || !targetNode) {
    return null
  }

  const sourceRect = getInternalNodeRect(sourceNode)
  const targetRect = getInternalNodeRect(targetNode)
  const sourceAnchor = anchorPreview?.side === 'source' ? anchorPreview.anchor : edgeData?.sourceAnchor
  const targetAnchor = anchorPreview?.side === 'target' ? anchorPreview.anchor : edgeData?.targetAnchor

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
    { sourceAnchor, targetAnchor }
  )

  const isStraight = edgeData?.lineMode === 'straight' || data?.type === 'straight'
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

  const [edgePath, labelX, labelY] = isStraight
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
          {showAnchorHandles && (
            <EdgeAnchorHandles
              sourceRect={sourceRect}
              targetRect={targetRect}
              sourcePoint={{ x: sx, y: sy }}
              targetPoint={{ x: tx, y: ty }}
              sourceAnchor={sourceAnchor}
              targetAnchor={targetAnchor}
              onPreview={setAnchorPreview}
              onCommit={handleAnchorCommit}
            />
          )}
          {showToolbar && (
            <div
              className="nodrag nopan"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY}px) translateY(-10px)`,
                pointerEvents: 'all',
                // 与锚点手柄同层：连线两端贴近节点时，工具栏不能被节点盖住而点不到
                zIndex: 10,
              }}
            >
              <QuickEdgeToolbar
                color={edgeData?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color}
                isFormatPainterActive={isEdgeFormatPainterActive}
                hasCustomAnchors={hasCustomAnchors}
                onColorChange={handleColorChange}
                onToggleFormatPainter={toggleFormatPainter}
                onResetAnchors={handleAnchorReset}
              />
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default memo(FloatingEdge)
