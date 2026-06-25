import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel, Position, getSmoothStepPath, getStraightPath, useReactFlow, useViewport, type Edge, type Node } from '@xyflow/react'
import { Eye, EyeOff, Minus, Plus } from 'lucide-react'
import { logAction } from '../../../../core/log-backend'
import { useGraphUiStore } from '../../../../stores/graphUiStore'
import { STYLE_CONFIG_DEFAULTS } from '../../../../domain/style/styleDefaults'
import type { KnowledgeEdge, KnowledgeNode } from '../../../../types'
import Toolbar from '../../../layout/Toolbar/Toolbar'
import { getNodeRect } from '../utils/math'

const MINI_MAP_MIN_WIDTH = 180
const MINI_MAP_MAX_WIDTH = 340
const MINI_MAP_WIDTH_STEP = 32
const MINI_MAP_ASPECT_RATIO = 220 / 140
const MINI_MAP_AUTO_SHOW_RATIO = 1.6
const MINI_MAP_PADDING = 80
const MINI_MAP_INTERACTION_DRAG_THRESHOLD = 3
const MINI_MAP_COMPACT_DETAIL_NODE_THRESHOLD = 140
const MINI_MAP_COMPACT_DETAIL_EDGE_THRESHOLD = 220
const MINI_MAP_SKELETON_DETAIL_NODE_THRESHOLD = 260
const MINI_MAP_SKELETON_DETAIL_EDGE_THRESHOLD = 420

interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

interface PreviewNode {
  id: string
  label: string
  truncatedLabel: string
  hasDetail: boolean
  childCount: number
  x: number
  y: number
  width: number
  height: number
  fill: string
  textColor: string
  borderColor: string
  borderWidth: number
  borderRadius: number
  fontSize: number
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  badgeSize: number
}

interface PreviewEdge {
  id: string
  path: string
  stroke: string
  strokeWidth: number
  strokeDasharray?: string
  opacity: number
  markerId?: string
}

interface MarkerDefinition {
  id: string
  stroke: string
  strokeWidth: number
  opacity: number
}

interface PreviewModel {
  previewEdges: PreviewEdge[]
  previewNodes: PreviewNode[]
  markerDefinitions: MarkerDefinition[]
}

type MiniMapDetailLevel = 'full' | 'compact' | 'skeleton'

function getRectBoundaryPoint(rect: RectLike, target: { x: number; y: number }) {
  const halfWidth = Math.max(rect.width / 2, 1)
  const halfHeight = Math.max(rect.height / 2, 1)
  const centerX = rect.x + halfWidth
  const centerY = rect.y + halfHeight

  if (target.x === centerX && target.y === centerY) {
    return { x: centerX, y: centerY }
  }

  const normalizedX = (target.x - centerX) / (2 * halfWidth) - (target.y - centerY) / (2 * halfHeight)
  const normalizedY = (target.x - centerX) / (2 * halfWidth) + (target.y - centerY) / (2 * halfHeight)
  const scale = 1 / (Math.abs(normalizedX) + Math.abs(normalizedY))
  const edgeX = scale * normalizedX
  const edgeY = scale * normalizedY

  return {
    x: halfWidth * (edgeX + edgeY) + centerX,
    y: halfHeight * (-edgeX + edgeY) + centerY,
  }
}

function getAnchorPosition(rect: RectLike, point: { x: number; y: number }) {
  const left = Math.round(rect.x)
  const top = Math.round(rect.y)
  const right = Math.round(rect.x + rect.width)
  const bottom = Math.round(rect.y + rect.height)
  const x = Math.round(point.x)
  const y = Math.round(point.y)

  if (x <= left + 1) return Position.Left
  if (x >= right - 1) return Position.Right
  if (y <= top + 1) return Position.Top
  if (y >= bottom - 1) return Position.Bottom

  return Position.Top
}

function sanitizeSvgId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function getTextPreviewLabel(label: string, width: number, fontSize: number) {
  const safeLabel = label.trim()
  if (!safeLabel) return ''

  const estimatedCharWidth = Math.max(fontSize * 0.62, 4)
  const maxChars = Math.max(2, Math.floor((width - 16) / estimatedCharWidth))
  if (safeLabel.length <= maxChars) return safeLabel
  if (maxChars <= 2) return safeLabel.slice(0, 1)
  return `${safeLabel.slice(0, maxChars - 1)}…`
}

