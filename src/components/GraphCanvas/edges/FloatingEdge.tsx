import { memo } from 'react'
import {
  BaseEdge,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react'
import { getEdgeParams } from './floatingUtils'

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

  const isStraight = data?.lineMode === 'straight' || data?.type === 'straight'
  const arrowEnabled = data?.arrow !== false
  const markerId = `topomind-hollow-arrow-${id}`
  const markerColor = typeof style?.stroke === 'string' ? style.stroke : '#7f8c8d'
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

  return (
    <>
      {arrowEnabled && (
        <defs>
          <marker id={markerId} viewBox="0 0 20 20" markerWidth="12" markerHeight="12" refX="12" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path
              d="M 0 0 L 12 6 L 0 12"
              fill="none"
              stroke={markerColor}
              strokeWidth="1.2"
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
        markerEnd={arrowEnabled ? `url(#${markerId})` : undefined}
        style={style}
      />
    </>
  )
}

export default memo(FloatingEdge)
