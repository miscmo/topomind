import { useCallback, useEffect, useRef } from 'react'
import type { Connection, Edge, EdgeChange, FinalConnectionState, Node, NodeChange } from '@xyflow/react'
import { tabStore } from '../../stores/tabs/tabStore'
import { logAction } from '../../core/log-backend'
import { markPerformanceMetricStart, PERFORMANCE_METRICS } from '../../core/performance-log'
import type { EdgeStylePatch, KnowledgeNodeData } from '../../types'
import { generateId } from './graphBuilder'
import type { GraphOperations } from './graphOperations'
import { resolveRoomChildRef } from '../../domain/graph/path-utils'
import { useGraphUiStore } from '../../stores/graphUiStore'
import { isCanvasReadOnly } from '../../stores/canvasReadOnlyStore'
import type { GraphState } from '../../stores/graphStore'
import type { StoreApi } from 'zustand'
import { useEdgeRelationPickerStore } from '../../stores/edgeRelationPickerStore'
import { SUBORDINATE_EDGE_RELATION_ID } from '../../domain/graph/edgeRelations'
import {
  buildHierarchy,
  describeDowngradeReason,
  toHierarchyEdge,
  validateSubordinateEdge,
  type HierarchyEdgeLike,
} from '../../domain/graph/graphHierarchy'

export interface GraphEventHandlerDeps {
  tabId: string
  ops: GraphOperations
  getActiveGraphSession: () => { kbPath: string; roomPath: string; roomName: string }
  defaultEdgeStyle?: Partial<EdgeStylePatch>
  setSelectedEdgeId: (edgeId: string | null) => void
  storeApi: StoreApi<GraphState>
}