function buildPreviewModel(nodes: Node[], edges: Edge[], nodeById: Map<string, Node>): PreviewModel {
  const markerDefinitionsMap = new Map<string, MarkerDefinition>()

  const previewEdges = edges.flatMap((edge) => {
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    if (!sourceNode || !targetNode) return []

    const sourceRect = getNodeRect(sourceNode)
    const targetRect = getNodeRect(targetNode)
    const sourceCenter = {
      x: sourceRect.x + sourceRect.width / 2,
      y: sourceRect.y + sourceRect.height / 2,
    }
    const targetCenter = {
      x: targetRect.x + targetRect.width / 2,
      y: targetRect.y + targetRect.height / 2,
    }

    const sourcePoint = getRectBoundaryPoint(sourceRect, targetCenter)
    const targetPoint = getRectBoundaryPoint(targetRect, sourceCenter)
    const sourcePosition = getAnchorPosition(sourceRect, sourcePoint)
    const targetPosition = getAnchorPosition(targetRect, targetPoint)
    const edgeData = (edge.data ?? {}) as KnowledgeEdge['data']
    const isStraight = edgeData?.lineMode === 'straight' || edge.type === 'straight'
    const [path] = isStraight
      ? getStraightPath({
          sourceX: sourcePoint.x,
          sourceY: sourcePoint.y,
          targetX: targetPoint.x,
          targetY: targetPoint.y,
        })
      : getSmoothStepPath({
          sourceX: sourcePoint.x,
          sourceY: sourcePoint.y,
          sourcePosition,
          targetPosition,
          targetX: targetPoint.x,
          targetY: targetPoint.y,
          borderRadius: 16,
        })

    const stroke = typeof edge.style?.stroke === 'string'
      ? edge.style.stroke
      : edgeData?.color ?? STYLE_CONFIG_DEFAULTS.defaultEdgeStyle.color

    const strokeWidth = typeof edge.style?.strokeWidth === 'number'
      ? edge.style.strokeWidth
      : Number(edge.style?.strokeWidth ?? (edgeData?.weight === 'main' ? 1.5 : 1.2))

    const opacity = typeof edge.style?.opacity === 'number' ? edge.style.opacity : 1
    const arrowEnabled = edgeData?.arrow !== false
    let markerId: string | undefined

    if (arrowEnabled) {
      const markerKey = `${stroke}-${strokeWidth}-${opacity}`
      markerId = `mini-map-arrow-${sanitizeSvgId(markerKey)}`
      if (!markerDefinitionsMap.has(markerKey)) {
        markerDefinitionsMap.set(markerKey, {
          id: markerId,
          stroke,
          strokeWidth,
          opacity,
        })
      }
    }

    return [{
      id: edge.id,
      path,
      stroke,
      strokeWidth,
      strokeDasharray: typeof edge.style?.strokeDasharray === 'string' ? edge.style.strokeDasharray : undefined,
      opacity,
      markerId,
    }]
  })

  const previewNodes = nodes.map((node) => {
    const typedNode = node as KnowledgeNode
    const rect = getNodeRect(node)
    const nodeStyle = typedNode.data?.nodeStyle ?? STYLE_CONFIG_DEFAULTS.defaultNodeStyle
    const headerBackgroundColor = nodeStyle.headerBackgroundColor ?? STYLE_CONFIG_DEFAULTS.defaultNodeStyle.headerBackgroundColor
    const headerColor = nodeStyle.headerColor ?? STYLE_CONFIG_DEFAULTS.defaultNodeStyle.headerColor
    const borderColor = typedNode.selected
      ? 'var(--color-accent)'
      : typedNode.data?.domainColor ?? nodeStyle.borderColor ?? STYLE_CONFIG_DEFAULTS.defaultNodeStyle.borderColor
    const borderWidth = typedNode.selected
      ? Math.max(1.5, (nodeStyle.borderWidth ?? STYLE_CONFIG_DEFAULTS.defaultNodeStyle.borderWidth) + 0.5)
      : nodeStyle.borderWidth ?? STYLE_CONFIG_DEFAULTS.defaultNodeStyle.borderWidth
    const borderRadius = nodeStyle.borderRadius ?? STYLE_CONFIG_DEFAULTS.defaultNodeStyle.borderRadius
    const fontSize = nodeStyle.headerFontSize ?? STYLE_CONFIG_DEFAULTS.defaultNodeStyle.headerFontSize
    const childCount = typeof typedNode.data?.childCount === 'number' ? typedNode.data.childCount : 0
    const badgeSize = Math.min(Math.max(rect.width * 0.16, 10), 18)
    const label = String(typedNode.data?.label ?? '')

    return {
      id: node.id,
      label,
      truncatedLabel: getTextPreviewLabel(label, rect.width, fontSize),
      hasDetail: typedNode.data?.hasDetail === true,
      childCount,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      fill: headerBackgroundColor,
      textColor: headerColor,
      borderColor,
      borderWidth,
      borderRadius,
      fontSize,
      fontWeight: nodeStyle.headerFontWeight ?? STYLE_CONFIG_DEFAULTS.defaultNodeStyle.headerFontWeight,
      fontStyle: nodeStyle.headerFontStyle ?? STYLE_CONFIG_DEFAULTS.defaultNodeStyle.headerFontStyle,
      badgeSize,
    }
  })

  return {
    previewEdges,
    previewNodes,
    markerDefinitions: Array.from(markerDefinitionsMap.values()),
  }
}

