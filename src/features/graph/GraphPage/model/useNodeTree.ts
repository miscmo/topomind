/**
 * 左侧节点树的数据源：当前房间直接订阅 graphStore（增删改自动同步）。
 * fullTree 用于搜索 / 计数 / 展开全部（纯内存）；visibleTree 按展开集合懒加载，
 * 折叠分支不构造子树。子房间只有点开箭头时才按需读一次
 * _graph.json + 子节点摘要，未展开的房间一行 IO 都不发。
 *
 * 不新增 IPC 通道：复用 storage.readLayout / readRoomNodeSummaries。
 * 只读房间 meta，绝不读文档正文，也不写盘。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStorage } from '../../../../core/storage'
import { useGraphStore, useGraphStoreApi } from '../../../../stores/graphStore'
import { CANVAS_OPERATIONS, PERFORMANCE_METRICS } from '../../../../shared/observability/performanceContract'
import { startCanvasSpan } from '../../../../hooks/useGraph/canvasPerformanceContext'
import { useGraphSession } from '../../../../stores/tabs/tabStore'
import { basenameRef, resolveRoomChildRef } from '../../../../domain/graph/path-utils'
import {
  buildNodeTree,
  collectNodeTreeKeys,
  toNodeTreeRoom,
  type NodeTreeRoom,
  type NodeTreeNode,
} from '../../../../domain/graph/nodeTree'

export interface UseNodeTreeResult {
  /** 完整树：搜索 / 节点计数 / 「展开全部」用，永远构建全部节点（纯内存，无 IO）。 */
  fullTree: NodeTreeNode
  /** 懒加载树：只有展开集合里的节点才构造直接子节点，供列表渲染。 */
  visibleTree: NodeTreeNode
  allKeys: string[]
  roomPath: string
  roomName: string
  loadChildRoom: (roomPath: string) => Promise<void>
  /** 已加载的子房间数（GUI / 静态诊断用） */
  loadedRoomCount: number
}

export function useNodeTree(tabId: string, expandedKeys: ReadonlySet<string>): UseNodeTreeResult {
  const nodes = useGraphStore((state) => state.nodes)
  const edges = useGraphStore((state) => state.edges)
  const graphStoreApi = useGraphStoreApi()
  const session = useGraphSession(tabId)
  const storage = useStorage()

  const roomPath = session?.roomPath ?? ''
  const kbPath = session?.kbPath ?? ''
  const roomName = session?.roomName || basenameRef(kbPath) || '当前房间'

  const [rooms, setRooms] = useState<Record<string, NodeTreeRoom>>({})
  const inflight = useRef<Set<string>>(new Set())

  // 换房间 / 换标签页时丢弃旧房间快照，避免把别的房间结构挂到新树上。
  useEffect(() => {
    setRooms({})
  }, [roomPath, tabId])

  const rootRoom = useMemo(() => toNodeTreeRoom({
    roomPath,
    roomName,
    nodes: nodes.map((node) => ({
      id: node.id,
      label: String(node.data?.label ?? node.id),
      treeOrder: node.data?.treeOrder,
      childCount: node.data?.childCount,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.data?.relation,
      weight: edge.data?.weight,
    })),
  }), [nodes, edges, roomPath, roomName])

  // 完整树只用于搜索 / 计数 / 展开全部，纯内存构建，不触发任何房间 IO。
  const fullTree = useMemo(() => buildNodeTree({
    root: rootRoom,
    rooms,
    resolveChildRoomPath: resolveRoomChildRef,
  }), [rootRoom, rooms])

  // 懒加载树：折叠分支连子树对象都不构造，列表只渲染展开路径上的节点。
  const visibleTree = useMemo(() => buildNodeTree({
    root: rootRoom,
    rooms,
    resolveChildRoomPath: resolveRoomChildRef,
    expandedKeys,
  }), [rootRoom, rooms, expandedKeys])

  const allKeys = useMemo(() => collectNodeTreeKeys(fullTree), [fullTree])

  const loadChildRoom = useCallback(async (targetRoomPath: string) => {
    if (!targetRoomPath || rooms[targetRoomPath] || inflight.current.has(targetRoomPath)) return
    inflight.current.add(targetRoomPath)
    const perfSpan = startCanvasSpan(graphStoreApi, {
      operation: CANVAS_OPERATIONS.treeExpand,
      metric: PERFORMANCE_METRICS.canvasQuery,
      roomPath: targetRoomPath,
      module: 'nodeTree',
      params: { trigger: 'expand-child-room' },
    })
    try {
      const meta = await storage.readLayout(targetRoomPath)
      const nodeIds = Object.keys(meta.nodes ?? {})
      const childPaths = nodeIds.map((id) => resolveRoomChildRef(targetRoomPath, id))
      // 更深层是否还有可进入房间，需要目录级摘要；只在真正展开时读一次。
      const summaries = childPaths.length > 0
        ? await storage.readRoomNodeSummaries(childPaths)
        : {}
      const snapshot = toNodeTreeRoom({
        roomPath: targetRoomPath,
        roomName: basenameRef(targetRoomPath) || targetRoomPath,
        nodes: nodeIds.map((id) => ({
          id,
          label: meta.nodes[id]?.card?.name || id,
          treeOrder: meta.nodes[id]?.treeOrder,
          childCount: summaries[resolveRoomChildRef(targetRoomPath, id)]?.childCount ?? 0,
        })),
        edges: (meta.edges ?? []).map((edge) => ({
          id: edge.id,
          source: edge.source.ref,
          target: edge.target.ref,
          relation: edge.relation,
          weight: edge.weight,
        })),
      })
      setRooms((previous) => (
        previous[targetRoomPath] ? previous : { ...previous, [targetRoomPath]: snapshot }
      ))
      perfSpan.end({ childCount: nodeIds.length, summaryCount: Object.keys(summaries).length })
    } catch (error) {
      // 读不到（目录不存在 / 权限 / 旧档）就保持折叠，不打断画布使用。
      perfSpan.fail(error)
    } finally {
      inflight.current.delete(targetRoomPath)
    }
  }, [storage, rooms, graphStoreApi])

  return {
    fullTree,
    visibleTree,
    allKeys,
    roomPath,
    roomName,
    loadChildRoom,
    loadedRoomCount: Object.keys(rooms).length,
  }
}
