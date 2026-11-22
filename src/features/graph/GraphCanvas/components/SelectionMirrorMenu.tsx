/**
 * 选中节点后的上方操作菜单（Panel top-center，文件名沿用历史回归脚本的读取路径）。
 *
 * 【2026-11-11】原先只有「水平镜像」且要求 >=2 个节点；现在选中 1 个节点也出现，
 * 增加「选中子树」（以选中节点为根沿从属边向下全选）。两者都是选中态上的批量操作：
 *   - 镜像是写操作，只在 >=2 且画布可写时渲染（内部 mirror 区仍带旧诊断属性，
 *     缩小进入只读后整块菜单收起，不与只读提示条抢占 top-center）；
 *   - 选中子树只改 selected 运行时字段，规则全在 domain/graph/selectSubtree.ts。
 *
 * 菜单本身不读写 store：动作由 useGraph 注入，几何 / 树规则都在纯函数层。
 * 刻意不做「忙碌禁用」：镜像连点两次就是来回切换左右布局，禁用会吞掉第二次点击。
 */
import { Panel } from '@xyflow/react'
import { ArrowLeftRight, ListTree } from 'lucide-react'

export interface SelectionMirrorMenuProps {
  selectedCount: number
  /** store 派生的真实选中 id 列表，供 GUI 精确断言（含被视口裁剪的节点） */
  selectedIds: readonly string[]
  /** >=2 且画布可写时才显示镜像区 */
  canMirror: boolean
  onSelectSubtree: () => void
  onFlip: () => Promise<boolean>
}

export default function SelectionMirrorMenu({
  selectedCount,
  selectedIds,
  canMirror,
  onSelectSubtree,
  onFlip,
}: SelectionMirrorMenuProps) {
  return (
    <Panel position="top-center" className="!m-3 tm-fade-enter">
      <div
        data-tm-selection-menu=""
        data-tm-selection-count={selectedCount}
        data-tm-selection-ids={selectedIds.join('|')}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--color-text)] shadow-[var(--shadow-popover)]"
      >
        <span className="text-[12px] font-medium whitespace-nowrap">
          已选 {selectedCount} 个节点
        </span>
        <span className="h-3.5 w-px shrink-0 bg-[var(--color-border-light)]" aria-hidden="true" />
        <button
          type="button"
          data-tm-selection-subtree=""
          aria-label="选中子树"
          title="以选中节点为根，沿从属关系选中整棵子树"
          onClick={onSelectSubtree}
          className="nodrag nowheel pointer-events-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
        >
          <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="whitespace-nowrap">选中子树</span>
        </button>
        {canMirror && (
          <div
            data-tm-selection-mirror-menu=""
            data-tm-selection-mirror-count={selectedCount}
            className="flex items-center gap-2"
          >
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
        )}
      </div>
    </Panel>
  )
}
