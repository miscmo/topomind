/**
 * 统一表情选择器的数据契约（TS 侧薄包装）。
 *
 * 真正的词库由 `scripts/build-emoji-assets.mjs` 生成，本文件只做类型收敛与
 * 码点工具：运行时零计算、零网络请求、零远程字体，全部资源来自本地 public 目录。
 */
import type { EmojiData } from 'emoji-picker-react'
import rawData from './emojiData.zh.json'
import meta from './emojiMeta.json'

/** v5 picker 的自定义数据集：中文名 / 中文别名 / 拼音 / 首字母 / 英文关键词。 */
export const EMOJI_DATA_ZH = rawData as unknown as EmojiData

/** 国内高频表情（unified），作为「常用」区的稳定置顶部分。 */
export const POPULAR_EMOJI_UNIFIEDS: string[] = meta.popular

/** unified → Fluent Emoji Flat SVG 文件名（含肤色变体）。 */
export const EMOJI_ASSET_MAP: Record<string, string> = meta.assetMap

/** unified → 简体中文主名，用于预览条与无障碍标签。 */
export const EMOJI_LABELS_ZH: Record<string, string> = meta.labels

/** 字形资源根目录。Electron 生产环境是 file:// 页面，必须用带 scheme 的绝对 URL。 */
let glyphBase: string | null = null
export function emojiGlyphUrl(file: string): string {
  if (typeof document === 'undefined') return `fluent-emoji-flat/${file}`
  if (glyphBase === null) {
    try {
      glyphBase = new URL('fluent-emoji-flat/', document.baseURI).href
    } catch {
      glyphBase = 'fluent-emoji-flat/'
    }
  }
  return glyphBase + file
}

/** 去掉变体选择符，v5 数据的 u 与 Fluent 文件名大多使用这种形式。 */
export function normalizeUnified(unified: string): string {
  return String(unified).toLowerCase().replace(/-fe0f/g, '')
}

/** 去掉肤色修饰符，用于查中文主名。 */
export function baseUnified(unified: string): string {
  return normalizeUnified(unified).replace(/-1f3f[b-f]/g, '')
}

/** 原生 emoji 字符 → unified 码点串（去掉 fe0f，保留 ZWJ）。 */
export function emojiCharToUnified(char: string): string {
  return Array.from(char)
    .map((unit) => (unit.codePointAt(0) ?? 0).toString(16))
    .filter((code) => code !== 'fe0f')
    .join('-')
}

/** 查字形文件；找不到时调用方回退到系统原生字符。 */
export function findGlyphAsset(unified: string): string | null {
  const raw = String(unified).toLowerCase()
  const bare = normalizeUnified(raw)
  return EMOJI_ASSET_MAP[raw]
    ?? EMOJI_ASSET_MAP[bare]
    ?? EMOJI_ASSET_MAP[`${bare}-fe0f`]
    ?? null
}

/** 查中文主名。 */
export function emojiLabel(unified: string): string {
  const bare = baseUnified(unified)
  return EMOJI_LABELS_ZH[bare] ?? EMOJI_LABELS_ZH[normalizeUnified(unified)] ?? ''
}
