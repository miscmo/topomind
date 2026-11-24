/**
 * 应用全局主题色 · 唯一管理层（纯函数，可被 Node 回归脚本直接导入）
 *
 * ===== 为什么需要这一层 =====
 * 旧设计把主题色族（primary / accent / hover / soft / selected / highlight /
 * titlebar-active）在 tokens.css 的三个主题块里各写死一份字面值，彼此不是派生关系。
 * 结果：只改 --color-accent 时，选中底色、焦点环、标题栏激活态、hover 高亮仍停在旧的
 * 品牌蓝上，换色必然「花」。而且 light 与 dark 的亮度关系全靠人工维护。
 *
 * 新设计：一个用户色 → 自动调和 → 派生整套色阶 → 注入 --tm-brand-* 变量。
 * tokens.css 只保留静态 fallback（JS 未就绪时的默认外观），运行时由本层统一驱动。
 * 组件侧继续只引用 --color-* 语义 token，不需要知道主题色从哪来。
 *
 * ===== 不突兀的两条硬约束 =====
 * 1) 自定义色先做 HSL 调和：饱和度 / 明度收敛到品牌调性区间，荧光色不会直接刷屏；
 * 2) 按 WCAG 对比度校亮度：主题色既当按钮底色（配 --color-text-inverse）又当文字色，
 *    因此 light 下必须让白字可读、dark 下必须让深字可读且在深背景上可辨，
 *    否则自动压暗 / 提亮。任意 hex 换上后都保持同样的可读性层级。
 *
 * ===== 可配置策略（为后续主题皮肤预留，2026-11-23）=====
 * 所有可调数值都收进 ACCENT_POLICIES（light / dark 各一份）：
 *   harmonize —— 饱和度 / 明度 / 对比度约束；
 *   scale     —— alpha 档位 / hover 明度偏移 / 深色亮度层级。
 * 函数只描述「怎么派生」，不再含魔数。未来主题皮肤只需覆盖策略数据，
 * 不必改派生分支、也不用新增 data-theme 值。
 * 默认策略的输出与抽策略之前逐字一致，由 verify-critical-regressions.mts 第 68 组锁死。
 */
import { ACCENT_PRESETS } from './accentPresets.ts'

export type AccentTheme = 'light' | 'dark'

/** 默认品牌色：与 tokens.css 的静态 fallback 完全一致，选中它时不注入任何变量。 */
export const DEFAULT_ACCENT_COLOR = ACCENT_PRESETS[0].hex

/**
 * 运行时主题色变量契约。tokens.css 里的主题色族必须逐个引用这些变量，
 * 顺序 / 命名由 scripts/verify-critical-regressions.mts 锁死。
 */
export const ACCENT_TOKEN_NAMES = [
  '--tm-brand-primary',
  '--tm-brand-primary-hover',
  '--tm-brand-accent',
  '--tm-brand-accent-hover',
  '--tm-brand-soft',
  '--tm-brand-selected',
  '--tm-brand-highlight',
  '--tm-brand-titlebar-active',
] as const

interface Rgb {
  r: number
  g: number
  b: number
}