export function useGraphEventHandlers(deps: GraphEventHandlerDeps) {
  const {
    tabId,
    ops,
    getActiveGraphSession,
    defaultEdgeStyle,
    setSelectedEdgeId,
    storeApi,
  } = deps
  const navigationTargetRef = useRef('')
  const navigationResetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (navigationResetTimerRef.current !== null) {
        window.clearTimeout(navigationResetTimerRef.current)
      }
    }
  }, [])

  const resetConnectTargetHighlight = useCallback(() => {
    const graphUi = useGraphUiStore.getState()
    graphUi.setConnectingSourceId(null)
    graphUi.setConnectingTargetId(null)
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const positionChanges: Array<{ id: string; position?: { x: number; y: number }; dragging?: boolean }> = []
      const removeIds: string[] = []
      const dimensionChanges: Array<{ id: string; dimensions: { width: number; height: number } | null | undefined; resizing?: boolean; origin?: 'auto-size' | 'manual' }> = []
      const selectionChanges: Array<{ id: string; selected: boolean }> = []

      for (const change of changes) {
        if (change.type === 'position') {
          // React Flow emits { dragging: false } without position when drag ends
          positionChanges.push({ 
            id: change.id, 
            position: change.position, 
            dragging: change.dragging 
          })
        } else if (change.type === 'remove') {
          removeIds.push(change.id)
        } else if (change.type === 'dimensions') {
          dimensionChanges.push({
            id: change.id,
            dimensions: change.dimensions,
            resizing: change.resizing,
            origin: (change as NodeChange & { origin?: 'auto-size' | 'manual' }).origin,
          })
        } else if (change.type === 'select') {
          selectionChanges.push({ id: change.id, selected: change.selected })
        }
      }

      if (positionChanges.length) ops.applyNodePositionChanges(positionChanges)
      if (removeIds.length) {
        ops.applyNodeRemoveChanges(removeIds)
        // Ensure we clear selectedEdgeId if the currently selected edge was removed
        const currentSelectedEdgeId = useGraphUiStore.getState().selectedEdgeId
        if (currentSelectedEdgeId) {
          const edgeStillExists = storeApi.getState().edges.some(e => e.id === currentSelectedEdgeId)
          if (!edgeStillExists) setSelectedEdgeId(null)
        }
      }
      if (dimensionChanges.length) ops.applyNodeDimensionChanges(dimensionChanges)
      if (selectionChanges.length) {
        // Multi-select via Shift is allowed natively by React Flow.
        // The selectionChanges array will contain all selections/deselections.
        ops.applyNodeSelectionChanges(selectionChanges)
        // 直接读 store 派生好的计数：框选取消选中时会一路扫到底，
        // 而 selectedNodeCount 是 setNodes 顺带算好的，O(1)。
        const anyNodeSelected = storeApi.getState().selectedNodeCount > 0
        if (anyNodeSelected) {
          const currentSelectedEdgeId = useGraphUiStore.getState().selectedEdgeId
          if (currentSelectedEdgeId) {
            setSelectedEdgeId(null)
            ops.setSelectedEdgeInGraph(null)
          }
        }
      }
    },
    [ops, setSelectedEdgeId]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          ops.deleteEdge(change.id)
          const currentSelectedEdgeId = useGraphUiStore.getState().selectedEdgeId
          if (currentSelectedEdgeId === change.id) {
            setSelectedEdgeId(null)
          }
        } else if (change.type === 'select') {
          if (change.selected) {
            setSelectedEdgeId(change.id)
            ops.setSelectedEdgeInGraph(change.id)
          } else {
            // Only clear if this was the selected edge
            const currentSelectedEdgeId = useGraphUiStore.getState().selectedEdgeId
            if (currentSelectedEdgeId === change.id) {
              setSelectedEdgeId(null)
              ops.setSelectedEdgeInGraph(null)
            } else {
              ops.setSelectedEdgeInGraph(currentSelectedEdgeId)
            }
            // Ensure the edge's internal data reflects the unselected state
          }
        }
      }
    },
    [ops, setSelectedEdgeId]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      const graphUi = useGraphUiStore.getState()
      const source = connection.source ?? graphUi.connectingSourceId
      const target = connection.target ?? graphUi.connectingTargetId
      if (!source || !target || source === target) return

      ops.deselectNode()
      ops.setSelectedEdgeInGraph(null)

      // 【用户决策】每次新建连线必须强制选择关系类型。先算出「从属」是否可用，
      // 不可用就在浮层里禁用并说明原因；用户不选 / 取消则一条边都不落盘。
      const projected: HierarchyEdgeLike[] = storeApi.getState().edges.map((edge) => toHierarchyEdge({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        relation: edge.data?.relation,
        weight: edge.data?.weight,
      }))
      const nodeIds = projected.flatMap((edge) => [edge.source, edge.target])
      const hierarchy = buildHierarchy(nodeIds, projected).hierarchy
      const subordinateCheck = validateSubordinateEdge(hierarchy, toHierarchyEdge({
        id: '__pending__',
        source,
        target,
        relation: SUBORDINATE_EDGE_RELATION_ID,
        weight: 'minor',
      }))

      useEdgeRelationPickerStore.getState().open({
        source,
        target,
        subordinateBlockedReason: subordinateCheck.ok
          ? null
          : describeDowngradeReason(subordinateCheck.reason ?? 'cycle'),
        onConfirm: (relation) => {
          // 浮层可能在可编辑时打开、用户随后缩小镜头才点确认；落盘前再挡一次，
          // 否则「只读期间新增连线」会从这条异步路径漏过去。
          if (isCanvasReadOnly(tabId)) return
          const edgeId = generateId('e-')
          ops.addEdge({ ...connection, source, target }, edgeId, defaultEdgeStyle, relation).then((created) => {
            if (!created) return
            ops.setSelectedEdgeInGraph(edgeId)
            setSelectedEdgeId(edgeId)
          })
        },
      })
    },
    [ops, defaultEdgeStyle, setSelectedEdgeId, storeApi, tabId]
  )

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      logAction('节点:点击', 'useGraph', { nodeId: node.id, label: node.data.label })
      if (!event.shiftKey) {
        markPerformanceMetricStart(PERFORMANCE_METRICS.nodeSelect, node.id)
      }
      ops.selectNode(node.id, event.shiftKey)
      setSelectedEdgeId(null)
      ops.setSelectedEdgeInGraph(null)
    },
    [ops, setSelectedEdgeId]
  )

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      // 连线格式刷激活时：点击连线即应用样式（可连续应用多条），不改变选中态，按 Esc 退出
      const edgeFormatPainterStyle = useGraphUiStore.getState().edgeFormatPainterStyle
      if (edgeFormatPainterStyle) {
        // 格式刷是「点击即写入」，走的是 ops 而不是 Context 的 updateEdgeStyle，
        // 只读时必须在这里单独挡住（Context 闸门覆盖不到这条捷径）。
        if (isCanvasReadOnly(tabId)) return
        ops.updateEdgeStyle(edge.id, edgeFormatPainterStyle)
        return
      }
      ops.deselectNode()
      ops.setSelectedEdgeInGraph(edge.id)
      setSelectedEdgeId(edge.id)
    },
    [setSelectedEdgeId, ops, tabId]
  )

  // 程序化选中某条连线（与 onEdgeClick 等价），供右键菜单"连线样式"等入口复用：
  // 取消节点选中、在画布高亮该连线、并把 selectedEdgeId 写入 UI store，
  // 右侧面板的样式设置模型会据此自动切到"连线"Tab 并展开"当前连线样式"。
  const selectEdge = useCallback(
    (edgeId: string) => {
      ops.deselectNode()
      ops.setSelectedEdgeInGraph(edgeId)
      setSelectedEdgeId(edgeId)
    },
    [ops, setSelectedEdgeId]
  )

  const onPaneClick = useCallback(() => {
    ops.deselectNode()
    resetConnectTargetHighlight()
    ops.setSelectedEdgeInGraph(null)
    setSelectedEdgeId(null)
  }, [ops, setSelectedEdgeId, resetConnectTargetHighlight])

  const navigateToChildRoom = useCallback(async (childPath: string, childName: string) => {
    const graphSession = getActiveGraphSession()
    const dirPath = graphSession.roomPath
    const absoluteChildPath = resolveRoomChildRef(dirPath || graphSession.kbPath, childPath)

    if (!absoluteChildPath || absoluteChildPath === dirPath) {
      return
    }
    if (navigationTargetRef.current === absoluteChildPath) {
      return
    }
    navigationTargetRef.current = absoluteChildPath
    if (navigationResetTimerRef.current !== null) {
      window.clearTimeout(navigationResetTimerRef.current)
    }

    try {
      const snapshot = dirPath ? ops.captureSaveSnapshot(dirPath) : null
      if (snapshot) await ops.saveSnapshot(snapshot)

      tabStore.getState().enterRoomInTab(tabId, {
        path: absoluteChildPath,
        kbPath: graphSession.kbPath || '',
        name: childName,
      })
      logAction('房间:钻入', 'useGraph', { roomPath: absoluteChildPath, roomName: childName, fromRoom: dirPath })
    } finally {
      if (navigationResetTimerRef.current !== null) {
        window.clearTimeout(navigationResetTimerRef.current)
      }
      navigationResetTimerRef.current = window.setTimeout(() => {
        if (navigationTargetRef.current === absoluteChildPath) {
          navigationTargetRef.current = ''
        }
        navigationResetTimerRef.current = null
      }, 800)
    }
  }, [getActiveGraphSession, tabId, ops])

  const onNodeContextMenu = useCallback(
    (_: React.MouseEvent, node: Node<KnowledgeNodeData>) => {
      setSelectedEdgeId(null)
      ops.setSelectedEdgeInGraph(null)
      markPerformanceMetricStart(PERFORMANCE_METRICS.nodeSelect, node.id)
      ops.selectNode(node.id)
    },
    [ops, setSelectedEdgeId]
  )

  const onConnectStart = useCallback((_: unknown, params: { nodeId?: string | null }) => {
    const graphUi = useGraphUiStore.getState()
    graphUi.setConnectingSourceId(params.nodeId ?? null)
    graphUi.setConnectingTargetId(null)
  }, [])

  const onConnectEnd = useCallback((_: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    const graphUi = useGraphUiStore.getState()
    const source = graphUi.connectingSourceId
    const target = graphUi.connectingTargetId
    // React Flow already invokes onConnect for a valid handle-to-handle connection.
    // Only synthesize a connection when our card-level snap target handled an otherwise invalid drop.
    if (!connectionState.isValid && source && target && source !== target) {
      onConnect({ source, target, sourceHandle: null, targetHandle: null })
    }
    resetConnectTargetHighlight()
  }, [onConnect, resetConnectTargetHighlight])

  return {
    onNodesChange,
    onEdgesChange,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onNodeClick,
    onEdgeClick,
    selectEdge,
    onPaneClick,
    navigateToChildRoom,
    onNodeContextMenu,
  }
}
