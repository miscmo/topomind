/**
 * 左侧节点树面板（浮层，画布宽度无感知）。
 *
 * 布局契约：与右栏一样 absolute 贴在 #app-layout 左侧、固定 z-30，
 * **不参与 flex 两栏**；画布宽度与 React Flow viewport 恒定。
 * 唯一的例外是用户明确要求的「状态面板让位」：左栏展开时通过 :root 上的
 * `--tm-node-tree-offset` 让 top-left 的画布状态抽屉 margin-left 右移，
 * 纯 CSS 完成，画布 React 不订阅面板状态，其它 Panel 一律不动。
 * 折叠态该变量归零、抽屉回到左上角；不改动抽屉本身的定位与画布尺寸。
 *
 * 交互：默认只展开「当前房间」虚拟根，其余节点全部折叠；展开态按房间写入
 * localStorage，重开面板 / 重启应用都记得上次状态。子节点懒加载：折叠分支
 * 不构造子树、不渲染 DOM、也不读子房间 meta，点箭头才加载该层。
 * 搜索命中时切平铺结果；同父可拖动排序（游离 / 房间子节点不可拖）。
 *
 * 【单一 Left Dock / 唯一开关】左侧是多页面浮层，但面板本身只负责渲染内容：
 * 页面切换、展开、折叠全部由 App 层 NavRail 的竖 tab 驱动
 * （`nodeTreePanelStore.setActivePanel` 是唯一写入 collapsed 的入口）。
 * 折叠态直接不渲染任何 DOM。
 * 同一时刻只渲染一个页面：AI Agent 占位页 / 知识库列表 / 节点结构，三者共用同一开合状态。
 */
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { useReactFlow } from '@xyflow/react'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDashed,
  FileText,
  FolderOpen,
  FolderTree,
  GripVertical,
  Layers3,
  Library,
  ListTree,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { TM_UI } from '@/shared/ui/controlStyles'
import AgentPlaceholder from './AgentPlaceholder'
import KnowledgeBaseListPanel from './KnowledgeBaseListPanel'
import { useGraphContext } from '../../../../contexts/GraphContext'
import { useGraphStore, useGraphStoreApi } from '../../../../stores/graphStore'
import { CANVAS_OPERATIONS, PERFORMANCE_METRICS } from '../../../../shared/observability/performanceContract'
import { startCanvasSpan } from '../../../../hooks/useGraph/canvasPerformanceContext'
import { NODE_TREE_PANEL_WIDTH, useNodeTreePanelStore } from '../../../../stores/nodeTreePanelStore'
import { useGraphSession } from '../../../../stores/tabs/tabStore'
import { isCanvasReadOnly } from '../../../../stores/canvasReadOnlyStore'
import {
  defaultExpandedKeys,
  flattenTreeForSearch,
  makeRoomRootKey,
  reorderSiblings,
  type NodeTreeNode,
  type NodeTreeSearchHit,
} from '../../../../domain/graph/nodeTree'
import { useNodeTree } from '../model/useNodeTree'

interface NodeTreePanelProps {
  tabId: string
  isActive: boolean
}

function countTreeNodes(node: NodeTreeNode): number {
  let total = node.origin === 'room-root' ? 0 : 1
  for (const child of node.children) total += countTreeNodes(child)
  return total
}

function originBadge(node: NodeTreeNode): ReactNode {
  if (node.origin === 'room-root') {
    return <span className="shrink-0 rounded border border-[var(--color-border-light)] px-1 text-[10px] text-[var(--color-text-secondary)]">当前房间</span>
  }
  if (node.origin === 'room-child') {
    return <span className="shrink-0 rounded border border-[var(--color-border-light)] px-1 text-[10px] text-[var(--color-accent)]">房间</span>
  }
  if (node.origin === 'free') {
    return <span className="shrink-0 rounded border border-[var(--color-border-light)] px-1 text-[10px] text-[var(--color-text-muted)]">游离</span>
  }
  return null
}

