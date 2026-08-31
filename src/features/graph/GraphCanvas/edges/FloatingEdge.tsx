import { memo } from 'react'
import {
  BaseEdge,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react'
import { STYLE_CONFIG_DEFAULTS } from '../../../../domain/style/styleDefaults'
import { EDGE_ARROW_SIZE_LIMIT, clampNumber } from '../../../../domain/style/styleConstraints'
import type { KnowledgeEdge } from '../../../../types'
import { getEdgeParams } from './floatingUtils'

/**
 * 箭头几何：在 12x12 的 viewBox 内画一个朝右的箭头，尖端位于 x=12、垂直居中于 y=6。
 * 配合 markerUnits="userSpaceOnUse" 与 markerWidth=arrowSize，
 * viewBox 单位与像素 1:1，因此 arrowSize 就是箭头的像素长度。
 */
const ARROW_VIEWBOX = 12
const ARROW_PATH = 'M 0 0 L 12 6 L 0 12'
const ARROW_STROKE_WIDTH = 1.2

function FloatingEdge({
  id,
  source,
  target,
  style,
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  if (!sourceNode || !targetNode) {
    return null
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode
  )

  // EdgeProps 的 data 是宽松类型，这里按 KnowledgeEdge 的数据契约取值
  const edgeData = data as KnowledgeEdge['data'] | undefined
  const isStraight = edgeData?.lineMode === 'straight' || data?.type === 'straight'
  const arrowEnabled = edgeData?.arrow !== false
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

  const [edgePath] = isStraight
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
    </>
  )
}

export default memo(FloatingEdge)
