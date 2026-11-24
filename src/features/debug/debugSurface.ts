/**
 * Debug HUD 的「透明背景」表面决策（P8）。
 *
 * 与 P6 的缓冲纯函数同一套路：视觉 / 交互联动规则能被门禁直接 import 验证，
 * 而不是只靠字符串扫描。本文件不依赖 React / DOM / electron，也不写任何日志
 * —— Debug HUD 的防自放大硬约束同样适用于这里。
 */
export const DEBUG_HUD_TRANSLUCENT_TOKENS = {
  background: 'var(--debug-hud-translucent-bg)',
  border: 'var(--debug-hud-translucent-border)',
  shadow: 'var(--debug-hud-translucent-shadow)',
  textShadow: 'var(--debug-hud-translucent-text-shadow)',
} as const

const SURFACE_TRANSITION = 'background 150ms ease, box-shadow 150ms ease, border-color 150ms ease'

export interface DebugHudSurfaceStyle {
  background?: string
  borderColor?: string
  boxShadow?: string
  transition?: string
}

export interface DebugHudSurfaceInput {
  translucent: boolean
  /** 鼠标停在控制条（标题栏 / 过滤条）时临时恢复不透明，便于读日志。 */
  hovered: boolean
}

/**
 * 三态表面：
 * - 不透明：常规浮层；
 * - 透明且未悬停：半透明背景 + 淡边框 / 淡阴影，看得见下层；
 * - 透明但鼠标在控制条上：临时恢复常规背景，避免想看日志时读不清。
 */
export function debugHudSurfaceStyle(input: DebugHudSurfaceInput): DebugHudSurfaceStyle {
  if (!input.translucent) {
    return { boxShadow: 'var(--shadow-popover)', transition: SURFACE_TRANSITION }
  }
  if (input.hovered) {
    return {
      background: 'var(--titlebar-menu-bg)',
      boxShadow: 'var(--shadow-popover)',
      transition: SURFACE_TRANSITION,
    }
  }
  return {
    background: DEBUG_HUD_TRANSLUCENT_TOKENS.background,
    borderColor: DEBUG_HUD_TRANSLUCENT_TOKENS.border,
    boxShadow: DEBUG_HUD_TRANSLUCENT_TOKENS.shadow,
    transition: SURFACE_TRANSITION,
  }
}

/**
 * 点击穿透必须落在 root 上。P6 只给日志列表设 `pointer-events: none`，
 * 但带背景的 fixed 父容器仍会成为命中目标，事件不会真正落到下层界面 ——
 * 那是「日志行不响应点击」，不是「不挡住正常操作」。
 * root 置 none 后，由组件把标题栏 / 过滤条 / 缩放手柄显式恢复为 auto。
 */
export function debugHudRootPointerEvents(clickThrough: boolean): 'auto' | 'none' {
  return clickThrough ? 'none' : 'auto'
}

/** 半透明底上的文字描边；鼠标移到控制条恢复不透明后不再需要。 */
export function debugHudLogTextShadow(translucent: boolean, hovered: boolean): string | undefined {
  return translucent && !hovered ? DEBUG_HUD_TRANSLUCENT_TOKENS.textShadow : undefined
}

/**
 * 开启透明时联动打开穿透（用户的目标就是少挡操作）；关闭透明不擅自
 * 把用户单独设过的穿透改回去。两个状态仍可独立切换。
 */
export function translucentPatch(
  current: { translucent: boolean; clickThrough: boolean },
  value: boolean,
): { translucent: boolean; clickThrough: boolean } {
  return {
    translucent: value,
    clickThrough: value && !current.clickThrough ? true : current.clickThrough,
  }
}
