import { memo } from 'react'
import { Layers, FileText } from 'lucide-react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { RoomOverviewItem } from '../../../../domain/graph/roomOverview'

export type RoomSummaryNode = Node<{ item: RoomOverviewItem }, 'roomSummary'>

/**
 * 房间摘要卡片：只展示只读统计，双击交给 RoomOverview 走 enterRoomInTab。
 * nodrag 是必须的，否则 React Flow 会把点击吃掉。
 */
export const RoomSummaryCard = memo(function RoomSummaryCard({ data }: NodeProps<RoomSummaryNode>) {
  const { item } = data
  return (
    <div
      className="nodrag nowheel relative flex h-[92px] w-[208px] flex-col justify-between rounded-xl border border-[var(--color-border-light)] bg-[var(--color-background-primary)] px-3 py-2 shadow-sm"
      data-tm-room-summary-card={item.path}
      data-tm-room-summary-depth={item.depth}
      data-tm-room-summary-node-count={item.nodeCount}
      data-tm-room-summary-status={item.status}
      title={`${item.name}\n双击进入房间`}
    >
      {/* ReactFlow 必须靠 Handle 计算父子层级边端点；这里只借位，不显示、不可拖。 */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none', width: 6, height: 6 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none', width: 6, height: 6 }} />
      <div className="flex items-start gap-2">
        <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]">
          {item.name}
        </span>
        <span className="shrink-0 rounded bg-[var(--color-hover-bg)] px-1 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
          L{item.depth}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
        {item.status === 'unavailable' ? (
          <span>读取失败 · 双击仍可进入</span>
        ) : (
          <>
            <span>{item.nodeCount} 节点</span>
            <span>·</span>
            <span>{item.edgeCount} 边</span>
            <span>·</span>
            <span>{item.childRoomCount} 子房间</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
        <FileText className="h-3 w-3" />
        <span className="truncate">{item.path}</span>
      </div>
    </div>
  )
})
