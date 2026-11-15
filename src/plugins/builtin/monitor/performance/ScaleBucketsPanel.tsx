/**
 * 画布规模分析：按节点数分桶看 P95，并按 operation 找「随规模劣化」的动作。
 * 纯展示组件，数据由 statistics 纯函数算好后传入。
 */
import { formatDuration } from '@/shared/observability/performanceMetrics'
import type {
  OperationStatistics,
  ScaleBucketStatistics,
} from '@/shared/observability/performanceStatistics'

const HEAD = 'px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-text-muted)] whitespace-nowrap'
const CELL = 'px-3 py-2 text-[12px]'

interface ScaleBucketsPanelProps {
  buckets: ScaleBucketStatistics[]
  operations: OperationStatistics[]
}

export function ScaleBucketsPanel({ buckets, operations }: ScaleBucketsPanelProps) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div>
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">画布规模分析</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            按节点数分桶看 P95；跨桶涨幅大的操作就是随规模劣化的瓶颈
          </div>
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)]">{total} 条带规模的样本</div>
      </div>

      <div className="grid gap-2 px-4 py-3 sm:grid-cols-3 xl:grid-cols-5">
        {buckets.map((bucket) => (
          <div
            key={bucket.bucket}
            className="rounded-lg px-3 py-2"
            style={{ background: 'var(--color-bg-muted)' }}
          >
            <div className="text-[11px] text-[var(--color-text-muted)]">{bucket.label}</div>
            <div className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">
              {formatDuration(bucket.p95Ms)}
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
              {bucket.count} 样本 · 慢 {bucket.slowRate.toFixed(0)}%
            </div>
            <div className="text-[11px] text-[var(--color-text-muted)]">
              每节点 {formatDuration(bucket.avgPerUnitMs)}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto border-t border-[var(--color-border-subtle)]">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="bg-[var(--color-bg-muted)]">
              <th className={HEAD}>画布动作</th>
              <th className={`${HEAD} text-right`}>样本</th>
              <th className={`${HEAD} text-right`}>P50</th>
              <th className={`${HEAD} text-right`}>P95</th>
              <th className={`${HEAD} text-right`}>每节点成本</th>
              <th className={`${HEAD} text-right`}>慢 / 失败</th>
              <th className={HEAD}>规模敏感</th>
            </tr>
          </thead>
          <tbody>
            {operations.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-[12px] text-[var(--color-text-muted)]">
                  暂无带 operation 的画布样本
                </td>
              </tr>
            ) : operations.map((item) => (
              <tr key={item.operation} className="border-t border-[var(--color-border-subtle)]">
                <td className={`${CELL} font-medium text-[var(--color-text-primary)]`}>{item.label}</td>
                <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>{item.count}</td>
                <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>{formatDuration(item.p50Ms)}</td>
                <td className={`${CELL} text-right font-semibold text-[var(--color-text-primary)]`}>{formatDuration(item.p95Ms)}</td>
                <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>{formatDuration(item.avgPerUnitMs)}</td>
                <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>
                  {item.slowCount} / {item.failCount}
                </td>
                <td className={CELL}>
                  {item.scaleSensitive ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px]"
                      style={{
                        color: 'var(--color-warning)',
                        background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
                      }}
                    >
                      随规模劣化
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--color-text-muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
