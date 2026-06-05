import { memo, useMemo } from 'react'
import type {
  LearningDailyRecord as DailyRecord,
  LearningSessionSnapshot as LearningSession,
} from '../../public'
import type {
  ContextAnalytics,
  ContextDistributionItem,
  GoalAnalytics,
  RangeAnalytics,
} from './analytics.ts'
import {
  WEEKDAY_LABELS,
  buildDayHourBuckets,
  formatDuration,
  formatDurationCompact,
  formatFullDateLabel,
  formatHourLabel,
  formatTime,
  getDateStr,
} from './analytics.ts'

interface LearningDetailPanelProps {
  selectedDate: string | null
  selectedDayData: DailyRecord | null
  selectedDayDuration: number
  currentSessionId: string | null
  isActive: boolean
  analytics: RangeAnalytics
  goalAnalytics: GoalAnalytics
  contextAnalytics: ContextAnalytics
  dailyGoal: number
  rangeLabel: string
  selectedDayContextAnalytics: ContextAnalytics
  hasContextFilter: boolean
  contextFilterLabel: string
  onBackToSummary: () => void
}

const DetailMetricCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
    <div className="text-[12px] text-[var(--color-text-muted)]">{label}</div>
    <div className="mt-2 text-[18px] font-semibold text-[var(--color-primary)]">{value}</div>
    {hint ? <div className="mt-2 text-[12px] text-[var(--color-text-muted)]">{hint}</div> : null}
  </div>
)

const ContextDistributionCard = ({
  title,
  items,
  trackedDuration,
  totalDuration,
  emptyText,
}: {
  title: string
  items: ContextDistributionItem[]
  trackedDuration: number
  totalDuration: number
  emptyText: string
}) => {
  const displayItems = items.slice(0, 5)
  const coverage = totalDuration > 0 ? Math.round((trackedDuration / totalDuration) * 100) : 0
  const maxDuration = Math.max(...displayItems.map(item => item.duration), 1)

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] font-medium text-[var(--color-text-primary)]">{title}</div>
        <div className="text-[11px] text-[var(--color-text-muted)]">
          {trackedDuration > 0 ? `${coverage}% 覆盖` : '暂无'}
        </div>
      </div>
      {displayItems.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3">
          {displayItems.map(item => (
            <div key={`${title}-${item.key}`} className="grid grid-cols-[minmax(0,1fr)_52px] items-center gap-3">
              <div className="min-w-0">
                <div className="truncate text-[12px] text-[var(--color-text-primary)]" title={item.key}>
                  {item.label}
                </div>
                <div className="mt-2 h-2 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--color-primary)]"
                    style={{ width: `${Math.max(item.duration > 0 ? 8 : 0, Math.round((item.duration / maxDuration) * 100))}%` }}
                  />
                </div>
              </div>
              <div className="text-right text-[12px] font-medium text-[var(--color-text-primary)]">
                {formatDurationCompact(item.duration)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] px-3 py-4 text-[12px] text-[var(--color-text-muted)]">
          {emptyText}
        </div>
      )}
    </div>
  )
}