const MiniMapStaticSvg = memo(function MiniMapStaticSvg({
  previewBounds,
  previewEdges,
  previewNodes,
  markerDefinitions,
  edgeMarkerSize,
  detailLevel,
  onNodeClick,
}: {
  previewBounds: RectLike
  previewEdges: PreviewEdge[]
  previewNodes: PreviewNode[]
  markerDefinitions: MarkerDefinition[]
  edgeMarkerSize: number
  detailLevel: MiniMapDetailLevel
  onNodeClick: (nodeId: string, event: React.MouseEvent<SVGGElement>) => void
}) {
  const showLabels = detailLevel !== 'skeleton'
  const showDecorations = detailLevel === 'full'

  return (
    <>
      <defs>
        {markerDefinitions.map((marker) => (
          <marker
            key={marker.id}
            id={marker.id}
            viewBox={`0 0 ${edgeMarkerSize} ${edgeMarkerSize}`}
            markerWidth={edgeMarkerSize}
            markerHeight={edgeMarkerSize}
            refX={edgeMarkerSize - 1}
            refY={edgeMarkerSize / 2}
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path
              d={`M 0 0 L ${edgeMarkerSize - 2} ${edgeMarkerSize / 2} L 0 ${edgeMarkerSize}`}
              fill="none"
              stroke={marker.stroke}
              strokeWidth={Math.max(1, marker.strokeWidth)}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={marker.opacity}
            />
          </marker>
        ))}
      </defs>

      <rect
        x={previewBounds.x}
        y={previewBounds.y}
        width={previewBounds.width}
        height={previewBounds.height}
        fill="var(--color-canvas-bg)"
      />

      {previewEdges.map((edge) => (
        <path
          key={edge.id}
          d={edge.path}
          fill="none"
          stroke={edge.stroke}
          strokeWidth={edge.strokeWidth}
          strokeDasharray={edge.strokeDasharray}
          opacity={edge.opacity}
          markerEnd={edge.markerId ? `url(#${edge.markerId})` : undefined}
        />
      ))}

      {previewNodes.map((node) => (
        <g
          key={node.id}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => onNodeClick(node.id, event)}
        >
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            rx={node.borderRadius}
            ry={node.borderRadius}
            fill={node.fill}
            stroke={node.borderColor}
            strokeWidth={node.borderWidth}
          />

          {showLabels && (
            <text
              x={node.x + node.width / 2}
              y={node.y + node.height / 2}
              fill={node.textColor}
              fontSize={node.fontSize}
              fontWeight={node.fontWeight}
              fontStyle={node.fontStyle}
              textAnchor="middle"
              dominantBaseline="middle"
              pointerEvents="none"
            >
              {node.truncatedLabel}
            </text>
          )}

          {showDecorations && node.hasDetail && (
            <g transform={`translate(${node.x + node.width - 18}, ${node.y + 6})`} pointerEvents="none">
              <rect x="0" y="0" width="10" height="12" rx="1.5" fill="none" stroke="var(--color-text-muted)" strokeWidth="1" />
              <path d="M7 0 L10 3 L10 12" fill="none" stroke="var(--color-text-muted)" strokeWidth="1" />
              <line x1="2" y1="5" x2="8" y2="5" stroke="var(--color-text-muted)" strokeWidth="0.8" />
              <line x1="2" y1="8" x2="8" y2="8" stroke="var(--color-text-muted)" strokeWidth="0.8" />
            </g>
          )}

          {showDecorations && node.childCount > 0 && (
            <g transform={`translate(${node.x + node.width - node.badgeSize - 4}, ${node.y + 4})`} pointerEvents="none">
              <circle
                cx={node.badgeSize / 2}
                cy={node.badgeSize / 2}
                r={node.badgeSize / 2}
                fill="var(--color-accent)"
              />
              <text
                x={node.badgeSize / 2}
                y={node.badgeSize / 2}
                fill="var(--color-text-inverse)"
                fontSize={Math.max(7, Math.round(node.badgeSize * 0.58))}
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {node.childCount}
              </text>
            </g>
          )}
        </g>
      ))}
    </>
  )
})

