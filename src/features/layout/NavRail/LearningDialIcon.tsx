/**
 * 左侧导航「学习记录」的单环表盘图标（内刻度 + 中心大字）。
 *
 * 计时语义：中心数字 = 当日已完成的整小时，环 = 当前这一小时的分钟进度。
 * 12 个内刻度对应 60 分钟（每格 5 分钟），0/15/30/45 分为长刻度；整点时环归零、
 * 数字 +1，相当于时针进一格，所以「跑满一圈」不是进度倒退而是明确的进位。
 * 不到 1 小时中心不显示数字，只留一个轴心点（灰 = 未开始，主题色呼吸 = 学习中）。
 *
 * 数据只取宿主的 learningTrackerStore，不反向依赖插件实现；selector 把秒量化到
 * 分钟，1s tick 不会让导航按钮每秒重渲染。颜色全部走 --color-* 语义 token，
 * 用户自定义主题色 / 明暗主题切换时自动跟随。
 */
import { memo } from 'react'
import { useLearningTrackerStore } from '@/features/learning-tracker/model/learningTrackerStore'

/** 环半径 9.8 的周长，进度弧用 stroke-dasharray 截取。 */
const DIAL_CIRCUMFERENCE = 2 * Math.PI * 9.8
/** 与 learningTrackerStore.normalizeMeta / bootstrap.cloneLearningMeta 的默认口径一致。 */
const DEFAULT_DAILY_GOAL_SECONDS = 3600 * 2
const TICK_ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330] as const
const MAJOR_TICK_ANGLES: ReadonlySet<number> = new Set([0, 90, 180, 270])

const TRACK_COLOR = 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
const TICK_COLOR = 'color-mix(in srgb, var(--color-accent) 20%, transparent)'
const ACTIVE_COLOR = 'var(--color-accent)'

export interface LearningDialSnapshot {
  /** 当日累计分钟（已量化：只在整分钟变化时更新） */
  minutes: number
  hours: number
  /** 当前这一小时的进度 0..1 */
  minuteFraction: number
  isActive: boolean
  goalReached: boolean
}

/** 导航图标与 tooltip 共用的同一份数据，避免两个组件各算一套时长。 */
export function useLearningDialSnapshot(): LearningDialSnapshot {
  const minutes = useLearningTrackerStore((state) => Math.floor(state.todayDuration / 60))
  const isActive = useLearningTrackerStore((state) => state.isActive)
  const dailyGoalSeconds = useLearningTrackerStore(
    (state) => state.meta?.settings.dailyGoal ?? DEFAULT_DAILY_GOAL_SECONDS,
  )
  return {
    minutes,
    hours: Math.floor(minutes / 60),
    minuteFraction: (minutes % 60) / 60,
    isActive,
    goalReached: minutes * 60 >= dailyGoalSeconds,
  }
}

/** 图标只给整小时，精确时长由 tooltip / aria 承担。 */
export function formatLearningDialDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** 悬停时的两行信息压成一行；只在「学习记录」按钮里挂载，不拖累其它导航项。 */
export const LearningDialTooltip = memo(function LearningDialTooltip() {
  const { minutes, goalReached } = useLearningDialSnapshot()
  return (
    <>学习记录 · 今日 {formatLearningDialDuration(minutes)}{goalReached ? ' · 已达成日目标' : ''}</>
  )
})

export const LearningDialIcon = memo(function LearningDialIcon() {
  const { hours, minuteFraction, isActive, goalReached } = useLearningDialSnapshot()
  const progress = minuteFraction * DIAL_CIRCUMFERENCE
  const digits = hours > 0 ? String(hours) : ''
  const twoDigits = digits.length > 1

  return (
    <svg
      data-tm-learning-dial=""
      className="h-6 w-6 shrink-0"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {/* 达成日目标：最外一圈极淡光晕，不与环 / 数字抢语义 */}
      {goalReached && (
        <circle
          data-tm-learning-dial-goal=""
          cx="12" cy="12" r="11.6" fill="none" strokeWidth="0.8"
          style={{ stroke: 'var(--color-accent-soft)' }}
        />
      )}
      {TICK_ANGLES.map((angle) => {
        const major = MAJOR_TICK_ANGLES.has(angle)
        return (
          <line
            key={angle}
            x1="12" y1="4.4" x2="12" y2={major ? '5.7' : '5.1'}
            strokeWidth={major ? '1.1' : '0.9'}
            strokeLinecap="round"
            transform={`rotate(${angle} 12 12)`}
            style={{ stroke: TICK_COLOR }}
          />
        )
      })}
      <circle
        cx="12" cy="12" r="9.8" fill="none" strokeWidth="1.5"
        style={{ stroke: TRACK_COLOR }}
      />
      {progress > 0 && (
        <circle
          data-tm-learning-dial-progress=""
          cx="12" cy="12" r="9.8" fill="none" strokeWidth="1.5"
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
          strokeDasharray={`${progress} 200`}
          style={{ stroke: ACTIVE_COLOR }}
        />
      )}
      {digits ? (
        <text
          x="12" y={twoDigits ? '15.2' : '15.9'}
          textAnchor="middle"
          fontSize={twoDigits ? '9' : '11'}
          fontWeight="500"
          style={{ fill: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}
        >
          {digits}
        </text>
      ) : (
        <circle
          data-tm-learning-dial-axis=""
          cx="12" cy="12" r="0.9"
          className={isActive ? 'tm-learning-dial-pulse' : undefined}
          style={{ fill: isActive ? ACTIVE_COLOR : 'var(--color-text-muted)' }}
        />
      )}
    </svg>
  )
})
