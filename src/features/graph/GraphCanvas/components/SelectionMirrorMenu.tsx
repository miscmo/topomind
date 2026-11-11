/**
 * 多选后的上方操作菜单（Panel top-center）。
 *
 * 只有「选中 >= 2 个节点 + 画布可写（100% 且无隐藏节点）」时才出现，
 * 由 GraphCanvas 控制挂载；缩小进入只读后自动收起，恢复 100% 且选中态还在就回来。
 * 菜单本身不读写 store：翻转走 useGraph 的统一写闸门，几何规则全在
 * domain/graph/mirrorSelection.ts（纯函数）。
 *
 * 刻意不做「忙碌禁用」：翻转每次都从最新 store 现算，连点两次就是来回切换
 * 左右布局；若等异步保存结束才解禁，连点第二下会被静默吞掉。
 */
import { Panel } from '@xyflow/react'
import { ArrowLeftRight } from 'lucide-react'

export interface SelectionMirrorMenuProps {
  selectedCount: number
  onFlip: () => Promise<boolean>
}

export default function SelectionMirrorMenu({ selectedCount, onFlip }: SelectionMirrorMenuProps) {
  return (
    <Panel position="top-center" className="!m-3">
      <div
        data-tm-selection-mirror-menu=""
        data-tm-selection-mirror-count={selectedCount}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--color-text)] shadow-[var(--shadow-popover)]"
      >
        <span className="text-[12px] font-medium whitespace-nowrap">
          已选 {selectedCount} 个节点
        </span>
        <span className="h-3.5 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
        <button
          type="button"
          data-tm-selection-mirror-flip=""
          aria-label="水平镜像翻转"
          title="沿选区中轴左右翻转，节点位置、连线锚点与曲线方向同步镜像"
          onClick={() => { void onFlip() }}
          className="nodrag nowheel pointer-events-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="whitespace-nowrap">水平镜像翻转</span>
        </button>
      </div>
    </Panel>
  )
}