export const LearningDetailPanel = memo(function LearningDetailPanel({
  selectedDate,
  selectedDayData,
  selectedDayDuration,
  currentSessionId,
  isActive,
  analytics,
  goalAnalytics,
  contextAnalytics,
  dailyGoal,
  rangeLabel,
  selectedDayContextAnalytics,
  hasContextFilter,
  contextFilterLabel,
  onBackToSummary,
}: LearningDetailPanelProps) {
  const todayStr = getDateStr(new Date())
  const dayHourBuckets = useMemo(
    () => buildDayHourBuckets(selectedDayData?.sessions || []),
    [selectedDayData],
  )
  const maxDayHourDuration = Math.max(...dayHourBuckets, 1)
  const selectedSessionCount = selectedDayData?.sessions.length || 0
  const dayGoalReached = selectedDayDuration >= dailyGoal
  const rangeGoalRate = Math.round(goalAnalytics.rangeGoalRate * 100)
  const last7GoalRate = Math.round(goalAnalytics.last7GoalRate * 100)
  const currentWeekGoalRate = Math.round(goalAnalytics.currentWeekCompletionRate * 100)

  if (!selectedDate) {
    const goalRate = rangeLabel === '7天'
      ? `${analytics.goalDays} / 7 天`
      : rangeLabel === '30天'
        ? `${analytics.goalDays} / 30 天`
        : `${analytics.goalDays} / 90 天`

    return (
      <div className="flex flex-col gap-5">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">Range Summary</div>
          <h2 className="mt-2 text-[28px] leading-none font-semibold">当前范围汇总</h2>
          <p className="mt-3 text-[13px] leading-6 text-[var(--color-text-muted)]">
            {hasContextFilter
              ? <>当前显示 {rangeLabel} 内 <span className="text-[var(--color-text-primary)]">{contextFilterLabel}</span> 的统计结果。点击左侧热力图中的某一天后，这里会切换为筛选后的当天明细。</>
              : <>当前显示 {rangeLabel} 的统计结果。点击左侧热力图中的某一天后，这里会切换为当天的 session 明细和时段分布。</>}
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <DetailMetricCard label="范围总时长" value={formatDuration(analytics.totalDuration)} />
          <DetailMetricCard label="活跃天数" value={`${analytics.activeDays} 天`} />
          <DetailMetricCard label="平均每日时长" value={formatDuration(analytics.averageDailyDuration)} />
          <DetailMetricCard label="Session 总数" value={`${analytics.sessionCount} 次`} />
          <DetailMetricCard label="平均单次 Session" value={formatDuration(analytics.averageSessionDuration)} />
          <DetailMetricCard label="最长单次 Session" value={formatDuration(analytics.longestSessionDuration)} />
        </section>

        <section className="grid grid-cols-3 gap-3">
          <DetailMetricCard
            label="高频学习时段"
            value={formatHourLabel(analytics.peakHour)}
            hint="按 session 实际覆盖时间段汇总"
          />
          <DetailMetricCard
            label="最活跃星期"
            value={analytics.topWeekday === null ? '暂无' : `周${WEEKDAY_LABELS[analytics.topWeekday]}`}
            hint="按当前范围总时长统计"
          />
          <DetailMetricCard
            label="目标完成情况"
            value={goalRate}
            hint={`日目标 ${formatDurationCompact(dailyGoal)}`}
          />
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[16px] font-semibold">目标完成情况</div>
              <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                从当前范围、最近 7 天和本周三个层面观察目标达成质量
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[var(--color-text-muted)]">日目标</div>
              <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)]">
                {formatDurationCompact(dailyGoal)}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-3">
            <DetailMetricCard
              label="当前范围达标率"
              value={`${rangeGoalRate}%`}
              hint={`${goalAnalytics.rangeGoalDays} / ${rangeLabel} 达标`}
            />
            <DetailMetricCard
              label="最近 7 天达标率"
              value={`${last7GoalRate}%`}
              hint={`${goalAnalytics.last7GoalDays} / 7 天达标`}
            />
            <DetailMetricCard
              label="本周目标进度"
              value={`${currentWeekGoalRate}%`}
              hint={`${goalAnalytics.currentWeekGoalDays} / 7 天达标`}
            />
            <DetailMetricCard
              label="本周剩余目标"
              value={formatDuration(Math.max(0, goalAnalytics.currentWeekGoalDuration - goalAnalytics.currentWeekDuration))}
              hint={`周目标 ${formatDurationCompact(goalAnalytics.currentWeekGoalDuration)}`}
            />
          </div>

          <div className="mt-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] font-medium text-[var(--color-text-primary)]">本周累计进度条</div>
              <div className="text-[12px] text-[var(--color-text-muted)]">
                {formatDurationCompact(goalAnalytics.currentWeekDuration)} / {formatDurationCompact(goalAnalytics.currentWeekGoalDuration)}
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--color-primary)]"
                style={{ width: `${Math.min(100, Math.max(0, currentWeekGoalRate))}%` }}
              />
            </div>
            <div className="mt-3 text-[12px] leading-6 text-[var(--color-text-muted)]">
              本周已过去 <span className="text-[var(--color-text-primary)]">{goalAnalytics.currentWeekElapsedDays}</span> 天，
              目标基准为 <span className="text-[var(--color-text-primary)]">{formatDurationCompact(goalAnalytics.currentWeekExpectedDuration)}</span>。
              {goalAnalytics.currentWeekPaceDelta >= 0 ? ' 当前进度领先 ' : ' 当前进度落后 '}
              <span className="text-[var(--color-text-primary)]">{formatDurationCompact(Math.abs(goalAnalytics.currentWeekPaceDelta))}</span>。
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[16px] font-semibold">上下文分布</div>
              <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                {hasContextFilter
                  ? `按当前范围统计 ${contextFilterLabel} 内的页面、知识库和文档分布`
                  : '按当前范围统计页面活跃分布、知识库分布和文档分布'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[var(--color-text-muted)]">上下文覆盖</div>
              <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)]">
                {contextAnalytics.totalSessions > 0 ? `${contextAnalytics.sessionsWithContext} / ${contextAnalytics.totalSessions} 次` : '暂无'}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <ContextDistributionCard
              title="页面活跃分布"
              items={contextAnalytics.pageTypeDistribution}
              trackedDuration={contextAnalytics.totalSessionDuration}
              totalDuration={contextAnalytics.totalSessionDuration}
              emptyText="当前范围还没有页面上下文记录。"
            />
            <ContextDistributionCard
              title="知识库分布"
              items={contextAnalytics.kbDistribution}
              trackedDuration={contextAnalytics.kbTrackedDuration}
              totalDuration={contextAnalytics.totalSessionDuration}
              emptyText="当前范围还没有可统计的知识库上下文。"
            />
            <ContextDistributionCard
              title="文档分布"
              items={contextAnalytics.documentDistribution}
              trackedDuration={contextAnalytics.documentTrackedDuration}
              totalDuration={contextAnalytics.totalSessionDuration}
              emptyText="当前范围还没有文档级学习记录。"
            />
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="text-[16px] font-semibold">范围观察</div>
          <div className="mt-4 grid grid-cols-1 gap-3">
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4 text-[13px] leading-6 text-[var(--color-text-muted)]">
              当前范围内共记录 <span className="text-[var(--color-text-primary)]">{analytics.sessionCount}</span> 次学习，
              平均每次约 <span className="text-[var(--color-text-primary)]">{formatDurationCompact(analytics.averageSessionDuration)}</span>，
              说明最近的学习节奏已经具备基础观察条件。
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4 text-[13px] leading-6 text-[var(--color-text-muted)]">
              高频时段集中在 <span className="text-[var(--color-text-primary)]">{formatHourLabel(analytics.peakHour)}</span>，
              当前范围达标 <span className="text-[var(--color-text-primary)]">{goalAnalytics.rangeGoalDays}</span> 天，
              本周已累计 <span className="text-[var(--color-text-primary)]">{formatDurationCompact(goalAnalytics.currentWeekDuration)}</span>，
              页面上下文已覆盖 <span className="text-[var(--color-text-primary)]">{contextAnalytics.sessionsWithContext}</span> 次 session。
            </div>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">Day Detail</div>
            <h2 className="mt-2 text-[28px] leading-none font-semibold">{formatFullDateLabel(selectedDate)}</h2>
            <p className="mt-3 text-[13px] leading-6 text-[var(--color-text-muted)]">
              {hasContextFilter
                ? <>当前仅展示 <span className="text-[var(--color-text-primary)]">{contextFilterLabel}</span> 的 session、总时长和时段分布。</>
                : '查看当天总时长、session 时间轴以及时段分布。再次点击左侧同一天，或使用右上角按钮，可返回范围汇总态。'}
            </p>
          </div>
          <button
            type="button"
            onClick={onBackToSummary}
            className="h-9 px-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[13px] hover:bg-[var(--color-hover-bg)]"
          >
            返回汇总
          </button>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <DetailMetricCard label="当天总时长" value={formatDuration(selectedDayDuration)} />
        <DetailMetricCard label="Session 数量" value={`${selectedSessionCount} 次`} />
        <DetailMetricCard
          label="目标完成"
          value={dayGoalReached ? '已达标' : '未达标'}
          hint={`日目标 ${formatDurationCompact(dailyGoal)}`}
        />
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold">当日目标观察</div>
            <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              结合日目标查看当天达标状态和剩余差距
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-[var(--color-text-muted)]">完成比例</div>
            <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)]">
              {Math.round((selectedDayDuration / Math.max(dailyGoal, 1)) * 100)}%
            </div>
          </div>
        </div>

        <div className="mt-4 h-2 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--color-primary)]"
            style={{ width: `${Math.min(100, Math.max(0, Math.round((selectedDayDuration / Math.max(dailyGoal, 1)) * 100)))}%` }}
          />
        </div>
        <div className="mt-3 text-[12px] leading-6 text-[var(--color-text-muted)]">
          {dayGoalReached
            ? <>这一天已达到目标，超过基准 <span className="text-[var(--color-text-primary)]">{formatDurationCompact(selectedDayDuration - dailyGoal)}</span>。</>
            : <>这一天距离目标还差 <span className="text-[var(--color-text-primary)]">{formatDurationCompact(Math.max(0, dailyGoal - selectedDayDuration))}</span>。</>}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold">当日上下文分布</div>
            <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                {hasContextFilter
                  ? `查看这一天在 ${contextFilterLabel} 内的页面、知识库和文档分布`
                  : '查看这一天的页面活跃重心、知识库分布和文档分布'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-[var(--color-text-muted)]">上下文覆盖</div>
            <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)]">
              {selectedDayContextAnalytics.totalSessions > 0 ? `${selectedDayContextAnalytics.sessionsWithContext} / ${selectedDayContextAnalytics.totalSessions} 次` : '暂无'}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4">
          <ContextDistributionCard
            title="页面活跃分布"
            items={selectedDayContextAnalytics.pageTypeDistribution}
            trackedDuration={selectedDayContextAnalytics.totalSessionDuration}
            totalDuration={selectedDayContextAnalytics.totalSessionDuration}
            emptyText="当天还没有页面上下文记录。"
          />
          <ContextDistributionCard
            title="知识库分布"
            items={selectedDayContextAnalytics.kbDistribution}
            trackedDuration={selectedDayContextAnalytics.kbTrackedDuration}
            totalDuration={selectedDayContextAnalytics.totalSessionDuration}
            emptyText="当天还没有可统计的知识库上下文。"
          />
          <ContextDistributionCard
            title="文档分布"
            items={selectedDayContextAnalytics.documentDistribution}
            trackedDuration={selectedDayContextAnalytics.documentTrackedDuration}
            totalDuration={selectedDayContextAnalytics.totalSessionDuration}
            emptyText="当天还没有文档级学习记录。"
          />
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold">Session 时间轴</div>
            <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              展示每次学习的开始时间、结束时间和时长
            </div>
          </div>
          <div className="text-[12px] text-[var(--color-text-muted)]">
            {selectedSessionCount > 0 ? `共 ${selectedSessionCount} 次` : '暂无 session'}
          </div>
        </div>

        {selectedSessionCount > 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            {selectedDayData?.sessions.map((session: LearningSession) => {
              const isRunning = isActive && selectedDate === todayStr && currentSessionId === session.id
              return (
                <div
                  key={session.id}
                  className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                        {formatTime(session.startTime)} - {formatTime(session.endTime)}
                      </div>
                      <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                        {isRunning ? '进行中 session' : '已完成 session'}
                      </div>
                    </div>
                    <div className="text-[14px] font-semibold text-[var(--color-primary)]">
                      {formatDurationCompact(session.duration)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-muted)] p-4 text-[13px] text-[var(--color-text-muted)]">
            {hasContextFilter ? '这一天没有符合当前筛选条件的学习 session。' : '这一天还没有落盘的学习 session。'}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold">当日时段分布</div>
            <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">按小时聚合当天 session 覆盖时长</div>
          </div>
          <div className="text-[12px] text-[var(--color-text-muted)]">
            峰值时段 {formatHourLabel(dayHourBuckets.some(Boolean) ? dayHourBuckets.indexOf(Math.max(...dayHourBuckets)) : null)}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-12 gap-2">
          {dayHourBuckets.map((duration, hour) => (
            <div key={hour} className="col-span-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] p-3">
              <div className="text-[11px] text-[var(--color-text-muted)]">{String(hour).padStart(2, '0')}:00</div>
              <div className="mt-3 h-2 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--color-primary)]"
                  style={{ width: `${Math.max(duration > 0 ? 8 : 0, Math.round((duration / maxDayHourDuration) * 100))}%` }}
                />
              </div>
              <div className="mt-2 text-[12px] font-medium text-[var(--color-text-primary)]">
                {duration > 0 ? formatDurationCompact(duration) : '0m'}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
})
