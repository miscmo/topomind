import { useCallback, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useNodeActions } from './useNodeActions'
import { useNodeMoveToRoom } from './useNodeMoveToRoom'
import { logAction } from '../../../../core/log-backend'
import type { ContextMenuState } from '../../../../types/uiStoreTypes'
import type { GraphContextValue } from '../../../../contexts/GraphContext'
import { normalizeRef, resolveRoomChildRef } from '../../../../domain/graph/path-utils'
import { tabStore } from '../../../../stores/tabs/tabStore'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import { useLinkedDocumentStore } from '../../linkedDocumentStore'

interface UseGraphPageActionsOptions {
  graph: GraphContextValue
  tabId: string
}

/**
 * 打开菜单时冻结一次选中快照：菜单可见期间不需要订阅 store，避免框选热路径重渲染。
 * selectedIds 同时是「批量移动」的唯一集合来源 —— 节点 / 画布空白 / 多选选区包围盒
 * 三种右键共用它，点击菜单项时不再回读 store，右键期间选中态的任何变化都不会
 * 让整批移动退化成单节点移动。
 */
interface PageContextMenuState extends ContextMenuState {
  selectedIds: string[]
  selectedCount: number
  targetInSelection: boolean
  /** 右键落在 xyflow 的多选选区包围盒上：渲染多选专用菜单 */
  selectionMenu: boolean
}

const CLOSED_MENU: PageContextMenuState = {
  visible: false,
  x: 0,
  y: 0,
  type: null,
  targetId: null,
  selectedIds: [],
  selectedCount: 0,
  targetInSelection: false,
  selectionMenu: false,
}

