import { useCallback, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useNodeActions } from './useNodeActions'
import { useNodeMoveToRoom } from './useNodeMoveToRoom'
import { logAction } from '../../../../core/log-backend'
import { recordStep } from '../../../../core/traceBuffer'
import type { ContextMenuState } from '../../../../types/uiStoreTypes'
import type { GraphContextValue } from '../../../../contexts/GraphContext'
import { normalizeRef, resolveRoomChildRef } from '../../../../domain/graph/path-utils'
import { tabStore } from '../../../../stores/tabs/tabStore'
import { useGraphStoreApi } from '../../../../stores/graphStore'
import { useRightPanelStore } from '../../../../stores/rightPanelStore'
import { useDetailPanelStore } from '../../../right-panel/model/detailPanelStore'
import { useDetailLockStore } from '../../../right-panel/model/detailLockStore'
import { toast } from '../../../../shared/ui/Toaster/toastStore'
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
    handleNewContainerChild,
    handleNewCardSpecContainerChild,
    handleNewImageContainerChild,
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

  /**
   * 右键「打开节点文档」：等价于卡片上文档图标的 openOwnDocument，但不挑节点。
   * 卡片图标只在 hasDetail 时渲染，无文档节点因此完全没有进右栏的入口；这里
   * 一律展开右栏，由 DocumentEditorHost 的空状态提供「新建文档」按钮。
   */
  const openNodeDocument = useCallback((nodeId: string) => {
    if (!graphStoreApi.getState().nodesMap.has(nodeId)) return
    const kbPath = tabStore.getState().getGraphSession(tabId).kbPath
    const locked = kbPath ? useDetailLockStore.getState().lockedByKb[kbPath] : null
    if (locked?.nodeId && locked.nodeId !== nodeId) {
      toast({ level: 'warn', title: '无法打开节点文档', message: '右栏已锁定到其它节点，请先解锁' })
      return
    }
    // 右键目标可能只是多选集合里的一员：把选中态收敛到它，右栏才按该节点解析 _docs。
    graph.selectNode(nodeId)
    const rightPanel = useRightPanelStore.getState()
    // 显式展开，不走 applyRightPanelAutoVisibility(true)：无文档节点没有「有文档」
    // 这一事实，也不该让任何自动显隐逻辑在展开后把它收回。
    rightPanel.expandRightPanel()
    rightPanel.setRightPanelTab('detail')
    // 上次可能停在「关联文档」视图，那里看不到本节点文档树、也不能新建文档。
    useDetailPanelStore.getState().setDetailViewForNode(nodeId, 'own')
    // 菜单的打开 / 关闭已各写一条 ui.context_menu；这里降级为内存步骤，避免重复事实。
    recordStep({ name: 'node.document.open', outcome: 'requested', params: { nodeId, source: 'context-menu' } })
  }, [graph, graphStoreApi, tabId])

  const closeContextMenu = useCallback(() => {
    setContextMenu((current) => {
      if (!current.visible) return current
      logAction('ui.context_menu', 'GraphPage', {})
      return { ...current, visible: false }
    })
  }, [])

  const openNodeMenu = useCallback((nodeId: string, event: MouseEvent | React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    logAction('ui.context_menu', 'GraphPage', { type: 'node', nodeId, x: event.clientX, y: event.clientY })
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
    logAction('ui.context_menu', 'GraphPage', { type: 'edge', edgeId, x: event.clientX, y: event.clientY })
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
    logAction('ui.context_menu', 'GraphPage', { type: 'pane', x, y })
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
    logAction('ui.context_menu', 'GraphPage', { type: 'selection', x, y, count: selectedIds.length })
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

  const handleContextMenuNewContainerChild = useCallback((position?: { x: number; y: number }) => {
    const flowPosition = position ? screenToFlowPosition(position) : undefined
    void handleNewContainerChild(flowPosition)
  }, [handleNewContainerChild, screenToFlowPosition])

  const handleContextMenuNewCardSpecContainerChild = useCallback((position?: { x: number; y: number }) => {
    const flowPosition = position ? screenToFlowPosition(position) : undefined
    void handleNewCardSpecContainerChild(flowPosition)
  }, [handleNewCardSpecContainerChild, screenToFlowPosition])

  const handleContextMenuNewImageContainerChild = useCallback((position?: { x: number; y: number }) => {
    const flowPosition = position ? screenToFlowPosition(position) : undefined
    void handleNewImageContainerChild(flowPosition)
  }, [handleNewImageContainerChild, screenToFlowPosition])

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
      onNewContainerChild: handleContextMenuNewContainerChild,
      onNewCardSpecContainerChild: handleContextMenuNewCardSpecContainerChild,
      onNewImageContainerChild: handleContextMenuNewImageContainerChild,
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
      onOpenNodeDocument: openNodeDocument,
      onLinkDocument: openLinkDocument,
      onClose: closeContextMenu,
    },
    moveDialogProps: { moveState, closeMoveToRoom, handleMoveNodesToRoom },
  }
}