interface Hsl {
  /** 0..360 */
  h: number
  /** 0..1 */
  s: number
  /** 0..1 */
  l: number
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
/** dark 主题下 --color-text-inverse 与 --color-bg-app 都用这一档深色。 */
const DARK_INK: Rgb = { r: 15, g: 20, b: 27 }

/** 把一个自定义色调和成「可作主题色」的基色时的全部可调参数。 */
export interface AccentHarmonizePolicy {
  /** 主题色与反色文字 / 所在背景的最小 WCAG 对比度 */
  minContrast: number
  minSaturation: number
  maxSaturation: number
  /** 低于此饱和度视为无彩色：保留中性，绝不凭空染上一个色相 */
  neutralSaturation: number
  minLightness: number
  maxLightness: number
  /** 浅色调和时向下压暗的亮度下限（百分点） */
  contrastSearchFloor: number
}

/** 仅深色主题使用：把中明度基色抬成「深底上可读」的两档亮色。 */
export interface AccentDarkTiers {
  saturationBoost: number
  saturationFloor: number
  saturationCeiling: number
  accentLightnessOffset: number
  accentLightnessFloor: number
  accentLightnessCeiling: number
  /** 对比度校正时向上提亮的亮度上限（百分点） */
  contrastSearchCeiling: number
  primaryBaseOffset: number
  primaryAccentOffset: number
  primaryLightnessFloor: number
  primaryLightnessCeiling: number
  hoverLightnessCeiling: number
}

/** 由基色派生整套色阶的全部可调参数。 */
export interface AccentScalePolicy {
  softAlpha: number
  selectedAlpha: number
  titlebarActiveAlpha: number
  /** hover 相对所在色阶的明度偏移（百分点，浅色为负 / 深色为正） */
  hoverLightnessDelta: number
  /** 浅色主题直接用基色，没有深色亮度层级；深色主题必须提供 */
  darkTiers: AccentDarkTiers | null
}

export interface AccentPolicy {
  harmonize: AccentHarmonizePolicy
  scale: AccentScalePolicy
}

/** 两套基础明暗模式共用同一组可读性底线。 */
const DEFAULT_HARMONIZE_POLICY: AccentHarmonizePolicy = {
  minContrast: 4.5,
  minSaturation: 0.25,
  maxSaturation: 0.95,
  neutralSaturation: 0.12,
  minLightness: 0.34,
  maxLightness: 0.5,
  contrastSearchFloor: 20,
}

export const ACCENT_POLICIES: Record<AccentTheme, AccentPolicy> = {
  light: {
    harmonize: DEFAULT_HARMONIZE_POLICY,
    scale: {
      softAlpha: 0.1,
      selectedAlpha: 0.08,
      titlebarActiveAlpha: 0.12,
      hoverLightnessDelta: -10,
      darkTiers: null,
    },
  },
  dark: {
    harmonize: DEFAULT_HARMONIZE_POLICY,
    scale: {
      softAlpha: 0.14,
      selectedAlpha: 0.16,
      titlebarActiveAlpha: 0.16,
      hoverLightnessDelta: 8,
      darkTiers: {
        saturationBoost: 0.08,
        saturationFloor: 0.55,
        saturationCeiling: 1,
        accentLightnessOffset: 0.2,
        accentLightnessFloor: 0.55,
        accentLightnessCeiling: 0.72,
        contrastSearchCeiling: 92,
        primaryBaseOffset: 0.36,
        primaryAccentOffset: 0.14,
        primaryLightnessFloor: 0.72,
        primaryLightnessCeiling: 0.9,
        hoverLightnessCeiling: 96,
      },
    },
  },
}

/** 未来主题皮肤的唯一扩展点：按基础明暗模式取默认策略，再叠加局部覆盖。 */
export interface AccentPolicyOverrides {
  harmonize?: Partial<AccentHarmonizePolicy>
  scale?: Partial<Omit<AccentScalePolicy, 'darkTiers'>> & { darkTiers?: Partial<AccentDarkTiers> }
}

export function resolveAccentPolicy(theme: AccentTheme, overrides?: AccentPolicyOverrides): AccentPolicy {
  const base = ACCENT_POLICIES[theme]
  if (!overrides) return base
  const tiers = base.scale.darkTiers
  return {
    harmonize: { ...base.harmonize, ...overrides.harmonize },
    scale: {
      ...base.scale,
      ...overrides.scale,
      darkTiers: tiers ? { ...tiers, ...overrides.scale?.darkTiers } : null,
    },
  }
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 规范化任意 CSS hex（#rgb / #rgba / #rrggbb / #rrggbbaa）为不带 alpha 的 6 位小写值。 */
export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!HEX_RE.test(raw)) return null
  let digits = raw.slice(1)
  if (digits.length === 3 || digits.length === 4) {
    digits = digits.slice(0, 3).split('').map((c) => c + c).join('')
  } else {
    // 丢弃 alpha：主题色派生出的半透明色阶自带 alpha，基色带 alpha 会让两层叠加失真。
    digits = digits.slice(0, 6)
  }
  return `#${digits.toLowerCase()}`
}