/** 语义化图标：房间 / 可进入房间 / 分支 / 游离 / 普通知识卡片逐级区分。 */
function originIcon(node: NodeTreeNode): ReactNode {
  if (node.origin === 'room-root') return <Layers3 className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
  if (node.hasChildRoom) return <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
  if (node.hasChildren) return <FolderTree className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
  if (node.origin === 'free') return <CircleDashed className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
  return <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-tertiary)]" />
}

export default memo(function NodeTreePanel({ tabId, isActive }: NodeTreePanelProps) {
  const collapsed = useNodeTreePanelStore((state) => state.collapsed)

  // 只有激活标签页写这个变量；非激活页连清理都不做，避免多标签互相覆盖。
  // CSS 侧只改 top-left Panel 的 margin-left，画布尺寸 / viewport 一概不变。
  useEffect(() => {
    if (!isActive) return
    const root = document.documentElement
    root.style.setProperty(
      '--tm-node-tree-offset',
      collapsed ? '0px' : `${NODE_TREE_PANEL_WIDTH}px`,
    )
    return () => { root.style.removeProperty('--tm-node-tree-offset') }
  }, [collapsed, isActive])

  // 折叠态直接不渲染：左栏没有任何第二套显隐入口，开合只由 NavRail 竖 tab 负责。
  if (!isActive || collapsed) return null
  return <NodeTreePanelBody tabId={tabId} />
})

