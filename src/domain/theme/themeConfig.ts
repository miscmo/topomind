/**
 * 应用外观配置 · 持久化 schema 与迁移入口（纯函数，可被 Node 回归脚本直接导入）
 *
 * ===== 为什么先只做「读」的兼容层 =====
 * 线上格式（v0）：localStorage 里就是一个裸 hex 字符串。
 * 目标格式（v1+）：带 version 的 JSON 对象，未来承载主题皮肤字段
 * （skinId / baseMode / neutral 色板 / scale 策略 / harmonize 开关 ...）。
 *
 * 现在写盘仍保持裸 hex，保证零行为变化；但读入口已经版本化，未来只要把
 * persist 切到 serializeThemeConfig，老存档、v1、v2 都能被同一入口读出来，
 * 不必再写第二套兼容代码。
 *
 * 铁律：任何缺失 / 损坏 / 无法识别 / 越版本的存档都回落到默认，永不抛错，
 * 绝不让坏数据注入一串坏变量把界面染花。
 *
 * ===== 未来加皮肤时改哪里 =====
 * 1) THEME_CONFIG_VERSION 升到 2，定义 ThemeConfigV2 并扩 ThemeConfig 联合类型；
 * 2) 在 parseThemeConfig 的 version 分派里加 migrateV2ToV1（保留能识别的字段）；
 * 3) persist 改用 serializeThemeConfig；
 * 4) 组件层不用动 —— 它们只认 --color-* 语义 token。
 */
import { DEFAULT_ACCENT_COLOR, normalizeAccentColor } from './accentColor.ts'

export const THEME_CONFIG_VERSION = 1 as const

export interface ThemeConfigV1 {
  version: 1
  /** 规范化后的 6 位 hex；派生色阶与皮肤覆盖都不落盘 */
  accentColor: string
}

export type ThemeConfig = ThemeConfigV1

function fallbackConfig(accentColor: string): ThemeConfig {
  return { version: THEME_CONFIG_VERSION, accentColor }
}

/**
 * 把任意历史存档解析成当前版本配置。
 *  - v0（裸 hex / 3/4/6/8 位）→ 升级成 v1；
 *  - v1（JSON）→ 逐字段校验；
 *  - 未来版本 / 损坏 JSON / 非字符串 → 回落默认。
 */
export function parseThemeConfig(
  raw: unknown,
  fallbackAccent: string = DEFAULT_ACCENT_COLOR,
): ThemeConfig {
  const safeFallback = normalizeAccentColor(fallbackAccent) ?? DEFAULT_ACCENT_COLOR
  if (typeof raw !== 'string' || raw.trim() === '') return fallbackConfig(safeFallback)
  const text = raw.trim()

  // v0：裸 hex（当前线上写盘格式）。
  if (!text.startsWith('{')) {
    return fallbackConfig(normalizeAccentColor(text) ?? safeFallback)
  }

  // v1+：版本化对象。
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallbackConfig(safeFallback)
    const record = parsed as Record<string, unknown>
    if (record.version === THEME_CONFIG_VERSION) {
      return fallbackConfig(normalizeAccentColor(record.accentColor) ?? safeFallback)
    }
    // 未来版本在这里按 version 分派迁移；当前一律回落默认，
    // 避免把看不懂的字段当成本版本字段使用。
    return fallbackConfig(safeFallback)
  } catch {
    return fallbackConfig(safeFallback)
  }
}

/**
 * 对称的写盘序列化。当前 store 故意不调用它（继续写裸 hex 以保持零行为变化），
 * 但契约先立住并由回归脚本验证 round-trip，未来切换写盘格式时无需再设计。
 */
export function serializeThemeConfig(config: ThemeConfig): string {
  return JSON.stringify(fallbackConfig(
    normalizeAccentColor(config.accentColor) ?? DEFAULT_ACCENT_COLOR,
  ))
}
