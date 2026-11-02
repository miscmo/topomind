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
  }
}
