/**
 * 知识库总览（P3-B 最轻版）覆盖层。
 *
 * - 只读：只用 storage.readLayout / readRoomNodeSummaries 统计房间，绝不写盘；
 * - 懒加载：不构建房间内节点/边、不读文档正文；双击卡片才走 enterRoomInTab → loadRoomGraph；
 * - 房间层级连线只表达「父子房间」，不是聚合边（本刀刻意不做）；
 * - 关闭后底层画布的 viewport / 选中态 / LOD 全部原样保留。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlow, ReactFlowProvider, type Edge, type NodeMouseHandler } from '@xyflow/react'
import { Map, RefreshCw, X } from 'lucide-react'
import { useStorage } from '../../../../core/storage'
import { useGraphSession, useTabStore } from '../../../../stores/tabs/tabStore'
import { basenameRef } from '../../../../domain/graph/path-utils'
import {
  collectRoomOverviews,
  isSafeRoomPath,
  layoutRoomOverview,
  type RoomOverviewItem,
} from '../../../../domain/graph/roomOverview'
import { RoomSummaryCard, type RoomSummaryNode } from './RoomSummaryCard'
import { useRoomOverviewStore } from '../model/roomOverviewStore'

const NODE_TYPES = { roomSummary: RoomSummaryCard }

interface RoomOverviewProps {
  tabId: string
}

export default function RoomOverview({ tabId }: RoomOverviewProps) {
  const isOpen = useRoomOverviewStore((state) => state.isOpen)
  if (!isOpen) return null
  return <RoomOverviewInner tabId={tabId} />
}

function RoomOverviewInner({ tabId }: RoomOverviewProps) {
  const storage = useStorage()
  const close = useRoomOverviewStore((state) => state.close)
  // getGraphSession 每次派生新对象，必须走项目自带的 useGraphSession（useShallow），
  // 否则 React 19 会因 snapshot 不稳定把整个总览组件判定为无限重渲染。
  const session = useGraphSession(tabId)
  const kbPath = session.kbPath
  const rootName = basenameRef(kbPath) || session.roomName || '知识库'

  const [items, setItems] = useState<RoomOverviewItem[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const result = await collectRoomOverviews(storage, { path: kbPath, name: rootName })
        if (cancelled) return
        setItems(result.items)
        setTruncated(result.truncated)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [storage, kbPath, rootName, reloadKey])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  const layout = useMemo(() => layoutRoomOverview(items), [items])
  const nodes = useMemo<RoomSummaryNode[]>(() => layout.cards.map((card) => ({
    id: card.id,
    type: 'roomSummary',
    position: card.position,
    data: { item: card.item },
    draggable: false,
    selectable: false,
  })), [layout])
  const edges = useMemo<Edge[]>(() => layout.links.map((link) => ({
    id: link.id,
    source: link.source,
    target: link.target,
    type: 'smoothstep',
    style: { stroke: 'var(--color-border-primary)', strokeWidth: 1, strokeDasharray: '5 4' },
  })), [layout])

  const handleEnter: NodeMouseHandler<RoomSummaryNode> = useCallback((_, node) => {
    const item = items.find((candidate) => candidate.path === node.id)
    if (!item || !isSafeRoomPath(item.path)) return
    // 房间内容在这里才开始加载（懒加载）。
    useTabStore.getState().enterRoomInTab(tabId, {
      path: item.path,
      kbPath,
      name: item.name,
    })
    close()
  }, [items, tabId, kbPath, close])

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col bg-[var(--color-canvas-bg)]"
      data-tm-room-overview=""
      data-tm-room-overview-count={items.length}
      data-tm-room-overview-loading={loading}
      data-tm-room-overview-truncated={truncated}
      data-tm-room-overview-kb={kbPath}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border-light)] bg-[var(--color-background-primary)] px-4">
        <Map className="h-4 w-4 text-[var(--color-accent)]" />
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">知识库总览</span>
        <span className="text-[11px] text-[var(--color-text-secondary)]">
          {loading ? '正在读取房间索引…' : `${items.length} 个房间${truncated ? '（已达上限）' : ''}`}
        </span>
        <span className="ml-2 hidden text-[11px] text-[var(--color-text-muted)] sm:inline">
          双击卡片进入房间 · 按需加载
        </span>
        <button
          type="button"
          data-tm-room-overview-refresh=""
          title="重新读取房间索引"
          onClick={() => setReloadKey((key) => key + 1)}
          className="ml-auto flex items-center gap-1 rounded-md border border-[var(--color-border-light)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)]"
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
        <button
          type="button"
          data-tm-room-overview-close=""
          title="返回画布（Esc）"
          onClick={close}
          className="flex items-center gap-1 rounded-md border border-[var(--color-border-light)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-bg)]"
        >
          <X className="h-3 w-3" />
          返回
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* App 根已经包了一层 ReactFlowProvider；总览必须再包独立的一层，
            否则会复用底层画布的 store，画出来的是当前房间节点而不是房间摘要。 */}
        <ReactFlowProvider>
          <ReactFlow
            key={`${reloadKey}:${loading ? 'loading' : items.length}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodeDoubleClick={handleEnter}
            nodesDraggable={false}
            nodesConnectable={false}
            zoomOnDoubleClick={false}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          />
        </ReactFlowProvider>
        {error && (
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-md border border-[var(--color-border-light)] bg-[var(--color-background-primary)] px-3 py-2 text-[12px] text-[var(--color-danger)]">
            读取房间失败：{error}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[12px] text-[var(--color-text-secondary)]">
            该知识库还没有可读的房间
          </div>
        )}
      </div>
    </div>
  )
}