export function useGraphPageActions({ graph, tabId }: UseGraphPageActionsOptions) {
  const { screenToFlowPosition } = useReactFlow()
  const graphStoreApi = useGraphStoreApi()
  const [contextMenu, setContextMenu] = useState<PageContextMenuState>(CLOSED_MENU)
  const {
    handleNewChild,
    handleEnterNode,
    handleDelete,
    handleEdgeDelete,
    handleEdgeStyle,
  } = useNodeActions({ graph })
  const {
    moveState,
    openMoveToRoom,
    openMoveIdsToRoom,
    closeMoveToRoom,
    handleMoveNodesToRoom,
    onMoveUndo,
    onMoveRedo,
  } = useNodeMoveToRoom({ graph })

  const readSelectionSnapshot = useCallback(() => {
    return graphStoreApi.getState().selectedNodeIds.map(normalizeRef)
  }, [graphStoreApi])

  const openLinkDocument = useCallback((nodeId: string) => {
    const node = graphStoreApi.getState().nodesMap.get(nodeId)
    if (!node) return
    const session = tabStore.getState().getGraphSession(tabId)
    const cardPath = resolveRoomChildRef(session.roomPath || session.kbPath, nodeId)
    useLinkedDocumentStore.getState().openDialog({
      nodeId,
      cardPath,
      label: String(node.data.label || nodeId),
      links: node.data.linkedDocuments ?? [],
    })
  }, [graphStoreApi, tabId])

  const closeContextMenu = useCallback(() => {
    setContextMenu((current) => {
      if (!current.visible) return current
      logAction('右键菜单:关闭', 'GraphPage', {})
      return { ...current, visible: false }
    })
  }, [])

  const openNodeMenu = useCallback((nodeId: string, event: MouseEvent | React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    logAction('右键菜单:显示', 'GraphPage', { type: 'node', nodeId, x: event.clientX, y: event.clientY })
    const selectedIds = readSelectionSnapshot()
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      type: 'node',
      targetId: nodeId,
      selectedIds,
      selectedCount: selectedIds.length,
      targetInSelection: selectedIds.includes(normalizeRef(nodeId)),
      selectionMenu: false,
    })
  }, [readSelectionSnapshot])

  const openEdgeMenu = useCallback((edgeId: string, event: MouseEvent | React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    logAction('右键菜单:显示', 'GraphPage', { type: 'edge', edgeId, x: event.clientX, y: event.clientY })
    const selectedIds = readSelectionSnapshot()
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      type: 'edge',
      targetId: edgeId,
      selectedIds,
      selectedCount: selectedIds.length,
      targetInSelection: false,
      selectionMenu: false,
    })
  }, [readSelectionSnapshot])

  const openPaneMenu = useCallback((x: number, y: number) => {
    logAction('右键菜单:显示', 'GraphPage', { type: 'pane', x, y })
    const selectedIds = readSelectionSnapshot()
    setContextMenu({
      visible: true,
      x,
      y,
      type: 'pane',
      targetId: '__pane__',
      selectedIds,
      selectedCount: selectedIds.length,
      targetInSelection: false,
      selectionMenu: false,
    })
  }, [readSelectionSnapshot])

  /**
   * 选区包围盒右键：xyflow 的 .react-flow__nodesselection-rect 会吞掉事件，
   * node / pane 回调都收不到，只有 onSelectionContextMenu 会触发。
   * 该层在**单选**时也会覆盖节点，所以按选中数量分流：
   * - 1 个 → 回落到完整节点菜单（不能让「进入节点 / 选中子树」等项消失）；
   * - 多个 → 批量菜单（整批移动 / 取消选择）。
   * 两种菜单都用同一份冻结快照，框选 / 选中子树 / Shift 点选行为一致。
   */
  const openSelectionMenu = useCallback((x: number, y: number, selectedNodes: string[]) => {
    const snapshot = readSelectionSnapshot()
    // 正常情况下两者一致；万一 store 快照与 xyflow 内部选中态有一帧不同步，
    // 用 xyflow 传来的集合兜底，避免出现「有选中但菜单说 0 个」。
    const selectedIds = snapshot.length > 0 ? snapshot : selectedNodes.map(normalizeRef).filter(Boolean)
    const singleId = selectedIds.length === 1 ? selectedIds[0] : ''
    logAction('右键菜单:显示', 'GraphPage', { type: 'selection', x, y, count: selectedIds.length })
    setContextMenu({
      visible: true,
      x,
      y,
      type: singleId ? 'node' : 'pane',
      targetId: singleId || null,
      selectedIds,
      selectedCount: selectedIds.length,
      targetInSelection: Boolean(singleId),
      selectionMenu: !singleId,
    })
  }, [readSelectionSnapshot])

  const handleContextMenuNewChild = useCallback((position?: { x: number; y: number }) => {
    const flowPosition = position ? screenToFlowPosition(position) : undefined
    handleNewChild(flowPosition)
  }, [handleNewChild, screenToFlowPosition])

  const handleCanvasEdgeContextMenu = useCallback((edgeId: string, event: React.MouseEvent) => {
    openEdgeMenu(edgeId, event)
  }, [openEdgeMenu])

  return {
    canvasProps: {
      onNodeContextMenu: openNodeMenu,
      onEdgeContextMenu: handleCanvasEdgeContextMenu,
      onPaneContextMenu: openPaneMenu,
      onSelectionContextMenu: openSelectionMenu,
      onCloseContextMenu: closeContextMenu,
      // 画布状态面板的常驻撤销 / 前进按钮：与 toast 撤销共用同一份移动历史。
      onMoveUndo,
      onMoveRedo,
    },
    contextMenuProps: {
      visible: contextMenu.visible,
      x: contextMenu.x,
      y: contextMenu.y,
      type: contextMenu.type,
      targetId: contextMenu.targetId,
      selectedCount: contextMenu.selectedCount,
      targetInSelection: contextMenu.targetInSelection,
      selectionMenu: contextMenu.selectionMenu,
      onNewChild: handleContextMenuNewChild,
      onEnterNode: handleEnterNode,
      onSelectSubtree: (nodeId: string) => {
        // 右键指定了明确的根：即使画布当前选中了别的节点，也只选中这一棵子树。
        graph.selectSubtree([nodeId])
      },
      onDelete: handleDelete,
      onEdgeDelete: handleEdgeDelete,
      onEdgeStyle: handleEdgeStyle,
      onAddEmoji: (nodeId: string, position: { x: number, y: number }) => {
        // We use setTimeout to ensure the menu close event doesn't immediately dismiss the picker
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent('topomind:add-emoji', { detail: { nodeId, position } }))
        }, 50)
      },
      // 三个批量入口一律使用打开菜单时冻结的 selectedIds，不回读 store。
      onMoveToRoom: (nodeId: string) => openMoveToRoom(nodeId, contextMenu.selectedIds),
      onMoveSelectionToRoom: () => openMoveIdsToRoom(contextMenu.selectedIds),
      onClearSelection: () => graph.deselectNode(),
      onLinkDocument: openLinkDocument,
      onClose: closeContextMenu,
    },
    moveDialogProps: { moveState, closeMoveToRoom, handleMoveNodesToRoom },
  }
}
