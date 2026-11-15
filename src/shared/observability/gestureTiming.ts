/**
 * 手势性能样本口径的唯一来源（零依赖纯函数，门禁可 esbuild 真跑）。
 *
 * 一次手势可能持续数秒，其中大部分时间是用户「按住不动」。把总时长当成操作耗时
 * 去和 drag=300 / zoom=400 / pan=200ms 的单次阈值比，会把每一次普通拖拽都判成慢
 * 操作——真实样本里 pan / zoom 曾因此虚高到 71.4% / 62.5% 慢率。
 * 真正需要监控的是最慢的一帧（主线程卡顿），所以：
 *   durationMs = maxFrameMs，整个手势时长另存 elapsedMs 供追溯，不参与慢判定。
 *
 * React Flow 的即时尺寸变更只发一次 change、没有逐帧过程，不构成手势；
 * 真实数据里 2768 条 resize 样本全是 frameCount=1 的 0~1ms 噪声，直接不上报。
 */
export interface GestureTimingInput {
  frameCount: number
  maxFrameMs: number
  /** 从手势开始到结束的总时长（含静止停留），只作追溯，不参与慢判定。 */
  elapsedMs: number
  /** 该手势类型是否丢弃「只有一帧」的即时 change。resize 为 true，drag / zoom / pan 为 false。 */
  dropSingleFrame: boolean
}

export interface GestureSampleTiming {
  /** 参与 isSlowSample 判定的耗时：最慢一帧。 */
  durationMs: number
  elapsedMs: number
  maxFrameMs: number
}

/** 返回 null 表示这次交互不该产生手势样本。 */
export function resolveGestureSampleTiming(input: GestureTimingInput): GestureSampleTiming | null {
  if (input.dropSingleFrame && input.frameCount <= 1) return null
  const safe = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)
  const maxFrameMs = safe(input.maxFrameMs)
  return {
    durationMs: maxFrameMs,
    elapsedMs: safe(input.elapsedMs),
    maxFrameMs,
  }
}