function NodeTreePanelBody({ tabId }: { tabId: string }) {
  const activePanelId = useNodeTreePanelStore((state) => state.activePanelId)
  const session = useGraphSession(tabId)
  const roomPath = session?.roomPath ?? ''
  const rootKey = useMemo(() => makeRoomRootKey(roomPath), [roomPath])

  // 展开态在 store（localStorage）里，不在组件本地 state：折叠/重开面板、
  // 切房间再回来、重启应用都能记住。缺省 = 只展开房间虚拟根。
  const savedExpanded = useNodeTreePanelStore((state) => state.expandedByRoom[roomPath])
  const expandedKeys = useMemo(
    () => savedExpanded ? new Set<string>(savedExpanded) : defaultExpandedKeys(rootKey),
    [savedExpanded, rootKey],
  )
  const toggleNode = useNodeTreePanelStore((state) => state.toggleNode)
  const expandNode = useNodeTreePanelStore((state) => state.expandNode)
  const expandAll = useNodeTreePanelStore((state) => state.expandAll)
  const collapseAll = useNodeTreePanelStore((state) => state.collapseAll)

  const { fullTree, visibleTree, allKeys, loadChildRoom, loadedRoomCount } = useNodeTree(tabId, expandedKeys)
  const { selectNode, setNodeTreeOrder } = useGraphContext()
  const nodesMap = useGraphStore((state) => state.nodesMap)
  const graphStoreApi = useGraphStoreApi()
  const reactFlow = useReactFlow()

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)

  const readOnly = isCanvasReadOnly(tabId)
  const total = useMemo(() => countTreeNodes(fullTree), [fullTree])
  const hits = useMemo(() => flattenTreeForSearch(fullTree, deferredQuery), [fullTree, deferredQuery])
  const searching = deferredQuery.trim().length > 0

  const handleToggle = useCallback((node: NodeTreeNode) => {
    if (node.hasChildRoom && !node.roomLoaded) {
      // 第一次展开「可进入房间」才读盘；只保证展开，不把已展开节点折叠回去。
      void loadChildRoom(node.childRoomPath)
      expandNode(roomPath, rootKey, node.key)
      return
    }
    toggleNode(roomPath, rootKey, node.key)
  }, [expandNode, loadChildRoom, roomPath, rootKey, toggleNode])

  const focusNode = useCallback((nodeId: string, targetRoomPath: string) => {
    // 子房间里的节点不在当前画布 store，点击只展示结构、不误跳转镜头。
    if (targetRoomPath !== roomPath) return
    const target = nodesMap.get(nodeId)
    if (!target) return
    const perfSpan = startCanvasSpan(graphStoreApi, {
      operation: CANVAS_OPERATIONS.locate,
      metric: PERFORMANCE_METRICS.canvasQuery,
      roomPath,
      module: 'nodeTreePanel',
      params: { trigger: 'node-tree', targetNodeId: nodeId },
    })
    selectNode(nodeId)
    const zoom = reactFlow.getZoom()
    reactFlow.setCenter(
      target.position.x + (target.width ?? 120) / 2,
      target.position.y + (target.height ?? 52) / 2,
      { zoom, duration: 300 },
    )
    perfSpan.end({ zoom: Number(zoom.toFixed(3)), animationMs: 300 })
  }, [nodesMap, reactFlow, roomPath, selectNode, graphStoreApi])

  const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>, node: NodeTreeNode) => {
    if (!node.sortable || readOnly) return
    event.dataTransfer.setData('text/plain', node.key)
    event.dataTransfer.effectAllowed = 'move'
    setDraggingKey(node.key)
  }, [readOnly])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>, siblings: readonly NodeTreeNode[], targetKey: string) => {
    event.preventDefault()
    const fromKey = event.dataTransfer.getData('text/plain') || draggingKey
    setDraggingKey(null)
    if (!fromKey || readOnly) return
    const updates = reorderSiblings(siblings, fromKey, targetKey)
    if (updates) void setNodeTreeOrder(updates)
  }, [draggingKey, readOnly, setNodeTreeOrder])

  const renderLevel = useCallback((siblings: readonly NodeTreeNode[], depth: number): ReactNode[] => {
    const rows: ReactNode[] = []
    for (const node of siblings) {
      const isExpanded = expandedKeys.has(node.key)
      const roomPending = node.hasChildRoom && !node.roomLoaded
      // 懒加载下 children 可能为空，箭头只认 hasChildren。
      const showChevron = node.hasChildren || roomPending
      rows.push(
        <div
          key={node.key}
          data-tm-node-tree-row=""
          data-tm-node-tree-key={node.key}
          data-tm-node-tree-id={node.id}
          data-tm-node-tree-origin={node.origin}
          data-tm-node-tree-sortable={node.sortable ? 'true' : 'false'}
          data-tm-node-tree-has-room={node.hasChildRoom ? 'true' : 'false'}
          data-tm-node-tree-room-loaded={node.roomLoaded ? 'true' : 'false'}
          data-tm-node-tree-has-children={node.hasChildren ? 'true' : 'false'}
          data-tm-node-tree-expanded={isExpanded ? 'true' : 'false'}
          data-tm-node-tree-lazy={node.hasChildren && !isExpanded ? 'true' : 'false'}
          data-tm-node-tree-depth={node.depth}
          draggable={node.sortable && !readOnly}
          onDragStart={(event) => handleDragStart(event, node)}
          onDragOver={(event) => { if (node.sortable && !readOnly) event.preventDefault() }}
          onDrop={(event) => handleDrop(event, siblings, node.key)}
          onDragEnd={() => setDraggingKey(null)}
          onClick={() => focusNode(node.id, node.roomPath)}
          style={{ paddingLeft: 8 + depth * 14 }}
          className={[
            'group flex min-h-[26px] cursor-pointer items-center gap-1 rounded-md pr-1.5 py-1 text-[12px]',
            'hover:bg-[var(--color-hover-bg)]',
            draggingKey === node.key ? 'opacity-50' : '',
            node.origin === 'room-root' ? 'font-medium' : '',
          ].filter(Boolean).join(' ')}
        >
          {showChevron ? (
            <button
              type="button"
              data-tm-node-tree-chevron=""
              title={roomPending ? '加载子房间' : (isExpanded ? '折叠' : '展开')}
              onClick={(event) => { event.stopPropagation(); handleToggle(node) }}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-[var(--color-hover-bg)]"
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          ) : <span className="h-4 w-4 shrink-0" />}
          {originIcon(node)}
          <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{node.label}</span>
          {node.sortable && !readOnly && (
            <GripVertical className="h-3 w-3 shrink-0 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100" />
          )}
          {originBadge(node)}
        </div>,
      )
      // 懒加载：只有展开节点的直接子节点才进入 DOM。
      if (isExpanded && node.children.length > 0) {
        rows.push(...renderLevel(node.children, depth + 1))
      }
    }
    return rows
  }, [draggingKey, expandedKeys, focusNode, handleDragStart, handleDrop, handleToggle, readOnly])

  const searchHits = useCallback((hit: NodeTreeSearchHit) => {
    focusNode(hit.id, hit.roomPath)
    setQuery('')
  }, [focusNode])

  return (
    <div
      data-tm-node-tree-panel=""
      data-tm-node-tree-collapsed="false"
      data-tm-node-tree-total={total}
      data-tm-node-tree-loaded-rooms={loadedRoomCount}
      data-tm-node-tree-room-path={roomPath}
      data-tm-node-tree-root-key={rootKey}
      data-tm-node-tree-expanded-count={expandedKeys.size}
      data-tm-node-tree-width={NODE_TREE_PANEL_WIDTH}
      data-tm-left-dock-panel={activePanelId}
      data-tm-left-dock-active-panel={activePanelId}
      style={{ width: NODE_TREE_PANEL_WIDTH }}
      className="absolute inset-y-0 left-0 z-30 flex flex-col border-r border-[var(--color-border-light)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--color-border-light)] px-3">
        {activePanelId === 'agent'
          ? <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
          : activePanelId === 'kbList'
            ? <Library className="h-4 w-4 text-[var(--color-accent)]" />
            : <ListTree className="h-4 w-4 text-[var(--color-accent)]" />}
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
          {activePanelId === 'agent' ? 'AI Agent' : activePanelId === 'kbList' ? '知识库列表' : '节点结构'}
        </span>
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {activePanelId === 'agent' ? '入口已预留' : activePanelId === 'kbList' ? '当前工作区' : `${total} 个节点`}
        </span>
        {activePanelId === 'tree' && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              data-tm-node-tree-expand-all=""
              title="展开全部（只影响列表，不改画布）"
              onClick={() => expandAll(roomPath, rootKey, allKeys)}
              className={TM_UI.iconButton}
            >
              <ChevronsUpDown className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
            </button>
            <button
              type="button"
              data-tm-node-tree-collapse-all=""
              title="收起全部（只保留房间第一层）"
              onClick={() => collapseAll(roomPath, rootKey)}
              className={TM_UI.iconButton}
            >
              <ChevronsDownUp className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
            </button>
          </div>
        )}
      </div>

      {activePanelId === 'tree' ? (
        <>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--color-border-light)] px-3">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
        <input
          data-tm-node-tree-search=""
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索节点"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
        />
        {query && (
          <button type="button" title="清空搜索" onClick={() => setQuery('')} className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--color-hover-bg)]">
            <X className="h-3 w-3 text-[var(--color-text-muted)]" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {searching ? (
          hits.length > 0
            ? hits.map((hit) => (
              <button
                key={hit.key}
                type="button"
                data-tm-node-tree-hit=""
                data-tm-node-tree-key={hit.key}
                onClick={() => searchHits(hit)}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-[var(--color-hover-bg)]"
              >
                <span className="w-full truncate text-[12px] text-[var(--color-text-primary)]">{hit.label}</span>
                <span className="w-full truncate text-[10px] text-[var(--color-text-muted)]">
                  {hit.path.join(' / ') || fullTree.label}
                </span>
              </button>
            ))
            : <div className="px-3 py-4 text-[11px] text-[var(--color-text-muted)]">没有匹配的节点</div>
        ) : (
          renderLevel([visibleTree], 0)
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center gap-1 border-t border-[var(--color-border-light)] px-3 text-[10px] text-[var(--color-text-muted)]">
        默认折叠 · 逐层展开 · 拖动调整同级顺序
      </div>
        </>
      ) : activePanelId === 'agent' ? (
        <AgentPlaceholder />
      ) : (
        <KnowledgeBaseListPanel tabId={tabId} />
      )}
    </div>
  )
}