const MiniMapViewportOverlay = memo(function MiniMapViewportOverlay({
  previewBounds,
  canvasSize,
}: {
  previewBounds: RectLike
  canvasSize: { width: number; height: number }
}) {
  const viewport = useViewport()

  const visibleFlowBounds = useMemo(() => ({
    x: -viewport.x / Math.max(viewport.zoom, 0.0001),
    y: -viewport.y / Math.max(viewport.zoom, 0.0001),
    width: canvasSize.width / Math.max(viewport.zoom, 0.0001),
    height: canvasSize.height / Math.max(viewport.zoom, 0.0001),
  }), [canvasSize.height, canvasSize.width, viewport.x, viewport.y, viewport.zoom])

  return (
    <>
      <path
        d={`M${previewBounds.x},${previewBounds.y}h${previewBounds.width}v${previewBounds.height}h${-previewBounds.width}z M${visibleFlowBounds.x},${visibleFlowBounds.y}h${visibleFlowBounds.width}v${visibleFlowBounds.height}h${-visibleFlowBounds.width}z`}
        fill="rgba(15, 23, 42, 0.14)"
        fillRule="evenodd"
        pointerEvents="none"
      />
      <rect
        x={visibleFlowBounds.x}
        y={visibleFlowBounds.y}
        width={visibleFlowBounds.width}
        height={visibleFlowBounds.height}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2"
        pointerEvents="none"
      />
    </>
  )
})

interface CanvasMiniMapProps {
  nodes: Node[]
  edges: Edge[]
  zoomLevel: number
  canvasSize: {
    width: number
    height: number
  }
}

