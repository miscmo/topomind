/**
 * 运行时自动观测：不依赖业务代码配合的性能指标。
 * - app_startup：渲染进程脚本启动 → React 首帧提交
 * - long_task  ：PerformanceObserver 捕获的主线程阻塞（>= 50ms）
 *
 * 这两条是「应用功能分析」里无法靠手工埋点覆盖的部分：任何功能卡顿都会体现在
 * 长任务上，而启动耗时是所有后续操作的基线。采样/节流由统一上报层负责。
 */
import { PERFORMANCE_METRICS } from '@/shared/observability/performanceContract'
import { startSuspensionObserver } from '@/shared/observability/performanceSuspension'
import { getRecentPerformanceContext, recordPerformance } from './performance-log'

const LONGTASK_MIN_MS = 50

export function reportAppStartup(durationMs: number): void {
  recordPerformance(PERFORMANCE_METRICS.appStartup, durationMs, {
    module: 'Bootstrap',
    force: true,
    params: { phase: 'first-frame' },
  })
}

export function startRuntimePerformanceObserver(): () => void {
  // 挂起观察器与 longtask 观察器同生命周期。即使当前 Chromium 不支持 longtask，
  // 仍要启动：统一上报层靠它识别「切后台 / 休眠」产生的假慢样本。
  const stopSuspensionObserver = startSuspensionObserver()
  if (typeof PerformanceObserver === 'undefined') return stopSuspensionObserver

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < LONGTASK_MIN_MS) continue
        // 长任务本身没有业务语义，用长任务自带的 startTime 反查该时刻之前
        // 最可能引发阻塞的操作 / 房间，而不是 observer 回调触发时的「最近操作」。
        const recent = getRecentPerformanceContext(entry.startTime)
        recordPerformance(PERFORMANCE_METRICS.longTask, entry.duration, {
          module: 'PerformanceObserver',
          contextKey: recent?.contextKey,
          params: {
            entryType: entry.entryType,
            name: entry.name,
            startTime: Math.round(entry.startTime),
            recentMetric: recent?.metric ?? '',
            recentContext: recent?.contextKey ?? '',
          },
        })
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
    return () => {
      observer.disconnect()
      stopSuspensionObserver()
    }
  } catch {
    // 某些 Chromium 版本/上下文不支持 longtask，静默降级，不影响业务。
    return stopSuspensionObserver
  }
}
