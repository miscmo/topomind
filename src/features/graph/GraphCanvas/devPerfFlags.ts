// TEMP-PROFILING：定位缩放卡顿用的一次性 A/B 开关，测完即删。
//
// 用法（DevTools Console）：
//   __tmPerf.edges()     隐藏全部连线，再缩放 → 若变流畅，瓶颈在边（路径 + marker）
//   __tmPerf.minimal()   卡片强制最简档，再缩放 → 若变流畅，瓶颈在卡片内容
//   __tmPerf.off()       两个开关都关掉，回到真实状态
//   __tmPerf.show()      看当前开关状态
import { create } from 'zustand'

type DevPerfState = {
  /** 隐藏全部连线 */
  hideEdges: boolean
  /** 卡片强制走最低细节档（纯色块） */
  minimalCards: boolean
  setHideEdges: (v: boolean) => void
  setMinimalCards: (v: boolean) => void
}

export const useDevPerfFlags = create<DevPerfState>((set) => ({
  hideEdges: false,
  minimalCards: false,
  setHideEdges: (hideEdges) => set({ hideEdges }),
  setMinimalCards: (minimalCards) => set({ minimalCards }),
}))

/** 统计一段时间内的帧间隔，把"卡不卡"变成可比较的毫秒数 */
function recordFrames(durationMs: number): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    const intervals: number[] = []
    const start = performance.now()
    let last = start
    const tick = () => {
      const now = performance.now()
      intervals.push(now - last)
      last = now
      if (now - start < durationMs) {
        requestAnimationFrame(tick)
        return
      }
      const sorted = intervals.slice().sort((a, b) => a - b)
      const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
      const result = {
        帧数: intervals.length,
        平均: +(intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(1),
        p50: +pick(0.5).toFixed(1),
        p95: +pick(0.95).toFixed(1),
        最长: +sorted[sorted.length - 1].toFixed(1),
        '超16ms帧': intervals.filter((v) => v > 16.7).length,
        '超33ms帧': intervals.filter((v) => v > 33).length,
      }
      console.table(result)
      resolve(result)
    }
    requestAnimationFrame(tick)
  })
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const host = window as unknown as Record<string, unknown>
  host.__tmPerf = {
    edges: (v: boolean = true) => useDevPerfFlags.getState().setHideEdges(v),
    minimal: (v: boolean = true) => useDevPerfFlags.getState().setMinimalCards(v),
    off: () => {
      useDevPerfFlags.getState().setHideEdges(false)
      useDevPerfFlags.getState().setMinimalCards(false)
    },
    show: () => {
      const s = useDevPerfFlags.getState()
      return { hideEdges: s.hideEdges, minimalCards: s.minimalCards, zoom: (window as never as Record<string, number>).__tmZoom }
    },
    // 用法：__tmPerf.frames(3000) 然后立刻滚轮缩放 3 秒，结束自动打印表格
    frames: (ms: number = 3000) => recordFrames(ms),
  }
}