function hexToRgb(hex: string): Rgb {
  const digits = hex.slice(1)
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const l = (max + min) / 2
  if (delta === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let rgb: [number, number, number]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const m = l - c / 2
  return {
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255,
  }
}

function srgbChannel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`
}

function atLightness(base: Hsl, lightnessPercent: number): string {
  return rgbToHex(hslToRgb({ ...base, l: clamp(lightnessPercent / 100, 0, 1) }))
}

export interface HarmonizedAccent {
  /** 实际参与派生的基色 */
  hex: string
  /** 是否被自动微调过（设置页据此提示用户） */
  adjusted: boolean
}

/**
 * 把任意用户色收敛成「可作主题色」的基色：保留色相，限制饱和度 / 明度，
 * 再按白字对比度校亮度。对已经合规的颜色是幂等的。
 * policy 可由主题皮肤覆盖（例如放宽饱和度区间 / 提高可读性下限）。
 */
export function harmonizeAccentColor(
  input: unknown,
  policy: AccentHarmonizePolicy = ACCENT_POLICIES.light.harmonize,
): HarmonizedAccent {
  const normalized = normalizeAccentColor(input) ?? DEFAULT_ACCENT_COLOR
  const original = hexToRgb(normalized)
  const { h, s, l } = rgbToHsl(original)

  // 已经落在品牌调性区间且文字可读的颜色原样返回：HSL 往返会引入 ±1 色阶的舍入，
  // 对预设色板 / 默认品牌色做这种无意义的改写会让取色器与配置值来回跳。
  const neutral = s < policy.neutralSaturation
  const saturationOk = neutral || (s >= policy.minSaturation && s <= policy.maxSaturation)
  if (
    saturationOk
    && l >= policy.minLightness && l <= policy.maxLightness
    && contrastRatio(original, WHITE) >= policy.minContrast
  ) {
    return { hex: normalized, adjusted: false }
  }

  const safeSaturation = neutral ? 0 : clamp(s, policy.minSaturation, policy.maxSaturation)
  let lightness = Math.round(clamp(l, policy.minLightness, policy.maxLightness) * 100)

  // light 主题：主题色是按钮底 + 反色文字，也是浅底上的文字色 → 用白字对比度统一约束。
  while (
    contrastRatio(hslToRgb({ h, s: safeSaturation, l: lightness / 100 }), WHITE) < policy.minContrast
    && lightness > policy.contrastSearchFloor
  ) {
    lightness -= 1
  }

  const hex = rgbToHex(hslToRgb({ h, s: safeSaturation, l: lightness / 100 }))
  return { hex, adjusted: hex !== normalized }
}

/** 两个色是否落到同一个调和结果（用于预设色板的高亮判断）。 */
export function isSameAccentColor(a: unknown, b: unknown): boolean {
  return harmonizeAccentColor(a).hex === harmonizeAccentColor(b).hex
}

/**
 * 由一个基色派生整套主题色阶。light / dark 用不同的亮度层级：
 *   light —— primary === accent（单色制），hover 压暗 10pp；
 *   dark  —— primary 是更亮的一档（做浅底填充 / 文本），accent 是交互填充档，
 *            hover 各提亮 8pp；soft / selected / titlebar-active 都是同色相的半透明叠加。
 * 各档偏移全部来自 ACCENT_POLICIES，默认策略校准自 tokens.css 原有的 GitHub 蓝，
 * 因此选回默认色时视觉零跳变。第三参数是主题皮肤的策略覆盖入口。
 */
export function buildAccentTokens(
  input: unknown,
  theme: AccentTheme,
  policy: AccentPolicy = ACCENT_POLICIES[theme],
): Record<string, string> {
  const { hex } = harmonizeAccentColor(input, policy.harmonize)
  const base = rgbToHsl(hexToRgb(hex))
  const scale = policy.scale
  const tiers = scale.darkTiers

  if (theme === 'light' || !tiers) {
    const hover = atLightness(base, Math.round(base.l * 100) + scale.hoverLightnessDelta)
    return {
      '--tm-brand-primary': hex,
      '--tm-brand-primary-hover': hover,
      '--tm-brand-accent': hex,
      '--tm-brand-accent-hover': hover,
      '--tm-brand-soft': withAlpha(hex, scale.softAlpha),
      '--tm-brand-selected': withAlpha(hex, scale.selectedAlpha),
      '--tm-brand-highlight': hex,
      '--tm-brand-titlebar-active': withAlpha(hex, scale.titlebarActiveAlpha),
    }
  }

  const darkSaturation = base.s < policy.harmonize.neutralSaturation
    ? 0
    : clamp(base.s + tiers.saturationBoost, tiers.saturationFloor, tiers.saturationCeiling)
  let accentLightness = Math.round(
    clamp(base.l + tiers.accentLightnessOffset, tiers.accentLightnessFloor, tiers.accentLightnessCeiling) * 100,
  )
  // dark 主题里 DARK_INK 同时是「accent 按钮上的反色文字」和「accent 文字所在的背景」，
  // 两个可读性约束因此是同一个对比度：accent 必须与这一档深色拉开至少 minContrast。
  while (accentLightness < tiers.contrastSearchCeiling) {
    const rgb = hslToRgb({ h: base.h, s: darkSaturation, l: accentLightness / 100 })
    if (contrastRatio(rgb, DARK_INK) >= policy.harmonize.minContrast) break
    accentLightness += 1
  }
  const primaryLightness = Math.round(clamp(
    Math.max(base.l + tiers.primaryBaseOffset, accentLightness / 100 + tiers.primaryAccentOffset),
    tiers.primaryLightnessFloor,
    tiers.primaryLightnessCeiling,
  ) * 100)
  const darkBase: Hsl = { h: base.h, s: darkSaturation, l: base.l }
  const accent = atLightness(darkBase, accentLightness)
  const primary = atLightness(darkBase, primaryLightness)

  return {
    '--tm-brand-primary': primary,
    '--tm-brand-primary-hover': atLightness(darkBase, Math.min(tiers.hoverLightnessCeiling, primaryLightness + scale.hoverLightnessDelta)),
    '--tm-brand-accent': accent,
    '--tm-brand-accent-hover': atLightness(darkBase, Math.min(tiers.hoverLightnessCeiling, accentLightness + scale.hoverLightnessDelta)),
    '--tm-brand-soft': withAlpha(accent, scale.softAlpha),
    '--tm-brand-selected': withAlpha(accent, scale.selectedAlpha),
    '--tm-brand-highlight': accent,
    '--tm-brand-titlebar-active': withAlpha(accent, scale.titlebarActiveAlpha),
  }
}
