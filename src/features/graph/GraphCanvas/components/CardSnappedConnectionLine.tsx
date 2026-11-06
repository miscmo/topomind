
import { getSmoothStepPath, getStraightPath, Position, type ConnectionLineComponentProps, type Node } from '@xyflow/react'
import { useTabStore } from '../../../../stores/tabs/tabStore'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { useGraphStore } from '../../../../stores/graphStore'
import { CONNECTION_ARROW_MARKER_ID } from '../constants'
import { getNodeRect, getRectCenter, getRectIntersectionPoint } from '../utils/math'
import { DEFAULT_CURVE_CONTROL, normalizeCurveControl } from '../../../../domain/graph/edgeCurve'
import { getCurvedEdgePath } from '../edges/floatingUtils'

export function CardSnappedConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  connectionLineStyle,
}: ConnectionLineComponentProps) {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const markerId = `${CONNECTION_ARROW_MARKER_ID}-${activeTabId}`
  const connectingSourceId = useGraphUiStore((s) => s.connectingSourceId)
  const connectingTargetId = useGraphUiStore((s) => s.connectingTargetId)
  const defaultEdgeStyle = useGraphUiStore((s) => s.defaultEdgeStyle)
  
  // Use a different color (accent color) for the connection line while drawing
  const connectionColor = 'var(--color-accent)'
  const strokeWidth = 1.2
  
  const sourceNode = useGraphStore((s) => connectingSourceId ? s.nodesMap.get(connectingSourceId) : null)
  const targetNode = useGraphStore((s) => connectingTargetId ? s.nodesMap.get(connectingTargetId) : null)
  const sourceRect = sourceNode ? getNodeRect(sourceNode as Node) : null
  const targetRect = targetNode ? getNodeRect(targetNode as Node) : null
  const targetPoint = targetRect
    ? getRectIntersectionPoint({ x: fromX, y: fromY }, { x: toX, y: toY }, targetRect)
    : { x: toX, y: toY }
  const sourcePoint = sourceRect
    ? getRectIntersectionPoint(targetPoint, getRectCenter(sourceRect), sourceRect)
    : { x: fromX, y: fromY }
  
  // Use smoothstep / straight / curve path based on defaultEdgeStyle
  const isStraight = defaultEdgeStyle.lineMode === 'straight'
  const isCurve = defaultEdgeStyle.lineMode === 'curve'
  const curveControl = normalizeCurveControl(defaultEdgeStyle.curveControl) ?? DEFAULT_CURVE_CONTROL
  const [edgePath] = isStraight
    ? getStraightPath({
        sourceX: sourcePoint.x,
        sourceY: sourcePoint.y,
        targetX: targetPoint.x,
        targetY: targetPoint.y,
      })
    : isCurve
      ? getCurvedEdgePath(sourcePoint.x, sourcePoint.y, targetPoint.x, targetPoint.y, curveControl)
      : getSmoothStepPath({
        sourceX: sourcePoint.x,
        sourceY: sourcePoint.y,
        sourcePosition: targetPoint.x > sourcePoint.x ? Position.Right : Position.Left,
        targetPosition: targetPoint.x > sourcePoint.x ? Position.Left : Position.Right,
        targetX: targetPoint.x,
        targetY: targetPoint.y,
        borderRadius: 16,
      })

  return (
    <>
      <defs>
        <marker id={markerId} viewBox="0 0 20 20" markerWidth="12" markerHeight="12" refX="12" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M 0 0 L 12 6 L 0 12" fill="none" stroke={connectionColor} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
        </marker>
      </defs>
      <path 
        fill="none" 
        d={edgePath} 
        style={connectionLineStyle} 
        strokeWidth={strokeWidth} 
        stroke={connectionColor} 
        strokeDasharray="6 4"
        markerEnd={defaultEdgeStyle.arrow !== false ? `url(#${markerId})` : undefined} 
      />
    </>
  )
}