export const CanvasMiniMap = memo(function CanvasMiniMap({
  nodes,
  edges,
  zoomLevel,
  canvasSize,
}: CanvasMiniMapProps) {
  const reactFlow = useReactFlow()
  const showMiniMap = useGraphUiStore((s) => s.showMiniMap)
  const miniMapSize = useGraphUiStore((s) => s.miniMapSize)
  const setShowMiniMap = useGraphUiStore((s) => s.setShowMiniMap)
  const setMiniMapSize = useGraphUiStore((s) => s.setMiniMapSize)
  const previewRef = useRef<SVGSVGElement | null>(null)
  const dragStateRef = useRef<{ pointerId: number; clientX: number; clientY: number; moved: boolean } | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const pendingFocusPointRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const [isDraggingPreview, setIsDraggingPreview] = useState(false)

  const graphBounds = useMemo(() => {
    if (nodes.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 }
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const node of nodes) {
      const rect = getNodeRect(node)
      minX = Math.min(minX, rect.x)
      minY = Math.min(minY, rect.y)
      maxX = Math.max(maxX, rect.x + rect.width)
      maxY = Math.max(maxY, rect.y + rect.height)
    }

    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    }
  }, [nodes])

  const previewBounds = useMemo(() => {
    const width = Math.max(graphBounds.width, 240)
    const height = Math.max(graphBounds.height, 140)
    const x = graphBounds.width === 0 ? -width / 2 : graphBounds.x
    const y = graphBounds.height === 0 ? -height / 2 : graphBounds.y

    return {
      x: x - MINI_MAP_PADDING,
      y: y - MINI_MAP_PADDING,
      width: width + MINI_MAP_PADDING * 2,
      height: height + MINI_MAP_PADDING * 2,
    }
  }, [graphBounds.height, graphBounds.width, graphBounds.x, graphBounds.y])

  const isCanvasLarge = useMemo(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0 || zoomLevel <= 0) return false

    const visibleFlowWidth = canvasSize.width / zoomLevel
    const visibleFlowHeight = canvasSize.height / zoomLevel

    return (
      graphBounds.width > visibleFlowWidth * MINI_MAP_AUTO_SHOW_RATIO ||
      graphBounds.height > visibleFlowHeight * MINI_MAP_AUTO_SHOW_RATIO
    )
  }, [canvasSize.height, canvasSize.width, graphBounds.height, graphBounds.width, zoomLevel])

  const isMiniMapVisible = showMiniMap && isCanvasLarge

  const edgeMarkerSize = useMemo(() => Math.max(6, Math.round(Math.min(previewBounds.width, previewBounds.height) * 0.015)), [previewBounds.height, previewBounds.width])

  const nodeById = useMemo(() => {
    const map = new Map<string, Node>()
    for (const node of nodes) {
      map.set(node.id, node)
    }
    return map
  }, [nodes])

  const previewModel = useMemo(
    () => buildPreviewModel(nodes, edges, nodeById),
    [edges, nodeById, nodes],
  )

  const miniMapDetailLevel = useMemo<MiniMapDetailLevel>(() => {
    if (
      nodes.length >= MINI_MAP_SKELETON_DETAIL_NODE_THRESHOLD ||
      edges.length >= MINI_MAP_SKELETON_DETAIL_EDGE_THRESHOLD
    ) {
      return 'skeleton'
    }

    if (
      nodes.length >= MINI_MAP_COMPACT_DETAIL_NODE_THRESHOLD ||
      edges.length >= MINI_MAP_COMPACT_DETAIL_EDGE_THRESHOLD
    ) {
      return 'compact'
    }

    return 'full'
  }, [edges.length, nodes.length])

  const handleToggleMiniMap = useCallback(() => {
    const nextVisible = !showMiniMap
    setShowMiniMap(nextVisible)

    logAction(nextVisible ? '视图:开启自动缩略图' : '视图:关闭自动缩略图', 'CanvasMiniMap', {
      visible: nextVisible,
      mode: 'auto',
    })
  }, [setShowMiniMap, showMiniMap])

  const handleMiniMapNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const width = node.width ?? 120
    const height = node.height ?? 52
    reactFlow.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: reactFlow.getZoom(),
      duration: 180,
    })
    logAction('视图:缩略图节点定位', 'CanvasMiniMap', { nodeId: node.id })
  }, [reactFlow])

  const focusMiniMapPoint = useCallback((clientX: number, clientY: number, duration: number) => {
    const element = previewRef.current
    if (!element) return

    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const relativeX = Math.min(Math.max(clientX - rect.left, 0), rect.width)
    const relativeY = Math.min(Math.max(clientY - rect.top, 0), rect.height)
    const flowX = previewBounds.x + (relativeX / rect.width) * previewBounds.width
    const flowY = previewBounds.y + (relativeY / rect.height) * previewBounds.height

    reactFlow.setCenter(flowX, flowY, {
      zoom: reactFlow.getZoom(),
      duration,
    })
  }, [previewBounds.height, previewBounds.width, previewBounds.x, previewBounds.y, reactFlow])

  const flushPendingFocusPoint = useCallback(() => {
    dragFrameRef.current = null

    const pendingFocusPoint = pendingFocusPointRef.current
    if (!pendingFocusPoint) return

    pendingFocusPointRef.current = null
    focusMiniMapPoint(pendingFocusPoint.clientX, pendingFocusPoint.clientY, 0)
  }, [focusMiniMapPoint])

  const scheduleFocusPoint = useCallback((clientX: number, clientY: number) => {
    pendingFocusPointRef.current = { clientX, clientY }
    if (dragFrameRef.current !== null) return

    dragFrameRef.current = window.requestAnimationFrame(flushPendingFocusPoint)
  }, [flushPendingFocusPoint])

  useEffect(() => () => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
    }
  }, [])

  const handlePreviewPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return

    dragStateRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const handlePreviewPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const movedDistance = Math.hypot(event.clientX - dragState.clientX, event.clientY - dragState.clientY)
    if (movedDistance >= MINI_MAP_INTERACTION_DRAG_THRESHOLD) {
      if (!dragState.moved) {
        dragState.moved = true
        setIsDraggingPreview(true)
      }
      scheduleFocusPoint(event.clientX, event.clientY)
    }
  }, [scheduleFocusPoint])

  const handlePreviewPointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (dragState.moved) {
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current)
        flushPendingFocusPoint()
      }
      logAction('视图:缩略图拖拽平移', 'CanvasMiniMap', {})
    } else {
      focusMiniMapPoint(event.clientX, event.clientY, 120)
      logAction('视图:缩略图点击定位', 'CanvasMiniMap', {})
    }

    dragStateRef.current = null
    setIsDraggingPreview(false)
    pendingFocusPointRef.current = null
  }, [flushPendingFocusPoint, focusMiniMapPoint])

  const updateMiniMapWidth = useCallback((delta: number) => {
    const nextWidth = Math.max(MINI_MAP_MIN_WIDTH, Math.min(MINI_MAP_MAX_WIDTH, miniMapSize.width + delta))
    const nextHeight = Math.round(nextWidth / MINI_MAP_ASPECT_RATIO)

    if (nextWidth === miniMapSize.width && nextHeight === miniMapSize.height) return

    setMiniMapSize({
      width: nextWidth,
      height: nextHeight,
    })

    logAction('视图:缩略图尺寸调整', 'CanvasMiniMap', {
      width: nextWidth,
      height: nextHeight,
    })
  }, [miniMapSize.height, miniMapSize.width, setMiniMapSize])

  const miniMapControlButtonClassName = 'h-6 w-6 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-all duration-200 hover:text-[var(--color-text)] hover:bg-[var(--color-hover-bg)] disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <>
      <Panel position="bottom-left">
        <div className="flex items-end gap-1.5">
          <div className="flex flex-col items-center gap-1.5">
            <Toolbar zoomLevel={zoomLevel} inline />

            <div className="flex flex-col items-center gap-0.5 rounded-2xl border border-[var(--color-border)] bg-[color:color-mix(in_srgb,var(--titlebar-menu-bg)_90%,transparent)] p-0.5 shadow-[var(--shadow-sm)] backdrop-blur-xl">
              {isMiniMapVisible && (
                <>
                  <button
                    type="button"
                    className={miniMapControlButtonClassName}
                    onClick={() => updateMiniMapWidth(MINI_MAP_WIDTH_STEP)}
                    title="放大缩略图"
                    aria-label="放大缩略图"
                    disabled={miniMapSize.width >= MINI_MAP_MAX_WIDTH}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    className={miniMapControlButtonClassName}
                    onClick={() => updateMiniMapWidth(-MINI_MAP_WIDTH_STEP)}
                    title="缩小缩略图"
                    aria-label="缩小缩略图"
                    disabled={miniMapSize.width <= MINI_MAP_MIN_WIDTH}
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                </>
              )}

              <div className="h-px w-3.5 bg-[var(--color-border)] opacity-70" />

              <button
                type="button"
                className={miniMapControlButtonClassName}
                onClick={handleToggleMiniMap}
                title={showMiniMap ? '关闭自动缩略图' : '开启自动缩略图'}
                aria-label={showMiniMap ? '关闭自动缩略图' : '开启自动缩略图'}
              >
                {showMiniMap ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {isMiniMapVisible && (
            <div
              className="overflow-hidden rounded-[18px] border border-[var(--color-border)] bg-[var(--color-canvas-bg)] shadow-[var(--shadow-md)] backdrop-blur-xl"
              style={{
                width: miniMapSize.width,
                height: miniMapSize.height,
              }}
            >
              <svg
                ref={previewRef}
                width="100%"
                height="100%"
                viewBox={`${previewBounds.x} ${previewBounds.y} ${previewBounds.width} ${previewBounds.height}`}
                preserveAspectRatio="none"
                aria-label="画布缩略图"
                className={isDraggingPreview ? 'cursor-grabbing' : 'cursor-pointer'}
                onPointerDown={handlePreviewPointerDown}
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={handlePreviewPointerUp}
                onPointerCancel={handlePreviewPointerUp}
                onDoubleClick={(event) => event.preventDefault()}
              >
                <MiniMapStaticSvg
                  previewBounds={previewBounds}
                  previewEdges={previewModel.previewEdges}
                  previewNodes={previewModel.previewNodes}
                  markerDefinitions={previewModel.markerDefinitions}
                  edgeMarkerSize={edgeMarkerSize}
                  detailLevel={miniMapDetailLevel}
                  onNodeClick={(nodeId, event) => {
                    event.stopPropagation()
                    const fullNode = nodeById.get(nodeId)
                    if (fullNode) {
                      handleMiniMapNodeClick(event as unknown as React.MouseEvent, fullNode)
                    }
                  }}
                />
                <MiniMapViewportOverlay previewBounds={previewBounds} canvasSize={canvasSize} />
              </svg>
            </div>
          )}
        </div>
      </Panel>
    </>
  )
})
