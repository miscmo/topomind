import React from 'react'
import { getSmoothStepPath, getStraightPath, type ConnectionLineComponentProps, type Node } from '@xyflow/react'
import { useTabStore } from '../../../../stores/tabs/tabStore'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { useGraphStore } from '../../../../stores/graphStore'
import { CONNECTION_ARROW_MARKER_ID } from '../constants'
import { getNodeRect, getRectCenter, getRectIntersectionPoint } from '../utils/math'

export function CardSnappedConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  connectionLineStyle,
}: ConnectionLineComponentProps) {
  const activeTabId = useTabStore((s: any) => s.activeTabId)
  const markerId = `${CONNECTION_ARROW_MARKER_ID}-${activeTabId}`
  const connectingSourceId = useGraphUiStore((s: any) => s.connectingSourceId)
  const connectingTargetId = useGraphUiStore((s: any) => s.connectingTargetId)
  const defaultEdgeStyle = useGraphUiStore((s: any) => s.defaultEdgeStyle)
  
  // Use a different color (accent color) for the connection line while drawing
  const connectionColor = 'var(--color-accent)'
  const strokeWidth = 1.2
  
  const sourceNode = useGraphStore((s: any) => connectingSourceId ? s.nodesMap.get(connectingSourceId) : null)
  const targetNode = useGraphStore((s: any) => connectingTargetId ? s.nodesMap.get(connectingTargetId) : null)
  const sourceRect = sourceNode ? getNodeRect(sourceNode as Node) : null
  const targetRect = targetNode ? getNodeRect(targetNode as Node) : null
  const targetPoint = targetRect
    ? getRectIntersectionPoint({ x: fromX, y: fromY }, { x: toX, y: toY }, targetRect)
    : { x: toX, y: toY }
  const sourcePoint = sourceRect
    ? getRectIntersectionPoint(targetPoint, getRectCenter(sourceRect), sourceRect)
    : { x: fromX, y: fromY }
  
  // Use smoothstep or straight path based on defaultEdgeStyle
  const isStraight = defaultEdgeStyle.lineMode === 'straight'
  const [edgePath] = isStraight
    ? getStraightPath({
        sourceX: sourcePoint.x,
        sourceY: sourcePoint.y,
        targetX: targetPoint.x,
        targetY: targetPoint.y,
      })
    : getSmoothStepPath({
        sourceX: sourcePoint.x,
        sourceY: sourcePoint.y,
        sourcePosition: (targetPoint.x > sourcePoint.x ? 'right' : 'left') as any,
        targetPosition: (targetPoint.x > sourcePoint.x ? 'left' : 'right') as any,
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
