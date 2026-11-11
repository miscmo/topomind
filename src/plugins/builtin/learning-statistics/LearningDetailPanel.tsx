import { memo } from 'react'
import type { LearningDailyRecord as DailyRecord } from '../../public'
import type { ContextAnalytics } from './analytics.ts'
import {
  formatDurationCompact,
  formatFullDateLabel,
  getDateStr,
} from './analytics.ts'
import { DayHalfHourBlocks } from './DayHalfHourBlocks.tsx'
import {
  DistributionCard,
  MUTED_CLASS,
  MetricTile,
  PANEL_CLASS,
  SectionCard,
} from './LearningStatisticsParts.tsx'

interface LearningDetailPanelProps {
  selectedDate: string | null
  selectedDayData: DailyRecord | null
  selectedDayDuration: number
  currentSessionId: string | null
  isActive: boolean
  contextAnalytics: ContextAnalytics
  selectedDayContextAnalytics: ContextAnalytics
  dailyGoal: number
  onBackToSummary: () => void
}

const DistributionRow = ({
  analytics,
  emptySuffix,
}: {
  analytics: ContextAnalytics
  emptySuffix: string
}) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
    <DistributionCard
      title="页面"
      items={analytics.pageTypeDistribution}
      emptyText={emptySuffix === '当天' ? '当天暂无页面记录' : '当前范围暂无页面记录'}
    />
    <DistributionCard
      title="知识库"
      items={analytics.kbDistribution}
      emptyText={emptySuffix === '当天' ? '当天暂无知识库记录' : '当前范围暂无知识库记录'}
    />
    <DistributionCard
      title="文档"
      items={analytics.documentDistribution}
      emptyText={emptySuffix === '当天' ? '当天暂无文档记录' : '当前范围暂无文档记录'}
    />
  </div>
)

export const LearningDetailPanel = memo(function LearningDetailPanel({
  selectedDate,
  selectedDayData,
  selectedDayDuration,
  currentSessionId,
  isActive,
  contextAnalytics,
  selectedDayContextAnalytics,
  dailyGoal,
  onBackToSummary,
}: LearningDetailPanelProps) {
  if (!selectedDate) {
    return (
      <SectionCard
        title="学习分布"
        testId="distribution"
        aside={<span className={`text-[11px] ${MUTED_CLASS}`}>按当前范围 · Top 3</span>}
      >
        <div className="mt-4">
          <DistributionRow analytics={contextAnalytics} emptySuffix="范围" />
        </div>
      </SectionCard>
    )
  }

  const todayStr = getDateStr(new Date())
  const sessions = selectedDayData?.sessions || []
  const goalReached = selectedDayDuration >= dailyGoal
  const goalPercent = Math.round((selectedDayDuration / Math.max(dailyGoal, 1)) * 100)

  return (
    <section className={`${PANEL_CLASS} p-5`} data-tm-learning-day-detail="">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{formatFullDateLabel(selectedDate)}</h2>
        <button
          type="button"
          onClick={onBackToSummary}
          className="h-8 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[12px] hover:bg-[var(--color-hover-bg)]"
        >
          返回范围视图
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <MetricTile label="当天时长" value={formatDurationCompact(selectedDayDuration)} />
        <MetricTile label="Session" value={`${sessions.length} 次`} />
        <MetricTile
          label="目标完成"
          value={goalReached ? '已达标' : '未达标'}
          hint={`${goalPercent}% · 目标 ${formatDurationCompact(dailyGoal)}`}
        />
      </div>

      <div className="mt-5">
        {/* 按日期换 key：切换当天时收起上一次展开的半小时明细。 */}
        <DayHalfHourBlocks
          key={selectedDate}
          sessions={sessions}
          isActive={isActive}
          currentSessionId={currentSessionId}
          isToday={selectedDate === todayStr}
        />
      </div>

      <div className="mt-5">
        <div className="text-[13px] font-medium">当天分布</div>
        <div className="mt-3">
          <DistributionRow analytics={selectedDayContextAnalytics} emptySuffix="当天" />
        </div>
      </div>
    </section>
  )
})
