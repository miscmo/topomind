/**
 * 规模阈值标定：把「动态阈值放宽得是否合适」直接摆到监控页。
 * 纯展示组件，判定与建议倍数全部来自 statistics 的纯函数，页面不重复口径。
 * 数据基于当前日志日期的全部样本，不受筛选影响。
 */
import { formatDuration } from '@/shared/observability/performanceMetrics'
import {
  CALIBRATION_VERDICT_LABELS,
  type CalibrationSummary,
  type CalibrationVerdict,
  type ScaleCalibrationRow,
} from '@/shared/observability/performanceStatistics'

const HEAD = 'px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-text-muted)] whitespace-nowrap sticky top-0 bg-[var(--color-bg-muted)]'
const CELL = 'px-3 py-2 text-[12px]'

const VERDICT_COLOR: Record<CalibrationVerdict, string> = {
  too_tight: 'var(--color-danger)',
  too_loose: 'var(--color-warning)',
  healthy: 'var(--color-success)',
  insufficient: 'var(--color-text-muted)',
}

interface ScaleCalibrationPanelProps {
  rows: ScaleCalibrationRow[]
  summary: CalibrationSummary
}

export function ScaleCalibrationPanel({ rows, summary }: ScaleCalibrationPanelProps) {
  const summaryItems: Array<{ verdict: CalibrationVerdict; count: number }> = [
    { verdict: 'too_tight', count: summary.tooTight },
    { verdict: 'too_loose', count: summary.tooLoose },
    { verdict: 'healthy', count: summary.healthy },
    { verdict: 'insufficient', count: summary.insufficient },
  ]

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div>
          <div className="text-[14px] font-semibold text-[var(--color-text-primary)]">规模阈值标定</div>
          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            按「动作 × 节点规模桶」对比生效阈值与真实 P95：过紧会全标红，过松会漏掉慢操作
          </div>
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)]">
          {summary.totalRows} 个分组 · 覆盖 {summary.sampleCount} 条样本（不受筛选影响）
        </div>
      </div>

      <div className="grid gap-2 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryItems.map(({ verdict, count }) => {
          const color = VERDICT_COLOR[verdict]
          return (
            <div
              key={verdict}
              className="rounded-lg px-3 py-2"
              style={{ background: `color-mix(in srgb, ${color} 10%, var(--color-surface))` }}
            >
              <div className="text-[11px]" style={{ color }}>{CALIBRATION_VERDICT_LABELS[verdict]}</div>
              <div className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">{count}</div>
              <div className="text-[11px] text-[var(--color-text-muted)]">个动作 × 规模桶</div>
            </div>
          )
        })}
      </div>

      {summary.worst && (
        <div
          className="mx-4 mb-3 rounded-lg px-3 py-2 text-[12px]"
          style={{
            borderColor: 'var(--color-danger)',
            color: 'var(--color-danger)',
            background: 'color-mix(in srgb, var(--color-danger) 8%, var(--color-surface))',
          }}
        >
          优先调参：{summary.worst.label} / {summary.worst.bucketLabel} 慢率 {summary.worst.slowRate}%，
          建议把放宽倍数从 ×{summary.worst.appliedFactor} 调到约 ×{summary.worst.suggestedFactor}。
        </div>
      )}

      <div className="max-h-[320px] overflow-auto border-t border-[var(--color-border-subtle)]">
        <table className="w-full min-w-[880px] border-collapse">
          <thead>
            <tr className="bg-[var(--color-bg-muted)]">
              <th className={HEAD}>画布动作</th>
              <th className={HEAD}>规模桶</th>
              <th className={`${HEAD} text-right`}>样本 / 成功</th>
              <th className={`${HEAD} text-right`}>P50</th>
              <th className={`${HEAD} text-right`}>P95</th>
              <th className={`${HEAD} text-right`}>基础阈值</th>
              <th className={`${HEAD} text-right`}>生效阈值</th>
              <th className={`${HEAD} text-right`}>实际倍数</th>
              <th className={`${HEAD} text-right`}>慢率</th>
              <th className={HEAD}>判定</th>
              <th className={`${HEAD} text-right`}>建议倍数</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-[12px] text-[var(--color-text-muted)]">
                  暂无带 operation 与节点规模的样本，无法评估阈值标定
                </td>
              </tr>
            ) : rows.map((row) => {
              const color = VERDICT_COLOR[row.verdict]
              return (
                <tr key={`${row.operation}|${row.bucket}`} className="border-t border-[var(--color-border-subtle)]">
                  <td className={`${CELL} font-medium text-[var(--color-text-primary)]`}>{row.label}</td>
                  <td className={`${CELL} text-[var(--color-text-secondary)]`}>{row.bucketLabel}</td>
                  <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>
                    {row.count} / {row.successCount}
                  </td>
                  <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>{formatDuration(row.p50Ms)}</td>
                  <td className={`${CELL} text-right font-semibold text-[var(--color-text-primary)]`}>{formatDuration(row.p95Ms)}</td>
                  <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>{formatDuration(row.baseThresholdMs)}</td>
                  <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>{formatDuration(row.effectiveThresholdMs)}</td>
                  <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>×{row.appliedFactor}</td>
                  <td className={`${CELL} text-right text-[var(--color-text-secondary)]`}>{row.slowRate.toFixed(0)}%</td>
                  <td className={CELL}>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px]"
                      style={{
                        color,
                        background: `color-mix(in srgb, ${color} 12%, transparent)`,
                      }}
                    >
                      {CALIBRATION_VERDICT_LABELS[row.verdict]}
                    </span>
                  </td>
                  <td className={`${CELL} text-right font-medium`} style={{ color }}>
                    ×{row.suggestedFactor}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-[var(--color-border-subtle)] px-4 py-2 text-[11px] text-[var(--color-text-muted)]">
        建议倍数只作调参参考，不会自动改契约；失败样本不进 P95 与慢率分母。也可导出样本后运行 npm run perf:calibrate -- --input &lt;文件&gt; 生成完整报告。
      </div>
    </div>
  )
}
