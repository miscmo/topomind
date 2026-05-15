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
  markerEnd,
  style,
  data,
  selected,
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
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={style}
    />
  )
}

export default memo(FloatingEdge)
